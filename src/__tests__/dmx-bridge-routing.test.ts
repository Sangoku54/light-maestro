import { describe, it, expect } from 'vitest';
import { dmxBridge } from '../utils/dmx-bridge';
import { sendChannelsToHardware } from '../utils/dmx-helpers';

// Non-régression : l'envoi traverse TOUJOURS le pont (arbitre + cache 3D),
// même sans API DMX hardware. L'ancien early-return `if (!dmx) return`
// laissait le cache 3D périmé pendant que le miroir appStore avançait —
// la 3D (qui préfère le cache arbitré) ignorait alors ces envois
// (ex. preview de scène invisible après une lecture).
const fixtures = [
  { id: 'fx-1', startAddress: 1, channelCount: 3, universeId: 'u1' },
];
const universes = [{ id: 'u1' }];

describe('dmx-bridge routing sans hardware', () => {
  it('sendChannelsToHardware alimente le cache 3D même sans API DMX', async () => {
    // Pas de window.lightMaestro.dmx ici (contexte sans hardware)
    await sendChannelsToHardware({ 1: 255, 2: 128 }, fixtures as any, universes as any, 'design-test');
    const buf = dmxBridge.getChannels(0);
    expect(buf?.[1]).toBe(255);
    expect(buf?.[2]).toBe(128);
    dmxBridge.release('design-test', 0);
  });

  it('les canaux hors patch ne routent rien (dispatch inchangé)', async () => {
    await sendChannelsToHardware({ 500: 255 }, fixtures as any, universes as any, 'design-test');
    // Adresse 500 hors plage [1,4) : rien écrit pour cet univers
    const buf = dmxBridge.getChannels(0);
    expect(buf?.[500]).toBeUndefined();
    dmxBridge.release('design-test', 0);
  });
});

describe('dmx-bridge — releaseChannels (libération par canal)', () => {
  it('retire la contribution du canal ET met le cache 3D à jour', () => {
    // Contenu HTP (un preset) + tuile VC en LTP qui écrase le canal.
    dmxBridge.write('song-preset', 0, { 1: 255, 2: 120 });
    dmxBridge.write('vc', 0, { 1: 0 });
    expect(dmxBridge.getChannels(0)?.[1]).toBe(0); // la VC masque le preset

    // Relâchement de la tuile : le canal est LIBÉRÉ (pas mis à 0).
    dmxBridge.releaseChannels('vc', 0, [1]);

    const buf = dmxBridge.getChannels(0);
    expect(buf?.[1]).toBe(255); // le preset reprend la main
    expect(buf?.[2]).toBe(120); // canal voisin intact
    dmxBridge.release('vc', 0);
    dmxBridge.release('song-preset', 0);
  });

  it('un canal absent n’entraîne aucune mise à jour inutile', () => {
    dmxBridge.write('vc', 0, { 5: 100 });
    const before = dmxBridge.getChannels(0);
    dmxBridge.releaseChannels('vc', 0, [42]);
    expect(dmxBridge.getChannels(0)).toEqual(before);
    dmxBridge.release('vc', 0);
  });
});
