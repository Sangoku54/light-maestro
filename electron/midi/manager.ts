/**
 * MIDI Manager - Hardware controller integration
 *
 * QLC+ has excellent MIDI support for mapping physical controllers
 * to virtual console widgets and DMX channels.
 *
 * Conventions:
 *  - Device ids encode the input AND output port indexes separately:
 *    `in-<i>` (input only), `out-<i>` (output only),
 *    `io-<inIdx>-<outIdx>` (merged by name). `connect()` parses both.
 *  - The mapping is persisted to `userData/midi-mapping.json` on every
 *    mutation and restored at boot via `loadMapping()`.
 *  - MIDI clock (0xF8 / 0xFA / 0xFB / 0xFC) is parsed here and emitted
 *    as a throttled `clock` event { bpm, running, phase } — the phase
 *    (position dans la noire, 0..1) permet au renderer de se VERROUILLER
 *    sur le temps musical du logiciel DJ ; realtime messages never touch
 *    mappings.
 *  - Never do synchronous I/O inside the RtMidi callback: `addMapping()`
 *    from learn mode defers the disk write via `setImmediate`.
 */

import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { MtcDecoder, type MtcState } from './mtc';

export interface MidiDevice {
  id: string;
  name: string;
  manufacturer: string;
  input: boolean;
  output: boolean;
}

export interface MidiMapping {
  id: string;
  midiChannel: number;
  midiType: 'note' | 'cc' | 'program';
  midiValue: number;          // Note number, CC number or program number
  midiRange: [number, number]; // min/max input range (0-127 default)
  target: MidiTarget;
  feedback?: boolean;          // Send LED feedback to controller
}

export type MidiTarget =
  | { type: 'dmx-channel'; universe: number; channel: number }
  | { type: 'widget'; widgetId: string; property: string }
  | { type: 'scene'; sceneId: string; action: 'play' | 'stop' | 'toggle' }
  | { type: 'chaser'; chaserId: string; action: 'play' | 'stop' | 'next' | 'previous' }
  | { type: 'cueList'; cueListId: string; action: 'go' | 'back' | 'stop' }
  | { type: 'blackout' }
  | { type: 'grandMaster' }
  | { type: 'autoscript'; action: 'toggle' | 'nextEffect' | 'intensity' };

const CLOCK_WINDOW_PULSES = 24;      // BPM sliding average window (anti-jitter)
const CLOCK_EMIT_INTERVAL_MS = 250;  // ~4 Hz max clock emission rate
const MAPPING_STORE_FILE = 'midi-mapping.json';

export class MidiManager extends EventEmitter {
  private input: any = null;        // node-midi Input (open port, receives)
  private output: any = null;       // node-midi Output (feedback, no messages sent yet)
  private mapping: MidiMapping[] = [];
  private learning: boolean = false;
  private learningTarget: MidiTarget | null = null;
  private connected: boolean = false;
  private persistScheduled: boolean = false;
  private clockRunning: boolean = false;
  private clockLastPulse: number = 0;
  private clockIntervals: number[] = [];
  private clockBpm: number = 0;
  private clockLastEmit: number = 0;
  /**
   * Nombre de pulses 0xF8 reçus depuis le dernier START/CONTINUE.
   * Sert à calculer la PHASE externe (position dans la noire) : le pulse n°1
   * définit la frontière de temps (phase 0), le pulse n°25 la suivante.
   */
  private clockPulseCount: number = 0;

  // ─── MTC (lot #15) ────────────────────────────────────────
  private mtcDecoder = new MtcDecoder();
  private mtcCheckTimer: NodeJS.Timeout | null = null;
  private mtcLastLocked: boolean | null = null;

  // ─── Devices ────────────────────────────────────────────

