import { describe, it, expect } from 'vitest';
import { findBestSongPreset, presetHasAudio, type SongPreset } from '../stores/showStore';

const mk = (id: string, name: string, audio?: Partial<SongPreset>): SongPreset =>
  ({ id, name, audioFileName: name, dmxCues: [], quickShow: {}, trackAnalysis: {}, sections: [], createdAt: '', ...audio } as SongPreset);

describe('presetHasAudio', () => {
  it('vrai pour base64, audioDataBase64 ou audioRef ; faux sinon', () => {
    expect(presetHasAudio(mk('a', 'X', { audioFileBase64: 'AAA' }))).toBe(true);
    expect(presetHasAudio(mk('b', 'X', { audioFileBase64: undefined, audioRef: 'audio-1' } as any))).toBe(true);
    expect(presetHasAudio(mk('c', 'X', { audioFileBase64: '' } as any))).toBe(false);
    expect(presetHasAudio(mk('d', 'X'))).toBe(false);
    expect(presetHasAudio(undefined)).toBe(false);
  });
});

describe('findBestSongPreset — préfère l\u2019entrée avec audio', () => {
  it('par id direct quand il a l\u2019audio', () => {
    const ps = [mk('1', 'A', { audioFileBase64: 'AAA' }), mk('2', 'B')];
    expect(findBestSongPreset(ps, '1', 'A')?.id).toBe('1');
  });

  it('si l\u2019entrée pointée est muette, prend l\u2019homonyme avec audio', () => {
    const ps = [mk('old', 'Voyage', {}), mk('new', 'Voyage', { audioFileBase64: 'AAA' })];
    expect(findBestSongPreset(ps, 'old', 'Voyage')?.id).toBe('new');
  });

  it('référence audioRef compte comme audio', () => {
    const ps = [mk('old', 'Voyage', {}), mk('new', 'Voyage', { audioRef: 'audio-x' } as any)];
    expect(findBestSongPreset(ps, 'old', 'Voyage')?.id).toBe('new');
  });

  it('retombe sur le premier si aucun n\u2019a l\u2019audio', () => {
    const ps = [mk('old', 'Voyage', {}), mk('new', 'Voyage', {})];
    expect(findBestSongPreset(ps, 'old', 'Voyage')?.id).toBe('old');
  });

  it('introuvable -> undefined', () => {
    expect(findBestSongPreset([mk('1', 'A')], 'zzz', 'Nope')).toBeUndefined();
    expect(findBestSongPreset([], 'x', 'y')).toBeUndefined();
  });
});
