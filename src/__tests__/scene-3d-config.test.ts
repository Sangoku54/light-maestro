import { beforeEach, describe, expect, it } from 'vitest';
import { useShowStore, type SavedScene } from '../stores/showStore';

// Regression guard for the 3D stage config persistence fix (band preset +
// truss layout). The bug: the 3D view always reverted to "quintet" + all
// trusses because bandConfig/stageScene were never written to the scene.
describe('scene 3D config persistence', () => {
  beforeEach(() => {
    useShowStore.setState({ scenes: [] });
  });

  it('persists bandConfig + stageScene through updateScene', () => {
    const id = useShowStore.getState().createScene('Solo arrière');
    useShowStore.getState().updateScene(id, {
      bandConfig: 'solo-chanteuse',
      stageScene: 'rear',
    });

    const saved = useShowStore.getState().getScene(id);
    expect(saved?.bandConfig).toBe('solo-chanteuse');
    expect(saved?.stageScene).toBe('rear');
  });

  it('updateScene on other fields does not clobber the 3D config', () => {
    const id = useShowStore.getState().createScene('Solo arrière');
    useShowStore.getState().updateScene(id, { bandConfig: 'duo', stageScene: 'full' });
    useShowStore.getState().updateScene(id, { name: 'Renommée', fadeIn: 500 });

    const saved = useShowStore.getState().getScene(id);
    expect(saved?.name).toBe('Renommée');
    expect(saved?.bandConfig).toBe('duo');
    expect(saved?.stageScene).toBe('full');
  });

  it('survives a JSON round-trip (project save / load)', () => {
    const id = useShowStore.getState().createScene('Solo arrière');
    useShowStore.getState().updateScene(id, { bandConfig: 'solo-chanteuse', stageScene: 'rear' });

    // Simulate saveProject → JSON.stringify(showState) and __lm_open → setScenes(parsed.scenes)
    const serialized = JSON.stringify({ scenes: useShowStore.getState().scenes });
    const parsed = JSON.parse(serialized) as { scenes: SavedScene[] };
    useShowStore.setState({ scenes: parsed.scenes });

    const restored = useShowStore.getState().getScene(id);
    expect(restored?.bandConfig).toBe('solo-chanteuse');
    expect(restored?.stageScene).toBe('rear');
  });

  it('old scenes without the fields read as undefined (backward compat)', () => {
    const id = useShowStore.getState().createScene('Ancienne');
    const saved = useShowStore.getState().getScene(id);
    expect(saved?.bandConfig).toBeUndefined();
    expect(saved?.stageScene).toBeUndefined();
  });
});
