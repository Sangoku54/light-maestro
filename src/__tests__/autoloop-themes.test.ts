import { describe, it, expect } from 'vitest';
import { toAutoloopFixtures } from '../engine/autoloop-runtime';
import { buildThemedBanks, BANK_THEMES, THEME_COLORS } from '../engine/autoloop-themes';
import { BANKS, PER_BANK, BankManager } from '../engine/autoloop-banks';
import { AutoloopPlaybackEngine } from '../engine/autoloop-engine';
import type { AutoloopTimeline, ChannelKey } from '../engine/autoloop-types';
import type { PatchedFixture } from '../stores/showStore';
import type { DmxFixtureDefinition, DmxFixtureChannel } from '../hooks/dmx-cues';

const ch = (name: string, type: DmxFixtureChannel['type'], offset: number, capabilities?: DmxFixtureChannel['capabilities']): DmxFixtureChannel => ({
  name,
  type,
  offset,
  capabilities,
});

function def(id: string, channels: DmxFixtureChannel[]): DmxFixtureDefinition {
  return { id, manufacturer: 'Test', model: id, modes: [{ name: 'm', channels }] };
}

function pf(partial: Partial<PatchedFixture> & { id: string; fixtureDefId: string }): PatchedFixture {
  return {
    manufacturer: 'Test',
    model: partial.fixtureDefId,
    fixtureType: 'moving_head',
    modeIndex: 0,
    modeName: 'm',
    universeId: 'u1',
    startAddress: 1,
    channelCount: 6,
    name: partial.id,
    tier: 'primary',
    ...partial,
  };
}

// Moving head : Pan@0, Tilt@1, Dimmer@2, R@3, G@4, B@5.
const mover = def('mover-rgb', [
  ch('Pan', 'Pan', 0),
  ch('Tilt', 'Tilt', 1),
  ch('Dimmer', 'Intensity', 2),
  ch('Red', 'Colour', 3),
  ch('Green', 'Colour', 4),
  ch('Blue', 'Colour', 5),
]);

// Wash fixe : Dimmer@0, R@1, G@2, B@3.
const wash = def('wash-rgb', [
  ch('Dimmer', 'Intensity', 0),
  ch('Red', 'Colour', 1),
  ch('Green', 'Colour', 2),
  ch('Blue', 'Colour', 3),
]);

// Spot complet : mouvement + shutter + RGB + gobo/prisme/beam.
const spot = def('spot-full', [
  ch('Pan', 'Pan', 0),
  ch('Tilt', 'Tilt', 1),
  ch('Dimmer', 'Intensity', 2),
  ch('Shutter', 'Shutter', 3),
  ch('Red', 'Colour', 4),
  ch('Green', 'Colour', 5),
  ch('Blue', 'Colour', 6),
  ch('Gobo', 'Gobo', 7, [
    { min: 0, max: 15, name: 'Open' },
    { min: 16, max: 31, name: 'Gobo 1' },
    { min: 32, max: 47, name: 'Gobo 2' },
  ]),
  ch('Prism', 'Prism', 8, [
    { min: 0, max: 15, name: 'Out' },
    { min: 16, max: 31, name: 'Prism In' },
  ]),
  ch('Zoom', 'Zoom', 9),
  ch('Iris', 'Iris', 10),
  ch('Frost', 'Frost', 11),
  ch('Focus', 'Focus', 12),
]);

function defsOf(...defs: DmxFixtureDefinition[]): Map<string, DmxFixtureDefinition> {
  return new Map(defs.map((d) => [d.id, d]));
}

const universes = [{ id: 'u1' }, { id: 'u2' }];

function fixtures() {
  return toAutoloopFixtures(
    [
      pf({ id: 'm1', fixtureDefId: 'mover-rgb', startAddress: 1 }),
      pf({ id: 'w1', fixtureDefId: 'wash-rgb', fixtureType: 'wash', startAddress: 9, tier: 'secondary' }),
      pf({ id: 's1', fixtureDefId: 'spot-full', startAddress: 17 }),
    ],
    defsOf(mover, wash, spot),
    universes,
  );
}

function allLoops(banks: BankManager): AutoloopTimeline[][] {
  return banks.banks.map((row) => row.filter((l): l is AutoloopTimeline => l !== null));
}

/** Swing DMX (max − min) d'un canal sur toutes ses keyframes ; 0 si muet. */
function swingOf(loop: AutoloopTimeline, channel: string): number {
  let min = Infinity;
  let max = -Infinity;
  for (const key of loop.keys) {
    if (key.channel !== channel) continue;
    if (key.value < min) min = key.value;
    if (key.value > max) max = key.value;
  }
  return max - min;
}

