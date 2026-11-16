// ─── Autoloop — Module 4 : banques et modes de performance ──
//
// Port TypeScript pur (zéro dépendance React/Electron/`window`) du module
// `banks.py` du prototype Python. Ce module importe UNIQUEMENT ses types depuis
// `./autoloop-types` (le contrat figé).
//
// Responsabilités
// ---------------
// Ce module implémente la couche de stockage et de navigation des Autoloops,
// ainsi que les deux mécanismes de performance des banques :
//
// * **Matrice 4 × 32** : `BANKS` (4) banques contenant chacune `PER_BANK`
//   (32) emplacements, soit **128 Autoloops** au total. On parle de *banques*
//   (banks) et d'*emplacements* (slots).
//
// * **Mode exclusif** : verrouiller une banque restreint la sélection à cette
//   seule banque (voir `BankManager.lockBank`). `lockedBank === null` correspond
//   au mode « Play All Banks » : les 4 banques sont parcourues.
//
// * **Répétition** (`RepeatMode`) :
//   * `'infinite'` — la timeline rejoue en boucle (retour au début à la fin) ;
//   * `'track_duration'` — à chaque événement `Track_Loaded` de l'hôte, le loop
//     courant est « tué » puis un nouvel Autoloop est généré.

import { AutoloopTimeline, RepeatMode } from './autoloop-types';

/** Nombre de banques (4 banques). */
export const BANKS = 4;

/** Nombre d'emplacements par banque (32 slots). */
export const PER_BANK = 32;

/** Nombre total d'emplacements, parcourus dans l'ordre « banque puis slot ». */
const TOTAL = BANKS * PER_BANK;

/**
 * Gestionnaire de la matrice 4 × 32 et des modes de performance.
 *
 * - `repeatMode` : mode de répétition (`'infinite'` par défaut).
 * - `banks` : matrice `[banque][emplacement]` contenant un `AutoloopTimeline`
 *   ou `null` si l'emplacement est vide.
 * - `activeBank` / `activeSlot` : position de l'Autoloop sélectionné.
 * - `lockedBank` : banque verrouillée en mode exclusif, ou `null` pour
 *   « Play All Banks » (parcours des 4 banques).
 */
export class BankManager {
  /** Mode de répétition (`'infinite'` par défaut). */
  repeatMode: RepeatMode;

  /** Matrice `[banque][emplacement]` de la 4 × 32 (128 emplacements). */
  banks: (AutoloopTimeline | null)[][];

  /** Banque de l'Autoloop actuellement sélectionné. */
  activeBank: number;

  /** Emplacement de l'Autoloop actuellement sélectionné. */
  activeSlot: number;

  /** Banque verrouillée en mode exclusif, ou `null` = « Play All Banks ». */
  lockedBank: number | null;

  constructor(repeatMode?: RepeatMode) {
    this.repeatMode = repeatMode ?? 'infinite';
    this.banks = [];
    for (let b = 0; b < BANKS; b++) {
      this.banks.push(new Array<AutoloopTimeline | null>(PER_BANK).fill(null));
    }
    this.activeBank = 0;
    this.activeSlot = 0;
    this.lockedBank = null;
  }

  // ------------------------------------------------------------------ //
  // Accès bas niveau à la matrice                                       //
  // ------------------------------------------------------------------ //

  /**
   * Écrit `loop` à l'emplacement `(bank, slot)`.
   *
   * Lève `RangeError` si `bank` ou `slot` est hors matrice.
   */
  store(bank: number, slot: number, loop: AutoloopTimeline): void {
    if (!(bank >= 0 && bank < BANKS && slot >= 0 && slot < PER_BANK)) {
      throw new RangeError(`Emplacement hors matrice : (${bank}, ${slot})`);
    }
    this.banks[bank][slot] = loop;
  }

  /**
   * Retourne le loop à `(bank, slot)`, ou `null` (vide / hors matrice).
   */
  get(bank: number, slot: number): AutoloopTimeline | null {
    if (!(bank >= 0 && bank < BANKS && slot >= 0 && slot < PER_BANK)) {
      return null;
    }
    return this.banks[bank][slot];
  }

  // ------------------------------------------------------------------ //
  // Mode exclusif (« Play All Banks »)                                   //
  // ------------------------------------------------------------------ //

  /**
   * Verrouille la sélection sur `bank` (mode exclusif).
   *
   * Lève `RangeError` si `bank` est hors matrice.
   */
  lockBank(bank: number): void {
    if (!(bank >= 0 && bank < BANKS)) {
      throw new RangeError(`Banque hors matrice : ${bank}`);
    }
    this.lockedBank = bank;
  }

  /** Rétablit le mode « Play All Banks » (aucune banque verrouillée). */
  unlockAll(): void {
    this.lockedBank = null;
  }

  /**
   * Indique si `(bank, slot)` est sélectionnable.
   *
   * Filtre par banque verrouillée : en mode exclusif, seule la banque
   * `lockedBank` est autorisée. Retourne `false` si l'emplacement est hors
   * matrice.
   */
  isSlotAllowed(bank: number, slot: number): boolean {
    if (!(bank >= 0 && bank < BANKS && slot >= 0 && slot < PER_BANK)) {
      return false;
    }
    if (this.lockedBank === null) {
      return true; // « Play All Banks » : tout est autorisé.
    }
    return bank === this.lockedBank;
  }

