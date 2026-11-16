import { describe, expect, it } from 'vitest';
import {
  embedPresetAudio,
  expectedAudioName,
  presetNeedsAudio,
  presetRepairName,
} from '../utils/preset-audio-repair';

describe('preset-audio-repair', () => {
  it('détecte les presets sans audio', () => {
    expect(presetNeedsAudio(null)).toBe(false);
    expect(presetNeedsAudio({} as any)).toBe(true);
    expect(presetNeedsAudio({ audioDataBase64: '' } as any)).toBe(true);
    expect(presetNeedsAudio({ audioDataBase64: 123 } as any)).toBe(true);
    expect(presetNeedsAudio({ audioDataBase64: 'abc' } as any)).toBe(false);
  });

  it('résout le nom du preset (store puis nom de fichier)', () => {
    expect(presetRepairName({ quickShow: { name: 'My Song' } }, 'x.lmpreset')).toBe('My Song');
    expect(presetRepairName({}, '1-Waiting.lmpreset')).toBe('1-Waiting');
  });

  it('donne le nom audio attendu pour le rapport', () => {
    expect(expectedAudioName({ analysis: { fileName: 'song.mp3' } })).toBe('song.mp3');
    expect(expectedAudioName({})).toBe('(nom audio inconnu)');
  });

  it('ré-embarque en raw base64 (préfixe data: retiré, original intact)', () => {
    const src = { quickShow: { name: 'S' }, audioDataBase64: '' };
    const out = embedPresetAudio(src, 'data:audio/mpeg;base64,AAA');
    expect(out.audioDataBase64).toBe('AAA');
    expect(src.audioDataBase64).toBe('');
    expect(embedPresetAudio(src, 'BBB').audioDataBase64).toBe('BBB');
  });
});