  async listDevices(): Promise<MidiDevice[]> {
    try {
      const midi = require('midi');
      const input = new midi.Input();
      const output = new midi.Output();

      const devices: MidiDevice[] = [];

      for (let i = 0; i < input.getPortCount(); i++) {
        devices.push({
          id: `in-${i}`,
          name: input.getPortName(i),
          manufacturer: 'Unknown',
          input: true,
          output: false,
        });
      }

      for (let i = 0; i < output.getPortCount(); i++) {
        const name = output.getPortName(i);
        const existing = devices.find(d => d.name === name);
        if (existing) {
          // Merge by name: the input index is already encoded in the id
          // (`in-<inIdx>`), the output index is appended separately so
          // `connect()` can open both ports correctly.
          const inIdx = parseInt(existing.id.split('-')[1], 10);
          existing.output = true;
          existing.id = `io-${Number.isNaN(inIdx) ? 0 : inIdx}-${i}`;
        } else {
          devices.push({
            id: `out-${i}`,
            name,
            manufacturer: 'Unknown',
            input: false,
            output: true,
          });
        }
      }

      input.closePort();
      output.closePort();
      return devices;
    } catch (e) {
      console.warn('MIDI not available:', e);
      return [];
    }
  }

  // ─── Connect / Disconnect ───────────────────────────────

  async connect(deviceId: string): Promise<void> {
    const { inputIndex, outputIndex } = this.parseDeviceId(deviceId);
    if (inputIndex === null && outputIndex === null) {
      throw new Error(`Invalid MIDI device id: "${deviceId}"`);
    }
    if (inputIndex === null) {
      // Output-only device: nothing to receive MIDI from - refuse with a
      // clear error instead of pretending we are connected.
      throw new Error(
        `MIDI device "${deviceId}" is output-only - it cannot receive messages, nothing to connect to`
      );
    }

    // Close the previous device BEFORE opening the new one (switch A→B must
    // never leave two inputs open: double event streams + port leak).
    this.closePorts();

    let newInput: any = null;
    let newOutput: any = null;
    try {
      const midi = require('midi');

      const input = new midi.Input();
      newInput = input;
      if (inputIndex >= input.getPortCount()) {
        input.closePort();
        newInput = null;
        throw new Error(`MIDI input port ${inputIndex} does not exist`);
      }
      input.openPort(inputIndex);
      // Accept timing clock (0xF8) AND sysex: node-midi ignores them by
      // default. The sysex is required for MTC Full Frame (lot #15) — all
      // non-MTC sysex is consumed/ignored in handleMidiMessage (never
      // reaches the mapping matcher).
      // ignoreTypes(sysex, timing, activeSensing)
      input.ignoreTypes(false, false, true);
      input.on('message', (_deltaTime: number, message: number[]) => {
        this.handleMidiMessage(message);
      });

      // Feedback preparation: open the matching output port (if the
      // device has one) - no messages are sent, the renderer decides.
      if (outputIndex !== null) {
        const output = new midi.Output();
        if (outputIndex < output.getPortCount()) {
          output.openPort(outputIndex);
          newOutput = output;
        } else {
          console.warn(`[midi] output port ${outputIndex} missing - LED feedback disabled`);
        }
      }

      // Commit only after BOTH ports (or the input alone) opened cleanly.
      this.input = newInput;
      this.output = newOutput;
      this.connected = true;
      this.startMtcCheck();
      this.emit('connected', deviceId);
    } catch (e) {
      // Never leave a half-open port behind on failure. Only close the
      // ports we opened in THIS attempt (the previous device is already
      // closed by closePorts() above).
      try { newInput?.closePort(); } catch {}
      try { newOutput?.closePort(); } catch {}
      this.input = null;
      this.output = null;
      this.connected = false;
      // Tell the renderer the device is NOT connected (UI must not stay green)
      this.emit('disconnected');
      console.error('Failed to connect MIDI device:', e);
      throw e;
    }
  }

  /** Close the current input/output ports and reset connection state. */
  private closePorts(): void {
    if (this.input) {
      try { this.input.closePort(); } catch {}
      this.input = null;
    }
    if (this.output) {
      try { this.output.closePort(); } catch {}
      this.output = null;
    }
    this.connected = false;
    this.stopMtcCheck();
    // Le décodeur et l'état MTC appartiennent au port fermé : reset pour
    // ne jamais exposer un état stale d'un ancien device (connect A →
    // connect B échoue → le renderer ne doit pas voir le MTC de A).
    this.mtcDecoder.reset();
    this.mtcLastLocked = null;
  }

