import { useEffect, useRef } from 'react';
import { useRgbMatrixStore } from '../stores/rgbmatrixStore';
import { useShowStore } from '../stores/showStore';
import { dmxBridge } from '../utils/dmx-bridge';
import { loadFixtureDefinitions } from './dmx-cues';
import { analyzeChannels, mapIntensityVal, capMid } from '../engine/fixture-analyzer';
import { findBestWheelCap, wheelDegeneratePosition } from '../engine/dmx-color';
import { getPatternColor, hexToRgb } from '../engine/rgb-matrix-patterns';

export interface MatrixTrackEntryLike {
  time: number;
  endTime: number;
  matrixId: string;
}

/** Matrices actives à l'instant t (secondes) sur des pistes matrix. */
export function collectActiveMatrixIds(
  tracks: Array<{ entries: MatrixTrackEntryLike[] }> | null | undefined,
  timeSec: number,
): string[] {
  if (!tracks || tracks.length === 0) return [];
  const out = new Set<string>();
  for (const t of tracks) {
    for (const e of t.entries ?? []) {
      const s = Math.min(e.time, e.endTime);
      const en = Math.max(e.time, e.endTime);
      if (timeSec >= s && timeSec < en && e.matrixId) out.add(e.matrixId);
    }
  }
  return [...out];
}

export interface MatrixTrackLike { entries: MatrixTrackEntryLike[] }

export interface IncompatibleFixture {
  id: string;
  name: string;
  reason: string;
}

/**
 * Fixtures d'un groupe INCAPABLES de rendre une matrice RGB : ni canal RGB,
 * ni roue couleur exploitable (ex. dimmer seul, spot sans couleur). Ces
 * fixtures resteront noires dans la matrice — il faut le signaler très
 * visuellement dans l'onglet Matrice ET dans les scènes pré-enregistrées.
 * Une def non résolue n'est PAS signalée (ne pas crier au loup pendant le
 * chargement).
 */
export function findIncompatibleFixtures(
  groupFixtures: Array<{ id: string; name?: string; fixtureDefId: string }>,
  defOf: (id: string) => unknown | undefined,
): IncompatibleFixture[] {
  const out: IncompatibleFixture[] = [];
  for (const f of groupFixtures) {
    const def = defOf(f.fixtureDefId);
    if (!def) continue;
    let fa: ReturnType<typeof analyzeChannels>;
    try {
      fa = analyzeChannels(f as never, def as never);
    } catch { continue; }
    const hasRgb = (fa.rgbOffsets?.length ?? 0) > 0 || (fa.rgbSegments?.length ?? 0) > 0;
    const hasWheel = !fa.isLaser
      && fa.wheelOffset !== null && fa.wheelOffset !== undefined && fa.wheelOffset >= 0
      && (fa.wheelCaps?.length ?? 0) > 0;
    if (!hasRgb && !hasWheel) {
      out.push({
        id: f.id,
        name: f.name || f.id,
        reason: 'pas de canal RGB ni de roue couleur',
      });
    }
  }
  return out;
}

export interface MatrixTrackColorResult {
  /** fixtureId → couleur hex du motif de la matrice (chevauche la couleur autoscript). */
  colors: Map<string, string>;
  /** fixtureId → strobe, uniquement si le motif de la matrice est 'strobe'. */
  strobe: Map<string, { active: boolean; speed: number }>;
}

/**
 * Couleurs par fixture pour les pistes matrice actives à `currentTime`.
 * Ne fournit QUE la couleur (et le strobe du motif le cas échéant) : le
 * mouvement et le dimmer restent la propriété de l'autoscript.
 */
