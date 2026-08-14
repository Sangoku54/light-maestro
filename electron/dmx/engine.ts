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
import { SacnReceiverManager } from './sacn-receiver';

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
  /** Listen for incoming sACN data on this universe's `sacnUniverse`.
   *  Defaults to true for type 'sacn' universes (set to false to disable). */
  sacnReceive?: boolean;
  /** HTP-merge the incoming (external) sACN frame into the outgoing frame. */
  sacnMergeOutput?: boolean;
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

  /** Universes that have had a live USB output at least once (drives the honest
   *  "reconnecting" vs "disconnected" status after a hot unplug). */
  private usbEverConnected = new Set<string>();

  // Art-Net / sACN outputs (main process, avoids worker require issues)
  private artnetOutputs: Map<string, ArtNetOutput> = new Map();
  private sacnOutputs: Map<string, SacnOutput> = new Map();

  /** sACN network receiver: monitors + merges incoming external sources. */
  private sacnReceiver = new SacnReceiverManager();

  /** Per-universe transmit telemetry for sACN outputs (network monitoring). */
  private sacnTxStats = new Map<string, { txPackets: number; lastSendAt: number; txFps: number }>();

  private blackoutState = false;
  /** Saved snapshot before blackout for restore() */
  private preBlackoutSnapshot: Uint8Array | null = null;

  /** Grand Master level applied at output time (not modifying SAB) */
  private grandMasterLevel = 1.0;

  /** Output telemetry surfaced to the renderer via getStatus() */
  private frameCount = 0;
  private lastFrameTime = 0;
  private measuredFps = 0;
  private lastError: string | null = null;

  /** Periodic USB retry: a port that appears late after boot gets picked up. */
  private usbRetryTimer: NodeJS.Timeout | null = null;
  private usbRetryCounts = new Map<string, number>();

  constructor() {
    super();
    this.sab = new SharedArrayBuffer(SAB_SIZE);
    this.channelView = new Uint8Array(this.sab);
    this.on('error', (e: Error) => { this.lastError = e.message; });
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
    // Fresh start: clear any stale error so the status bar goes green again
    this.lastError = null;
    await this.spawnWorker();
    if (this.startCancelled) { await this.stopInternal(); return; }

    const universeList = Array.from(this.universes.entries()).map(([, entry]) => ({
      index: entry.sabIndex,
      config: entry.config,
    }));
    this.worker!.postMessage({ type: 'init', channelBuffer: this.sab, universes: universeList, frameRate: FRAME_RATE });

    await this.startAllOutputs();
    if (this.startCancelled) { await this.stopInternal(); return; }

    // sACN network receiver (monitoring + merge of external sources). The
    // desired universe set is populated BEFORE construction so the socket
    // joins multicast groups from its bind callback (no add-before-bind race).
    this.syncSacnReceiver();
    this.sacnReceiver.start();

    this.worker!.postMessage({ type: 'start' });
    // A successful start clears transient errors from USB retry attempts —
    // unless a USB universe is still without a live output (honest status).
    if (this.hasDisconnectedUsb()) {
      this.lastError = 'USB output disconnected — waiting for dongle';
    } else {
      this.lastError = null;
    }
    for (const [id, entry] of this.universes.entries()) {
      // USB universes report their own liveness via the child output; other
      // output types are active as long as the engine is running.
      if (entry.config.type === 'usb-dmx') {
        const usb = this.usbOutputs.get(id);
        entry.active = !!(usb && usb.ready && !usb.child.killed);
      } else {
        entry.active = true;
      }
    }
    this.startUsbRetryTimer();
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
    this.stopUsbRetryTimer();
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
    this.sacnReceiver.stop();
    this.sacnTxStats.clear();
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

  /** Stop all outputs for a single universe (USB child, Art-Net, sACN). */
  private stopOutput(id: string): void {
    const usbOut = this.usbOutputs.get(id);
    if (usbOut) { try { usbOut.child.kill(); } catch {} this.usbOutputs.delete(id); }
    this.usbEverConnected.delete(id);
    const artnetOut = this.artnetOutputs.get(id);
    if (artnetOut) { try { artnetOut.controller.close(); } catch {} this.artnetOutputs.delete(id); }
    const sacnOut = this.sacnOutputs.get(id);
    if (sacnOut) { try { sacnOut.sender.close(); } catch {} this.sacnOutputs.delete(id); }
  }

  private async stopAllOutputs(): Promise<void> {
    for (const [, output] of this.usbOutputs) {
      try { output.child.kill(); } catch {}
    }
    this.usbOutputs.clear();
    this.usbEverConnected.clear();

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

    // Try to open the serial port with backoff retries — at boot the OS may not
    // have enumerated the USB adapter yet, so a single attempt fails silently.
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ok = await this.trySpawnUsbChild(id, portName, scriptPath);
      if (ok) return;
      if (attempt < maxAttempts) {
        await new Promise<void>((r) => setTimeout(r, 2000 * attempt));
      }
    }
    this.emit('error', new Error(`USB ${portName}: failed after ${maxAttempts} attempts`));
  }

  /** Spawn the USB child once; resolves true when the port reports READY. */
  private trySpawnUsbChild(id: string, portName: string, scriptPath: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      try {
        const projectRoot = path.join(__dirname, '..', '..', '..');
        const child = spawn(process.execPath, [scriptPath, portName], {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: projectRoot,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        });

        let settled = false;
        const settle = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
        let stdoutBuf = '';

        child.stdout?.on('data', (chunk: Buffer) => {
          stdoutBuf += chunk.toString();
          const lines = stdoutBuf.split('\n');
          stdoutBuf = lines.pop() || '';
          for (const line of lines) {
            try {
              const msg = JSON.parse(line.trim());
              if (msg.type === 'ready') {
                // Ignore a late READY from a child that was already timed
                // out / killed — a newer child owns this universe now.
                if (child.killed) return;
                const output: UsbOutput = { child, portName, ready: true };
                this.usbOutputs.set(id, output);
                const univ = this.universes.get(id);
                if (univ) univ.active = true;
                this.usbEverConnected.add(id);
                this.usbRetryCounts.set(id, 0);
                this.emit('info', `USB DMX ready on ${portName}`);
                settle(true);
              } else if (msg.type === 'error') {
                this.emit('error', new Error(`USB ${portName}: ${msg.message}`));
              } else if (msg.type === 'disconnected') {
                // USB dongle lost (unplugged / driver reset / open failure).
                // Drop the output entry so the retry timer respawns the child,
                // and surface an honest error instead of a green status.
                // Ignore a stale child: a newer one may own the universe now.
                const current = this.usbOutputs.get(id);
                if (current && current.child !== child) return;
                this.usbOutputs.delete(id);
                const univ = this.universes.get(id);
                if (univ) univ.active = false;
                this.usbRetryCounts.set(id, 0);
                this.emit('error', new Error(`USB ${portName}: ${msg.message || 'output lost'} — retrying`));
                try { child.kill(); } catch {}
              }
            } catch {}
          }
        });

        child.stderr?.on('data', (chunk: Buffer) => {
          const text = chunk.toString().trim();
          if (text) this.emit('error', new Error(`USB child stderr: ${text}`));
        });

        child.on('error', (err: Error) => {
          this.emit('error', new Error(`USB ${portName} child process error: ${err.message}`));
          const univ = this.universes.get(id);
          if (univ) univ.active = false;
          try { child.kill(); } catch {}
          this.usbOutputs.delete(id);
          settle(false);
        });

        child.on('exit', (code: number | null) => {
          // Only touch state that still belongs to THIS child: a newer child
          // may have taken over the universe id since (hot re-plug respawn).
          const current = this.usbOutputs.get(id);
          if (current && current.child === child) {
            this.usbOutputs.delete(id);
            const univ = this.universes.get(id);
            if (univ) univ.active = false;
          }
          if (code !== 0 && code !== null) {
            this.emit('error', new Error(`USB ${portName}: child exited with code ${code}`));
          }
          settle(false);
        });

        setTimeout(() => {
          if (!settled) {
            try { child.kill(); } catch {}
            const current = this.usbOutputs.get(id);
            if (current && current.child === child) {
              this.usbOutputs.delete(id);
              const univ = this.universes.get(id);
              if (univ) univ.active = false;
            }
            this.emit('error', new Error(`USB ${portName}: timeout waiting for READY`));
            settle(false);
          }
        }, 5000);
      } catch (e: any) {
        this.emit('error', new Error(`USB: ${e.message}`));
        resolve(false);
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

  // ─── USB retry watcher ──────────────────────────────────
  // At boot the OS may enumerate the USB adapter several seconds after the
  // engine starts. If a configured usb-dmx universe has no live output, retry
  // opening the port every 5s (up to ~60s) without any user action, then keep
  // retrying every ~30s so a dongle plugged back in at any time is picked up.
  private startUsbRetryTimer(): void {
    this.stopUsbRetryTimer();
    this.usbRetryCounts.clear();
    this.usbRetryTimer = setInterval(() => {
      for (const [id, entry] of this.universes.entries()) {
        if (entry.config.type !== 'usb-dmx') continue;
        if (this.usbOutputs.has(id)) continue;
        const portName = entry.config.serialPort || '';
        if (!portName.trim()) continue;
        const n = this.usbRetryCounts.get(id) || 0;
        // Fast phase: every tick (~5s) for the first 12 attempts (~60s,
        // covers slow boot enumeration). Slow phase: every 6th tick (~30s)
        // indefinitely, so a hot-plugged dongle is picked up at any time.
        if (n >= 12 && n % 6 !== 0) continue;
        this.usbRetryCounts.set(id, n + 1);
        const scriptPath = path.join(__dirname, 'usb-output.js');
        this.trySpawnUsbChild(id, portName, scriptPath).then((ok) => {
          if (ok) this.usbRetryCounts.set(id, 0);
        });
      }
    }, 5000);
  }

  /** True when a configured usb-dmx universe has no live child output.
   *  Drives the honest status: frames flowing elsewhere must not clear the
   *  "USB disconnected" error while a dongle is down. */
  private hasDisconnectedUsb(): boolean {
    for (const [id, entry] of this.universes.entries()) {
      if (entry.config.type !== 'usb-dmx') continue;
      if (!(entry.config.serialPort || '').trim()) continue; // config error, not hardware state
      const usb = this.usbOutputs.get(id);
      if (!usb || !usb.ready || usb.child.killed) return true;
    }
    return false;
  }

  private stopUsbRetryTimer(): void {
    if (this.usbRetryTimer) {
      clearInterval(this.usbRetryTimer);
      this.usbRetryTimer = null;
    }
  }

  // ─── Frame Dispatch ───────────────────────────────────────

  private handleFrameSent(): void {
    // Telemetry: measure the worker's output heartbeat (running ⇒ ~30 fps)
    this.frameCount++;
    // Frames flowing = the engine is healthy: clear any transient boot error —
    // unless a USB universe is down, in which case the error must stay visible
    // (never show a green "all OK" dot while a dongle is disconnected).
    if (this.lastError && !this.hasDisconnectedUsb()) this.lastError = null;
    const now = Date.now();
    if (this.lastFrameTime > 0) {
      const dt = now - this.lastFrameTime;
      if (dt > 0) {
        const inst = 1000 / dt;
        this.measuredFps = this.measuredFps === 0 ? inst : this.measuredFps * 0.9 + inst * 0.1;
      }
    }
    this.lastFrameTime = now;

    if (!this.channelView || this.blackoutState) return;

    const gm = this.grandMasterLevel;

    for (const [id, entry] of this.universes.entries()) {
      if (!entry.config.output) continue;

      const offset = entry.sabIndex * DMX_CHANNELS;
      const data = this.channelView.subarray(offset, offset + DMX_CHANNELS);

      // sACN network merge: HTP-inject the merged incoming frame (external
      // consoles) into the outgoing frame when enabled for this universe.
      // Only fresh frames are injected — once every source times out the
      // output falls back to the local data alone (no stale pins).
      let finalData: Uint8Array = data;
      if (entry.config.type === 'sacn' && entry.config.sacnMergeOutput) {
        const merged = this.sacnReceiver.getMergedFrame(entry.config.sacnUniverse ?? 1);
        if (merged) {
          const mergedOut = new Uint8Array(DMX_CHANNELS);
          for (let i = 0; i < DMX_CHANNELS; i++) {
            const v = data[i];
            mergedOut[i] = merged[i] > v ? merged[i] : v;
          }
          finalData = mergedOut;
        }
      }

      // Apply Grand Master at output time (non-destructive). Scale the
      // FINAL data (local + sACN merge) so an external console's input is
      // not dropped when the GM is below 1.0 (merge-puis-GM, pas merge-ou-GM).
      if (gm < 1.0) {
        const scaled = new Uint8Array(DMX_CHANNELS);
        for (let i = 0; i < DMX_CHANNELS; i++) {
          scaled[i] = Math.round(finalData[i] * gm);
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
    try {
      output.sender.send(Buffer.from(data));
      // Transmit telemetry for network monitoring (packets + smoothed fps)
      const now = Date.now();
      const st = this.sacnTxStats.get(id) ?? { txPackets: 0, lastSendAt: 0, txFps: 0 };
      st.txPackets++;
      if (st.lastSendAt > 0) {
        const dt = now - st.lastSendAt;
        if (dt > 0) {
          const inst = 1000 / dt;
          st.txFps = st.txFps === 0 ? inst : st.txFps * 0.9 + inst * 0.1;
        }
      }
      st.lastSendAt = now;
      this.sacnTxStats.set(id, st);
    } catch {}
  }

  // ─── Universe Management ─────────────────────────────────

  async addUniverse(config: UniverseConfig): Promise<string> {
    const fullConfig: UniverseConfig = { ...config, channels: config.channels || DMX_CHANNELS };

    // Idempotent: updating an existing universe must not duplicate it in
    // universeOrder nor leak a new sabIndex slot.
    const existing = this.universes.get(config.id);
    if (existing) {
      const changed = JSON.stringify(existing.config) !== JSON.stringify(fullConfig);
      existing.config = fullConfig;
      if (changed && this.worker && this.workerReady) {
        this.stopOutput(config.id);
        await this.startOutput(config.id, fullConfig);
        this.worker.postMessage({ type: 'addUniverse', index: existing.sabIndex, config: fullConfig });
      }
      return config.id;
    }

    if (this.freeSabIndices.length === 0 && this.nextSabIndex >= MAX_UNIVERSES) {
      throw new Error(`Maximum of ${MAX_UNIVERSES} universes reached`);
    }
    const sabIndex = this.freeSabIndices.length > 0 ? this.freeSabIndices.pop()! : this.nextSabIndex++;
    const entry: UniverseEntry = { config: fullConfig, sabIndex, active: this.worker !== null };
    this.universes.set(config.id, entry);
    this.universeOrder.push(config.id);

    if (this.worker && this.workerReady) {
      await this.startOutput(config.id, fullConfig);
      this.worker.postMessage({ type: 'addUniverse', index: sabIndex, config: fullConfig });
    }

    this.syncSacnReceiver();
    this.emit('universeAdded', fullConfig);
    return config.id;
  }

  /**
   * Reconcile the engine's universes with an authoritative config list.
   * Removes universes no longer present, adds/updates the rest, and enforces
   * the exact ordering so universe INDEX mapping matches the config array.
   */
  async syncUniverses(configs: UniverseConfig[]): Promise<void> {
    const incomingIds = configs.map((c) => c.id);

    for (const id of Array.from(this.universes.keys())) {
      if (!incomingIds.includes(id)) {
        await this.removeUniverse(id);
      }
    }

    for (const cfg of configs) {
      await this.addUniverse(cfg);
    }

    this.universeOrder = incomingIds.filter((id) => this.universes.has(id));
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
    this.usbEverConnected.delete(id);
    const artnetOut = this.artnetOutputs.get(id);
    if (artnetOut) { try { artnetOut.controller.close(); } catch {} this.artnetOutputs.delete(id); }
    const sacnOut = this.sacnOutputs.get(id);
    if (sacnOut) { try { sacnOut.sender.close(); } catch {} this.sacnOutputs.delete(id); }

    if (this.worker && this.workerReady) {
      this.worker.postMessage({ type: 'removeUniverse', index: entry.sabIndex });
    }
    this.universes.delete(id);
    this.sacnTxStats.delete(id);
    this.syncSacnReceiver();
    this.emit('universeRemoved', id);
  }

  getUniverseConfigs(): UniverseConfig[] {
    return Array.from(this.universes.values()).map((u) => u.config);
  }

  /** Toggle sACN reception for a universe (runtime, engine-side). */
  setSacnReceive(id: string, enabled: boolean): void {
    const entry = this.universes.get(id);
    if (!entry) return;
    entry.config.sacnReceive = !!enabled;
    this.syncSacnReceiver();
  }

  /** Whether this universe should be listened to for incoming sACN. */
  private shouldReceiveSacn(config: UniverseConfig): boolean {
    return config.sacnReceive === true ||
      (config.type === 'sacn' && config.sacnReceive !== false);
  }

  /** Reconcile the receiver's universe set with the engine config. */
  private syncSacnReceiver(): void {
    const universes = new Set<number>();
    for (const [, entry] of this.universes) {
      const cfg = entry.config;
      if (!this.shouldReceiveSacn(cfg) || cfg.sacnUniverse === undefined) continue;
      universes.add(cfg.sacnUniverse);
    }
    this.sacnReceiver.setUniverses(Array.from(universes));
  }

  /** Full output status for the renderer (monitoring panel / status bar). */
  getStatus() {
    return {
      running: this.isRunning(),
      blackout: this.blackoutState,
      grandMaster: this.grandMasterLevel,
      frameRate: Math.round(this.measuredFps),
      frameCount: this.frameCount,
      universes: Array.from(this.universes.values()).map((e) => {
        let usbState: 'none' | 'ready' | 'reconnecting' | 'disconnected' = 'none';
        if (e.config.type === 'usb-dmx') {
          const usb = this.usbOutputs.get(e.config.id);
          if (usb && usb.ready && !usb.child.killed) usbState = 'ready';
          else if (this.usbEverConnected.has(e.config.id)) usbState = 'reconnecting';
          else usbState = 'disconnected';
        }
        return {
          id: e.config.id,
          name: e.config.name,
          type: e.config.type,
          output: e.config.output,
          serialPort: e.config.serialPort || '',
          artnetIP: e.config.artnetIP || '',
          artnetUniverse: e.config.artnetUniverse ?? 0,
          sacnUniverse: e.config.sacnUniverse ?? 1,
          sacnPriority: e.config.sacnPriority ?? 100,
          sacnReceive: e.config.sacnReceive !== false && (e.config.type === 'sacn' || e.config.sacnReceive === true),
          sacnMergeOutput: !!e.config.sacnMergeOutput,
          channels: e.config.channels,
          active: e.active,
          usbState,
        };
      }),
      network: this.getNetworkStatus(),
      lastError: this.lastError,
    };
  }

  /** sACN network monitoring: what leaves (tx) and what arrives (rx). */
  private getNetworkStatus() {
    const rxStats = this.sacnReceiver.getStats();
    const universes = Array.from(this.universes.values())
      .filter((e) => e.config.type === 'sacn' || this.shouldReceiveSacn(e.config))
      .map((e) => {
        const uni = e.config.sacnUniverse ?? 1;
        const rx = rxStats.universes.find((u) => u.universe === uni);
        const tx = this.sacnTxStats.get(e.config.id);
        return {
          universe: uni,
          universeId: e.config.id,
          name: e.config.name,
          priority: e.config.sacnPriority ?? 100,
          // TX side — what Light Maestro sends on the network
          outputEnabled: !!e.config.output,
          txActive: e.active && !!this.sacnOutputs.get(e.config.id),
          txFps: tx ? Math.round(tx.txFps) : 0,
          txPackets: tx?.txPackets ?? 0,
          txLastSendAt: tx?.lastSendAt ?? 0,
          // RX side — what arrives from external sources
          receiveEnabled: this.shouldReceiveSacn(e.config),
          receiving: rx?.receiving ?? false,
          rxFps: rx?.rxFps ?? 0,
          rxPps: rx?.rxPps ?? 0,
          rxPackets: rx?.rxPackets ?? 0,
          rxLastFrameAt: rx?.lastFrameAt ?? 0,
          sources: rx?.sources ?? [],
          mergeOutput: !!e.config.sacnMergeOutput,
        };
      })
      .sort((a, b) => a.universe - b.universe);
    return {
      enabled: rxStats.enabled,
      errors: rxStats.errors,
      universes,
    };
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
