/**
 * Tests du parseur OFL JSON (lot #19) — templateChannels, fine aliases,
 * defaultValue, pixelCount implicite, charge réelle de la bibliothèque.
 *
 * Le module electron/fixtures/library importe `{ app } from 'electron'` ;
 * hors Electron, `app` vaut undefined mais parseOFLFixture / loadOflDirectory
 * ne l'utilisent pas → testable tel quel (validé expérimentalement).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FixtureLibrary } from '@electron/fixtures/library';

const OFL_DIR = path.join(process.cwd(), 'resources', 'fixtures', 'ofl');

function parseFixture(mfr: string, file: string) {
  const json = fs.readFileSync(path.join(OFL_DIR, mfr, file), 'utf8');
  return new FixtureLibrary().parseOFLFixture(json, mfr);
}

describe('parseOFLFixture — templateChannels ($pixelKey)', () => {
  it('résout les templates via matrix.pixelKeys (galaxian-3d : Red/Green Laser)', () => {
    const def = parseFixture('american-dj', 'galaxian-3d.json');
    const mode = def?.modes[0];
    expect(mode?.channels.map((c) => c.name)).toEqual([
      'Red Laser', 'Green Laser', 'Red Laser Rotation', 'Green Laser Rotation', 'Macros',
    ]);
    // types dérivés des capabilities OFL (ShutterStrobe → Shutter, Rotation → Speed)
    expect(mode?.channels[0].type).toBe('Shutter');
    expect(mode?.channels[2].type).toBe('Speed');
  });

  it('étend les inserts matrixChannels perPixel (alc4 : 4 pixels × 5 templates = 20 canaux)', () => {
    const def = parseFixture('adb', 'alc4.json');
    const matrixLinear = def?.modes.find((m) => m.name === 'Matrix Linear');
    expect(matrixLinear?.channels).toHaveLength(20);
    expect(matrixLinear?.channels[0].name).toBe('Dimmer 4'); // 1er pixel = "4" (pixelKeys)
    expect(matrixLinear?.channels[19].name).toBe('Blue 1');  // dernier pixel = "1"
  });

  it('résout les réfs de mode via les noms de groupes (alc4 Standard Linear : "Dimmer Master")', () => {
    const def = parseFixture('adb', 'alc4.json');
    const std = def?.modes.find((m) => m.name === 'Standard Linear');
    expect(std?.channels.map((c) => c.name)).toEqual([
      'Dimmer Master', 'Color Temperature Master', 'Red Master', 'Green Master', 'Blue Master',
    ]);
  });

  it('génère les pixels implicites depuis matrix.pixelCount (revo-4-ir : 256 canaux)', () => {
    const def = parseFixture('american-dj', 'revo-4-ir.json');
    const mode = def?.modes.find((m) => m.name === '256 channel');
    expect(mode?.channels).toHaveLength(256); // 64 pixels × 4 templates RGBW
    expect(mode?.channels[0].name).toBe('Red 1');
    expect(mode?.channels[255].name).toBe('White 64');
  });

  it('gère pixelGroups "all" (alien-s : groupe Master = tous les pixels)', () => {
    const def = parseFixture('alien-pro', 'alien-s.json');
    expect(def).not.toBeNull();
    expect(def!.modes.length).toBe(6);
    // Les modes 14-channel et 26-channel ont des réfs de template dépliées
    const m14 = def!.modes.find(m => m.name.includes('14-channel'));
    expect(m14).toBeDefined();
    expect(m14!.channels.length).toBeGreaterThan(3); // déplié depuis 3 réfs
    // Vérifier que les canaux résolus ont des noms significatifs (pas $pixelKey brut)
    for (const m of def!.modes) {
      for (const ch of m.channels) {
        expect(ch.name.trim().length).toBeGreaterThan(0);
        expect(ch.name).not.toContain('$pixel');
      }
    }
  });
});

describe('parseOFLFixture — defaultValue', () => {
  it('normalise "50%" → ~127/128 (afx/lmh460z)', () => {
    const def = parseFixture('afx', 'lmh460z.json');
    const pan = def?.modes[0].channels.find((c) => c.name.toLowerCase().includes('pan'));
    expect(pan?.defaultValue).toBeGreaterThan(120);
    expect(pan?.defaultValue).toBeLessThanOrEqual(128);
  });

  it('conserve les 16-bit → octet haut pour le coarse (spica-250m Pan = 32639 → 127)', () => {
    const def = parseFixture('5star-systems', 'spica-250m.json');
    const pan = def?.modes[0].channels.find((c) => c.name === 'Pan');
    expect(pan?.defaultValue).toBe(127);
  });
});

describe('parseOFLFixture — fineChannelAliases', () => {
  it('résout "Pan fine"/"Tilt fine" en clones typés du parent (spica-250m 16bit)', () => {
    const def = parseFixture('5star-systems', 'spica-250m.json');
    const mode = def?.modes.find((m) => m.name === '16bit');
    const panFine = mode?.channels.find((c) => c.name === 'Pan fine');
    expect(panFine?.type).toBe('Pan');
    expect(panFine?.capabilities).toBeUndefined();
    expect(panFine?.defaultValue).toBe(127); // octet bas du parent 16-bit (neutre)
    // les réfs null/vides sont ignorées → 14 canaux réels (16 - 2 null)
    expect(mode?.channels).toHaveLength(14);
  });
});

describe('budget.json — matching bibliothèque (< 100 €)', () => {
  it('chaque entrée budget matche une fixture réelle (fabricant + model normalisés)', async () => {
    const lib = new FixtureLibrary();
    await lib.loadOflDirectory(OFL_DIR);
    const budget = JSON.parse(
      fs.readFileSync(path.join(OFL_DIR, 'budget.json'), 'utf8')
    ) as { entries: { manufacturer: string; model: string; priceMax?: number }[] };
    expect(budget.entries.length).toBeGreaterThanOrEqual(8);
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const defs = lib.getAll();
    for (const e of budget.entries) {
      expect(e.priceMax ?? Infinity).toBeLessThanOrEqual(100); // seuil Budget < 100 €
      const match = defs.find(
        (d) => norm(d.manufacturer) === norm(e.manufacturer) && norm(d.model) === norm(e.model)
      );
      expect(match, `entrée budget sans fixture: ${e.manufacturer} ${e.model}`).toBeDefined();
    }
  });
});

describe('parseOFLFixture — robustesse', () => {
  it('type laser prioritaire : impression-laser et ivl-carre restent « Laser » malgré les catégories Color Changer/Effect', () => {
    const lib = new FixtureLibrary();
    const imp = lib.parseOFLFixture(fs.readFileSync(path.join(OFL_DIR, 'glp', 'impression-laser.json'), 'utf8'), 'glp');
    expect(imp?.type).toBe('Laser'); // categories: ["Laser","Moving Head","Color Changer"]
    const ivl = lib.parseOFLFixture(fs.readFileSync(path.join(OFL_DIR, 'minuit-une', 'ivl-carre.json'), 'utf8'), 'minuit-une');
    expect(ivl?.type).toBe('Laser'); // categories: ["Laser","Effect","Color Changer"]
  });

  it('ne produit aucun canal sans nom et aucun mode vide sur la bibliothèque réelle', async () => {
    const lib = new FixtureLibrary();
    const r = await lib.loadOflDirectory(OFL_DIR);
    expect(r.added).toBeGreaterThanOrEqual(600);
    expect(r.skipped).toBe(0);
    const defs = lib.getAll();
    expect(defs.length).toBeGreaterThanOrEqual(600);
    for (const def of defs) {
      expect(def.modes.length).toBeGreaterThan(0); // P1: pas de fixture fantôme (redirect)
      for (const m of def.modes) {
        expect(m.channels.length).toBeGreaterThan(0);
        for (const ch of m.channels) {
          expect(ch.name.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });
});
