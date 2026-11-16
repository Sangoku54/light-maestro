/**
 * Fixture Test State - module-level override for the "Allumer" (light ON) button.
 *
 * The DMX playback engine overwrites the appStore channelData every frame
 * (~30fps), so a one-shot test value pushed to the store is wiped almost
 * immediately. This module keeps the test state alive independently of the
 * engine: Stage3D reads it in its render loop and applies it on top of the
 * engine values, so the selected fixture stays visibly ON in the 3D view.
 */

export type FixtureTestValues = Record<number, number>; // DMX address (1-based) -> 0-255

const _onState = new Map<string, FixtureTestValues>();

export const fixtureTestState = {
  set(fixtureId: string, values: FixtureTestValues): void {
    _onState.set(fixtureId, values);
  },
  clear(fixtureId: string): void {
    _onState.delete(fixtureId);
  },
  get(fixtureId: string): FixtureTestValues | undefined {
    return _onState.get(fixtureId);
  },
  has(fixtureId: string): boolean {
    return _onState.has(fixtureId);
  },
  clearAll(): void {
    _onState.clear();
  },
};
