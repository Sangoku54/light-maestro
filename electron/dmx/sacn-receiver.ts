/**
 * sACN Receiver + network merge + monitoring
 *
 * Listens to incoming E1.31 (sACN) universes on the LAN, tracks one source
 * per (cid) per universe, merges them with priority-aware HTP (highest
 * priority wins; equal priorities are merged per-channel with max), and
 * exposes live stats (fps, packets, last frame, active/inactive sources)
 * plus the latest merged frame for optional re-injection into output.
 *
 * Robustness contract:
 *  - Safe with no network, no source, or no configured universe (never throws).
 *  - All receiver events are subscribed (packet / error / PacketCorruption /
 *    PacketOutOfOrder) so a malformed or hostile packet can never crash the
 *    main process.
 *  - stop() closes the UDP socket and removes every listener (no leak).
 *  - A 1s sweep reconciles multicast memberships (self-heals the
 *    addUniverse-before-bind race in sacn@4.6) and refreshes fps counters.
 *
 * Note on typing: the electron build uses the ambient `declare module 'sacn'`
 * shim in electron/types.d.ts (Sender only), which shadows the real package
 * types. The receiver contract is therefore declared structurally below —
 * verified against node_modules/sacn/dist/receiver.d.ts (sacn@4.6.0):
 *   class Receiver extends EventEmitter {
 *     universes: number[];
 *     on<'packet'|'PacketCorruption'|'PacketOutOfOrder'|'error'>(...): this;
 *     addUniverse(universe: number): this;
 *     removeUniverse(universe: number): this;
 *     close(callback?: () => void): this;
 *   }
 * and packet.d.ts: Packet { sourceName, sourceAddress, universe, sequence,
 *   priority, cid: Buffer, payloadAsBuffer: Buffer | null, payload: Payload }
 */

// ─── Structural contracts (sacn@4.6) ──────────────────────

/** The subset of a parsed sACN packet we consume. */
export interface SacnIncomingPacket {
  sourceName: string;
  sourceAddress: string;
  universe: number;
  sequence: number;
  priority: number;
  /** 64-bit CID of the sending console (unique per source). */
  cid: Buffer;
  /** Raw DMX bytes (0-255), null when the packet carried no data. */
  payloadAsBuffer: Buffer | null;
}

