/**
 * Output Arbiter — deterministic single HTP/LTP priority arbitration
 * between every internal DMX source (QuickShow engine, RGB matrix,
 * Virtual Console, Simple Desk, song presets, design tools, chasers).
 *
 * Replaces the non-deterministic "last writer wins" behaviour: every source
 * writes INTO the arbiter (per universe, per channel) and the final buffer
 * is computed from a fixed priority table.
 *
 * Semantics
 * ─────────
 *  - LTP (Latest Takes Precedence) sources are "control" sources (Simple
 *    Desk, VC, tests). On any channel they own, their value wins over every
 *    less-priority source — including HTP sources. They keep control until
 *    they write something else or are released.
 *  - HTP (Highest Takes Precedence) sources are "light" sources (QuickShow
 *    engine, RGB matrix, song presets). On channels no LTP source owns,
 *    the maximum value of all HTP sources wins.
 *  - priority: a HIGHER number wins over a lower one. Ties are broken by
 *    registration order (first registered wins).
 *
 * This module is pure (no Electron / window / React dependencies) so it can
 * be unit-tested in isolation.
 */

export type ArbiterMode = 'htp' | 'ltp';

export interface ArbiterSourceSpec {
  mode: ArbiterMode;
  priority: number;
}

/** Canonical sources registered on construction (id → spec). */
export const DEFAULT_SOURCES: Record<string, ArbiterSourceSpec> = {
  // Control (LTP) — operator-driven, must always win
  'simple-desk': { mode: 'ltp', priority: 100 },
  'fixture-test': { mode: 'ltp', priority: 90 },
  'vc': { mode: 'ltp', priority: 80 },
  'design-efx': { mode: 'ltp', priority: 70 },
  'design-test': { mode: 'ltp', priority: 60 },
  'fixture-onoff': { mode: 'ltp', priority: 60 },
  'default': { mode: 'ltp', priority: 50 },
  // Light (HTP) — content sources that blend together
  'song-preset': { mode: 'htp', priority: 45 },
  'quickshow': { mode: 'htp', priority: 40 },
  'show-manager': { mode: 'htp', priority: 35 },
  'rgb-matrix': { mode: 'htp', priority: 30 },
};

interface RegisteredSource extends ArbiterSourceSpec {
  seq: number;
}

function clampChannel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(255, Math.round(value)));
}

export class OutputArbiter {
  private _sources = new Map<string, RegisteredSource>();
  /** universe → sourceId → channel values (already clamped). */
  private _values = new Map<number, Map<string, Record<number, number>>>();
  private _seq = 0;

  constructor() {
    for (const [id, spec] of Object.entries(DEFAULT_SOURCES)) {
      this.registerSource(id, spec.mode, spec.priority);
    }
  }

  /** Register (or re-register) a source. Re-registering keeps its values. */
  registerSource(id: string, mode: ArbiterMode, priority: number): void {
    this._sources.set(id, { mode, priority, seq: this._seq++ });
  }

  unregisterSource(id: string): void {
    this._sources.delete(id);
    for (const uni of this._values.values()) uni.delete(id);
  }

  isRegistered(id: string): boolean {
    return this._sources.has(id);
  }

  /**
   * Store a source's channel values for a universe (replaces the source's
   * previous contribution on that universe — it does NOT merge).
   * Unknown sources are ignored so a typo never corrupts the output.
   * Returns true when the write was accepted.
   */
  write(id: string, universe: number, channels: Record<number, number>): boolean {
    const spec = this._sources.get(id);
    if (!spec) return false;
    const clean: Record<number, number> = {};
    for (const [chStr, v] of Object.entries(channels)) {
      const ch = Number(chStr);
      if (!Number.isFinite(ch) || ch < 0) continue;
      clean[ch] = clampChannel(Number(v));
    }
    let uni = this._values.get(universe);
    if (!uni) {
      uni = new Map<string, Record<number, number>>();
      this._values.set(universe, uni);
    }
    uni.set(id, clean);
    return true;
  }

  /**
   * Remove a source's contribution (all universes, or only `universe`).
   * Once released, the channels it owned fall back to the remaining sources.
   */
  release(id: string, universe?: number): void {
    if (universe !== undefined) {
      this._values.get(universe)?.delete(id);
    } else {
      for (const uni of this._values.values()) uni.delete(id);
    }
  }

  /** Last values written by `id` on `universe` (undefined when none). */
  getSourceValues(id: string, universe: number): Record<number, number> | undefined {
    return this._values.get(universe)?.get(id);
  }

  /**
   * Compute the final combined buffer for a universe.
   * Deterministic: LTP sources (highest priority first) take their channels,
   * HTP sources contribute their per-channel maximum everywhere else.
   */
  getBuffer(universe: number): Record<number, number> {
    const uni = this._values.get(universe);
    if (!uni || uni.size === 0) return {};

    const sorted: Array<{ id: string; spec: RegisteredSource; vals: Record<number, number> }> = [];
    for (const [id, vals] of uni) {
      const spec = this._sources.get(id);
      if (!spec) continue;
      sorted.push({ id, spec, vals });
    }
    sorted.sort((a, b) => (b.spec.priority - a.spec.priority) || (a.spec.seq - b.spec.seq));

    const buffer: Record<number, number> = {};
    const taken = new Set<number>();
    const htp = new Map<number, number>();

    for (const { spec, vals } of sorted) {
      if (spec.mode === 'ltp') {
        for (const chStr of Object.keys(vals)) {
          const ch = Number(chStr);
          if (taken.has(ch)) continue;
          buffer[ch] = vals[ch];
          taken.add(ch);
        }
      } else {
        for (const chStr of Object.keys(vals)) {
          const ch = Number(chStr);
          if (taken.has(ch)) continue;
          const prev = htp.get(ch);
          htp.set(ch, prev === undefined ? vals[ch] : Math.max(prev, vals[ch]));
        }
      }
    }

    for (const [ch, v] of htp) {
      if (!taken.has(ch)) buffer[ch] = v;
    }
    return buffer;
  }

  /** All universes that currently hold at least one source contribution. */
  getActiveUniverses(): number[] {
    return [...this._values.keys()];
  }
}

/** Singleton used by the renderer bridge (see src/utils/dmx-bridge.ts). */
export const outputArbiter = new OutputArbiter();
