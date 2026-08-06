/**
 * DMX Bridge — direct dmx-playback → Stage3D communication.
 * Bypasses the Zustand store entirely for pan/tilt sync.
 */
type DmxListener = (universe: number, channels: Record<number, number>) => void;

const listeners = new Set<DmxListener>();

export const dmxBridge = {
  /** Called by dmx-playback.ts after computing DMX values */
  push(universe: number, channels: Record<number, number>) {
    for (const fn of listeners) {
      try { fn(universe, channels); } catch (_) { /* ignore */ }
    }
  },

  /** Called by Stage3D to receive DMX pushes */
  onPush(fn: DmxListener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