interface SacnReceiverHandle {
  universes: number[];
  on(event: 'packet', listener: (packet: SacnIncomingPacket) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
  on(event: 'PacketCorruption', listener: (err: Error) => void): this;
  on(event: 'PacketOutOfOrder', listener: (err: Error) => void): this;
  removeAllListeners(): void;
  addUniverse(universe: number): this;
  removeUniverse(universe: number): this;
  close(callback?: () => void): this;
}

interface SacnReceiverModule {
  Receiver: new (opts: { universes: number[]; reuseAddr?: boolean; iface?: string }) => SacnReceiverHandle;
}

// ─── Constants ────────────────────────────────────────────

const DMX_CHANNELS = 512;
/** A source that sends nothing for this long is marked inactive. */
const SOURCE_TIMEOUT_MS = 2500;
const SWEEP_INTERVAL_MS = 1000;
/** Ring of last errors surfaced to the UI (oldest dropped). */
const MAX_ERRORS = 20;
/**
 * Minimum uptime before runtime addUniverse/removeUniverse is allowed.
 * On Windows, calling addMembership before the socket finished binding does
 * NOT throw synchronously: it emits an async EINVAL and silently skips the
 * join while sacn@4.6 still records the universe as subscribed (poisoned).
 * The constructor path (memberships joined inside the lib's bind callback)
 * and post-bind adds are both reliable — only the pre-bind window is unsafe.
 */
const BIND_GRACE_MS = 300;

// ─── Public state shapes ──────────────────────────────────

export interface SacnSourceState {
  cid: string;
  name: string;
  address: string;
  priority: number;
  active: boolean;
  lastSeenAt: number;
  packets: number;
  fps: number;
}

export interface SacnUniverseState {
  universe: number;
  enabled: boolean;
  listening: boolean;
  receiving: boolean;
  rxPackets: number;
  rxFps: number;
  rxPps: number;
  lastFrameAt: number;
  sources: SacnSourceState[];
}

export interface SacnReceiverStats {
  enabled: boolean;
  errors: string[];
  universes: SacnUniverseState[];
}

// ─── Internal per-source / per-universe tracking ──────────

interface SourceTrack {
  cid: string;
  name: string;
  address: string;
  priority: number;
  lastSeenAt: number;
  packets: number;
  fps: number;
  prevSweepPackets: number;
  frame: Uint8Array;
  hasFrame: boolean;
}

interface UniverseTrack {
  universe: number;
  enabled: boolean;
  listening: boolean;
  rxPackets: number;
  /** Frames carrying an actual payload (DMX data), distinct from raw packets
   *  (E1.31 also carries sync packets without payload). */
  rxFrames: number;
  rxFps: number;
  rxPps: number;
  prevSweepPackets: number;
  prevSweepFrames: number;
  lastFrameAt: number;
  lastSweepAt: number;
  sources: Map<string, SourceTrack>;
  merged: Uint8Array;
}

// ─── Manager ──────────────────────────────────────────────

export class SacnReceiverManager {
  private receiver: SacnReceiverHandle | null = null;
  private running = false;
  private desired = new Set<number>();
  /** Memberships known to be really joined (guards against Windows pre-bind poison). */
  private joined = new Set<number>();
  private startTime = 0;
  private tracks = new Map<number, UniverseTrack>();
  private errors: string[] = [];
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: { reuseAddr?: boolean; iface?: string; timeoutMs?: number } = {}) {}

  // ─── Lifecycle ──────────────────────────────────────────