export function computeMatrixTrackColors(
  tracks: MatrixTrackLike[] | null | undefined,
  currentTime: number,
  fixtureGroups: Array<{ id: string; fixtureIds: string[] }>,
  matrices: Array<{
    id: string; groupId: string; pattern: string; cols: number; rows: number;
    speed: number; startColor: string; endColor: string; width: number;
    direction?: string; offset?: number;
  }>,
): MatrixTrackColorResult {
  const colors = new Map<string, string>();
  const strobe = new Map<string, { active: boolean; speed: number }>();
  if (!tracks || tracks.length === 0) return { colors, strobe };

  for (const t of tracks) {
    for (const e of t.entries ?? []) {
      const s = Math.min(e.time, e.endTime);
      const en = Math.max(e.time, e.endTime);
      if (!(currentTime >= s && currentTime < en)) continue;
      const mx = matrices.find(m => m.id === e.matrixId);
      if (!mx) continue;
      const grp = fixtureGroups.find(g => g.id === mx.groupId);
      if (!grp) continue;
      const cellCount = Math.max(1, mx.cols * mx.rows);
      const startRgb = hexToRgb(mx.startColor);
      const endRgb = hexToRgb(mx.endColor);
      const phase = currentTime * mx.speed;
      const last = Math.min(grp.fixtureIds.length, cellCount);
      for (let i = 0; i < last; i++) {
        const col = i % mx.cols;
        const row = Math.floor(i / mx.cols);
        const isStrobe = mx.pattern === 'strobe';
        // Motif strobe : la couleur reste pleine, c'est le shutter qui clignote.
        // Sans ça, couleur et shutter moduleraient ensemble (double flash).
        const [r, g, b] = isStrobe
          ? startRgb
          : getPatternColor(mx.pattern, col, row, mx.cols, mx.rows, phase, startRgb, endRgb, mx.width, mx.direction, mx.offset ?? 0);
        const hex = '#' + [r, g, b]
          .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
          .join('');
        colors.set(grp.fixtureIds[i], hex);
        if (isStrobe) {
          strobe.set(grp.fixtureIds[i], { active: true, speed: Math.max(1, Math.min(10, 2 + mx.speed * 6)) });
        }
      }
    }
  }
  return { colors, strobe };
}

/**
 * Rend une frame DMX complète pour une matrice à la phase donnée (pur, synchrone).
 * Mêmes règles auto que le lecteur live : RGB/roue + dimmer + shutter.
 * Retourne universIdx → canaux, plus le nombre de fixtures résolues.
 */
export function renderMatrixFrame(
  matrix: { pattern: string; cols: number; rows: number; speed: number; startColor: string; endColor: string; width: number; direction?: string; offset?: number },
  phaseSec: number,
  groupFixtures: Array<{ id: string; fixtureDefId: string; universeId: string; startAddress: number }>,
  defOf: (fixtureDefId: string) => any | undefined,
  universeIndexOf: (universeId: string) => number,
  wheelTimeSec: number,
): { perUniverse: Map<number, Record<number, number>>; resolved: number } {
  const perUniverse = new Map<number, Record<number, number>>();
  let resolved = 0;
  const { cols, rows } = matrix;
  const cellCount = Math.max(1, cols * rows);
  const startRgb = hexToRgb(matrix.startColor);
  const endRgb = hexToRgb(matrix.endColor);

  for (let i = 0; i < Math.min(groupFixtures.length, cellCount); i++) {
    const fixture = groupFixtures[i];
    const col = i % cols;
    const row = Math.floor(i / cols);

    const [r, g, b] = getPatternColor(
      matrix.pattern, col, row, cols, rows,
      phaseSec, startRgb, endRgb, matrix.width,
      matrix.direction, matrix.offset ?? 0,
    );

    const def = defOf(fixture.fixtureDefId);
    if (!def) continue;
    let fa: ReturnType<typeof analyzeChannels>;
    try {
      fa = analyzeChannels(fixture as any, def);
    } catch { continue; }
    const lit = r > 0 || g > 0 || b > 0;
    const rgb = fa.rgbOffsets;
    const hasRgb = !!rgb && rgb.length > 0;
    const hasWheel = !fa.isLaser && fa.wheelOffset !== null && fa.wheelOffset !== undefined
      && fa.wheelOffset >= 0 && (fa.wheelCaps?.length ?? 0) > 0;
    if (!hasRgb && !hasWheel) continue;

    const uniIdx = universeIndexOf(fixture.universeId);
    if (uniIdx < 0) continue;
    const addr = fixture.startAddress;
    let uniVals = perUniverse.get(uniIdx);
    if (!uniVals) { uniVals = {}; perUniverse.set(uniIdx, uniVals); }
    if (hasRgb) {
      if (rgb![0] !== undefined) uniVals[addr + rgb![0]] = r;
      if (rgb![1] !== undefined) uniVals[addr + rgb![1]] = g;
      if (rgb![2] !== undefined) uniVals[addr + rgb![2]] = b;
    } else if (lit && hasWheel) {
      const cellHex = '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
      let wheelVal: number | null = null;
      try {
        wheelVal = wheelDegeneratePosition(fa.wheelCaps ?? [], fa, cellHex, wheelTimeSec);
      } catch { wheelVal = null; }
      if (wheelVal === null || wheelVal === undefined) {
        const best = findBestWheelCap(fa.wheelCaps ?? [], cellHex);
        wheelVal = best ? capMid(best) : null;
      }
      if (wheelVal !== null && wheelVal !== undefined) uniVals[addr + fa.wheelOffset!] = wheelVal;
    }
    if (fa.intensityOffset !== null && fa.intensityOffset !== undefined && fa.intensityOffset >= 0) {
      uniVals[addr + fa.intensityOffset] = mapIntensityVal(lit ? 255 : 0, fa);
    }
    if (lit && fa.shutterOffset !== null && fa.shutterOffset !== undefined && fa.shutterOffset >= 0) {
      uniVals[addr + fa.shutterOffset] = 255;
    }
    resolved++;
  }
  return { perUniverse, resolved };
}

