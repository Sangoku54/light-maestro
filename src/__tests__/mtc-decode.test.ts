/**
 * Tests du lot #15 (MTC entrant) :
 *   - décodeur Quarter Frame / Full Frame (electron/midi/mtc.ts, module pur)
 *   - conversion timecode ↔ ms avec drop-frame (src/engine/mtc-markers.ts)
 *   - edge-trigger des marqueurs (evaluateMtcMarkers)
 *
 * Pattern du repo : fonctions pures, environnement node (vitest.config.ts).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { MtcDecoder, MTC_UNLOCK_TIMEOUT_MS } from '../../electron/midi/mtc';
import {
  timecodeToMs,
  msToTimecode,
  isValidTimecode,
  evaluateMtcMarkers,
  type MtcMarker,
} from '../engine/mtc-markers';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Construit un QF data byte : pièce `piece` (0-7) + `data` (4 bits). */
function qf(piece: number, data: number): number {
  return (piece & 0x0f) | ((data & 0x0f) << 4);
}

/** Envoie un cycle QF complet (8 pièces) pour une position donnée. */
function pushCycle(
  dec: MtcDecoder,
  h: number,
  m: number,
  s: number,
  f: number,
  rateBits: number
): boolean {
  const results: boolean[] = [];
  results.push(dec.pushQuarterFrame(qf(0, f & 0x0f)));
  results.push(dec.pushQuarterFrame(qf(1, (f >> 4) & 0x0f)));
  results.push(dec.pushQuarterFrame(qf(2, s & 0x0f)));
  results.push(dec.pushQuarterFrame(qf(3, (s >> 4) & 0x0f)));
  results.push(dec.pushQuarterFrame(qf(4, m & 0x0f)));
  results.push(dec.pushQuarterFrame(qf(5, (m >> 4) & 0x0f)));
  results.push(dec.pushQuarterFrame(qf(6, h & 0x0f)));
  // pièce 7 : nibble haut = [0, rate(1), rate(0), h(bit4)]
  const hoursHigh = (rateBits << 1) | ((h >> 4) & 0x01);
  results.push(dec.pushQuarterFrame(qf(7, hoursHigh)));
  return results[results.length - 1];
}

describe('MtcDecoder — Quarter Frame', () => {
  it('décode un cycle complet de 8 pièces (24 fps)', () => {
    const dec = new MtcDecoder();
    const completed = pushCycle(dec, 1, 2, 3, 4, 0); // 00:01:02:03:04 @24
    expect(completed).toBe(true);
    const st = dec.getState();
    expect(st.hours).toBe(1);
    expect(st.minutes).toBe(2);
    expect(st.seconds).toBe(3);
    expect(st.frames).toBe(4);
    expect(st.rate).toBe('24');
    expect(st.fps).toBe(24);
    expect(st.locked).toBe(true);
    expect(st.lastSource).toBe('qf');
  });

  it('décode le rate depuis la pièce 7 (25 / 30drop / 30)', () => {
    const dec = new MtcDecoder();
    pushCycle(dec, 0, 0, 0, 0, 1);
    expect(dec.getState().rate).toBe('25');
    pushCycle(dec, 0, 0, 0, 0, 2);
    expect(dec.getState().rate).toBe('30drop');
    pushCycle(dec, 0, 0, 0, 0, 3);
    expect(dec.getState().rate).toBe('30');
  });

  it('rollover : frame 29 → seconde suivante (30 fps)', () => {
    const dec = new MtcDecoder();
    pushCycle(dec, 0, 0, 0, 29, 3);
    pushCycle(dec, 0, 0, 1, 0, 3);
    const st = dec.getState();
    expect(st.seconds).toBe(1);
    expect(st.frames).toBe(0);
  });

  it('resync sur pièce 0 après un QF perdu (hors séquence ignoré)', () => {
    const dec = new MtcDecoder();
    // Pièces 0,1 puis perte → on reçoit 3 au lieu de 2 : ignoré
    dec.pushQuarterFrame(qf(0, 5));
    dec.pushQuarterFrame(qf(1, 0));
    expect(dec.pushQuarterFrame(qf(3, 0))).toBe(false); // hors séquence
    // La pièce 0 suivante re-synchronise le cycle
    expect(dec.pushQuarterFrame(qf(0, 7))).toBe(false);
    expect(dec.pushQuarterFrame(qf(1, 0))).toBe(false);
    expect(dec.pushQuarterFrame(qf(2, 0))).toBe(false);
    expect(dec.pushQuarterFrame(qf(3, 0))).toBe(false);
    expect(dec.pushQuarterFrame(qf(4, 0))).toBe(false);
    expect(dec.pushQuarterFrame(qf(5, 0))).toBe(false);
    expect(dec.pushQuarterFrame(qf(6, 0))).toBe(false);
    expect(dec.pushQuarterFrame(qf(7, 0))).toBe(true);
    expect(dec.getState().frames).toBe(7);
  });

  it('ignore les valeurs hors bornes (pièce > 7, byte > 0x7F)', () => {
    const dec = new MtcDecoder();
    expect(dec.pushQuarterFrame(0x8f)).toBe(false); // pièce 15
    expect(dec.pushQuarterFrame(0xff)).toBe(false);
    expect(dec.pushQuarterFrame(NaN)).toBe(false);
  });
});

