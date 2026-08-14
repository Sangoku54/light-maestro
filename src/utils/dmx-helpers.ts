/**
 * DMX Helpers — Universe-aware channel dispatch.
 *
 * Instead of hardcoding setChannels(0, ...), this dispatches DMX values
 * to the correct universe based on where each fixture is patched.
 */

import type { PatchedFixture } from '../stores/showStore';
import { useAppStore } from '../stores/appStore';
import { fixtureTestState } from './fixture-test-state';

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
 * Send channel values to all relevant DMX universes based on fixture patch.
 */
export async function sendChannelsToHardware(
  channelValues: Record<number, number>,
  patchedFixtures: PatchedFixture[],
  universes: UniverseInfo[],
): Promise<void> {
  const dmx = (window as any).lightMaestro?.dmx;
  if (!dmx) return;

  // dmx.setChannels IPC handler auto-starts the engine if needed and silently
  // creates any missing universes — no need for explicit start/register calls
  if (patchedFixtures.length > 0 && universes.length > 0) {
    const dispatched = dispatchChannelsByFixture(channelValues, patchedFixtures, universes);
    for (const [uniNum, vals] of dispatched.entries()) {
      try { await dmx.setChannels(uniNum, vals); } catch {}
    }
  } else {
    // Direct output — no fixtures patched, send to universe 0
    try { await dmx.setChannels(0, channelValues); } catch {}
  }
}

/**
 * Send to a single universe — useful for Simple Desk (per-universe).
 */
export async function sendToUniverse(
  uniNum: number,
  channelValues: Record<number, number>,
): Promise<void> {
  const dmx = (window as any).lightMaestro?.dmx;
  if (!dmx) return;
  try { await dmx.setChannels(uniNum, channelValues); } catch {}
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

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const chName = ch.name || '';
    const hasColorCaps = ch.capabilities?.some((cap) => cap.color) ?? false;
    if (startsWithRgb.test(chName) || ch.type === 'Colour' || (ch.type === 'Beam' && hasColorWord.test(chName)) || hasColorCaps) {
      colorChannels.push({ offset: i, name: chName, caps: ch.capabilities });
      continue;
    }
    if (ch.type === 'Intensity' && intensityOffset === null) intensityOffset = i;
    else if (ch.type === 'Shutter' && shutterOffset === null) shutterOffset = i;
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
    const caps = colorChannels[0].caps?.filter((cap) => cap.color) ?? [];
    const whiteCap = caps.find((cap) => /white/i.test(cap.name || ''));
    const cap = whiteCap || caps[0];
    out[base + colorChannels[0].offset] = cap ? Math.round((cap.min + cap.max) / 2) : 0;
  }

  return out;
}

/**
 * Send channel values to hardware AND mirror them into the appStore
 * so the 3D view shows exactly what the hardware receives.
 */
export async function sendChannelsToHardwareAndStore(
  channelValues: Record<number, number>,
  patchedFixtures: PatchedFixture[],
  universes: UniverseInfo[],
): Promise<void> {
  try { await sendChannelsToHardware(channelValues, patchedFixtures, universes); } catch {}
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
  if (Object.keys(values).length === 0) return;
  fixtureTestState.set(pf.id, values);
  try { await sendChannelsToHardware(values, patchedFixtures, universes); } catch {}
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
  try { await sendChannelsToHardware(zeros, patchedFixtures, universes); } catch {}
  const uniIdx = universes.findIndex((u) => u.id === pf.universeId);
  if (uniIdx >= 0) {
    try { useAppStore.getState().setUniverseData(uniIdx, zeros); } catch {}
  }
}