/**
 * Matrices momentanément pilotées par une PISTE de preset (QuickShow) :
 * le moteur écrit leurs couleurs via colorTrackColors (horloge de lecture).
 * Le hook RAF ci-dessous doit les IGNORER — sinon double pilote avec deux
 * horloges différentes (couleurs qui se battent, phases incohérentes).
 */
const presetDriven = new Set<string>();

/** Appelé à chaque tick du lecteur avec les ids de matrices actives sur pistes. */
export function markMatrixPresetDriven(ids: string[]): void {
  presetDriven.clear();
  for (const id of ids) presetDriven.add(id);
}

// ── Verrou « le lecteur possède la sortie » ────────────────────────────────
// Pendant une lecture QuickShow (preset), la matrice laissée activée dans
// l'onglet ne doit PAS réécrire ses cellules en LTP (une cellule éteinte
// dimmer=0 écraserait le dimmer 255 du preset → fixtures à moitié éteintes
// selon la phase du motif). Le tick du lecteur pose ce drapeau ~60×/s ; le
// hook RAF s'efface tant qu'il est frais (< 600 ms).
let lastEngineTickAt = 0;

/** À appeler à chaque frame du lecteur QuickShow (useDmxPlayback). */
export function noteEngineTick(): void {
  lastEngineTickAt = performance.now();
}

function engineOwnsOutput(): boolean {
  return performance.now() - lastEngineTickAt < 600;
}

/**
 * Active les matrices données (edge-triggered, mémorise l'état précédent),
 * à appeler à chaque frame de lecture avec les ids en plage.
 */
export function syncMatrixEnabled(activeIds: string[], stash: Map<string, boolean>): void {
  try {
    const mx = useRgbMatrixStore.getState();
    for (const mid of activeIds) {
      const m = mx.matrices.find((mm) => mm.id === mid);
      if (!m || m.enabled || stash.has(mid)) continue;
      stash.set(mid, m.enabled);
      mx.updateMatrix(mid, { enabled: true });
    }
    for (const [mid, prev] of stash) {
      if (activeIds.includes(mid)) continue;
      stash.delete(mid);
      mx.updateMatrix(mid, { enabled: prev });
    }
  } catch {}
}

/** Restaure les matrices activées par la lecture (stop). */
export function restoreMatrixEnabled(stash: Map<string, boolean>): void {
  try {
    const mx = useRgbMatrixStore.getState();
    for (const [mid, prev] of stash) mx.updateMatrix(mid, { enabled: prev });
    stash.clear();
  } catch {}
}

/**
 * Extinction de fin : quand plus aucune matrice n'est active, les dernières
 * valeurs écrites resteraient sinon figées dans l'arbitre (contribution
 * persistante) — fixtures allumées alors que le motif est fini. On flush des
 * zéros TRANSITOIRES COURTS (150 ms : le motif s'éteint proprement puis la
 * source est relâchée et le contenu reprend la main — un flush 2 s créait un
 * blackout de 2 s pendant les shows), puis on vide le registre.
 */
export function flushMatrixIdle(
  lastAddrs: Map<number, Set<number>>,
  writeTransient: (universe: number, zeros: Record<number, number>) => void,
): void {
  for (const [uni, addrs] of lastAddrs) {
    if (addrs.size === 0) continue;
    const zeros: Record<number, number> = {};
    for (const a of addrs) zeros[a] = 0;
    try { writeTransient(uni, zeros); } catch { /* sortie best effort */ }
  }
  lastAddrs.clear();
}

