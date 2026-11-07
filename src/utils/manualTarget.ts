/**
 * Cible manuelle de pan/tilt (positionnée depuis la modale 3D, clic cible).
 *
 * Lorsqu'un utilisateur vise un point depuis la vue 3D, les pan/tilt résolus
 * sont stockés ici. Le playback DMX doit alors appliquer ces valeurs et ne
 * PAS les écraser avec le neutre (128+zero) ni avec un mouvement autoscript,
 * tant que la cible est active.
 *
 * La cible persiste jusqu'à ce qu'un nouveau target soit fait sur la même
 * fixture, ou qu'elle soit explicitement libérée (clearManualTarget).
 */
export const manualTargetRef = new Map<string, { pan: number; tilt: number }>();

export function setManualTarget(fixtureId: string, pan: number, tilt: number): void {
  manualTargetRef.set(fixtureId, { pan: Math.max(0, Math.min(255, Math.round(pan))), tilt: Math.max(0, Math.min(255, Math.round(tilt))) });
}

export function getManualTarget(fixtureId: string): { pan: number; tilt: number } | undefined {
  return manualTargetRef.get(fixtureId);
}

export function clearManualTarget(fixtureId: string): void {
  manualTargetRef.delete(fixtureId);
}

export function clearAllManualTargets(): void {
  manualTargetRef.clear();
}
