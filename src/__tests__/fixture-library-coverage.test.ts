/**
 * COUVERTURE DE LA BIBLIOTHÈQUE COMPLÈTE — aucun canal « parlant » muet.
 *
 * Le show de référence (Yolo) ne couvre que 9 fixtures. Ce test passe en
 * revue TOUTE la bibliothèque (QXF + JSON + OFL + GDTF : ~2 978 définitions,
 * ~10 595 modes, ~157 000 canaux) et vérifie qu'**aucun canal portant des
 * capabilities n'est ignoré** par l'analyseur.
 *
 * Règle : une capability décrit une plage de valeurs que le moteur DOIT
 * piloter. Un canal à capabilities que rien n'écrit est un canal muet :
 *   - soit la def est fausse,
 *   - soit l'analyseur ne l'a pas routé (défaut d'exploitation).
 *
 * Les canaux SANS capabilities ne sont pas concernés : ils n'ont aucune
 * plage de valeurs à respecter (on ne peut pas les piloter correctement).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { FixtureLibrary } from '@electron/fixtures/library';
import { analyzeFixtureChannels } from '../engine/fixture-analyzer';
import { auditFixtureCoverage } from '../engine/fixture-coverage';
import type { PatchedFixture } from '../stores/showStore';
import type { DmxFixtureDefinition } from '../hooks/dmx-cues';

function walk(dir: string, exts: string[]): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some(x => e.name.toLowerCase().endsWith(x))) out.push(p);
  }
  return out;
}

async function loadAllDefs(): Promise<DmxFixtureDefinition[]> {
  const lib = new FixtureLibrary();
  const root = path.join(process.cwd(), 'resources', 'fixtures');
  const defs: DmxFixtureDefinition[] = [];
  for (const f of walk(root, ['.qxf'])) {
    try {
      const d = await lib.parseQLC(fs.readFileSync(f, 'utf8'), f);
      if (d) defs.push(d as unknown as DmxFixtureDefinition);
    } catch { /* def illisible : ignorée */ }
  }
  for (const f of walk(root, ['.json'])) {
    if (f.includes(`${path.sep}ofl${path.sep}`)) continue;
    try {
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (d && d.modes) defs.push(d as DmxFixtureDefinition);
    } catch { /* def illisible : ignorée */ }
  }
  await lib.loadOflDirectory(path.join(root, 'ofl'), { overwrite: true });
  for (const d of lib.getAll()) defs.push(d as unknown as DmxFixtureDefinition);
  await lib.loadGdtfDirectory(path.join(root, 'gdtf'));
  for (const d of lib.getAll()) defs.push(d as unknown as DmxFixtureDefinition);
  return defs;
}

describe('couverture globale de la bibliothèque de fixtures', () => {
  it('aucun canal à capabilities n\'est muet (définitions + modes)', async () => {
    const defs = await loadAllDefs();
    expect(defs.length).toBeGreaterThan(1000);

    const orphans: string[] = [];
    let modes = 0;
    let channels = 0;
    let withCaps = 0;

    for (const def of defs) {
      for (let mi = 0; mi < (def.modes?.length ?? 0); mi++) {
        modes++;
        const chans = def.modes[mi].channels ?? [];
        const pf = {
          id: `cov-${def.id}-${mi}`,
          fixtureDefId: def.id,
          manufacturer: 'D',
          model: def.id,
          fixtureType: 'Unknown',
          modeIndex: mi,
          modeName: def.modes[mi].name,
          universeId: 'u1',
          startAddress: 1,
          channelCount: chans.length,
          name: def.id,
          tier: 'primary',
        } as unknown as PatchedFixture;
        const fa = analyzeFixtureChannels(pf, def as unknown as DmxFixtureDefinition);
        const report = auditFixtureCoverage(pf, def as unknown as DmxFixtureDefinition, fa);
        for (const w of report.warnings) {
          const ch = chans.find((c, ci) => (c.offset ?? ci) === w.offset);
          // Seuls les canaux à CAPABILITIES sont bloquants : une capability
          // décrit une plage de valeurs que le moteur DOIT respecter. Un
          // canal sans capability n'a pas de plage → il peut rester muet.
          if ((ch?.capabilities ?? []).length === 0) continue;
          orphans.push(`${def.id} [${def.modes[mi].name}] ch${w.offset} "${w.name}" [${w.type}]`);
        }
        for (let i = 0; i < chans.length; i++) {
          channels++;
          if ((chans[i].capabilities ?? []).length > 0) withCaps++;
        }
      }
    }

    console.log(
      `[COUVERTURE-BIBLIOTHÈQUE] ${defs.length} defs · ${modes} modes · ${channels} canaux · ` +
      `${withCaps} à capabilities · ${orphans.length} muet(s)`,
    );
    expect(orphans.slice(0, 12), `${orphans.length} canal(aux) muet(s) :\n${orphans.slice(0, 12).join('\n')}`).toEqual([]);
    expect(orphans.length).toBe(0);
  }, 600000);
});
