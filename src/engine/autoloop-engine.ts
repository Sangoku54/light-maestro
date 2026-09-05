// ─── Autoloop SoundSwitch 2.9 — Module 3 : moteur de lecture temps réel ─────
//
// Port TypeScript pur (zéro dépendance React/Electron/`window`) de la classe
// `PlaybackEngine` du prototype Python (`delivery/autoloop/playback.py`).
//
// Le moteur transforme une `AutoloopTimeline` (module `autoloop-types`) en flux
// DMX continu. Contrairement à un player séquentiel, c'est une **machine à
// états** (IDLE / SCRIPT / OVERRIDE_LOOP) avancée par l'hôte Light Maestro via
// le callback `onBarBeat(bar, beat)` : **aucune boucle bloquante** n'est
// utilisée. La boucle asynchrone `run()` du Python (mode autonome, sans hôte)
// est volontairement omise — l'hôte pilote la lecture.
//
// Ce module n'importe QUE `./autoloop-types`.

import {
  AutoloopTimeline,
  ChannelKey,
  BEATS_PER_BAR,
  timelineLengthBeats,
  computePan,
  computeTilt,
} from './autoloop-types';

/**
 * Interface minimale d'une sortie DMX : émet un mapping adresse → valeur.
 *
 * L'adresse est **1-based** (convention DMX) ; la valeur est dans [0, 255].
 * Cette interface est injectée par l'hôte, ce qui rend le moteur testable
 * sans matériel (on peut passer un mock qui accumule les frames émises).
 */
export interface DmxOutput {
  send(channels: Record<number, number>): void;
}

/** États de la machine à états du moteur de lecture. */
export type EngineState = 'idle' | 'script' | 'override_loop';

/** Borne `x` dans l'intervalle [0, 1] (utilisé pour le facteur d'interpolation). */
function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Moteur de lecture d'Autoloops piloté par l'hôte (pas de boucle bloquante).
 *
 * Rendu piloté par `onBarBeat(bar, beat)` : l'hôte DJ fournit la position
 * globale (bar, beat) du BeatGrid ; le moteur déduit la phase dans la timeline
 * active et émet la frame DMX correspondante.
 *
 * Formules de conversion de temps (portées littéralement) :
 *
 * - `beatMs() = 60000 / bpm`
 * - `barsToMs(bars) = bars * 4 * beatMs()`   (une bar = 4 × beatMs)
 * - `quantizeDelayMs() = (4 - beat) * beatMs()` avec `beat ∈ [0, 4)`
 *
 * Interpolation des keyframes : clés triées par `beat` ; entre la clé
 * précédente (`b0`, `v0`) et la clé courante (`b1`, `v1`) :
 *
 *     `v = v0 + (v1 - v0) * clamp01((beatPos - b0) / rampBeats)`
 *
 * où `rampBeats` est celui de la clé **cible** (celle en `b1`). Si
 * `rampBeats <= 0` → snap : on tient `v0` jusqu'à `b1`, puis on passe à `v1`
 * dès que `beatPos >= b1`. Une recherche dichotomique (équivalent `bisect_right`)
 * localise la clé courante en O(log n).
 */
export class AutoloopPlaybackEngine {
  /** Sortie DMX injectée (adresse 1-based → valeur 0..255). */
  readonly output: DmxOutput;

  /** Tempo courant, en BPM (source de vérité de toutes les conversions temps). */
  bpm: number;

  /**
   * Nom logique (« pan », « tilt », « red », « dimmer », …) → adresse DMX
   * (1-based). L'hôte DOIT renseigner cette correspondance avant le premier
   * rendu pour les canaux référencés par nom logique.
   */
  channelMap: Record<string, number>;

  /** État courant de la machine à états. */
  state: EngineState;

  /** Timeline active (le script chargé, ou le loop d'override en cours). */
  private loop: AutoloopTimeline | null = null;