export function useRgbMatrixPlayback() {
  const rafRef = useRef<number>(0);
  // Horloge PAR ACTIVATION : t=0 quand la matrice passe enabled (toggle tab ou
  // activation par piste Show) → phase déterministe, pas « phase de l'app ».
  const activationRef = useRef(new Map<string, number>());
  const lastFrameRef = useRef<number>(0);
  // Adresses écrites par univers : registre d'extinction (flushMatrixIdle).
  const lastAddrsRef = useRef(new Map<number, Set<number>>());
  // Cache des définitions (le tick RAF est synchrone : chargement en
  // tâche de fond, les fixtures s'allument dès que leur def est résolue).
  const defCacheRef = useRef(new Map<string, any>());
  const lastStatsPushRef = useRef<number>(0);

  useEffect(() => {
    lastFrameRef.current = 0;

    const tick = () => {
      const now = performance.now();
      // ~30 fps throttle
      if (now - lastFrameRef.current < 30) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      lastFrameRef.current = now;

      const matrices = useRgbMatrixStore.getState().matrices.filter(m => m.enabled);
      // Lecture QuickShow en cours → le lecteur possède la sortie : la matrice
      // laissée activée dans l'onglet s'efface (sinon ses cellules LTP
      // écrasent le contenu : une fixture sur deux éteinte selon la phase).
      // Les matrices actives sur PISTES restent gérées par le lecteur lui-même
      // (markMatrixPresetDriven + colorTrackColors).
      if (engineOwnsOutput()) {
        flushMatrixIdle(lastAddrsRef.current, (uni, zeros) =>
          dmxBridge.writeTransient('rgb-matrix', uni, zeros, 150),
        );
        activationRef.current.clear();
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      // Les matrices pilotées par une piste preset appartiennent au moteur de
      // lecture (horloge de lecture) : jamais redessinées ici.
      const driven = matrices.filter(m => !presetDriven.has(m.id));
      if (driven.length === 0) {
        // Plus rien à piloter : éteindre ce qu'on allumait (sinon figé).
        flushMatrixIdle(lastAddrsRef.current, (uni, zeros) =>
          dmxBridge.writeTransient('rgb-matrix', uni, zeros, 150),
        );
        activationRef.current.clear();
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const fixtures = useShowStore.getState().patchedFixtures;
      const groups = useShowStore.getState().fixtureGroups;
      const universes = useShowStore.getState().universes;

      // Aggregate per-universe channel writes, then send ONE arbitrated frame
      // per universe instead of one setChannel per RGB channel.
      const perUniverse = new Map<number, Record<number, number>>();

      const pushStats = now - lastStatsPushRef.current > 500;
      if (pushStats) lastStatsPushRef.current = now;

      for (const matrix of driven) {
        // t=0 à l'activation (toggle ou entrée de piste) → phase reproductible.
        if (!activationRef.current.has(matrix.id)) activationRef.current.set(matrix.id, now);
        const elapsed = (now - activationRef.current.get(matrix.id)!) / 1000;
        const group = groups.find(g => g.id === matrix.groupId);
        if (!group) {
          if (pushStats) useRgbMatrixStore.getState().setStats(matrix.id, { total: 0, resolved: 0 });
          continue;
        }

        // Ordre CANONIQUE = group.fixtureIds (ordre du groupe, celui du
        // panneau Groupes) — PAS l'ordre de patch. L'ancien filter() suivait
        // patchedFixtures : cellules mélangées entre le live, les pistes
        // matrix et l'aperçu de l'éditeur.
        const byId = new Map(fixtures.map(f => [f.id, f]));
        const groupFixtures = group.fixtureIds
          .map(id => byId.get(id))
          .filter((f): f is typeof fixtures[number] => !!f);
        if (groupFixtures.length === 0) {
          if (pushStats) useRgbMatrixStore.getState().setStats(matrix.id, { total: 0, resolved: 0 });
          continue;
        }

        // Précharge en tâche de fond les définitions manquantes du groupe
        const missingDefIds = [...new Set(groupFixtures.map(f => f.fixtureDefId))].filter(id => !defCacheRef.current.has(id));
        if (missingDefIds.length > 0) {
          loadFixtureDefinitions(missingDefIds).then(defs => {
            for (const [k, v] of defs) defCacheRef.current.set(k, v);
          }).catch(() => {});
        }

        const { perUniverse: frame, resolved: resolvedCount } = renderMatrixFrame(
          matrix,
          elapsed * matrix.speed,
          groupFixtures,
          (id) => defCacheRef.current.get(id),
          (uid) => universes.findIndex(u => u.id === uid),
          elapsed,
        );
        for (const [uniIdx, vals] of frame) {
          const prev = perUniverse.get(uniIdx) ?? {};
          perUniverse.set(uniIdx, { ...prev, ...vals });
        }
        if (pushStats) useRgbMatrixStore.getState().setStats(matrix.id, { total: groupFixtures.length, resolved: resolvedCount });
      }

      // Send one arbitrated frame per universe through the output arbiter
      for (const [uniIdx, vals] of perUniverse) {
        dmxBridge.write('rgb-matrix', uniIdx, vals);
        // Registre d'extinction : mémorise les adresses écrites.
        let set = lastAddrsRef.current.get(uniIdx);
        if (!set) { set = new Set<number>(); lastAddrsRef.current.set(uniIdx, set); }
        for (const addrStr of Object.keys(vals)) set.add(Number(addrStr));
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    tick();
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);
}
