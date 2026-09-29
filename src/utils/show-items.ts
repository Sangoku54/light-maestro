/**
 * Durées des blocs ajoutés aux pistes de show.
 *
 * Règle : la section créée respecte la durée programmée de la ressource
 * (chaser 10 s → bloc 10 s, scène 5 s → bloc 5 s). Replis si absente :
 * scène infinie (0) → 10 s, chaser/matrice → 10 s, EFX (continu, sans durée
 * propre) → 4 s, défaut 5 s. Testé (show-item-duration).
 */
import type { ShowTrack } from '../stores/showStore';

export function showItemDuration(trackType: ShowTrack['type'], duration?: number): number {
  if (Number.isFinite(duration) && (duration as number) > 0) return duration as number;
  if (trackType === 'efx') return 4000;
  if (trackType === 'chaser' || trackType === 'matrix') return 10000;
  if (trackType === 'scene') return 10000;
  return 5000;
}
