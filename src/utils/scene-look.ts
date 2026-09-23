/**
 * Look capture / ensure — dimmer, couleur, shutter, strobe pour une fixture.
 *
 * Bug « tuile créée mais rien ne joue » : Target n'écrivait que pan/tilt →
 * la scène rejouée avait intensity=0 → faisceau invisible en 3D et sur le
 * matériel. Ces helpers forcent un look minimal quand le live est muet
 * (dimmer 255, blanc, shutter ouvert, strobe 0) — logique identique à la
 * réplique `targetAim` de target-scene-save.test.ts.
 */
import type { PatchedFixture } from '../stores/showStore';
import { useShowStore } from '../stores/showStore';
import { dmxBridge } from './dmx-bridge';
import { useAppStore } from '../stores/appStore';

export interface LookChannelMap {
  intensityOffset?: number | null;
  rgbOffsets?: number[] | null;
  wheelOffset?: number | null;
  wheelCaps?: Array<{ color?: string; min: number; max: number }> | null;
  strobeOffset?: number | null;
  shutterOffset?: number | null;
}

/** Lecture d'un canal live : buffer arbitré dmxBridge d'abord, miroir appStore ensuite. */
export function readLiveChannel(
  pf: Pick<PatchedFixture, 'universeId' | 'startAddress'>,
  absAddr: number,
): number | undefined {
  const universes = useShowStore.getState().universes ?? [];
  const uniIdx = universes.findIndex((u) => String(u.id) === String(pf.universeId));
  if (uniIdx < 0) return undefined;
  const arb = dmxBridge.getChannels(uniIdx);
  if (arb && typeof arb[absAddr] === 'number') return arb[absAddr];
  try {
    const channelData = useAppStore.getState().dmx?.channelData as
      | Record<number, Uint8Array | number[]>
      | undefined;
    const buf = channelData?.[uniIdx];
    if (buf) {
      const idx = absAddr - 1;
      const v = idx >= 0 && idx < buf.length ? buf[idx] : undefined;
      if (typeof v === 'number') return v;
    }
  } catch {}
  return undefined;
}

function midOfCap(cap: { min: number; max: number }): number {
  return Math.round((cap.min + cap.max) / 2);
}

function findWhiteWheelCap(cm: LookChannelMap): { min: number; max: number } | null {
  const caps = cm.wheelCaps ?? [];
  const white = caps.find((c) => {
    const n = (c.color ?? '').toLowerCase();
    return n === 'white' || n === 'open' || /^#fff/i.test(n);
  });
  return white ?? (caps.length > 0 ? caps[0] : null);
}

/**
 * Capture le look (dimmer/couleur/strobe/shutter) d'une fixture dans `channels`.
 * - dimmer : live > 0 sinon 255 (scène visible malgré un live éteint)
 * - RGB : copie le live si non nul, sinon blanc 255/255/255
 * - roue : live sinon cap blanc/ouvert (ou 255)
 * - strobe : live sinon 0 (pas de strobe permanent)
 * - shutter : live ouvert sinon 255
 *
 * N'écrit QUE si l'offset existe dans le channelMap. Ne touche pas pan/tilt.
 */
