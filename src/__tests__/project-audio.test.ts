import { describe, it, expect } from 'vitest';
import {
  audioKeyOf,
  extractAudioField,
  externalizeProjectAudio,
  resolveAudioUrl,
  resolveProjectAudio,
  resolveWidgetAudio,
  writeAudioBlobs,
  type ExtractedBlob,
} from '../utils/project-audio';

function b64(sizeBytes: number, seed = 1): string {
  // base64 valide de `sizeBytes` octets (contenu pseudo-aléatoire déterministe)
  const buf = Buffer.alloc(sizeBytes);
  for (let i = 0; i < sizeBytes; i++) buf[i] = (i * 7 + seed * 31) % 256;
  return buf.toString('base64');
}

describe('project-audio — externalisation des blobs du .lmproj', () => {
  it('audioKeyOf : déterministe, préfixe audio-, dédup par contenu', async () => {
    const k1 = await audioKeyOf('QUJDREVGR0hJSktMTU5PUA==');
    const k2 = await audioKeyOf('QUJDREVGR0hJSktMTU5PUA==');
    const k3 = await audioKeyOf('WFla');
    expect(k1).toBe(k2);
    expect(k1.startsWith('audio-')).toBe(true);
    expect(k1).not.toBe(k3);
  });

  it('extractAudioField : absent -> {}; < 1 Ko -> en clair ; gros -> audioRef + blob', async () => {
    const empty = await extractAudioField(undefined);
    expect(empty.value).toEqual({});
    expect(empty.blob).toBeUndefined();

    const small = await extractAudioField('QUJD');
    expect(small.value.audioFileBase64).toBe('QUJD');
    expect(small.value.audioRef).toBeUndefined();
    expect(small.blob).toBeUndefined();

    const big = b64(2048);
    const bigRes = await extractAudioField(big);
    expect(bigRes.value.audioRef).toBeTruthy();
    expect(bigRes.value.audioFileBase64).toBeUndefined();
    expect(bigRes.blob?.audioFileBase64).toBe(big);
  });

  it('externalizeProjectAudio : presets, shows et track items allégés, blobs dédupliqués', async () => {
    const audio = b64(4096, 3); // gros blob partagé preset + track item
    const presets = [
      { id: 'p1', name: 'P1', audioFileBase64: audio },
      { id: 'p2', name: 'P2', audioFileBase64: '' }, // pas d'audio
    ];
    const shows = [
      {
        id: 's1',
        name: 'Show',
        audioFileBase64: audio, // même audio -> dédup
        tracks: [
          { id: 'tr1', items: [{ id: 'i1', audioFileBase64: audio }, { id: 'i2', audioFileBase64: undefined }] },
        ],
      },
    ];
    const { presets: outP, shows: outS, blobs } = await externalizeProjectAudio(presets, shows);

    expect(outP[0].audioRef).toBeTruthy();
    expect(outP[0].audioFileBase64).toBeUndefined();
    expect(outP[1].audioFileBase64).toBe(''); // audio vide -> inchangé, pas de ref
    expect(outS[0].audioRef).toBeTruthy();
    expect(outS[0].tracks[0].items[0].audioRef).toBeTruthy();
    expect(outS[0].tracks[0].items[0].audioFileBase64).toBeUndefined();
    expect(outS[0].tracks[0].items[1].audioFileBase64).toBeUndefined();
    // dédup : 1 seul blob pour le même audio (présent 3 fois)
    expect(blobs.length).toBe(1);
    expect(blobs[0].audioFileBase64).toBe(audio);
  });

  it('resolveProjectAudio : v1 en clair passe tel quel, v2 garde l\'audioRef (résolution paresseuse)', async () => {
    const stored: Record<string, any> = { 'audio-abc': { audioFileBase64: 'QUJD' } };
    const get = async (k: string) => stored[k];
    const presets = [
      { id: 'p1', audioFileBase64: 'REVG' }, // v1
      { id: 'p2', audioRef: 'audio-abc' }, // v2 → référence conservée
      { id: 'p3', audioRef: 'audio-missing' }, // blob absent
    ];
    const shows = [{ id: 's1', tracks: [{ id: 'tr1', items: [{ id: 'i1', audioRef: 'audio-abc' }] }] }];
    const { presets: outP, shows: outS } = await resolveProjectAudio(presets, shows, get);
    // v1 : base64 en clair conservé tel quel
    expect(outP[0].audioFileBase64).toBe('REVG');
    // v2 : PAS d'hydratation (le base64 de 55 Mo resterait en mémoire → OOM).
    // La référence est conservée ; la lecture paresseuse la résout.
    expect(outP[1].audioFileBase64).toBeUndefined();
    expect(outP[1].audioRef).toBe('audio-abc');
    expect(outP[2].audioRef).toBe('audio-missing');
    expect(outS[0].tracks[0].items[0].audioFileBase64).toBeUndefined();
    expect(outS[0].tracks[0].items[0].audioRef).toBe('audio-abc');
    // …et la résolution paresseuse retrouve bien l'audio
    expect(await resolveAudioUrl(outP[1], get)).toBe('QUJD');
  });

  it('data URLs réels : hash sur la partie base64, blob stocké complet (format QuickShowView/PerformanceView)', async () => {
    const dataUrl = `data:audio/mpeg;base64,${b64(4096, 5)}`;
    const { value, blob } = await extractAudioField(dataUrl);
    expect(value.audioRef).toBeTruthy();
    expect(value.audioFileBase64).toBeUndefined();
    expect(blob?.audioFileBase64).toBe(dataUrl); // le data URL complet est stocké
    // dédup : le même audio en base64 nu -> même clé (hash sur la partie base64)
    const k1 = await audioKeyOf(dataUrl);
    const k2 = await audioKeyOf(b64(4096, 5));
    expect(k1).toBe(k2);
  });

  it('resolveWidgetAudio : config.audioRef -> audioDataUrl restaurée ; ref manquante -> widget inchangé', async () => {
    const stored: Record<string, any> = { 'audio-xyz': { audioFileBase64: 'data:audio/mp3;base64,AAA=' } };
    const get = async (k: string) => stored[k];
    const widgets = [
      { id: 'w1', config: { title: 'A', audioRef: 'audio-xyz' } },
      { id: 'w2', config: { title: 'B', audioRef: 'audio-missing' } },
      { id: 'w3', config: { title: 'C' } },
    ];
    const out = await resolveWidgetAudio(widgets, get);
    expect(out[0].config.audioDataUrl).toBe('data:audio/mp3;base64,AAA=');
    expect(out[0].config.audioRef).toBeUndefined();
    expect(out[1].config.audioRef).toBe('audio-missing'); // blob absent -> inchangé
    expect(out[2].config.title).toBe('C');
  });

  it('writeAudioBlobs : skip si le blob existe déjà (has=true), écrit sinon', async () => {
    const written: Record<string, any> = { 'audio-exists': { audioFileBase64: 'OLD' } };
    const storage = {
      set: async (k: string, v: any) => { written[k] = v; return true; },
      has: async (k: string) => Object.prototype.hasOwnProperty.call(written, k),
    };
    const blobs: ExtractedBlob[] = [
      { key: 'audio-exists', audioFileBase64: 'NEW' },
      { key: 'audio-new', audioFileBase64: 'DATA' },
    ];
    await writeAudioBlobs(blobs, storage);
    expect(written['audio-exists'].audioFileBase64).toBe('OLD'); // pas réécrit
    expect(written['audio-new'].audioFileBase64).toBe('DATA');
  });

  it('resolveAudioUrl : base64 direct d\u2019abord, sinon blob audioRef, sinon null', async () => {
    const get = async (k: string) =>
      k === 'audio-abc' ? { audioFileBase64: 'QUJD' } : undefined;
    // direct (prioritaire même si audioRef présent)
    expect(await resolveAudioUrl({ audioFileBase64: 'REVG', audioRef: 'audio-abc' } as any, get)).toBe('REVG');
    // legacy audioDataBase64
    expect(await resolveAudioUrl({ audioDataBase64: 'REVG' } as any, get)).toBe('REVG');
    // ref -> hit
    expect(await resolveAudioUrl({ audioRef: 'audio-abc' } as any, get)).toBe('QUJD');
    // ref -> miss
    expect(await resolveAudioUrl({ audioRef: 'audio-missing' } as any, get)).toBeNull();
    // rien
    expect(await resolveAudioUrl({} as any, get)).toBeNull();
  });

  it('round-trip : externalize -> write -> resolve restaure les données', async () => {
    const audio = b64(4096, 9);
    const presets = [{ id: 'p1', name: 'Song', audioFileBase64: audio }];
    const shows = [
      {
        id: 's1', name: 'Show', audioFileBase64: audio,
        tracks: [{ id: 'tr1', items: [{ id: 'i1', audioFileBase64: audio }] }],
      },
    ];
    const { presets: slimP, shows: slimS, blobs } = await externalizeProjectAudio(presets, shows);
    const storageMap: Record<string, any> = {};
    const storage = {
      set: async (k: string, v: any) => { storageMap[k] = v; return true; },
      has: async (k: string) => Object.prototype.hasOwnProperty.call(storageMap, k),
    };
    await writeAudioBlobs(blobs, storage);
    const get = async (k: string) => storageMap[k];
    const { presets: backP, shows: backS } = await resolveProjectAudio(slimP, slimS, get);
    // Le store garde la RÉFÉRENCE (pas de base64 en mémoire → pas d'OOM) ;
    // la lecture paresseuse (resolveAudioUrl) retrouve l'audio.
    expect(backP[0].audioFileBase64).toBeUndefined();
    expect(backP[0].audioRef).toBeTruthy();
    expect(backS[0].audioFileBase64).toBeUndefined();
    expect(backS[0].tracks[0].items[0].audioFileBase64).toBeUndefined();
    expect(await resolveAudioUrl(backP[0], get)).toBe(audio);
    expect(await resolveAudioUrl(backS[0], get)).toBe(audio);
    expect(await resolveAudioUrl(backS[0].tracks[0].items[0], get)).toBe(audio);
  });
});
