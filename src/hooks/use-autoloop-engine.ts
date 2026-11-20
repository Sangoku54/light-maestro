// ─── useAutoloopEngine — pont React vers le moteur Autoloop ─────
//
// Instancie le moteur pur (`AutoloopPlaybackEngine`) branché sur la sortie DMX
// réelle via `createAutoLoopOutput`, construit la matrice 4×32 à partir du patch
// courant, et l'avance sur une horloge requestAnimationFrame (même pattern que
// `auto-loop-player.ts`) en dérivant la position (bar, beat) du temps écoulé au
// BPM courant.
//
// Pas de boucle bloquante : la lecture s'arrête en `cancelAnimationFrame`.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShowStore } from '../stores/showStore';
import { useClockStore, masterClockTotalBeats } from '../stores/clockStore';
import { loadFixtureDefinitions, type DmxFixtureDefinition } from './dmx-cues';
import {
  toAutoloopFixtures,
  defaultColorCues,
} from '../engine/autoloop-runtime';
import { buildThemedBanks } from '../engine/autoloop-themes';
import { AutoloopPlaybackEngine } from '../engine/autoloop-engine';
import { BankManager } from '../engine/autoloop-banks';
import { createAutoLoopOutput, AUTO_LOOP_SOURCE_ID } from '../engine/autoloop-adapter';
import { dmxBridge } from '../utils/dmx-bridge';
import { generateAutoscript } from '../engine/autoscript-generator';
import type { AutoloopFixture, AutoloopTimeline, RepeatMode } from '../engine/autoloop-types';

const BEATS_PER_BAR = 4;

/**
 * Temps écoulé de l'autoloop, en temps (monotone).
 *
 * L'autoloop suit l'HORLOGE MAÎTRE (position continue en temps), elle-même
 * recalee sur la phase du logiciel DJ → l'autoloop tombe sur le beat.
 * Quand l'horloge maître est en pause (bouton Pause du bandeau Clock),
 * on avance sur l'horloge murale et on MEMORISE ce temps (`pausedBeats`) :
 * à la reprise, l'autoloop continue EXACTEMENT où il en était (pas de saut
 * en avant ni en arrière).
 *
 * Fonction pure (testable sans DOM).
 */
export function autoloopElapsedBeats(
  masterTotalBeats: number,
  startBeat: number,
  pausedBeats: number,
  pausedWallMs: number,
  beatMs: number,
): { totalBeats: number; pausedBeats: number } {
  const extra = beatMs > 0 ? pausedWallMs / beatMs : 0;
  return {
    totalBeats: masterTotalBeats - startBeat + pausedBeats + extra,
    pausedBeats: pausedBeats + extra,
  };
}

export interface AutoloopEngineApi {
  /** Le patch est prêt et une banque a été construite. */
  ready: boolean;
  playing: boolean;
  repeatMode: RepeatMode;
  activeBank: number;
  activeSlot: number;
  activeLoop: AutoloopTimeline | null;
  banks: BankManager | null;
  play: () => void;
  stop: () => void;
  next: () => void;
  previous: () => void;
  override: () => void;
  select: (bank: number, slot: number) => void;
  setRepeatMode: (mode: RepeatMode) => void;
}

/**
 * @param bpm tempo de l'horloge de lecture (défaut 120).
 */
