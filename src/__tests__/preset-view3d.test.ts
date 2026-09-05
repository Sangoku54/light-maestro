import { beforeEach, describe, expect, it } from 'vitest';
import { useShowStore, type SongPreset, type View3DState } from '../stores/showStore';

/**
 * Regression guard for the per-preset 3D view state.
 *
 * The bug: opening the floating Stage3D view, configuring the camera (drag,
 * preset buttons), toggling beams / smoke / direct mode, then saving the
 * preset did not persist any of that. Reloading the preset snapped the camera
 * back to the hardcoded "audience" preset.
 *
 * The fix: `SongPreset.view3D` carries `cameraPosition`, `cameraTarget`, and
 * the toolbar toggles through the same .lmpreset round-trip as musicians /
 * stageScene.
 */
describe('preset 3D view state persistence', () => {
  beforeEach(() => {
    useShowStore.setState({ songPresets: [] });
  });

  it('persists view3D through setSongPresets (save path)', () => {
    const view3D: View3DState = {
      cameraPosition: [1.2, 4.5, -3.0],
      cameraTarget: [0, 2.0, 0],
      showBeams: false,
      showSmoke: true,
      showLabels: false,
      directMode: true,
    };
    const preset: SongPreset = {
      id: 'test-1',
      name: 'TestPreset',
      audioFileName: 'song.mp3',
      dmxCues: [],
      quickShow: {},
      trackAnalysis: null,
      sections: [],
      view3D,
      createdAt: new Date().toISOString(),
    };
    useShowStore.getState().setSongPresets([preset]);

    const stored = useShowStore.getState().songPresets[0];
    expect(stored.view3D).toEqual(view3D);
  });

  it('updateSongPreset merges view3D without clobbering other fields', () => {
    const initial: SongPreset = {
      id: 'test-2',
      name: 'TestPreset2',
      audioFileName: 'song.mp3',
      dmxCues: [],
      quickShow: { foo: 'bar' },
      trackAnalysis: null,
      sections: [],
      createdAt: new Date().toISOString(),
    };
    useShowStore.getState().setSongPresets([initial]);

    useShowStore.getState().updateSongPreset('test-2', {
      view3D: { cameraPosition: [0, 5, 0], cameraTarget: [0, 1.5, 0], showBeams: false },
    });

    const stored = useShowStore.getState().songPresets[0];
    expect(stored.view3D?.cameraPosition).toEqual([0, 5, 0]);
    expect(stored.view3D?.showBeams).toBe(false);
    expect(stored.quickShow).toEqual({ foo: 'bar' });
  });

  it('survives a JSON round-trip (project save / load)', () => {
    const view3D: View3DState = {
      cameraPosition: [2.0, 3.0, -4.0],
      cameraTarget: [0.5, 1.5, 0.2],
      showBeams: true,
      showSmoke: false,
      showLabels: true,
      directMode: false,
    };
    const preset: SongPreset = {
      id: 'test-3',
      name: 'RoundTrip',
      audioFileName: 'song.mp3',
      dmxCues: [],
      quickShow: {},
      trackAnalysis: null,
      sections: [],
      view3D,
      createdAt: new Date().toISOString(),
    };
    useShowStore.getState().setSongPresets([preset]);

    const serialized = JSON.stringify({ songPresets: useShowStore.getState().songPresets });
    const parsed = JSON.parse(serialized) as { songPresets: SongPreset[] };
    useShowStore.setState({ songPresets: parsed.songPresets });

    const restored = useShowStore.getState().songPresets[0];
    expect(restored.view3D).toEqual(view3D);
  });

  it('old presets without view3D read as undefined (backward compat)', () => {
    const oldPreset: SongPreset = {
      id: 'legacy',
      name: 'Legacy',
      audioFileName: 'song.mp3',
      dmxCues: [],
      quickShow: {},
      trackAnalysis: null,
      sections: [],
      createdAt: new Date().toISOString(),
    };
    useShowStore.getState().setSongPresets([oldPreset]);

    expect(useShowStore.getState().songPresets[0].view3D).toBeUndefined();
  });

  it('partial view3D (only camera) does not require toolbar fields', () => {
    // User could persist just the camera and skip the toggles — that's fine,
    // toggles will fall back to Stage3D's local defaults.
    const partial: View3DState = {
      cameraPosition: [0, 8, 4],
      cameraTarget: [0, 1.5, 0],
    };
    const preset: SongPreset = {
      id: 'partial',
      name: 'Partial',
      audioFileName: 'song.mp3',
      dmxCues: [],
      quickShow: {},
      trackAnalysis: null,
      sections: [],
      view3D: partial,
      createdAt: new Date().toISOString(),
    };
    useShowStore.getState().setSongPresets([preset]);
    const restored = useShowStore.getState().songPresets[0].view3D;
    expect(restored?.cameraPosition).toEqual([0, 8, 4]);
    expect(restored?.cameraTarget).toEqual([0, 1.5, 0]);
    expect(restored?.showBeams).toBeUndefined();
  });
});