  disconnect(): void {
    if (this.input) {
      try { this.input.closePort(); } catch {}
      this.input = null;
    }
    if (this.output) {
      try { this.output.closePort(); } catch {}
      this.output = null;
    }
    this.connected = false;
    // Reset the clock state machine so the UI does not keep a stale tempo
    this.clockRunning = false;
    this.clockLastPulse = 0;
    this.clockIntervals = [];
    this.clockPulseCount = 0;
    // Reset the MTC decoder (lot #15) — no stale timecode after reconnect
    this.stopMtcCheck();
    this.mtcDecoder.reset();
    this.mtcLastLocked = null;
    this.emit('disconnected');
    this.emit('clock', { bpm: this.clockBpm, running: false });
  }

  /**
   * Parse a device id produced by `listDevices()`:
   *   `in-<i>`        → input only
   *   `out-<i>`       → output only
   *   `io-<in>-<out>` → merged device (both indexes encoded separately)
   */
  private parseDeviceId(deviceId: string): { inputIndex: number | null; outputIndex: number | null } {
    const parts = deviceId.split('-');
    const none = { inputIndex: null, outputIndex: null };
    if (parts[0] === 'io') {
      const inputIndex = parseInt(parts[1], 10);
      const outputIndex = parseInt(parts[2], 10);
      if (Number.isNaN(inputIndex) || Number.isNaN(outputIndex)) return none;
      return { inputIndex, outputIndex };
    }
    if (parts[0] === 'in') {
      const inputIndex = parseInt(parts[1], 10);
      return Number.isNaN(inputIndex) ? none : { inputIndex, outputIndex: null };
    }
    if (parts[0] === 'out') {
      const outputIndex = parseInt(parts[1], 10);
      return Number.isNaN(outputIndex) ? none : { inputIndex: null, outputIndex };
    }
    return none;
  }

  // ─── Mapping ────────────────────────────────────────────

  getMapping(): MidiMapping[] {
    return this.mapping;
  }

  setMapping(mapping: MidiMapping[]): void {
    this.mapping = mapping;
    this.emit('mappingChanged', this.mapping);
    this.schedulePersist();
  }

  addMapping(mapping: MidiMapping): void {
    this.mapping.push(mapping);
    this.emit('mappingChanged', this.mapping);
    this.schedulePersist();
  }

  removeMapping(id: string): void {
    this.mapping = this.mapping.filter(m => m.id !== id);
    this.emit('mappingChanged', this.mapping);
    this.schedulePersist();
  }

  // ─── Persistence ────────────────────────────────────────

  /**
   * Restore the persisted mapping from `userData/midi-mapping.json`.
   * Called at boot, right after the manager is instantiated.
   */
  async loadMapping(): Promise<void> {
    try {
      const file = this.mappingStorePath();
      if (!fs.existsSync(file)) return;
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      if (Array.isArray(raw)) {
        this.mapping = raw;
        this.emit('mappingChanged', this.mapping);
      }
    } catch (e) {
      console.error('[midi] failed to load persisted mapping:', e);
    }
  }

  /**
   * Defer the disk write: `addMapping()` can be called from the MIDI
   * callback (learn mode) - synchronous I/O there would block the RtMidi
   * handler. Multiple mutations coalesce into a single write.
   */
  private schedulePersist(): void {
    if (this.persistScheduled) return;
    this.persistScheduled = true;
    setImmediate(() => {
      this.persistScheduled = false;
      this.persist();
    });
  }

  private persist(): void {
    try {
      const file = this.mappingStorePath();
      const tmp = `${file}.tmp`;
      // Atomic write: temp + rename - a crash mid-write never corrupts
      // the store (same pattern as the storage:set IPC handler).
      fs.writeFileSync(tmp, JSON.stringify(this.mapping, null, 2), 'utf-8');
      fs.renameSync(tmp, file);
    } catch (e) {
      console.error('[midi] failed to persist mapping:', e);
    }
  }

