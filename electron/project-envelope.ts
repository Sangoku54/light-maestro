/**
 * project-envelope.ts — Format binaire autonome pour les projets `.lmproj`.
 *
 * Objectif : un projet `.lmproj` doit être autonome (transporter fixtures,
 * audio, autoscript, show, …) même entre deux machines. Auparavant l'audio
 * était externalisé dans des blobs `audio-<hash>.json` situés dans le
 * userData LOCAL — un `.lmproj` copié sur une autre machine perdait donc tout
 * son audio.
 *
 * La contrainte qui a motivé l'ancienne externalisation : le JSON.stringify
 * d'une seule grosse string côté renderer dépasse la taille max de string de
 * V8 (~536 Mo) → RangeError silencieux. On contourne en séparant le manifeste
 * JSON (petit) des blobs audio (gros binaires) dans un conteneur binaire :
 *
 *   [8]  magic        "LMZPROJ1"
 *   [4]  manifestLen  uint32 BE
 *   [N]  manifest     JSON UTF-8 (toutes les données du projet SAUF l'audio)
 *   [4]  blobCount    uint32 BE
 *   [par blob]
 *     [4]  keyLen     uint32 BE
 *     [K]  key        UTF-8 (ex. "audio-<sha16>")
 *     [8]  dataLen    uint64 BE
 *     [D]  data       octets audio bruts
 *
 * Chaque blob audio est stocké en binaire brut (jamais concaténé en une seule
 * grosse string), ce qui contourne la limite de V8 côté main process. À la
 * lecture, on restitue cleanment `content` (le manifeste) + `blobs` (listés
 * avec leur base64) au renderer, qui les ré-hydrate dans les stores.
 */

import * as fs from 'node:fs';

const MAGIC = 'LMZPROJ1';
const MAGIC_BUF = Buffer.from(MAGIC, 'utf-8');

export interface EnvelopeBlob {
  key: string;
  /** data URL ou base64 nu (préservé tel quel à l'aller). */
  audioFileBase64: string;
}

export interface PackedProject {
  content: string;
  blobs: EnvelopeBlob[];
}

/** Vrai si le fichier commence par le magic du conteneur binaire. */
function isEnvelope(buf: Buffer): boolean {
  return buf.length >= MAGIC_BUF.length && buf.subarray(0, MAGIC_BUF.length).equals(MAGIC_BUF);
}

/** Décode une string audio (data URL `data:...;base64,XXXX` ou base64 nu) vers un Buffer brut. */
function base64ToBuffer(field: string): Buffer {
  const marker = ';base64,';
  const idx = field.indexOf(marker);
  const b64 = field.startsWith('data:') && idx >= 0 ? field.slice(idx + marker.length) : field;
  return Buffer.from(b64, 'base64');
}

/**
 * Pack : construit le fichier binaire à partir du manifeste JSON + des blobs.
 * Écrit de façon atomique (tmp + rename) — un crash en plein écriture ne doit
 * jamais corrompre le projet.
 */
export async function packProject(
  filePath: string,
  content: string,
  blobs: EnvelopeBlob[],
): Promise<void> {
  // 1) Déduplication par clé (un même audio partagé preset/track = 1 blob).
  const dedup = new Map<string, Buffer>();
  for (const b of blobs) {
    if (dedup.has(b.key)) continue;
    dedup.set(b.key, base64ToBuffer(b.audioFileBase64));
  }

  const manifestBuf = Buffer.from(content, 'utf-8');

  // Taille totale : magic + manifeste (4+len) + count(4) + chaque blob (4+lenKey+8+lenData)
  const total = MAGIC_BUF.length + 4 + manifestBuf.length + 4 +
    Array.from(dedup.entries()).reduce(
      (acc, [key, data]) => acc + 4 + Buffer.byteLength(key, 'utf-8') + 8 + data.length,
      0,
    );

  const chunks: Buffer[] = [MAGIC_BUF];
  const hdr = Buffer.alloc(4);
  hdr.writeUInt32BE(manifestBuf.length, 0);
  chunks.push(hdr, manifestBuf);

  const countBuf = Buffer.alloc(4);
  countBuf.writeUInt32BE(dedup.size, 0);
  chunks.push(countBuf);

  for (const [key, data] of dedup) {
    const keyBuf = Buffer.from(key, 'utf-8');
    const keyLen = Buffer.alloc(4);
    keyLen.writeUInt32BE(keyBuf.length, 0);
    const dataLen = Buffer.alloc(8);
    dataLen.writeBigUInt64BE(BigInt(data.length), 0);
    chunks.push(keyLen, keyBuf, dataLen, data);
  }

  const final = Buffer.concat(chunks, total);
  const tmpPath = `${filePath}.tmp`;
  await fs.promises.writeFile(tmpPath, final);
  await fs.promises.rename(tmpPath, filePath);
}

/**
 * Unpack : lit un projet `.lmproj`. Détecte le conteneur binaire ; sinon le
 * fichier est considéré comme un ancien `.lmproj` JSON pur (rétro-compatible)
 * → retourné avec `blobs: []`.
 */
export async function unpackProject(filePath: string): Promise<PackedProject> {
  const buf = await fs.promises.readFile(filePath);

  if (!isEnvelope(buf)) {
    return { content: buf.toString('utf-8'), blobs: [] };
  }

  let off = MAGIC_BUF.length;

  const readU32 = (): number => {
    const v = buf.readUInt32BE(off);
    off += 4;
    return v;
  };
  const readU64 = (): number => {
    const v = Number(buf.readBigUInt64BE(off));
    off += 8;
    return v;
  };

  const manifestLen = readU32();
  const content = buf.subarray(off, off + manifestLen).toString('utf-8');
  off += manifestLen;

  const blobCount = readU32();
  const blobs: EnvelopeBlob[] = [];
  for (let i = 0; i < blobCount; i++) {
    const keyLen = readU32();
    const key = buf.subarray(off, off + keyLen).toString('utf-8');
    off += keyLen;
    const dataLen = readU64();
    const raw = buf.subarray(off, off + dataLen);
    off += dataLen;
    blobs.push({ key, audioFileBase64: raw.toString('base64') });
  }

  return { content, blobs };
}

/** Petit util résolu pour la lisibilité — taille totale approximative. */
export function envelopeByteLength(content: string, blobs: EnvelopeBlob[]): number {
  const manifestBuf = Buffer.byteLength(content, 'utf-8');
  return MAGIC_BUF.length + 4 + manifestBuf + 4 +
    blobs.reduce((acc, b) => {
      const keyBytes = Buffer.byteLength(b.key, 'utf-8');
      const marker = ';base64,';
      const idx = b.audioFileBase64.indexOf(marker);
      const b64 = b.audioFileBase64.startsWith('data:') && idx >= 0
        ? b.audioFileBase64.slice(idx + marker.length)
        : b.audioFileBase64;
      const dataBytes = Buffer.byteLength(b64, 'base64');
      return acc + 4 + keyBytes + 8 + dataBytes;
    }, 0);
}