  /** Clés du loop actif, regroupées par canal puis triées par `beat`. */
  private keysByChannel: Record<string, ChannelKey[]> = {};

  private currentBar = 0;
  private currentBeat = 0.0;
  private prevBeat = 0.0;

  private pendingTrigger = false;
  /** Position globale (en beats) du début de la timeline active. */
  private startBeats = 0.0;
  private lastDmx: Record<number, number> = {};

  // ── État sauvegardé lors d'un override (reprise du script après loop.bars) ──
  private savedLoop: AutoloopTimeline | null = null;
  private savedStartBeats = 0.0;
  private savedBar = 0;
  private savedBeat = 0.0;
  private savedDmx: Record<number, number> = {};
  private overrideStartBeats = 0.0;
  private overrideDurationBeats = 0.0;

  constructor(output: DmxOutput, bpm: number = 120) {
    this.output = output;
    this.bpm = bpm;
    this.channelMap = {};
    this.state = 'idle';
  }

  // ------------------------------------------------------------------ //
  // Conversions de temps
  // ------------------------------------------------------------------ //

  /** Durée d'un beat en millisecondes : `60000 / bpm`. */
  beatMs(): number {
    return 60000 / this.bpm;
  }

  /** Durée de `bars` bars en millisecondes : `bars * 4 * beatMs()`. */
  barsToMs(bars: number): number {
    return bars * BEATS_PER_BAR * this.beatMs();
  }

  /**
   * Délai (ms) avant le prochain barline, selon la position courante.
   *
   * Avec `beat ∈ [0, 4)`, le barline suivant arrive dans `4 - beat` beats.
   */
  quantizeDelayMs(): number {
    return (BEATS_PER_BAR - this.currentBeat) * this.beatMs();
  }

  // ------------------------------------------------------------------ //
  // Cycle de vie
  // ------------------------------------------------------------------ //

  /** Charge un loop (script) sans le démarrer : passage à l'état IDLE armé. */
  load(loop: AutoloopTimeline): void {
    this.loop = loop;
    this.keysByChannel = AutoloopPlaybackEngine.groupKeys(loop.keys);
    this.state = 'idle';
    this.pendingTrigger = false;
  }

  /**
   * Démarre le loop au prochain barline (quantisation).
   *
   * Arme un drapeau ; le basculement vers `script` s'effectue dans
   * `onBarBeat` à la première frame de barline (beat == 0 ou wrap).
   */
  trigger(): void {
    if (this.loop === null) return;
    this.pendingTrigger = true;
  }

  /** Arrête toute lecture : retour à l'état IDLE. */
  stop(): void {
    this.state = 'idle';
    this.pendingTrigger = false;
  }

  /**
   * Joue `loop` temporairement par-dessus le script, puis reprend le script.
   *
   * Machine à états SCRIPT → OVERRIDE_LOOP → SCRIPT : on sauvegarde
   * `(bar, beat)` + l'état DMX courant + la référence du script, on joue
   * `loop` pendant `loop.bars` bars, puis on reprend le script comme s'il
   * avait continué à tourner (voir `resumeScript`).
   */
  overrideWith(loop: AutoloopTimeline): void {
    // Sauvegarde du script courant (position + état DMX).
    this.savedLoop = this.loop;
    this.savedStartBeats = this.startBeats;
    this.savedBar = this.currentBar;
    this.savedBeat = this.currentBeat;
    this.savedDmx = { ...this.lastDmx };

    // Bascule sur le loop d'override.
    this.loop = loop;
    this.keysByChannel = AutoloopPlaybackEngine.groupKeys(loop.keys);
    this.overrideStartBeats = this.currentBar * BEATS_PER_BAR + this.currentBeat;
    this.overrideDurationBeats = timelineLengthBeats(loop);
    this.startBeats = this.overrideStartBeats;
    this.state = 'override_loop';
  }

  // ------------------------------------------------------------------ //
  // Rendu piloté par l'hôte
  // ------------------------------------------------------------------ //

