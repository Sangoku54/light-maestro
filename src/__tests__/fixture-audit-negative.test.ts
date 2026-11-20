/**
 * TEST NEGATIF — l'audit de projet doit DETECTER les defauts, pas les
 * confirmer betement.
 *
 * On fabrique un projet synthetique (JSON pur) avec des fixtures VOLONTAIREMENT
 * defectueuses, et on verifie que l'audit remonte bien les codes d'anomalie
 * attendus. Sans ce test, une sonde qui ne testerait rien passerait aussi.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  loadAuditContext,
  auditProject,
  dir3D,
  dirPhys,
  angleBetween,
  type AuditReport,
} from '../engine/fixture-audit';
import { poseFromPos, clampPanZone, clampTiltZone } from '../utils/fixture-pose';
import { clampPanZoneDmx } from '../engine/dmx-movement';

const TMP = path.join(os.tmpdir(), `lm-audit-neg-${process.pid}`);

/** Def minimale SAINE : 3 canaux — Pan, Tilt, Intensity. */
const DEF_OK = {
  id: 'custom-test-mh',
  manufacturer: 'Test',
  model: 'MH',
  type: 'Moving Head',
  modes: [
    {
      name: '8ch',
      channels: [
        { name: 'Pan', type: 'Pan', offset: 0 },
        { name: 'Tilt', type: 'Tilt', offset: 1 },
        { name: 'Intensity', type: 'Intensity', offset: 2 },
      ],
    },
  ],
  physical: { panMax: 540, tiltMax: 180 },
};

/**
 * Def CASSEE n°1 : DEUX canaux « Colour » SANS capacites.
 * Un canal couleur unique est traite comme une ROUE par le moteur (il est
 * donc ecrit) ; en revanche deux canaux couleur sans capabilities ne sont
 * ni un triplet RGB (il en faut 3) ni une roue → ils ne recoivent JAMAIS de
 * valeur : le moteur les laisse muets.
 */
const DEF_BAD_COLOUR = {
  ...DEF_OK,
  id: 'custom-test-bad-colour',
  modes: [
    {
      name: '5ch',
      channels: [
        { name: 'Pan', type: 'Pan', offset: 0 },
        { name: 'Tilt', type: 'Tilt', offset: 1 },
        { name: 'Intensity', type: 'Intensity', offset: 2 },
        { name: 'Colour 1', type: 'Colour', offset: 3 },
        { name: 'Colour 2', type: 'Colour', offset: 4 },
      ],
    },
  ],
};

/**
 * Def CASSEE n°2 : roue couleur DEGENEREE — les slots RED / GREEN / BLUE
 * portent TOUS la MEME couleur (def remplie a la main sans les hex).
 * La fixture ne pourra jamais changer de couleur.
 */
const DEF_BAD_WHEEL = {
  ...DEF_OK,
  id: 'custom-test-bad-wheel',
  modes: [
    {
      name: '4ch',
      channels: [
        { name: 'Pan', type: 'Pan', offset: 0 },
        { name: 'Tilt', type: 'Tilt', offset: 1 },
        { name: 'Intensity', type: 'Intensity', offset: 2 },
        {
          name: 'Colour',
          type: 'Colour',
          offset: 3,
          capabilities: [
            { min: 0, max: 10, name: 'RED', color: '#ff0000' },
            { min: 11, max: 20, name: 'GREEN', color: '#ff0000' },
            { min: 21, max: 30, name: 'BLUE', color: '#ff0000' },
          ],
        },
      ],
    },
  ],
};

function makeProject(fixtures: any[], positions: Record<string, any>): any {
  return {
    showStore: {
      patchedFixtures: fixtures,
      fixturePositions: positions,
      universes: [{ id: 'universe-1', name: 'U1', type: 'artnet', channels: 512 }],
      stageDims: { width: 10, depth: 8 },
      fixtureGroups: [],
      scenes: [],
      chasers: [],
      effects: [],
    },
    customFixtures: [DEF_OK, DEF_BAD_COLOUR, DEF_BAD_WHEEL],
  };
}

