/**
 * DMX Bridge — central arbitration + push point for every DMX source.
 *
 * Every source (QuickShow engine, RGB matrix, Virtual Console, Simple Desk,
 * song presets, design tools…) writes INTO the output arbiter through
 * `dmxBridge.write(sourceId, universe, channels)`. The bridge then computes
 * the final arbitrated buffer per universe and:
 *   1. stores it in the module-level cache (Stage3D reads it)
 *   2. notifies listeners
 *   3. pushes it to the real DMX hardware (unless dry-run)
 *
 * `push(universe, channels, sourceId?)` is kept for the playback engine:
 * it defaults to the `quickshow` source so existing call sites stay valid.
 */
import { outputArbiter } from '../engine/output-arbiter';
import { recordOutputTick } from './latency-meter';

type DmxListener = (universe: number, channels: Record<number, number>) => void;

const listeners = new Set<DmxListener>();

/** Module-level cache: universe → channel values (DMX address → 0-255) */
const _channelCache = new Map<number, Record<number, number>>();

/** Dry-run flag: when true, the arbitrated buffer is computed and cached but
 *  never sent to the hardware (used by QuickShow's dry-run toggle). */
let _dryRun = false;

/** Pending transient-release timers (sourceId → timeout). */
const transientTimers = new Map<string, ReturnType<typeof setTimeout>>();

function cancelTransient(sourceId: string) {
  const t = transientTimers.get(sourceId);
  if (t) {
    clearTimeout(t);
    transientTimers.delete(sourceId);
  }
}

function getDmxApi(): any {
  return typeof window !== 'undefined' ? (window as any).lightMaestro?.dmx : null;
}

function pushBufferToConsumers(universe: number, buffer: Record<number, number>) {
  // Update cache immediately for Stage3D's render loop to pick up
  _channelCache.set(universe, buffer);
  // Also notify listeners (for immediate push if needed)
  for (const fn of listeners) {
    try { fn(universe, buffer); } catch (_) { /* ignore */ }
  }
}

function flushToHardware(universe: number, buffer: Record<number, number>) {
  if (_dryRun) return;
  const api = getDmxApi();
  if (!api) return;
  api.setChannels(universe, buffer).catch(() => {});
}

export const dmxBridge = {
  /**
   * Arbitrated write from any source. The arbitrated buffer for `universe`
   * is recomputed and pushed to the cache, listeners and hardware.
   */
  write(sourceId: string, universe: number, channels: Record<number, number>) {
    if (!outputArbiter.write(sourceId, universe, channels)) return;
    // A persistent write cancels any pending transient release for this source
    // (e.g. the operator re-triggers VC within the transient window).
    cancelTransient(sourceId);
    const buffer = outputArbiter.getBuffer(universe);
    pushBufferToConsumers(universe, buffer);
    // Latency meter: timestamp the moment the frame actually leaves the
    // renderer pipeline (right before the IPC send).
    recordOutputTick();
    flushToHardware(universe, buffer);
  },

  /**
   * Write then automatically release the source after `ms` (default 2 s).
   * Used by "stop/zero" paths (VC stop, Simple Desk reset, design-panel
   * blackout, fixture off) so the hardware receives the zeros — flushing
   * the current output — while control falls back to the playback engine
   * shortly after, instead of pinning the source forever (LTP persistence).
   * Any regular write() from the same source cancels the pending release.
   */
  writeTransient(sourceId: string, universe: number, channels: Record<number, number>, ms: number = 2000) {
    if (!outputArbiter.write(sourceId, universe, channels)) return;
    const buffer = outputArbiter.getBuffer(universe);
    pushBufferToConsumers(universe, buffer);
    recordOutputTick();
    flushToHardware(universe, buffer);
    cancelTransient(sourceId);
    transientTimers.set(sourceId, setTimeout(() => {
      transientTimers.delete(sourceId);
      this.release(sourceId);
    }, ms));
  },

  /**
   * Called by the playback engine (dmx-playback.ts) after computing DMX
   * values for the current frame. `sourceId` defaults to the QuickShow
   * engine; SongPresetPlayer passes 'song-preset' so its own zeroing /
   * release logic stays scoped to its source.
   */
  push(universe: number, channels: Record<number, number>, sourceId: string = 'quickshow') {
    this.write(sourceId, universe, channels);
  },

  /**
   * Write while MERGING with the source's previous values on that universe
   * (per-channel update instead of replace-all). Needed by incremental
   * single-channel callers (fixture test steps, VC sliders) so writing
   * channel A then channel B keeps both.
   */
  writeMerge(sourceId: string, universe: number, channels: Record<number, number>) {
    const prev = outputArbiter.getSourceValues(sourceId, universe) ?? {};
    const merged: Record<number, number> = { ...prev };
    for (const [chStr, v] of Object.entries(channels)) {
      merged[Number(chStr)] = v;
    }
    this.write(sourceId, universe, merged);
  },

  /** Remove a source's contribution (all universes, or only `universe`).
   *  Affected universes are recomputed and re-flushed so the hardware and
   *  the 3D cache follow the arbitration (control returns to the engine). */
  release(sourceId: string, universe?: number) {
    const affected = universe !== undefined
      ? [universe]
      : outputArbiter.getActiveUniverses();
    outputArbiter.release(sourceId, universe);
    for (const u of affected) {
      const buffer = outputArbiter.getBuffer(u);
      pushBufferToConsumers(u, buffer);
      recordOutputTick();
      flushToHardware(u, buffer);
    }
  },

  /** Toggle hardware output without stopping computation (QuickShow dry-run). */
  setDryRun(dryRun: boolean) {
    _dryRun = dryRun;
  },

  isDryRun(): boolean {
    return _dryRun;
  },

  /** Register a custom source (mode 'htp' | 'ltp', higher priority wins). */
  registerSource(id: string, mode: 'htp' | 'ltp', priority: number) {
    outputArbiter.registerSource(id, mode, priority);
  },

  /**
   * Push a single channel change from the design panel (3D → Live DMX).
   * Written through the 'design-test' source so other sources keep their
   * priority; merges with the source's previous values so consecutive
   * single-channel pushes do not drop each other.
   */
  pushDesignChannel(universe: number, channelAddr: number, value: number) {
    const clamped = Math.max(0, Math.min(255, Math.round(value)));
    const prev = outputArbiter.getSourceValues('design-test', universe) ?? {};
    const merged: Record<number, number> = { ...prev, [channelAddr]: clamped };
    this.write('design-test', universe, merged);
  },

  /** Clear all cached channel data and release every registered source.
   *  Use on app mount / view re-open to guarantee a clean (all-zeros) DMX state. */
  clearAll() {
    _channelCache.clear();
    outputArbiter.clearAll();
    for (const t of transientTimers.values()) clearTimeout(t);
    transientTimers.clear();
  },

  /** Stage3D reads the latest channel values for a universe */
  getChannels(universe: number): Record<number, number> | undefined {
    return _channelCache.get(universe);
  },

  /** Called by Stage3D to receive DMX pushes */
  onPush(fn: DmxListener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
