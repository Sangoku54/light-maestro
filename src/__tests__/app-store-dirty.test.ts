import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../stores/appStore';

describe('appStore dirty tracking (quit save reminder)', () => {
  beforeEach(() => {
    useAppStore.getState().markClean();
  });

  it('markDirty sets isDirty and a monotonic dirtyAt timestamp', () => {
    const before = useAppStore.getState().dirtyAt;
    useAppStore.getState().markDirty();
    const st = useAppStore.getState();
    expect(st.isDirty).toBe(true);
    expect(st.dirtyAt).toBeGreaterThanOrEqual(before);
  });

  it('markClean resets both isDirty and dirtyAt', () => {
    useAppStore.getState().markDirty();
    useAppStore.getState().markClean();
    const st = useAppStore.getState();
    expect(st.isDirty).toBe(false);
    expect(st.dirtyAt).toBe(0);
  });

  it('a new markDirty after clean bumps dirtyAt above the previous snapshot', () => {
    useAppStore.getState().markDirty();
    const first = useAppStore.getState().dirtyAt;
    useAppStore.getState().markClean();
    useAppStore.getState().markDirty();
    expect(useAppStore.getState().dirtyAt).toBeGreaterThanOrEqual(first);
  });
});
