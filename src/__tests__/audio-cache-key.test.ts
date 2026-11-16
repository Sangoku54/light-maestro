/**
 * Clé de cache audio (ShowManager).
 *
 * AVANT : `b64.slice(0, 200)` → deux audios différents dont les 200
 * premiers caractères coïncident partageaient la même entrée de cache et le
 * MAUVAIS audio était joué. Le même son en data-URL et en base64 nu donnait
 * deux clés différentes → deux AudioBuffers de 80 Mo dans un cache borné à 3.
 */

import { describe, it, expect } from 'vitest';
import { audioCacheKey } from '../utils/audio-cache-key';

const DATA_URL = 'data:audio/mpeg;base64,QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=';
const RAW_B64 = 'QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo=';

describe('audioCacheKey', () => {
  it('un contenu vide a une clé stable', () => {
    expect(audioCacheKey('')).toBe('empty');
  });

  it('le data-URL et le base64 nu partagent la MÊME clé', () => {
    // C'était le cas avant : deux AudioBuffers de 80 Mo pour un seul son.
    expect(audioCacheKey(DATA_URL)).toBe(audioCacheKey(RAW_B64));
  });

  it('le même contenu donne toujours la même clé', () => {
    expect(audioCacheKey(RAW_B64)).toBe(audioCacheKey(RAW_B64));
  });

  it('deux contenus DIFFÉRENTS qui partagent les 200 premiers caractères ont des clés différentes', () => {
    // Régression du bug : les 200 premiers caractères sont identiques…
    const prefix = 'A'.repeat(200);
    const a = prefix + 'B'.repeat(100);
    const b = prefix + 'C'.repeat(100);
    expect(a.slice(0, 200)).toBe(b.slice(0, 200));   // collision de l'ancien algo
    expect(audioCacheKey(a)).not.toBe(audioCacheKey(b));
  });

  it('deux contenus de tailles différentes ont des clés différentes', () => {
    const a = 'A'.repeat(300);
    const b = 'A'.repeat(301);
    expect(audioCacheKey(a)).not.toBe(audioCacheKey(b));
  });

  it('deux contenus de même taille mais de queues différentes ont des clés différentes', () => {
    const head = 'A'.repeat(64);
    const a = head + 'X'.repeat(50) + 'B'.repeat(64);
    const b = head + 'X'.repeat(50) + 'C'.repeat(64);
    expect(a.length).toBe(b.length);
    expect(audioCacheKey(a)).not.toBe(audioCacheKey(b));
  });

  it('la clé ne contient pas le contenu audio complet', () => {
    // La clé est stockée dans une Map : elle ne doit pas peser 55 Mo.
    const key = audioCacheKey('A'.repeat(5000));
    expect(key.length).toBeLessThan(200);
  });
});
