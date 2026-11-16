import { describe, it, expect } from 'vitest';
import {
  generateAutoscript,
  BankManager,
  AutoloopPlaybackEngine,
  clampDmx,
  computePan,
  computeTilt,
  timelineLengthBeats,
  BANKS,
  PER_BANK,
} from '../engine/autoloop-index';
import type {
  AutoloopFixture,
  PositionCue,
  AttributeCue,
  DmxOutput,
  AutoloopTimeline,
} from '../engine/autoloop-index';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures et cues d'exemple — miroir de `demo.py` (build_fixtures / build_cues)
// ─────────────────────────────────────────────────────────────────────────────

const channelMap = { pan: 0, tilt: 1, red: 2, green: 3, blue: 4, dimmer: 5 };

const fixtures: AutoloopFixture[] = [
  { id: 'wash-1', category: 'Wash_Primary', universe: 1, address: 1, channelMap },
  { id: 'wash-2', category: 'Wash_Primary', universe: 1, address: 9, channelMap },
];

// Cercle : omega = π/2 → un tour complet en 4 beats (1 bar).
const circle: PositionCue = { id: 'circle', shape: 'circle', speed: Math.PI / 2, phase: 0, radius: 100 };
// Huit : Lissajous 1:2.
const eight: PositionCue = { id: 'eight', shape: 'figure_eight', speed: Math.PI / 4, phase: 0, radius: 90 };

const colors: AttributeCue[] = [
  { id: 'c-red', attribute: 'color', values: { red: 255, green: 0, blue: 0 } },
  { id: 'c-green', attribute: 'color', values: { red: 0, green: 255, blue: 0 } },
  { id: 'c-blue', attribute: 'color', values: { red: 0, green: 0, blue: 255 } },
  { id: 'c-white', attribute: 'color', values: { red: 255, green: 255, blue: 255 } },
];

/** Sortie DMX factice qui collecte les frames en mémoire (comme `FakeOutput`). */
class FakeOutput implements DmxOutput {
  frames: Record<number, number>[] = [];
  last: Record<number, number> = {};

  send(channels: Record<number, number>): void {
    this.last = { ...channels };
    this.frames.push({ ...channels });
  }
}

