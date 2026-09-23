/**
 * Deep-copy for Electron IPC (structured clone): drop functions/symbols
 * (Zustand actions). Cycles are rewritten to the copy, never to the source.
 */
export function stripUncloneable<T>(value: T, seen: Map<object, unknown> = new Map()): T {
  if (value === null || typeof value !== 'object') {
    return (typeof value === 'function' || typeof value === 'symbol' ? undefined : value) as T;
  }
  const cached = seen.get(value as object);
  if (cached !== undefined) return cached as T;
  if (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  ) return value;
  if (Array.isArray(value)) {
    const arr: unknown[] = [];
    seen.set(value as object, arr);
    for (const v of value) arr.push(stripUncloneable(v, seen));
    return arr as unknown as T;
  }
  const out: Record<string, unknown> = {};
  seen.set(value as object, out);
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = stripUncloneable(v, seen);
  }
  return out as T;
}