export function captureFixtureLook(
  channels: Record<number, number>,
  pf: Pick<PatchedFixture, 'universeId' | 'startAddress'>,
  cm: LookChannelMap,
  live?: Record<number, number>,
): void {
  const base = pf.startAddress;
  const readLive = (off: number): number | undefined => {
    const abs = base + off;
    if (live && typeof live[abs] === 'number') return live[abs];
    return readLiveChannel(pf, abs);
  };

  if (cm.intensityOffset !== null && cm.intensityOffset !== undefined && cm.intensityOffset >= 0) {
    const v = readLive(cm.intensityOffset) ?? 0;
    channels[base + cm.intensityOffset] = v > 0 ? v : 255;
  }
  if (cm.rgbOffsets && cm.rgbOffsets.length > 0) {
    const any = cm.rgbOffsets.some((o) => (readLive(o) ?? 0) > 0);
    for (const o of cm.rgbOffsets) channels[base + o] = any ? (readLive(o) ?? 0) : 255;
  } else if (cm.wheelOffset !== null && cm.wheelOffset !== undefined && cm.wheelOffset >= 0) {
    const v = readLive(cm.wheelOffset) ?? 0;
    let wv = v;
    if (v <= 2) {
      const white = findWhiteWheelCap(cm);
      wv = white ? midOfCap(white) : 255;
    }
    channels[base + cm.wheelOffset] = wv;
  }
  if (cm.strobeOffset !== null && cm.strobeOffset !== undefined && cm.strobeOffset >= 0) {
    channels[base + cm.strobeOffset] = readLive(cm.strobeOffset) ?? 0;
  }
  if (cm.shutterOffset !== null && cm.shutterOffset !== undefined && cm.shutterOffset >= 0) {
    const v = readLive(cm.shutterOffset) ?? 255;
    channels[base + cm.shutterOffset] = v > 31 ? v : 255;
  }
}

/**
 * Garantit qu'une fixture touchée par `channels` (pan/tilt Target, faders…)
 * a bien une intensité exploitable — sinon la scène « ne lance rien ».
 * Si intensityOffset existe et vaut 0 (ou est absent), force 255 sauf si le
 * live porte déjà une valeur > 0. Idem shutter fermé → ouvert.
 *
 * Appelé par Store (ProgrammerBar) et Rec (Stage3D) avant de figer la scène.
 */
export function ensureFixtureLook(
  channels: Record<number, number>,
  pf: PatchedFixture,
  cm: LookChannelMap | null | undefined,
): void {
  if (!cm) return;
  const base = pf.startAddress;
  const end = base + pf.channelCount;
  let touched = false;
  for (const k of Object.keys(channels)) {
    const a = Number(k);
    if (a >= base && a < end) { touched = true; break; }
  }
  if (!touched) return;

  if (cm.intensityOffset !== null && cm.intensityOffset !== undefined && cm.intensityOffset >= 0) {
    const addr = base + cm.intensityOffset;
    const cur = channels[addr];
    if (cur === undefined || cur === 0) {
      const liveV = readLiveChannel(pf, addr);
      channels[addr] = liveV && liveV > 0 ? liveV : 255;
    }
  } else if (cm.rgbOffsets && cm.rgbOffsets.length > 0) {
    // Fixture sans dimmer (RGB only) : forcer du signal si tout est à 0.
    const anyRgb = cm.rgbOffsets.some((o) => (channels[base + o] ?? 0) > 0);
    if (!anyRgb) {
      const liveAny = cm.rgbOffsets.some((o) => {
        const v = readLiveChannel(pf, base + o);
        return !!v && v > 0;
      });
      if (!liveAny) {
        for (const o of cm.rgbOffsets) channels[base + o] = 255;
      }
    }
  }

  if (cm.shutterOffset !== null && cm.shutterOffset !== undefined && cm.shutterOffset >= 0) {
    const addr = base + cm.shutterOffset;
    const cur = channels[addr];
    if (cur !== undefined && cur <= 31) channels[addr] = 255;
    else if (cur === undefined) {
      const liveV = readLiveChannel(pf, addr);
      if (liveV === undefined || liveV <= 31) channels[addr] = 255;
    }
  }
}

/** Map fixtureId → channelMap pour ensureFixtureLook côté Store/Rec. */
export function getFixtureChannelMaps(): Map<string, LookChannelMap> {
  const m = (globalThis as any).__lm_fixtureChannelMaps as
    | Map<string, LookChannelMap>
    | undefined;
  return m instanceof Map ? m : new Map();
}

/** Publié par Stage3D quand les fixtures 3D sont reconstruites. */
export function setFixtureChannelMaps(map: Map<string, LookChannelMap>): void {
  (globalThis as any).__lm_fixtureChannelMaps = map;
}
