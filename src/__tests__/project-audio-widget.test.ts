/**
 * Régression : le widget « Audio Auto Script » (audio seul, sans preset)
 * perdait son audio à la sauvegarde.
 *
 * Deux bugs :
 *  1) resolveWidgetAudio lisait `stored?.audioFileBase64` alors que le getter
 *     renvoie une STRING brute pour les blobs de l'enveloppe .lmproj →
 *     l'audio du widget n'était jamais restauré au rechargement.
 *  2) À la sauvegarde suivante, le widget n'ayant plus d'audioDataUrl en
 *     mémoire, son blob n'était pas ré-empaqueté → l'audio disparaît
 *     définitivement du projet.
 */
import { describe, it, expect } from 'vitest';
import { resolveWidgetAudio } from '../utils/project-audio';

describe('project-audio — widget Audio Auto Script', () => {
  it('restaure l\'audio du widget depuis un blob string (enveloppe .lmproj)', async () => {
    const audio = 'QUJDREVGR0g=';
    const widgets = [
      { id: 'w1', config: { actionType: 'audioAutoScript', audioRef: 'audio-abc123', audioDataUrl: undefined } },
    ];
    // Getter type « enveloppe » : renvoie une STRING brute
    const get = async (k: string) => (k === 'audio-abc123' ? audio : undefined);

    const out = await resolveWidgetAudio(widgets, get);

    expect(out[0].config.audioDataUrl).toBe(audio);
    expect(out[0].config.audioRef).toBeUndefined();
  });

  it('restaure l\'audio du widget depuis un objet { audioFileBase64 } (userData)', async () => {
    const audio = 'QUJDREVGR0g=';
    const widgets = [
      { id: 'w1', config: { actionType: 'audioAutoScript', audioRef: 'audio-abc123' } },
    ];
    // Getter type « userData » : renvoie un OBJET
    const get = async (k: string) => (k === 'audio-abc123' ? { audioFileBase64: audio } : undefined);

    const out = await resolveWidgetAudio(widgets, get);

    expect(out[0].config.audioDataUrl).toBe(audio);
  });

  it('laisse le widget intact quand le blob est absent (pas de crash)', async () => {
    const widgets = [
      { id: 'w1', config: { actionType: 'audioAutoScript', audioRef: 'audio-missing' } },
    ];
    const get = async () => undefined;

    const out = await resolveWidgetAudio(widgets, get);

    expect(out[0].config.audioRef).toBe('audio-missing');
    expect(out[0].config.audioDataUrl).toBeUndefined();
  });
});
