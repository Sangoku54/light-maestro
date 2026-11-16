import { describe, it, expect, beforeEach } from 'vitest';
import { OutputArbiter } from '../engine/output-arbiter';
import { dispatchChannelsByFixture } from '../utils/dmx-helpers';
import { useProgrammerStore } from '../stores/programmerStore';
import { useShowStore } from '../stores/showStore';
import type { PatchedFixture } from '../stores/showStore';

/**
 * Vérifie que le bloc Target écrit BIEN des valeurs DMX exploitables :
 *   Target (setChannel programmeur) → useProgrammerSync (dispatch patch)
 *   → arbitre LTP 85 → Store/Rec crée la scène → clear + handoff design-test
 *   → SceneEditor push → le buffer arbitré garde le look après release.
 *
 * Réplique les chemins réels (même code de dispatch, même ordre d'écriture).
 */

const universes = [{ id: 'u1' }];
const pf: PatchedFixture = {
  id: 'mh1',
  fixtureDefId: 'def',
  modeIndex: 0,
  universeId: 'u1',
  startAddress: 64,
  channelCount: 16,
} as PatchedFixture;

/** Réplique useProgrammerSync : écrit UNIQUEMENT via dispatchChannelsByFixture. */
function pushProgrammerToArbiter(arb: OutputArbiter, channels: Record<number, number>) {
  const dispatched = dispatchChannelsByFixture(channels, [pf], universes);
  if (Object.keys(channels).length === 0) {
    arb.release('programmer');
    return;
  }
  for (const [uniStr, vals] of dispatched.entries()) {
    const uni = Number(uniStr);
    if (Object.keys(vals).length > 0) arb.write('programmer', uni, vals);
    else arb.release('programmer', uni);
  }
}

describe('Bloc Target → valeurs DMX (programmeur → arbitre → scène)', () => {
  let arb: OutputArbiter;

  beforeEach(() => {
    arb = new OutputArbiter();
    arb.registerSource('programmer', 'ltp', 85);
    useProgrammerStore.getState().clear();
    (globalThis as any).__lm_programmerBackup = undefined;
    // Patch minimal pour createScene/updateScene
    useShowStore.setState({ patchedFixtures: [pf], universes: universes as any, scenes: [] });
  });

  it('Target écrit pan/tilt dans le programmeur ET ils arrivent dans le buffer arbitré', () => {
    // aimFixturesAtPoint : setCh(startAddress + offset, v)
    const setCh = useProgrammerStore.getState().setChannel;
    setCh(64 + 0, 180); // pan
    setCh(64 + 1, 90);  // tilt

    const prog = useProgrammerStore.getState().channels;
    expect(prog[64]).toBe(180);
    expect(prog[65]).toBe(90);

    pushProgrammerToArbiter(arb, prog);

    const buf = arb.getBuffer(0);
    expect(buf[64]).toBe(180); // pan visible malgré les autres sources
    expect(buf[65]).toBe(90);
  });

  it('dispatch ne jette PAS les adresses Target (dans la plage patchée)', () => {
    const look = { 64: 180, 65: 90, 70: 255 }; // pan, tilt, dimmer @64
    const dispatched = dispatchChannelsByFixture(look, [pf], universes);
    expect(dispatched.get(0)).toEqual({ 64: 180, 65: 90, 70: 255 });
    expect(dispatched.get(0)).not.toBeUndefined();
  });

  it('flux Store complet : Target → handleStore → clear → SceneEditor push → le look reste après release', () => {
    const setCh = useProgrammerStore.getState().setChannel;
    setCh(64, 180);
    setCh(65, 90);
    setCh(70, 255); // dimmer pour que le faisceau soit visible

    // 1. Programmeur en live (useProgrammerSync)
    pushProgrammerToArbiter(arb, useProgrammerStore.getState().channels);
    expect(arb.getBuffer(0)[64]).toBe(180);

    // 2. handleStore (mode new) : snapshot → createScene → updateScene
    const snap = { ...useProgrammerStore.getState().channels };
    const s = useShowStore.getState();
    const scId = s.createScene('Target Scene');
    s.updateScene(scId, { channels: { ...snap }, duration: 0 });

    // 3. Handoff design-test AVANT clear (ProgrammerBar.handleStore)
    const show = useShowStore.getState();
    const scene = useShowStore.getState().scenes.find((x) => x.id === scId)!;
    const handoff = dispatchChannelsByFixture(scene.channels, show.patchedFixtures, show.universes);
    for (const [uni, vals] of handoff.entries()) arb.write('design-test', uni, vals);

    // 4. clear() programmeur → release LTP 85
    useProgrammerStore.getState().clear();
    arb.release('programmer');

    // 5. Après release, le buffer doit encore porter le look (design-test 60)
    const after = arb.getBuffer(0);
    expect(after[64]).toBe(180);
    expect(after[65]).toBe(90);
    expect(after[70]).toBe(255);

    // 6. SceneEditor re-push (replay / premier mount) — idempotent
    const repush = dispatchChannelsByFixture(scene.channels, show.patchedFixtures, show.universes);
    for (const [uni, vals] of repush.entries()) arb.write('design-test', uni, vals);
    expect(arb.getBuffer(0)[64]).toBe(180);
  });

  it('recouvrement HTP dans dispatch ne vote pas contre une valeur Target plus basse sur le MÊME canal d’une seule fixture', () => {
    // Une seule fixture : chaque adresse n’est écrite qu’une fois — pas de max silencieux.
    const look = { 64: 10, 65: 250 };
    const dispatched = dispatchChannelsByFixture(look, [pf], universes);
    expect(dispatched.get(0)?.[64]).toBe(10); // pas écrasé à 250
    expect(dispatched.get(0)?.[65]).toBe(250);
  });

  it('adresses hors toute fixture patchée → dispatch vide, mais une adresse valide suffit à alimenter l’univers', () => {
    const outside = dispatchChannelsByFixture({ 1: 255 }, [pf], universes);
    expect(outside.get(0)).toBeUndefined(); // hors plage 64..79

    const mixed = dispatchChannelsByFixture({ 1: 255, 64: 99 }, [pf], universes);
    expect(mixed.get(0)).toEqual({ 64: 99 }); // la Target passe quand même
  });

  it('programmeur vide → release ne laisse aucun résidu qui masquerait design-test', () => {
    arb.write('design-test', 0, { 64: 180 });
    pushProgrammerToArbiter(arb, {}); // clear() → release
    expect(arb.getBuffer(0)[64]).toBe(180);
    expect(arb.getSourceValues('programmer', 0)).toBeUndefined();
  });
});
