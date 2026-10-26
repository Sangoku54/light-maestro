/**
 * DMX Helpers — Universe-aware channel dispatch.
 *
 * Instead of hardcoding setChannels(0, ...), this dispatches DMX values
 * to the correct universe based on where each fixture is patched.
 */

import type { PatchedFixture } from '../stores/showStore';
import { useAppStore } from '../stores/appStore';
import { fixtureTestState } from './fixture-test-state';
import { dmxBridge } from './dmx-bridge';

export interface UniverseInfo {
  id: string;
}

/**
 * Given channel values by DMX address, returns per-universe channel maps
 * based on fixture patch ranges.
 */
export function dispatchChannelsByFixture(
  channelValues: Record<number, number>,
  patchedFixtures: PatchedFixture[],
  universes: UniverseInfo[],
): Map<number, Record<number, number>> {
  const uniIds = universes.map((u) => String(u.id));
  const dispatched = new Map<number, Record<number, number>>();

  // Initialize empty maps for all universes
  for (let i = 0; i < universes.length; i++) {
    dispatched.set(i, {});
  }

  for (const pf of patchedFixtures) {
    const uniIdx = uniIds.indexOf(pf.universeId);
    const uniNum = uniIdx >= 0 ? uniIdx : 0;
    const base = pf.startAddress;
    const endAddr = base + pf.channelCount;

    // Ensure universe exists in dispatched map
    if (!dispatched.has(uniNum)) dispatched.set(uniNum, {});
    const uniVals = dispatched.get(uniNum)!;
    for (const [addrStr, val] of Object.entries(channelValues)) {
      const addr = Number(addrStr);
      if (addr >= base && addr < endAddr) {
        const existing = uniVals[addr];
        if (existing === undefined || val > existing) {
          uniVals[addr] = val;
        }
      }
    }
  }

  // Remove empty universes
  for (const [uniNum, vals] of dispatched.entries()) {
    if (Object.keys(vals).length === 0) {
      dispatched.delete(uniNum);
    }
  }

  return dispatched;
}

/**
 * Normalize any DMX buffer shape to 0-based Uint8Array access
 * (DMX address ch → index ch-1).
 *
 * Bridge buffers are Records keyed by 1-based address and may be sparse
 * (a few faders moved) — `new Uint8Array(Object.values(rec))` would compact
 * them and shift every index, muting fixtures. Expand explicitly instead.
 */
export function normalizeDmxBuffer(
  rawData: Uint8Array | number[] | Record<number, number>,
): Uint8Array {
  if (rawData instanceof Uint8Array) return rawData;
  if (Array.isArray(rawData)) return Uint8Array.from(rawData);
  const data = new Uint8Array(512);
  for (const chStr in rawData) {
    const ch = Number(chStr);
    if (ch >= 1 && ch <= 512) data[ch - 1] = rawData[chStr];
  }
  return data;
}

/**
 * Send channel values to all relevant DMX universes based on fixture patch.
 * `sourceId` names the output-arbiter source so priorities apply.
 */
