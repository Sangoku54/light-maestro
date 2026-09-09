import { describe, it, expect } from 'vitest';
import { halfDegToDmxOffset, zeroDmxOffset, clampPanToStage, clampTiltToStage } from '../engine/dmx-movement';

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

describe('zeroDmxOffset (point zéro / tare signé)', () => {
  it('0 ou non renseigné → 0', () => {
    expect(zeroDmxOffset(0, 'pan')).toBe(0);
    expect(zeroDmxOffset(undefined, 'tilt')).toBe(0);
    expect(zeroDmxOffset(null as unknown as number | undefined, 'pan')).toBe(0);
  });

it('même ratio que halfDegToDmxOffset mais signé', () => {
    expect(zeroDmxOffset(45, 'pan')).toBe(21); // 45/270*128 ~ 21.3
    expect(zeroDmxOffset(-45, 'pan')).toBe(-21);
    expect(zeroDmxOffset(45, 'tilt')).toBe(64); // 45/90*128
    expect(zeroDmxOffset(-90, 'tilt')).toBe(-127); // -90*255/180 = -127.5 → -127
    expect(zeroDmxOffset(27, 'pan')).toBe(13); // 27/270*128 ~ 12.8
  });

  it('round-trip capture : le centre taré se redécode à la position capturée', () => {
    // Fonction de décodage 3D = pure lecture des bytes DMX (le zéro ne vit QUE
    // dans le centre du mouvement) : après capture à c, le centre moteur
    // (128 + zeroDmx) doit redonner ≈ c degrés au rendu.
    // Scale 3D : pan = ((byte-128)/255)*540 ; tilt = ((byte-128)/255)*180.
    for (const c of [140, 160, 175, 100, 90, 200]) {
      const zeroPan = Math.round(((c - 128) / 255) * 540);
      const center = 128 + zeroDmxOffset(zeroPan, 'pan');
      const decoded = ((center - 128) / 255) * 540;
      expect(Math.round(decoded)).toBeCloseTo(zeroPan, 0); // WYSIWYG : pas de double comptage
    }
    for (const c of [140, 160, 175, 100, 90, 200]) {
      const zeroTilt = Math.round(((c - 128) / 255) * 180);
      const center = 128 + zeroDmxOffset(zeroTilt, 'tilt');
      const decoded = ((center - 128) / 255) * 180;
      expect(Math.round(decoded)).toBeCloseTo(zeroTilt, 0);
    }
  });

  it('invariant capture : la pose capturée reste en place (zéro visuel + centre moteur)', () => {
    // Schéma final :
    //  - zeroPan/zeroTilt = offset VISUEL permanent (rendu 3D : f(byte)+zero) ;
    //  - centerPan/centerTilt = direction du byte capturé (centre du mouvement) ;
    //  - le moteur écrit 128 + zeroDmxOffset(centerDeg) ; le rendu de ce byte =
    //    f(byte) + zero = direction rendue AVANT capture (aucun saut, aucun double).
    const render = (b: number, zeroDeg: number, axis: 'pan' | 'tilt') => {
      const span = axis === 'pan' ? 540 : 180;
      return ((b - 128) / 255) * span + zeroDeg;
    };
    for (const [b, zero] of [[150, 35], [140, -20], [200, 60], [90, 0], [110, -45]] as const) {
      const centerPan = Math.round(((b - 128) / 255) * 540);
      const centerByte = 128 + zeroDmxOffset(centerPan, 'pan');
      const dirCapture = render(b, zero, 'pan');
      const dirCenter = render(centerByte, zero, 'pan');
      expect(Math.abs(dirCenter - dirCapture)).toBeLessThan(0.8); // pas de saut à la capture
    }
    for (const [b, zero] of [[150, 10], [140, -30], [90, 5], [200, 25], [110, -15]] as const) {
      const centerTilt = Math.round(((b - 128) / 255) * 180);
      const centerByte = 128 + zeroDmxOffset(centerTilt, 'tilt');
      const dirCapture = render(b, zero, 'tilt');
      const dirCenter = render(centerByte, zero, 'tilt');
      expect(Math.abs(dirCenter - dirCapture)).toBeLessThan(0.8);
    }
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
