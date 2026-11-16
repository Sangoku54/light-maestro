import { describe, it, expect, beforeEach } from 'vitest';
import { analyzeFixtureChannels } from '../engine/fixture-analyzer';
import { dispatchChannelsByFixture, normalizeDmxBuffer } from '../utils/dmx-helpers';
import { dmxBridge } from '../utils/dmx-bridge';
import '../hooks/useProgrammerSync'; // enregistre la source 'programmer' LTP 85 (comme DesignView dans l'app)
import type { PatchedFixture } from '../stores/showStore';
import type { DmxFixtureDefinition, DmxFixtureChannel } from '../hooks/dmx-cues';

const ch = (name: string, type: DmxFixtureChannel['type'], offset: number): DmxFixtureChannel => ({ name, type, offset });

// 2 moving heads façon Inno Pocket Wash 11ch : dimmer ch8, shutter ch7, RGB ch3-5, pan/tilt ch1-2
function washDef(id: string): DmxFixtureDefinition {
  return {
    id, manufacturer: 'American DJ', model: 'Inno Pocket Wash', modes: [{
      name: '11ch', channels: [
        ch('Pan', 'Pan', 0),
        ch('Tilt', 'Tilt', 1),
        ch('Red', 'Colour', 2),
        ch('Green', 'Colour', 3),
        ch('Blue', 'Colour', 4),
        ch('White', 'Colour', 5),
        ch('Shutter', 'Shutter', 6),
        ch('Dimmer', 'Intensity', 7),
        ch('Color Macro', 'Effect', 8),
        ch('Auto Programs', 'Effect', 9),
        ch('Auto Speed', 'Speed', 10),
      ],
    }],
  };
}

function head(id: string, startAddress: number): PatchedFixture {
  return {
    id, fixtureDefId: 'wash', manufacturer: 'American DJ', model: 'Inno Pocket Wash',
    fixtureType: 'Moving Head', modeIndex: 0, modeName: '11ch', universeId: 'u1',
    startAddress, channelCount: 11, name: `Head ${id}`, tier: 'primary',
  };
}

describe('chaîne fader → programmeur → bridge → lecture 3D (nouveau projet, 2 heads)', () => {
  beforeEach(() => { dmxBridge.clearAll(); });

  it('fader dimmer+RGB → le bridge expose les valeurs lues par la 3D', () => {
    const heads = [head('h1', 1), head('h2', 12)];
    const universes = [{ id: 'u1' }];
    // Faders scène : dimmer 255 + blanc sur head 1
    const programmer = { 8: 255, 3: 255, 4: 255, 5: 255 };
    const dispatched = dispatchChannelsByFixture(programmer, heads, universes as any);
    expect(dispatched.get(0)).toBeDefined();
    for (const [uni, vals] of dispatched.entries()) dmxBridge.write('programmer', uni, vals);
    const buf = dmxBridge.getChannels(0);
    expect(buf).toBeDefined();
    expect(buf![8]).toBe(255);
    // Lecture côté 3D : même normalisation que la boucle de rendu
    // (adresses 1-based, buffer creux → tableau 0-based).
    const data = normalizeDmxBuffer(buf!);
    expect(data[7]).toBe(255);
    const defs = new Map([['wash', washDef('wash')]]);
    const cm = analyzeFixtureChannels(heads[0], defs.get('wash'));
    expect(cm.intensityOffset).toBe(7);
    // Lecture côté 3D : base 0-based + offset analyseur
    const base = heads[0].startAddress - 1;
    const intensity = data[base + cm.intensityOffset!];
    expect(intensity).toBe(255);
  });

  it('dispatch vide quand les adresses ne correspondent à aucune fixture (scène étrangère)', () => {
    const heads = [head('h1', 1), head('h2', 12)];
    const universes = [{ id: 'u1' }];
    // Canaux d'une scène faite pour d'autres adresses (ex. projet Yolo @64+)
    const foreign = { 64: 255, 65: 128, 66: 200 };
    const dispatched = dispatchChannelsByFixture(foreign, heads, universes as any);
    // Rien ne doit sortir : aucune fixture ne couvre ces adresses
    expect(dispatched.size).toBe(0);
  });

  it('normalizeDmxBuffer : buffer creux 1-based → index 0-based corrects (pas de compactage)', () => {
    // Régression : new Uint8Array(Object.values({8:255,...})) compactait et
    // décalait tous les index (data[7] devenait undefined → fixtures muettes).
    const sparse = { 8: 255, 3: 128, 4: 64, 5: 32 };
    const data = normalizeDmxBuffer(sparse);
    expect(data).toBeInstanceOf(Uint8Array);
    expect(data.length).toBe(512);
    expect(data[7]).toBe(255); // adresse 8
    expect(data[2]).toBe(128); // adresse 3
    expect(data[3]).toBe(64);
    expect(data[4]).toBe(32);
    expect(data[0]).toBe(0); // non écrit → 0, pas décalé
  });

  it('normalizeDmxBuffer : Uint8Array et number[] traversent inchangés', () => {
    const u8 = new Uint8Array(512);
    u8[7] = 200;
    expect(normalizeDmxBuffer(u8)[7]).toBe(200);
    expect(normalizeDmxBuffer(u8)).toBe(u8); // même référence
    const arr = [0, 0, 0, 0, 0, 0, 0, 200];
    expect(normalizeDmxBuffer(arr)[7]).toBe(200);
  });

  it('remontage 3D (clearAll) + re-push programmeur → la sortie survit', async () => {
    const { sendChannelsToHardwareAndStore } = await import('../utils/dmx-helpers');
    const heads = [head('h1', 1), head('h2', 12)];
    const universes = [{ id: 'u1' }];
    const programmer = { 8: 255, 3: 255, 4: 255, 5: 255 };
    // État live : écriture programmeur
    const d1 = dispatchChannelsByFixture(programmer, heads, universes as any);
    for (const [uni, vals] of d1.entries()) dmxBridge.write('programmer', uni, vals);
    expect(dmxBridge.getChannels(0)).toBeDefined();
    // Remontage : wipe complet (effet de montage Stage3D)
    dmxBridge.clearAll();
    expect(dmxBridge.getChannels(0)).toBeUndefined();
    // Re-push au montage (nouveau comportement) → la sortie revient
    await sendChannelsToHardwareAndStore({ ...programmer }, heads, universes as any, 'programmer');
    const buf = dmxBridge.getChannels(0);
    expect(buf).toBeDefined();
    const data = normalizeDmxBuffer(buf!);
    expect(data[7]).toBe(255);
  });
});
