/**
 * Master Clock — horloge partagée BPM/phase (Ableton Link-ready).
 *
 * Source unique de vérité pour :
 *  - Autoloops (autoloop-engine beat/bar)
 *  - Autoscript QuickShow (genCues + dmx-playback)
 *  - Show/Chaser timing
 *
 * Sources BPM (priorité) : Link > MIDI clock > Tap > Analyse audio > Manual.
 */

import { create } from 'zustand';

type ClockSource = 'manual' | 'tap' | 'midi' | 'link' | 'audio';

interface ClockState {
  bpm: number; // 20..300
  source: ClockSource;
  isPlaying: boolean; // clock running (Link/MIDI transport)
  phase: number; // 0..1 beat phase (pour chasse/step)
  beat: number; // 0..3 inside bar
  bar: number; // absolute bar count
  linkEnabled: boolean;
  // actions
  setBpm: (bpm: number, source?: ClockSource) => void;
  setLinkEnabled: (v: boolean) => void;
  setPlaying: (playing: boolean) => void;
  tap: () => void;
  nudge: (deltaMs: number) => void;
}

let tapTimes: number[] = [];

export const useClockStore = create<ClockState>((set, get) => ({
  bpm: 120,
  source: 'manual',
  isPlaying: true,
  phase: 0,
  beat: 0,
  bar: 0,
  linkEnabled: false,

  setBpm: (bpm, source = 'manual') => {
    const v = Math.max(20, Math.min(300, Math.round(bpm)));
    set({ bpm: v, source });
  },

  setLinkEnabled: (v) => set({ linkEnabled: v, source: v ? 'link' : get().source === 'link' ? 'manual' : get().source }),

  setPlaying: (isPlaying) => set({ isPlaying }),

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
        set({ bpm: Math.round(bpm), source: 'tap', isPlaying: true });
      }
    } else {
      // first tap = reset phase
      set({ phase: 0, beat: 0 });
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
    set((s) => {
      let beat = s.beat + deltaBeats;
      let bar = s.bar;
      while (beat >= 4) { beat -= 4; bar += 1; }
      while (beat < 0) { beat += 4; bar -= 1; }
      return { beat, bar, phase: (beat % 1 + 1) % 1 };
    });
  },
}));

// ─── RAF driver : avance beat/bar/phase au BPM courant ───
let rafId = 0;
let lastNow = performance.now();

function tick() {
  const s = useClockStore.getState();
  if (s.isPlaying) {
    const now = performance.now();
    const dt = now - lastNow;
    lastNow = now;
    const beatMs = 60000 / Math.max(20, s.bpm);
    const deltaBeats = dt / beatMs;
    let beat = s.beat + deltaBeats;
    let bar = s.bar;
    while (beat >= 4) { beat -= 4; bar += 1; }
    useClockStore.setState({ beat, bar, phase: beat % 1 });
  } else {
    lastNow = performance.now();
  }
  rafId = requestAnimationFrame(tick);
}
if (typeof window !== 'undefined' && !rafId) {
  lastNow = performance.now();
  rafId = requestAnimationFrame(tick);
}

// ─── MIDI clock → BPM (optionnel, branché via midi-trigger) ───
export function clockFromMidiClock(bpm: number, running: boolean) {
  if (!Number.isFinite(bpm) || bpm <= 0) return;
  const s = useClockStore.getState();
  // Link a priorité sur MIDI
  if (s.linkEnabled) return;
  useClockStore.setState({ bpm: Math.round(bpm), source: 'midi', isPlaying: running });
}

// ─── Ableton Link (best-effort, no native dep) ───
// Si `abletonlink` est installé, ce module l'utilise ; sinon reste en horloge interne.
// Le main process expose window.lightMaestro.link si dispo — on s'y branche.
let linkPoll: ReturnType<typeof setInterval> | null = null;
export function enableLink(enable: boolean) {
  const api: any = (typeof window !== 'undefined' ? (window as any).lightMaestro?.link : null);
  if (enable && api?.enable) {
    api.enable().catch(() => {});
    if (linkPoll) clearInterval(linkPoll);
    linkPoll = setInterval(async () => {
      try {
        const st = await api.getState();
        if (st && Number.isFinite(st.bpm)) {
          useClockStore.setState({ bpm: Math.round(st.bpm), source: 'link', isPlaying: st.isPlaying ?? true, beat: st.beat ?? 0, bar: st.bar ?? 0 });
        }
      } catch {}
    }, 100);
  } else {
    if (linkPoll) { clearInterval(linkPoll); linkPoll = null; }
    if (api?.disable) api.disable().catch(() => {});
  }
  useClockStore.getState().setLinkEnabled(enable);
}
