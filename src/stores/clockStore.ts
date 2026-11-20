/**
 * Master Clock — horloge partagée BPM/phase (verrouillable sur une source externe).
 *
 * Source unique de vérité pour :
 *  - Autoloops (autoloop-engine beat/bar)
 *  - Autoscript QuickShow (genCues + dmx-playback)
 *  - Show/Chaser timing
 *  - Console : bandeau MasterClockBar (BPM, source, transport)
 *
 * Sources BPM (priorité) : Link > MIDI clock > Tap > Analyse audio > Manual.
 *
 * ── PHASE (Lot 1 — sync logiciel DJ) ───────────────────────────────────────
 * Le BPM seul ne suffit PAS : un chaser qui rejoue ses steps avec la bonne
 * durée mais une phase libre dérive de plus en plus par rapport au logiciel
 * DJ (les lumières finissent « entre deux temps »). L'horloge externe
 * (MIDI clock) fournit donc une PHASE (position dans la noire, 0..1) :
 * à chaque mise à jour, la position locale est recalée sur la phase reçue
 * (correction minimale, ±1/2 temps, pour ne jamais faire sauter le comptage
 * des temps ni des mesures).
 *
 * ── MULTIPLICATEUR (½ / ×1 / ×2) ───────────────────────────────────────────
 * Le tempo effectif est `baseBpm × tempoMultiplier` : c'est le moyen de
 * faire tourner le rig à moitié ou au double du tempo reçu (parité avec
 * DMXDesktop, qui partage ce tempo entre le pupitre, les pads, l'OSC et le
 * remote).
 */

import { create } from 'zustand';

export type ClockSource = 'manual' | 'tap' | 'midi' | 'link' | 'audio';
export type TempoMultiplier = 0.5 | 1 | 2;

interface ClockState {
  /** Tempo EFFECTIF (baseBpm × multiplicateur) — celui qu'utilisent les moteurs. */
  bpm: number; // 20..300
  /** Tempo BRUT reçu de la source (sans multiplicateur) — affichage. */
  baseBpm: number;
  source: ClockSource;
  isPlaying: boolean; // horloge INTERNE en lecture (choix de l'utilisateur)
  /**
   * Transport EXTERNE (MIDI clock / Link) : le logiciel DJ joue-t-il ?
   * Volontairement SEPARÉ de `isPlaying` : quand le DJ met en pause, le
   * show doit CONTINUER (les lumières ne doivent pas se figer au milieu
   * d'un fondu) — seul le VERROUILLAGE sur la phase du DJ est suspendu.
   */
  externalRunning: boolean;
  phase: number; // 0..1 beat phase (pour chasse/step)
  beat: number; // 0..3 inside bar
  bar: number; // absolute bar count
  /** Compteur CONTINU de temps (fractionnaire) — base du verrouillage de phase. */
  totalBeats: number;
  /** Un moteur Link a été demandé par l'utilisateur. */
  linkEnabled: boolean;
  /** Un backend Link EXISTE réellement dans le preload (sinon : bouton inopérant). */
  linkAvailable: boolean;
  /** Le backend Link a réellement delivered un état (Link actif). */
  linkActive: boolean;
  /** Multiplicateur de tempo appliqué aux sources externes. */
  tempoMultiplier: TempoMultiplier;
  // actions
  setBpm: (bpm: number, source?: ClockSource) => void;
  setLinkEnabled: (v: boolean) => void;
  setPlaying: (playing: boolean) => void;
  tap: () => void;
  nudge: (deltaMs: number) => void;
  setTempoMultiplier: (m: TempoMultiplier) => void;
}

/** Tempo REÇU / saisi (base) : plage de référence du pupitre. */
const MIN_BPM = 20;
const MAX_BPM = 300;
/**
 * Tempo EFFECTIF (base × multiplicateur) : plage plus large, sinon le
 * multiplicateur ×2 serait tronqué (174 BPM × 2 = 348 > 300) et le rig ne
 * tournerait PAS au double du tempo du DJ — exactement ce qu'on veut éviter.
 */
const MIN_TEMPO = 10;
const MAX_TEMPO = 600;

/** Borne le tempo de base (saisie manuelle / tempo reçu). */
function clampBpm(v: number): number {
  if (!Number.isFinite(v)) return 120;
  return Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(v)));
}

/** Borne le tempo effectif (après multiplicateur). */
function clampTempo(v: number): number {
  if (!Number.isFinite(v)) return 120;
  return Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, Math.round(v)));
}

