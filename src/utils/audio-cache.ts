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
      const resp = await fetch(url);
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