describe('audit negatif — la sonde doit DETECTER les defauts', () => {
  let report: AuditReport;

  beforeAll(async () => {
    fs.mkdirSync(TMP, { recursive: true });
    const fixtures = [
      {
        id: 'fx-ok',
        fixtureDefId: 'custom-test-mh',
        manufacturer: 'Test', model: 'MH', fixtureType: 'moving-head',
        modeIndex: 0, modeName: '8ch', universeId: 'universe-1',
        startAddress: 1, channelCount: 3, name: 'Moving Head OK', tier: 'primary',
      },
      {
        id: 'fx-silent',
        fixtureDefId: 'custom-test-bad-colour',
        manufacturer: 'Test', model: 'MH', fixtureType: 'moving-head',
        modeIndex: 0, modeName: '5ch', universeId: 'universe-1',
        startAddress: 10, channelCount: 5, name: 'Moving Head couleur muette', tier: 'primary',
      },
      {
        id: 'fx-wheel',
        fixtureDefId: 'custom-test-bad-wheel',
        manufacturer: 'Test', model: 'MH', fixtureType: 'moving-head',
        modeIndex: 0, modeName: '4ch', universeId: 'universe-1',
        startAddress: 20, channelCount: 4, name: 'Moving Head roue degeneree', tier: 'primary',
      },
      {
        id: 'fx-nodef',
        fixtureDefId: 'custom-test-def-absente',
        manufacturer: 'Test', model: 'MH', fixtureType: 'moving-head',
        modeIndex: 0, modeName: '8ch', universeId: 'universe-1',
        startAddress: 30, channelCount: 3, name: 'Moving Head def absente', tier: 'primary',
      },
    ];
    const positions: Record<string, any> = {};
    for (const f of fixtures) {
      positions[f.id] = { x: 0.5, y: 0.5, h: 3, mountMode: 'hanging' };
    }
    const p = path.join(TMP, 'negatif.lmproj');
    fs.writeFileSync(p, JSON.stringify(makeProject(fixtures, positions)), 'utf8');
    const ctx = await loadAuditContext({ projectPath: p });
    report = auditProject(ctx);
  }, 60000);

  afterAll(() => {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('detecte un canal parlant que le moteur n ecrit jamais', () => {
    const silent = report.issues.filter((i) => i.code === 'channel-silent');
    expect(silent.length, 'le canal Colour muet doit etre signale').toBeGreaterThan(0);
    expect(silent.some((i) => (i.fixture ?? '').includes('couleur muette'))).toBe(true);
  });

  it('renseigne la liste des canaux muets sur la fixture concernee', () => {
    const row = report.rows.find((r) => r.name.includes('couleur muette'));
    expect(row).toBeTruthy();
    expect(row!.silentChannels.length, 'la liste des canaux muets doit etre renseignee').toBeGreaterThan(0);
    expect(row!.silentChannels.join(' ')).toContain('Colour 1');
    expect(row!.silentChannels.join(' ')).toContain('Colour 2');
  });

  it('detecte une roue couleur degeneree (tous les slots de la meme couleur)', () => {
    const degen = report.issues.filter((i) => i.code === 'wheel-degenerate');
    expect(degen.length, 'la roue degeneree doit etre signalee').toBeGreaterThan(0);
    expect(degen.some((i) => (i.fixture ?? '').includes('roue degeneree'))).toBe(true);
  });

  it('detecte une def de fixture introuvable', () => {
    const unresolved = report.issues.filter((i) => i.code === 'def-unresolved');
    expect(unresolved.length, 'la def absente doit etre signalee').toBeGreaterThan(0);
    expect(unresolved.some((i) => (i.fixture ?? '').includes('def absente'))).toBe(true);
  });

  it('la fixture saine n est pas signalee a tort', () => {
    const issuesOnOk = report.issues.filter((i) => (i.fixture ?? '').includes('Moving Head OK'));
    expect(issuesOnOk.map((i) => i.code)).toEqual([]);
  });

  it('la fixture saine est bien eclairee (elle ecrit des canaux > 0)', () => {
    const row = report.rows.find((r) => r.name.includes('Moving Head OK'));
    expect(row).toBeTruthy();
    expect(row!.lit, 'la fixture saine doit etre eclairee').toBe(true);
    expect(row!.maxChannelsWritten).toBeGreaterThan(0);
  });
});

describe('audit negatif — la comparaison 3D / materiel detecte un byte hors zone', () => {
  const dims = { width: 10, depth: 8 };
  // Fixture suspendue au centre : heading = vers le public.
  const pose = poseFromPos(
    { x: 0.5, y: 0.5, h: 3, mountMode: 'hanging' } as any,
    'hanging',
    dims,
    true,
    { panMaxDeg: 540, tiltMaxDeg: 180 },
  );

  it('un byte dans la zone designe le MEME faisceau en 3D et sur le materiel', () => {
    const d3d = dir3D(128, 128, pose, 'hanging');
    const dphys = dirPhys(128, 128, pose);
    expect((angleBetween(d3d, dphys) * 180) / Math.PI).toBeLessThan(0.01);
  });

  it('un byte HORS zone fait diverger les deux vues', () => {
    // pan = 192 → +136,6° mecaniques : la 3D le ramene a +90° (zone de
    // balayage), le materiel garde +136,6° → 46,6° d'ecart.
    const d3d = dir3D(192, 128, pose, 'hanging');
    const dphys = dirPhys(192, 128, pose);
    const delta = (angleBetween(d3d, dphys) * 180) / Math.PI;
    expect(delta, 'un byte hors zone doit produire un ecart 3D/materiel > 0,5°').toBeGreaterThan(0.5);
  });

  it('le clamp moteur resorbe le byte hors zone : plus aucun ecart', () => {
    const bounded = clampPanZoneDmx(192, 540, 0);
    expect(bounded).toBeLessThanOrEqual(170);
    const d3d = dir3D(bounded, 128, pose, 'hanging');
    const dphys = dirPhys(bounded, 128, pose);
    expect((angleBetween(d3d, dphys) * 180) / Math.PI).toBeLessThan(0.01);
  });

  it('les clamps de zone sont bien partages entre la 3D et le moteur', () => {
    // Meme borne des deux cotes : la 3D borne l angle, le moteur borne le byte.
    const heading = 0;
    expect(clampPanZone(heading + Math.PI, heading)).toBeCloseTo(heading + Math.PI / 2, 6);
    expect(clampTiltZone(-Math.PI / 4, 'ground')).toBe(0);
    expect(clampTiltZone(Math.PI / 4, 'ground')).toBeCloseTo(Math.PI / 4, 6);
  });
});