  // ------------------------------------------------------------------ //
  // Sélection et navigation                                              //
  // ------------------------------------------------------------------ //

  /**
   * Sélectionne l'Autoloop à `(bank, slot)`.
   *
   * Retourne `null` (sans modifier la sélection active) si :
   *   * l'emplacement est hors matrice ;
   *   * une banque est verrouillée et `bank !== lockedBank` ;
   *   * l'emplacement est vide.
   *
   * Sinon, met à jour `activeBank` / `activeSlot` et retourne le loop.
   */
  select(bank: number, slot: number): AutoloopTimeline | null {
    if (!(bank >= 0 && bank < BANKS && slot >= 0 && slot < PER_BANK)) {
      return null;
    }
    if (!this.isSlotAllowed(bank, slot)) {
      return null;
    }
    const loop = this.banks[bank][slot];
    if (loop === null) {
      return null;
    }
    this.activeBank = bank;
    this.activeSlot = slot;
    return loop;
  }

  /**
   * Sélectionne l'Autoloop suivant, ordre « banque puis slot ».
   *
   * Parcourt la matrice en sautant les emplacements vides et les banques non
   * autorisées (mode exclusif), avec retour au début en fin de matrice
   * (wrap-around). Retourne `null` si aucun Autoloop n'est sélectionnable.
   */
  next(): AutoloopTimeline | null {
    return this.walk(1);
  }

  /**
   * Sélectionne l'Autoloop précédent, ordre inverse « banque puis slot ».
   *
   * Mêmes règles que `next`, en sens inverse.
   */
  previous(): AutoloopTimeline | null {
    return this.walk(-1);
  }

  /**
   * Parcours circulaire de la matrice dans `direction` (+1 / -1).
   *
   * Explore les 128 emplacements à partir de la position active, dans l'ordre
   * banque→slot (ou inverse), en ignorant les slots vides et les banques non
   * autorisées. Met à jour `activeBank` / `activeSlot` dès qu'un Autoloop est
   * trouvé.
   */
  private walk(direction: number): AutoloopTimeline | null {
    const start = this.activeBank * PER_BANK + this.activeSlot;
    for (let step = 1; step <= TOTAL; step++) {
      // Modulo euclidien (le `%` JS peut renvoyer un négatif, contrairement à
      // Python) : on force le résultat dans [0, TOTAL).
      const index = ((start + direction * step) % TOTAL + TOTAL) % TOTAL;
      const bank = Math.floor(index / PER_BANK);
      const slot = index % PER_BANK;
      if (!this.isSlotAllowed(bank, slot)) {
        continue;
      }
      const loop = this.banks[bank][slot];
      if (loop !== null) {
        this.activeBank = bank;
        this.activeSlot = slot;
        return loop;
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ //
  // Répétition — mode « Track Duration »                                  //
  // ------------------------------------------------------------------ //

  /**
   * Réagit à l'événement `Track_Loaded` de l'hôte.
   *
   * `generator` est un appelable (`() => AutoloopTimeline`) qui produit un
   * nouvel Autoloop à partir du contexte courant.
   *
   * - Si `repeatMode` vaut `'infinite'` : ne fait rien (le moteur rejoue la
   *   timeline en boucle) et retourne `null`.
   * - Si `repeatMode` vaut `'track_duration'` : « tue » le loop courant
   *   (l'emplacement actif est remis à vide ; `activeBank` / `activeSlot` sont
   *   conservés pour désigner l'emplacement régénéré), puis appelle
   *   `generator()` pour produire un nouvel `AutoloopTimeline`, le stocke dans
   *   le slot courant et le retourne.
   */
  onTrackLoaded(generator: () => AutoloopTimeline): AutoloopTimeline | null {
    if (this.repeatMode !== 'track_duration') {
      return null; // INFINITE : le moteur rejoue la timeline en boucle.
    }

    // « Tue » le loop courant : remise à vide de l'emplacement actif.
    this.banks[this.activeBank][this.activeSlot] = null;

    // Génère et stocke le remplaçant dans le slot courant.
    const newLoop = generator();
    this.banks[this.activeBank][this.activeSlot] = newLoop;
    return newLoop;
  }

  // ------------------------------------------------------------------ //
  // Remplissage de banque                                                //
  // ------------------------------------------------------------------ //

  /**
   * Remplit les emplacements *libres* de `bank` avec `loops`.
   *
   * Les loops sont placés dans l'ordre (emplacements 0 → 31), sans écraser les
   * emplacements déjà occupés ; le remplissage s'arrête quand `loops` est épuisé
   * ou la banque pleine. Lève `RangeError` si `bank` est hors matrice.
   */
  populate(bank: number, loops: AutoloopTimeline[]): void {
    if (!(bank >= 0 && bank < BANKS)) {
      throw new RangeError(`Banque hors matrice : ${bank}`);
    }
    const row = this.banks[bank];
    let cursor = 0;
    for (let slot = 0; slot < PER_BANK; slot++) {
      if (row[slot] === null) {
        if (cursor >= loops.length) {
          break;
        }
        row[slot] = loops[cursor];
        cursor++;
      }
    }
  }
}