describe('MtcDecoder — Full Frame', () => {
  const FF = (hh: number, mm: number, ss: number, ff: number) => [
    0xf0, 0x7f, 0x7f, 0x01, 0x01, hh, mm, ss, ff, 0xf7,
  ];

  it('décode un Full Frame : jump immédiat + lock + rate', () => {
    const dec = new MtcDecoder();
    // 0x40 = 0b01000000 → rate 10 = 29.97 DF, heures 0
    expect(dec.pushFullFrame(FF(0x40, 0x01, 0x03, 0x11))).toBe(true);
    const st = dec.getState();
    expect(st.hours).toBe(0);
    expect(st.minutes).toBe(1);
    expect(st.seconds).toBe(3);
    expect(st.frames).toBe(0x11);
    expect(st.rate).toBe('30drop');
    expect(st.locked).toBe(true);
    expect(st.lastSource).toBe('full-frame');
  });

  it('ignore un SysEx non-MTC (jamais de corruption)', () => {
    const dec = new MtcDecoder();
    expect(dec.pushFullFrame([0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7])).toBe(false);
    expect(dec.pushFullFrame([0xf0, 0x7f, 0x7f, 0x01, 0x02, 0x01, 0x01, 0x01, 0x01, 0xf7])).toBe(false); // user bits
    expect(dec.pushFullFrame([0xf0, 0x7f])).toBe(false); // trop court
    expect(dec.getState().locked).toBe(false);
  });

  it('accepte un Full Frame avec device id ≠ 0x7F (DAW/convertisseurs)', () => {
    const dec = new MtcDecoder();
    // F0 7F 01 01 01 60 00 00 00 F7 — device id 0x01
    expect(dec.pushFullFrame([0xf0, 0x7f, 0x01, 0x01, 0x01, 0x60, 0x00, 0x00, 0x00, 0xf7])).toBe(true);
    const st = dec.getState();
    expect(st.locked).toBe(true);
    expect(st.minutes).toBe(0);
    expect(st.rate).toBe('30');
  });

  it('clamp les heures 24+ à 23 (wrap des émetteurs)', () => {
    const dec = new MtcDecoder();
    // QF : heures 24 = 0x18 (rate 3 → octet 0x78 ; pièce 7 nibble 0b0110=6)
    pushCycle(dec, 24, 0, 0, 0, 3);
    expect(dec.getState().hours).toBe(23);
    // FF : hh = 0x78 (24 h, rate 30)
    const dec2 = new MtcDecoder();
    dec2.pushFullFrame([0xf0, 0x7f, 0x7f, 0x01, 0x01, 0x78, 0x00, 0x00, 0x00, 0xf7]);
    expect(dec2.getState().hours).toBe(23);
  });

  it('re-synchronise un flux QF en cours (mélange QF + FF)', () => {
    const dec = new MtcDecoder();
    pushCycle(dec, 0, 0, 0, 10, 3);
    expect(dec.getState().frames).toBe(10);
    // FF pendant le flux → saut de position
    dec.pushFullFrame(FF(0x60, 0x05, 0x00, 0x00)); // 00:05:00:00 @30
    const st = dec.getState();
    expect(st.minutes).toBe(5);
    expect(st.frames).toBe(0);
    expect(st.rate).toBe('30');
    // Le QF suivant (cycle neuf) reprend proprement
    pushCycle(dec, 0, 5, 0, 2, 3);
    expect(dec.getState().frames).toBe(2);
  });
});

