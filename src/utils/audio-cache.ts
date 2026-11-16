/**
 * Shared AudioBuffer cache (module-level singleton).
 *
 * Decoding base64 audio data URLs is expensive (multi-MB strings).
 * `new Audio(dataUrl)` blocks the renderer; AudioContext.decodeAudioData
 * is async but still takes seconds on first play.
 *
 * This cache lets the Virtual Console widgets pre-decode a preset's audio
 * as soon as the widget is rendered (before the user clicks), so playback
 * starts with ~zero latency. Buffers are keyed by the exact data URL and
 * shared across SongPresetPlayer, audioAutoScript and show playback.
 */

const _bufferCache = new Map<string, AudioBuffer>();
const _pending = new Map<string, Promise<AudioBuffer>>();
let _sharedCtx: AudioContext | null = null;

/**
 * Plafond mémoire du cache des AudioBuffers décodés.
 *
 * Un AudioBuffer est en float32 : une chanson de 4 min ≈ 80 Mo. Sans plafond,
 * jouer 5 presets successivement en laissait 400 Mo en RAM → OOM du renderer
 * sur machine peu mémoire (Surface) → crash + projet vide. On purge les plus
 * anciens (insertion order) au-delà du plafond.
 */
const MAX_CACHED_BYTES = 256 * 1024 * 1024; // 256 Mo
const MAX_CACHED_BUFFERS = 6;

function cachedBytes(): number {
  let total = 0;
  for (const buf of _bufferCache.values()) {
    total += buf.length * buf.numberOfChannels * 4;
  }
  return total;
}

/** Purge le cache pour repasser sous le plafond (les plus anciens d'abord). */
function evictAudioCache(): void {
  if (_bufferCache.size <= MAX_CACHED_BUFFERS && cachedBytes() <= MAX_CACHED_BYTES) return;
  for (const [key, buf] of _bufferCache) {
    _bufferCache.delete(key);
    if (_bufferCache.size <= MAX_CACHED_BUFFERS && cachedBytes() <= MAX_CACHED_BYTES) break;
  }
}

function getSharedCtx(): AudioContext {
  if (!_sharedCtx || _sharedCtx.state === 'closed') {
    _sharedCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }
  return _sharedCtx;
}

/**
 * Normalise une valeur audio en data URL utilisable par fetch().
 *
 * Les presets récents stockent un data URL complet (data:audio/mpeg;base64,…),
 * mais les anciens .lmpreset et certains imports stockent le base64 NU
 * (audioDataBase64, ex. RIFF/WAV brut). fetch() échoue sur le base64 nu →
 * decodeAudioData ne reçoit rien → le widget joue l'horloge virtuelle sans
 * SON. On préfixe donc tout ce qui n'est déjà ni data: ni une URL réelle.
 */
export function normalizeAudioUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  if (/^(data:|https?:|blob:|file:)/i.test(url)) return url;
  // base64 nu (legacy) : sniffé par decodeAudioData (WAV/MP3) quel que soit le mime.
  return `data:audio/mpeg;base64,${url}`;
}

/**
 * Choisit la meilleure URL audio disponible pour un preset.
 *
 * Un .lmpreset peut être exporté SANS audio embarqué (export fait sans que la
 * forme d'onde soit rechargée dans la sidebar). Pour ne jamais perdre le son :
 * - on prend d'abord l'audio du fichier/preset chargé (`fileAudio`) ;
 * - sinon on retombe sur l'audio du même preset déjà présent en store
 *   (par ex. chargé via le projet .lmproj) ;
 * - le résultat est normalisé en data URL utilisable par fetch()/decodeAudioData.
 *
 * Retourne null si aucune source n'est disponible (preset muet assumé).
 */
export function pickAudioUrl(fileAudio: string | undefined | null, storeAudio: string | undefined | null): string | null {
  return normalizeAudioUrl(fileAudio || storeAudio);
}

/**
 * Decode a base64 data URL (or any URL) into an AudioBuffer.
 * Concurrent calls for the same URL share a single decode promise.
 * Returns null when the input is missing or decoding fails.
 */
export async function decodeAudioUrl(url: string | undefined | null): Promise<AudioBuffer | null> {
  if (!url) return null;
  const cached = _bufferCache.get(url);
  if (cached) return cached;
  const inflight = _pending.get(url);
  if (inflight) return inflight;

  const p = (async () => {
    try {
      const target = normalizeAudioUrl(url);
      if (!target) return null;
      const resp = await fetch(target);
      const ab = await resp.arrayBuffer();
      const ctx = getSharedCtx();
      const buffer = await ctx.decodeAudioData(ab);
      _bufferCache.set(url, buffer);
      evictAudioCache();
      return buffer;
    } catch {
      return null;
    } finally {
      _pending.delete(url);
    }
  })();

  _pending.set(url, p);
  return p;
}

/** Warm the cache without awaiting (fire-and-forget preload). */
export function preloadAudioUrl(url: string | undefined | null): void {
  if (!url || _bufferCache.has(url) || _pending.has(url)) return;
  void decodeAudioUrl(url);
}

/** Total decoded bytes in cache (debug / settings panel). */
export function getAudioCacheStats(): { buffers: number; approxBytes: number } {
  let bytes = 0;
  for (const b of _bufferCache.values()) bytes += b.length * b.numberOfChannels * 4;
  return { buffers: _bufferCache.size, approxBytes: bytes };
}

/**
 * Ré-encode un AudioBuffer décodé en WAV 16-bit et le retourne en data URL
 * (`data:audio/wav;base64,…`). Sert de source de secours quand le fichier
 * d'origine n'est plus accessible (`audioFile.file === null`) mais que le son
 * est bien décodé en mémoire (`audioFile.audioBuffer`). Évite de sauvegarder un
 * preset sans son après un simple chargement/import.
 */
export function audioBufferToWavDataUrl(buffer: AudioBuffer): string {
  const numCh = Math.max(1, buffer.numberOfChannels);
  const rate = Math.max(8000, buffer.sampleRate);
  const len = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = len * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);       // PCM
  view.setUint16(22, numCh, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);      // bits
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  // Entrelacement des canaux → PCM 16-bit
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      let s = buffer.numberOfChannels > ch ? buffer.getChannelData(ch)[i] : 0;
      s = Math.max(-1, Math.min(1, s));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }

  // Binaire → base64 (par blocs pour ne pas exploser la pile sur les gros buffers)
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
}