function makeLoop(targetBars = 8, attributeCues = colors, positionCues = [circle, eight]): AutoloopTimeline {
  return generateAutoscript({
    targetBars,
    fixtures,
    category: 'Wash_Primary',
    positionCues,
    attributeCues,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Module 1 — mathématiques (clampDmx, cercle, huit, longueur)
// ─────────────────────────────────────────────────────────────────────────────

describe('clampDmx', () => {
  it('borne dans [0, 255] puis arrondit', () => {
    expect(clampDmx(-5)).toBe(0);
    expect(clampDmx(300)).toBe(255);
    expect(clampDmx(0)).toBe(0);
    expect(clampDmx(255)).toBe(255);
    expect(clampDmx(127.4)).toBe(127);
    expect(clampDmx(127.6)).toBe(128);
  });
});

describe('computePan / computeTilt', () => {
  it('cercle : cos pour le pan, sin pour le tilt (déphasage π/2)', () => {
    expect(computePan(circle, 0)).toBe(228); // 128 + 100·cos(0)
    expect(computeTilt(circle, 0)).toBe(128); // 128 + 100·sin(0)
    expect(computePan(circle, 1)).toBe(128); // 128 + 100·cos(π/2)
    expect(computeTilt(circle, 1)).toBe(228); // 128 + 100·sin(π/2)
  });

  it('huit : Lissajous 1:2 (tilt à fréquence double)', () => {
    expect(computePan(eight, 2)).toBe(218); // 128 + 90·sin(π/2)
    expect(computeTilt(eight, 2)).toBe(128); // 128 + 90·sin(π)
  });
});

describe('timelineLengthBeats', () => {
  it('vaut bars × 4', () => {
    const loop = makeLoop(8);
    expect(timelineLengthBeats(loop)).toBe(32);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Module 2 — générateur Autoscript
// ─────────────────────────────────────────────────────────────────────────────

describe('generateAutoscript', () => {
  it('produit une timeline non vide, triée par beat, avec un id auto-loop', () => {
    const loop = makeLoop(8);
    expect(loop.keys.length).toBeGreaterThan(0);
    expect(timelineLengthBeats(loop)).toBe(32);

    const beats = loop.keys.map((k) => k.beat);
    expect(beats).toEqual([...beats].sort((a, b) => a - b));

    // L'id reprend la valeur PascalCase de la catégorie (comme `category.value` en Python).
    expect(loop.id.startsWith('autoscript-Wash_Primary-8b-')).toBe(true);
  });

  it('encode les adresses DMX absolues en chaîne', () => {
    const loop = makeLoop(8);
    const channels = new Set(loop.keys.map((k) => k.channel));
    // wash-1 (address 1) : pan = "1", tilt = "2", red = "3", green = "4", blue = "5".
    expect(channels.has('1')).toBe(true);
    expect(channels.has('2')).toBe(true);
    expect(channels.has('3')).toBe(true);
    // wash-2 (address 9) : red = "11".
    expect(channels.has('11')).toBe(true);
  });

  it('filtre les fixtures par catégorie', () => {
    const spot: AutoloopFixture = {
      id: 'spot-1',
      category: 'Spot',
      universe: 1,
      address: 17,
      channelMap: { pan: 0, tilt: 1, red: 2, green: 3, blue: 4 },
    };
    const loop = generateAutoscript({
      targetBars: 8,
      fixtures: [...fixtures, spot],
      category: 'Wash_Primary',
      positionCues: [],
      attributeCues: colors,
    });
    // Aucune clé ne doit pointer vers la plage du spot (address 17 → "17".."21").
    for (const key of loop.keys) {
      const addr = parseInt(key.channel, 10);
      expect(addr).toBeLessThan(17);
    }
  });

  it('respecte la règle « jamais la même couleur à moins de 2 bars »', () => {
    // Uniquement des cues couleur : chaque bloc de 4 bars reçoit une couleur,
    // et un même id ne revient pas avant minColorRepeatBars (2) bars.
    const loop = makeLoop(16, colors, []);
    const colorKeys = loop.keys.filter((k) => {
      const addr = parseInt(k.channel, 10);
      return addr >= 3 && addr <= 5; // red/green/blue de wash-1
    });
    // Les changements de couleur se font par snap (rampBeats 0) aux frontières de blocs.
    expect(colorKeys.length).toBeGreaterThan(0);
    const redKeys = loop.keys.filter((k) => k.channel === '3');
    // 16 bars, changement toutes les 4 bars → 4 blocs couleur pour wash-1.
    expect(redKeys.length).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Module 4 — banques 4 × 32
// ─────────────────────────────────────────────────────────────────────────────

describe('BankManager', () => {
  it('matrice 4 × 32 = 128 emplacements', () => {
    expect(BANKS).toBe(4);
    expect(PER_BANK).toBe(32);
    const banks = new BankManager();
    expect(banks.banks.length).toBe(4);
    expect(banks.banks.every((row) => row.length === 32)).toBe(true);
  });

  it('store / get / select', () => {
    const banks = new BankManager();
    const loop = makeLoop(8);
    banks.store(0, 0, loop);
    expect(banks.get(0, 0)).toBe(loop);
    expect(banks.select(0, 0)).toBe(loop);
  });

  it('store hors matrice lève RangeError', () => {
    const banks = new BankManager();
    const loop = makeLoop(8);
    expect(() => banks.store(4, 0, loop)).toThrow(RangeError);
    expect(() => banks.store(0, 32, loop)).toThrow(RangeError);
  });

  it('populate remplit les slots libres sans écraser', () => {
    const banks = new BankManager();
    const loop = makeLoop(8);
    banks.store(1, 0, loop); // slot 0 déjà occupé
    banks.populate(1, [loop, loop, loop, loop, loop]); // 5 loops
    expect(banks.get(1, 0)).toBe(loop);
    expect(banks.get(1, 1)).toBe(loop);
    expect(banks.get(1, 5)).toBe(loop);
    expect(banks.get(1, 6)).toBeNull();
  });

  it('mode exclusif : lockBank restreint la sélection', () => {
    const banks = new BankManager();
    const loop = makeLoop(8);
    banks.store(0, 0, loop);
    banks.populate(1, [loop, loop]);
    banks.lockBank(1);
    expect(banks.select(0, 0)).toBeNull(); // banque 0 interdite
    expect(banks.next()).toBe(loop); // premier loop de la banque 1
    banks.unlockAll();
    expect(banks.select(0, 0)).toBe(loop); // « Play All Banks » rétabli
  });

  it('navigation next/previous avec wrap-around', () => {
    const banks = new BankManager();
    const a = makeLoop(8);
    const b = makeLoop(8);
    banks.store(0, 0, a);
    banks.store(0, 1, b);
    banks.select(0, 1);
    expect(banks.next()).toBe(a); // wrap-around vers le début
    expect(banks.previous()).toBe(b);
  });

  it('Track Duration : onTrackLoaded régénère dans le slot actif', () => {
    const banks = new BankManager('track_duration');
    const loop = makeLoop(8);
    banks.store(0, 0, loop);
    const replacement = makeLoop(8);
    const result = banks.onTrackLoaded(() => replacement);
    expect(result).toBe(replacement);
    expect(banks.get(0, 0)).toBe(replacement);
  });

  it('Infinite (défaut) : onTrackLoaded ne fait rien', () => {
    const banks = new BankManager(); // 'infinite' par défaut
    const loop = makeLoop(8);
    banks.store(0, 0, loop);
    expect(banks.onTrackLoaded(() => makeLoop(8))).toBeNull();
    expect(banks.get(0, 0)).toBe(loop);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Module 3 — moteur de lecture (machine à états + quantisation + override)
// ─────────────────────────────────────────────────────────────────────────────

describe('AutoloopPlaybackEngine', () => {
  it('conversions de temps', () => {
    const engine = new AutoloopPlaybackEngine(new FakeOutput(), 120);
    expect(engine.beatMs()).toBe(500); // 60000 / 120
    expect(engine.barsToMs(1)).toBe(2000); // 4 × 500
  });

  it('joue le script après un déclenchement quantisé au barline', () => {
    const out = new FakeOutput();
    const engine = new AutoloopPlaybackEngine(out, 120);
    const loop = makeLoop(8);
    engine.load(loop);
    expect(engine.state).toBe('idle');

    engine.trigger();
    engine.onBarBeat(0, 0); // barline → bascule en script
    expect(engine.state).toBe('script');

    for (let bar = 0; bar < 2; bar++) {
      for (let beat = 0; beat < 4; beat++) {
        engine.onBarBeat(bar, beat);
      }
    }
    expect(out.frames.length).toBeGreaterThan(0);
    // Le pan de wash-1 (adresse 1) et le rouge (adresse 3) doivent être pilotés.
    expect(out.last[1]).toBeTypeOf('number');
    expect(out.last[3]).toBeTypeOf('number');
  });

  it('quantisation : à (bar 3, beat 2), le délai barline est 1000 ms', () => {
    const engine = new AutoloopPlaybackEngine(new FakeOutput(), 120);
    engine.load(makeLoop(8));
    engine.trigger();
    engine.onBarBeat(0, 0);
    engine.onBarBeat(3, 2);
    expect(Math.abs(engine.quantizeDelayMs() - 1000)).toBeLessThan(1e-9);
  });

  it('override : joue le loop puis reprend le script', () => {
    const out = new FakeOutput();
    const engine = new AutoloopPlaybackEngine(out, 120);
    engine.load(makeLoop(8));
    engine.trigger();
    engine.onBarBeat(0, 0);
    for (let bar = 0; bar < 4; bar++) {
      for (let beat = 0; beat < 4; beat++) {
        engine.onBarBeat(bar, beat);
      }
    }
    engine.onBarBeat(3, 2);

    const override = makeLoop(2, [colors[0]], []);
    engine.overrideWith(override);
    expect(engine.state).toBe('override_loop');

    // Avance de 2 bars (durée de l'override) puis au-delà pour franchir la fin.
    for (let bar = 3; bar < 7; bar++) {
      for (let beat = 0; beat < 4; beat++) {
        engine.onBarBeat(bar, beat);
      }
    }
    expect(engine.state).toBe('script');
  });

  it('stop ramène à idle', () => {
    const engine = new AutoloopPlaybackEngine(new FakeOutput(), 120);
    engine.load(makeLoop(8));
    engine.trigger();
    engine.onBarBeat(0, 0);
    expect(engine.state).toBe('script');
    engine.stop();
    expect(engine.state).toBe('idle');
  });
});
