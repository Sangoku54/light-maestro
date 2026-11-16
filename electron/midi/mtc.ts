/**
 * MTC Decoder — MIDI Time Code entrant (lot #15)
 *
 * Décode les deux familles de messages MTC :
 *   - Quarter Frame (QF) : `F1 xx`, 8 pièces (0→7) par valeur de temps
 *     complète, 4 pièces par frame SMPTE → une valeur complète toutes les
 *     2 frames. L'octet data = nibble bas (index de pièce 0-7) + nibble
 *     haut (4 bits de données).
 *   - Full Frame (FF) : SysEx `F0 7F 7F 01 01 hh mm ss ff F7` — saut de
 *     timeline / positionnement initial, verrouille immédiatement.
 *
 * Pièces QF : 0=frames_low, 1=frames_high, 2=seconds_low, 3=seconds_high,
 * 4=minutes_low, 5=minutes_high, 6=hours_low, 7=hours_high+rate.
 * Octet heures reconstitué `0rrhhhhh` : bits 6-5 = rate
 * (00=24, 01=25, 10=29.97 drop, 11=30), bits 4-0 = heure 0-23.
 *
 * Règles (spécification subagent_20_mtc_spec.md) :
 *   - Parseur événementiel strict : séquence 0→7 validée, resync sur la
 *     pièce 0 en cas de QF perdu/dupliqué/hors ordre (jamais de valeur
 *     hybride construite à partir de cycles différents).
 *   - Mise à jour UNIQUEMENT à cycle complet (pièce 7) ou sur FF.
 *   - Lock : fenêtre temporelle sans message valide (MTC_UNLOCK_TIMEOUT_MS
 *     = 1000 ms, ordre de grandeur des implémentations DAW/consoles ; la
 *     spec MIDI ne définit aucune valeur standard). Le lock est recalculé
 *     en lazy dans getState() — le manager émet à la transition.
 *   - Drop-frame 29.97 : on n'interpole RIEN, on affiche les compteurs tels
 *     quels ; la conversion en frames absolues/ms (pour les cues) applique
 *     l'algorithme de comptage drop-frame (2 compteurs sautés par minute
 *     sauf les minutes divisibles par 10) — cf. src/engine/mtc-markers.ts.
 *   - Changement de rate en cours de flux : le nouveau rate est adopté au
 *     cycle complet / FF suivant (le flux est la vérité).
 *   - Scrub arrière : la position absolue d'un cycle complet est acceptée
 *     telle quelle (aucun « pompage ») ; les sauts arrière sont gérés par
 *     l'anti-rebond des marqueurs côté renderer (reset sur jump).
 *
 * Module PUR : aucun import electron — testable en node depuis
 * src/__tests__/mtc-decode.test.ts (pattern validé par electron/remote).
 */

export type MtcRate = '24' | '25' | '30drop' | '30';

export interface MtcState {
  /** Le flux est valide et suit (cycle QF complet ou FF reçu récemment). */
  locked: boolean;
  hours: number;
  minutes: number;
  seconds: number;
  frames: number;
  /** Rate décodé du flux (bits rate de l'octet heures). */
  rate: MtcRate;
  /** Frames par seconde nominal (30 pour 30drop, cf. comptage drop-frame). */
  fps: number;
  /** Dernière source ayant produit la valeur courante. */
  lastSource: 'qf' | 'full-frame';
}

/** Timeout d'unlock : pas de message MTC valide depuis cette durée → unlocked.
 *  1 s ≈ 100-125 QF manquants (QF toutes les ~8-10 ms). En dessous de
 *  ~500 ms le moindre trou de buffer USB ferait clignoter l'état ; au-delà
 *  de ~2 s l'opérateur ne réagit plus. (Aucune valeur standard dans la
 *  spec MIDI — cf. subagent_20_mtc_spec.md §A.4.2.) */
export const MTC_UNLOCK_TIMEOUT_MS = 1000;

const RATE_BITS: Record<number, MtcRate> = { 0: '24', 1: '25', 2: '30drop', 3: '30' };

function rateToFps(rate: MtcRate): number {
  switch (rate) {
    case '24': return 24;
    case '25': return 25;
    default: return 30; // '30drop' compte en 30 nominal (compteurs sautés)
  }
}

const IDLE_STATE: MtcState = {
  locked: false,
  hours: 0,
  minutes: 0,
  seconds: 0,
  frames: 0,
  rate: '30',
  fps: 30,
  lastSource: 'qf',
};

export class MtcDecoder {
  private parts = new Array<number>(8).fill(0);
  private expectedPiece = 0;
  /** Un cycle complet (ou un FF) a déjà été reçu → l'état est significatif. */
  private haveCycle = false;
  private lastActivity = 0;
  private state: MtcState = { ...IDLE_STATE };

