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
