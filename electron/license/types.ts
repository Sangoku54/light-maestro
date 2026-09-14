/**
 * Licence — modèle de données partagé (process main uniquement).
 *
 * Éditions :
 *   - `free`     : gratuite, 1 fixture patchée max, 1 univers max.
 *   - `standard` : payante (69 €), fixtures illimitées, 1 univers max.
 *   - `full`     : payante (99 €), fixtures illimitées, univers illimités.
 *
 * La licence est liée au COMPTE (connexion email/mot de passe), validée en
 * ligne. Ce module ne dépend d'aucun composant renderer : il vit côté process
 * main (voir `electron/main.ts`) pour ne pas exposer la logique sensible au
 * renderer, qui ne reçoit que l'état final via IPC.
 */

export type LicenseEdition = 'free' | 'standard' | 'full';

/** Limites déduites de l'édition, exposées au renderer via IPC. */
export interface LicenseLimits {
  /** Nombre max de fixtures patchées (Infinity pour illimité). */
  maxFixtures: number;
  /** Nombre max d'univers dans le show (Infinity pour illimité). */
  maxUniverses: number;
}

/** État de licence complet, tel que consommé par le renderer. */
export interface LicenseState {
  /** Édition active (défaut `free` tant qu'aucune licence n'est validée). */
  edition: LicenseEdition;
  /** Email du compte connecté (null si non connecté). */
  email: string | null;
  /** Nom d'affichage du compte (null si non connecté). */
  displayName: string | null;
  /** true si l'utilisateur possède une licence payante validée en ligne. */
  licensed: boolean;
  /** Limites associées à l'édition courante. */
  limits: LicenseLimits;
}

/** Limites par édition — source de vérité unique. */
export const EDITION_LIMITS: Record<LicenseEdition, LicenseLimits> = {
  free: { maxFixtures: 1, maxUniverses: 1 },
  standard: { maxFixtures: Infinity, maxUniverses: 1 },
  full: { maxFixtures: Infinity, maxUniverses: Infinity },
};

/** Retourne les limites d'une édition (fallback sûr vers `free`). */
export function limitsForEdition(edition: LicenseEdition): LicenseLimits {
  return EDITION_LIMITS[edition] ?? EDITION_LIMITS.free;
}