  /**
   * Callback hôte DJ : position globale `(bar, beat)` du BeatGrid.
   *
   * Fait avancer la machine à états (déclenchement quantisé, fin d'override)
   * puis rend la timeline active en une frame DMX.
   */
  onBarBeat(bar: number, beat: number): void {
    this.currentBar = bar;
    this.currentBeat = beat;

    // Un barline = beat == 0.0, ou bien le beat a rebouclé (wrap).
    const isBarline = beat === 0.0 || beat < this.prevBeat;

    // Déclenchement quantisé : démarrage du script au barline suivant.
    if (this.pendingTrigger && isBarline) {
      this.pendingTrigger = false;
      this.startBeats = bar * BEATS_PER_BAR + beat;
      this.state = 'script';
    }

    // Fin d'un override : reprise du script à bar + loop.bars (même beat).
    if (this.state === 'override_loop') {
      const elapsed = bar * BEATS_PER_BAR + beat - this.overrideStartBeats;
      if (elapsed >= this.overrideDurationBeats) {
        this.resumeScript(bar, beat);
      }
    }

    // Rendu de la timeline active (SCRIPT ou OVERRIDE_LOOP).
    if (this.state === 'script' || this.state === 'override_loop') {
      this.renderFrame();
    }

    this.prevBeat = beat;
  }

  /** Calcule et émet la frame DMX de la timeline active à la position courante. */
  private renderFrame(): void {
    const loop = this.loop;
    if (loop === null) return;

    const globalBeats = this.currentBar * BEATS_PER_BAR + this.currentBeat;
    // Modulo POSITIF : en JavaScript l'opérateur `%` renvoie un résultat du
    // signe du dividende (ex. `-1 % 8 === -1`), contrairement à Python où `%`
    // renvoie toujours un résultat ≥ 0. On force donc un résultat positif via
    // `((x % n) + n) % n` pour obtenir la phase dans [0, length).
    const length = timelineLengthBeats(loop);
    const phase = (((globalBeats - this.startBeats) % length) + length) % length;

    const dmx = this.evaluate(loop, phase);
    this.lastDmx = dmx;
    this.output.send(dmx);
  }

  /**
   * Évalue la timeline à la phase `phase` (en beats) : renvoie un mapping
   * adresse DMX → valeur 0..255.
   *
   * Deux façons de rendre cohabitent :
   *
   * 1. **Keyframes discrets** (couleur / intensité / pan-tilt ponctuels) via
   *    l'interpolation par canal des `ChannelKey`.
   * 2. **Mouvement continu** pan/tilt via `computePan(phase)` / `computeTilt(phase)`,
   *    qui écrase les canaux pan/tilt s'ils sont présents dans `channelMap`.
   */
  private evaluate(loop: AutoloopTimeline, phase: number): Record<number, number> {
    const out: Record<number, number> = {};

    // 1) Keyframes discrets.
    for (const channel of Object.keys(this.keysByChannel)) {
      const addr = this.resolveAddress(channel);
      if (addr === null) continue;
      out[addr] = this.interpolate(this.keysByChannel[channel], phase);
    }

    // 2) Mouvement continu pan/tilt (PositionCue).
    const cue = loop.positionCue;
    if (cue) {
      const panAddr = this.channelMap['pan'];
      const tiltAddr = this.channelMap['tilt'];
      if (panAddr !== undefined) out[panAddr] = computePan(cue, phase);
      if (tiltAddr !== undefined) out[tiltAddr] = computeTilt(cue, phase);
    }

    return out;
  }

