import { describe, it, expect } from 'vitest';
import { resolvePlaybackTime } from '../components/SongPresetPlayer';

describe('resolvePlaybackTime (playback clock)', () => {
  const startWall = 10_000; // arbitrary epoch ms

  it('advances on the virtual wall-clock when there is no playable audio', () => {
    // No audio at all → the show MUST still advance (the bug that froze
    // playback at t=0 when the preset audio did not play).
    const t0 = resolvePlaybackTime(false, true, 0, startWall, startWall + 2_500);
    const t1 = resolvePlaybackTime(false, true, 0, startWall, startWall + 8_000);
    expect(t1).toBeGreaterThan(t0);
    expect(t1).toBeCloseTo(8.0, 5);
  });

  it('still advances while the audio element exists but has not started playing', () => {
    // Audio present but paused (decoding / autoplay blocked) → virtual clock.
    const t = resolvePlaybackTime(false, true, 0, startWall, startWall + 3_000);
    expect(t).toBeCloseTo(3.0, 5);
  });

  it('follows the audio element once it actually plays', () => {
    const t = resolvePlaybackTime(true, false, 12.34, startWall, startWall + 99_000);
    expect(t).toBe(12.34);
  });

  it('does not go backwards when audio stalls mid-show', () => {
    // Audio was playing then stalls (paused) → fall back to virtual clock,
    // which is anchored at mount, so time only moves forward.
    const t = resolvePlaybackTime(true, true, 2.0, startWall, startWall + 15_000);
    expect(t).toBeCloseTo(15.0, 5);
    expect(t).toBeGreaterThan(2.0);
  });
});
