/**
 * SONDE DE PROJET — audit generique, PARAMETRABLE.
 *
 * Par defaut : audite le projet de reference `LM/Yolo.lmproj` (regression CI).
 * Sur n'importe quel projet :
 *
 *   npm run probe -- LM/MonProjet.lmproj [LM/MonProjet.lmpreset]
 *
 * L'audit rejoue le VRAI moteur (`analyzeChannels` + `computeDmxForCue`) et
 * compare trois vues par fixture :
 *   (A) la vue 3D (memes clamps que le renderer),
 *   (B) le DMX reellement ecrit sur le cable,
 *   (C) la physique du materiel (mecanique + tares PHYSIQUES, sans clamp).
 *
 * INVARIANT : (A) et (C) doivent designer le meme faisceau.
 * Toute anomalie (fixture muette, canal parlant jamais ecrit, valeur DMX
 * hors plage, roue degeneree, bras de tete inutilise...) FAIT ECHOVER le test.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  loadAuditContext,
  auditProject,
  formatAuditReport,
  type AuditContext,
  type AuditReport,
} from '../engine/fixture-audit';

const PROJECT = path.resolve(
  process.env.LM_PROBE_PROJECT || path.join(process.cwd(), 'LM', 'Yolo.lmproj'),
);
const PRESET = process.env.LM_PROBE_PRESET
  ? path.resolve(process.env.LM_PROBE_PRESET)
  : undefined;

describe.skipIf(!fs.existsSync(PROJECT))(`AUDIT PROJET — ${path.basename(PROJECT)}`, () => {
  let ctx: AuditContext;
  let report: AuditReport;

  beforeAll(async () => {
    ctx = await loadAuditContext({ projectPath: PROJECT, presetPath: PRESET });
    report = auditProject(ctx);
    console.log(formatAuditReport(report));
  }, 120000);

  it('toutes les defs des fixtures patchees se resolvent', () => {
    expect(
      ctx.unresolved,
      `defs non resolues : ${ctx.unresolved.join(', ')} — la fixture ne peut pas etre analysee`,
    ).toEqual([]);
  });

  it('chaque fixture est eclairee et ecrit des canaux', () => {
    for (const r of report.rows) {
      expect(r.lit, `${r.name} : fixture MUETTE (aucun canal ecrit > 0)`).toBe(true);
      expect(r.maxChannelsWritten, `${r.name} : aucun canal ecrit`).toBeGreaterThan(0);
    }
  });

  it('la vue 3D designe exactement le faisceau du materiel', () => {
    const mismatches = report.rows.filter((r) => r.deltaDeg !== null && r.deltaDeg > 0.5);
    expect(
      mismatches.map((r) => `${r.name}: ${r.deltaDeg}° (3D ${r.dir3D} / materiel ${r.dirPhys})`),
      'ecart 3D <-> materiel > 0,5°',
    ).toEqual([]);
  });

  it('aucune valeur DMX hors plage ni non entiere', () => {
    const bad = report.issues.filter(
      (i) => i.code === 'dmx-out-of-range' || i.code === 'dmx-not-integer',
    );
    expect(bad.map((i) => i.message)).toEqual([]);
  });

  it('aucun canal parlant jamais ecrit (couverture def)', () => {
    const silent = report.issues.filter((i) => i.code === 'channel-silent');
    expect(silent.map((i) => i.message)).toEqual([]);
  });

  it('aucune anomalie bloquante', () => {
    const errors = report.issues.filter((i) => i.severity === 'error');
    expect(errors.map((i) => `(${i.code}) ${i.message}`)).toEqual([]);
  });
});
