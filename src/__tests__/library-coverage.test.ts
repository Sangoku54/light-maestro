/**
 * Couverture universelle de la bibliothèque OFL réelle.
 *
 * Garantit que TOUTE fixture (existante ou ajoutée plus tard dans
 * resources/fixtures/ofl) :
 *   I1 — s'analyse sans exception (le patch/la lecture ne doit jamais casser) ;
 *   I2 — produit des valeurs DMX entières dans [0,255] sur le chemin laser
 *        partagé (computeLaserChannels, utilisé par le tick live ET
 *        computeDmxForCue) — jamais NaN ni hors bornes ;
 *   I3 — tout laser détecté a au moins un rôle exploitable (mode, pattern,
 *        scan X/Y, RGB/roue, rotations) : jamais « muet », sinon le bloc
 *        générique n'écrit rien et la fixture ne s'allume pas.
 * Si ce test échoue, c'est un trou GÉNÉRIQUE du moteur à corriger (pas un
 * cas particulier de fixture).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { FixtureLibrary } from '@electron/fixtures/library';
import { analyzeFixtureChannels } from '../engine/fixture-analyzer';
import { computeLaserChannels } from '../hooks/dmx-playback';

const OFL_DIR = path.join(process.cwd(), 'resources', 'fixtures', 'ofl');
const lib = new FixtureLibrary();

interface LibDef { id: string; manufacturer: string; model: string; type: string; modes: { name: string; channels: any[] }[] }

let defs: LibDef[] = [];

function longestMode(def: LibDef) {
  let best = def.modes[0];
  for (const m of def.modes) if (m.channels.length > best.channels.length) best = m;
  return best;
}

beforeAll(async () => {
  const r = await lib.loadOflDirectory(OFL_DIR);
  expect(r.skipped).toBe(0);
  defs = lib.getAll() as unknown as LibDef[];
  expect(defs.length).toBeGreaterThanOrEqual(600);
}, 120000);

describe('couverture universelle de la bibliothèque OFL', () => {
  it('I1+I2 : aucune fixture ne casse l\'analyse, toutes les valeurs laser sont entières dans [0,255]', () => {
    const failures: string[] = [];
    for (const def of defs) {
      try {
        const mo = longestMode(def);
        const pf: any = {
          id: def.id, manufacturer: def.manufacturer, model: def.model, fixtureType: def.type,
          modeIndex: 0, modeName: mo.name, universeId: 'u1', startAddress: 1, channelCount: mo.channels.length,
          name: def.id, tier: 'primary',
        };
        const fa = analyzeFixtureChannels(pf, { ...(def as any), modes: [mo] });
        for (const t of [0, 0.5, 1, 2, 4]) {
          const chVals: Record<number, number> = {};
          computeLaserChannels(fa, pf, chVals, t, 0.5, '#ff0000');
          for (const v of Object.values(chVals)) {
            if (!Number.isInteger(v) || v < 0 || v > 255) {
              failures.push(`${def.id}@t=${t}: valeur ${v} hors [0,255]`);
              break;
            }
          }
        }
      } catch (e) {
        failures.push(`${def.id}: exception ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  }, 240000);

  it('I3 : tout laser a au moins un rôle exploitable (jamais muet)', () => {
    const mute: string[] = [];
    for (const def of defs) {
      const mo = longestMode(def);
      const pf: any = {
        id: def.id, manufacturer: def.manufacturer, model: def.model, fixtureType: def.type,
        modeIndex: 0, modeName: mo.name, universeId: 'u1', startAddress: 1, channelCount: mo.channels.length,
        name: def.id, tier: 'primary',
      };
      const fa = analyzeFixtureChannels(pf, { ...(def as any), modes: [mo] });
      if (!fa.isLaser) continue;
      const exploitable =
        fa.laserModeOffset !== null ||
        (fa.patternOffset !== null && fa.patternCaps.length > 0) ||
        fa.scanXOffset !== null || fa.scanYOffset !== null ||
        (fa.rgbOffsets !== null && fa.rgbOffsets.length >= 2) ||
        fa.laserColorGateOffset !== null ||
        fa.wheelOffset !== null ||
        fa.laserRotationOffsets.length > 0;
      if (!exploitable) {
        mute.push(`${def.id} (${def.type})`);
      }
    }
    expect(mute).toEqual([]);
  }, 240000);

  it('régression générique : projecteurs exclus, gate + mode + scan détectés', () => {
    const byId = new Map(defs.map((d) => [d.id, d]));
    const ana = (id: string) => {
      const def = byId.get(id)!;
      const mo = longestMode(def);
      const pf: any = {
        id: def.id, manufacturer: def.manufacturer, model: def.model, fixtureType: def.type,
        modeIndex: 0, modeName: mo.name, universeId: 'u1', startAddress: 1, channelCount: mo.channels.length,
        name: def.id, tier: 'primary',
      };
      return analyzeFixtureChannels(pf, { ...(def as any), modes: [mo] });
    };
    // Vidéoprojecteur laser-phosphore : lumière générique, PAS un effet laser.
    expect(ana('panasonic-PT-RZ120').isLaser).toBe(false);
    expect(ana('panasonic-PT-RZ120').intensityOffset).not.toBeNull();
    // Gate couleur mono-canal par caps (Showtec Dominator).
    expect(ana('Showtec-Dominator').laserColorGateOffset).not.toBeNull();
    // Canal mode au nom composé (JB Twin Effect).
    expect(ana('JB-Systems-Twin-Effect-Laser').laserModeOffset).not.toBeNull();
    // Rotation « Rotating Laser » + scan conservé (IODA).
    expect(ana('Showtec-Dominator').laserRotationOffsets.length).toBeGreaterThan(0);
    const ioda = [...byId.keys()].find((k) => /ioda.*(400|600|1000)/i.test(k));
    if (ioda) {
      const fa = ana(ioda);
      expect(fa.scanXOffset).not.toBeNull();
      expect(fa.scanYOffset).not.toBeNull();
    }
  }, 240000);

  it('compteurs de couverture (pour suivi dans le temps)', () => {
    let lasers = 0;
    let lasersAvecScan = 0;
    for (const def of defs) {
      const mo = longestMode(def);
      const pf: any = {
        id: def.id, manufacturer: def.manufacturer, model: def.model, fixtureType: def.type,
        modeIndex: 0, modeName: mo.name, universeId: 'u1', startAddress: 1, channelCount: mo.channels.length,
        name: def.id, tier: 'primary',
      };
      const fa = analyzeFixtureChannels(pf, { ...(def as any), modes: [mo] });
      if (!fa.isLaser) continue;
      lasers++;
      if (fa.scanXOffset !== null || fa.scanYOffset !== null) lasersAvecScan++;
    }
    // Pas d'exigence chiffrée (la bibliothèque évolue) : on documente.
    console.log(`[coverage] fixtures=${defs.length} lasers=${lasers} lasers avec scan=${lasersAvecScan}`);
    expect(lasers).toBeGreaterThan(0);
  }, 240000);
});