describe('buildThemedBanks — structure', () => {
  const banks = buildThemedBanks(fixtures());

  it('est un BankManager 4 × 32 sans AUCUN slot vide', () => {
    expect(banks).toBeInstanceOf(BankManager);
    expect(banks.banks.length).toBe(BANKS);
    for (const row of banks.banks) {
      expect(row.length).toBe(PER_BANK);
      expect(row.every((l) => l !== null)).toBe(true);
    }
  });

  it('chaque loop porte un libellé lisible + le thème de sa banque', () => {
    for (let b = 0; b < BANKS; b++) {
      for (const loop of banks.banks[b]) {
        expect(loop!.label).toBeTruthy();
        expect(loop!.label!.length).toBeGreaterThanOrEqual(2);
        expect(loop!.theme).toBe(BANK_THEMES[b].id);
        expect(loop!.keys.length).toBeGreaterThan(0);
      }
    }
  });

  it('les 4 banques sont bien Couleurs / Effets / Matrice RGB / Mix', () => {
    expect(BANK_THEMES.map((t) => t.id)).toEqual(['couleurs', 'effets', 'matrice', 'mix']);
    expect(banks.banks[0][0]!.theme).toBe('couleurs');
    expect(banks.banks[1][0]!.theme).toBe('effets');
    expect(banks.banks[2][0]!.theme).toBe('matrice');
    expect(banks.banks[3][0]!.theme).toBe('mix');
  });

  it('banque Couleurs : 32 couleurs distinctes, une pastille chacune', () => {
    const loops = banks.banks[0] as AutoloopTimeline[];
    expect(loops.length).toBe(PER_BANK);
    expect(THEME_COLORS.length).toBe(PER_BANK);
    const labels = loops.map((l) => l.label);
    expect(new Set(labels).size).toBe(PER_BANK);
    expect(labels).toContain('Bleu');
    expect(labels).toContain('Jaune');
    for (const l of loops) expect(l.swatch).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('banque Effets : mouvements + strobe + respiration présents', () => {
    const labels = (banks.banks[1] as AutoloopTimeline[]).map((l) => l.label!);
    for (const expected of ['Cercle', 'Carré', 'Huit', 'Zigzag', 'Spirale', 'Losange', 'Drop']) {
      expect(labels).toContain(expected);
    }
    expect(labels.some((l) => l.startsWith('Strobe'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Respiration'))).toBe(true);
    // Canaux spot complets exploités
    expect(labels).toContain('Gobo');
    expect(labels).toContain('Prisme');
    expect(labels.some((l) => l.startsWith('Zoom'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Iris'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Frost'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Focus'))).toBe(true);
  });

  it('banque Matrice RGB : 32 motifs variés (chase, vague, explosion, arc-en-ciel…)', () => {
    const labels = (banks.banks[2] as AutoloopTimeline[]).map((l) => l.label!);
    expect(labels.length).toBe(PER_BANK);
    expect(labels.some((l) => l.startsWith('Chase'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Vague'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Explosion'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Arc-en-ciel'))).toBe(true);
    expect(labels.some((l) => l.startsWith('Dégradé'))).toBe(true);
  });

  it('banque Mix : chaque libellé combine couleur + mouvement', () => {
    const loops = banks.banks[3] as AutoloopTimeline[];
    for (const l of loops) {
      expect(l.label).toContain('·');
      expect(l.swatch).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('aucune clé DMX hors plage (adresse 1..512, valeur 0..255)', () => {
    const violations: string[] = [];
    let total = 0;
    for (const loops of allLoops(banks)) {
      for (const loop of loops) {
        for (const key of loop.keys) {
          total++;
          const addr = parseInt(key.channel, 10);
          if (Number.isNaN(addr) || addr < 1 || addr > 512) violations.push(`${loop.id}: adresse ${key.channel}`);
          if (key.value < 0 || key.value > 255) violations.push(`${loop.id}@${key.beat}: valeur ${key.value}`);
          if (key.beat < 0 || key.beat > loop.bars * 4) violations.push(`${loop.id}: beat ${key.beat}`);
        }
      }
    }
    expect(total).toBeGreaterThan(1000);
    expect(violations.slice(0, 10)).toEqual([]);
    expect(violations.length).toBe(0);
  });
});

describe('buildThemedBanks — exploitation des fixtures', () => {
  const fx = fixtures();
  const banks = buildThemedBanks(fx);

  it('« Bleu » écrit bien RGB = 0/0/255 sur CHAQUE fixture couleur', () => {
    const blue = banks.get(0, THEME_COLORS.findIndex((c) => c.label === 'Bleu'))!;
    const byId = new Map(fx.map((f) => [f.id, f]));
    const frame = new Map<string, number>();
    for (const key of blue.keys) frame.set(key.channel, key.value);

    // wash-rgb @9 : dimmer 9, R10 G11 B12 → tout en bleu.
    expect(frame.get('10')).toBe(0);
    expect(frame.get('11')).toBe(0);
    expect(frame.get('12')).toBe(255);
    expect(frame.get('9')).toBe(255); // dimmer plein

    // mover-rgb @1 : R4 G5 B6, dimmer 3.
    expect(frame.get('4')).toBe(0);
    expect(frame.get('5')).toBe(0);
    expect(frame.get('6')).toBe(255);
    expect(frame.get('3')).toBe(255);

    // spot-full @17 : R21 G22 B23, dimmer 19, shutter 20 ouvert.
    expect(frame.get('21')).toBe(0);
    expect(frame.get('22')).toBe(0);
    expect(frame.get('23')).toBe(255);
    expect(frame.get('19')).toBe(255);
    expect(frame.get('20')).toBe(255);
    expect(byId.size).toBe(3);
  });

  it('« Rouge » écrit 255/0/0 partout (aucune fixture muette)', () => {
    const red = banks.get(0, THEME_COLORS.findIndex((c) => c.label === 'Rouge'))!;
    const addrs = new Set(red.keys.map((k) => k.channel));
    for (const addr of ['4', '5', '6', '10', '11', '12', '21', '22', '23']) {
      expect(addrs.has(addr)).toBe(true);
    }
  });

  it('les loops de mouvement pilotent pan/tilt avec une rampe continue', () => {
    const circle = banks.get(1, 0)!; // « Cercle »
    expect(circle.label).toBe('Cercle');
    const length = circle.bars * 4;
    const moverPan = circle.keys.filter((k) => k.channel === '1').sort((a, b) => a.beat - b.beat);
    const spotPan = circle.keys.filter((k) => k.channel === '17').sort((a, b) => a.beat - b.beat);
    // ≥ 8 échantillons par cycle (rayon 96 → swing attendu ≈ 192 DMX).
    expect(moverPan.length).toBeGreaterThan(length / 4);
    expect(spotPan.length).toBe(moverPan.length);
    const values = new Set(moverPan.map((k) => k.value));
    expect(values.size).toBeGreaterThan(1); // ça bouge vraiment
    expect(swingOf(circle, '1')).toBeGreaterThanOrEqual(180);
    // Ancre + rampe = écart réel vers la clé suivante (interpolation fidèle).
    expect(moverPan[0].beat).toBe(0);
    expect(moverPan[0].rampBeats).toBe(0);
    for (let i = 1; i < moverPan.length; i++) {
      expect(moverPan[i].rampBeats).toBeCloseTo(moverPan[i].beat - moverPan[i - 1].beat, 6);
    }
    // Raccord de fin de boucle : dernière clé = valeur initiale, à la longueur.
    const last = moverPan[moverPan.length - 1];
    expect(last.beat).toBe(length);
    expect(last.value).toBe(moverPan[0].value);
  });

  it('la banque Matrice éclaire toutes les fixtures (clé par fixture)', () => {
    const chase = banks.get(2, 0)!;
    const addrs = new Set(chase.keys.map((k) => k.channel));
    expect(addrs.has('4')).toBe(true); // mover R
    expect(addrs.has('10')).toBe(true); // wash R
    expect(addrs.has('21')).toBe(true); // spot R
  });
});

describe('buildThemedBanks — moteur de lecture', () => {
  it('la boucle « Bleu » rend une frame DMX correcte via AutoloopPlaybackEngine', () => {
    const fx = fixtures();
    const banks = buildThemedBanks(fx);
    const blue = banks.get(0, THEME_COLORS.findIndex((c) => c.label === 'Bleu'))!;

    let frame: Record<number, number> = {};
    const engine = new AutoloopPlaybackEngine({ send: (c) => { frame = c; } }, 120);
    engine.load(blue);
    engine.trigger();
    engine.onBarBeat(0, 0);

    expect(frame[12]).toBe(255); // wash bleu
    expect(frame[10]).toBe(0);
    expect(frame[9]).toBe(255); // wash dimmer
    expect(frame[6]).toBe(255); // mover bleu
    expect(frame[23]).toBe(255); // spot bleu
  });

  it('sans fixture patchée : matrice vide (aucun faux loop)', () => {
    const empty = buildThemedBanks([]);
    expect(empty).toBeInstanceOf(BankManager);
    expect(empty.banks.every((row) => row.every((l) => l === null))).toBe(true);
  });
});

describe('buildThemedBanks — aucun bouton mouvement inactif (régression)', () => {
  const fx = fixtures();
  const banks = buildThemedBanks(fx);

  // mover-rgb @1 (Pan@0/Tilt@1) et spot-full @17 (Pan@0/Tilt@1).
  const MOVER_PAN = '1';
  const MOVER_TILT = '2';
  const SPOT_PAN = '17';
  const SPOT_TILT = '18';
  const MOVE_SLOTS = 21; // banque Effets : les 21 patterns remplissent les slots 1..21
  const SLOT_PAN_ONLY = 12;
  const SLOT_TILT_ONLY = 13;

  it('chaque pattern de mouvement déplace réellement chaque axe (≥ 60 DMX)', () => {
    const failures: string[] = [];
    for (let slot = 0; slot < MOVE_SLOTS; slot++) {
      const loop = banks.get(1, slot)!;
      const label = loop.label!;
      if (slot !== SLOT_TILT_ONLY && swingOf(loop, MOVER_PAN) < 60) failures.push(`${label}: pan mover`);
      if (slot !== SLOT_TILT_ONLY && swingOf(loop, SPOT_PAN) < 60) failures.push(`${label}: pan spot`);
      if (slot !== SLOT_PAN_ONLY && swingOf(loop, MOVER_TILT) < 60) failures.push(`${label}: tilt mover`);
      if (slot !== SLOT_PAN_ONLY && swingOf(loop, SPOT_TILT) < 60) failures.push(`${label}: tilt spot`);
    }
    expect(failures).toEqual([]);
  });

  it('« Pan seul » ne touche que le pan, « Tilt seul » que le tilt', () => {
    const panOnly = banks.get(1, SLOT_PAN_ONLY)!;
    expect(panOnly.label).toBe('Pan seul');
    expect(swingOf(panOnly, MOVER_PAN)).toBeGreaterThanOrEqual(60);
    expect(swingOf(panOnly, MOVER_TILT)).toBe(0);

    const tiltOnly = banks.get(1, SLOT_TILT_ONLY)!;
    expect(tiltOnly.label).toBe('Tilt seul');
    expect(swingOf(tiltOnly, MOVER_TILT)).toBeGreaterThanOrEqual(60);
    expect(swingOf(tiltOnly, MOVER_PAN)).toBe(0);
  });

  it('« Huit » (figure8) n’est plus figé — régression anti-aliasing', () => {
    const huit = banks.get(1, 2)!;
    expect(huit.label).toBe('Huit');
    expect(swingOf(huit, MOVER_PAN)).toBeGreaterThanOrEqual(100);
    expect(swingOf(huit, MOVER_TILT)).toBeGreaterThanOrEqual(100);
    // Variante de la banque Mix (i=23 → MOVE_PATTERNS[2], beatsPerCycle=2).
    const mixHuit = banks.get(3, 23)!;
    expect(mixHuit.label).toContain('· Huit');
    expect(swingOf(mixHuit, MOVER_PAN)).toBeGreaterThanOrEqual(100);
    expect(swingOf(mixHuit, MOVER_TILT)).toBeGreaterThanOrEqual(100);
  });

  it('« Spirale » déplace aussi le pan — régression sin(2p) à pas de 90°', () => {
    const spiral = banks.get(1, 9)!;
    expect(spiral.label).toBe('Spirale');
    expect(swingOf(spiral, MOVER_PAN)).toBeGreaterThanOrEqual(60);
  });

  it('« Dérive » (ex-« Ondulation », amplitude interne 0.1) est maintenant visible', () => {
    const derive = banks.get(1, 8)!;
    expect(derive.label).toBe('Dérive');
    expect(swingOf(derive, MOVER_PAN)).toBeGreaterThanOrEqual(60);
    expect(swingOf(derive, SPOT_TILT)).toBeGreaterThanOrEqual(60);
  });

  it('« Strobe lent » allume aussi une fixture sans shutter (fallback dimmer)', () => {
    const strobe = banks.get(1, 21)!;
    expect(strobe.label).toBe('Strobe lent');
    // mover-rgb n'a ni shutter ni strobe → clignotement sur le dimmer @3.
    expect(swingOf(strobe, '3')).toBeGreaterThanOrEqual(250);
    const rapid = banks.get(1, 22)!;
    expect(rapid.label).toBe('Strobe rapide');
    expect(swingOf(rapid, '3')).toBeGreaterThanOrEqual(250);
  });

  it('chaque canal dont la première ≠ dernière clé se raccorde à la longueur', () => {
    const problems: string[] = [];
    for (const loops of allLoops(banks)) {
      for (const loop of loops) {
        const length = loop.bars * 4;
        const byChannel = new Map<string, ChannelKey[]>();
        for (const key of loop.keys) {
          const arr = byChannel.get(key.channel);
          if (arr) arr.push(key);
          else byChannel.set(key.channel, [key]);
        }
        for (const [channel, keys] of byChannel) {
          keys.sort((a, b) => a.beat - b.beat);
          const first = keys[0];
          const last = keys[keys.length - 1];
          if (first.value !== last.value && last.beat !== length) {
            problems.push(`${loop.id} / ch ${channel}: fin à ${last.beat}`);
          }
        }
      }
    }
    expect(problems.slice(0, 10)).toEqual([]);
    expect(problems.length).toBe(0);
  });
});