export async function sendChannelsToHardware(
  channelValues: Record<number, number>,
  patchedFixtures: PatchedFixture[],
  universes: UniverseInfo[],
  sourceId: string = 'default',
  transientMs?: number,
): Promise<void> {
  // Apply scene live overrides (master dimmer, per-fixture dimmer)
  // These are global multipliers applied on top of all playback sources
  const sceneLiveOverrides = useAppStore.getState().sceneLiveOverrides;
  const masterDimmer = sceneLiveOverrides?.masterDimmer ?? 255;
  const perFixtureDimmer = sceneLiveOverrides?.perFixtureDimmer ?? {};

  if (masterDimmer !== 255 || Object.keys(perFixtureDimmer).length > 0) {
    // Scale intensity channels for each fixture
    for (const pf of patchedFixtures) {
      const pfDimmer = perFixtureDimmer[pf.id];
      const dimmerMul = pfDimmer !== undefined
        ? pfDimmer / 255
        : masterDimmer / 255;

      if (dimmerMul === 1) continue;

      const base = pf.startAddress;

      // Main intensity channel - find the intensity offset from fixture channels
      // We need to check which channels are intensity channels
      // For simplicity, scale all channels that belong to this fixture
      // by the dimmer multiplier
      for (const [addr, val] of Object.entries(channelValues)) {
        const ch = Number(addr);
        if (ch >= base && ch < base + (pf.channelCount || 1)) {
          channelValues[ch] = Math.round(val * dimmerMul);
        }
      }
    }
  }

  // Toujours traverser le pont (arbitre + cache 3D), même sans API hardware :
  // flushToHardware ignore déjà l'absence de DMX. L'ancien early-return
  // laissait le cache 3D périmé pendant que le miroir appStore avançait —
  // la 3D (qui préfère le cache arbitré) ignorait alors ces envois.
  if (patchedFixtures.length > 0 && universes.length > 0) {
    const dispatched = dispatchChannelsByFixture(channelValues, patchedFixtures, universes);
    for (const [uniNum, vals] of dispatched.entries()) {
      try {
        if (transientMs !== undefined) dmxBridge.writeTransient(sourceId, uniNum, vals, transientMs);
        else dmxBridge.write(sourceId, uniNum, vals);
      } catch {}
    }
  } else {
    // Direct output — no fixtures patched, send to universe 0
    try {
      if (transientMs !== undefined) dmxBridge.writeTransient(sourceId, 0, channelValues, transientMs);
      else dmxBridge.write(sourceId, 0, channelValues);
    } catch {}
  }
}

/**
 * Send to a single universe — useful for Simple Desk (per-universe).
 * `sourceId` names the output-arbiter source so priorities apply.
 */
export async function sendToUniverse(
  uniNum: number,
  channelValues: Record<number, number>,
  sourceId: string = 'default',
): Promise<void> {
  const dmx = (window as any).lightMaestro?.dmx;
  if (!dmx) return;
  try { dmxBridge.write(sourceId, uniNum, channelValues); } catch {}
}

/**
 * Build the DMX channel values that turn a fixture fully ON:
 *  - dimmer (Intensity) at max (255)
 *  - shutter open (255)
 *  - color at default white (RGB 255/255/255, or the white wheel cap if present)
 * Pan/Tilt are left untouched so the beam stays where the user aimed it.
 */
