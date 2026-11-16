/**
 * Aucune tuile « Scènes pré-programmées » ne doit rester noire.
 *
 * Régression du filler de la banque Effets : les variantes de mouvement
 * ajoutées pour atteindre 32 slots n'écrivaient QUE pan/tilt (pas de dimmer
 * ni couleur) — sur scène, mouvement dans le noir = tuile « qui ne
 * déclenche rien » (ex. « Cercle 60 » sur patch Yolo).
 *
 * Pour chaque rig (complet, movers seuls, wash seul, dimmer seul), les 128
 * boucles sont rendues à pas fin (0.5 beat) et DOIVENT allumer au moins un
 * canal LUMIÈRE (dimmer/RGB/shutter/strobe — pan/tilt seuls exclus).
 */
import { describe, it, expect } from 'vitest';
import { toAutoloopFixtures } from '../engine/autoloop-runtime';
import { buildThemedBanks, BANK_THEMES } from '../engine/autoloop-themes';
import { analyzeFixture } from '../engine/fixture-analyzer';
import { AutoloopPlaybackEngine } from '../engine/autoloop-engine';
import type { AutoloopTimeline } from '../engine/autoloop-types';
import type { PatchedFixture } from '../stores/showStore';
import type { DmxFixtureDefinition, DmxFixtureChannel } from '../hooks/dmx-cues';

const ch = (name: string, type: DmxFixtureChannel['type'], offset: number, capabilities?: DmxFixtureChannel['capabilities']): DmxFixtureChannel => ({
  name, type, offset, capabilities,
});
function def(id: string, channels: DmxFixtureChannel[]): DmxFixtureDefinition {
  return { id, manufacturer: 'Test', model: id, modes: [{ name: 'm', channels }] };
}
function pf(partial: Partial<PatchedFixture> & { id: string; fixtureDefId: string; startAddress: number }): PatchedFixture {
  return {
    manufacturer: 'Test', model: partial.fixtureDefId, fixtureType: 'moving_head',
    modeIndex: 0, modeName: 'm', universeId: 'u1', channelCount: 6,
    name: partial.id, tier: 'primary', ...partial,
  };
}
const mover = def('mover-rgb', [
  ch('Pan', 'Pan', 0), ch('Tilt', 'Tilt', 1), ch('Dimmer', 'Intensity', 2),
  ch('Red', 'Colour', 3), ch('Green', 'Colour', 4), ch('Blue', 'Colour', 5),
]);
const wash = def('wash-rgb', [
  ch('Dimmer', 'Intensity', 0), ch('Red', 'Colour', 1), ch('Green', 'Colour', 2), ch('Blue', 'Colour', 3),
]);
const dimmerOnly = def('dim-only', [ch('Dimmer', 'Intensity', 0)]);
const spot = def('spot-full', [
  ch('Pan', 'Pan', 0), ch('Tilt', 'Tilt', 1), ch('Dimmer', 'Intensity', 2),
  ch('Shutter', 'Shutter', 3), ch('Red', 'Colour', 4), ch('Green', 'Colour', 5),
  ch('Blue', 'Colour', 6),
  ch('Gobo', 'Gobo', 7, [{ min: 0, max: 15, name: 'Open' }, { min: 16, max: 31, name: 'Gobo 1' }]),
  ch('Prism', 'Prism', 8, [{ min: 0, max: 15, name: 'Out' }, { min: 16, max: 31, name: 'Prism In' }]),
  ch('Zoom', 'Zoom', 9), ch('Iris', 'Iris', 10), ch('Frost', 'Frost', 11), ch('Focus', 'Focus', 12),
]);
const defsOf = (...ds: DmxFixtureDefinition[]) => new Map(ds.map((d) => [d.id, d]));

function visibleAddrs(pfs: PatchedFixture[], defs: Map<string, DmxFixtureDefinition>): Set<number> {
  const out = new Set<number>();
  for (const f of pfs) {
    const fa = analyzeFixture(f, defs.get(f.fixtureDefId)!);
    const base = f.startAddress;
    const add = (o: number | null | undefined) => { if (o !== null && o !== undefined) out.add(base + o); };
    add(fa.intensityOffset);
    for (const o of fa.ledIntensityOffsets ?? []) add(o);
    for (const seg of fa.rgbSegments ?? []) {
      for (const o of [seg.r, seg.g, seg.b, seg.w, seg.a, seg.uv]) add(o ?? null);
    }
    add(fa.shutterOffset);
    add(fa.strobeOffset);
  }
  return out;
}

function visiblePeak(loop: AutoloopTimeline, visible: Set<number>): number {
  const frames: Record<number, number>[] = [];
  const engine = new AutoloopPlaybackEngine({ send: (c) => { frames.push(c); } }, 120);
  engine.load(loop);
  engine.trigger();
  for (let b = 0; b <= 16; b += 0.5) engine.onBarBeat(0, b);
  let peak = 0;
  for (const f of frames) {
    for (const [a, v] of Object.entries(f)) {
      if (visible.has(Number(a)) && v > peak) peak = v;
    }
  }
  return peak;
}

describe('scènes pré-programmées — aucune tuile noire', () => {
  const rigs: Record<string, { pfs: PatchedFixture[]; defs: Map<string, DmxFixtureDefinition> }> = {
    full: {
      pfs: [
        pf({ id: 'm1', fixtureDefId: 'mover-rgb', startAddress: 1 }),
        pf({ id: 'w1', fixtureDefId: 'wash-rgb', startAddress: 9 }),
        pf({ id: 's1', fixtureDefId: 'spot-full', startAddress: 17 }),
      ],
      defs: defsOf(mover, wash, spot),
    },
    moversOnly: {
      pfs: [pf({ id: 'm1', fixtureDefId: 'mover-rgb', startAddress: 1 })],
      defs: defsOf(mover),
    },
    washOnly: {
      pfs: [pf({ id: 'w1', fixtureDefId: 'wash-rgb', startAddress: 1 })],
      defs: defsOf(wash),
    },
    dimmerOnly: {
      pfs: [pf({ id: 'd1', fixtureDefId: 'dim-only', startAddress: 1 })],
      defs: defsOf(dimmerOnly),
    },
  };

  for (const [name, rig] of Object.entries(rigs)) {
    it(`rig ${name} : les 128 boucles allument au moins un canal lumière`, () => {
      const visible = visibleAddrs(rig.pfs, rig.defs);
      const fx = toAutoloopFixtures(rig.pfs, rig.defs, [{ id: 'u1' }]);
      const banks = buildThemedBanks(fx);
      const dark: string[] = [];
      for (let b = 0; b < banks.banks.length; b++) {
        banks.banks[b].forEach((loop, slot) => {
          if (!loop) { dark.push(`${BANK_THEMES[b].id}/${slot}: slot vide`); return; }
          if (visiblePeak(loop, visible) === 0) {
            dark.push(`${BANK_THEMES[b].id}/${slot} "${loop.label}"`);
          }
        });
      }
      expect(dark, `boucles noires (${name})`).toEqual([]);
    });
  }
});
