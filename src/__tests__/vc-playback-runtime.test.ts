/**
 * Runtime « playback » de la Console Virtuelle
 * (`src/engine/vc-playback-runtime.ts`).
 *
 * Contexte : les actions `playSong`, `audioAutoScript`, `autoLoop`, `bankLoop`
 * et `loadShow` vivaient dans le composant React `VCButtonWidget`. Elles
 * n'existaient donc QUE si la tuile était montée (page VC active) — ce qui
 * rendait le pilotage à distance (Remote LAN) et MIDI impossibles.
 *
 * Ce test verrouille :
 *   - la délégation de `vcPressWidget` vers les DEUX familles ;
 *   - le registre unifié des tuiles « allumées » (feedback LED + Remote) ;
 *   - la sémantique toggle / flash ;
 *   - la publication du preset en cours (monté par <VcPlaybackHost>).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  vcPlaybackPress,
  vcPlaybackActivate,
  vcPlaybackDeactivate,
  vcPlaybackSetActive,
  vcPlaybackIsActive,
  vcPlaybackActiveIds,
  vcPlaybackSubscribe,
  vcPlaybackGetSongPreset,
  vcPlaybackSubscribeSong,
  vcPlaybackReset,
  vcPlaybackSongEnded,
} from '../engine/vc-playback-runtime';
import { vcPressWidget, vcStopWidget, vcIsRunning, vcStopAllRuns } from '../engine/virtual-console-runtime';
import { usePerformStore } from '../stores/performStore';
import { useShowStore } from '../stores/showStore';

const widget = (id: string, config: Record<string, unknown>) => ({
  id,
  type: 'button' as const,
  x: 0, y: 0, width: 100, height: 48,
  pageIndex: 0,
  config: config as any,
});

const songPreset = {
  id: 'preset-1',
  name: 'Demo Song',
  audioFileName: 'demo.mp3',
  dmxCues: [],
  quickShow: {},
  trackAnalysis: {},
  sections: [],
  createdAt: '2026-01-01',
};

beforeEach(() => {
  useShowStore.setState({
    scenes: [{ id: 's1', name: 'Scène 1', channels: { 1: 200 }, fadeIn: 0, fadeOut: 0, duration: 0 }] as any,
    chasers: [] as any,
    songPresets: [songPreset] as any,
  } as any);

  usePerformStore.setState({
    vcWidgets: [
      widget('w-simple', { actionType: 'scene', sceneId: 's1' }),
      widget('w-song', { actionType: 'playSong', songId: 'preset-1' }),
      widget('w-song-flash', { actionType: 'playSong', songId: 'preset-1', flashMode: 'flash' }),
      widget('w-loop', { actionType: 'autoLoop', autoLoopRecipe: { kind: 'color' } }),
    ] as any,
  } as any);

  vcPlaybackReset();
  // Les runs de la famille « simple » vivent dans un registre module-level :
  // on les purge aussi entre deux tests (sinon un run résiduel ferait
  // « toggle » au lieu d'« activer »).
  vcStopAllRuns();
});

afterEach(() => {
  vcPlaybackReset();
});

describe('registre des tuiles allumées', () => {
  it('setActive / isActive / activeIds sont cohérents', () => {
    expect(vcPlaybackIsActive('w-song')).toBe(false);
    vcPlaybackSetActive('w-song', true);
    expect(vcPlaybackIsActive('w-song')).toBe(true);
    expect(vcPlaybackActiveIds()).toContain('w-song');
    vcPlaybackSetActive('w-song', false);
    expect(vcPlaybackIsActive('w-song')).toBe(false);
    expect(vcPlaybackActiveIds()).not.toContain('w-song');
  });

  it('les abonnés sont notifiés des changements', () => {
    const events: Array<[string, boolean]> = [];
    const un = vcPlaybackSubscribe((id, on) => events.push([id, on]));
    vcPlaybackSetActive('w-song', true);
    vcPlaybackSetActive('w-song', false);
    un();
    vcPlaybackSetActive('w-loop', true);
    expect(events).toEqual([['w-song', true], ['w-song', false]]);
  });
});

describe('délégation des familles', () => {
  it('vcPlaybackPress ignore un widget de la famille « simple »', () => {
    expect(vcPlaybackPress('w-simple', true)).toBe(false);
  });

  it('vcPlaybackPress ignore un widget inexistant', () => {
    expect(vcPlaybackPress('does-not-exist', true)).toBe(false);
  });

  it('vcPressWidget accepte les deux familles', () => {
    expect(vcPressWidget('w-simple', true)).toBe(true);
    expect(vcPressWidget('w-song', true)).toBe(true);
    vcPlaybackReset();
  });

  it('la famille « simple » alimente le registre unifié', () => {
    vcPressWidget('w-simple', true);
    expect(vcIsRunning('w-simple')).toBe(true);
    expect(vcPlaybackIsActive('w-simple')).toBe(true);
    vcPressWidget('w-simple', true); // toggle → arrêt
    expect(vcPlaybackIsActive('w-simple')).toBe(false);
  });
});

describe('sémantique toggle / flash', () => {
  it('un bouton toggle bascule à chaque appui', () => {
    vcPressWidget('w-song', true);
    expect(vcPlaybackIsActive('w-song')).toBe(true);
    vcPressWidget('w-song', true);
    expect(vcPlaybackIsActive('w-song')).toBe(false);
  });

  it('un bouton flash s’éteint au relâchement', () => {
    vcPressWidget('w-song-flash', true);
    expect(vcPlaybackIsActive('w-song-flash')).toBe(true);
    vcPressWidget('w-song-flash', false);
    expect(vcPlaybackIsActive('w-song-flash')).toBe(false);
  });

  it('vcStopWidget arrête un widget playback', () => {
    vcPressWidget('w-song', true);
    expect(vcPlaybackIsActive('w-song')).toBe(true);
    vcStopWidget('w-song');
    expect(vcPlaybackIsActive('w-song')).toBe(false);
  });
});

describe('playSong — publication du preset', () => {
  it('le preset en cours est exposé au lecteur global', () => {
    const seen: Array<string | null> = [];
    const un = vcPlaybackSubscribeSong((p) => seen.push(p?.name ?? null));
    vcPressWidget('w-song', true);
    expect(vcPlaybackGetSongPreset()?.name).toBe('Demo Song');
    un();
    expect(seen).toContain('Demo Song');
  });

  it('un second appui arrête la lecture et dépublie le preset', () => {
    vcPressWidget('w-song', true);
    expect(vcPlaybackGetSongPreset()).not.toBeNull();
    vcPressWidget('w-song', true);
    expect(vcPlaybackGetSongPreset()).toBeNull();
  });

  it('la fin naturelle du preset éteint la tuile', () => {
    vcPressWidget('w-song', true);
    vcPlaybackSongEnded();
    expect(vcPlaybackIsActive('w-song')).toBe(false);
    expect(vcPlaybackGetSongPreset()).toBeNull();
  });

  it('un preset introuvable n’allume pas la tuile', () => {
    usePerformStore.setState({
      vcWidgets: [widget('w-missing', { actionType: 'playSong', songId: 'nope' })] as any,
    } as any);
    expect(vcPlaybackActivate('w-missing')).toBe(false);
    expect(vcPlaybackIsActive('w-missing')).toBe(false);
  });
});

describe('reset', () => {
  it('vcPlaybackReset éteint tout et vide le preset', () => {
    vcPressWidget('w-song', true);
    vcPressWidget('w-loop', true);
    expect(vcPlaybackActiveIds().length).toBeGreaterThan(0);
    vcPlaybackReset();
    expect(vcPlaybackActiveIds()).toHaveLength(0);
    expect(vcPlaybackGetSongPreset()).toBeNull();
  });

  it('vcPlaybackDeactivate éteint une tuile playback', () => {
    vcPressWidget('w-song', true);
    vcPlaybackDeactivate('w-song');
    expect(vcPlaybackIsActive('w-song')).toBe(false);
  });
});
