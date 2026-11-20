/**
 * Commandes du Remote web LAN (`src/hooks/remote-trigger.ts`).
 *
 * Couvre les 3 findings Remote corrigés :
 *   1. flash : le relâchement est DIFFÉRÉ (press + release synchrone =
 *      scène annulée avant le moindre rendu → flash invisible) ;
 *   2. master de groupe : présent dans le snapshot (sans lui, le téléphone
 *      ne pouvait pas piloter le plafond d'un groupe) et pilotable ;
 *   3. la commande « slider » accepte un widget `group-master`.
 *
 * Tout est virtuel : aucun DMX réel (envois capturés via `__setVCSender`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __dispatchRemoteCommand,
  buildWidgetSnapshot,
  flashHoldMs,
} from '../hooks/remote-trigger';
import {
  vcIsRunning,
  vcStopAllRuns,
  __setVCSender,
  __setVCButtonFns,
  __setVCBlackoutFns,
} from '../engine/virtual-console-runtime';
import { usePerformStore } from '../stores/performStore';
import { useShowStore } from '../stores/showStore';
import { useGroupMastersStore } from '../stores/groupMastersStore';

let sent: Array<Record<number, number>> = [];

const button = (id: string, config: Record<string, unknown>) => ({
  id,
  type: 'button' as const,
  x: 0, y: 0, width: 100, height: 48,
  pageIndex: 0,
  config: config as any,
});

const slider = (id: string, type: 'slider' | 'group-master', config: Record<string, unknown>) => ({
  id,
  type,
  x: 0, y: 0, width: 30, height: 140,
  pageIndex: 0,
  config: config as any,
});

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  __setVCSender((channels) => { sent.push(channels); });
  __setVCBlackoutFns({ blackout: () => {}, restore: () => {} });
  __setVCButtonFns({
    applyGrandMaster01: () => {},
    setChannel: () => {},
    releaseChannel: () => {},
  });

  useShowStore.setState({
    scenes: [
      { id: 's-1', name: 'Scène 1', channels: { 1: 200 }, fadeIn: 400, fadeOut: 200, duration: 0 },
      { id: 's-2', name: 'Scène 2', channels: { 2: 120 }, fadeIn: 100, fadeOut: 100, duration: 0 },
    ],
    chasers: [],
    fixtureGroups: [{ id: 'g-1', name: 'Groupe A', fixtureIds: ['fx1'] }],
  } as any);

  usePerformStore.setState({
    vcWidgets: [
      button('w-flash', { actionType: 'scene', sceneId: 's-1', flashMode: 'flash' }),
      button('w-flash-fast', { actionType: 'scene', sceneId: 's-2', flashMode: 'flash' }),
      button('w-toggle', { actionType: 'scene', sceneId: 's-1' }),
      button('w-chaser-flash', { actionType: 'chaser', chaserId: 'ch-1', flashMode: 'flash' }),
      slider('w-fader', 'slider', { sliderFunction: 'channel', channelAddress: 7, min: 0, max: 255 }),
      slider('w-group', 'group-master', { groupId: 'g-1' }),
    ],
  } as any);

  useGroupMastersStore.setState({ values: {} });
});

afterEach(() => {
  vcStopAllRuns();
  __setVCSender(null);
  __setVCBlackoutFns(null);
  __setVCButtonFns(null);
  vi.useRealTimers();
});

describe('Remote — bouton flash', () => {
  it('la commande toggle déclenche le press IMMÉDIATEMENT (la scène est rendue)', () => {
    __dispatchRemoteCommand({ type: 'widget', id: 'w-flash', action: 'toggle' });
    // Le press a bien eu lieu : la tuile est active…
    expect(vcIsRunning('w-flash')).toBe(true);
    // …et le fondu d'entrée produit bien des frames DMX (le flash est
    // donc réellement visible, pas annulé dans la même frame).
    vi.advanceTimersByTime(450);
    expect(sent.length).toBeGreaterThan(0);
    expect(vcIsRunning('w-flash')).toBe(true);
  });

  it('le release est DIFFÉRÉ : la scène reste active pendant le maintien', () => {
    __dispatchRemoteCommand({ type: 'widget', id: 'w-flash', action: 'toggle' });
    expect(vcIsRunning('w-flash')).toBe(true);

    // Avant la fin du maintien : toujours active (c'est le bug corrigé —
    // le press+release synchrone annulait la scène dans la même frame).
    vi.advanceTimersByTime(200);
    expect(vcIsRunning('w-flash')).toBe(true);

    // Après le maintien (fadeIn 400 ms + 150 ms de marge) : relâchée.
    vi.advanceTimersByTime(400);
    expect(vcIsRunning('w-flash')).toBe(false);
  });

  it('durée de maintien = fadeIn de la scène + marge, bornée 200..3000 ms', () => {
    expect(flashHoldMs(button('w', { actionType: 'scene', sceneId: 's-1' }) as any)).toBe(550);
    expect(flashHoldMs(button('w', { actionType: 'scene', sceneId: 's-2' }) as any)).toBe(250);
    expect(flashHoldMs(button('w', { actionType: 'chaser' }) as any)).toBe(1000);
    expect(flashHoldMs(button('w', { actionType: 'blackout' }) as any)).toBe(250);
    // Bornes : un fondu absurdement long est ramené à 3 s.
    useShowStore.setState({
      scenes: [{ id: 's-long', name: 'Long', channels: {}, fadeIn: 99_000, fadeOut: 0, duration: 0 }],
    } as any);
    expect(flashHoldMs(button('w', { actionType: 'scene', sceneId: 's-long' }) as any)).toBe(3000);
  });

  it('un bouton NON flash reste en toggle (pas de relâchement différé)', () => {
    __dispatchRemoteCommand({ type: 'widget', id: 'w-toggle', action: 'toggle' });
    expect(vcIsRunning('w-toggle')).toBe(true);
    vi.advanceTimersByTime(5_000);
    expect(vcIsRunning('w-toggle')).toBe(true); // toujours allumé
  });
});

describe('Remote — master de groupe', () => {
  it('le widget group-master est exposé dans le snapshot comme un fader', () => {
    const entries = buildWidgetSnapshot();
    const gm = entries.find((e) => e.id === 'w-group');
    expect(gm).toBeDefined();
    expect(gm!.type).toBe('slider');
    expect(gm!.actionType).toBe('groupMaster');
    expect(gm!.label).toBe('Groupe A'); // nom du groupe, pas un identifiant
    expect(gm!.min).toBe(0);
    expect(gm!.max).toBe(255);
  });

  it('la valeur du snapshot suit le plafond réel (groupMastersStore)', () => {
    useGroupMastersStore.getState().setMaster('g-1', 128);
    const gm = buildWidgetSnapshot().find((e) => e.id === 'w-group');
    expect(gm!.value).toBe(128);
  });

  it('la commande slider du Remote pilote le plafond du groupe', () => {
    __dispatchRemoteCommand({ type: 'widget', id: 'w-group', action: 'slider', value: 0.5 });
    expect(useGroupMastersStore.getState().values['g-1']).toBe(128);
    expect(usePerformStore.getState().vcWidgetValues['w-group']).toBe(128);
  });

  it('un widget group-master sans groupe configuré est ignoré (aucun crash)', () => {
    usePerformStore.setState({
      vcWidgets: [slider('w-group-orphan', 'group-master', {})],
    } as any);
    expect(() =>
      __dispatchRemoteCommand({ type: 'widget', id: 'w-group-orphan', action: 'slider', value: 0.5 }),
    ).not.toThrow();
  });
});

describe('Remote — géométrie de la Console Virtuelle', () => {
  it('le snapshot expose position et taille : la tablette reproduit la disposition du PC', () => {
    usePerformStore.setState({
      vcWidgets: [
        { ...button('w-a', { actionType: 'scene', sceneId: 's-1' }), x: 40, y: 12, width: 120, height: 56 },
        { ...slider('w-b', 'slider', { sliderFunction: 'channel', channelAddress: 7 }), x: 200, y: 8, width: 32, height: 160 },
      ],
    } as any);

    const entries = buildWidgetSnapshot();
    expect(entries.find((e) => e.id === 'w-a')).toMatchObject({ x: 40, y: 12, width: 120, height: 56 });
    expect(entries.find((e) => e.id === 'w-b')).toMatchObject({ x: 200, y: 8, width: 32, height: 160 });
  });

  it('un widget sans géométrie expose des nombres finis (jamais NaN dans le payload)', () => {
    usePerformStore.setState({
      vcWidgets: [{ id: 'w-x', type: 'button', pageIndex: 0, config: { actionType: 'scene', sceneId: 's-1' } }],
    } as any);
    const e = buildWidgetSnapshot().find((x) => x.id === 'w-x')!;
    expect(Number.isFinite(e.x)).toBe(true);
    expect(Number.isFinite(e.y)).toBe(true);
    expect(Number.isFinite(e.width)).toBe(true);
    expect(Number.isFinite(e.height)).toBe(true);
  });
});
