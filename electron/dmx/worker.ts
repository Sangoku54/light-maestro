/**
 * DMX Worker — Precise-timing output thread
 *
 * Runs in a separate Node.js Worker thread with process.hrtime() timing.
 * Reads universe channel data from a SharedArrayBuffer (zero-copy).
 *
 * Architecture (revised):
 *   Renderer → IPC → engine.setChannels → SharedArrayBuffer
 *   Worker (this) reads SAB → notifies main "frameSent"
 *   Main process handles ALL output (USB serialport, Art-Net, sACN)
 *
 * This eliminates module resolution issues with native bindings
 * in worker threads (artnet, sacn, serialport all need main process).
 */

import { parentPort } from 'worker_threads';

const DMX_CHANNELS = 512;
const DEFAULT_FRAME_RATE = 30;

interface UniverseConfig {
  id: string;
  name: string;
  type: 'artnet' | 'sacn' | 'usb-dmx' | 'virtual';
  output: boolean;
  input: boolean;
  channels: number;
  serialPort?: string;
  artnetIP?: string;
  artnetSubnet?: number;
  artnetUniverse?: number;
  sacnUniverse?: number;
  sacnPriority?: number;
}

type WorkerInbound =
  | { type: 'init'; channelBuffer: SharedArrayBuffer; universes: Array<{ index: number; config: UniverseConfig }>; frameRate?: number }
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'addUniverse'; index: number; config: UniverseConfig }
  | { type: 'removeUniverse'; index: number }
  | { type: 'setFrameRate'; frameRate: number };

// ─── State ──────────────────────────────────────────────────

let channelView: Uint8Array | null = null;
const universeConfigs = new Map<number, UniverseConfig>();

let running = false;
let frameTimer: ReturnType<typeof setTimeout> | null = null;
let frameRate = DEFAULT_FRAME_RATE;
let frameIntervalNs = BigInt(Math.round((1000 / frameRate) * 1_000_000));
let nextFrameTime = 0n;
let frameCount = 0;

// ─── Guard ──────────────────────────────────────────────────

if (!parentPort) {
  throw new Error('DMX worker must run as a Worker thread (parentPort is null)');
}

process.on('uncaughtException', (err: Error) => {
  parentPort?.postMessage({ type: 'error', message: `Worker error: ${err.message}` });
});

// ─── Message handler ────────────────────────────────────────

parentPort.on('message', (msg: WorkerInbound) => {
  switch (msg.type) {
    case 'init':
      handleInit(msg.channelBuffer, msg.universes, msg.frameRate);
      break;
    case 'start':
      startLoop();
      break;
    case 'stop':
      stopLoop();
      break;
    case 'addUniverse':
      universeConfigs.set(msg.index, msg.config);
      break;
    case 'removeUniverse':
      universeConfigs.delete(msg.index);
      break;
    case 'setFrameRate':
      frameRate = msg.frameRate;
      frameIntervalNs = BigInt(Math.round((1000 / frameRate) * 1_000_000));
      break;
  }
});

// ─── Init ───────────────────────────────────────────────────

function handleInit(
  sab: SharedArrayBuffer,
  universes: Array<{ index: number; config: UniverseConfig }>,
  rate?: number
): void {
  channelView = new Uint8Array(sab);

  if (rate) {
    frameRate = rate;
    frameIntervalNs = BigInt(Math.round((1000 / frameRate) * 1_000_000));
  }

  for (const { index, config } of universes) {
    universeConfigs.set(index, config);
  }
}

// ─── Timing loop ────────────────────────────────────────────

function startLoop(): void {
  if (running) return;
  running = true;
  nextFrameTime = process.hrtime.bigint();
  frameCount = 0;
  scheduleNext();
}

function stopLoop(): void {
  running = false;
  if (frameTimer !== null) {
    clearTimeout(frameTimer);
    frameTimer = null;
  }
  parentPort!.postMessage({ type: 'stopped' });
}

function scheduleNext(): void {
  if (!running) return;

  // Notify main process to send current frame to outputs
  frameCount++;
  parentPort!.postMessage({ type: 'frameSent', count: frameCount });

  // Drift-free scheduling
  nextFrameTime += frameIntervalNs;
  const now = process.hrtime.bigint();
  const remainingNs = nextFrameTime - now;

  if (!running) return;

  if (remainingNs <= 0n) {
    nextFrameTime = now + frameIntervalNs;
    frameTimer = setTimeout(scheduleNext, 0);
  } else {
    frameTimer = setTimeout(scheduleNext, Number(remainingNs) / 1_000_000);
  }
}

// ─── Cleanup ────────────────────────────────────────────────

process.on('exit', () => {
  stopLoop();
});