export function buildFixtureOnChannelValues(
  pf: PatchedFixture,
  channels: { name: string; type: string; capabilities?: { min: number; max: number; name?: string; color?: string }[] }[],
): Record<number, number> {
  const out: Record<number, number> = {};
  const base = pf.startAddress;
  let intensityOffset: number | null = null;
  let shutterOffset: number | null = null;
  const colorChannels: { offset: number; name: string; caps?: { min: number; max: number; name?: string; color?: string }[] }[] = [];
  const startsWithRgb = /^(red|green|blue|white|amber|uv|warm\s*white|cool\s*white)/i;
  const hasColorWord = /\b(red|green|blue|white|amber|colour|color|rgb|uv|warm|cool)\b/i;
  // Laser : sa roue « couleur » EST la source lumineuse (gates R/G/Y) —
  // il faut ouvrir un slot pour l'allumer, même sans slot blanc.
  const isLaser = channels.some(
    (c) => /laser/i.test(c.name || '') || (c.capabilities ?? []).some((cap) => /laser/i.test(cap.name || '')),
  );

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const chName = ch.name || '';
    const hasColorCaps = ch.capabilities?.some((cap) => cap.color) ?? false;
    if (startsWithRgb.test(chName) || ch.type === 'Colour' || (ch.type === 'Beam' && hasColorWord.test(chName)) || hasColorCaps) {
      colorChannels.push({ offset: i, name: chName, caps: ch.capabilities });
      continue;
    }
    // Un canal nommé « Strobe » n'est PAS un shutter : ne pas l'« ouvrir » à 255
    // (sur un canal Strobe, 255 = strobe max permanent). Même logique que
    // l'analyseur : les composites (« Shutter / Strobe », « Strobe Functions »,
    // « Strobe Speed »…) restent des shutters.
    const isPureStrobe = /\bstrobe\b/i.test(chName) && !/shutter|dimmer|function|multifunctional|pattern|speed|frequency|duration|density|intensity/i.test(chName);
    if (ch.type === 'Intensity' && intensityOffset === null) intensityOffset = i;
    else if (ch.type === 'Shutter' && !isPureStrobe && shutterOffset === null) shutterOffset = i;
  }

  if (intensityOffset !== null) out[base + intensityOffset] = 255;
  if (shutterOffset !== null) out[base + shutterOffset] = 255; // open

  if (colorChannels.length >= 3) {
    const rIdx = colorChannels.findIndex((c) => /red|\br\b/i.test(c.name));
    const gIdx = colorChannels.findIndex((c) => /green|\bg\b/i.test(c.name));
    const bIdx = colorChannels.findIndex((c) => /blue|\bb\b/i.test(c.name));
    const rgb = rIdx >= 0 && gIdx >= 0 && bIdx >= 0
      ? [colorChannels[rIdx].offset, colorChannels[gIdx].offset, colorChannels[bIdx].offset]
      : colorChannels.slice(0, 3).map((c) => c.offset);
    for (const o of rgb) out[base + o] = 255; // white
    // Zero out any extra tint channels (white/amber/UV...) so the mix stays pure white
    for (const c of colorChannels) {
      if (!rgb.includes(c.offset)) out[base + c.offset] = 0;
    }
  } else if (colorChannels.length === 1) {
    // Roue couleur : n'écrire QUE si un slot blanc/open existe (ou laser —
    // sa roue est la source, il faut ouvrir une couleur). Sans slot blanc
    // (ex. AFX Spot 60 : Red 0-29, Green, Blue, Yellow, Magenta, Rainbow —
    // aucun Open), l'ancien fallback caps[0] allumait la fixture en ROUGE.
    // Ne pas écrire = position physique par défaut (open/blanc).
    const caps = colorChannels[0].caps?.filter((cap) => cap.color) ?? [];
    const whiteCap = caps.find((cap) => /white|open/i.test(cap.name || '') || /^#fff/i.test(cap.color || ''));
    const cap = whiteCap ?? (isLaser ? caps[0] : undefined);
    if (cap) {
      out[base + colorChannels[0].offset] = Math.round((cap.min + cap.max) / 2);
    }
  }

  // Lasers FX (ex. Galaxian 2 gates R/G, IODA « Program ») : allumer les
  // beams et placer le mode sur une zone DMX pilotable (plus jamais « Laser
  // off »/« NoFunction » au bouton Allumer).
  const laser = channels.some(
    (c) => /laser/i.test(c.name || '') || (c.capabilities ?? []).some((cap) => /laser/i.test(cap.name || '')),
  );
  if (laser) {
    if (colorChannels.length === 2 && out[base + colorChannels[0].offset] === undefined) {
      for (const c of colorChannels) out[base + c.offset] = 255; // gates ouvertes
    }
    const modeIdx = channels.findIndex(
      (c) => /^(mode|mode\s*select|mode\s*selection|program|show\s*mode)$/i.test(c.name || '') && (c.capabilities?.length ?? 0) > 0,
    );
    if (modeIdx >= 0) {
      const caps = channels[modeIdx].capabilities ?? [];
      const cap = caps.find((c) => /dmx|dynamic|manual/i.test(c.name || ''))
        ?? caps.find((c) => c.max >= 192)
        ?? caps[0];
      if (cap) out[base + modeIdx] = Math.round((cap.min + cap.max) / 2);
    }
  }

  return out;
}

/**
 * Send channel values to hardware AND mirror them into the appStore
 * so the 3D view shows exactly what the hardware receives.
 * `sourceId` names the output-arbiter source so priorities apply.
 */
