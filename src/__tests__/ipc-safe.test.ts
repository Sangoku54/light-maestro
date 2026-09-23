import { describe, it, expect } from 'vitest';
import { stripUncloneable } from '../utils/ipc-safe';

describe('stripUncloneable — payload IPC sans fonctions', () => {
  it('retire les actions zustand de premier niveau', () => {
    const state = {
      mode: 'design',
      markDirty: () => {},
      setMode: (m: string) => m,
      quickShow: { intensity: 'dynamic' },
    };
    const out = stripUncloneable(state) as any;
    expect(out.mode).toBe('design');
    expect(out.quickShow.intensity).toBe('dynamic');
    expect(out.markDirty).toBeUndefined();
    expect(out.setMode).toBeUndefined();
    expect(() => structuredClone(out)).not.toThrow();
  });

  it('retire les fonctions imbriquées', () => {
    const out = stripUncloneable({
      nested: { cb: () => 1, list: [1, () => 2, 'x'] },
    }) as any;
    expect(out.nested.cb).toBeUndefined();
    expect(out.nested.list).toEqual([1, undefined, 'x']);
    expect(() => structuredClone(out)).not.toThrow();
  });

  it('gère les cycles sans stack overflow', () => {
    const a: any = { name: 'a' };
    a.self = a;
    const out = stripUncloneable(a);
    expect(out.name).toBe('a');
    expect((out as any).self).toBe(out);
    expect(() => structuredClone(out)).not.toThrow();
  });

  it('une cycle ne réintroduit pas de fonction du source', () => {
    const a: any = { fn: () => 1 };
    a.self = a;
    const out = stripUncloneable(a) as any;
    expect(out.fn).toBeUndefined();
    expect(out.self.fn).toBeUndefined();
    expect(() => structuredClone(out)).not.toThrow();
  });

  it('conserve Date et tableaux binaires', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    const buf = new Uint8Array([1, 2, 3]);
    const out = stripUncloneable({ d, buf, fn: () => 0 }) as any;
    expect(out.d).toBeInstanceOf(Date);
    expect(out.buf).toBeInstanceOf(Uint8Array);
    expect(out.fn).toBeUndefined();
    expect(() => structuredClone(out)).not.toThrow();
  });

  it('structuredClone du payload autosave simulé ne jette plus', () => {
    const data = {
      schemaVersion: 1,
      appStore: {
        mode: 'quick',
        markDirty: () => {},
        setMode: () => {},
        quickShow: { intensity: 'dynamic' },
      },
      showStore: { scenes: [{ id: 'scn-1', channels: { 1: 200 } }] },
      vcWidgets: [],
      version: 1,
      timestamp: new Date().toISOString(),
    };
    expect(() => structuredClone(stripUncloneable(data))).not.toThrow();
    expect(() => structuredClone(data)).toThrow();
  });
});
