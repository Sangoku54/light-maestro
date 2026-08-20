import { describe, it, expect } from 'vitest';
import { halfDegToDmxOffset, clampPanToStage, clampTiltToStage } from '../engine/dmx-movement';

describe('halfDegToDmxOffset', () => {
  it('maps full sweep to 128 (DMX full half-amplitude)', () => {
    expect(halfDegToDmxOffset(270, 'pan')).toBe(128);
    expect(halfDegToDmxOffset(90, 'tilt')).toBe(128);
  });

  it('maps half sweep to ~64', () => {
    expect(halfDegToDmxOffset(135, 'pan')).toBe(64);
    expect(halfDegToDmxOffset(45, 'tilt')).toBe(64);
  });

  it('maps 0 to 0 and clamps out-of-range inputs', () => {
    expect(halfDegToDmxOffset(0, 'pan')).toBe(0);
    expect(halfDegToDmxOffset(999, 'pan')).toBe(128);
    expect(halfDegToDmxOffset(-10, 'tilt')).toBe(0);
  });
});

describe('stage clamp (centered on 128)', () => {
  it('clampPanToStage keeps center 128 within bounds', () => {
    // x=0.5 → full range; center stays 128
    expect(clampPanToStage(128, 0.5)).toBe(128);
    // x=0 → pan only goes right of center (128..255)
    expect(clampPanToStage(0, 0)).toBe(128);
    expect(clampPanToStage(255, 0)).toBe(255);
  });

  it('clampTiltToStage clamps within a sane tilt range', () => {
    const v = clampTiltToStage(128, 0.3);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(255);
  });
});
