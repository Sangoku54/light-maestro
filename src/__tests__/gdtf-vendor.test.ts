/**
 * Vérifie que les fixtures GDTF vendues dans resources/fixtures/gdtf/ sont
 * lues et parsées par le vrai parseur de l'app (`parseGdtfFile`).
 *
 * Sert aussi de garde-fou : si un futur refactor du parseur casse l'import
 * GDTF, ce test rouge.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseGdtfFile } from '@electron/fixtures/gdtf';

const here = path.dirname(fileURLToPath(import.meta.url));
const vendorDir = path.resolve(here, '../../resources/fixtures/gdtf');

function vendorFiles(): string[] {
  if (!fs.existsSync(vendorDir)) return [];
  return fs.readdirSync(vendorDir).filter((f) => f.toLowerCase().endsWith('.gdtf'));
}

describe('Fixtures GDTF vendues (resources/fixtures/gdtf)', () => {
  it('contient le jeu de démo attendu', () => {
    const files = vendorFiles();
    expect(files).toHaveLength(6);
    expect(files).toEqual(expect.arrayContaining(['LightMaestro-Demo-Spot-350.gdtf']));
  });

  it('parse toutes les fixtures sans erreur', async () => {
    const files = vendorFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const def = await parseGdtfFile(path.join(vendorDir, f));
      expect(def, `parse ${f}`).not.toBeNull();
      expect(def!.manufacturer).toBe('LightMaestro');
    }
  });

  it('Demo Spot 350 exerce toute la palette (16 bits, roue, gobo, prisme, beam, effet)', async () => {
    const def = await parseGdtfFile(path.join(vendorDir, 'LightMaestro-Demo-Spot-350.gdtf'));
    expect(def).not.toBeNull();
    expect(def!.type).toBe('Moving Head');
    const ch = def!.modes[0].channels;
    const names = ch.map((c) => c.name);
    // 16 bits → canal coarse + fine
    expect(names).toContain('Pan');
    expect(names).toContain('Pan fine');
    expect(names).toContain('Tilt fine');

    const types = new Set(ch.map((c) => c.type));
    const expected = ['Intensity', 'Pan', 'Tilt', 'Colour', 'Shutter', 'Gobo', 'Prism', 'Beam', 'Effect', 'Speed', 'Maintenance'] as const;
    for (const t of expected) {
      expect(types.has(t), `type manquant : ${t}`).toBe(true);
    }

    // La roue de couleurs porte des capacités colorées
    const color = ch.find((c) => c.name === 'Color' && c.type === 'Colour');
    expect(color?.capabilities?.map((c) => c.name)).toEqual(
      expect.arrayContaining(['Red', 'Green', 'Blue'])
    );
  });
});