  /** Open the UDP receiver. Safe when called with zero universes. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.errors = [];
    try {
      const sacnModule = require('sacn') as unknown as SacnReceiverModule;
      const universes = Array.from(this.desired);
      this.receiver = new sacnModule.Receiver({
        universes,
        reuseAddr: this.options.reuseAddr !== false,
        iface: this.options.iface,
      });
      this.receiver.on('packet', (packet) => this.handlePacket(packet));
      this.receiver.on('error', (err) => this.recordError(`sACN receiver: ${err.message}`));
      this.receiver.on('PacketCorruption', (err) => this.recordError(`sACN packet corruption: ${err.message}`));
      this.receiver.on('PacketOutOfOrder', (err) => this.recordError(`sACN packet out of order: ${err.message}`));
      // Constructor universes are joined inside the lib's bind callback
      // (reliable path) — mark them as joined immediately.
      this.joined.clear();
      for (const u of universes) {
        this.joined.add(u);
        const t = this.tracks.get(u);
        if (t) t.listening = true;
      }
      this.startTime = Date.now();
    } catch (err: any) {
      // No multicast stack / no interface / bind failure: degrade to
      // monitoring-off instead of crashing the engine.
      this.receiver = null;
      this.running = false;
      this.recordError(`sACN receiver init failed: ${err?.message || String(err)}`);
    }
    this.startSweep();
  }

  /** Close the socket, remove all listeners, stop the sweep. No leaks. */
  stop(): void {
    this.running = false;
    this.stopSweep();
    if (this.receiver) {
      try {
        this.receiver.close();
      } catch {
        /* already closed */
      }
      this.receiver.removeAllListeners();
      this.receiver = null;
    }
    for (const t of this.tracks.values()) t.listening = false;
    this.joined.clear();
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─── Universe management ────────────────────────────────

  /** Replace the set of universes to listen to (idempotent, live-safe). */
  setUniverses(universes: number[]): void {
    const next = new Set(universes);
    // Forget universes that are no longer desired (config removed / disabled).
    for (const u of Array.from(this.tracks.keys())) {
      if (!next.has(u)) this.tracks.delete(u);
    }
    for (const u of next) {
      if (!this.tracks.has(u)) {
        this.tracks.set(u, {
          universe: u,
          enabled: true,
          // `listening` is the desired state (membership is reconciled by
          // the sweep / grace-window timer); real packets only arrive once
          // the multicast join is live, so this is safe to optimise true.
          listening: true,
          rxPackets: 0,
          rxFrames: 0,
          rxFps: 0,
          rxPps: 0,
          prevSweepPackets: 0,
          prevSweepFrames: 0,
          lastFrameAt: 0,
          lastSweepAt: Date.now(),
          sources: new Map(),
          merged: new Uint8Array(DMX_CHANNELS),
        });
      }
    }
    this.desired = next;
    if (this.receiver) this.scheduleReconcile();
  }

  /**
   * Reconcile memberships, but never inside the pre-bind grace window:
   * addUniverse there is silently swallowed on Windows (async EINVAL) while
   * the lib still records the universe as subscribed — the join is lost
   * forever. After the grace window post-bind adds are reliable.
   */
  private scheduleReconcile(): void {
    const wait = Math.max(0, BIND_GRACE_MS - (Date.now() - this.startTime));
    if (wait > 0) {
      setTimeout(() => {
        if (this.running && this.receiver) this.reconcile();
      }, wait);
    } else {
      this.reconcile();
    }
  }

  /** True when at least one source on that universe sent within the timeout. */
  hasActiveSources(universe: number): boolean {
    const t = this.tracks.get(universe);
    if (!t) return false;
    const now = Date.now();
    for (const s of t.sources.values()) {
      if (now - s.lastSeenAt <= this.timeoutMs) return true;
    }
    return false;
  }

  /**
   * Latest priority-merged 512-channel frame for a universe, or null when
   * nothing fresh is being received (never inject stale data downstream).
   */
  getMergedFrame(universe: number): Uint8Array | null {
    const t = this.tracks.get(universe);
    if (!t || !this.hasActiveSources(universe)) return null;
    return t.merged;
  }

  getStats(): SacnReceiverStats {
    const now = Date.now();
    const universes = Array.from(this.tracks.values())
      .filter((t) => t.enabled)
      .map((t) => {
        let anyActive = false;
        const sources = Array.from(t.sources.values())
          .map((s) => {
            const active = now - s.lastSeenAt <= this.timeoutMs;
            if (active) anyActive = true;
            return {
              cid: s.cid,
              name: s.name,
              address: s.address,
              priority: s.priority,
              active,
              lastSeenAt: s.lastSeenAt,
              packets: s.packets,
              fps: Math.round(s.fps * 10) / 10,
            };
          })
          .sort((a, b) => b.priority - a.priority || Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
        return {
          universe: t.universe,
          enabled: t.enabled,
          listening: t.listening,
          receiving: anyActive,
          rxPackets: t.rxPackets,
          rxFps: Math.round(t.rxFps * 10) / 10,
          rxPps: Math.round(t.rxPps * 10) / 10,
          lastFrameAt: t.lastFrameAt,
          sources,
        };
      })
      .sort((a, b) => a.universe - b.universe);
    return { enabled: this.running, errors: [...this.errors], universes };
  }

  getErrors(): string[] {
    return [...this.errors];
  }

  // ─── Packet handling ─────────────────────────────────────

  private handlePacket(packet: SacnIncomingPacket): void {
    const t = this.tracks.get(packet.universe);
    if (!t || !t.listening) return; // not one of ours — drop silently
    const now = Date.now();
    t.rxPackets++;
    t.lastFrameAt = now;

    const key = packet.cid && packet.cid.length > 0
      ? packet.cid.toString('hex')
      : `${packet.sourceAddress}|${packet.sourceName}`;
    let src = t.sources.get(key);
    if (!src) {
      src = {
        cid: key,
        name: packet.sourceName || 'unknown',
        address: packet.sourceAddress || '',
        priority: packet.priority,
        lastSeenAt: 0,
        packets: 0,
        fps: 0,
        prevSweepPackets: 0,
        frame: new Uint8Array(DMX_CHANNELS),
        hasFrame: false,
      };
      t.sources.set(key, src);
    }
    src.packets++;
    src.lastSeenAt = now;
    src.priority = packet.priority;
    const buf = packet.payloadAsBuffer;
    if (buf) {
      t.rxFrames++;
      src.hasFrame = true;
      const len = Math.min(buf.length, DMX_CHANNELS);
      for (let i = 0; i < len; i++) src.frame[i] = buf[i];
    }
    this.recomputeMerged(t);
  }

  /** Priority-aware HTP: keep only the top-priority ACTIVE sources, then
   *  max per channel. A source that stopped transmitting (lastSeenAt older
   *  than the timeout) is excluded even when another source still lives —
   *  a dead console must not keep pinning stale values downstream (E1.31). */
  private recomputeMerged(t: UniverseTrack): void {
    const now = Date.now();
    let maxPriority = -1;
    for (const s of t.sources.values()) {
      if (s.hasFrame && now - s.lastSeenAt <= this.timeoutMs && s.priority > maxPriority) {
        maxPriority = s.priority;
      }
    }
    if (maxPriority < 0) return;
    const merged = new Uint8Array(DMX_CHANNELS);
    for (const s of t.sources.values()) {
      if (!s.hasFrame || s.priority !== maxPriority) continue;
      if (now - s.lastSeenAt > this.timeoutMs) continue;
      const frame = s.frame;
      for (let i = 0; i < DMX_CHANNELS; i++) {
        const v = frame[i];
        if (v > merged[i]) merged[i] = v;
      }
    }
    t.merged = merged;
  }

  // ─── Sweep (timeout marking + fps refresh + membership self-heal) ──

  private startSweep(): void {
    this.stopSweep();
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
  }

  private stopSweep(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  private sweep(): void {
    if (!this.running) return;
    this.reconcile();
    const now = Date.now();
    for (const t of this.tracks.values()) {
      const dtSec = Math.max((now - t.lastSweepAt) / 1000, 0.001);
      for (const s of t.sources.values()) {
        const inst = (s.packets - s.prevSweepPackets) / dtSec;
        s.fps = s.fps === 0 ? inst : s.fps * 0.7 + inst * 0.3;
        s.prevSweepPackets = s.packets;
      }
      const instU = (t.rxPackets - t.prevSweepPackets) / dtSec;
      t.rxPps = t.rxPps === 0 ? instU : t.rxPps * 0.7 + instU * 0.3;
      const instF = (t.rxFrames - t.prevSweepFrames) / dtSec;
      t.rxFps = t.rxFps === 0 ? instF : t.rxFps * 0.7 + instF * 0.3;
      t.prevSweepPackets = t.rxPackets;
      t.prevSweepFrames = t.rxFrames;
      t.lastSweepAt = now;
    }
  }

  /** Add/remove multicast memberships so `receiver.universes` == `desired`. */
  private reconcile(): void {
    const rx = this.receiver;
    if (!rx) return;
    try {
      for (const u of this.desired) {
        if (!rx.universes.includes(u) || !this.joined.has(u)) {
          rx.addUniverse(u);
          this.joined.add(u);
          const t = this.tracks.get(u);
          if (t) t.listening = true;
        }
      }
      for (const u of Array.from(rx.universes)) {
        if (!this.desired.has(u)) {
          rx.removeUniverse(u);
          this.joined.delete(u);
          const t = this.tracks.get(u);
          if (t) t.listening = false;
        }
      }
    } catch (err: any) {
      this.recordError(`sACN universe sync failed: ${err?.message || String(err)}`);
    }
  }

  private recordError(message: string): void {
    this.errors.push(message);
    if (this.errors.length > MAX_ERRORS) this.errors.shift();
  }

  private get timeoutMs(): number {
    return this.options.timeoutMs ?? SOURCE_TIMEOUT_MS;
  }
}
