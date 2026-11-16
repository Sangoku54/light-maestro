// ─── Supports physiques des projecteurs ────────────────────────────
// En plus de la DIRECTION du faisceau (mountMode : top/ground/rear/hanging),
// chaque fixture peut reposer sur un SUPPORT visible dans la vue 3D :
// pont de truss (rendu historique, rien de dessiné), totem (tour verticale,
// standard DJ), trépied (pied en T repliable, standard DJ), sol (uplight),
// barre avant / barre arrière (barre horizontale dont la fixture pend :
// suspendue par câbles OU posée sur pieds — longueur libre en mètres,
// totalement indépendante de la taille des plateaux).
// `undefined` (anciens projets/presets) = 'truss' : aucun changement visuel.

export type FixtureSupport = 'truss' | 'totem' | 'tripod' | 'floor' | 'frontBar' | 'backBar';

export const SUPPORT_KINDS: FixtureSupport[] = ['truss', 'totem', 'tripod', 'floor', 'frontBar', 'backBar'];

export const SUPPORT_LABELS: Record<FixtureSupport, string> = {
  truss: 'Pont',
  totem: 'Totem',
  tripod: 'Trépied',
  floor: 'Sol',
  frontBar: 'Barre avant',
  backBar: 'Barre arrière',
};

/** Les barres sont-elles des supports suspendus/posés (vs colonnes) ? */
export function isBarSupport(kind: FixtureSupport): boolean {
  return kind === 'frontBar' || kind === 'backBar';
}

/** Longueur de barre par défaut (mètres) — libre, jamais dérivée des plateaux. */
export const DEFAULT_BAR_SPAN = 4;
/** Suspension par défaut : câbles vers le haut (pas de pieds). */
export const BAR_HUNG_DEFAULT = true;
/** Chute entre la barre et la tête de fixture (mètres). */
export const BAR_DROP = 0.35;
/** Longueur des câbles de suspension (mètres). */
export const BAR_CABLE_LEN = 2.2;

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

/** Faut-il dessiner une géométrie de support ? (pont/sol = rien ; trop bas = rien.
 *  Les barres se dessinent toujours : la barre flotte AU-DESSUS de la tête,
 *  même fixture au sol.) */
export function needsSupportGeometry(kind: FixtureSupport, columnHeight: number): boolean {
  if (isBarSupport(kind)) return true;
  if (kind !== 'totem' && kind !== 'tripod') return false;
  return columnHeight >= 0.15;
}
