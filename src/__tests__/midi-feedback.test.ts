/**
 * Feedback MIDI LED (P2) — projection de l'état des tuiles sur les mappages.
 *
 * Deux volets :
 *  1. main  : `MidiManager.sendFeedbackState()` — pour chaque mapping
 *     `feedback !== false` dont la cible est présente dans les entries,
 *     envoie note-on / CC à 127 (ON) ou 0 (OFF) sur le port sortie (doublé
 *     ici par un fake `output`).
 *  2. renderer : `collectMidiFeedbackEntries()` — état pur des cibles
 *     (tuiles Console Virtuelle, scènes, chasers, blackout).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MidiManager, type MidiMapping } from '@electron/midi/manager';
import { collectMidiFeedbackEntries } from '../hooks/use-midi-feedback';
import {
  vcActivateScene,
  vcDeactivate,
  vcStopAllRuns,
  __setVCSender,
} from '../engine/virtual-console-runtime';
import { usePerformStore } from '../stores/performStore';
import { useShowStore } from '../stores/showStore';
import { useAppStore } from '../stores/appStore';

function makeManager(mappings: MidiMapping[]) {
  const manager = new MidiManager();
  const sent: number[][] = [];
  // Port sortie factice : le vrai port n'existe que sous Electron.
  (manager as unknown as { output: { sendMessage: (m: number[]) => void } }).output = {
    sendMessage: (m: number[]) => { sent.push(m); },
  };
  // Affectation directe : setMapping() déclenche la persistance disque
  // (require('electron')) inutile ici.
  (manager as unknown as { mapping: MidiMapping[] }).mapping = mappings;
  return { manager, sent };
}

const widgetMapping = (over: Partial<MidiMapping> = {}): MidiMapping => ({
  id: 'm-w',
  midiChannel: 1,
  midiType: 'note',
  midiValue: 10,
  midiRange: [0, 127],
  target: { type: 'widget', widgetId: 'w1', property: 'press' },
  feedback: true,
  ...over,
});

describe('MidiManager.sendFeedbackState — LED sortantes', () => {
  it('note : ON → 127, OFF → 0 (même canal/note que le mappage)', () => {
    const { manager, sent } = makeManager([widgetMapping()]);
    expect(manager.sendFeedbackState([{ type: 'widget', id: 'w1', on: true }])).toBe(1);
    expect(manager.sendFeedbackState([{ type: 'widget', id: 'w1', on: false }])).toBe(1);
    expect(sent).toEqual([
      [0x90, 10, 127],
      [0x90, 10, 0],
    ]);
  });

  it('canal MIDI > 1 → status avec le bon nibble (canal 3 = 0x92)', () => {
    const { manager, sent } = makeManager([widgetMapping({ midiChannel: 3 })]);
    manager.sendFeedbackState([{ type: 'widget', id: 'w1', on: true }]);
    expect(sent[0][0]).toBe(0x92);
  });

  it('type cc → message CC (0xB0), pas note-on', () => {
    const { manager, sent } = makeManager([widgetMapping({ midiType: 'cc', midiValue: 21 })]);
    manager.sendFeedbackState([{ type: 'widget', id: 'w1', on: true }]);
    expect(sent).toEqual([[0xB0, 21, 127]]);
  });

  it('feedback:false → aucun envoi (le mappage a demandé de se taire)', () => {
    const { manager, sent } = makeManager([widgetMapping({ feedback: false })]);
    expect(manager.sendFeedbackState([{ type: 'widget', id: 'w1', on: true }])).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('cible absente des entries → état inconnu, aucun envoi', () => {
    const { manager, sent } = makeManager([widgetMapping()]);
    expect(manager.sendFeedbackState([{ type: 'widget', id: 'AUTRE', on: true }])).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('cible widget en propriété « value » (fader) → pas de LED', () => {
    const { manager, sent } = makeManager([
      widgetMapping({ target: { type: 'widget', widgetId: 'w1', property: 'value' } }),
    ]);
    manager.sendFeedbackState([{ type: 'widget', id: 'w1', on: true }]);
    expect(sent).toHaveLength(0);
  });

  it('scènes, chasers et blackout suivent la même règle', () => {
    const { manager, sent } = makeManager([
      widgetMapping({ id: 'm-sc', target: { type: 'scene', sceneId: 's1', action: 'toggle' } }),
      widgetMapping({ id: 'm-ch', midiValue: 11, target: { type: 'chaser', chaserId: 'c1', action: 'play' } }),
      widgetMapping({ id: 'm-bo', midiValue: 12, target: { type: 'blackout' } }),
      widgetMapping({ id: 'm-gm', midiValue: 13, target: { type: 'grandMaster' } }), // non-LED
    ]);
    const count = manager.sendFeedbackState([
      { type: 'scene', id: 's1', on: true },
      { type: 'chaser', id: 'c1', on: false },
      { type: 'blackout', on: true },
    ]);
    expect(count).toBe(3); // grandMaster ignoré (pas de clé LED)
    expect(sent).toEqual([
      [0x90, 10, 127], // scène ON
      [0x90, 11, 0],   // chaser OFF
      [0x90, 12, 127], // blackout ON
    ]);
  });

  it('sans port sortie (non connecté) → 0 au lieu de planter', () => {
    const manager = new MidiManager();
    (manager as unknown as { mapping: MidiMapping[] }).mapping = [widgetMapping()];
    expect(manager.sendFeedbackState([{ type: 'widget', id: 'w1', on: true }])).toBe(0);
  });
});

describe('collectMidiFeedbackEntries — état des cibles (renderer)', () => {
  beforeEach(() => {
    __setVCSender(() => { /* capture silencieuse */ });
    useShowStore.setState({
      scenes: [
        { id: 's1', name: 'Scene 1', channels: { 1: 255 }, fadeIn: 0, fadeOut: 0, duration: 0 },
      ] as any,
      chasers: [{ id: 'c1', name: 'Chaser 1', steps: [] }] as any,
    } as any);
    usePerformStore.setState({
      vcWidgets: [
        { id: 'w-btn', type: 'button', x: 0, y: 0, width: 60, height: 40, pageIndex: 0,
          config: { actionType: 'scene', sceneId: 's1' } } as any,
        { id: 'w-fader', type: 'slider', x: 0, y: 60, width: 30, height: 120, pageIndex: 0,
          config: { sliderFunction: 'channel', channelAddress: 1 } } as any,
      ],
    } as any);
    useAppStore.setState({ dmx: { ...useAppStore.getState().dmx, blackout: false } } as any);
  });

  afterEach(() => {
    vcStopAllRuns();
    __setVCSender(null);
  });

  const entryOf = (entries: ReturnType<typeof collectMidiFeedbackEntries>, type: string, id?: string) =>
    entries.find((e) => e.type === type && (id === undefined || e.id === id));

  it('tout éteint au repos (tuile OFF, scène OFF, blackout OFF)', () => {
    const entries = collectMidiFeedbackEntries();
    expect(entryOf(entries, 'widget', 'w-btn')?.on).toBe(false);
    expect(entryOf(entries, 'scene', 's1')?.on).toBe(false);
    expect(entryOf(entries, 'chaser', 'c1')?.on).toBe(false);
    expect(entryOf(entries, 'blackout')?.on).toBe(false);
    // Seuls les boutons sont des cibles LED : le fader n'est pas listé
    expect(entryOf(entries, 'widget', 'w-fader')).toBeUndefined();
  });

  it('tuile qui lance une scène → widget ON et scène ON (targetId du run)', () => {
    expect(vcActivateScene('w-btn', 's1')).toBe(true);
    const entries = collectMidiFeedbackEntries();
    expect(entryOf(entries, 'widget', 'w-btn')?.on).toBe(true);
    expect(entryOf(entries, 'scene', 's1')?.on).toBe(true);
  });

  it('extinction de la tuile → tout repasse OFF (miroir des LEDs)', () => {
    vcActivateScene('w-btn', 's1');
    vcDeactivate('w-btn');
    const entries = collectMidiFeedbackEntries();
    expect(entryOf(entries, 'widget', 'w-btn')?.on).toBe(false);
    expect(entryOf(entries, 'scene', 's1')?.on).toBe(false);
  });

  it('blackout actif → entry blackout ON', () => {
    useAppStore.setState({ dmx: { ...useAppStore.getState().dmx, blackout: true } } as any);
    expect(entryOf(collectMidiFeedbackEntries(), 'blackout')?.on).toBe(true);
  });
});
