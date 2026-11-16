import { describe, it, expect, beforeEach } from 'vitest';
import { OutputArbiter, outputArbiter, DEFAULT_SOURCES } from '../engine/output-arbiter';

/**
 * Deterministic HTP/LTP output arbitration — item #18 of the roadmap.
 *
 * Covers: HTP per-channel max, LTP priority, release fallback, mixed
 * HTP+LTP universes, default-buffer non-regression and write/replace
 * semantics.
 */

describe('OutputArbiter — HTP', () => {
  let arb: OutputArbiter;

  beforeEach(() => {
    arb = new OutputArbiter();
  });

  it('takes the per-channel maximum between HTP sources (max wins, never sums)', () => {
    arb.registerSource('a', 'htp', 10);
    arb.registerSource('b', 'htp', 5);
    arb.write('a', 0, { 1: 100, 2: 40 });
    arb.write('b', 0, { 1: 200, 3: 255 });

    const buf = arb.getBuffer(0);
    expect(buf[1]).toBe(200); // max(100, 200)
    expect(buf[2]).toBe(40);  // only source a
    expect(buf[3]).toBe(255); // only source b
  });

  it('replaces (does not merge) a source contribution on re-write', () => {
    arb.registerSource('a', 'htp', 10);
    arb.write('a', 0, { 1: 100, 2: 40 });
    arb.write('a', 0, { 2: 99 }); // second write drops channel 1

    const buf = arb.getBuffer(0);
    expect(buf[1]).toBeUndefined();
    expect(buf[2]).toBe(99);
  });
});

describe('OutputArbiter — LTP', () => {
  let arb: OutputArbiter;

  beforeEach(() => {
    arb = new OutputArbiter();
  });

  it('lets the most-priority LTP source win over HTP and lower LTP sources', () => {
    arb.registerSource('htp-a', 'htp', 10);
    arb.registerSource('ltp-low', 'ltp', 50);
    arb.registerSource('ltp-high', 'ltp', 90);

    arb.write('htp-a', 0, { 1: 255, 2: 200 });
    arb.write('ltp-low', 0, { 1: 10, 3: 77 });
    arb.write('ltp-high', 0, { 1: 42, 4: 128 });

    const buf = arb.getBuffer(0);
    expect(buf[1]).toBe(42);   // ltp-high beats ltp-low beats HTP
    expect(buf[2]).toBe(200);  // no LTP owns it → HTP value survives
    expect(buf[3]).toBe(77);   // owned by ltp-low only
    expect(buf[4]).toBe(128);  // owned by ltp-high only
  });

  it('release() lets channels fall back to the remaining sources', () => {
    arb.registerSource('htp-a', 'htp', 10);
    arb.registerSource('ltp-high', 'ltp', 90);

    arb.write('htp-a', 0, { 1: 255 });
    arb.write('ltp-high', 0, { 1: 0, 2: 60 });

    expect(arb.getBuffer(0)[1]).toBe(0); // LTP blocks HTP

    arb.release('ltp-high');
    const buf = arb.getBuffer(0);
    expect(buf[1]).toBe(255);            // HTP regains control
    expect(buf[2]).toBeUndefined();      // nobody owns it anymore
  });

  it('la preview scène (design-test 60) est masquée par le programmeur parké (85), visible après release', () => {
    // Cas réel : Target/faders parquent pan/tilt/couleur (programmer LTP 85),
    // puis la sélection d'une scène pousse design-test (LTP 60) — masquée
    // tant que le programmeur n'est pas vidé (ni hardware ni 3D, qui lit le
    // buffer arbitré). La sélection de scène vide donc le programmeur.
    arb.registerSource('programmer', 'ltp', 85);
    arb.write('design-test', 0, { 1: 255, 2: 128 });
    expect(arb.getBuffer(0)[1]).toBe(255); // scène visible seule
    arb.write('programmer', 0, { 1: 100, 2: 100 });
    const masked = arb.getBuffer(0);
    expect(masked[1]).toBe(100); // programmeur gagne → scène invisible
    expect(masked[2]).toBe(100);
    arb.release('programmer'); // = useProgrammerStore.clear() à la sélection
    const shown = arb.getBuffer(0);
    expect(shown[1]).toBe(255); // la scène réapparaît
    expect(shown[2]).toBe(128);
  });

  it('release() can target a single universe only', () => {
    arb.registerSource('ltp-high', 'ltp', 90);
    arb.write('ltp-high', 0, { 1: 0 });
    arb.write('ltp-high', 1, { 2: 0 });

    arb.release('ltp-high', 0);
    expect(arb.getBuffer(0)[1]).toBeUndefined();
    expect(arb.getBuffer(1)[2]).toBe(0); // still owned on universe 1
  });
});

