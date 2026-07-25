/**
 * DMX Helpers — Universe-aware channel dispatch.
 *
 * Instead of hardcoding setChannels(0, ...), this dispatches DMX values
 * to the correct universe based on where each fixture is patched.
 */

import type { PatchedFixture } from '../stores/showStore';

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
