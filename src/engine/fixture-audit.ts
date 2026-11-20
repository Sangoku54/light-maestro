/**
 * AUDIT GENERIQUE DE PROJET — position, faisceau 3D, DMX reel, exploitation des defs.
 *
 * But : repondre, pour N'IMPORTE QUEL projet `.lmproj`, aux questions :
 *   1. ou sont les fixtures (position reelle, montage, heading) ?
 *   2. vers quoi pointent-elles par defaut (vue 3D) ?
 *   3. que valent les octets DMX reellement ecrits ?
 *   4. la vue 3D designe-t-elle EXACTEMENT le faisceau que le materiel fera ?
 *   5. chaque canal utile de la def est-il detecte ET pilote par le moteur ?
 *
 * On ne REIMPLEMENTE RIEN : tout passe par le code de production
 *   - `unpackProject`            (electron/project-envelope)
 *   - `analyzeChannels`          (engine/fixture-analyzer)
 *   - `computeDmxForCue`         (hooks/dmx-playback)   <- DMX reellement ecrit
 *   - `poseFromPos` / `clampPanZone` / `clampTiltZone` (utils/fixture-pose)
 *   - `clampPanZoneDmx` / `clampTiltZoneDmx`           (engine/dmx-movement)
 *   - `auditFixtureCoverage`     (engine/fixture-coverage)
 *
 * Les deux vues du faisceau :
 *   (A) VUE 3D  — heading + clampPanZone / clampTiltZone (identiques au renderer)
 *   (B) PHYSIQUE — mecanique + tares PHYSIQUES (pos.tilt, zeroPan/zeroTilt),
 *       SANS clamp logiciel (le materiel ne connait pas nos zones).
 *   INVARIANT : (A) et (B) doivent designer le meme faisceau.
 */

import fs from 'fs';
import path from 'path';
import { unpackProject } from '../../electron/project-envelope';
import { FixtureLibrary } from '@electron/fixtures/library';
import { analyzeChannels, type FixtureChannelAnalysis } from './fixture-analyzer';
import { computeDmxForCue } from '../hooks/dmx-playback';
import { auditFixtureCoverage, type FixtureCoverageReport } from './fixture-coverage';
import {
  poseFromPos,
  clampPanZone,
  clampTiltZone,
  type PosePos,
  type FixtureAimPose,
  type Vec3,
} from '../utils/fixture-pose';
import { clampPanZoneDmx, clampTiltZoneDmx } from './dmx-movement';

// ─── Types ──────────────────────────────────────────────────────────────

export type AuditSeverity = 'error' | 'warn';

export interface AuditIssue {
  severity: AuditSeverity;
  /** Code court, stable (pour grep / CI). */
  code:
    | 'def-unresolved'
    | 'beam-mismatch'
    | 'dmx-out-of-range'
    | 'dmx-not-integer'
    | 'fixture-mute'
    | 'channel-silent'
    | 'wheel-degenerate'
    | 'gobo-degenerate'
    | 'multi-arm-unused'
    | 'no-dimmer';
  fixture?: string;
  message: string;
}

export interface AuditFixtureRow {
  name: string;
  defId: string;
  addrStart: number;
  addrEnd: number;
  channelCount: number;
  /** Position reelle en metres (repere : -Z public, +Z fond, +X droite audience). */
  x: number;
  z: number;
  h: number;
  mountMode: string;
  headingDeg: number | null;
  /** Direction 3D au repos (ce que le renderer dessine). */
  dir3D: string;
  /** Direction physique au repos (ce que le materiel fera). */
  dirPhys: string;
  /** Ecart angulaire 3D <-> materiel (degres). null = fixture statique. */
  deltaDeg: number | null;
  /** Bornes DMX moteur (zone de balayage). */
  panRange: [number, number] | null;
  tiltRange: [number, number] | null;
  /** Octets pan/tilt ecrits au repos. */
  restPan: number | null;
  restTilt: number | null;
  /** Canaux utiles detectes par le moteur. */
  channels: {
    intensity: number | null;
    pan: number[];
    tilt: number[];
    rgb: number;
    wheel: number | null;
    gobo: number | null;
    strobe: number | null;
    shutter: number | null;
    effect: number | null;
    laser: boolean;
  };
  /** Canaux parlants jamais ecrits (audit de couverture). */
  silentChannels: string[];
  /** La fixture a-t-elle recu au moins une valeur > 0 sur sa plage ? */
  lit: boolean;
  /** Nombre max de canaux ecrits simultanement (activite). */
  maxChannelsWritten: number;
}