describe('MtcDecoder — lock/unlock', () => {
  it('unlocked avant tout message, verrouillé après un cycle, unlocked après timeout', () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const dec = new MtcDecoder();
    expect(dec.getState().locked).toBe(false);
    pushCycle(dec, 0, 0, 0, 0, 3);
    expect(dec.getState().locked).toBe(true);
    // Silence au-delà du timeout → unlocked
    vi.spyOn(Date, 'now').mockReturnValue(now + MTC_UNLOCK_TIMEOUT_MS + 100);
    expect(dec.getState().locked).toBe(false);
    // Un nouveau QF re-verrouille
    pushCycle(dec, 0, 0, 0, 1, 3);
    expect(dec.getState().locked).toBe(true);
  });

  it('reset() remet tout à zéro', () => {
    const dec = new MtcDecoder();
    pushCycle(dec, 1, 2, 3, 4, 3);
    dec.reset();
    const st = dec.getState();
    expect(st.locked).toBe(false);
    expect(st.hours).toBe(0);
    expect(st.minutes).toBe(0);
  });
});

describe('mtc-markers — conversion timecode ↔ ms', () => {
  it('30 fps : 00:00:01:00 = 1000 ms', () => {
    expect(timecodeToMs(0, 0, 1, 0, '30')).toBe(1000);
  });

  it('25 fps : 00:00:01:00 = 1000 ms (25 frames)', () => {
    expect(timecodeToMs(0, 0, 1, 0, '25')).toBe(1000);
  });

  it('24 fps : 00:00:01:00 = 1000 ms (24 frames)', () => {
    expect(timecodeToMs(0, 0, 1, 0, '24')).toBe(1000);
  });

  it('30drop : les frames 0-1 de la minute 1 sont sautées (00:01:00:00 = 1800 frames → 60 s)', () => {
    // 30 fps NDF : 00:01:00:00 = 1800 frames = 60000 ms
    expect(timecodeToMs(0, 1, 0, 0, '30')).toBe(60000);
    // 29.97 DF : 2 compteurs retirés → 1798 frames
    expect(timecodeToMs(0, 1, 0, 0, '30drop')).toBe((1798 * 1000) / 30);
  });

  it('30drop : minute 10 (divisible par 10) → seules les 9 premières minutes sautent (18 compteurs)', () => {
    // 10 min @30 NDF = 18000 frames ; DF retire 2 compteurs/min × 9 min = 18
    expect(timecodeToMs(0, 10, 0, 0, '30drop')).toBe(((18000 - 18) * 1000) / 30);
  });

  it('msToTimecode est l’inverse de timecodeToMs (30 fps)', () => {
    const tc = msToTimecode(timecodeToMs(1, 23, 45, 17, '30'), '30');
    expect(tc).toEqual({ hours: 1, minutes: 23, seconds: 45, frames: 17 });
  });

  it('msToTimecode est l’inverse de timecodeToMs (drop-frame, minute 1)', () => {
    const ms = timecodeToMs(0, 1, 2, 3, '30drop');
    const tc = msToTimecode(ms, '30drop');
    expect(tc).toEqual({ hours: 0, minutes: 1, seconds: 2, frames: 3 });
  });

  it('round-trip exact sur toutes les minutes (frontières DF) — régression revue', () => {
    // Balayage : toutes les minutes 0-59, secondes 0-59, frames 0-29,
    // pour les TC LÉGAUX en DF (frames 0-1 de la 1re seconde des minutes
    // non ÷10 exclues).
    for (let m = 0; m < 60; m++) {
      for (let s = 0; s < 60; s++) {
        for (let f = 0; f < 30; f++) {
          if (m % 10 !== 0 && s === 0 && f < 2) continue;
          const ms = timecodeToMs(0, m, s, f, '30drop');
          const tc = msToTimecode(ms, '30drop');
          expect(tc).toEqual({ hours: 0, minutes: m, seconds: s, frames: f });
        }
      }
    }
  });

  it('round-trip exact en fin de journée (heure 23, minute 59) — fenêtre ±2 min', () => {
    for (let s = 0; s < 60; s += 7) {
      for (let f = 2; f < 30; f += 3) {
        const ms = timecodeToMs(23, 59, s, f, '30drop');
        const tc = msToTimecode(ms, '30drop');
        expect(tc).toEqual({ hours: 23, minutes: 59, seconds: s, frames: f });
      }
    }
  });

  it('isValidTimecode : rejette les frames 0-1 de la 1re seconde des minutes non ÷10 en DF', () => {
    expect(isValidTimecode(0, 1, 0, 0, '30drop')).toBe(false); // frame sautée
    expect(isValidTimecode(0, 1, 0, 1, '30drop')).toBe(false); // frame sautée
    expect(isValidTimecode(0, 1, 1, 0, '30drop')).toBe(true); // autre seconde OK
    expect(isValidTimecode(0, 1, 23, 0, '30drop')).toBe(true);
    expect(isValidTimecode(0, 10, 0, 0, '30drop')).toBe(true); // minute ÷10 OK
    expect(isValidTimecode(0, 1, 0, 0, '30')).toBe(true); // NDF : aucune restriction
    expect(isValidTimecode(24, 0, 0, 0, '30')).toBe(false); // heures hors bornes
  });
});

