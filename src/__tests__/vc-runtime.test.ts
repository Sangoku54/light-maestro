/**
 * Runtime de la Console Virtuelle (`src/engine/virtual-console-runtime.ts`).
 *
 * Couvre ce qui, avant l'extraction, vivait dans `VCButtonWidget` (donc non
 * testable) : fade/hold de la scène, boucle de chaser, blackout, et surtout
 * l'EXTINCTION à la désactivation de la tuile (le motif du chantier P0).
 *
 * Tout est piloté en virtuel : envois DMX capturés (`__setVCSender`),
 * blackout/restore remplacés (`__setVCBlackoutFns`), timers factices.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  vcActivateScene,
  vcActivateChaser,
  vcActivateBlackout,
  vcActivateGrandMaster,
  vcActivateDmxChannel,
  vcDeactivate,
  vcButtonPress,
  vcSetSliderFraction,
  vcIsRunning,
  vcOnRunChange,
  vcStopAllRuns,
  __setVCSender,
  __setVCBlackoutFns,
  __setVCButtonFns,
} from '../engine/virtual-console-runtime';
import { useShowStore } from '../stores/showStore';
import { usePerformStore } from '../stores/performStore';

type Sent = Record<number, number>;

let sent: Sent[] = [];
let blackoutCalls: string[] = [];
let gmCalls: number[] = [];
let channelCalls: Array<{ universe: number; address: number; value: number }> = [];
let events: Array<{ id: string; running: boolean; kind: string }> = [];
let unsubscribe: (() => void) | null = null;

const last = (): Sent | undefined => sent[sent.length - 1];

const widget = (id: string, config: Record<string, unknown>) => ({
  id,
  type: 'button' as const,
  x: 0, y: 0, width: 100, height: 48,
  pageIndex: 0,
  config: config as any,
});

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  blackoutCalls = [];
  gmCalls = [];
  channelCalls = [];
  events = [];
  __setVCSender((channels) => { sent.push(channels); });
  __setVCBlackoutFns({
    blackout: () => { blackoutCalls.push('blackout'); },
    restore: () => { blackoutCalls.push('restore'); },
  });
  __setVCButtonFns({
    applyGrandMaster01: (v) => { gmCalls.push(v); },
    setChannel: (universe, address, value) => { channelCalls.push({ universe, address, value }); },
  });
  unsubscribe = vcOnRunChange((id, running, kind) => { events.push({ id, running, kind }); });

  useShowStore.setState({
    scenes: [
      // Hold infini (duration=0), pas de fade
      { id: 's-hold', name: 'Hold', channels: { 1: 200, 2: 100 }, fadeIn: 0, fadeOut: 0, duration: 0 },
      // Scène datée : hold = 1000 ms (duration inclut les fades)
      { id: 's-timed', name: 'Timed', channels: { 3: 255 }, fadeIn: 0, fadeOut: 0, duration: 1000 },
      // Fade in/out
      { id: 's-fade', name: 'Fade', channels: { 4: 120 }, fadeIn: 100, fadeOut: 100, duration: 300 },
      // Deuxième étape de chaser
      { id: 's-two', name: 'Two', channels: { 5: 50 }, fadeIn: 0, fadeOut: 0, duration: 0 },
    ] as any,
    chasers: [
      {
        id: 'ch1',
        name: 'Chaser',
        steps: [
          { sceneId: 's-hold', fadeIn: 0, fadeOut: 0, hold: 50 },
          { sceneId: 's-two', fadeIn: 0, fadeOut: 0, hold: 50 },
        ],
      },
    ] as any,
  } as any);

  usePerformStore.setState({
    vcWidgets: [
      widget('w-hold', { actionType: 'scene', sceneId: 's-hold' }),
      widget('w-timed', { actionType: 'scene', sceneId: 's-timed' }),
      widget('w-fade', { actionType: 'scene', sceneId: 's-fade' }),
      widget('w-flash', { actionType: 'scene', sceneId: 's-hold', flashMode: 'flash' }),
      widget('w-chaser', { actionType: 'chaser', chaserId: 'ch1' }),
      widget('w-black', { actionType: 'blackout' }),
      widget('w-gm', { actionType: 'grandMaster', grandMasterValue: 0 }),
      widget('w-gm128', { actionType: 'grandMaster', grandMasterValue: 128 }),
      widget('w-gm-flash', { actionType: 'grandMaster', grandMasterValue: 64, flashMode: 'flash' }),
      widget('w-dmx', { actionType: 'dmxChannel', dmxUniverse: 1, dmxAddress: 300, dmxValue: 200 }),
      widget('w-dmx-flash', { actionType: 'dmxChannel', dmxUniverse: 0, dmxAddress: 7, dmxValue: 255, flashMode: 'flash' }),
      widget('w-dmx-bad', { actionType: 'dmxChannel' }),
      widget('w-auto', { actionType: 'autoLoop' }),
    ],
  } as any);
});

afterEach(() => {
  vcStopAllRuns();
  unsubscribe?.();
  unsubscribe = null;
  __setVCSender(null);
  __setVCBlackoutFns(null);
  __setVCButtonFns(null);
  vi.useRealTimers();
});

describe('runtime Console Virtuelle — scène', () => {
  it('active la scène (valeurs pleines envoyées) et signale le run', () => {
    expect(vcActivateScene('w-hold', 's-hold')).toBe(true);
    expect(vcIsRunning('w-hold')).toBe(true);
    expect(last()).toEqual({ 1: 200, 2: 100 });
    expect(events[0]).toMatchObject({ id: 'w-hold', running: true, kind: 'scene' });
  });

  it('hold infini : la scène reste allumée après 10 s', () => {
    vcActivateScene('w-hold', 's-hold');
    vi.advanceTimersByTime(10_000);
    expect(vcIsRunning('w-hold')).toBe(true);
    expect(last()).toEqual({ 1: 200, 2: 100 });
  });

  it('scène datée : fin naturelle → zéro + notification de fin', () => {
    vcActivateScene('w-timed', 's-timed');
    vi.advanceTimersByTime(1000);
    expect(vcIsRunning('w-timed')).toBe(false);
    expect(last()).toEqual({ 3: 0 });
    expect(events[events.length - 1]).toMatchObject({ id: 'w-timed', running: false });
  });

  it('fade-in puis fade-out naturels (duration=300, fadeIn=100, fadeOut=100)', () => {
    vcActivateScene('w-fade', 's-fade');
    vi.advanceTimersByTime(120); // frames de 16 ms → fade-in terminé
    expect(last()).toEqual({ 4: 120 });
    vi.advanceTimersByTime(400); // hold (100) + fade-out (100)
    expect(vcIsRunning('w-fade')).toBe(false);
    expect(last()).toEqual({ 4: 0 });
  });

  it('fade-in : rampe monotone à pas fins (pas de marches visibles en 3D)', () => {
    // Scène dédiée : fadeIn long (1 s) pour mesurer la granularité.
    useShowStore.setState({
      scenes: [
        { id: 's-long', name: 'Long', channels: { 4: 255 }, fadeIn: 1000, fadeOut: 0, duration: 0 },
      ] as any,
    } as any);
    usePerformStore.setState({
      vcWidgets: [widget('w-long', { actionType: 'scene', sceneId: 's-long' })],
    } as any);
    vcActivateScene('w-long', 's-long');
    // 16 ms/frame (fallback setTimeout sous vitest) sur 1100 ms
    const levels: number[] = [];
    for (let t = 0; t < 1100; t += 16) {
      vi.advanceTimersByTime(16);
      const v = last()?.[4];
      if (typeof v === 'number') levels.push(v);
    }
    expect(levels.length).toBeGreaterThan(30); // écrit à chaque frame
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1]); // monotone
      expect(levels[i] - levels[i - 1]).toBeLessThanOrEqual(8); // pas fins
    }
    expect(levels[levels.length - 1]).toBe(255); // pleine puissance atteinte
  });
});

describe('runtime Console Virtuelle — extinction à la désactivation (P0)', () => {
  it('hold infini désactivé → zéro envoyé immédiatement (fadeOut=0)', () => {
    vcActivateScene('w-hold', 's-hold');
    vcDeactivate('w-hold');
    expect(vcIsRunning('w-hold')).toBe(false);
    expect(last()).toEqual({ 1: 0, 2: 0 });
    expect(events[events.length - 1]).toMatchObject({ id: 'w-hold', running: false });
  });

  it('fadeOut=100 respecté : extinction progressive puis zéro', () => {
    vcActivateScene('w-fade', 's-fade');
    vi.advanceTimersByTime(120); // fade-in terminé → niveau plein
    expect(last()).toEqual({ 4: 120 });
    vcDeactivate('w-fade');
    expect(vcIsRunning('w-fade')).toBe(false);
    vi.advanceTimersByTime(200);
    expect(last()).toEqual({ 4: 0 });
    // Au moins un envoi intermédiaire (fade réel, pas simple coupure)
    expect(sent.some((c) => c[4] !== undefined && c[4] > 0 && c[4] < 120)).toBe(true);
  });

  it('relance pendant une extinction : le fade d’extinction est annulé', () => {
    vcActivateScene('w-fade', 's-fade');
    vcDeactivate('w-fade');
    vcActivateScene('w-fade', 's-fade');
    vi.advanceTimersByTime(50); // encore dans le fade-in, avant la fin naturelle
    expect(vcIsRunning('w-fade')).toBe(true);
    // Aucune écriture de zéro résiduelle du fade d'extinction annulé
    expect(last()!['4']).toBeGreaterThan(0);
  });
});

describe('runtime Console Virtuelle — chaser', () => {
  it('exécute les étapes puis éteint l’union de ses canaux', () => {
    vcActivateChaser('w-chaser', 'ch1');
    expect(last()).toEqual({ 1: 200, 2: 100 }); // étape 1
    vi.advanceTimersByTime(50);
    expect(last()).toEqual({ 5: 50 });          // étape 2
    vcDeactivate('w-chaser');
    // Union {1,2,5} → tout repasse à 0, pas seulement la dernière étape
    expect(last()).toEqual({ 1: 0, 2: 0, 5: 0 });
    expect(vcIsRunning('w-chaser')).toBe(false);
  });

  it('boucle tant qu’elle n’est pas désactivée', () => {
    vcActivateChaser('w-chaser', 'ch1');
    vi.advanceTimersByTime(500);
    expect(vcIsRunning('w-chaser')).toBe(true);
  });
});

describe('runtime Console Virtuelle — blackout', () => {
  it('activation → blackout, désactivation → restore (l’inverse exact)', () => {
    vcActivateBlackout('w-black');
    expect(vcIsRunning('w-black')).toBe(true);
    expect(blackoutCalls).toEqual(['blackout']);
    vcDeactivate('w-black');
    expect(vcIsRunning('w-black')).toBe(false);
    expect(blackoutCalls).toEqual(['blackout', 'restore']);
    expect(last()).toBeUndefined(); // aucun envoi de canaux pour un blackout
  });
});

describe('runtime Console Virtuelle — bouton Grand Master', () => {
  it('kill par défaut (0), réappui → restauration exacte à 255', () => {
    expect(vcButtonPress('w-gm', true)).toBe(true);
    expect(vcIsRunning('w-gm')).toBe(true);
    expect(gmCalls).toEqual([0]);
    expect(events[0]).toMatchObject({ id: 'w-gm', running: true, kind: 'grandmaster' });
    expect(vcButtonPress('w-gm', true)).toBe(true); // toggle : 2e press
    expect(vcIsRunning('w-gm')).toBe(false);
    expect(gmCalls).toEqual([0, 1]); // restore = pleine puissance
  });

  it('valeur configurée (128/255) puis restauration', () => {
    vcActivateGrandMaster('w-gm128', 128);
    expect(gmCalls).toEqual([128 / 255]);
    vcDeactivate('w-gm128');
    expect(gmCalls).toEqual([128 / 255, 1]);
  });

  it('flash : press applique, release restaure', () => {
    vcButtonPress('w-gm-flash', true);
    expect(gmCalls).toEqual([64 / 255]);
    vcButtonPress('w-gm-flash', false);
    expect(gmCalls).toEqual([64 / 255, 1]);
    expect(vcIsRunning('w-gm-flash')).toBe(false);
  });

  it('borne la valeur hors plage (300 → 255, négative → 0)', () => {
    vcActivateGrandMaster('w-gm', 300);
    expect(gmCalls).toEqual([1]);
    vcDeactivate('w-gm');
    vcActivateGrandMaster('w-gm', -20);
    expect(gmCalls[gmCalls.length - 1]).toBe(0);
  });
});

describe('runtime Console Virtuelle — bouton canal DMX', () => {
  it('envoie la valeur configurée, réappui → remise à zéro du même canal', () => {
    expect(vcButtonPress('w-dmx', true)).toBe(true);
    expect(vcIsRunning('w-dmx')).toBe(true);
    expect(channelCalls).toEqual([{ universe: 1, address: 300, value: 200 }]);
    expect(events[0]).toMatchObject({ id: 'w-dmx', running: true, kind: 'dmxchannel' });
    expect(vcButtonPress('w-dmx', true)).toBe(true);
    expect(vcIsRunning('w-dmx')).toBe(false);
    expect(channelCalls).toEqual([
      { universe: 1, address: 300, value: 200 },
      { universe: 1, address: 300, value: 0 },
    ]);
  });

  it('flash : momentané (press = valeur, release = 0)', () => {
    vcButtonPress('w-dmx-flash', true);
    expect(channelCalls).toEqual([{ universe: 0, address: 7, value: 255 }]);
    vcButtonPress('w-dmx-flash', false);
    expect(channelCalls).toEqual([
      { universe: 0, address: 7, value: 255 },
      { universe: 0, address: 7, value: 0 },
    ]);
  });

  it('adresse invalide (tuile non configurée) → false, aucun run, aucun effet', () => {
    expect(vcActivateDmxChannel('w-dmx-bad', 0, undefined as any, 255)).toBe(false);
    expect(vcActivateDmxChannel('w-dmx-bad', 0, 0, 255)).toBe(false);
    expect(vcActivateDmxChannel('w-dmx-bad', 0, 513, 255)).toBe(false);
    expect(vcIsRunning('w-dmx-bad')).toBe(false);
    expect(channelCalls).toEqual([]);
  });
});

describe('runtime Console Virtuelle — migration des actions bouton retirées', () => {
  it('flashScene → scène flash (cible et mode conservés)', () => {
    usePerformStore.getState().vcSetWidgets([
      widget('w-old', { actionType: 'flashScene', sceneId: 's-hold' }),
    ] as any);
    const cfg = usePerformStore.getState().vcWidgets[0].config as any;
    expect(cfg.actionType).toBe('scene');
    expect(cfg.flashMode).toBe('flash');
    expect(cfg.sceneId).toBe('s-hold');
    // La tuile migrée fonctionne immédiatement
    expect(vcButtonPress('w-old', true)).toBe(true);
    expect(vcIsRunning('w-old')).toBe(true);
  });

  it('showSequence / go / audioPlayPause → tuile scène vide (inerte, comme avant)', () => {
    usePerformStore.getState().vcSetWidgets([
      widget('w-a', { actionType: 'showSequence' }),
      widget('w-b', { actionType: 'go' }),
      widget('w-c', { actionType: 'audioPlayPause' }),
    ] as any);
    for (const w of usePerformStore.getState().vcWidgets) {
      expect((w.config as any).actionType).toBe('scene');
    }
  });

  it('les actions valides traversent la migration intactes', () => {
    usePerformStore.getState().vcSetWidgets([
      widget('w-gm', { actionType: 'grandMaster', grandMasterValue: 10 }),
      widget('w-sc', { actionType: 'scene', sceneId: 's-hold' }),
    ] as any);
    const widgets = usePerformStore.getState().vcWidgets;
    expect((widgets[0].config as any).actionType).toBe('grandMaster');
    expect((widgets[1].config as any).actionType).toBe('scene');
  });
});

describe('runtime Console Virtuelle — sémantique press/release (UI + MIDI)', () => {
  it('toggle : le 1er press démarre, le 2e éteint, la release est ignorée', () => {
    expect(vcButtonPress('w-hold', true)).toBe(true);
    expect(vcIsRunning('w-hold')).toBe(true);
    expect(vcButtonPress('w-hold', false)).toBe(true); // release : ignorée (toggle)
    expect(vcIsRunning('w-hold')).toBe(true);
    expect(vcButtonPress('w-hold', true)).toBe(true);
    expect(vcIsRunning('w-hold')).toBe(false);
  });

  it('flash : momentané (press = on, release = off)', () => {
    expect(vcButtonPress('w-flash', true)).toBe(true);
    expect(vcIsRunning('w-flash')).toBe(true);
    expect(vcButtonPress('w-flash', false)).toBe(true);
    expect(vcIsRunning('w-flash')).toBe(false);
    expect(last()).toEqual({ 1: 0, 2: 0 });
  });

  it('chaser pilotable de la même façon que par la tuile', () => {
    expect(vcButtonPress('w-chaser', true)).toBe(true);
    expect(vcIsRunning('w-chaser')).toBe(true);
    expect(vcButtonPress('w-chaser', true)).toBe(true);
    expect(vcIsRunning('w-chaser')).toBe(false);
  });

  it('action gérée par la vue (autoLoop…) → false, le rappel MIDI prévient', () => {
    expect(vcButtonPress('w-auto', true)).toBe(false);
    expect(vcButtonPress('w-inexistant', true)).toBe(false);
  });
});

describe('runtime Console Virtuelle — fader (Remote web / MIDI)', () => {
  const fader = (id: string, config: Record<string, unknown>) => ({
    id,
    type: 'slider' as const,
    x: 0, y: 0, width: 30, height: 140,
    pageIndex: 0,
    config: config as any,
  });

  beforeEach(() => {
    usePerformStore.setState({
      vcWidgets: [
        fader('w-fader', { sliderFunction: 'channel', channelAddress: 7, min: 10, max: 210, step: 1 }),
        fader('w-gm', { sliderFunction: 'grandMaster', min: 0, max: 255, step: 1 }),
      ] as any,
    } as any);
  });

  it('projette la fraction 0..1 sur [min, max] et la miroite dans le store UI', () => {
    expect(vcSetSliderFraction('w-fader', 0.5)).toBe(true);
    expect(usePerformStore.getState().vcWidgetValues['w-fader']).toBe(110); // 10 + 200 * 0.5
    expect(vcSetSliderFraction('w-fader', 0)).toBe(true);
    expect(usePerformStore.getState().vcWidgetValues['w-fader']).toBe(10);
    expect(vcSetSliderFraction('w-fader', 1)).toBe(true);
    expect(usePerformStore.getState().vcWidgetValues['w-fader']).toBe(210);
  });

  it('borne la fraction hors plage (négative / > 1 / NaN)', () => {
    vcSetSliderFraction('w-fader', -3);
    expect(usePerformStore.getState().vcWidgetValues['w-fader']).toBe(10);
    vcSetSliderFraction('w-fader', 42);
    expect(usePerformStore.getState().vcWidgetValues['w-fader']).toBe(210);
    vcSetSliderFraction('w-fader', Number.NaN);
    expect(usePerformStore.getState().vcWidgetValues['w-fader']).toBe(10);
  });

  it('bouton ou widget inexistant → false, aucune valeur écrite', () => {
    expect(vcSetSliderFraction('w-hold', 0.5)).toBe(false); // widget = bouton
    expect(vcSetSliderFraction('w-nope', 0.5)).toBe(false);
    expect(usePerformStore.getState().vcWidgetValues['w-nope']).toBeUndefined();
  });
});
