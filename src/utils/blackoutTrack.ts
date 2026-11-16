/**
 * Piste "scène blackout" — rend inactives (noir) des fixtures choisies
 * pendant un intervalle de temps dans l'autoscript.
 *
 * Chaque entrée de la piste définit un intervalle [time, endTime[ et la
 * liste des fixtureIds concernées. Quand le courant est dans l'intervalle,
 * les fixtures ciblées reçoivent intensité 0 + shutter fermé, et ce quelle
 * que soit la suite du show (mouvement, couleur, strobe…).
 *
 * Priorité : le blackout écrase tout ce qui a été écrit avant dans le bloc
 * fixture (couleur, mouvement, strobe, gobo…). Les overlays show/chaser/scene
 * qui s'appliquent après peuvent encore l'écraser — c'est un cas limite à
 * gérer ultérieurement si nécessaire.
 */

export interface BlackoutTrackEntryRef {
  id: string;
  /** Début de l'intervalle (secondes, temps courant du show). */
  time: number;
  /** Fin de l'intervalle (secondes). */
  endTime: number;
  /** Identifiants des fixtures à mettre en blackout durant l'intervalle. */
  fixtureIds: string[];
}

export interface BlackoutTrackRef {
  id: string;
  entries: BlackoutTrackEntryRef[];
  name?: string;
  /** Fallback fixture IDs when entry-level fixtureIds is missing (UI compat) */
  targetFixtureIds?: string[];
}

/** Bridge type — accepts both UI-format (fixtureNames-only) and engine-format (fixtureIds) entries */
type BlackoutTrackEntryLike = BlackoutTrackEntryRef & { fixtureNames?: string[] };

import type { PatchedFixture } from '../stores/showStore';

/**
 * Calcule quelles fixtures sont en blackout à l'instant donné.
 *
 * Retourne une Map fixtureId → { active: true } pour les fixtures qui
 * doivent être rendues inactives (noir) à `currentTime`.
 */
export function computeBlackoutTrackOverrides(
  blackoutTracks: BlackoutTrackRef[],
  currentTime: number,
  patchedFixtures: PatchedFixture[],
): Map<string, { active: boolean }> {
  const result = new Map<string, { active: boolean }>();
  for (const tr of blackoutTracks) {
    if (!tr.entries || tr.entries.length === 0) continue;
    const entry = tr.entries.find(e => currentTime >= e.time && currentTime < e.endTime);
    if (!entry) continue;
    // Support both engine-format (fixtureIds) and UI-format (targetFixtureIds fallback)
    const ids = (entry as any).fixtureIds || tr.targetFixtureIds || [];
    for (const fid of ids) {
      if (patchedFixtures.some(f => f.id === fid)) {
        result.set(fid, { active: true });
      }
    }
  }
  return result;
}
