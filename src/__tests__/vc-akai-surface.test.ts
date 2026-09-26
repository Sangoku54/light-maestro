/**
 * Preset de page « surface Akai » de la Console Virtuelle.
 *
 * Valide le constructeur pur (`buildAkaiSurfaceWidgets`) puis l'action store
 * `vcAddAkaiSurfacePage` : grille alignée sur 20 px, actions pré-programmées
 * (scènes / chasers / Blackout / boucles auto / GM / canaux DMX) et liens frame.
 */
import { describe, it, expect } from 'vitest';
import { buildAkaiSurfaceWidgets, type AkaiSurfacePreset } from '../stores/vc-presets';
import type { LoopRecipe } from '../engine/auto-loops';
import type { ConsoleWidget } from '../stores/performStore';

const loop = (name: string): LoopRecipe => ({
  kind: 'movement',
  name,
  tier: 'primary',
  speedBpm: 120,
  direction: 'forward',
});

const makePreset = (over: Partial<AkaiSurfacePreset> = {}): AkaiSurfacePreset => ({
  scenes: [
    { id: 's1', name: 'Ouverture' },
    { id: 's2', name: 'Couleur' },
    { id: 's3', name: 'Ambiance' },
  ],
  chasers: [{ id: 'c1', name: 'Wash' }],
  loops: [loop('Cercle'), loop('Zigzag')],
  ...over,
});

const counter = () => {
  let n = 0;
  return () => `w-${n++}`;
};

describe('surface Akai (preset de page Console Virtuelle)', () => {
  const widgets = buildAkaiSurfaceWidgets(makePreset(), 4, counter());
  const frame = widgets[0];
  const pads = widgets.filter((w) => w.type === 'button');
  const faders = widgets.filter((w) => w.type === 'slider');

  it('construit 1 frame + 24 pads + 8 faders, tous rattachés à la page et à la frame', () => {
    expect(widgets).toHaveLength(33);
    expect(frame.type).toBe('frame');
    expect(pads).toHaveLength(24);
    expect(faders).toHaveLength(8);

    const ids = new Set(widgets.map((w) => w.id));
    expect(ids.size).toBe(widgets.length);

    for (const w of widgets) expect(w.pageIndex).toBe(4);
    for (const w of widgets.slice(1)) expect(w.frameId).toBe(frame.id);
    expect(frame.frameId).toBeUndefined();
  });

  it('grille alignée sur 20 px et contenu dans la frame (accroche vcGridSnap)', () => {
    for (const w of widgets) {
      expect(w.x % 20).toBe(0);
      expect(w.y % 20).toBe(0);
      expect(w.x).toBeGreaterThanOrEqual(frame.x);
      expect(w.y).toBeGreaterThanOrEqual(frame.y);
      expect(w.x + w.width).toBeLessThanOrEqual(frame.x + frame.width);
      expect(w.y + w.height).toBeLessThanOrEqual(frame.y + frame.height);
    }
  });

  it('rangée 1 = scènes (ids dans l’ordre, repli étiqueté sans scène)', () => {
    const row = pads.filter((w) => w.y === 40);
    expect(row).toHaveLength(8);
    expect(row[0].config).toMatchObject({ actionType: 'scene', sceneId: 's1', label: 'Ouverture' });
    expect(row[1].config.sceneId).toBe('s2');
    expect(row[2].config.sceneId).toBe('s3');
    // 5 pads restants : action scène prête à être assignée
    expect(row[3].config.actionType).toBe('scene');
    expect(row[3].config.sceneId).toBeUndefined();
    expect(row[3].config.label).toBe('Scène 4');
  });

  it('rangée 2 = chasers', () => {
    const row = pads.filter((w) => w.y === 100);
    expect(row).toHaveLength(8);
    expect(row[0].config).toMatchObject({ actionType: 'chaser', chaserId: 'c1', label: 'Wash' });
    expect(row[1].config.actionType).toBe('chaser');
    expect(row[1].config.chaserId).toBeUndefined();
  });

  it('rangée 3 = Blackout + boucles auto, puis touches libres faute de catalogue', () => {
    const row = pads.filter((w) => w.y === 160);
    expect(row).toHaveLength(8);
    expect(row[0].config).toMatchObject({ actionType: 'blackout', label: 'Blackout' });
    expect(row[1].config).toMatchObject({ actionType: 'autoLoop', label: 'Cercle' });
    expect(row[2].config).toMatchObject({ actionType: 'autoLoop', label: 'Zigzag' });
    expect(row[3].config.actionType).toBeUndefined();
    expect(row[3].config.label).toBe('Libre 3');

    const withoutLoops = buildAkaiSurfaceWidgets(makePreset({ loops: [] }), 0, counter());
    const emptyRow = withoutLoops.filter((w) => w.type === 'button' && w.y === 160);
    expect(emptyRow[1].config.actionType).toBeUndefined();
    expect(emptyRow[1].config.label).toBe('Libre 1');
  });

  it('faders : GM en premier, puis les canaux DMX 1..7 de l’univers 0', () => {
    expect(faders).toHaveLength(8);
    expect(faders[0].config).toMatchObject({ sliderFunction: 'grandMaster', label: 'GM' });
    for (let i = 1; i <= 7; i++) {
      expect(faders[i].config).toMatchObject({
        sliderFunction: 'channel',
        channelAddress: i,
        sliderUniverse: 0,
        label: `Ch ${i}`,
      });
    }
    for (const f of faders) {
      expect(f.y).toBe(220);
      expect(f.config.min).toBe(0);
      expect(f.config.max).toBe(255);
    }
  });

  it('action store : crée la page, l’active et pousse les widgets', () => {
    // Import tardif : le store utilise zustand/persist (couvert par la suite).
    return import('../stores/performStore').then(({ usePerformStore }) => {
      const before = usePerformStore.getState();
      const index = usePerformStore.getState().vcAddAkaiSurfacePage(makePreset());
      const after = usePerformStore.getState();

      expect(index).toBe(before.vcPages.length);
      expect(after.vcPages[index].name).toBe('Akai MIDIMIX');
      expect(after.vcActivePage).toBe(index);

      const added: ConsoleWidget[] = after.vcWidgets.filter((w) => w.pageIndex === index);
      expect(added).toHaveLength(33);
      expect(added[0].type).toBe('frame');
    });
  });
});