describe('OutputArbiter — mixed HTP+LTP on the same universe', () => {
  let arb: OutputArbiter;

  beforeEach(() => {
    arb = new OutputArbiter();
  });

  it('blends sources deterministically regardless of write order', () => {
    arb.registerSource('quickshow', 'htp', 40);
    arb.registerSource('rgb-matrix', 'htp', 30);
    arb.registerSource('vc', 'ltp', 80);
    arb.registerSource('simple-desk', 'ltp', 100);

    // Write order 1
    arb.write('quickshow', 0, { 1: 200, 2: 150, 5: 100 });
    arb.write('rgb-matrix', 0, { 1: 120, 3: 255 });
    arb.write('vc', 0, { 2: 0, 4: 128 });
    arb.write('simple-desk', 0, { 4: 255, 6: 1 });

    const first = arb.getBuffer(0);

    // Re-write in the reverse order → same result (determinism)
    arb = new OutputArbiter();
    arb.registerSource('quickshow', 'htp', 40);
    arb.registerSource('rgb-matrix', 'htp', 30);
    arb.registerSource('vc', 'ltp', 80);
    arb.registerSource('simple-desk', 'ltp', 100);
    arb.write('simple-desk', 0, { 4: 255, 6: 1 });
    arb.write('vc', 0, { 2: 0, 4: 128 });
    arb.write('rgb-matrix', 0, { 1: 120, 3: 255 });
    arb.write('quickshow', 0, { 1: 200, 2: 150, 5: 100 });

    const second = arb.getBuffer(0);
    expect(first).toEqual(second);

    expect(first[1]).toBe(200);  // HTP max(200, 120)
    expect(first[2]).toBe(0);    // vc LTP blocks quickshow
    expect(first[3]).toBe(255);  // rgb-matrix HTP alone
    expect(first[4]).toBe(255);  // simple-desk LTP beats vc LTP
    expect(first[5]).toBe(100);  // quickshow HTP alone
    expect(first[6]).toBe(1);    // simple-desk LTP alone
  });
});

describe('OutputArbiter — default buffer & edge cases (non-regression)', () => {
  it('returns an empty buffer for an unknown universe and ignores unknown sources', () => {
    const buf = outputArbiter.getBuffer(99);
    expect(buf).toEqual({});

    // Unknown source id: must not corrupt the output
    outputArbiter.write('does-not-exist', 0, { 1: 255 });
    expect(outputArbiter.getBuffer(0)).toEqual({});
  });

  it('clamps, rounds and filters invalid channel values on write', () => {
    const arb = new OutputArbiter();
    arb.registerSource('a', 'htp', 10);
    arb.write('a', 0, {
      1: 300,   // clamp → 255
      2: -5,    // clamp → 0
      3: 12.6,  // round → 13
      4: NaN,   // filtered → 0
    });
    const buf = arb.getBuffer(0);
    expect(buf[1]).toBe(255);
    expect(buf[2]).toBe(0);
    expect(buf[3]).toBe(13);
    expect(buf[4]).toBe(0);
  });

  it('has every canonical source registered by default with the documented priorities', () => {
    // Simple Desk is the top control source; RGB matrix is an explicit
    // operator activation → LTP (cellules éteintes gagnent sur l'autoscript)
    expect(outputArbiter.isRegistered('simple-desk')).toBe(true);
    expect(outputArbiter.isRegistered('rgb-matrix')).toBe(true);
    expect(DEFAULT_SOURCES['simple-desk'].mode).toBe('ltp');
    expect(DEFAULT_SOURCES['simple-desk'].priority).toBeGreaterThan(DEFAULT_SOURCES['vc'].priority);
    expect(DEFAULT_SOURCES['vc'].priority).toBeGreaterThan(DEFAULT_SOURCES['quickshow'].priority);
    expect(DEFAULT_SOURCES['quickshow'].mode).toBe('htp');
    expect(DEFAULT_SOURCES['rgb-matrix'].mode).toBe('ltp');
    expect(DEFAULT_SOURCES['rgb-matrix'].priority).toBeGreaterThan(DEFAULT_SOURCES['quickshow'].priority);
    expect(DEFAULT_SOURCES['rgb-matrix'].priority).toBeLessThan(DEFAULT_SOURCES['vc'].priority);
  });

  it('matrice RGB LTP : une cellule éteinte (dimmer 0) reste éteinte malgré un preset actif', () => {
    const arb = new OutputArbiter();
    // Le preset allume la fixture (dimmer 255, HTP 45)
    arb.write('song-preset', 0, { 1: 255 });
    // La matrice éteint cette cellule (dimmer 0, LTP 55)
    arb.write('rgb-matrix', 0, { 1: 0 });
    const buf = arb.getBuffer(0) as Record<number, number>;
    expect(buf[1]).toBe(0);
    // Release de la matrice → le preset reprend la main
    arb.release('rgb-matrix', 0);
    expect((arb.getBuffer(0) as Record<number, number>)[1]).toBe(255);
  });

  it('keeps zero values owned by an LTP source (blackout semantics)', () => {
    const arb = new OutputArbiter();
    arb.registerSource('quickshow', 'htp', 40);
    arb.registerSource('vc', 'ltp', 80);

    arb.write('quickshow', 0, { 1: 255 });
    arb.write('vc', 0, { 1: 0 }); // VC blackout

    expect(arb.getBuffer(0)[1]).toBe(0); // LTP 0 blocks HTP 255
  });
});