describe('mtc-markers — evaluateMtcMarkers (edge-trigger)', () => {
  const mk = (id: string, positionMs: number, enabled = true): MtcMarker => ({
    id,
    name: id,
    positionMs,
    rate: '30',
    target: { type: 'scene', sceneId: 's1' },
    action: 'play',
    enabled,
  });

  it('ne déclenche rien au premier état (prevMs null)', () => {
    const res = evaluateMtcMarkers(null, 1000, [mk('a', 500)], new Set());
    expect(res.toFire).toHaveLength(0);
    expect(res.reset).toBe(false);
  });

  it('déclenche le marqueur franchi dans la fenêtre (prevMs, currMs]', () => {
    const markers = [mk('a', 500), mk('b', 2000), mk('c', 3000)];
    const res = evaluateMtcMarkers(0, 2500, markers, new Set());
    expect(res.toFire.map((m) => m.id).sort()).toEqual(['a', 'b']);
  });

  it('anti-rebond : un marqueur déjà joué ne re-déclenche pas', () => {
    const res = evaluateMtcMarkers(0, 2500, [mk('a', 500)], new Set(['a']));
    expect(res.toFire).toHaveLength(0);
  });

  it('un marqueur désactivé ne se déclenche jamais', () => {
    const res = evaluateMtcMarkers(0, 2500, [mk('a', 500, false)], new Set());
    expect(res.toFire).toHaveLength(0);
  });

  it('jump arrière → reset (tout redevient jouable), rien ne déclenche ce tick', () => {
    const res = evaluateMtcMarkers(5000, 1000, [mk('a', 800)], new Set(['a']));
    expect(res.reset).toBe(true);
    expect(res.toFire).toHaveLength(0);
  });

  it('position exacte = currMs → déclenche (inclusif)', () => {
    const res = evaluateMtcMarkers(0, 1000, [mk('a', 1000)], new Set());
    expect(res.toFire.map((m) => m.id)).toEqual(['a']);
  });

  it('position égale à prevMs → ne déclenche pas (exclusif)', () => {
    const res = evaluateMtcMarkers(1000, 2000, [mk('a', 1000)], new Set());
    expect(res.toFire).toHaveLength(0);
  });
});
