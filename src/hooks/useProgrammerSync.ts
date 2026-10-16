import { useEffect } from 'react';
import { useProgrammerStore } from '../stores/programmerStore';
import { useShowStore } from '../stores/showStore';
import { dmxBridge } from '../utils/dmx-bridge';
import { dispatchChannelsByFixture } from '../utils/dmx-helpers';

// Source LTP 85 : programmer seen violet au-dessus de VC 80, sous SimpleDesk 100
try { dmxBridge.registerSource('programmer', 'ltp', 85); } catch {}

export function useProgrammerSync() {
  const channels = useProgrammerStore((s) => s.channels);
  const patchedFixtures = useShowStore((s) => s.patchedFixtures);
  const universes = useShowStore((s) => s.universes);

  useEffect(() => {
    if (Object.keys(channels).length === 0) {
      dmxBridge.release('programmer');
      return;
    }
    const dispatched = dispatchChannelsByFixture(channels, patchedFixtures as any, universes as any);
    for (const [uniStr, vals] of dispatched.entries()) {
      const uni = Number(uniStr);
      if (Object.keys(vals).length > 0) dmxBridge.write('programmer', uni, vals);
      else dmxBridge.release('programmer', uni);
    }
    // also release universes that no longer have data
    const active = new Set([...dispatched.keys()].map(Number));
    for (let u = 0; u < universes.length; u++) {
      if (!active.has(u)) dmxBridge.release('programmer', u);
    }
  }, [channels, patchedFixtures, universes]);

  // Re-push programmer state on mount in case clearAll() was called
  // (e.g. Stage3D remount after tab switch or modal open/close).
  // This ensures the bridge keeps its values even when no fader moved.
  useEffect(() => {
    const prog = useProgrammerStore.getState();
    if (Object.keys(prog.channels).length === 0) {
      dmxBridge.release('programmer');
      return;
    }
    const dispatched = dispatchChannelsByFixture(prog.channels, patchedFixtures as any, universes as any);
    for (const [uniStr, vals] of dispatched.entries()) {
      const uni = Number(uniStr);
      if (Object.keys(vals).length > 0) dmxBridge.write('programmer', uni, vals);
    }
  }, [patchedFixtures, universes]);
}