  private mappingStorePath(): string {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), MAPPING_STORE_FILE);
  }

  // ─── MIDI Learn ──────────────────────────────────────────

  startLearn(target: MidiTarget): void {
    this.learning = true;
    this.learningTarget = target;
    this.emit('learnStarted', target);
  }

  stopLearn(): void {
    this.learning = false;
    this.learningTarget = null;
    this.emit('learnStopped');
  }

  // ─── Feedback LED (port sortie) ─────────────────────────────

  /**
   * Envoie un message brut sur le port sortie ouvert (aucun envoi sans port).
   * Jamais appelé depuis le callback RtMidi entrant : uniquement via
   * l'IPC `midi:feedback` (état des tuiles poussé par le renderer).
   * @returns true si le message est bien parti.
   */
  private sendRawFeedback(message: number[]): boolean {
    if (!this.output || !Array.isArray(message) || message.length === 0) return false;
    try {
      this.output.sendMessage(message);
      return true;
    } catch (e) {
      console.warn('[midi] échec envoi feedback:', e instanceof Error ? e.message : e);
      return false;
    }
  }

  /**
   * Clé d'une cible pour l'appariement feedback : `widget:<id>`,
   * `scene:<id>`, `chaser:<id>`, `blackout:`. Les cibles non « LED »
   * (dmx-channel, grandMaster, autoscript…) retournent null.
   */
  private static feedbackKey(t: MidiTarget): string | null {
    switch (t.type) {
      case 'widget':
        // Seule la propriété « press » pilote une LED ; « value » (fader)
        // n'a pas de retour automatique (les MIDIMIX ne sont pas motorisés).
        return (t.property ?? 'press') === 'press' ? `widget:${t.widgetId}` : null;
      case 'scene': return `scene:${t.sceneId}`;
      case 'chaser': return `chaser:${t.chaserId}`;
      case 'blackout': return 'blackout:';
      default: return null;
    }
  }

  /**
   * Applique l'état des tuiles aux LEDs des contrôleurs : pour chaque mapping
   * avec `feedback !== false` dont la cible est présente dans `entries`,
   * envoie note-on/CC à 127 (ON) ou 0 (OFF) sur le port sortie.
   *
   * Le renderer pousse l'état COMPLET (tuiles off incluses) quand il change :
   * une LED restée allumée après redémarrage/arrêt d'une tuile s'éteint donc
   * ici. Une cible absente des entries = état inconnu → aucun envoi.
   *
   * @returns nombre de messages MIDI envoyés.
   */
  sendFeedbackState(entries: Array<{ type: string; id?: string; on: boolean }>): number {
    if (!Array.isArray(entries) || entries.length === 0) return 0;
    const state = new Map<string, boolean>();
    for (const e of entries) {
      if (!e || typeof e.type !== 'string' || typeof e.on !== 'boolean') continue;
      state.set(`${e.type}:${e.id ?? ''}`, e.on);
    }
    let count = 0;
    for (const m of this.mapping) {
      if (m.feedback === false) continue;
      const key = MidiManager.feedbackKey(m.target);
      if (key === null) continue;
      const on = state.get(key);
      if (on === undefined) continue; // état inconnu → on ne devine pas
      const value = on ? 127 : 0;
      const status = m.midiChannel >= 1 && m.midiChannel <= 16 ? m.midiChannel - 1 : 0;
      if (m.midiType === 'note') {
        if (this.sendRawFeedback([0x90 | status, m.midiValue, value])) count++;
      } else if (m.midiType === 'cc') {
        if (this.sendRawFeedback([0xB0 | status, m.midiValue, value])) count++;
      }
      // program change : pas de LED réversible, ignoré
    }
    return count;
  }

  // ─── Incoming MIDI ──────────────────────────────────────

  private handleMidiMessage(message: number[]): void {
    if (!Array.isArray(message) || message.length === 0) return;
    const status = message[0];

    // ── MTC (lot #15) : intercepté AVANT tout le reste — jamais un mapping ──
    // Quarter Frame (0xF1) : System Common, pas de running status, chaque
    // message est une paire `F1 <data>` complète.
    if (status === 0xF1) {
      const data1 = message[1] ?? 0;
      if (this.mtcDecoder.pushQuarterFrame(data1)) this.emitMtc();
      return;
    }
    // SysEx (0xF0) : seul le Full Frame MTC nous intéresse ; tout le reste
    // est consommé proprement (ne doit jamais atteindre le matcher, qui le
    // verrait comme une pseudo-note canal 1 valeur 0x7F, apprenable).
    if (status === 0xF0) {
      if (this.mtcDecoder.pushFullFrame(message)) this.emitMtc();
      return;
    }
    // Song Position (0xF2) / Song Select (0xF3) / Tune Request (0xF6) :
    // System Common non pertinent — ignorés, jamais des mappings.
    if (status === 0xF2 || status === 0xF3 || status === 0xF6) return;

    // Realtime messages (MIDI clock family) - never touch mappings
    if (status >= 0xF8) {
      this.handleClockMessage(status);
      return;
    }

    const data1 = message[1] ?? 0;
    const data2 = message[2];
    const channel = (status & 0x0F) + 1;
    const type = status & 0xF0;

    // Note-off: 0x80, or 0x90 with velocity 0 (common convention).
    // Treated as a release (rawValue 0): it still matches note mappings
    // so DMX channels drop back to their range minimum, but it never
    // re-triggers play/toggle actions.
    if (type === 0x80 || (type === 0x90 && (data2 ?? 0) === 0)) {
      this.handleNoteRelease(channel, data1);
      return;
    }

    let midiType: 'note' | 'cc' | 'program' = 'note';
    if (type === 0xB0) midiType = 'cc';
    else if (type === 0xC0) midiType = 'program';

    // MIDI Learn mode: auto-create a mapping. Note/cc/program all learnable:
    // the next incoming message (a pad/button press, a CC turn, or a program
    // change sent by a console) becomes the mapping key.
    if (this.learning && this.learningTarget) {
      const mapping: MidiMapping = {
        id: `midi-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        midiChannel: channel,
        midiType,
        midiValue: data1,
        midiRange: [0, 127],
        target: this.learningTarget,
        feedback: true,
      };
      this.addMapping(mapping);
      this.stopLearn();
      return;
    }

    // Match against existing mappings
    for (const mapping of this.mapping) {
      if (
        mapping.midiChannel === channel &&
        mapping.midiType === midiType &&
        mapping.midiValue === data1
      ) {
        if (midiType === 'program') {
          // Program change has no data2: midiValue is the program number,
          // the emitted value is a plain trigger (1).
          this.emit('mapped', { mapping, value: 1, rawValue: data1, release: false });
        } else {
          const normalizedValue = this.normalizeMidiValue(data2 ?? 0, mapping.midiRange);
          this.emit('mapped', { mapping, value: normalizedValue, rawValue: data2 ?? 0, release: false });
        }
      }
    }
  }

  /** Note-off / release: rawValue 0, never re-triggers play/toggle. */
  private handleNoteRelease(channel: number, note: number): void {
    for (const mapping of this.mapping) {
      if (
        mapping.midiChannel === channel &&
        mapping.midiType === 'note' &&
        mapping.midiValue === note
      ) {
        this.emit('mapped', {
          mapping,
          value: this.normalizeMidiValue(0, mapping.midiRange),
          rawValue: 0,
          release: true,
        });
      }
    }
  }

  // ─── MIDI Clock ─────────────────────────────────────────

  /**
   * Parse realtime clock messages:
   *   0xF8 timing clock (24 pulses per quarter note)
   *   0xFA start / 0xFB continue / 0xFC stop
   *
   * PHASE : chaque pulse 0xF8 = 1/24 de noire. On compte les pulses depuis
   * le dernier START/CONTINUE → la phase externe (0..1 dans la noire) est
   * connue à ±1 pulse. Sans cette phase, le renderer ne peut que DEVINER la
   * position dans le temps musical (phase libre) → les lumières derivent par
   * rapport au logiciel DJ. C'est cette phase qui permet le verrouillage.
   */
  private handleClockMessage(status: number): void {
    const now = Date.now();
    switch (status) {
      case 0xF8: {
        if (this.clockLastPulse > 0) {
          const interval = now - this.clockLastPulse;
          // Reject 0 (duplicate timestamp) and long gaps (> 2.5 s) so a
          // stalled clock cannot poison the sliding average.
          if (interval > 0 && interval <= 2500) {
            this.clockIntervals.push(interval);
            if (this.clockIntervals.length > CLOCK_WINDOW_PULSES) {
              this.clockIntervals.shift();
            }
            const avg = this.clockIntervals.reduce((a, b) => a + b, 0) / this.clockIntervals.length;
            this.clockBpm = Math.round((60000 / (avg * 24)) * 10) / 10;
          }
        }
        this.clockLastPulse = now;
        this.clockPulseCount++;
        this.clockRunning = true;
        this.emitClock(now, false);
        break;
      }
      case 0xFA: // start — nouveau point de référence de phase
        this.clockRunning = true;
        this.clockLastPulse = now;
        this.clockIntervals = [];
        this.clockPulseCount = 0;
        this.emitClock(now, true);
        break;
      case 0xFB: // continue — la phase absolue est perdue : nouveau repère
        this.clockRunning = true;
        this.clockLastPulse = now;
        this.clockPulseCount = 0;
        this.emitClock(now, true);
        break;
      case 0xFC: // stop
        this.clockRunning = false;
        this.clockLastPulse = 0;
        this.clockIntervals = [];
        this.clockPulseCount = 0;
        this.emitClock(now, true);
        break;
    }
  }

  /**
   * Phase externe (0..1 dans la noire) à l'instant `now`.
   * Le pulse n°1 (après START) = phase 0, le n°25 = phase 0 suivante.
   * L'écart depuis le dernier pulse est ajouté (borné à une noire pour qu'un
   * clock en retard ne fasse pas sauter la phase de plusieurs temps).
   */
  private computeClockPhase(now: number): number {
    if (!this.clockRunning || this.clockPulseCount === 0) return 0;
    const beatMs = 60000 / Math.max(20, this.clockBpm || 120);
    const phaseAtLastPulse = ((this.clockPulseCount - 1) % 24) / 24;
    const elapsed = Math.min(Math.max(0, now - this.clockLastPulse), beatMs);
    const phase = phaseAtLastPulse + elapsed / beatMs;
    return phase - Math.floor(phase);
  }

  /** Throttled `clock` emission (~4 Hz max); forced on start/stop. */
  private emitClock(now: number, force: boolean): void {
    if (!force && now - this.clockLastEmit < CLOCK_EMIT_INTERVAL_MS) return;
    this.clockLastEmit = now;
    this.emit('clock', {
      bpm: this.clockBpm,
      running: this.clockRunning,
      phase: this.computeClockPhase(now),
    });
  }

  private normalizeMidiValue(rawValue: number, range: [number, number]): number {
    const [min, max] = range;
    return min + (rawValue / 127) * (max - min);
  }

  // ─── MTC (lot #15) ─────────────────────────────────────────

  /**
   * Émet l'état MTC courant. Appelé à chaque frame décodée (cycle QF
   * complet, ~25-30 Hz max) et à chaque Full Frame — jamais par QF brut
   * (200+ msg/s). Le renderer reçoit donc ≤ ~30 événements/s.
   */
  private emitMtc(): void {
    const st: MtcState = this.mtcDecoder.getState();
    this.mtcLastLocked = st.locked;
    this.emit('mtc', st);
  }

  /**
   * Détecte la perte de lock silencieuse : le timeout d'unlock n'est pas
   * déclenché par un message entrant (c'est l'ABSENCE de message). Un timer
   * 500 ms compare l'état et émet à la transition locked↔unlocked.
   */
  private startMtcCheck(): void {
    this.stopMtcCheck();
    this.mtcLastLocked = null;
    this.mtcCheckTimer = setInterval(() => {
      const st: MtcState = this.mtcDecoder.getState();
      if (this.mtcLastLocked !== null && st.locked !== this.mtcLastLocked) {
        this.mtcLastLocked = st.locked;
        this.emit('mtc', st);
      }
    }, 500);
  }

  private stopMtcCheck(): void {
    if (this.mtcCheckTimer) {
      clearInterval(this.mtcCheckTimer);
      this.mtcCheckTimer = null;
    }
    this.mtcLastLocked = null;
  }
}
