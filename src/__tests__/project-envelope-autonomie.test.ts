/**
 * Autonomie du .lmproj : le projet SAVEGARDÉ doit embarquer l'audio, pour
 * qu'il soit transportable sur une autre machine (PC live) sans dépendre du
 * userData local.
 *
 * Round-trip streaming :
 *   externalize (presets + shows + widgets) → packProjectStreaming (les blobs
 *   sont lus SUR DISQUE par le main process, comme en production) →
 *   unpackProjectStreaming (écriture des blobs sur disque) → résolution.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { packProjectStreaming, unpackProjectStreaming } from '../../electron/project-envelope';
import { externalizeProjectAudio, resolveAudioUrl } from '../utils/project-audio';

function b64(n: number, seed = 11): string {
  let s = '';
  let x = seed;
  while (s.length < n) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    s += String.fromCharCode(33 + (x % 90));
  }
  return btoa(s.slice(0, n));
}

describe('project-envelope — autonomie du .lmproj (streaming)', () => {
  it('le projet sauvegardé embarque l\'audio : rechargé ailleurs, le son est là', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-autonomie-'));
    try {
      // ── 1. Session de travail : l'audio vit dans le userData ──
      const audio = b64(5000, 3);
      const audio2 = b64(5000, 5);
      const presets = [
        { id: 'p1', name: 'Until', audioFileBase64: audio },
        { id: 'p2', name: 'Foot Print', audioFileBase64: audio2 },
      ];
      const shows = [
        { id: 's1', name: 'Show', audioFileBase64: audio, tracks: [] },
      ];

      // Le "userData" local : les blobs audio y sont écrits.
      const userData = new Map<string, Buffer>();
      const { presets: slimP, shows: slimS, blobs, blobKeys } = await externalizeProjectAudio(presets, shows);
      for (const b of blobs) userData.set(b.key, Buffer.from(b.audioFileBase64, 'base64'));

      // ── 2. Sauvegarde : le main process lit les blobs SUR DISQUE ──
      const lmprojPath = path.join(tmpDir, 'projet.lmproj');
      const manifest = JSON.stringify({ schemaVersion: 1, showStore: { songPresets: slimP, shows: slimS } });
      await packProjectStreaming(
        lmprojPath,
        manifest,
        blobKeys,
        async (key) => userData.get(key) ?? null,
      );

      // Le fichier doit contenir l'audio (projet autonome, pas juste des refs).
      const size = fs.statSync(lmprojPath).size;
      expect(size).toBeGreaterThan(5000);

      // ── 3. Transport + rechargement sur une AUTRE machine ──
      const otherMachineUserData = new Map<string, Buffer>();
      const { content, blobKeys: readKeys } = await unpackProjectStreaming(
        lmprojPath,
        async (key, data) => { otherMachineUserData.set(key, data); },
      );
      expect(readKeys.length).toBe(blobKeys.length);

      const parsed = JSON.parse(content);
      const readPresets = parsed.showStore.songPresets;

      // Le manifeste ne contient QUE des références (jamais de base64).
      expect(readPresets[0].audioFileBase64).toBeUndefined();
      expect(readPresets[0].audioRef).toBeTruthy();

      // ── 4. La lecture retrouve l'audio sur la nouvelle machine ──
      const get = async (key: string) => {
        const buf = otherMachineUserData.get(key);
        return buf ? { audioFileBase64: buf.toString('base64') } : undefined;
      };
      const url0 = await resolveAudioUrl(readPresets[0], get);
      const url1 = await resolveAudioUrl(readPresets[1], get);
      expect(url0).toBeTruthy();
      expect(url0!.length).toBeGreaterThan(100);
      expect(url1).toBeTruthy();

      // Octets identiques à la source (intégrité du round-trip).
      expect(Buffer.from(url0!, 'base64').equals(Buffer.from(audio, 'base64'))).toBe(true);
      expect(Buffer.from(url1!, 'base64').equals(Buffer.from(audio2, 'base64'))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('un preset déjà externalisé (blob déjà sur disque) survit au round-trip', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-autonomie2-'));
    try {
      const audio = b64(4000, 9);
      const key = 'audio-existant';
      const userData = new Map<string, Buffer>([[key, Buffer.from(audio, 'base64')]]);

      // Le preset ne porte QUE une référence (pas de base64 en mémoire).
      const presets = [{ id: 'p1', name: 'Until', audioRef: key }];
      const { presets: slimP, blobKeys } = await externalizeProjectAudio(presets, []);

      const lmprojPath = path.join(tmpDir, 'projet2.lmproj');
      const manifest = JSON.stringify({ schemaVersion: 1, showStore: { songPresets: slimP } });
      await packProjectStreaming(lmprojPath, manifest, blobKeys, async (k) => userData.get(k) ?? null);

      const other = new Map<string, Buffer>();
      const { content, blobKeys: readKeys } = await unpackProjectStreaming(
        lmprojPath,
        async (k, data) => { other.set(k, data); },
      );
      expect(readKeys).toContain(key);
      const readPresets = JSON.parse(content).showStore.songPresets;
      expect(readPresets[0].audioRef).toBe(key);

      const get = async (k: string) => {
        const buf = other.get(k);
        return buf ? { audioFileBase64: buf.toString('base64') } : undefined;
      };
      const url = await resolveAudioUrl(readPresets[0], get);
      expect(url).toBeTruthy();
      expect(Buffer.from(url!, 'base64').equals(Buffer.from(audio, 'base64'))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
