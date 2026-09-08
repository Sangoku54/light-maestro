import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { packProject, unpackProject, type EnvelopeBlob } from '../../electron/project-envelope';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-envelope-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('project-envelope (conteneur binaire .lmproj autonome)', () => {
  it('pack → unpack : manifeste et blobs restitués à l\'identique (round-trip)', async () => {
    const manifest = JSON.stringify({ name: 'test', showStore: { scenes: [] } });
    const blobs: EnvelopeBlob[] = [
      { key: 'audio-aaaabbbb', audioFileBase64: Buffer.from('hello world audio').toString('base64') },
      { key: 'audio-ccccdddd', audioFileBase64: 'data:audio/mpeg;base64,' + Buffer.from('data url blob').toString('base64') },
    ];
    const p = path.join(tmpDir, 'proj.lmproj');

    await packProject(p, manifest, blobs);

    const out = await unpackProject(p);
    expect(out.content).toBe(manifest);
    expect(out.blobs).toHaveLength(2);
    const map = new Map(out.blobs.map((b) => [b.key, b.audioFileBase64]));
    // data URL décodée puis re-encodée en base64 nu à la sortie
    expect(map.get('audio-aaaabbbb')).toBe(Buffer.from('hello world audio').toString('base64'));
    expect(map.get('audio-ccccdddd')).toBe(Buffer.from('data url blob').toString('base64'));
  });

  it('déduplique par clé : un même audio en 3 entrées → 1 seul blob dans le fichier', async () => {
    const sam = Buffer.from('same audio').toString('base64');
    const blobs: EnvelopeBlob[] = [
      { key: 'audio-same', audioFileBase64: sam },
      { key: 'audio-same', audioFileBase64: sam },
      { key: 'audio-same', audioFileBase64: sam },
    ];
    const p = path.join(tmpDir, 'dedup.lmproj');
    await packProject(p, '{}', blobs);
    const out = await unpackProject(p);
    expect(out.blobs).toHaveLength(1);
  });

  it('fichier legacy JSON pur (.lmproj v1 sans enveloppe) → retourné tel quel, blobs vide', async () => {
    const p = path.join(tmpDir, 'legacy.lmproj');
    fs.writeFileSync(p, '{"schemaVersion":1,"name":"legacy"}', 'utf-8');
    const out = await unpackProject(p);
    expect(out.content).toBe('{"schemaVersion":1,"name":"legacy"}');
    expect(out.blobs).toEqual([]);
  });

  it('multi-blobs volumineux : contenu binaire exact (pas de corruption de taille)', async () => {
    const big = Buffer.alloc(256 * 1024, 0xAB);
    const blobs: EnvelopeBlob[] = [];
    for (let i = 0; i < 8; i++) {
      blobs.push({ key: `audio-payload-${i}`, audioFileBase64: big.toString('base64') });
    }
    const p = path.join(tmpDir, 'big.lmproj');
    await packProject(p, JSON.stringify({ many: true }), blobs);
    const out = await unpackProject(p);
    expect(out.blobs).toHaveLength(8);
    for (let i = 0; i < 8; i++) {
      expect(Buffer.from(out.blobs[i].audioFileBase64, 'base64')).toEqual(big);
    }
  }, 20000);
});