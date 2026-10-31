/**
 * Hauteur des fixtures — unité MÈTRES.
 *
 * Historique : `h` était un normalisé 0..1 mappé sur 0..5 m (`h * 5`). Cette
 * échelle plafonnait arbitrairement la hauteur à 5 m. `h` est désormais exprimé
 * directement en mètres (libre, ≥ 0).
 *
 * Migration : les projets/shows sauvegardés par les versions précédentes
 * contiennent des h normalisés. Le marqueur `fixtureHeightUnit: 'm'` est écrit
 * par les nouvelles versions ; son ABSENCE signale l'ancien format → ×5.
 * Idempotent par construction : un fichier déjà en mètres porte le marqueur
 * et n'est jamais re-multiplié.
 */

/** Marqueur écrit dans les sauvegardes dont les hauteurs sont en mètres. */
export const FIXTURE_HEIGHT_UNIT = 'm' as const;

type PosLike = { h?: number };

/**
 * Convertit des positions ancien format (h normalisé 0..1) en mètres (×5).
 * À appeler UNIQUEMENT quand le marqueur `fixtureHeightUnit` est absent.
 */
export function migrateFixtureHeightsToMeters<T extends PosLike>(
  positions: Record<string, T> | undefined | null,
): Record<string, T> {
  const out: Record<string, T> = {};
  if (!positions) return out;
  for (const [id, pos] of Object.entries(positions)) {
    const raw = typeof pos?.h === 'number' && Number.isFinite(pos.h) ? pos.h : 0;
    out[id] = { ...pos, h: raw * 5 };
  }
  return out;
}

/** Lit des positions sauvegardées et retourne des hauteurs en mètres. */
export function loadFixturePositionsMeters<T extends PosLike>(
  payload: { fixturePositions?: Record<string, T>; fixtureHeightUnit?: string } | undefined | null,
): Record<string, T> | undefined {
  if (!payload?.fixturePositions) return undefined;
  return payload.fixtureHeightUnit === FIXTURE_HEIGHT_UNIT
    ? payload.fixturePositions
    : migrateFixtureHeightsToMeters(payload.fixturePositions);
}
