// ─── File d'attente des sauvegardes ───────────────────────────────────────
//
// Sérialise les sauvegardes du projet.
//
// HISTORIQUE DU BUG : la exclusion mutuelle était un simple booléen
// (`projectSaveInFlight`). Une 2e sauvegarde était alors REFUSÉE
// (`return false`) pendant qu'une 1re était en cours. Or « Sauvegarder &
// Quitter » faisait ensuite `markClean()` + `closeAction('discard')`
// QUOI QU'IL ARRIVE → l'application QUITTAIT sans rien écrire.
//
// Concrètement : cliquer « Sauvegarder & Quitter » pendant l'autosave de
// 45 s = tout le travail non sauvegardé perdu, sans avertissement.
//
// La file d'attente ATTEND la sauvegarde en cours au lieu de la refuser : la
// demande n'est jamais perdue.

export type SaveOutcome =
  /** Le projet a été écrit (.lmproj ou slot autosave). */
  | 'saved'
  /** L'utilisateur a fermé la boîte de dialogue de sauvegarde. */
  | 'cancelled'
  /** Erreur technique — le projet n'est PAS écrit. */
  | 'failed'
  /** Une sauvegarde était déjà en cours et celle-ci a été abandonnée. */
  | 'busy';

export interface SaveQueueOptions {
  /**
   * Abandonner la demande si une sauvegarde est déjà en cours (autosave :
   * inutile d'empiler une sauvegarde derrière une boîte de dialogue).
   */
  skipIfBusy?: boolean;
}

export interface SaveQueue {
  /** Vrai si une sauvegarde est en cours. */
  readonly busy: boolean;
  /**
   * Exécute `fn` en série.
   * - si une sauvegarde est en cours et `skipIfBusy` → renvoie 'busy' ;
   * - sinon → attend la sauvegarde en cours, puis exécute `fn` avec l'état
   *   courant. La demande n'est JAMAIS perdue.
   */
  run(fn: () => Promise<SaveOutcome>, options?: SaveQueueOptions): Promise<SaveOutcome>;
}

export function createSaveQueue(): SaveQueue {
  let current: Promise<SaveOutcome> | null = null;

  const release = (p: Promise<SaveOutcome>) => {
    // `finally` renvoie une promesse qui rejette si `p` rejette → on l'absorbe,
    // sinon on crée un rejet non géré.
    p.finally(() => {
      if (current === p) current = null;
    }).catch(() => {});
  };

  const run = (
    fn: () => Promise<SaveOutcome>,
    options?: SaveQueueOptions,
  ): Promise<SaveOutcome> => {
    const previous = current;
    if (previous) {
      if (options?.skipIfBusy) return Promise.resolve('busy');
      // Attend la sauvegarde précédente (même si elle a échoué) puis
      // exécute la nôtre avec l'état courant.
      const next = previous.then(
        () => fn(),
        () => fn(),
      );
      current = next;
      release(next);
      return next;
    }
    const next = fn();
    current = next;
    release(next);
    return next;
  };

  return {
    get busy() {
      return current !== null;
    },
    run,
  };
}