function frac(v: number): number {
  return v - Math.floor(v);
}

let tapTimes: number[] = [];

/**
 * Position CONTINUE en temps (fractionnaire). C'est l'unique compteur qui
 * fait foi : `beat`, `bar` et `phase` en sont dérivés, ce qui évite les
 * sauts quand la phase est recalée sur une source externe.
 */
let totalBeats = 0;

/** Recalcule beat/bar/phase à partir du compteur continu. */
function beatStateFromTotal(total: number) {
  const bar = Math.floor(total / 4);
  const beat = total - bar * 4;
  const phase = total - Math.floor(total);
  return { totalBeats: total, beat, bar, phase };
}

export const useClockStore = create<ClockState>((set, get) => ({
  bpm: 120,
  baseBpm: 120,
  source: 'manual',
  isPlaying: true,
  externalRunning: false,
  phase: 0,
  beat: 0,
  bar: 0,
  totalBeats: 0,
  linkEnabled: false,
  linkAvailable: false,
  linkActive: false,
  tempoMultiplier: 1,

  setBpm: (bpm, source = 'manual') => {
    const v = clampBpm(bpm);
    const mult = get().tempoMultiplier;
    set({ baseBpm: v, bpm: clampTempo(v * mult), source });
  },

  setLinkEnabled: (v) =>
    set({
      linkEnabled: v,
      linkActive: false,
      source: v ? 'link' : get().source === 'link' ? 'manual' : get().source,
    }),

  setPlaying: (playing) => set({ isPlaying: playing }),

  setTempoMultiplier: (m) => {
    const s = get();
    set({ tempoMultiplier: m, bpm: clampTempo(s.baseBpm * m) });
  },

  tap: () => {
    const now = performance.now();
    tapTimes.push(now);
    if (tapTimes.length > 4) tapTimes.shift();
    if (tapTimes.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i - 1]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const bpm = 60000 / avg;
      if (bpm >= 40 && bpm <= 300) {
        const mult = get().tempoMultiplier;
        set({
          baseBpm: Math.round(bpm),
          bpm: clampTempo(Math.round(bpm) * mult),
          source: 'tap',
          isPlaying: true,
        });
      }
    } else {
      // first tap = reset phase
      totalBeats = 0;
      set(beatStateFromTotal(0));
    }
    // clear stale taps after 2s
    setTimeout(() => {
      if (performance.now() - (tapTimes[tapTimes.length - 1] ?? 0) > 2000) tapTimes = [];
    }, 2100);
  },

  nudge: (deltaMs) => {
    const { bpm } = get();
    const beatMs = 60000 / Math.max(1, bpm);
    const deltaBeats = deltaMs / beatMs;
    totalBeats += deltaBeats;
    set(beatStateFromTotal(totalBeats));
  },
}));

// ─── RAF driver : avance beat/bar/phase au BPM courant ───
let rafId = 0;
let lastNow = performance.now();

/**
 * Avance l'horloge de `dtMs`. Exporté pour être pilotable en test (node :
 * pas de requestAnimationFrame) et pour les moteurs qui veulent avancer
 * l'horloge de façon déterministe.
 */
export function advanceMasterClock(dtMs: number): void {
  const s = useClockStore.getState();
  if (!s.isPlaying) return;
  const beatMs = 60000 / Math.max(MIN_BPM, s.bpm);
  totalBeats += dtMs / beatMs;
  useClockStore.setState(beatStateFromTotal(totalBeats));
}

function tick() {
  const s = useClockStore.getState();
  const now = performance.now();
  if (s.isPlaying) {
    const dt = now - lastNow;
    lastNow = now;
    advanceMasterClock(dt);
  } else {
    lastNow = now;
  }
  rafId = requestAnimationFrame(tick);
}
if (typeof window !== 'undefined' && !rafId) {
  lastNow = performance.now();
  rafId = requestAnimationFrame(tick);
}

/** Position continue en temps (fractionnaire) — lecture synchrone pour les moteurs. */
export function masterClockTotalBeats(): number {
  return totalBeats;
}

/**
 * Remet l'horloge à zéro (phase, temps, mesures, taps).
 * Utilisé par les tests et par toute remise à zéro explicite de l'horloge.
 */
export function resetMasterClock(): void {
  totalBeats = 0;
  tapTimes = [];
  useClockStore.setState({
    bpm: 120,
    baseBpm: 120,
    source: 'manual',
    isPlaying: true,
    externalRunning: false,
    phase: 0,
    beat: 0,
    bar: 0,
    totalBeats: 0,
  });
}