  /**
   * Traite un Quarter Frame (`F1 <value>`). Retourne `true` quand un cycle
   * complet (8 pièces) a été décodé — le manager émet alors l'état.
   */
  pushQuarterFrame(value: number): boolean {
    // Le QF est un byte MIDI complet : nibble bas = pièce (0-7), nibble haut
    // = 4 bits de données (0-15). Les données ≥ 8 sont VALIDES (ex. frames
    // 8-15) → seule la borne byte (0-255) et l'index de pièce sont vérifiés.
    if (!Number.isInteger(value) || value < 0 || value > 0xff) return false;
    const piece = value & 0x0f;
    const data = (value >> 4) & 0x0f;
    if (piece > 7) return false; // index 8-15 invalides

    if (piece !== this.expectedPiece) {
      // Hors séquence : perte/duplication. Seule une pièce 0 re-synchronise
      // (cycle neuf) ; tout le reste est ignoré — jamais de valeur hybride.
      if (piece === 0) {
        this.expectedPiece = 1;
        this.parts[0] = data;
        this.lastActivity = Date.now();
        return false;
      }
      return false;
    }

    this.parts[piece] = data;
    this.lastActivity = Date.now();

    if (piece === 7) {
      this.expectedPiece = 0;
      this.commitCycle();
      return true;
    }
    this.expectedPiece = piece + 1;
    return false;
  }

  /**
   * Traite un SysEx brut. Retourne `true` si c'était un Full Frame MTC
   * valide (position appliquée, lock immédiat). Tout autre SysEx est
   * ignoré proprement.
   */
  pushFullFrame(bytes: number[]): boolean {
    if (!Array.isArray(bytes) || bytes.length < 10) return false;
    // F0 7F <deviceId> 01 01 hh mm ss ff F7 — 2e byte 0x7F = Universal
    // System Exclusive (real time) ; 3e byte = device ID (certains
    // émetteurs — DAW, convertisseurs — utilisent un ID précis au lieu
    // de 0x7F broadcast) ; sub-ID1 = 01 (Time Code), sub-ID2 = 01 (FF).
    if (bytes[0] !== 0xf0 || bytes[1] !== 0x7f) return false;
    if (bytes[3] !== 0x01 || bytes[4] !== 0x01) return false;
    if (bytes[9] !== 0xf7) return false;

    const hh = bytes[5] ?? 0;
    const mm = bytes[6] ?? 0;
    const ss = bytes[7] ?? 0;
    const ff = bytes[8] ?? 0;
    const rate = RATE_BITS[(hh >> 5) & 0x03] ?? '30';

    this.state = {
      locked: true,
      hours: Math.min(hh & 0x1f, 23), // clamp 24h+ (certains émetteurs wrap)
      minutes: Math.min(mm & 0x3f, 59),
      seconds: Math.min(ss & 0x3f, 59),
      frames: Math.min(ff & 0x3f, 29),
      rate,
      fps: rateToFps(rate),
      lastSource: 'full-frame',
    };
    this.haveCycle = true;
    this.expectedPiece = 0;
    this.lastActivity = Date.now();
    return true;
  }

  /** Construit la valeur complète depuis les 8 pièces du cycle courant. */
  private commitCycle(): void {
    const frame = ((this.parts[1] & 0x0f) << 4) | (this.parts[0] & 0x0f);
    const seconds = ((this.parts[3] & 0x0f) << 4) | (this.parts[2] & 0x0f);
    const minutes = ((this.parts[5] & 0x0f) << 4) | (this.parts[4] & 0x0f);
    // Pièce 7 = nibble haut de l'octet heures `0rrhhhhh` :
    //   bit3 = 0, bit2 = rate(1), bit1 = rate(0), bit0 = heure(bit4)
    const hoursHigh = this.parts[7] & 0x0f;
    const hours = ((hoursHigh & 0x01) << 4) | (this.parts[6] & 0x0f);
    const rate = RATE_BITS[(hoursHigh >> 1) & 0x03] ?? '30';

    this.state = {
      locked: true,
      hours: Math.min(hours & 0x1f, 23), // clamp 24h+ (certains émetteurs wrap)
      minutes: Math.min(minutes & 0x3f, 59),
      seconds: Math.min(seconds & 0x3f, 59),
      frames: Math.min(frame & 0x3f, 29),
      rate,
      fps: rateToFps(rate),
      lastSource: 'qf',
    };
    this.haveCycle = true;
  }

  /** État courant — le flag `locked` est recalculé en lazy (timeout). */
  getState(): MtcState {
    if (!this.haveCycle || this.lastActivity === 0) return { ...IDLE_STATE };
    const locked = Date.now() - this.lastActivity < MTC_UNLOCK_TIMEOUT_MS;
    return { ...this.state, locked };
  }

  /** Remise à zéro complète (déconnexion du port MIDI, nouveau flux). */
  reset(): void {
    this.parts.fill(0);
    this.expectedPiece = 0;
    this.haveCycle = false;
    this.lastActivity = 0;
    this.state = { ...IDLE_STATE };
  }
}
