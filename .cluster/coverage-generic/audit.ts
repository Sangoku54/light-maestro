/**
 * Audit de couverture universelle — moteur DMX générique vs bibliothèque OFL complète.
 *
 * Lecture seule : aucune modification de src/ ; scripts tsx dans .cluster/coverage-generic/.
 *
 * Invariants vérifiés sur CHAQUE fixture (mode le plus long) :
 *   I1 — analyzeFixtureChannels ne THROW pas (aucune fixture ne casse la lecture)
 *   I2 — computeLaserChannels produit uniquement des entiers ∈ [0,255] (jamais NaN)
 *   I3 — tout laser (isLaser) a ≥1 rôle exploitable (sinon « laser muet »)
 *   I4 — faux positifs laser (isLaser à tort : fallback triple sans indice laser,
 *        ou type « Laser » sans preuve canal — ex. projecteur vidéo à lampe laser)
 *
 * Lancement :  npx tsx .cluster/coverage-generic/audit.ts
 * Sorties :     .cluster/coverage-generic/out.json  (données complètes pour le rapport)
 */
import * as fs from 'fs';
import * as path from 'path';
import { FixtureLibrary } from '../../electron/fixtures/library';
import { analyzeFixtureChannels, type FixtureChannelAnalysis } from '../../src/engine/fixture-analyzer';
import type { PatchedFixture } from '../../src/stores/showStore';
import type { DmxFixtureDefinition, DmxFixtureChannel } from '../../src/hooks/dmx-cues';

// ─── Shim : dmx-playback tire appStore/zustand (persist → localStorage). ───
(globalThis as any).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
};

const ROOT = path.resolve(__dirname, '..', '..');
const OFL_DIR = path.join(ROOT, 'resources', 'fixtures', 'ofl');

interface FileEntry {
  file: string;       // chemin relatif (pour affichage)
  def: DmxFixtureDefinition | null;
  err: string | null; // parse error
  dupOf: string | null;
}

interface ChannelInfo {
  offset: number;
  name: string;
  type: string;
  caps: number;
  firstCap?: string;
  capRanges?: string;
}

interface LaserMuetEntry {
  file: string;
  manufacturer: string;
  model: string;
  fixtureType: string;
  mode: string;
  channelCount: number;
  reason: 'type' | 'signature' | 'fallback' | 'none';
  exploitable: string[];     // rôles présents qui comptent
  manquants: string[];       // rôles absents
  presque: string[];         // cas limites (wheel sans caps, rgb<2…)
  canaux: ChannelInfo[];
}

interface FauxPositifEntry {
  file: string;
  manufacturer: string;
  model: string;
  fixtureType: string;
  mode: string;
  channelCount: number;
  kind: 'fallback-sans-indice' | 'type-laser-sans-canal';
  canaux: ChannelInfo[];
}

interface I2Violation {
  file: string;
  manufacturer: string;
  model: string;
  fixtureType: string;
  t: number;
  energy: number;
  palette: string;
  addr: number;
  value: number;
}

interface I1Failure {
  file: string;
  manufacturer: string;
  model: string;
  fixtureType: string;
  mode: string;
  error: string;
}

type LaserReason = 'type' | 'signature' | 'fallback' | 'none';

