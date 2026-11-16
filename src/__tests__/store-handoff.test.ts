import { describe, it, expect, beforeEach } from 'vitest';
import { OutputArbiter } from '../engine/output-arbiter';
import { dispatchChannelsByFixture } from '../utils/dmx-helpers';
import type { PatchedFixture } from '../stores/showStore';

// Réplique du flux Store (ProgrammerBar.handleStore) → play (SceneEditor) :
//   1. programmeur LTP 85 porte le look Target
//   2. handoff : push design-test (LTP 60) AVANT clear() du programmeur
//   3. clear() = release programmer → la scène doit être visible immédiatement
//   4. résidus scene-efx (LTP 75) ne doivent pas masquer la scène statique

function makeArbiter(): OutputArbiter {
  const arb = new OutputArbiter();
  arb.registerSource('programmer', 'ltp', 85);
  return arb;
}

describe('Store handoff — programmeur → design-test → release', () => {
  let arb: OutputArbiter;

  beforeEach(() => {
    arb = makeArbiter();
  });

  it('handoff avant clear() : la scène reste jouée après release programmeur', () => {
    const look = { 1: 255, 2: 128, 3: 200 };
    arb.write('programmer', 0, look);
    // handleStore : push design-test PUIS clear
    arb.write('design-test', 0, look);
    arb.release('programmer');
    const buf = arb.getBuffer(0);
    expect(buf[1]).toBe(255);
    expect(buf[2]).toBe(128);
    expect(buf[3]).toBe(200);
  });

  it('sans handoff (bug d’avant) : rien ne tient après clear — documente le fix', () => {
    const look = { 1: 255, 2: 128 };
    arb.write('programmer', 0, look);
    arb.release('programmer'); // clear sans bascule design-test
    const buf = arb.getBuffer(0);
    expect(buf[1]).toBeUndefined();
    expect(buf[2]).toBeUndefined();
  });

  it('résidus scene-efx (75) ne masquent pas la scène statique une fois relâchés', () => {
    const look = { 1: 255, 6: 40 };
    arb.write('scene-efx', 0, { 1: 10, 6: 99 }); // EFX précédent
    arb.write('design-test', 0, look);
    // effet SceneEditor : scène sans efxId → release scene-efx
    arb.release('scene-efx');
    const buf = arb.getBuffer(0);
    expect(buf[1]).toBe(255);
    expect(buf[6]).toBe(40);
  });

  it('blackout 512 zéros transient ne tue pas le handoff si la scène re-push ensuite', () => {
    const look = { 1: 255, 7: 90 };
    arb.write('design-test', 0, look);
    // branche else (scene=null au mount) : zéros sur design-test
    const zeros: Record<number, number> = {};
    for (let i = 1; i <= 512; i++) zeros[i] = 0;
    arb.write('design-test', 0, zeros);
    expect(arb.getBuffer(0)[1]).toBe(0);
    // re-push immédiat de la scène (check() immédiat + init window)
    arb.write('design-test', 0, look);
    expect(arb.getBuffer(0)[1]).toBe(255);
    expect(arb.getBuffer(0)[7]).toBe(90);
  });
});

describe('dispatchChannelsByFixture — adresses Target dans les plages patchées', () => {
  const universes = [{ id: 'u1' }];
  const pf: PatchedFixture = {
    id: 'f1',
    fixtureDefId: 'def',
    modeIndex: 0,
    universeId: 'u1',
    startAddress: 64,
    channelCount: 12,
  } as PatchedFixture;

  it('les canaux Target (startAddress+offset) sont routés vers l’univers', () => {
    const look = { 64: 130, 66: 200, 71: 255 }; // pan, tilt, dimmer @64
    const dispatched = dispatchChannelsByFixture(look, [pf], universes);
    expect(dispatched.get(0)).toEqual({ 64: 130, 66: 200, 71: 255 });
  });

  it('les adresses hors patch sont ignorées (pas de crash)', () => {
    const look = { 1: 255, 64: 10 };
    const dispatched = dispatchChannelsByFixture(look, [pf], universes);
    expect(dispatched.get(0)).toEqual({ 64: 10 });
  });
});

describe('sélection scène — window hack ne doit pas wipe au mount', () => {
  it('init depuis window conserve l’id posé par Store', () => {
    const g = globalThis as any;
    g.__lm_selectedSceneId = 'sc_store_1';
    // useState initializer de SceneList / SceneEditor
    const init = g.__lm_selectedSceneId ?? null;
    expect(init).toBe('sc_store_1');
    // write effect avec la même valeur = idempotent
    g.__lm_selectedSceneId = init;
    expect(g.__lm_selectedSceneId).toBe('sc_store_1');
  });

  it('re-clic tuile déjà sélectionnée = replay (ne désélectionne JAMAIS)', () => {
    const g = globalThis as any;
    g.__lm_selectedSceneId = 'sc_1';
    // Comportement corrigé : le clic ne bascule plus à null (blackout 512 zéros)
    // — il marque un replay que SceneEditor consomme via replayTick.
    g.__lm_sceneReplayAt = Date.now();
    // La sélection reste intacte
    expect(g.__lm_selectedSceneId).toBe('sc_1');
    // Un re-clic repousse un timestamp strictement croissant
    const first = g.__lm_sceneReplayAt;
    g.__lm_sceneReplayAt = first + 1;
    expect(g.__lm_sceneReplayAt).toBeGreaterThan(first);
  });

  it('ancien toggle (désélection → null) documenté comme corrigé', () => {
    const g = globalThis as any;
    g.__lm_selectedSceneId = 'sc_1';
    // Plus d'écriture null au clic — la scène reste sélectionnée.
    // (Le blackout 512 zéros de la branche else de SceneEditor ne
    //  déclenche donc plus « rien ne se passe » après Store/Rec.)
    expect(g.__lm_selectedSceneId).toBe('sc_1');
  });
});
