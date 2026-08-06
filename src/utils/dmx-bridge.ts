/**
 * DMX Bridge — direct dmx-playback → Stage3D communication.
 * Maintains a module-level cache of the latest DMX channel data
 * so Stage3D can read it directly without going through the Zustand store.
 */
type DmxListener = (universe: number, channels: Record<number, number>) => void;

const listeners = new Set<DmxListener>();

/** Module-level cache: universe → channel values (DMX address → 0-255) */
const _channelCache = new Map<number, Record<number, number>>();

export const dmxBridge = {
  /** Called by dmx-playback.ts after computing DMX values */
  push(universe: number, channels: Record<number, number>) {
    // Update cache immediately for Stage3D's render loop to pick up
    _channelCache.set(universe, channels);
    // Also notify listeners (for immediate push if needed)
    for (const fn of listeners) {
      try { fn(universe, channels); } catch (_) { /* ignore */ }
    }
  },

  /** Stage3D reads the latest channel values for a universe */
  getChannels(universe: number): Record<number, number> | undefined {
    return _channelCache.get(universe);
  },

  /** Called by Stage3D to receive DMX pushes */
  onPush(fn: DmxListener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
