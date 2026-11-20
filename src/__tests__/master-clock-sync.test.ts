/**
 * Lot 1 — synchronisation avec un logiciel DJ (MIDI Clock).
 *
 * Couvre :
 *  1. l'horloge maître recoit le BPM ET la phase externe (position dans la
 *     noire) et se RECALE dessus (correction minimale, sans casser le
 *     comptage des mesures) ;
 *  2. le multiplicateur de tempo (½ / ×1 / ×2) ;
 *  3. RÉGRESSION : le bouton « Link » ne doit PLUS silenceusement tuer la
 *     sync MIDI Clock (aucun moteur Link n'existe dans cette version) ;
 *  4. le main envoie une phase calculée depuis les pulses 0xF8 ;
 *  5. le chaser se VERROUILLE sur l'horloge externe : les steps sont
 *     quantifiés en temps et tombent sur les temps du DJ.
 *
 * Tout est virtuel : aucun DMX réel (envois capturés), aucune horloge MIDI.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const sent: Array<{ channels: Record<number, number>; source: string }> = [];

vi.mock('../utils/dmx-helpers', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    sendChannelsToHardwareAndStore: vi.fn(
      async (channels: Record<number, number>, _fixtures: any, _universes: any, source: string) => {
        sent.push({ channels: { ...channels }, source });
      },
    ),
  };
});

import {
  useClockStore,
  clockFromMidiClock,
  advanceMasterClock,
  masterClockTotalBeats,
  enableLink,
  applyExternalClock,
  resetMasterClock,
} from '../stores/clockStore';
import { useShowStore } from '../stores/showStore';
import { midiPlayChaser, midiStopChaser, planLockedStep, __chaserEngineState } from '../engine/midi-actions';
import { autoloopElapsedBeats } from '../hooks/use-autoloop-engine';
import { MidiManager } from '@electron/midi/manager';

const closeTo = (a: number, b: number, eps = 0.02) => Math.abs(a - b) <= eps;

beforeEach(() => {
  sent.length = 0;
  resetMasterClock();
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
    linkEnabled: false,
    linkAvailable: false,
    linkActive: false,
    tempoMultiplier: 1,
  });
  useShowStore.setState({
    scenes: [{ id: 'sc-1', name: 'Rouge', channels: { 1: 255 }, fadeIn: 0, fadeOut: 0, duration: 0 }],
    chasers: [
      {
        id: 'ch-1',
        name: 'Chaser',
        steps: [
          { sceneId: 'sc-1', fadeIn: 500, hold: 1000, fadeOut: 500 },
          { sceneId: 'sc-1', fadeIn: 500, hold: 1000, fadeOut: 500 },
        ],
        direction: 'forward',
      },
    ],
    patchedFixtures: [],
    universes: [],
  } as any);
});

// ─── 1. Phase externe ───────────────────────────────────────

// ─── 6. Autoloop ancré sur l'horloge maître ────────────────

describe('Autoloop — ancrage sur l’horloge maître', () => {
  const BEAT_MS = 500; // 120 BPM

  it('suit la position continue de l’horloge maître', () => {
    const r = autoloopElapsedBeats(10, 4, 0, 0, BEAT_MS);
    expect(r.totalBeats).toBe(6);
    expect(r.pausedBeats).toBe(0);
  });

  it('l’horloge maître en pause → avance sur l’horloge murale', () => {
    // 1 s de pause à 120 BPM = 2 temps.
    const r = autoloopElapsedBeats(10, 4, 0, 1000, BEAT_MS);
    expect(r.totalBeats).toBe(8);
    expect(r.pausedBeats).toBe(2);
  });

  it('à la reprise, le temps est conservé (pas de saut en arrière)', () => {
    // Pause de 2 temps mémorisée : l'horloge maître est figée à 10.
    const paused = autoloopElapsedBeats(10, 4, 0, 1000, BEAT_MS);
    expect(paused.totalBeats).toBe(8);
    // La reprise : la maître repart de 10 et avance d'UN temps → 9.
    // (et surtout PAS 7 : le temps de pause n'est pas perdu)
    const resumed = autoloopElapsedBeats(11, 4, paused.pausedBeats, 0, BEAT_MS);
    expect(resumed.totalBeats).toBe(9);
    expect(resumed.pausedBeats).toBe(2);
  });
});

describe('Horloge maître — phase externe', () => {
  it('applique le BPM et la source du MIDI clock', () => {
    clockFromMidiClock(128, true, 0);
    const s = useClockStore.getState();
    expect(s.bpm).toBe(128);
    expect(s.baseBpm).toBe(128);
    expect(s.source).toBe('midi');
    expect(s.isPlaying).toBe(true);
    expect(s.externalRunning).toBe(true);
  });

  it('la pause du DJ ne fige PAS le show interne', () => {
    clockFromMidiClock(128, true, 0);
    // Le DJ met en pause : le verrouillage est suspendu…
    clockFromMidiClock(128, false, 0);
    const s = useClockStore.getState();
    expect(s.externalRunning).toBe(false);
    // …mais l'horloge interne continue (les lumières ne se figent pas).
    expect(s.isPlaying).toBe(true);
    advanceMasterClock(500);
    expect(useClockStore.getState().totalBeats).toBeGreaterThan(1);
  });

  it('recale la phase locale sur la phase reçue', () => {
    advanceMasterClock(300); // 300 ms à 120 BPM = 0,6 temps
    expect(closeTo(useClockStore.getState().phase, 0.6, 0.05)).toBe(true);

    clockFromMidiClock(120, true, 0.25);
    expect(closeTo(useClockStore.getState().phase, 0.25)).toBe(true);
  });

  it('ne fait pas sauter les mesures (correction minimale)', () => {
    advanceMasterClock(4600); // ~9,2 temps à 120 BPM → barre 2
    const before = useClockStore.getState();
    expect(before.bar).toBe(2);

    // Phase externe très proche : la correction doit rester < 1/2 temps,
    // donc la barre NE CHANGE PAS.
    clockFromMidiClock(120, true, before.phase + 0.05);
    const after = useClockStore.getState();
    expect(after.bar).toBe(before.bar);
    expect(after.totalBeats).toBeGreaterThan(before.totalBeats - 1);
  });

  it('avance la phase avec le temps quand aucune source externe ne parle', () => {
    advanceMasterClock(500); // 1 temps à 120 BPM
    const s = useClockStore.getState();
    expect(closeTo(s.phase, 0, 0.05)).toBe(true);
    expect(s.beat).toBe(1);
  });

  it('la position continue en temps reste monotone', () => {
    const t0 = masterClockTotalBeats();
    advanceMasterClock(250);
    expect(masterClockTotalBeats()).toBeGreaterThan(t0);
  });
});

// ─── 2. Multiplicateur de tempo ─────────────────────────────

describe('Horloge maître — multiplicateur de tempo', () => {
  it('½ et ×2 s’appliquent au tempo reçu', () => {
    clockFromMidiClock(128, true, 0);
    useClockStore.getState().setTempoMultiplier(0.5);
    expect(useClockStore.getState().bpm).toBe(64);
    expect(useClockStore.getState().baseBpm).toBe(128);

    useClockStore.getState().setTempoMultiplier(2);
    expect(useClockStore.getState().bpm).toBe(256);
    expect(useClockStore.getState().baseBpm).toBe(128);

    useClockStore.getState().setTempoMultiplier(1);
    expect(useClockStore.getState().bpm).toBe(128);
  });

  it('le tempo reçu reste la référence (le multiplicateur ne le corrompt pas)', () => {
    clockFromMidiClock(100, true, 0);
    useClockStore.getState().setTempoMultiplier(0.5);
    clockFromMidiClock(100, true, 0);
    expect(useClockStore.getState().bpm).toBe(50);
    expect(useClockStore.getState().baseBpm).toBe(100);
  });

  it('×2 n’est PAS tronqué à 300 BPM (174 × 2 = 348)', () => {
    clockFromMidiClock(174, true, 0);
    useClockStore.getState().setTempoMultiplier(2);
    expect(useClockStore.getState().bpm).toBe(348);
    expect(useClockStore.getState().baseBpm).toBe(174);
  });
});

// ─── 3. RÉGRESSION : le bouton Link ─────────────────────────

describe('Régression — le bouton Link ne doit pas casser la sync MIDI', () => {
  it('sans moteur Link, enableLink(true) n’active RIEN', () => {
    enableLink(true);
    const s = useClockStore.getState();
    expect(s.linkEnabled).toBe(false);
    expect(s.linkAvailable).toBe(false);
  });

  it('sans moteur Link, le MIDI clock continue de piloter le tempo', () => {
    enableLink(true); // ce que fait l'utilisateur en cliquant « Link »
    clockFromMidiClock(140, true, 0);
    const s = useClockStore.getState();
    expect(s.source).toBe('midi');
    expect(s.bpm).toBe(140);
  });

  it('avec un faux moteur Link actif, le MIDI clock passe bien le relais', () => {
    applyExternalClock(120, 'link', true, 0);
    useClockStore.setState({ linkActive: true });
    clockFromMidiClock(140, true, 0);
    // Link actif → le MIDI ne doit PAS écraser le tempo Link.
    expect(useClockStore.getState().bpm).toBe(120);
    expect(useClockStore.getState().source).toBe('link');
  });
});

// ─── 4. Main : phase calculée depuis les pulses 0xF8 ───────

describe('MidiManager — phase du MIDI clock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('émet un BPM et une phase (0..1 dans la noire)', () => {
    const manager = new MidiManager();
    const events: any[] = [];
    manager.on('clock', (c: any) => events.push(c));

    // 24 pulses à 20 ms = 480 ms par noire → 125 BPM
    vi.setSystemTime(1_000_000);
    for (let i = 0; i < 24; i++) {
      vi.setSystemTime(1_000_000 + i * 20);
      (manager as any).handleMidiMessage([0xf8]);
    }
    vi.setSystemTime(1_000_000 + 24 * 20);
    (manager as any).emitClock(Date.now(), true); // émission forcée

    expect(events.length).toBeGreaterThan(0);
    const last = events[events.length - 1];
    expect(last.running).toBe(true);
    expect(last.bpm).toBeGreaterThan(100);
    expect(last.phase).toBeGreaterThanOrEqual(0);
    expect(last.phase).toBeLessThan(1);
  });

  it('la phase repart de 0 sur un START', () => {
    const manager = new MidiManager();
    const events: any[] = [];
    manager.on('clock', (c: any) => events.push(c));

    vi.setSystemTime(1_000_000);
    (manager as any).handleMidiMessage([0xf8]);
    (manager as any).handleMidiMessage([0xfa]);
    const start = events[events.length - 1];
    expect(start.running).toBe(true);
    expect(start.phase).toBe(0);

    // 24 pulses plus tard → on revient sur la frontière de temps.
    for (let i = 0; i < 24; i++) {
      vi.setSystemTime(1_000_000 + (i + 1) * 20);
      (manager as any).handleMidiMessage([0xf8]);
    }
    vi.setSystemTime(1_000_000 + 25 * 20);
    (manager as any).emitClock(Date.now(), true);
    const end = events[events.length - 1];
    expect(end.phase).toBeLessThan(0.2); // proche de 0 (un pulse de retard)
  });

  it('un STOP arrête le clock', () => {
    const manager = new MidiManager();
    const events: any[] = [];
    manager.on('clock', (c: any) => events.push(c));
    (manager as any).handleMidiMessage([0xfc]);
    expect(events[events.length - 1].running).toBe(false);
  });
});

// ─── 5. Chaser verrouillé ───────────────────────────────────

describe('Chaser verrouillé sur l’horloge externe', () => {
  afterEach(() => {
    midiStopChaser('ch-1');
    vi.useRealTimers();
  });

  it('quantifie un step sur la grille de temps', () => {
    // Step 500+1000+500 = 2000 ms = 4 temps à 120 BPM.
    const at120 = planLockedStep({ fadeIn: 500, hold: 1000, fadeOut: 500 }, {}, 120);
    expect(at120.stepBeats).toBe(4);
    expect(at120.totalMs).toBe(2000);

    // À 128 BPM : la durée musicale est conservée → 4 temps de 128 BPM.
    const at128 = planLockedStep({ fadeIn: 500, hold: 1000, fadeOut: 500 }, {}, 128);
    expect(at128.stepBeats).toBe(4);
    expect(at128.totalMs).toBeCloseTo(1875, 0);
  });

  it('un step trop court est ramené à 1 temps (jamais 0)', () => {
    const plan = planLockedStep({ fadeIn: 0, hold: 50, fadeOut: 0 }, {}, 120);
    expect(plan.stepBeats).toBe(1);
  });

  it('le chaser démarre sur une frontière de temps et suit l’horloge', () => {
    vi.useFakeTimers();
    useClockStore.setState({
      source: 'midi',
      isPlaying: true,
      externalRunning: true,
      bpm: 120,
      baseBpm: 120,
    });

    midiPlayChaser('ch-1');
    vi.advanceTimersByTime(20); // une frame

    // Le premier step commence au TEMPS SUIVANT (totalBeats = 1) : à 0,05
    // temps on est encore « avant » → niveau quasi nul.
    advanceMasterClock(50);
    vi.advanceTimersByTime(20);
    const early = sent[sent.length - 1];
    expect(early).toBeDefined();
    expect(early.channels[1]).toBeLessThan(60);

    // Un temps complet après le début du step (500 ms de fadeIn) → 255.
    advanceMasterClock(950);
    vi.advanceTimersByTime(20);
    const full = sent[sent.length - 1];
    expect(full.channels[1]).toBe(255);
  });

  it('sans source externe, le chaser reste sur le moteur historique (timers)', () => {
    vi.useFakeTimers();
    useClockStore.setState({ source: 'manual', isPlaying: true, bpm: 120, baseBpm: 120 });
    midiPlayChaser('ch-1');
    // Le moteur historique n'écrit rien tant que la frame n'a pas tourné :
    // surtout, il ne doit PAS avoir démarré le moteur verrouillé.
    expect(sent.length).toBe(0);
    expect(__chaserEngineState().free).toContain('ch-1');
    expect(__chaserEngineState().locked).not.toContain('ch-1');
  });

  it('l’arrivée du MIDI clock bascule le chaser libre en moteur verrouillé (pas de double moteur)', () => {
    vi.useFakeTimers();
    // 1. Chaser lancé SANS horloge externe → moteur libre (timers).
    useClockStore.setState({ source: 'manual', isPlaying: true, bpm: 120, baseBpm: 120 });
    midiPlayChaser('ch-1');
    expect(__chaserEngineState().free).toContain('ch-1');
    expect(__chaserEngineState().locked).not.toContain('ch-1');

    // 2. Le logiciel DJ démarre → le chaser libre doit être ARRÊTÉ, sinon
    //    deux moteurs écrivent les mêmes canaux (fight DMX).
    useClockStore.setState({
      source: 'midi',
      externalRunning: true,
      isPlaying: true,
      bpm: 128,
      baseBpm: 128,
    });
    midiPlayChaser('ch-1');
    expect(__chaserEngineState().free).not.toContain('ch-1');
    expect(__chaserEngineState().locked).toContain('ch-1');
  });
});
