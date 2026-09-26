/**
 * Projet démo embarqué (`resources/demo/Light-Maestro-Demo.lmproj`,
 * construit par `node scripts/build-demo.mjs` depuis `LM/Yolo.lmproj`).
 *
 * Garanties vitrine :
 *  - aucun laser (ni fixture, ni scène, ni canal DMX dans leurs plages) ;
 *  - preset "1-Waiting" présent avec son audio embarqué résolvable ;
 *  - aucune référence pendante (scènes, chaser, show, groupes, tuiles) ;
 *  - customFixtures au format tableau attendu par `importCustomFixtureDefs`.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { unpackProject } from '@electron/project-envelope';

const DEMO_PATH = path.join(__dirname, '..', '..', 'resources', 'demo', 'Light-Maestro-Demo.lmproj');

async function loadDemo(): Promise<{ data: any; blobs: Array<{ key: string; audioFileBase64: string }> }> {
  const { content, blobs } = await unpackProject(DEMO_PATH);
  return { data: JSON.parse(content), blobs };
}

describe('projet démo embarqué', () => {
  it('existe et se dépaquette (enveloppe binaire autonome)', async () => {
    expect(fs.existsSync(DEMO_PATH)).toBe(true);
    const { data, blobs } = await loadDemo();
    expect(data.schemaVersion).toBe(1);
    expect(blobs.length).toBeGreaterThan(0);
  });

  it('aucun laser : ni fixture, ni scène, ni canal dans leurs plages', async () => {
    const { data } = await loadDemo();
    const ss = data.showStore;
    for (const f of ss.patchedFixtures) {
      expect(f.fixtureDefId).not.toMatch(/laser/i);
      expect(f.name ?? '').not.toMatch(/laser/i);
    }
    for (const s of ss.scenes) {
      expect(s.name ?? '').not.toMatch(/laser/i);
      for (const addr of Object.keys(s.channels ?? {})) {
        const a = Number(addr);
        // Plages Yolo des 2 lasers retirés : 240-249 et 260-275
        expect(a < 240 || a > 249, `canal laser ${a} dans ${s.name}`).toBe(true);
        expect(a < 260 || a > 275, `canal laser ${a} dans ${s.name}`).toBe(true);
      }
    }
    expect(ss.patchedFixtures.length).toBe(11);
    expect(ss.scenes.length).toBe(6);
  });

  it('preset 1-Waiting présent, avec audio embarqué résolvable', async () => {
    const { data, blobs } = await loadDemo();
    const presets = data.showStore.songPresets;
    expect(presets.length).toBe(1);
    expect(presets[0].name).toBe('1-Waiting');
    expect(typeof presets[0].audioRef).toBe('string');
    const blob = blobs.find((b) => b.key === presets[0].audioRef);
    expect(blob, 'blob audio du preset').toBeDefined();
    expect(blob!.audioFileBase64.length).toBeGreaterThan(1_000_000);
  });

  it('aucune référence pendante (chaser, show, groupes, tuiles, positions)', async () => {
    const { data } = await loadDemo();
    const ss = data.showStore;
    const sceneIds = new Set(ss.scenes.map((s: any) => s.id));
    const fixtureIds = new Set(ss.patchedFixtures.map((f: any) => f.id));
    for (const c of ss.chasers) {
      for (const st of c.steps ?? []) expect(sceneIds.has(st.sceneId)).toBe(true);
    }
    for (const sh of ss.shows ?? []) {
      for (const t of sh.tracks ?? []) {
        for (const item of t.items ?? []) {
          if (item.resourceId) expect(sceneIds.has(item.resourceId)).toBe(true);
        }
      }
    }
    for (const g of ss.fixtureGroups ?? []) {
      for (const id of [...(g.fixtureIds ?? []), ...(g.fixtures ?? [])]) {
        expect(fixtureIds.has(id), `groupe ${g.name}`).toBe(true);
      }
    }
    for (const id of Object.keys(ss.fixturePositions ?? {})) {
      expect(fixtureIds.has(id), `position ${id}`).toBe(true);
    }
    const presetNames = new Set(ss.songPresets.map((p: any) => p.name));
    for (const w of data.vcWidgets ?? []) {
      if (w?.config?.actionType === 'playSong') {
        expect(presetNames.has(w.config.songName), `tuile ${w.id}`).toBe(true);
      }
      if (w?.config?.actionType === 'scene') {
        expect(sceneIds.has(w.config.sceneId), `tuile ${w.id}`).toBe(true);
      }
    }
  });

  it('customFixtures au format tableau attendu par importCustomFixtureDefs', async () => {
    const { data } = await loadDemo();
    expect(Array.isArray(data.customFixtures)).toBe(true);
    expect(data.customFixtures.length).toBe(5);
    const defIds = new Set((data.showStore.patchedFixtures as any[]).map((f) => f.fixtureDefId));
    for (const id of defIds) {
      expect(
        data.customFixtures.some((d: any) => d?.id === id),
        `def embarquée ${id}`,
      ).toBe(true);
    }
  });
});