export function useAutoloopEngine(bpm = 120): AutoloopEngineApi {
  const patchedFixtures = useShowStore((s) => s.patchedFixtures);
  const universes = useShowStore((s) => s.universes);
  const fixturePositions = useShowStore((s) => s.fixturePositions);

  const [defs, setDefs] = useState<Map<string, DmxFixtureDefinition>>(new Map());
  const [banks, setBanks] = useState<BankManager | null>(null);
  const [playing, setPlaying] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('infinite');
  const [activeLoop, setActiveLoop] = useState<AutoloopTimeline | null>(null);
  const [activeBank, setActiveBank] = useState(0);
  const [activeSlot, setActiveSlot] = useState(0);

  const engineRef = useRef<AutoloopPlaybackEngine | null>(null);
  const fixturesRef = useRef<AutoloopFixture[]>([]);
  const bpmRef = useRef(bpm);
  const rafRef = useRef(0);
  const startRef = useRef(0);
  /** Position de départ dans l'horloge MAÎTRE (temps continus). */
  const startBeatRef = useRef(0);
  /** Temps muraux écoulés pendant les pauses de l'horloge maître (temps). */
  const pausedBeatsRef = useRef(0);
  const masterBpm = useClockStore((s) => s.bpm);
  const { i18n } = useTranslation();
  const masterPhase = useClockStore((s) => s.phase);
  // Master Clock overrides local bpm when Link/MIDI/Tap actif — sinon bpm passé en param (QuickShow)
  const effectiveBpm = masterBpm > 0 ? masterBpm : bpm;
  bpmRef.current = effectiveBpm;

  // ── Charge les définitions de fixtures du patch courant. ────────────────
  useEffect(() => {
    if (patchedFixtures.length === 0) {
      setDefs(new Map());
      return;
    }
    let cancelled = false;
    const ids = [...new Set(patchedFixtures.map((f) => f.fixtureDefId))];
    loadFixtureDefinitions(ids)
      .then((d) => {
        if (!cancelled) setDefs(d);
      })
      .catch(() => {
        if (!cancelled) setDefs(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [patchedFixtures]);

  // ── Construit la banque 4×32 + le moteur dès que le patch est analysé. ──
  useEffect(() => {
    if (patchedFixtures.length === 0 || defs.size === 0) {
      setBanks(null);
      return;
    }
    const fixtures = toAutoloopFixtures(patchedFixtures, defs, universes, fixturePositions);
    fixturesRef.current = fixtures;
    if (fixtures.length === 0) {
      setBanks(null);
      return;
    }
    const b = buildThemedBanks(fixtures);
    setBanks(b);
    const output = createAutoLoopOutput(patchedFixtures, universes);
    engineRef.current = new AutoloopPlaybackEngine(output, bpmRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchedFixtures, defs, universes, i18n.language]);

  const stopClock = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  }, []);

  const stop = useCallback(() => {
    stopClock();
    // engine.stop() flush les zéros (matériel + miroir 3D éteints), puis on
    // retire la source LTP : sans release, des zéros persistants bloqueraient
    // l'engine dessous (quickshow…) ; sans zéros, un release seul laisserait
    // le dernier état figé (le flush d'un buffer vide n'éteint rien).
    engineRef.current?.stop();
    try { dmxBridge.release(AUTO_LOOP_SOURCE_ID); } catch { /* sortie best effort */ }
    setPlaying(false);
  }, [stopClock]);

  const play = useCallback(() => {
    const engine = engineRef.current;
    const b = banks;
    if (!engine || !b) return;
    const loop = b.get(b.activeBank, b.activeSlot);
    if (!loop) return;

    engine.load(loop);
    engine.trigger();
    setActiveLoop(loop);
    setPlaying(true);

    stopClock();
    // Deux bases de temps :
    //  - l'HORLOGE MAÎTRE (position continue en temps) : c'est elle qui est
    //    recalee sur la phase du logiciel DJ → l'autoloop tombe sur le beat ;
    //  - l'horloge murale : repli quand l'horloge maître est en pause (le
    //    bouton Play/Pause du bandeau Clock ne doit ni figer l'autoloop ni
    //    le faire sauter en arrière à la reprise).
    startRef.current = performance.now();
    startBeatRef.current = masterClockTotalBeats();
    pausedBeatsRef.current = 0;
    const tick = (now: number) => {
      const e = engineRef.current;
      if (!e) return;
      const beatMs = 60000 / Math.max(1, bpmRef.current);
      const clockPlaying = useClockStore.getState().isPlaying;
      // Delta mural depuis la frame précédente (la 1re frame après `play()`
      // est proche de 0 : startRef vient d'être positionné).
      const dtWall = Math.max(0, now - startRef.current);
      startRef.current = now;
      // Temps mural à ajouter UNIQUEMENT quand l'horloge maître est en pause.
      const pausedWallMs = clockPlaying ? 0 : dtWall;
      const { totalBeats, pausedBeats } = autoloopElapsedBeats(
        masterClockTotalBeats(),
        startBeatRef.current,
        pausedBeatsRef.current,
        pausedWallMs,
        beatMs,
      );
      pausedBeatsRef.current = pausedBeats;
      const bar = Math.floor(totalBeats / BEATS_PER_BAR);
      const beat = totalBeats - bar * BEATS_PER_BAR;
      e.onBarBeat(bar, beat);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [banks, stopClock]);

  const select = useCallback(
    (bank: number, slot: number) => {
      const b = banks;
      if (!b) return;
      const loop = b.select(bank, slot);
      if (loop) {
        setActiveBank(b.activeBank);
        setActiveSlot(b.activeSlot);
        setActiveLoop(loop);
        if (playing) play();
      }
    },
    [banks, playing, play],
  );

  const next = useCallback(() => {
    const b = banks;
    if (!b) return;
    const loop = b.next();
    if (loop) {
      setActiveBank(b.activeBank);
      setActiveSlot(b.activeSlot);
      setActiveLoop(loop);
      if (playing) play();
    }
  }, [banks, playing, play]);

  const previous = useCallback(() => {
    const b = banks;
    if (!b) return;
    const loop = b.previous();
    if (loop) {
      setActiveBank(b.activeBank);
      setActiveSlot(b.activeSlot);
      setActiveLoop(loop);
      if (playing) play();
    }
  }, [banks, playing, play]);

  const override = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const fixtures = fixturesRef.current;
    if (fixtures.length === 0) return;
    // Loop d'override court (2 bars), première couleur, sur la catégorie active.
    const category = activeLoop?.category ?? fixtures[0].category;
    const overrideLoop = generateAutoscript({
      targetBars: 2,
      fixtures,
      category,
      positionCues: [],
      attributeCues: defaultColorCues().slice(0, 1),
    });
    engine.overrideWith(overrideLoop);
  }, [activeLoop]);

  const handleSetRepeatMode = useCallback((mode: RepeatMode) => {
    setRepeatMode(mode);
    const b = banks;
    if (b) b.repeatMode = mode;
  }, [banks]);

  // Nettoyage à l'unmount : arrêt complet (zéros + release, comme stop()).
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    ready: banks !== null,
    playing,
    repeatMode,
    activeBank,
    activeSlot,
    activeLoop,
    banks,
    play,
    stop,
    next,
    previous,
    override,
    select,
    setRepeatMode: handleSetRepeatMode,
  };
}
