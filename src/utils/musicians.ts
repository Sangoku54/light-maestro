// ─── Musicians on stage: free-form roster (replaces fixed band presets) ──
// A roster is a map from musician kind → count. The user picks exactly which
// members are on stage and how many of each (checkbox + number in the UI).

export type MusicianKind =
  | 'chanteur'
  | 'chanteuse'
  | 'guitariste'
  | 'bassiste'
  | 'clavier'
  | 'batteur'
  | 'cuivre'
  | 'dj';

export type MusicianPosition = { x: number; z: number };
export type MusicianRoster = Partial<Record<MusicianKind, number>> & { positions?: Record<string, MusicianPosition> };

// Display order in the UI dropdown (front line → back line).
export const MUSICIAN_KINDS: MusicianKind[] = [
  'chanteur',
  'chanteuse',
  'guitariste',
  'bassiste',
  'clavier',
  'batteur',
  'cuivre',
  'dj',
];

export const MUSICIAN_LABELS: Record<MusicianKind, string> = {
  chanteur: 'Chanteur',
  chanteuse: 'Chanteuse',
  guitariste: 'Guitariste',
  bassiste: 'Bassiste',
  clavier: 'Clavier',
  batteur: 'Batteur',
  cuivre: 'Cuivre',
  dj: 'DJ',
};

// Default stage position per kind. x: 0..1 left→right, z: 0..1 front→back.
// Vocals front, rhythm mid, drums/keys/brass back. DJ sur le côté (cabine).
export const DEFAULT_POSITIONS: Record<MusicianKind, { x: number; z: number }> = {
  chanteur: { x: 0.50, z: 0.10 },
  chanteuse: { x: 0.62, z: 0.12 },
  guitariste: { x: 0.30, z: 0.45 },
  bassiste: { x: 0.70, z: 0.45 },
  clavier: { x: 0.16, z: 0.70 },
  batteur: { x: 0.50, z: 0.85 },
  cuivre: { x: 0.84, z: 0.62 },
  dj: { x: 0.92, z: 0.55 },
};

// Used as the uncontrolled Stage3D fallback (PerformanceView / QuickShowView)
// and mirrors the previous "quintet" preset.
export const DEFAULT_ROSTER: MusicianRoster = {
  chanteur: 1,
  guitariste: 1,
  bassiste: 1,
  batteur: 1,
  clavier: 1,
};

export function isRosterEmpty(roster: MusicianRoster | undefined): boolean {
  if (!roster) return true;
  return MUSICIAN_KINDS.every((k) => (roster[k] ?? 0) <= 0);
}

export function rosterTotal(roster: MusicianRoster | undefined): number {
  if (!roster) return 0;
  return MUSICIAN_KINDS.reduce((sum, k) => sum + (Math.max(0, Math.floor(roster[k] ?? 0))), 0);
}

// Clamp counts, drop kinds with 0, keep a stable key order.
export function normalizeRoster(roster: MusicianRoster | undefined): MusicianRoster {
  const out: MusicianRoster = {};
  if (!roster) return out;
  for (const k of MUSICIAN_KINDS) {
    const n = Math.max(0, Math.floor(roster[k] ?? 0));
    if (n > 0) out[k] = n;
  }
  // Preserve custom positions across normalization
  if (roster.positions) out.positions = roster.positions;
  return out;
}

// Migration: old scenes stored a `bandConfig` preset string. Convert it to a
// roster so scenes saved before this feature keep their musicians.
export function rosterFromBandConfig(cfg: string | undefined | null): MusicianRoster {
  switch (cfg) {
    case 'solo': return { chanteur: 1 };
    case 'solo-chanteuse': return { chanteuse: 1 };
    case 'duo': return { chanteur: 1, guitariste: 1 };
    case 'trio': return { chanteur: 1, guitariste: 1, batteur: 1 };
    case 'quartet': return { chanteur: 1, guitariste: 1, bassiste: 1, batteur: 1 };
    case 'quintet': return { chanteur: 1, guitariste: 1, bassiste: 1, batteur: 1, clavier: 1 };
    case 'sextet': return { chanteur: 1, chanteuse: 1, guitariste: 1, bassiste: 1, batteur: 1, clavier: 1 };
    default: return {};
  }
}