/**
 * Recale la phase locale sur une phase externe (0..1 dans la noire).
 * Correction MINIMALE (± 1/2 temps) : le compteur de temps et de mesures
 * reste continu, on ne fait jamais sauter un temps ni une mesure.
 */
export function alignMasterClockPhase(externalPhase: number): void {
  if (!Number.isFinite(externalPhase)) return;
  const target = frac(externalPhase);
  const current = frac(totalBeats);
  let delta = target - current;
  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;
  totalBeats += delta;
  useClockStore.setState(beatStateFromTotal(totalBeats));
}

/**
 * Applique un tempo externe (MIDI clock / Link) et, si fournie, la phase.
 *
 * `isPlaying` (horloge interne) n'est PAS touché : la pause du DJ ne doit
 * pas figer le show, elle suspend seulement le verrouillage (`externalRunning`).
 *
 * @param phase position dans la noire (0..1) ; absente = phase libre (non verrouillée).
 */
export function applyExternalClock(
  bpm: number,
  source: ClockSource,
  running: boolean,
  phase?: number,
): void {
  if (!Number.isFinite(bpm) || bpm <= 0) return;
  const mult = useClockStore.getState().tempoMultiplier;
  const base = clampBpm(bpm);
  useClockStore.setState({
    baseBpm: base,
    bpm: clampTempo(base * mult),
    source,
    externalRunning: running,
  });
  if (phase !== undefined) alignMasterClockPhase(phase);
}

// ─── MIDI clock → BPM + PHASE (branché via midi-trigger) ───
export function clockFromMidiClock(bpm: number, running: boolean, phase?: number) {
  if (!Number.isFinite(bpm) || bpm <= 0) return;
  // Link n'a la priorité sur MIDI que si un moteur Link TOURNE RÉELLEMENT
  // (bug corrigé : `linkEnabled` seul suffisait à SILENCIEUX le MIDI clock,
  // alors qu'aucun backend Link n'existe → la sync MIDI était morte).
  if (useClockStore.getState().linkActive) return;
  applyExternalClock(bpm, 'midi', running, phase);
}

// ─── Ableton Link (best-effort, no native dep) ───
// Si un backend `abletonlink` est exposé par le preload, ce module l'utilise ;
// sinon le bouton Link est neutralisé (et n'affecte PAS le MIDI clock).
let linkPoll: ReturnType<typeof setInterval> | null = null;

export function isLinkAvailable(): boolean {
  const api: any = (typeof window !== 'undefined' ? (window as any).lightMaestro?.link : null);
  return !!(api && typeof api.enable === 'function');
}

export function enableLink(enable: boolean) {
  const api: any = (typeof window !== 'undefined' ? (window as any).lightMaestro?.link : null);
  const available = !!(api && typeof api.enable === 'function');
  if (!available) {
    // Pas de backend : on n'active RIEN. Le bouton devient inopérant mais
    // honnête (l'UI affiche « indisponible »), et surtout la source MIDI
    // continue de fonctionner.
    useClockStore.setState({ linkEnabled: false, linkAvailable: false, linkActive: false });
    if (enable) {
      console.warn('[clock] Ableton Link indisponible (aucun backend) — la source MIDI reste active');
    }
    return;
  }
  useClockStore.setState({ linkAvailable: true });
  if (enable && api?.enable) {
    api.enable().catch(() => {});
    if (linkPoll) clearInterval(linkPoll);
    linkPoll = setInterval(async () => {
      try {
        const st = await api.getState();
        if (st && Number.isFinite(st.bpm)) {
          const base = clampBpm(st.bpm);
          useClockStore.setState({
            baseBpm: base,
            bpm: clampTempo(base * useClockStore.getState().tempoMultiplier),
            source: 'link',
            externalRunning: st.isPlaying ?? true,
            linkActive: true,
          });
          if (typeof st.beat === 'number' && typeof st.bar === 'number') {
            // Link fournit une position ABSOLUE (beat/bar) : on peut recaler
            // la phase exacte si elle est fournie.
            if (typeof st.phase === 'number') alignMasterClockPhase(st.phase);
          }
        }
      } catch {}
    }, 100);
  } else {
    if (linkPoll) { clearInterval(linkPoll); linkPoll = null; }
    if (api?.disable) api.disable().catch(() => {});
    useClockStore.setState({ linkActive: false });
  }
  useClockStore.getState().setLinkEnabled(enable);
}