  /**
   * Résout un identifiant de canal vers une adresse DMX (1-based).
   *
   * Deux conventions cohabitent :
   *
   * - `channel` est un nom logique (« pan », « red », …) : on le remappe via
   *   `channelMap` (à renseigner par l'hôte) ;
   * - `channel` encode directement l'adresse DMX absolue en chaîne (forme
   *   produite par le générateur, car la timeline ne transporte aucune table
   *   de fixtures) : on la parse.
   *
   * Retourne `null` si le canal ne peut être résolu.
   */
  private resolveAddress(channel: string): number | null {
    const mapped = this.channelMap[channel];
    if (mapped !== undefined) return mapped;
    const parsed = parseInt(channel, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  /**
   * Valeur interpolée d'un canal à la position `beatPos` (en beats).
   *
   * Les clés sont triées par `beat` ; une recherche dichotomique (équivalent
   * `bisect_right`) localise la clé courante en O(log n). Entre la clé
   * précédente (`b0`, `v0`) et la clé courante (`b1`, `v1`) :
   *
   *     v = v0 + (v1 - v0) * clamp01((beatPos - b0) / rampBeats)
   *
   * `rampBeats` est celui de la clé **cible** (celle en `b1`). Si
   * `rampBeats <= 0` → snap : on tient `v0` jusqu'à `b1`, puis `v1` dès que
   * `beatPos >= b1`.
   */
  private interpolate(keys: ChannelKey[], beatPos: number): number {
    // bisect_right : premier index dont la clé a un `beat` strictement > beatPos.
    let lo = 0;
    let hi = keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (keys[mid].beat <= beatPos) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const idx = lo;

    if (idx <= 0) {
      // Avant (ou sur) la première clé : valeur de départ.
      return keys[0].value;
    }
    if (idx >= keys.length) {
      // Après la dernière clé : on tient la dernière valeur.
      return keys[keys.length - 1].value;
    }

    const prev = keys[idx - 1]; // clé précédente (b0, v0)
    const target = keys[idx]; // clé courante (b1, v1)
    const b0 = prev.beat;
    const v0 = prev.value;
    const v1 = target.value;
    const ramp = target.rampBeats ?? 0; // rampBeats de la clé CIBLE

    if (ramp <= 0) {
      // snap : beatPos < b1 ici → on tient v0 ; v1 sera atteint au passage de b1.
      return v0;
    }

    const t = clamp01((beatPos - b0) / ramp);
    return Math.round(v0 + (v1 - v0) * t);
  }

  /**
   * Reprend le script sauvegardé, comme s'il avait continué à tourner pendant
   * l'override (phase « raccord sans trou »).
   *
   * `savedPhase` est la phase du script au moment de la sauvegarde ; on
   * l'avance de la durée de l'override, puis on recale `startBeats` pour que la
   * position courante corresponde à cette phase reprise.
   */
  private resumeScript(bar: number, beat: number): void {
    const saved = this.savedLoop;
    if (saved === null) {
      this.state = 'idle';
      return;
    }

    // Phase du script au moment de la sauvegarde, avancée de la durée de l'override.
    const savedPhase =
      this.savedBar * BEATS_PER_BAR + this.savedBeat - this.savedStartBeats;
    const resumePhase = savedPhase + this.overrideDurationBeats;
    const nowBeats = bar * BEATS_PER_BAR + beat;
    this.startBeats = nowBeats - resumePhase;

    this.loop = saved;
    this.keysByChannel = AutoloopPlaybackEngine.groupKeys(saved.keys);
    this.state = 'script';

    // Restaure l'état DMX du script pour éviter un trou visuel au raccord.
    this.output.send(this.savedDmx);
    this.lastDmx = { ...this.savedDmx };
  }

  /** Regroupe les clés par canal logique et trie chaque groupe par `beat`. */
  private static groupKeys(keys: ChannelKey[]): Record<string, ChannelKey[]> {
    const grouped: Record<string, ChannelKey[]> = {};
    for (const key of keys) {
      const arr = grouped[key.channel];
      if (arr) {
        arr.push(key);
      } else {
        grouped[key.channel] = [key];
      }
    }
    for (const channel of Object.keys(grouped)) {
      grouped[channel].sort((a, b) => a.beat - b.beat);
    }
    return grouped;
  }
}