/** Copie fidèle de isLaserFixture (fixture-analyzer.ts) + raison de détection. */
function laserReason(defType: string, channels: DmxFixtureChannel[]): LaserReason {
  const norm = String(defType ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (norm.includes('laser')) return 'type';
  const laserSig = channels.some(
    (c) => /laser/i.test(c.name ?? '') || (c.capabilities ?? []).some((cap) => /laser/i.test(cap.name ?? '')),
  );
  if (laserSig) return 'signature';
  const names = channels.map((c) => (c.name ?? '').toLowerCase());
  const hasPattern = names.some((n) => /\bpattern\b/.test(n));
  const hasScanAxis = names.some(
    (n) => /(horizontal|vertical)\s*(angle|movement|position)/.test(n) || /\bscan/.test(n) || /\bcircular/.test(n),
  );
  const hasColor = channels.some(
    (c) => /\bcolor|colour\b/i.test(c.name ?? '') && (c.type === 'Colour' || (c.capabilities ?? []).some((cap) => cap.color)),
  );
  if (hasPattern && hasScanAxis && hasColor) return 'fallback';
  return 'none';
}

function chanInfo(ch: DmxFixtureChannel, i: number): ChannelInfo {
  const caps = ch.capabilities ?? [];
  return {
    offset: ch.offset ?? i,
    name: ch.name ?? '',
    type: ch.type,
    caps: caps.length,
    firstCap: caps[0]?.name ? `${caps[0].name} ${caps[0].min}-${caps[0].max}` : undefined,
    capRanges: caps.length > 1 ? caps.slice(0, 4).map((c) => `${c.name} ${c.min}-${c.max}`).join(' | ') : undefined,
  };
}

function rolesExploitables(fa: FixtureChannelAnalysis): string[] {
  const r: string[] = [];
  if (fa.laserModeOffset !== null) r.push(`mode@${fa.laserModeOffset}`);
  if (fa.patternOffset !== null) r.push(`pattern@${fa.patternOffset} (${fa.patternCaps.length} caps)`);
  if (fa.scanXOffset !== null) r.push(`scanX@${fa.scanXOffset}`);
  if (fa.scanYOffset !== null) r.push(`scanY@${fa.scanYOffset}`);
  if (fa.rgbOffsets !== null && fa.rgbOffsets.length >= 2) r.push(`rgb[${fa.rgbOffsets.join(',')}]`);
  if (fa.wheelOffset !== null && fa.wheelCaps.length > 0) r.push(`wheel@${fa.wheelOffset} (${fa.wheelCaps.length} caps)`);
  if (fa.laserRotationOffsets.length > 0) r.push(`rot[${fa.laserRotationOffsets.join(',')}]`);
  if ((fa as any).laserColorGateOffset !== null && (fa as any).laserColorGateCaps?.length > 0) r.push(`gate@${(fa as any).laserColorGateOffset}`);
  return r;
}

function rolesManquants(fa: FixtureChannelAnalysis, channels: DmxFixtureChannel[]): string[] {
  const m: string[] = [];
  const ch = (off: number | null) => (off === null ? '-' : `${off}`);
  m.push(`mode=${ch(fa.laserModeOffset)}`);
  m.push(`pattern=${ch(fa.patternOffset)}`);
  m.push(`scanX=${ch(fa.scanXOffset)}`);
  m.push(`scanY=${ch(fa.scanYOffset)}`);
  m.push(`rgb=${fa.rgbOffsets ? `[${fa.rgbOffsets.join(',')}]` : '-'}`);
  m.push(`wheel=${ch(fa.wheelOffset)}${fa.wheelOffset !== null && fa.wheelCaps.length === 0 ? '(0 cap!)' : ''}`);
  m.push(`rot=[${fa.laserRotationOffsets.join(',')}]`);
  m.push(`blank=${ch(fa.blankOffset)}`);
  void channels;
  return m;
}

async function main(): Promise<void> {
  const out: any = {
    generatedAt: new Date().toISOString(),
    oflDir: OFL_DIR,
    stats: {},
    i1Failures: [] as I1Failure[],
    lasersMuets: [] as LaserMuetEntry[],
    tousLasers: [] as any[],
    fauxPositifs: [] as FauxPositifEntry[],
    projecteursExclus: [] as any[],
    i2Violations: [] as I2Violation[],
  };

  const lib = new FixtureLibrary();

  // ── Chargement réel (I1 niveau chargement) ────────────────────────────
  const loadResult = await lib.loadOflDirectory(OFL_DIR);
  console.log(`[audit] loadOflDirectory → ${JSON.stringify(loadResult)}`);

  // ── Scan des fichiers : parse individuel pour mapper fichier → def.id,
  //    détecter les parse-fails (trous de lecture au niveau parse). ──────
  const files: FileEntry[] = [];
  const byId = new Map<string, FileEntry>();
  const mfrDirs = fs.readdirSync(OFL_DIR, { withFileTypes: true }).filter((e) => e.isDirectory());
  for (const mfrDir of mfrDirs) {
    const mfrPath = path.join(OFL_DIR, mfrDir.name);
    const jsonFiles = fs.readdirSync(mfrPath, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith('.json'));
    for (const f of jsonFiles) {
      const rel = path.join(mfrDir.name, f.name);
      const full = path.join(mfrPath, f.name);
      let entry: FileEntry;
      try {
        const content = fs.readFileSync(full, 'utf-8');
        const def = lib.parseOFLFixture(content, mfrDir.name);
        if (def) {
          entry = { file: rel, def: def as unknown as DmxFixtureDefinition, err: null, dupOf: byId.has(def.id) ? byId.get(def.id)!.file : null };
          if (!byId.has(def.id)) byId.set(def.id, entry);
        } else {
          entry = { file: rel, def: null, err: 'parseOFLFixture → null (redirect ou invalide)', dupOf: null };
        }
      } catch (e) {
        entry = { file: rel, def: null, err: (e as Error).message, dupOf: null };
      }
      files.push(entry);
    }
  }

  const parseFailed = files.filter((f) => f.def === null);
  const dups = files.filter((f) => f.dupOf);

  // ── Définitifs chargés en bibliothèque ────────────────────────────────
  const defs = lib.getAll();
  console.log(`[audit] fichiers JSON=${files.length} defs=${defs.length} parseFails=${parseFailed.length} doublons=${dups.length}`);

  // Mode le plus long + index
  function longestMode(def: any): { channels: DmxFixtureChannel[]; index: number; name: string } {
    let best = -1;
    let bestLen = -1;
    (def.modes ?? []).forEach((m: any, i: number) => {
      const l = (m.channels ?? []).length;
      if (l > bestLen) {
        bestLen = l;
        best = i;
      }
    });
    if (best < 0) return { channels: [], index: 0, name: 'Default' };
    return { channels: def.modes[best].channels as DmxFixtureChannel[], index: best, name: def.modes[best].name };
  }

  let nLasers = 0;
  let nMuets = 0;
  let nFauxPos = 0;
  let sumCanauxMorts = 0;
  let nI2Fail = 0;

  defs.forEach((rawDef, i) => {
    const def = rawDef as unknown as DmxFixtureDefinition;
    const mode = longestMode(def);
    const channels = mode.channels;
    const fileEntry = byId.get(def.id);
    const file = fileEntry?.file ?? '?';

    const pf: PatchedFixture = {
      id: def.id,
      fixtureDefId: def.id,
      manufacturer: def.manufacturer,
      model: def.model,
      fixtureType: def.type,
      modeIndex: mode.index,
      modeName: mode.name,
      universeId: 'U1',
      startAddress: 1 + ((i * 15) % 480),
      channelCount: channels.length,
      name: `${def.manufacturer} ${def.model}`,
      tier: 'primary',
    };

    // ── I1 : l'analyse ne doit pas throw ──
    let fa: FixtureChannelAnalysis;
    try {
      fa = analyzeFixtureChannels(pf, def);
    } catch (e) {
      out.i1Failures.push({
        file,
        manufacturer: def.manufacturer,
        model: def.model,
        fixtureType: def.type,
        mode: mode.name,
        error: (e as Error).message,
      });
      return;
    }

    if (!fa.isLaser) {
      // Exclusions projecteur : type OFL « Laser » (lampe laser-phosphore) exclues par
      // la garde isVideoProjector du moteur → isLaser=false. Documentées, pas des lasers FX.
      if (String(def.type).toLowerCase().includes('laser')) {
        out.projecteursExclus.push({
          file,
          manufacturer: def.manufacturer,
          model: def.model,
          fixtureType: def.type,
          mode: mode.name,
          channelCount: channels.length,
        });
      }
      return;
    }
    nLasers++;

    const reason = laserReason(def.type, channels);

    // ── I2 : valeurs produites par computeLaserChannels ∈ [0,255] entiers ──
    // Import dynamique (requiert le shim localStorage) seulement pour le bloc laser.
    // (fait dans la passe suivante pour ne pas alourdir cette boucle)

    // ── I3 : laser muet ? ──
    const exploitable = rolesExploitables(fa);
    out.tousLasers.push({
      file,
      manufacturer: def.manufacturer,
      model: def.model,
      fixtureType: def.type,
      mode: mode.name,
      channelCount: channels.length,
      reason,
      roles: exploitable,
      laserColorMode: fa.laserColorMode,
      muet: exploitable.length === 0,
    });
    if (exploitable.length === 0) {
      nMuets++;
      sumCanauxMorts += channels.length;
      const presque: string[] = [];
      if (fa.wheelOffset !== null && fa.wheelCaps.length === 0) presque.push("wheelOffset set mais 0 capability -> le bloc roue n'ecrit rien");
      if (fa.rgbOffsets !== null && fa.rgbOffsets.length < 2) presque.push(`rgbOffsets=[${fa.rgbOffsets.join(',')}] mais <2 canaux → bloc gates inactif`);
      if (fa.patternOffset !== null && fa.patternCaps.length === 0) presque.push('pattern sans caps ni synthèse');
      out.lasersMuets.push({
        file,
        manufacturer: def.manufacturer,
        model: def.model,
        fixtureType: def.type,
        mode: mode.name,
        channelCount: channels.length,
        reason,
        exploitable,
        manquants: rolesManquants(fa, channels),
        presque,
        canaux: channels.map((c, ci) => chanInfo(c, ci)),
      });
    }

    // ── I4 : faux positifs ──
    if (reason === 'fallback') {
      // Aucun indice laser réel (ni type, ni nom/cap « laser ») : seule l'heuristique
      // triple (pattern+scan+color) a déclenché — faux positif potentiel.
      nFauxPos++;
      out.fauxPositifs.push({
        file,
        manufacturer: def.manufacturer,
        model: def.model,
        fixtureType: def.type,
        mode: mode.name,
        channelCount: channels.length,
        kind: 'fallback-sans-indice',
        canaux: channels.map((c, ci) => chanInfo(c, ci)),
      });
    }
  });

  // ── Passe I2 sur les lasers (bloc laser effectif) ──
  const { computeLaserChannels } = await import('../../src/hooks/dmx-playback');
  const ts = [0, 0.5, 1, 2, 4];
  const energies = [0.1, 0.5, 0.95];
  const palettes: Array<string | undefined> = [undefined, '#ff0000', '#00ff00', '#0000ff', '#ff00ff'];
  const faults = new Map<string, I2Violation[]>();

  defs.forEach((rawDef, i) => {
    const def = rawDef as unknown as DmxFixtureDefinition;
    const mode = longestMode(def);
    const pf: PatchedFixture = {
      id: def.id,
      fixtureDefId: def.id,
      manufacturer: def.manufacturer,
      model: def.model,
      fixtureType: def.type,
      modeIndex: mode.index,
      modeName: mode.name,
      universeId: 'U1',
      startAddress: 1 + ((i * 15) % 480),
      channelCount: mode.channels.length,
      name: `${def.manufacturer} ${def.model}`,
      tier: 'primary',
    };
    let fa: FixtureChannelAnalysis;
    try {
      fa = analyzeFixtureChannels(pf, def);
    } catch {
      return; // déjà compté en I1
    }
    if (!fa.isLaser) return;
    const fileEntry2 = byId.get(def.id);
    const file2 = fileEntry2?.file ?? '?';

    let localFail = false;
    for (const t of ts) {
      for (const energy of energies) {
        for (const palette of palettes) {
          const chVals: Record<number, number> = {};
          computeLaserChannels(fa, pf, chVals, t, energy, palette);
          for (const [addrS, v] of Object.entries(chVals)) {
            const addr = Number(addrS);
            if (!Number.isInteger(v) || v < 0 || v > 255 || Number.isNaN(v)) {
              localFail = true;
              out.i2Violations.push({
                file: file2,
                manufacturer: def.manufacturer,
                model: def.model,
                fixtureType: def.type,
                t,
                energy,
                palette: palette ?? '(defaut)',
                addr,
                value: v,
              });
            }
          }
        }
      }
    }
    if (localFail) {
      nI2Fail++;
      faults.set(def.id, []);
    }
  });

  // ── Stats & tri par gravité ──
  const gravite = (m: LaserMuetEntry) => 1000 + m.channelCount;
  out.lasersMuets.sort((a, b) => gravite(b) - gravite(a));
  out.fauxPositifs.sort((a, b) => b.channelCount - a.channelCount);
  out.i2Violations.sort((a, b) => b.addr - a.addr);
  out.i1Failures.sort((a, b) => a.file.localeCompare(b.file));

  out.stats = {
    fichiersJson: files.length,
    defsChargees: defs.length,
    redirects: parseFailed.length,
    parseFailFiles: parseFailed.map((f) => f.file),
    doublons: dups.map((f) => f.file),
    lasers: nLasers,
    lasersMuets: nMuets,
    canauxLasersNonExploites: sumCanauxMorts,
    fauxPositifs: nFauxPos,
    projecteursExclus: out.projecteursExclus.length,
    i1Failures: out.i1Failures.length,
    i2FixturesFails: nI2Fail,
    i2Violations: out.i2Violations.length,
  };

  fs.writeFileSync(path.join(__dirname, 'out.json'), JSON.stringify(out, null, 2), 'utf-8');

  // ── Résumé console ──
  console.log('══════ RÉSUMÉ AUDIT COUVERTURE GÉNÉRIQUE ══════');
  console.log(`fixtures OFL : ${defs.length} (${files.length} fichiers JSON, ${parseFailed.length} redirects OFL ignorés, ${dups.length} doublons)`);
  console.log(`I1 (analyse qui throw) : ${out.i1Failures.length}`);
  console.log(`lasers (isLaser) : ${nLasers} | muets (I3) : ${nMuets} | canaux non exploités : ${sumCanauxMorts}`);
  console.log(`faux positifs (I4, fallback seul) : ${nFauxPos} | exclusions projecteur (garde isVideoProjector) : ${out.projecteursExclus.length}`);
  console.log(`I2 (valeurs hors [0,255]) : ${nI2Fail} fixtures, ${out.i2Violations.length} violations`);
  console.log('── lasers muets (tous) ──');
  for (const m of out.lasersMuets) console.log(`  ${m.file} (${m.channelCount}ch, raison=${m.reason})`);
  console.log('── faux positifs (tous) ──');
  for (const f of out.fauxPositifs) console.log(`  ${f.file} (${f.channelCount}ch, ${f.kind})`);
  console.log('── exclusions projecteur ──');
  for (const p of out.projecteursExclus) console.log(`  ${p.file} (${p.channelCount}ch)`);
  console.log('── violations I2 (fixtures) ──');
  const i2ByFile = new Map<string, number>();
  for (const v of out.i2Violations) i2ByFile.set(v.file, (i2ByFile.get(v.file) ?? 0) + 1);
  for (const [k, c] of [...i2ByFile.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k} × ${c}`);
  console.log('═══ FIN ═══');
}

main().catch((e) => {
  console.error('[audit] FATAL:', e);
  process.exit(1);
});