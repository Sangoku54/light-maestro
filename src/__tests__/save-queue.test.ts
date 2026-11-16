// ─── Test de la file d'attente des sauvegardes (perte de données) ──────────
//
// Reproduit le bug critique corrigé dans App.tsx : le mutex booléen
// `projectSaveInFlight` REFUSAIT une 2e sauvegarde. « Sauvegarder & Quitter »
// marquait ensuite le projet clean et quittait l'application → tout le
// travail non sauvegardé était perdu sans avertissement.

import { describe, it, expect } from 'vitest';
import { createSaveQueue, type SaveOutcome } from '../utils/save-queue';

/** Promesse dont on contrôle la résolution. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('createSaveQueue — sérialisation des sauvegardes', () => {
  it('une sauvegarde seule s’exécute immédiatement', async () => {
    const q = createSaveQueue();
    const outcome = await q.run(async () => 'saved' as SaveOutcome);
    expect(outcome).toBe('saved');
    expect(q.busy).toBe(false);
  });

  it('une 2e demande ATTEND la 1re (elle n’est plus refusée)', async () => {
    const q = createSaveQueue();
    const first = deferred<SaveOutcome>();
    const order: string[] = [];

    const p1 = q.run(async () => { order.push('start-1'); return first.promise; });
    const p2 = q.run(async () => { order.push('start-2'); return 'saved' as SaveOutcome; });

    // La 2e n'a PAS démarré tant que la 1e est en cours
    await Promise.resolve();
    expect(order).toEqual(['start-1']);

    first.resolve('saved');
    expect(await p1).toBe('saved');
    expect(await p2).toBe('saved');
    expect(order).toEqual(['start-1', 'start-2']);
  });

  it('la 2e sauvegarde s’exécute AVEC l’état courant (pas un simple abandon)', async () => {
    const q = createSaveQueue();
    const first = deferred<SaveOutcome>();
    let state = 'ancien';

    const p1 = q.run(async () => first.promise);
    state = 'nouveau'; // l'utilisateur continue à éditer pendant la 1re sauvegarde
    const p2 = q.run(async () => (state === 'nouveau' ? 'saved' : 'cancelled'));

    first.resolve('saved');
    await p1;
    // La 2e a bien vu l'état NOUVEAU → elle n'a pas été perdue
    expect(await p2).toBe('saved');
  });

  it('skipIfBusy : abandon immédiat (autosave) sans toucher la file', async () => {
    const q = createSaveQueue();
    const first = deferred<SaveOutcome>();
    const p1 = q.run(async () => first.promise);

    const outcome = await q.run(async () => 'saved' as SaveOutcome, { skipIfBusy: true });
    expect(outcome).toBe('busy');

    first.resolve('saved');
    expect(await p1).toBe('saved');
  });

  it('une 3e demande est servie après la 2e (ordre FIFO)', async () => {
    const q = createSaveQueue();
    const first = deferred<SaveOutcome>();
    const order: number[] = [];

    const p1 = q.run(async () => { order.push(1); return first.promise; });
    const p2 = q.run(async () => { order.push(2); return 'saved' as SaveOutcome; });
    const p3 = q.run(async () => { order.push(3); return 'saved' as SaveOutcome; });

    first.resolve('saved');
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('l’échec de la 1re n’empêche PAS la 2e de s’exécuter', async () => {
    const q = createSaveQueue();
    const p1 = q.run(async () => 'failed' as SaveOutcome);
    const p2 = q.run(async () => 'saved' as SaveOutcome);
    expect(await p1).toBe('failed');
    expect(await p2).toBe('saved');
  });

  it('une exception dans la 1re ne bloque pas la 2e', async () => {
    const q = createSaveQueue();
    const p1 = q.run(async () => { throw new Error('boom'); });
    const p2 = q.run(async () => 'saved' as SaveOutcome);
    await expect(p1).rejects.toThrow('boom');
    expect(await p2).toBe('saved');
  });

  it('le verrou se libère après la fin de la chaîne', async () => {
    const q = createSaveQueue();
    const first = deferred<SaveOutcome>();
    const p1 = q.run(async () => first.promise);
    expect(q.busy).toBe(true);
    first.resolve('saved');
    await p1;
    await Promise.resolve();
    expect(q.busy).toBe(false);
  });
});
