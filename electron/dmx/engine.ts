/**
 * DMX Engine — Core lighting output system
 *
 * USB DMX output via serialport child process.
 * Art-Net and sACN output directly from main process.
 *
 * Architecture:
 *   Renderer → IPC → engine.setChannels → SharedArrayBuffer
 *   Worker reads SAB → posts frameSent to main
 *   Main writes to serialport child / Art-Net / sACN
 */

import { EventEmitter } from 'events';
import { Worker } from 'worker_threads';
import { ChildProcess, spawn } from 'child_process';
import path from 'path';

export interface UniverseConfig {
  id: string;
  name: string;
  type: 'artnet' | 'sacn' | 'usb-dmx' | 'virtual';
  output: boolean;
  input: boolean;
  artnetIP?: string;
  artnetSubnet?: number;
  artnetUniverse?: number;
  sacnUniverse?: number;
  sacnPriority?: number;
  serialPort?: string;
  channels: number;
}

interface UniverseEntry {
  config: UniverseConfig;
  sabIndex: number;
  active: boolean;
}

interface UsbOutput {
  child: ChildProcess;
  portName: string;
  ready: boolean;
}

interface ArtNetOutput {
  controller: any;
}

interface SacnOutput {
  sender: any;
}

const DMX_CHANNELS = 512;
const MAX_UNIVERSES = 16;
const SAB_SIZE = MAX_UNIVERSES * DMX_CHANNELS;
const FRAME_RATE = 30;
const WORKER_TERMINATE_TIMEOUT = 500;

export class DMXEngine extends EventEmitter {
  private universes: Map<string, UniverseEntry> = new Map();
  private universeOrder: string[] = [];
  private nextSabIndex = 0;
  /** Reusable sabIndex slots from removed universes */
  private freeSabIndices: number[] = [];

  private sab: SharedArrayBuffer;
  private channelView: Uint8Array;

  private worker: Worker | null = null;
  private workerReady = false;
  private startCancelled = false;

  // USB serialport child process outputs (one per universe)
  private usbOutputs: Map<string, UsbOutput> = new Map();

  // Art-Net / sACN outputs (main process, avoids worker require issues)
  private artnetOutputs: Map<string, ArtNetOutput> = new Map();
  private sacnOutputs: Map<string, SacnOutput> = new Map();

  private blackoutState = false;
  /** Saved snapshot before blackout for restore() */
  private preBlackoutSnapshot: Uint8Array | null = null;

  /** Grand Master level applied at output time (not modifying SAB) */
  private grandMasterLevel = 1.0;

  constructor() {
    super();
    this.sab = new SharedArrayBuffer(SAB_SIZE);
    this.channelView = new Uint8Array(this.sab);
  }

  // ─── Lifecycle ───────────────────────────────────────────

  private _startingPromise: Promise<void> | null = null;

  async start(): Promise<void> {
    if (this.worker && this.workerReady) return;
    if (this._startingPromise) return this._startingPromise;

    this.startCancelled = false;
    this._startingPromise = this._doStart();
    try {
      await this._startingPromise;
    } finally {
      this._startingPromise = null;
    }
  }

  private async _doStart(): Promise<void> {
    if (this.startCancelled) return;
    await this.spawnWorker();
    if (this.startCancelled) { await this.stopInternal(); return; }

    const universeList = Array.from(this.universes.entries()).map(([, entry]) => ({
      index: entry.sabIndex,
      config: entry.config,
    }));
    this.worker!.postMessage({ type: 'init', channelBuffer: this.sab, universes: universeList, frameRate: FRAME_RATE });

    await this.startAllOutputs();
    if (this.startCancelled) { await this.stopInternal(); return; }

    this.worker!.postMessage({ type: 'start' });
    for (const entry of this.universes.values()) entry.active = true;
    this.emit('started');
  }

  async stop(): Promise<void> {
    this.startCancelled = true;
    // Cancel pending start
    if (this._startingPromise) {
      try { await this._startingPromise; } catch {}
    }
    await this.stopInternal();
  }

