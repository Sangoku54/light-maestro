/**
 * Robustesse de l'enveloppe .lmproj : troncature et corruption.
 *
 * AVANT : `readExactly` ignorait `bytesRead` → un fichier tronqué était
 * complété par des ZÉROS (manifeste JSON invalide → chargement silencieux en
 * échec, blobs audio en zéro-padding) et un `manifestLen` uint32 de 4 Go
 * sur un fichier de 1 Mo allouait 4 Go → OOM du main process.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  packProjectStreaming,
  unpackProjectStreaming,
} from '../../electron/project-envelope';

const TMP = path.join(os.tmpdir(), `lmproj-robust-${Date.now()}`);

beforeAll(() => fs.mkdirSync(TMP, { recursive: true }));
afterAll(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ok */ }
});

/** Écrit une enveloppe valide avec 2 blobs. */
async function writeValidEnvelope(file: string) {
  const blobs: Record<string, Buffer> = {
    'audio-aaa': Buffer.from('AAAA'),
    'audio-bbb': Buffer.from('BBBBBBBB'),
  };
  await packProjectStreaming(
    file,
    JSON.stringify({ hello: 'world' }),
    Object.keys(blobs),
    async (k) => blobs[k] ?? null,
  );
  return blobs;
}

describe('enveloppe .lmproj — troncature et corruption', () => {
  it('une enveloppe valide se relit correctement', async () => {
    const file = path.join(TMP, 'ok.lmproj');
    await writeValidEnvelope(file);
    const written = new Map<string, Buffer>();
    const out = await unpackProjectStreaming(file, async (k, d) => { written.set(k, d); });
    expect(out.content).toContain('hello');
    expect(out.blobKeys.sort()).toEqual(['audio-aaa', 'audio-bbb']);
    expect(written.get('audio-aaa')?.toString()).toBe('AAAA');
  });

  it('un fichier tronqué est REJETÉ avec un message explicite', async () => {
    const file = path.join(TMP, 'truncated.lmproj');
    await writeValidEnvelope(file);
    const full = fs.readFileSync(file);
    // Coupe au milieu du manifeste → readExactly ne peut plus tout lire.
    fs.writeFileSync(file, full.subarray(0, Math.floor(full.length / 2)));

    await expect(
      unpackProjectStreaming(file, async () => {}),
    ).rejects.toThrow(/tronqué|corrompu/i);
  });

  it('un manifestLen aberrant (4 Go) est rejeté SANS allouer 4 Go', async () => {
    const file = path.join(TMP, 'badlen.lmproj');
    await writeValidEnvelope(file);
    const buf = fs.readFileSync(file);
    // magic = 8 octets, puis manifestLen uint32 BE → on met 0xFFFFFFFF.
    buf.writeUInt32BE(0xffffffff, 8);
    fs.writeFileSync(file, buf);

    await expect(
      unpackProjectStreaming(file, async () => {}),
    ).rejects.toThrow(/tronqué|corrompu|invalide/i);
  });

  it('un fichier sans magic est traité comme un ancien .lmproj JSON', async () => {
    const file = path.join(TMP, 'legacy.json');
    fs.writeFileSync(file, JSON.stringify({ legacy: true }));
    const out = await unpackProjectStreaming(file, async () => {});
    expect(out.content).toContain('legacy');
    expect(out.blobKeys).toEqual([]);
  });

  it('un projet autonome vide (aucun blob) reste valide', async () => {
    const file = path.join(TMP, 'noblob.lmproj');
    await packProjectStreaming(file, JSON.stringify({ x: 1 }), [], async () => null);
    const out = await unpackProjectStreaming(file, async () => {});
    expect(out.content).toContain('"x":1');
    expect(out.blobKeys).toEqual([]);
  });

  it('une clé de blob en double n’est écrite qu’une fois', async () => {
    const file = path.join(TMP, 'dup.lmproj');
    const blobs: Record<string, Buffer> = { 'audio-aaa': Buffer.from('AAAA') };
    await packProjectStreaming(
      file,
      JSON.stringify({ hello: 'dup' }),
      ['audio-aaa', 'audio-aaa', 'audio-aaa'],
      async (k) => blobs[k] ?? null,
    );
    const out = await unpackProjectStreaming(file, async () => {});
    expect(out.blobKeys).toEqual(['audio-aaa']);
  });

  it('un blob absent du userData n’est pas embarqué (et le fichier reste lisible)', async () => {
    const file = path.join(TMP, 'missing.lmproj');
    const blobs: Record<string, Buffer> = { 'audio-aaa': Buffer.from('AAAA') };
    await packProjectStreaming(
      file,
      JSON.stringify({ hello: 'partial' }),
      ['audio-aaa', 'audio-missing'],
      async (k) => blobs[k] ?? null,
    );
    const out = await unpackProjectStreaming(file, async () => {});
    expect(out.blobKeys).toEqual(['audio-aaa']);
    expect(out.content).toContain('partial');
  });
});