export interface AuditReport {
  projectPath: string;
  presetPath: string | null;
  fixtureCount: number;
  stageDims: { width: number; depth: number };
  universeCount: number;
  rows: AuditFixtureRow[];
  issues: AuditIssue[];
  /** Ecart max 3D <-> materiel (degres) sur les fixtures motorisees. */
  maxDeltaDeg: number;
  errors: number;
  warnings: number;
}

export interface AuditContext {
  projectPath: string;
  presetPath: string | null;
  fixturesRoot: string;
  proj: any;
  patched: any[];
  positions: Record<string, any>;
  dims: { width: number; depth: number };
  universes: { id: string }[];
  preset: any | null;
  defs: Map<string, any>;
  /** Ids de defs non resolus (la def n'existe ni dans le projet ni dans la bilotheque). */
  unresolved: string[];
}

export interface AuditOptions {
  projectPath: string;
  presetPath?: string | null;
  /** Racine des fixtures embarquees (defs QXF + OFL). Par defaut : <cwd>/resources/fixtures */
  fixturesRoot?: string;
}

// ─── Chargement du contexte ───────────────────────────────────────────

/**
 * Resout une def de bibliotheque sans charger TOUTE la bibliotheque :
 *  - QXF : le fichier porte le nom de la def (`<id>.qxf`) → parse ciblé ;
 *  - OFL : `<fabricant>/<modele>.json` → id = `<fabricant>-<modele>` (casse).
 */
function buildOflIndex(fixturesRoot: string): Map<string, string> {
  const index = new Map<string, string>();
  const oflDir = path.join(fixturesRoot, 'ofl');
  if (!fs.existsSync(oflDir)) return index;
  for (const mfr of fs.readdirSync(oflDir, { withFileTypes: true })) {
    if (!mfr.isDirectory()) continue;
    const mfrPath = path.join(oflDir, mfr.name);
    for (const f of fs.readdirSync(mfrPath, { withFileTypes: true })) {
      if (!f.isFile() || !f.name.endsWith('.json')) continue;
      const model = f.name.replace(/\.json$/i, '');
      const id = `${mfr.name}-${model}`.toLowerCase();
      if (!index.has(id)) index.set(id, path.join(mfrPath, f.name));
    }
  }
  return index;
}

/**
 * Charge le projet et resout TOUTES les defs de ses fixtures patchees.
 * Resolution : defs custom du projet → QXF (nom = id) → OFL (index) → ???
 */
export async function loadAuditContext(options: AuditOptions): Promise<AuditContext> {
  const projectPath = path.resolve(options.projectPath);
  if (!fs.existsSync(projectPath)) {
    throw new Error(`Projet introuvable : ${projectPath}`);
  }
  const fixturesRoot = path.resolve(options.fixturesRoot ?? path.join(process.cwd(), 'resources', 'fixtures'));

  const packed = await unpackProject(projectPath);
  const proj = JSON.parse(packed.content);
  const ss = proj.showStore ?? {};
  const patched: any[] = ss.patchedFixtures ?? [];
  const positions: Record<string, any> = ss.fixturePositions ?? {};
  const dims = ss.stageDims ?? { width: 10, depth: 8 };
  const universes: { id: string }[] = (ss.universes ?? []).map((u: any) => ({ id: String(u.id) }));

  let presetPath: string | null = null;
  let preset: any | null = null;
  if (options.presetPath) {
    presetPath = path.resolve(options.presetPath);
    if (fs.existsSync(presetPath)) {
      preset = JSON.parse(fs.readFileSync(presetPath, 'utf-8'));
    } else {
      presetPath = null;
    }
  } else {
    // Convention : <projet>.lmproj → <projet>.lmpreset
    const guess = projectPath.replace(/\.lmproj$/i, '.lmpreset');
    if (fs.existsSync(guess)) {
      presetPath = guess;
      preset = JSON.parse(fs.readFileSync(guess, 'utf-8'));
    }
  }

  // ─── Defs custom du projet ───
  const defs = new Map<string, any>();
  for (const d of proj.customFixtures ?? []) {
    if (d?.id) defs.set(d.id, d);
  }

  // ─── Defs de bibliotheque ───
  const lib = new FixtureLibrary();
  const oflIndex = buildOflIndex(fixturesRoot);
  const unresolved: string[] = [];

  for (const pf of patched) {
    const id = pf.fixtureDefId as string;
    if (defs.has(id)) continue;

    // QXF : le nom de fichier EST l'id de la def.
    const qxfPath = path.join(fixturesRoot, `${id}.qxf`);
    if (fs.existsSync(qxfPath)) {
      try {
        const xml = fs.readFileSync(qxfPath, 'utf8');
        const def = await lib.parseQLC(xml, qxfPath);
        if (def) {
          defs.set(id, def);
          continue;
        }
      } catch {
        /* def illisible : on tente l'OFL */
      }
    }

    // OFL : index chemin/id.
    const oflPath = oflIndex.get(id.toLowerCase());
    if (oflPath) {
      try {
        const content = fs.readFileSync(oflPath, 'utf-8');
        const mfr = path.basename(path.dirname(oflPath));
        const def = lib.parseOFLFixture(content, mfr);
        if (def) {
          defs.set(id, def);
          continue;
        }
      } catch {
        /* def illisible */
      }
    }

    unresolved.push(id);
  }

  return {
    projectPath,
    presetPath,
    fixturesRoot,
    proj,
    patched,
    positions,
    dims,
    universes,
    preset,
    defs,
    unresolved,
  };
}

