/**
 * sendFixtureOn — centrage pan/tilt quand jamais écrits.
 *
 * Bug rapporté : 2 fixtures rear à l'arrière, allumées au clic → faisceaux
 * « vers leur gauche ». Cause : buildFixtureOnChannelValues n'écrit pas
 * pan/tilt (volontaire : ne pas bouger le faisceau visé) ; sur un buffer
 * frais pan=0 → mapping ±270° → rotation -270° = -X (leur gauche).
 * Fix : si la valeur live du canal Pan/Tilt est absente (jamais écrite par
 * l'autoscript ni par Target), l'allumage centre à 128. Si l'utilisateur a
 * visé (valeur live présente, même 0), on ne touche pas.
 *
 * NB : le miroir appStore (setUniverseData) stocke un Uint8Array 0-BASED
 * (data[addr-1]) — les assertions lisent donc addr-1.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { sendFixtureOn } from '../utils/dmx-helpers';
import { dmxBridge } from '../utils/dmx-bridge';
import { outputArbiter } from '../engine/output-arbiter';
import { useAppStore } from '../stores/appStore';
import { useShowStore } from '../stores/showStore';
import type { PatchedFixture } from '../stores/showStore';

function mkChannels(types: string[]) {
  return types.map((type) => ({
    name: type === 'PanFine' ? 'Pan fine' : type === 'TiltFine' ? 'Tilt fine' : type,
    type: type === 'PanFine' ? 'Pan' : type === 'TiltFine' ? 'Tilt' : type,
  }));
}

function mkPf(id: string, startAddress: number, channelCount: number): PatchedFixture {
  return {
    id,
    fixtureDefId: 'def-' + id,
    manufacturer: 'Test',
    model: id,
    fixtureType: 'Moving Head',
    modeIndex: 0,
    modeName: 'm',
    universeId: 'u1',
    startAddress,
    channelCount,
    name: id,
    tier: 'primary',
  } as unknown as PatchedFixture;
}

/** Miroir appStore univers 0 (Uint8Array 0-based) ; addr = adresse DMX 1-based. */
function mirrorAt(addr: number): number {
  const buf = useAppStore.getState().dmx.channelData[0] as Uint8Array;
  return buf ? buf[addr - 1] : 0;
}

describe('sendFixtureOn — pan/tilt centrés si jamais écrits', () => {
  beforeEach(() => {
    outputArbiter.registerSource('programmer', 'ltp', 85);
    dmxBridge.clearAll();
    useShowStore.setState({ universes: [{ id: 'u1', name: 'U1', type: 'virtual', channels: 512 }] } as any);
    useAppStore.setState({ dmx: { ...useAppStore.getState().dmx, channelData: {} } } as any);
  });

  it('buffer frais : pan/tilt centrés à 128, dimmer allumé', async () => {
    // Adresses : dimmer=1, pan=2, panFine=3, tilt=4, tiltFine=5
    const pf = mkPf('rear-1', 1, 5);
    const channels = mkChannels(['Intensity', 'Pan', 'PanFine', 'Tilt', 'TiltFine']);
    await sendFixtureOn(pf, channels as any, [pf], [{ id: 'u1' }] as any);

    expect(mirrorAt(1)).toBe(255);  // dimmer allumé
    expect(mirrorAt(2)).toBe(128);  // pan centré
    expect(mirrorAt(4)).toBe(128);  // tilt centré
  });

  it('pan/tilt déjà visés (live 30/200) : conservés, pas écrasés par 128', async () => {
    // Adresses : dimmer=1, pan=2, tilt=3
    const pf = mkPf('aimed-1', 1, 3);
    const channels = mkChannels(['Intensity', 'Pan', 'Tilt']);
    dmxBridge.write('programmer', 0, { 2: 30, 3: 200 });
    await sendFixtureOn(pf, channels as any, [pf], [{ id: 'u1' }] as any);

    // Le pan/tilt visé vit dans le BRIDGE arbitré (ce que lit la 3D)
    const bridge = dmxBridge.getChannels(0) as Record<number, number>;
    expect(bridge[2]).toBe(30);   // pan visé conservé
    expect(bridge[3]).toBe(200);  // tilt visé conservé
    expect(mirrorAt(1)).toBe(255); // dimmer allumé
  });

  it('pan=0 explicite (fond gauche volontaire) : conservé', async () => {
    const pf = mkPf('hardleft-1', 1, 2);
    const channels = mkChannels(['Intensity', 'Pan']);
    dmxBridge.write('programmer', 0, { 2: 0 });
    await sendFixtureOn(pf, channels as any, [pf], [{ id: 'u1' }] as any);
    const bridge = dmxBridge.getChannels(0) as Record<number, number>;
    expect(bridge[2]).toBe(0);
  });
});
