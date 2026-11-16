/**
 * Régression : sauvegarde → rechargement d'un projet avec PLUSIEURS presets
 * dont certains ont déjà un audio externalisé (audioRef sans base64 en mémoire).
 *
 * Symptôme historique : à la sauvegarde, `externalizeProjectAudio` supprimait
 * l'`audioRef` des presets sans base64 en mémoire → leur audio disparaissait
 * au rechargement. Seul le DERNIER preset configuré (qui avait du base64 en
 * mémoire) survivait.
 */
import { describe, it, expect } from 'vitest';
import { externalizeProjectAudio, resolveProjectAudio, resolveAudioUrl } from '../utils/project-audio';

function b64(n: number, seed = 7): string {
  // base64 valide, non vide, déterministe
  let s = '';
  let x = seed;
  while (s.length < n) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    s += String.fromCharCode(33 + (x % 90));
  }
  return btoa(s.slice(0, n));
}

describe('project-audio — plusieurs presets avec audio', () => {
  it('préserve l\'audioRef des presets déjà externalisés et le ré-empaquette', async () => {
    const audioA = b64(4096, 1); // preset 1 : audio déjà externalisé (ref)
    const audioB = b64(4096, 2); // preset 2 : base64 en mémoire (ré-associé via 🔧)

    // userData local : le blob du preset 1 est déjà stocké sous sa clé
    const stored: Record<string, any> = {
      'audio-refA': { audioFileBase64: audioA },
    };
    const getBlob = async (k: string) => stored[k]?.audioFileBase64;

    const presets = [
      { id: 'p1', name: 'Until', audioRef: 'audio-refA', audioFileBase64: undefined },
      { id: 'p2', name: 'Foot Print', audioFileBase64: audioB, audioRef: undefined },
    ];

    const out = await externalizeProjectAudio(presets, []);

    // 1) l'audioRef du preset 1 est PRÉSERVÉ (c'était le bug)
    expect(out.presets[0].audioRef).toBe('audio-refA');
    expect(out.presets[0].audioFileBase64).toBeUndefined();

    // 2) le preset 2 est externalisé avec une clé audio-<hash>
    expect(out.presets[1].audioRef).toBeTruthy();
    expect(out.presets[1].audioFileBase64).toBeUndefined();

    // 3) les DEUX clés sont à embarquer dans l'enveloppe .lmproj
    expect(out.blobKeys).toContain('audio-refA');
    expect(out.blobKeys).toContain(out.presets[1].audioRef);
    expect(out.blobKeys.length).toBe(2);

    // 4) seul le blob NEUF est materialized (le pré-existant vit sur disque)
    expect(out.blobs.length).toBe(1);
    expect(out.blobs[0].key).toBe(out.presets[1].audioRef);
  });

  it('cycle complet : save → load → les DEUX audios sont résolus', async () => {
    const audioA = b64(4096, 3);
    const audioB = b64(4096, 4);

    // Session 1 : un preset déjà externalisé + un ré-associé (base64 en mémoire)
    const saved = await externalizeProjectAudio(
      [
        { id: 'p1', name: 'Until', audioRef: 'audio-refA' },
        { id: 'p2', name: 'Foot Print', audioFileBase64: audioB },
      ],
      [],
    );

    // Le projet sauvegardé ne contient QUE des références (pas de base64)
    const manifest = JSON.parse(JSON.stringify(saved.presets));
    expect(manifest[0].audioRef).toBe('audio-refA');
    expect(manifest[0].audioFileBase64).toBeUndefined();
    expect(manifest[1].audioFileBase64).toBeUndefined();

    // Session 2 : rechargement → l'enveloppe fournit les blobs.
    // Le blob pré-existant est relu du userData, le neuf vient de l'enveloppe.
    const fileBlobMap = new Map(saved.blobs.map((b) => [b.key, b.audioFileBase64]));
    fileBlobMap.set('audio-refA', audioA);
    const getAudio = async (k: string) => fileBlobMap.get(k);

    const loaded = await resolveProjectAudio(manifest, [], getAudio);

    // Le store garde la RÉFÉRENCE (pas de base64 en mémoire → pas d'OOM)
    expect(loaded.presets[0].audioRef).toBe('audio-refA');
    expect(loaded.presets[0].audioFileBase64).toBeUndefined();
    expect(loaded.presets[1].audioRef).toBeTruthy();
    expect(loaded.presets[1].audioFileBase64).toBeUndefined();

    // …et la lecture paresseuse retrouve les DEUX audios
    const url0 = await resolveAudioUrl(loaded.presets[0], getAudio);
    const url1 = await resolveAudioUrl(loaded.presets[1], getAudio);
    expect(url0).toBe(audioA);
    expect(url1).toBe(audioB);
  });
});