// ─── Helpers geometrie ────────────────────────────────────────────────

/** Angle (rad) entre deux vecteurs. */
export function angleBetween(a: Vec3, b: Vec3): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  const na = Math.hypot(a.x, a.y, a.z);
  const nb = Math.hypot(b.x, b.y, b.z);
  if (na === 0 || nb === 0) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot / (na * nb))));
}

/** Direction telle que le renderer 3D la dessine (memes clamps, meme formule). */
export function dir3D(panVal: number, tiltVal: number, pose: FixtureAimPose, mode: string): Vec3 {
  const rawPan = ((panVal / 255) - 0.5) * pose.panSpanRad + pose.zeroPanRad;
  const panAbs = pose.headingRad + rawPan;
  const panTarget = clampPanZone(panAbs, pose.headingRad);
  const dmxTilt = ((tiltVal / 255) - 0.5) * pose.tiltSpanRad;
  const rawElev = dmxTilt + pose.staticTilt + pose.zeroTiltRad;
  const elev = clampTiltZone(rawElev, mode);
  const alpha = pose.mountTilt + elev;
  return {
    x: -Math.sin(alpha) * Math.sin(panTarget),
    y: -Math.cos(alpha),
    z: -Math.sin(alpha) * Math.cos(panTarget),
  };
}

/**
 * Direction PHYSIQUE du materiel : mecanique pure + tares physiques
 * (statique `pos.tilt` + zero `zeroPan`/`zeroTilt`), SANS clamp logiciel.
 */
export function dirPhys(panVal: number, tiltVal: number, pose: FixtureAimPose): Vec3 {
  const rawPan = ((panVal / 255) - 0.5) * pose.panSpanRad + pose.zeroPanRad;
  const phi = pose.headingRad + rawPan;
  const dmxTilt = ((tiltVal / 255) - 0.5) * pose.tiltSpanRad;
  const alpha = pose.mountTilt + dmxTilt + pose.staticTilt + pose.zeroTiltRad;
  return {
    x: -Math.sin(alpha) * Math.sin(phi),
    y: -Math.cos(alpha),
    z: -Math.sin(alpha) * Math.cos(phi),
  };
}

/** Description lisible d'une direction (français). */
export function describeDir(d: Vec3): string {
  const parts: string[] = [];
  if (d.y < -0.15) parts.push('bas');
  else if (d.y > 0.15) parts.push('haut');
  else parts.push('horizontal');
  if (d.x > 0.15) parts.push('droite');
  else if (d.x < -0.15) parts.push('gauche');
  if (d.z > 0.15) parts.push('arriere');
  else if (d.z < -0.15) parts.push('public');
  return parts.join('/');
}

/**
 * Noms de caps qui designent un EMPLACEMENT DE COULEUR (slot rouge, vert…).
 * Un laser monochrome (TONIO LASER 4W) a des caps « COLOR » qui sont des
 * MODES (COLOR CHANGE, RAINBOW…) : tous en #ff0000, ce qui est normal.
 */
const COLOUR_SLOT_NAME_RE =
  /\b(red|green|blue|cyan|magenta|yellow|amber|white|orange|purple|violet|pink|lime|indigo|rouge|vert|bleu|jaune|blanc|violet|rose|orange)\b/i;

/**
 * Roue couleur DEGENEREE ?
 *
 * On ne peut PAS se contenter de « tous les caps ont la meme couleur » : un
 * laser monochrome legitime a des caps couleur tous identiques. Le cas
 * degeneré (cf. AGENTS) est : la def declare des slots de couleur NOMMES
 * (RED, GREEN, BLUE…) mais tous carrying la MEME couleur → la def a ete
 * mal remplie et la fixture ne pourra jamais changer de couleur.
 */