export async function sendChannelsToHardwareAndStore(
  channelValues: Record<number, number>,
  patchedFixtures: PatchedFixture[],
  universes: UniverseInfo[],
  sourceId: string = 'design-test',
  transientMs?: number,
): Promise<void> {
  try { await sendChannelsToHardware(channelValues, patchedFixtures, universes, sourceId, transientMs); } catch {}
  const dispatched = dispatchChannelsByFixture(channelValues, patchedFixtures, universes);
  for (const [uniNum, vals] of dispatched.entries()) {
    try { useAppStore.getState().setUniverseData(uniNum, vals); } catch {}
  }
}

/**
 * Turn a single patched fixture ON (dimmer max + white) on the real hardware
 * and mirror the values into the appStore so the 3D view lights up too.
 */
export async function sendFixtureOn(
  pf: PatchedFixture,
  channels: { name: string; type: string; capabilities?: { min: number; max: number; name?: string; color?: string }[] }[],
  patchedFixtures: PatchedFixture[],
  universes: UniverseInfo[],
): Promise<void> {
  const values = buildFixtureOnChannelValues(pf, channels);
  // Pan/Tilt jamais écrits (buffer frais : pas d'autoscript, pas de Target)
  // → centrer à 128. Sinon pan=0 = rotation -270° (mapping ±270°) : le faisceau
  // part « vers la gauche » en 3D ET sur le matériel réel. Si l'utilisateur a
  // visé (valeur live présente, même 0 = fond gauche volontaire), on ne touche
  // pas — le commentaire de buildFixtureOnChannelValues reste vrai.
  // NB : on lit UNIQUEMENT le bridge arbitré (Record creux 1-based : absence =
  // jamais écrit). Le miroir appStore est un Uint8Array dense dont les 0 ne
  // veulent rien dire — s'en servir ferait échouer le centrage.
  const uniIdx0 = universes.findIndex((u) => u.id === pf.universeId);
  const arb = uniIdx0 >= 0 ? dmxBridge.getChannels(uniIdx0) : undefined;
  const panTiltOffsets: number[] = [];
  channels.forEach((ch, i) => {
    if ((ch.type === 'Pan' || ch.type === 'Tilt') && !/\bfine\b/i.test(ch.name || '')) {
      panTiltOffsets.push(i);
    }
  });
  for (const off of panTiltOffsets) {
    const addr = pf.startAddress + off;
    if (values[addr] !== undefined) continue;
    const live = arb && typeof arb[addr] === 'number' ? arb[addr] : undefined;
    if (live === undefined) values[addr] = 128;
  }
  if (Object.keys(values).length === 0) return;
  fixtureTestState.set(pf.id, values);
  try { await sendChannelsToHardware(values, patchedFixtures, universes, 'fixture-onoff'); } catch {}
  const uniIdx = universes.findIndex((u) => u.id === pf.universeId);
  if (uniIdx >= 0) {
    try { useAppStore.getState().setUniverseData(uniIdx, values); } catch {}
  }
}

/**
 * Turn a single patched fixture OFF: zero every DMX channel it owns (hardware + store)
 * and remove its test override so the engine/3D take back control.
 */
export async function sendFixtureOff(
  pf: PatchedFixture,
  patchedFixtures: PatchedFixture[],
  universes: UniverseInfo[],
): Promise<void> {
  fixtureTestState.clear(pf.id);
  const zeros: Record<number, number> = {};
  for (let a = pf.startAddress; a < pf.startAddress + pf.channelCount; a++) zeros[a] = 0;
  // Transient: zeros flush the fixture, then the source is released so the
  // engine can light it again (a persistent LTP zero block would pin it off).
  try { await sendChannelsToHardware(zeros, patchedFixtures, universes, 'fixture-onoff', 2000); } catch {}
  const uniIdx = universes.findIndex((u) => u.id === pf.universeId);
  if (uniIdx >= 0) {
    try { useAppStore.getState().setUniverseData(uniIdx, zeros); } catch {}
  }
}
