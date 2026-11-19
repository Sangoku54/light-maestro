/**
 * Cible manuelle de pan/tilt (positionnee depuis la modale 3D, clic cible).
 *
 * Lorsqu'un utilisateur vise un point depuis la vue 3D, les pan/tilt resolus
 * sont stockes ici. Le playback DMX doit alors appliquer ces valeurs et ne
 * PAS les ecraser avec le neutre (128+zero) ni avec un mouvement autoscript,
 * tant que la cible est active.
 *
 * La cible persiste jusqu'a ce qu'un nouveau target soit fait sur la meme
 * fixture, ou qu'elle soit explicitement liberee (clearManualTarget).
 *
 * `tiltByOffset` conserve le tilt RESOLU par canal (offset DMX dans le mode)
 * : une fixture multi-bras (Tonio 6 arm) a un tilt different par tete, une
 * valeur unique les aplatirait.
 */

export interface ManualTarget {
  /** Pan DMX (0-255) partage par tous les bras. */
  pan: number;
  /** Tilt DMX (0-255) de la tete principale. */
  tilt: number;
  /** Tilt DMX resolu par offset de canal (multi-bras). */
  tiltByOffset?: Record<number, number>;
}

export const manualTargetRef = new Map<string, ManualTarget>();

function clamp255(v: number): number {
  if (!Number.isFinite(v)) return 128;
  return Math.max(0, Math.min(255, Math.round(v)));
}

export function setManualTarget(
  fixtureId: string,
  pan: number,
  tilt: number,
  tiltByOffset?: Record<number, number>,
): void {
  const entry: ManualTarget = { pan: clamp255(pan), tilt: clamp255(tilt) };
  if (tiltByOffset) {
    const map: Record<number, number> = {};
    for (const [off, val] of Object.entries(tiltByOffset)) {
      const o = Number(off);
      if (!Number.isFinite(o) || o < 0) continue;
      map[o] = clamp255(Number(val));
    }
    if (Object.keys(map).length > 0) entry.tiltByOffset = map;
  }
  manualTargetRef.set(fixtureId, entry);
}

export function getManualTarget(fixtureId: string): ManualTarget | undefined {
  return manualTargetRef.get(fixtureId);
}

/** Libere la cible d'une fixture (le playback reprend la main). */
export function clearManualTarget(fixtureId: string): void {
  manualTargetRef.delete(fixtureId);
}

/** Libere toutes les cibles (changement de projet, reset, etc.). */
export function clearAllManualTargets(): void {
  manualTargetRef.clear();
}

/** True si une fixture a une cible manuelle active. */
export function hasManualTarget(fixtureId: string): boolean {
  return manualTargetRef.has(fixtureId);
}