function degenerateColourWheel(fa: FixtureChannelAnalysis): { color: string; slots: number } | null {
  const caps = fa.wheelCaps ?? [];
  if (caps.length < 2) return null;
  const colors = new Set(caps.map((c: any) => String(c.color ?? '').toLowerCase()));
  if (colors.size > 1) return null;                     // couleurs distinctes : OK
  const named = caps.filter((c: any) => COLOUR_SLOT_NAME_RE.test(c.name ?? ''));
  if (named.length < 2) return null;                     // ce ne sont pas des slots de couleur
  if (named.some((c: any) => c.image)) return null;      // images de gobos → roue graphique
  return { color: [...colors][0], slots: named.length };
}

// ─── Audit ─────────────────────────────────────────────────────────────

const TIERS = { primary: 100, secondary: 70, tertiary: 40, other: 40 } as any;

/**
 * Audit complet d'un projet : position par position + faisceau + DMX + defs.
 * Ne leve JAMAIS : toutes les anomalies sont collectees dans `report.issues`.
 */
export function auditProject(ctx: AuditContext): AuditReport {
  const issues: AuditIssue[] = [];
  const rows: AuditFixtureRow[] = [];
  const { patched, defs, positions, dims, universes } = ctx;

  // Univers de repli si le projet n'en declare aucun.
  const unis: { id: string }[] = universes.length ? universes : [{ id: 'universe-1' }];

  // ─── 1. Analyse moteur + couverture par fixture ───
  const analyses = new Map<string, FixtureChannelAnalysis>();
  const coverages = new Map<string, FixtureCoverageReport>();
  for (const pf of patched) {
    const def = defs.get(pf.fixtureDefId);
    if (!def) {
      issues.push({
        severity: 'error',
        code: 'def-unresolved',
        fixture: pf.name,
        message: `${pf.name} : def "${pf.fixtureDefId}" introuvable (ni custom projet, ni QXF, ni OFL)`,
      });
      continue;
    }
    const fa = analyzeChannels(pf, def);
    analyses.set(pf.id, fa);
    const cov = auditFixtureCoverage(pf, def, fa);
    coverages.set(pf.id, cov);
    for (const w of cov.warnings) {
      issues.push({
        severity: 'error',
        code: 'channel-silent',
        fixture: pf.name,
        message: `${pf.name} : canal parlant ch${w.offset} "${w.name}" (${w.type}) jamais écrit par le moteur`,
      });
    }
    // Roue couleur DEGENEREE : la def declare des slots de couleur nommes
    // (RED / GREEN / BLUE…) mais tous carrying la MEME couleur → la fixture
    // ne pourra pas changer de couleur (def a corriger).
    const degen = degenerateColourWheel(fa);
    if (degen) {
      issues.push({
        severity: 'warn',
        code: 'wheel-degenerate',
        fixture: pf.name,
        message: `${pf.name} : roue couleur degeneree (${degen.slots} slots nommes, 1 seule couleur "${degen.color}") — la fixture ne peut pas changer de couleur`,
      });
    }
    // Roue gobo DEGENEREE : tous les caps pointent la meme valeur.
    const gobo = fa.goboCaps ?? [];
    if (gobo.length > 1) {
      const mids = new Set(gobo.map((c: any) => Math.round((c.min + c.max) / 2)));
      if (mids.size === 1) {
        issues.push({
          severity: 'warn',
          code: 'gobo-degenerate',
          fixture: pf.name,
          message: `${pf.name} : roue gobo degeneree (${gobo.length} caps, meme slot ${[...mids][0]})`,
        });
      }
    }
    // Fixture sans dimmer : elle ne peut pas etre reglee en intensite.
    if (fa.intensityOffset === null && fa.rgbSegments.length === 0 && !fa.isLaser) {
      issues.push({
        severity: 'warn',
        code: 'no-dimmer',
        fixture: pf.name,
        message: `${pf.name} : aucun canal intensity ni RGB detecte — la fixture ne peut pas etre reglee`,
      });
    }
  }

  // ─── 2. Timeline : le DMX reellement ecrit ───
  // On rejoue le moteur sur une serie de cues (les sections du preset si
  // disponible, sinon une grille synthetique) + une densite a 50 ms.
  const cues = buildAuditCues(ctx);
  const writtenByCue: Record<number, number> = {};
  const maxWritten = new Map<string, number>();
  const everLit = new Set<string>();
  const perFixtureWritten = new Map<string, Set<number>>();
  /** Ecart max 3D <-> materiel (degres), mesure sur les BYTES reellement ecrits. */
  let maxDelta = 0;

  /**
   * INVARIANT CENTRAL — compare les BYTES REELLEMENT ECRITS, pas une valeur
   * recalculee :
   *   (A) ce que le RENDERER 3D dessine  = clampPanZone / clampTiltZone(byte)
   *   (B) ce que le MATERIEL fera         = mecanique + tares, SANS clamp
   *   (le materiel ne connait pas nos zones de balayage : si le moteur
   *    ecrit un byte hors zone, la 3D le ramene dans la zone et le faisceau
   *    physique part ailleurs → DIVERGENCE.)
   *
   * C'est exactement le bug corrige en 1.0.45 (ecart jusqu'a 89,6°).
   */
  const beamChecked = new Set<string>();
  const checkBeamOnWrittenBytes = (written: Record<number, number>) => {
    for (const pf of patched) {
      const fa = analyses.get(pf.id);
      if (!fa) continue;
      if (fa.panOffsets.length === 0 && fa.tiltOffsets.length === 0) continue;
      const pos = positions[pf.id] ?? { x: 0.5, y: 0.5, h: 3, mountMode: 'hanging' };
      const mode = pos.mountMode ?? 'hanging';
      const panMax = fa.panMaxDeg ?? 540;
      const tiltMax = fa.tiltMaxDeg ?? 180;
      const pose = poseFromPos(pos as PosePos, mode, dims, true, { panMaxDeg: panMax, tiltMaxDeg: tiltMax });

      const arms = Math.max(fa.panOffsets.length, fa.tiltOffsets.length);
      // Le pan est un MASTER partage : quand la fixture n'a qu'un seul
      // canal pan (6 ARM : 1 pan + 6 tilt), tous les bras partagent le meme
      // byte de pan → on lit celui du bras 0 pour tous les bras.
      const masterPanByte = fa.panOffsets[0] !== undefined
        ? written[pf.startAddress + fa.panOffsets[0]]
        : undefined;
      for (let m = 0; m < arms; m++) {
        const panByte = fa.panOffsets.length > 1
          ? (fa.panOffsets[m] !== undefined ? written[pf.startAddress + fa.panOffsets[m]] : undefined)
          : masterPanByte;
        const tiltByte = fa.tiltOffsets[m] !== undefined
          ? written[pf.startAddress + fa.tiltOffsets[m]]
          : undefined;
        if (panByte === undefined && tiltByte === undefined) continue;
        const panVal = panByte ?? 128;
        const tiltVal = tiltByte ?? 128;
        const d3d = dir3D(panVal, tiltVal, pose, mode);
        const dphys = dirPhys(panVal, tiltVal, pose);
        const delta = (angleBetween(d3d, dphys) * 180) / Math.PI;
        if (delta > maxDelta) maxDelta = delta;
        if (delta <= 0.5) continue;
        const key = `${pf.id}|${m}`;
        const detail =
          `${pf.name} : le byte ecrit (pan=${panVal} tilt=${tiltVal}) designe un faisceau ` +
          `DIFFERENT en 3D (${describeDir(d3d)}) et sur le materiel (${describeDir(dphys)}) — ${delta.toFixed(2)}°`;
        if (beamChecked.has(key)) continue;
        beamChecked.add(key);
        issues.push({
          severity: 'error',
          code: 'beam-mismatch',
          fixture: pf.name,
          message: detail,
        });
      }
    }
  };

  const applyWritten = (written: Record<number, number>) => {
    for (const [addrStr, val] of Object.entries(written)) {
      const addr = Number(addrStr);
      if (!Number.isInteger(val)) {
        issues.push({
          severity: 'error',
          code: 'dmx-not-integer',
          message: `canal ${addr} : valeur DMX non entiere (${val}) — la trame Uint8Array la tronquerait`,
        });
      }
      if (val < 0 || val > 255) {
        issues.push({
          severity: 'error',
          code: 'dmx-out-of-range',
          message: `canal ${addr} : valeur DMX hors plage (${val})`,
        });
      }
    }
    for (const pf of patched) {
      const start = pf.startAddress;
      const end = start + pf.channelCount - 1;
      // DEUX collectes distinctes :
      //  - `hit` : canaux dont la valeur est > 0 (la fixture est-elle eclairee ?)
      //  - `present` : canaux reellement presents dans la trame (une valeur 0
      //    compte comme « ecrit » : un canal « fine » a 0 quand le coarse est
      //    clampe, un pan a 0 est une position legitime).
      const hit = new Set<number>();
      const present = new Set<number>();
      for (const [addrStr, val] of Object.entries(written)) {
        const addr = Number(addrStr);
        if (addr < start || addr > end) continue;
        present.add(addr);
        if (val > 0) hit.add(addr);
      }
      if (hit.size) everLit.add(pf.id);
      const prev = perFixtureWritten.get(pf.id) ?? new Set<number>();
      for (const a of present) prev.add(a);
      perFixtureWritten.set(pf.id, prev);
      maxWritten.set(pf.id, Math.max(maxWritten.get(pf.id) ?? 0, hit.size));
    }
  };

  for (const cue of cues) {
    // Les positions sont passees comme dans le tick live : sans elles, le
    // moteur ignore les tares (zeroPan/zeroTilt) et ecrit des bytes hors
    // zone — l'audit doit auditer ce que le LIVE ecrit, pas une variante.
    const dmx = computeDmxForCue(cue, patched, defs as any, unis, TIERS, undefined, undefined, undefined, undefined, undefined, positions as any);
    const written: Record<number, number> = {};
    for (const d of dmx) {
      for (const [addr, val] of Object.entries(d.channelValues)) {
        written[Number(addr)] = val as number;
        writtenByCue[Number(addr)] = val as number;
      }
    }
    applyWritten(written);
    checkBeamOnWrittenBytes(written);
  }

  // ─── 2b. Axes pan/tilt : TOUS les offsets (coarse + fine + bras multiples)
  // doivent avoir ete ecrits au moins une fois. Un bras de tete non pilote
  // = une tete figee (cf. notes multi-pan-tilt.md). Un canal « fine » non
  // ecrit = sous-resolution perdue (la couverture ne le voit pas : un canal
  // « fine » est classe silent-benign).
  for (const pf of patched) {
    const fa = analyses.get(pf.id);
    if (!fa) continue;
    const writtenSet = perFixtureWritten.get(pf.id) ?? new Set<number>();
    const offsets: Array<{ off: number; axis: string; kind: string }> = [];
    fa.panOffsets.forEach((o: number, arm: number) => offsets.push({ off: o, axis: 'pan', kind: `bras ${arm}` }));
    fa.tiltOffsets.forEach((o: number, arm: number) => offsets.push({ off: o, axis: 'tilt', kind: `bras ${arm}` }));
    fa.panFineOffsets.forEach((o: number | null, arm: number) => {
      if (o !== null && o !== undefined) offsets.push({ off: o, axis: 'pan', kind: `fine bras ${arm}` });
    });
    fa.tiltFineOffsets.forEach((o: number | null, arm: number) => {
      if (o !== null && o !== undefined) offsets.push({ off: o, axis: 'tilt', kind: `fine bras ${arm}` });
    });
    const multiArm = fa.panOffsets.length > 1 || fa.tiltOffsets.length > 1;
    for (const o of offsets) {
      const addr = pf.startAddress + o.off;
      if (writtenSet.has(addr)) continue;
      issues.push({
        severity: multiArm ? 'error' : 'warn',
        code: 'multi-arm-unused',
        fixture: pf.name,
        message: `${pf.name} : ${o.axis} ${o.kind} (ch${addr}) jamais ecrit sur toute la timeline`,
      });
    }
  }

  // ─── 3. Tableau position par position ───
  for (const pf of patched) {
    const def = defs.get(pf.fixtureDefId);
    const fa = analyses.get(pf.id);
    const pos = positions[pf.id] ?? { x: 0.5, y: 0.5, h: 3, mountMode: 'hanging' };
    const mode = pos.mountMode ?? 'hanging';
    const x = ((pos.x ?? 0.5) - 0.5) * dims.width;
    const z = ((pos.y ?? 0.5) - 0.5) * dims.depth;
    const h = pos.h ?? 0;
    const addrStart = pf.startAddress;
    const addrEnd = pf.startAddress + pf.channelCount - 1;

    const cov = coverages.get(pf.id);
    const silent = cov ? cov.warnings.map((c) => `ch${c.offset} "${c.name}"`) : [];

    const base: AuditFixtureRow = {
      name: pf.name,
      defId: pf.fixtureDefId,
      addrStart,
      addrEnd,
      channelCount: pf.channelCount,
      x,
      z,
      h,
      mountMode: mode,
      headingDeg: null,
      dir3D: 'statique',
      dirPhys: 'statique',
      deltaDeg: null,
      panRange: null,
      tiltRange: null,
      restPan: null,
      restTilt: null,
      channels: {
        intensity: fa?.intensityOffset ?? null,
        pan: fa?.panOffsets ?? [],
        tilt: fa?.tiltOffsets ?? [],
        rgb: fa?.rgbSegments.length ?? 0,
        wheel: fa?.wheelOffset ?? null,
        gobo: fa?.goboOffset ?? null,
        strobe: fa?.strobeOffset ?? null,
        shutter: fa?.shutterOffset ?? null,
        effect: fa?.effectOffset ?? null,
        laser: fa?.isLaser ?? false,
      },
      silentChannels: silent,
      lit: everLit.has(pf.id),
      maxChannelsWritten: maxWritten.get(pf.id) ?? 0,
    };

    // Fixture muette : aucun canal > 0 sur toute la timeline.
    // (une def non resolue est deja signalee par `def-unresolved` : on ne la
    //  signale pas EN PLUS comme muette, sinon le rapport est bruyant.)
    if (!base.lit && patched.length > 0 && fa) {
      issues.push({
        severity: 'error',
        code: 'fixture-mute',
        fixture: pf.name,
        message: `${pf.name} : fixture MUETTE (aucun canal ecrit > 0 sur toute la timeline)`,
      });
    }

    if (!fa || (fa.panOffsets.length === 0 && fa.tiltOffsets.length === 0)) {
      rows.push(base);
      continue;
    }

    const panMax = fa.panMaxDeg ?? 540;
    const tiltMax = fa.tiltMaxDeg ?? 180;
    const pose = poseFromPos(pos as PosePos, mode, dims, true, { panMaxDeg: panMax, tiltMaxDeg: tiltMax });

    // Bornes moteur.
    const panLo = clampPanZoneDmx(0, panMax, pos.zeroPan);
    const panHi = clampPanZoneDmx(255, panMax, pos.zeroPan);
    const tiltLo = clampTiltZoneDmx(0, tiltMax, mode, pos.tilt, pos.zeroTilt);
    const tiltHi = clampTiltZoneDmx(255, tiltMax, mode, pos.tilt, pos.zeroTilt);

    // Repos = centre capture (ou neutre) BORNE par la zone moteur.
    const zeroPd = Math.round(((pos.centerPan ?? 0) / 540) * 255);
    const zeroTd = Math.round(((pos.centerTilt ?? 0) / 180) * 255);
    const restPan = Math.round(Math.max(panLo, Math.min(panHi, 128 + zeroPd)));
    const restTilt = Math.round(Math.max(tiltLo, Math.min(tiltHi, 128 + zeroTd)));

    const d3d = dir3D(restPan, restTilt, pose, mode);
    const dphys = dirPhys(restPan, restTilt, pose);
    const delta = (angleBetween(d3d, dphys) * 180) / Math.PI;

    base.headingDeg = Number(((pose.headingRad * 180) / Math.PI).toFixed(1));
    base.dir3D = describeDir(d3d);
    base.dirPhys = describeDir(dphys);
    base.deltaDeg = Number(delta.toFixed(2));
    base.panRange = [Math.round(panLo), Math.round(panHi)];
    base.tiltRange = [Math.round(tiltLo), Math.round(tiltHi)];
    base.restPan = restPan;
    base.restTilt = restTilt;

    // La valeur de REPOS doit elle aussi designer le meme faisceau en 3D et
    // sur le materiel (c'est la pose affichee quand l'autoscript est au repos).
    if (delta > 0.5) {
      issues.push({
        severity: 'error',
        code: 'beam-mismatch',
        fixture: pf.name,
        message: `${pf.name} : au repos, la vue 3D (${base.dir3D}) et le materiel (${base.dirPhys}) designent des faisceaux DIFFERENTS (${delta.toFixed(2)}°)`,
      });
    }

    rows.push(base);
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warn').length;

  return {
    projectPath: ctx.projectPath,
    presetPath: ctx.presetPath,
    fixtureCount: patched.length,
    stageDims: dims,
    universeCount: universes.length,
    rows,
    issues,
    maxDeltaDeg: Number(maxDelta.toFixed(2)),
    errors,
    warnings,
  };
}

/**
 * Construit la liste de cues rejouee par l'audit : les sections du preset si
 * disponible, sinon une grille synthetique. On ajoute une densite a 50 ms sur
 * la section la plus dense (le moteur peut y produire des paliers).
 */
function buildAuditCues(ctx: AuditContext): any[] {
  const sections: any[] =
    ctx.preset?.sections?.length
      ? ctx.preset.sections.map((s: any) => ({
          type: s.type,
          startTime: s.startTime,
          endTime: s.endTime,
          energy: s.energy ?? 0.5,
          color: s.color ?? '#888',
        }))
      : [
          { type: 'intro', startTime: 0, endTime: 15, energy: 0.3, color: '#888' },
          { type: 'verse', startTime: 15, endTime: 35, energy: 0.5, color: '#888' },
          { type: 'chorus', startTime: 35, endTime: 55, energy: 0.9, color: '#888' },
          { type: 'drop', startTime: 55, endTime: 75, energy: 0.95, color: '#888' },
        ];

  const cues: any[] = [];
  for (const s of sections) {
    for (const t of [s.startTime, (s.startTime + s.endTime) / 2, s.endTime - 0.01]) {
      cues.push({
        time: t,
        section: s.type,
        intensity: 'high',
        color: '#ff3333',
        movement: 'sweep',
        effect: 'vegas',
        energy: s.energy,
        colors: ['#ff3333', '#33ff33'],
        sectionStart: s.startTime,
        sectionEnd: s.endTime,
      });
    }
  }

  // Densite 50 ms sur la section la plus dense.
  const dense = sections.find((s) => s.type === 'drop')
    ?? sections.find((s) => s.type === 'chorus')
    ?? sections[0];
  const base = cues.find((c) => c.sectionStart === dense.startTime) ?? cues[0];
  const STEP = 0.05;
  const SPAN = Math.min(4, dense.endTime - dense.startTime);
  const STEPS = Math.max(20, Math.floor(SPAN / STEP));
  for (let i = 0; i <= STEPS; i++) {
    cues.push({ ...base, time: dense.startTime + i * STEP, energy: base.energy });
  }
  return cues;
}

// ─── Rendu console ─────────────────────────────────────────────────────

function pad(s: string, n: number): string {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

/** Rapport texte (tableau position par position + anomalies). */
export function formatAuditReport(report: AuditReport): string {
  const out: string[] = [];
  const rel = (p: string | null) => (p ? path.basename(p) : '—');

  out.push('');
  out.push(`=== AUDIT PROJET : ${rel(report.projectPath)} ===`);
  out.push(
    `${report.fixtureCount} fixtures patchées · scène ${report.stageDims.width}×${report.stageDims.depth} m · ` +
    `${report.universeCount} univers · preset ${rel(report.presetPath)}`,
  );
  out.push('');
  out.push(
    `${pad('fixture', 30)} ${pad('addr', 9)} ${pad('X/Z/h (m)', 18)} ${pad('mount', 8)} ` +
    `${pad('heading', 9)} ${pad('3D defaut', 18)} ${pad('materiel defaut', 18)} ${pad('bornes DMX pan/tilt', 22)}`,
  );

  for (const r of report.rows) {
    const ranges = r.panRange
      ? `pan[${r.panRange[0]}-${r.panRange[1]}] tilt[${r.tiltRange![0]}-${r.tiltRange![1]}]`
      : '(pas de pan/tilt)';
    out.push(
      `${pad(r.name, 30)} ${pad(`${r.addrStart}-${r.addrEnd}`, 9)} ` +
      `${pad(`${r.x.toFixed(2)}/${r.z.toFixed(2)}/${r.h.toFixed(2)}`, 18)} ${pad(r.mountMode, 8)} ` +
      `${pad(r.headingDeg === null ? '—' : `${r.headingDeg}°`, 9)} ` +
      `${pad(r.dir3D, 18)} ${pad(r.dirPhys, 18)} ${pad(ranges, 22)}` +
      `${r.deltaDeg !== null ? `  Δ3D=${r.deltaDeg.toFixed(2)}°` : ''}`,
    );
  }

  out.push('');
  out.push('=== CANAUX DETECTES PAR LE MOTEUR ===');
  for (const r of report.rows) {
    const c = r.channels;
    out.push(
      `  ${pad(r.name, 30)} intensity=${c.intensity ?? '–'} pan=[${c.pan.join(',')}] tilt=[${c.tilt.join(',')}] ` +
      `rgb=${c.rgb} wheel=${c.wheel ?? '–'} gobo=${c.gobo ?? '–'} strobe=${c.strobe ?? '–'} ` +
      `shutter=${c.shutter ?? '–'} effect=${c.effect ?? '–'} laser=${c.laser ? 'oui' : 'non'} ` +
      `| ecrits=${r.maxChannelsWritten} ${r.lit ? 'éclairée' : 'MUETTE'}`,
    );
  }

  if (report.issues.length) {
    out.push('');
    out.push('=== ANOMALIES ===');
    for (const i of report.issues) {
      out.push(`  [${i.severity === 'error' ? 'ERREUR' : 'AVERT'}] (${i.code}) ${i.message}`);
    }
  }

  out.push('');
  out.push(
    `Écart max 3D ↔ matériel : ${report.maxDeltaDeg.toFixed(2)}° · ` +
    `${report.errors} erreur(s), ${report.warnings} avertissement(s)`,
  );
  out.push('');
  return out.join('\n');
}
