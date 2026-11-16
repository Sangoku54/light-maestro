import { beforeEach, describe, expect, it } from 'vitest';
import { useShowStore, type SavedScene } from '../stores/showStore';
import { normalizeRoster, rosterFromBandConfig, rosterTotal, isRosterEmpty } from '../utils/musicians';

// Regression guard for the 3D stage config persistence (musician roster +
// truss layout). The bug: the 3D view always reverted to a fixed "quintet"
// because the free-form roster was never written to the scene.
describe('scene 3D musician roster persistence', () => {
  beforeEach(() => {
    useShowStore.setState({ scenes: [] });
  });

  it('persists musicians roster + stageScene through updateScene', () => {
    const id = useShowStore.getState().createScene('Solo arrière');
    useShowStore.getState().updateScene(id, {
      musicians: { chanteuse: 1 },
      stageScene: 'rear',
    });

    const saved = useShowStore.getState().getScene(id);
    expect(saved?.musicians).toEqual({ chanteuse: 1 });
    expect(saved?.stageScene).toBe('rear');
  });

  it('updateScene on other fields does not clobber the roster', () => {
    const id = useShowStore.getState().createScene('Groupe');
    useShowStore.getState().updateScene(id, {
      musicians: { chanteur: 1, guitariste: 2, cuivre: 1 },
      stageScene: 'full',
    });
    useShowStore.getState().updateScene(id, { name: 'Renommée', fadeIn: 500 });

    const saved = useShowStore.getState().getScene(id);
    expect(saved?.name).toBe('Renommée');
    expect(saved?.musicians).toEqual({ chanteur: 1, guitariste: 2, cuivre: 1 });
    expect(saved?.stageScene).toBe('full');
  });

  it('survives a JSON round-trip (project save / load)', () => {
    const id = useShowStore.getState().createScene('Groupe');
    useShowStore.getState().updateScene(id, {
      musicians: { chanteuse: 1, batteur: 1 },
      stageScene: 'rear',
    });

    const serialized = JSON.stringify({ scenes: useShowStore.getState().scenes });
    const parsed = JSON.parse(serialized) as { scenes: SavedScene[] };
    useShowStore.setState({ scenes: parsed.scenes });

    const restored = useShowStore.getState().getScene(id);
    expect(restored?.musicians).toEqual({ chanteuse: 1, batteur: 1 });
    expect(restored?.stageScene).toBe('rear');
  });

  it('old scenes without the roster read as undefined (backward compat)', () => {
    const id = useShowStore.getState().createScene('Ancienne');
    expect(useShowStore.getState().getScene(id)?.musicians).toBeUndefined();
  });
});

describe('musician roster helpers', () => {
  it('normalizeRoster clamps and drops zero/negative counts', () => {
    expect(normalizeRoster({ chanteur: 2, guitariste: 0, batteur: -1, cuivre: 1.9 })).toEqual({
      chanteur: 2,
      cuivre: 1,
    });
  });

  it('rosterFromBandConfig migrates the old presets', () => {
    expect(rosterFromBandConfig('quintet')).toEqual({
      chanteur: 1,
      guitariste: 1,
      bassiste: 1,
      batteur: 1,
      clavier: 1,
    });
    expect(rosterFromBandConfig('solo-chanteuse')).toEqual({ chanteuse: 1 });
    expect(rosterFromBandConfig(undefined)).toEqual({});
    expect(rosterFromBandConfig('unknown')).toEqual({});
  });

  it('rosterTotal and isRosterEmpty reflect the counts', () => {
    expect(rosterTotal({ chanteur: 1, batteur: 2 })).toBe(3);
    expect(rosterTotal({})).toBe(0);
    expect(isRosterEmpty({})).toBe(true);
    expect(isRosterEmpty(undefined)).toBe(true);
    expect(isRosterEmpty({ chanteur: 1 })).toBe(false);
  });
});
