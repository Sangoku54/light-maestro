/**
 * Structures de scène libres (« supports » placés dans le décor).
 *
 * Contrairement à l'ancien attribut par fixture, une structure est une entité
 * de scène INDÉPENDANTE : un pont, une barre avant/arrière, un totem ou un
 * support en T, posé librement par l'utilisateur — avec ou SANS fixture dessus.
 * Les fixtures restent positionnées librement (FixturePos) ; rien n'est
 * attribué d'office.
 *
 * Repère identique aux plateaux : centre normalisé 0-1 sur `stageDims`,
 * hauteurs et longueurs en MÈTRES.
 */

export type RigKind = 'truss' | 'frontBar' | 'backBar' | 'totem' | 'tBar';

export const RIG_KINDS: RigKind[] = ['truss', 'frontBar', 'backBar', 'totem', 'tBar'];

export interface StageRig {
  id: string;
  name: string;
  kind: RigKind;
  /** Centre X normalisé 0-1. */
  cx: number;
  /** Centre Y normalisé 0-1 (profondeur). */
  cy: number;
  /** Hauteur de la structure (barre/pont : hauteur de l'axe ; totem/T : hauteur). */
  h: number;
  /** Rotation plane, degrés, horaire vu du dessus. */
  rot?: number;
  /** Longueur (mètres) — pont et barres. Ignoré pour totem/T. */
  span: number;
  /** Barres : suspendue par câbles (true) ou posée sur pieds (false). */
  hung?: boolean;
}

/** Longueur par défaut selon le type (mètres). */
export const DEFAULT_RIG_SPANS: Record<RigKind, number> = {
  truss: 6,
  frontBar: 4,
  backBar: 4,
  totem: 0,
  tBar: 0,
};

/** Hauteur par défaut selon le type (mètres). */
export const DEFAULT_RIG_HEIGHTS: Record<RigKind, number> = {
  truss: 3,
  frontBar: 3,
  backBar: 3,
  totem: 2.5,
  tBar: 2.2,
};

/** Position de pose par défaut selon le type (placement audience). */
const DEFAULT_POS: Record<RigKind, { cx: number; cy: number }> = {
  truss: { cx: 0.5, cy: 0.9 },
  frontBar: { cx: 0.5, cy: 0.12 },
  backBar: { cx: 0.5, cy: 0.88 },
  totem: { cx: 0.12, cy: 0.5 },
  tBar: { cx: 0.88, cy: 0.5 },
};

/** Aucune structure par défaut : la scène commence nue (choix utilisateur). */
export function defaultStageRigs(): StageRig[] {
  return [];
}

/** Construit une structure d'un type donné (id fourni par l'appelant). */
export function makeRig(id: string, kind: RigKind, count: number): StageRig {
  const pos = DEFAULT_POS[kind];
  return {
    id,
    name: `${RIG_LABELS[kind]} ${count}`,
    kind,
    cx: pos.cx,
    cy: pos.cy,
    h: DEFAULT_RIG_HEIGHTS[kind],
    rot: 0,
    span: DEFAULT_RIG_SPANS[kind],
    hung: true,
  };
}

/** Libellés par défaut (le rendu UI utilise l'i18n ; noms persistés en clair). */
export const RIG_LABELS: Record<RigKind, string> = {
  truss: 'Pont',
  frontBar: 'Barre avant',
  backBar: 'Barre arrière',
  totem: 'Totem',
  tBar: 'Support T',
};

/** Normalise des données chargées (projet ancien/corrompu) vers des structures valides. */
export function migrateStageRigs(saved: unknown): StageRig[] {
  if (!Array.isArray(saved)) return [];
  const rigs: StageRig[] = [];
  for (const [i, raw] of saved.entries()) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const kind: RigKind = (RIG_KINDS as string[]).includes(r.kind as string) ? (r.kind as RigKind) : 'truss';
    const num = (v: unknown, fb: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
    rigs.push({
      id: typeof r.id === 'string' && r.id ? r.id : `rig-${i}`,
      name: typeof r.name === 'string' && r.name ? r.name : `${RIG_LABELS[kind]} ${i + 1}`,
      kind,
      cx: Math.min(1.3, Math.max(-0.3, num(r.cx, 0.5))),
      cy: Math.min(1.3, Math.max(-0.3, num(r.cy, 0.5))),
      h: Math.min(12, Math.max(0, num(r.h, DEFAULT_RIG_HEIGHTS[kind]))),
      rot: ((num(r.rot, 0) % 360) + 360) % 360,
      span: num(r.span, DEFAULT_RIG_SPANS[kind]),
      hung: r.hung === undefined ? true : !!r.hung,
    });
  }
  return rigs;
}

/** Assainit une mise à jour : ignore les valeurs non finies (frappe en cours). */
export function sanitizeRigUpdates(updates: Partial<StageRig>): Partial<StageRig> {
  const clean: Partial<StageRig> = {};
  if (typeof updates.name === 'string' && updates.name.trim()) clean.name = updates.name.trim().slice(0, 40);
  for (const k of ['cx', 'cy', 'h', 'span'] as const) {
    const v = updates[k];
    if (typeof v === 'number' && Number.isFinite(v)) clean[k] = v;
  }
  if (typeof updates.rot === 'number' && Number.isFinite(updates.rot)) {
    clean.rot = ((updates.rot % 360) + 360) % 360;
  }
  if (typeof updates.hung === 'boolean') clean.hung = updates.hung;
  return clean;
}

/** Rectangle du rig en mètres, centré sur le cadre (pour Three.js / canvas). */
export function rigRectMeters(
  rig: StageRig,
  stageDims: { width: number; depth: number },
): { x: number; z: number; w: number; d: number } {
  return {
    x: (rig.cx - 0.5) * stageDims.width,
    z: (rig.cy - 0.5) * stageDims.depth,
    w: rig.span * stageDims.width,
    d: rig.span * stageDims.depth,
  };
}

/** Conversion champ UI (mètres, origine coin) ↔ modèle (normalisé, origine centre). */
export function rigToMeters(
  rig: StageRig,
  stageDims: { width: number; depth: number },
): { name: string; x: number; y: number; w: number; d: number; h: number; r: number } {
  return {
    name: rig.name,
    x: Math.round((rig.cx - rig.span / 2) * stageDims.width * 10) / 10,
    y: Math.round((rig.cy - rig.span / 2) * stageDims.depth * 10) / 10,
    w: Math.round(rig.span * stageDims.width * 10) / 10,
    d: Math.round(rig.span * stageDims.depth * 10) / 10,
    h: rig.h,
    r: Math.round((rig.rot ?? 0) * 10) / 10,
  };
}

/** Conversion inverse (champ UI → modèle). */
export function rigFromMeters(
  m: { x: number; y: number; w: number; d: number; h: number; r: number },
  stageDims: { width: number; depth: number },
): Partial<StageRig> {
  const cx = (m.x + m.w / 2 - stageDims.width / 2) / stageDims.width + 0.5;
  const cy = (m.y + m.d / 2 - stageDims.depth / 2) / stageDims.depth + 0.5;
  const h = Math.min(12, Math.max(0, m.h));
  const rot = ((m.r % 360) + 360) % 360;
  return { cx, cy, h, rot };
}
