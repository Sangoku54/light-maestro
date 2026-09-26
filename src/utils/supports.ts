// ─── Supports physiques des projecteurs ────────────────────────────
// En plus de la DIRECTION du faisceau (mountMode : top/ground/rear/hanging),
// chaque fixture peut reposer sur un SUPPORT visible dans la vue 3D :
// pont de truss (rendu historique, rien de dessiné), totem (tour verticale,
// standard DJ), trépied (pied en T repliable, standard DJ) ou sol (uplight).
// `undefined` (anciens projets/presets) = 'truss' : aucun changement visuel.

export type FixtureSupport = 'truss' | 'totem' | 'tripod' | 'floor';

export const SUPPORT_KINDS: FixtureSupport[] = ['truss', 'totem', 'tripod', 'floor'];

export const SUPPORT_LABELS: Record<FixtureSupport, string> = {
  truss: 'Pont',
  totem: 'Totem',
  tripod: 'Trépied',
  floor: 'Sol',
};

/** Résout le support effectif : inconnu/absent → 'truss' (rendu historique). */
export function resolveSupportKind(support: unknown): FixtureSupport {
  return (SUPPORT_KINDS as string[]).includes(support as string)
    ? (support as FixtureSupport)
    : 'truss';
}

/** Hauteur de colonne nécessaire entre le plateau et la fixture (mètres, ≥ 0). */
export function supportColumnHeight(fixtureWorldY: number, platformTopY: number): number {
  return Math.max(0, fixtureWorldY - platformTopY);
}

/** Faut-il dessiner une géométrie de support ? (pont/sol = rien ; trop bas = rien) */
export function needsSupportGeometry(kind: FixtureSupport, columnHeight: number): boolean {
  if (kind !== 'totem' && kind !== 'tripod') return false;
  return columnHeight >= 0.15;
}
