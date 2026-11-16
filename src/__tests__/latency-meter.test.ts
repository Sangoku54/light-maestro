import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordAudioTick,
  recordOutputTick,
  getLatencyMs,
  getStats,
  reset,
  WINDOW_SIZE,
  MAX_SAMPLE_MS,
} from '../utils/latency-meter';

describe('latency-meter (pipeline renderer audio→DMX)', () => {
  beforeEach(() => reset());

  it('returns null before any sample', () => {
    expect(getLatencyMs()).toBeNull();
    expect(getStats()).toEqual({ min: 0, max: 0, avg: 0, count: 0 });
  });

  it('measures the gap between the audio tick and the output tick of the same cycle', () => {
    recordAudioTick(1_000);
    recordOutputTick(1_016); // 16 ms later — same rAF cycle
    expect(getLatencyMs()).toBe(16);
    expect(getStats()).toEqual({ min: 16, max: 16, avg: 16, count: 1 });
  });

  it('consumes one pending audio tick per output tick (first output of the cycle wins)', () => {
    recordAudioTick(2_000);
    recordOutputTick(2_010); // cycle 1 → sample 10 ms
    recordOutputTick(2_012); // same cycle, no pending tick → ignored
    expect(getStats().count).toBe(1);
    expect(getLatencyMs()).toBe(10);
  });

  it('ignores output ticks with no pending audio tick (e.g. manual design-panel pushes)', () => {
    recordOutputTick(3_000);
    expect(getStats().count).toBe(0);
    expect(getLatencyMs()).toBeNull();
  });

  it('discards out-of-range gaps (no same-cycle correlation)', () => {
    recordAudioTick(4_000);
    recordOutputTick(4_000 + MAX_SAMPLE_MS + 1); // stale — not the same cycle
    expect(getLatencyMs()).toBeNull();
  });

  it('computes a rolling average over the last WINDOW_SIZE samples', () => {
    const start = 10_000;
    for (let i = 0; i < WINDOW_SIZE + 5; i++) {
      recordAudioTick(start + i * 20);
      recordOutputTick(start + i * 20 + 10); // 10 ms each
    }
    expect(getStats().count).toBe(WINDOW_SIZE);
    expect(getLatencyMs()).toBe(10);
  });

  it('getStats reports min/max/avg/count', () => {
    recordAudioTick(5_000);
    recordOutputTick(5_010);
    recordAudioTick(6_000);
    recordOutputTick(6_040);
    recordAudioTick(7_000);
    recordOutputTick(7_020);
    expect(getStats()).toEqual({ min: 10, max: 40, avg: 70 / 3, count: 3 });
  });

  it('reset clears everything', () => {
    recordAudioTick(8_000);
    recordOutputTick(8_005);
    expect(getStats().count).toBe(1);
    reset();
    expect(getLatencyMs()).toBeNull();
    expect(getStats().count).toBe(0);
    // A stale pending tick must not survive reset either
    recordOutputTick(9_000);
    expect(getStats().count).toBe(0);
  });
});
