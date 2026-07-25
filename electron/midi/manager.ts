/**
 * MIDI Manager — Hardware controller integration
 *
 * QLC+ has excellent MIDI support for mapping physical controllers
 * to virtual console widgets and DMX channels.
 */

import { EventEmitter } from 'events';

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
  midiValue: number;          // Note number or CC number
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

export class MidiManager extends EventEmitter {
  private device: any = null; // node-midi instance
  private mapping: MidiMapping[] = [];
  private learning: boolean = false;
  private learningTarget: MidiTarget | null = null;
  private connected: boolean = false;

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
          existing.output = true;
          existing.id = `io-${i}`;
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

  async connect(deviceId: string): Promise<void> {
    try {
      const midi = require('midi');
      const portIndex = parseInt(deviceId.split('-')[1]);

      if (deviceId.startsWith('in') || deviceId.startsWith('io')) {
        this.device = new midi.Input();
        this.device.openPort(portIndex);
        this.device.on('message', (deltaTime: number, message: number[]) => {
          this.handleMidiMessage(message);
        });
      }

      this.connected = true;
      this.emit('connected', deviceId);
    } catch (e) {
      console.error('Failed to connect MIDI device:', e);
      throw e;
    }
  }

  disconnect(): void {
    if (this.device) {
      try { this.device.closePort(); } catch {}
      this.device = null;
    }
    this.connected = false;
    this.emit('disconnected');
  }

  // ─── Mapping ─────────────────────────────────────────────

  getMapping(): MidiMapping[] {
    return this.mapping;
  }

  setMapping(mapping: MidiMapping[]): void {
    this.mapping = mapping;
    this.emit('mappingChanged', this.mapping);
  }

  addMapping(mapping: MidiMapping): void {
    this.mapping.push(mapping);
    this.emit('mappingChanged', this.mapping);
  }

  removeMapping(id: string): void {
    this.mapping = this.mapping.filter(m => m.id !== id);
    this.emit('mappingChanged', this.mapping);
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

  // ─── Handle Events ───────────────────────────────────────

  handleEvent(event: any): void {
    // External event from renderer or automation
    this.emit('midiEvent', event);
  }

  private handleMidiMessage(message: number[]): void {
    const [status, data1, data2] = message;
    const channel = (status & 0x0F) + 1;
    const type = status & 0xF0;

    let midiType: 'note' | 'cc' | 'program' = 'note';
    if (type === 0xB0) midiType = 'cc';
    else if (type === 0xC0) midiType = 'program';

    const event = {
      channel,
      type: midiType,
      value: data1,    // Note number or CC number
      velocity: data2,  // Note velocity or CC value
      rawMessage: message,
    };

    // MIDI Learn mode: auto-create mapping
    if (this.learning && this.learningTarget && midiType !== 'program') {
      const mapping: MidiMapping = {
        id: `midi-${Date.now()}`,
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
        const normalizedValue = this.normalizeMidiValue(data2, mapping.midiRange);
        this.emit('mapped', { mapping, value: normalizedValue, rawValue: data2 });
      }
    }
  }

  private normalizeMidiValue(rawValue: number, range: [number, number]): number {
    const [min, max] = range;
    return min + (rawValue / 127) * (max - min);
  }
}