  private async stopInternal(): Promise<void> {
    for (const entry of this.universes.values()) entry.active = false;

    if (this.worker) {
      try {
        this.worker.postMessage({ type: 'stop' });
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => resolve(), WORKER_TERMINATE_TIMEOUT);
          this.worker!.once('message', (msg: any) => {
            if (msg.type === 'stopped') { clearTimeout(timeout); resolve(); }
          });
        });
      } catch {}
      this.worker.removeAllListeners();
      try { await this.worker.terminate(); } catch {}
    }
    this.worker = null;
    this.workerReady = false;

    await this.stopAllOutputs();
    this.emit('stopped');
  }

  private spawnWorker(): Promise<void> {
    return new Promise((resolve, reject) => {
      const workerPath = path.join(__dirname, 'worker.js');
      let settled = false;
      const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };

      if (this.startCancelled) { settle(() => reject(new Error('Start cancelled'))); return; }

      this.worker = new Worker(workerPath);
      this.worker.on('message', (msg: any) => {
        switch (msg.type) {
          case 'error': this.emit('error', new Error(msg.message)); break;
          case 'frameSent': this.handleFrameSent(); break;
          case 'stopped': break;
          case 'info': if (msg.message) this.emit('info', msg.message); break;
        }
      });
      this.worker.on('error', (err: Error) => {
        this.emit('error', err);
        this.worker = null;
        this.workerReady = false;
        settle(() => reject(err));
      });
      this.worker.on('exit', (code: number) => {
        const msg = `DMX worker exited with code ${code}`;
        if (code !== 0) this.emit('error', new Error(msg));
        this.worker = null;
        this.workerReady = false;
        if (!settled) settle(() => reject(new Error(msg)));
      });
      this.worker.on('online', () => { this.workerReady = true; settle(() => resolve()); });
    });
  }

  // ─── Output Management ───────────────────────────────────

  private async startAllOutputs(): Promise<void> {
    for (const [id, entry] of this.universes.entries()) {
      await this.startOutput(id, entry.config);
    }
  }

  private async stopAllOutputs(): Promise<void> {
    for (const [, output] of this.usbOutputs) {
      try { output.child.kill(); } catch {}
    }
    this.usbOutputs.clear();

    for (const [, output] of this.artnetOutputs) {
      try { output.controller.close(); } catch {}
    }
    this.artnetOutputs.clear();

    for (const [, output] of this.sacnOutputs) {
      try { output.sender.close(); } catch {}
    }
    this.sacnOutputs.clear();
  }

  private async startOutput(id: string, config: UniverseConfig): Promise<void> {
    switch (config.type) {
      case 'usb-dmx':
        await this.startUsbOutput(id, config);
        break;
      case 'artnet':
        await this.startArtNetOutput(id, config);
        break;
      case 'sacn':
        await this.startSacnOutput(id, config);
        break;
    }
  }

  // ─── USB DMX via SerialPort Child Process ─────────────────

  private async startUsbOutput(id: string, config: UniverseConfig): Promise<void> {
    const portName = config.serialPort || '';
    if (!portName.trim()) {
      this.emit('error', new Error(`USB DMX: No serial port configured for universe "${config.name || id}"`));
      return;
    }

    const existing = this.usbOutputs.get(id);
    if (existing) {
      try { existing.child.kill(); } catch {}
      this.usbOutputs.delete(id);
    }

    const scriptPath = path.join(__dirname, 'usb-output.js');

    return new Promise<void>((resolve) => {
      try {
        const projectRoot = path.join(__dirname, '..', '..', '..');
        const child = spawn(process.execPath, [scriptPath, portName], {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: projectRoot,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        });

        let resolved = false;
        let stdoutBuf = '';

        child.stdout?.on('data', (chunk: Buffer) => {
          stdoutBuf += chunk.toString();
          const lines = stdoutBuf.split('\n');
          stdoutBuf = lines.pop() || '';
          for (const line of lines) {
            try {
              const msg = JSON.parse(line.trim());
              if (msg.type === 'ready') {
                const output: UsbOutput = { child, portName, ready: true };
                this.usbOutputs.set(id, output);
                this.emit('info', `USB DMX ready on ${portName}`);
                if (!resolved) { resolved = true; resolve(); }
              } else if (msg.type === 'error') {
                this.emit('error', new Error(`USB ${portName}: ${msg.message}`));
              }
            } catch {}
          }
        });

        child.stderr?.on('data', (chunk: Buffer) => {
          const text = chunk.toString().trim();
          if (text) this.emit('error', new Error(`USB child stderr: ${text}`));
        });

        child.on('error', (err: Error) => {
          this.emit('error', new Error(`USB child process error: ${err.message}`));
          if (!resolved) { resolved = true; resolve(); }
        });

        child.on('exit', (code: number | null) => {
          if (code !== 0 && code !== null) {
            this.emit('error', new Error(`USB child exited with code ${code}`));
          }
          this.usbOutputs.delete(id);
        });

        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            this.emit('error', new Error(`USB ${portName}: timeout waiting for READY`));
            resolve();
          }
        }, 5000);

      } catch (e: any) {
        this.emit('error', new Error(`USB: ${e.message}`));
        resolve();
      }
    });
  }

  // ─── Art-Net Output ───────────────────────────────────────

  private async startArtNetOutput(id: string, config: UniverseConfig): Promise<void> {
    try {
      const ArtNet = require('artnet');
      const controller = ArtNet.createController({
        host: config.artnetIP || '255.255.255.255',
        universe: config.artnetUniverse || 0,
        subnet: config.artnetSubnet || 0,
      });
      this.artnetOutputs.set(id, { controller });
      this.emit('info', `Art-Net ready on ${config.artnetIP || 'broadcast'} universe ${config.artnetUniverse || 0}`);
    } catch (e: any) {
      this.emit('error', new Error(`Art-Net init failed for ${config.id}: ${e.message}`));
    }
  }

  // ─── sACN Output ──────────────────────────────────────────

  private async startSacnOutput(id: string, config: UniverseConfig): Promise<void> {
    try {
      const sACN = require('sacn');
      const sender = new sACN.Sender({
        universe: config.sacnUniverse || 1,
      });
      this.sacnOutputs.set(id, { sender });
      this.emit('info', `sACN ready on universe ${config.sacnUniverse || 1}`);
    } catch (e: any) {
      this.emit('error', new Error(`sACN init failed for ${config.id}: ${e.message}`));
    }
  }

  // ─── Frame Dispatch ───────────────────────────────────────

  private handleFrameSent(): void {
    if (!this.channelView || this.blackoutState) return;

    const gm = this.grandMasterLevel;

    for (const [id, entry] of this.universes.entries()) {
      if (!entry.config.output) continue;

      const offset = entry.sabIndex * DMX_CHANNELS;
      const data = this.channelView.subarray(offset, offset + DMX_CHANNELS);

      // Apply Grand Master at output time (non-destructive)
      let finalData: Uint8Array = data;
      if (gm < 1.0) {
        const scaled = new Uint8Array(DMX_CHANNELS);
        for (let i = 0; i < DMX_CHANNELS; i++) {
          scaled[i] = Math.round(data[i] * gm);
        }
        finalData = scaled;
      }

      switch (entry.config.type) {
        case 'usb-dmx':
          this.sendUsbFrame(id, finalData);
          break;
        case 'artnet':
          this.sendArtNetFrame(id, finalData);
          break;
        case 'sacn':
          this.sendSacnFrame(id, finalData);
          break;
      }
    }
  }

  private sendUsbFrame(id: string, data: Uint8Array): void {
    const output = this.usbOutputs.get(id);
    if (!output || !output.ready || output.child.killed) return;

    try {
      const frame = Buffer.alloc(515);
      frame[0] = 0x01;
      frame[1] = 0;
      frame[2] = 0x00;
      const len = Math.min(data.length, 512);
      for (let i = 0; i < len; i++) frame[i + 3] = data[i];
      output.child.stdin?.write(frame);
    } catch {}
  }

  private sendArtNetFrame(id: string, data: Uint8Array): void {
    const output = this.artnetOutputs.get(id);
    if (!output) return;
    try { output.controller.send(Buffer.from(data)); } catch {}
  }

  private sendSacnFrame(id: string, data: Uint8Array): void {
    const output = this.sacnOutputs.get(id);
    if (!output) return;
    try { output.sender.send(Buffer.from(data)); } catch {}
  }

  // ─── Universe Management ─────────────────────────────────

  async addUniverse(config: UniverseConfig): Promise<string> {
    if (this.freeSabIndices.length === 0 && this.nextSabIndex >= MAX_UNIVERSES) {
      throw new Error(`Maximum of ${MAX_UNIVERSES} universes reached`);
    }
    const sabIndex = this.freeSabIndices.length > 0 ? this.freeSabIndices.pop()! : this.nextSabIndex++;
    const fullConfig: UniverseConfig = { ...config, channels: config.channels || DMX_CHANNELS };
    const entry: UniverseEntry = { config: fullConfig, sabIndex, active: this.worker !== null };
    this.universes.set(config.id, entry);
    this.universeOrder.push(config.id);

    if (this.worker && this.workerReady) {
      await this.startOutput(config.id, fullConfig);
      this.worker.postMessage({ type: 'addUniverse', index: sabIndex, config: fullConfig });
    }

    this.emit('universeAdded', fullConfig);
    return config.id;
  }

  async removeUniverse(id: string): Promise<void> {
    const entry = this.universes.get(id);
    if (!entry) return;
    this.universeOrder = this.universeOrder.filter((uid) => uid !== id);

    // Recycle sabIndex
    this.freeSabIndices.push(entry.sabIndex);
    const offset = entry.sabIndex * DMX_CHANNELS;
    this.channelView.fill(0, offset, offset + DMX_CHANNELS);

    const usbOut = this.usbOutputs.get(id);
    if (usbOut) { try { usbOut.child.kill(); } catch {} this.usbOutputs.delete(id); }
    const artnetOut = this.artnetOutputs.get(id);
    if (artnetOut) { try { artnetOut.controller.close(); } catch {} this.artnetOutputs.delete(id); }
    const sacnOut = this.sacnOutputs.get(id);
    if (sacnOut) { try { sacnOut.sender.close(); } catch {} this.sacnOutputs.delete(id); }

    if (this.worker && this.workerReady) {
      this.worker.postMessage({ type: 'removeUniverse', index: entry.sabIndex });
    }
    this.universes.delete(id);
    this.emit('universeRemoved', id);
  }

  getUniverseConfigs(): UniverseConfig[] {
    return Array.from(this.universes.values()).map((u) => u.config);
  }

  getUniverseData(id: string): Uint8Array | null {
    const entry = this.universes.get(id);
    if (!entry) return null;
    return this.channelView.slice(entry.sabIndex * DMX_CHANNELS, (entry.sabIndex + 1) * DMX_CHANNELS);
  }

  getAllData(): Map<string, Uint8Array> {
    const map = new Map<string, Uint8Array>();
    for (const [id, entry] of this.universes) {
      map.set(id, this.channelView.slice(entry.sabIndex * DMX_CHANNELS, (entry.sabIndex + 1) * DMX_CHANNELS));
    }
    return map;
  }

  // ─── Channel Control ─────────────────────────────────────

  setChannel(universe: number, channel: number, value: number): void {
    if (channel < 1 || channel > DMX_CHANNELS) return;
    const entry = this.getUniverseByIndex(universe);
    if (!entry || this.blackoutState) return;
    this.channelView[entry.sabIndex * DMX_CHANNELS + channel - 1] =
      Math.max(0, Math.min(255, Math.round(value)));
  }

  setChannels(universe: number, channels: Record<number, number>): void {
    const entry = this.getUniverseByIndex(universe);
    if (!entry || this.blackoutState) return;
    const baseOffset = entry.sabIndex * DMX_CHANNELS;
    for (const [ch, val] of Object.entries(channels)) {
      const chNum = typeof ch === 'string' ? parseInt(ch, 10) : ch;
      if (chNum < 1 || chNum > DMX_CHANNELS) continue;
      this.channelView[baseOffset + chNum - 1] =
        Math.max(0, Math.min(255, Math.round(val)));
    }
  }

  htpMerge(universe: number, channels: Record<number, number>): void {
    const entry = this.getUniverseByIndex(universe);
    if (!entry || this.blackoutState) return;
    const baseOffset = entry.sabIndex * DMX_CHANNELS;
    for (const [ch, val] of Object.entries(channels)) {
      const chNum = typeof ch === 'string' ? parseInt(ch, 10) : ch;
      if (chNum < 1 || chNum > DMX_CHANNELS) continue;
      const idx = baseOffset + chNum - 1;
      this.channelView[idx] = Math.max(this.channelView[idx], Math.round(val));
    }
  }

  ltpMerge(universe: number, channels: Record<number, number>): void {
    const entry = this.getUniverseByIndex(universe);
    if (!entry || this.blackoutState) return;
    const baseOffset = entry.sabIndex * DMX_CHANNELS;
    for (const [ch, val] of Object.entries(channels)) {
      const chNum = typeof ch === 'string' ? parseInt(ch, 10) : ch;
      if (chNum < 1 || chNum > DMX_CHANNELS) continue;
      this.channelView[baseOffset + chNum - 1] = Math.round(val);
    }
  }

  // ─── Blackout ────────────────────────────────────────────

  blackout(): void {
    if (this.blackoutState) return;
    // Save snapshot BEFORE zeroing
    this.preBlackoutSnapshot = new Uint8Array(this.channelView);
    this.blackoutState = true;
    this.channelView.fill(0);
    for (const [id] of this.universes.entries()) {
      const zeroData = new Uint8Array(DMX_CHANNELS);
      this.sendUsbFrame(id, zeroData);
      this.sendArtNetFrame(id, zeroData);
      this.sendSacnFrame(id, zeroData);
    }
    this.emit('blackout');
  }

  restore(): void {
    if (!this.blackoutState) return;
    this.blackoutState = false;
    if (this.preBlackoutSnapshot) {
      this.channelView.set(this.preBlackoutSnapshot);
      this.preBlackoutSnapshot = null;
    }
    this.emit('restored');
  }

  isBlackout(): boolean { return this.blackoutState; }

  applyGrandMaster(level: number): void {
    this.grandMasterLevel = Math.max(0, Math.min(1, level));
  }

  isRunning(): boolean { return this.worker !== null && this.workerReady; }

  // ─── Universe index → entry (stable, keyed by insertion order) ──

  getUniverseIndexById(id: string): number {
    return this.universeOrder.indexOf(id);
  }

  getIdByIndex(index: number): string | undefined {
    return this.universeOrder[index];
  }

  private getUniverseByIndex(index: number): UniverseEntry | undefined {
    const id = this.universeOrder[index];
    if (id === undefined) return undefined;
    return this.universes.get(id);
  }
}
