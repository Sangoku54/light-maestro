/**
 * Parité i18n FR/EN — garde-fou de non-régression.
 *
 * Bug trouvé : les clés `perform.vc.groupMaster` / `perform.vc.targetGroup` /
 * `perform.vc.groupMasterHint` (panneau Master de Groupe du mode Perform)
 * n'existaient qu'en EN : l'interface française affichait la clé brute
 * ("perform.vc.groupMaster") au lieu du libellé.
 *
 * Ce test verrouille la parité des deux dictionnaires (mêmes clés, mêmes
 * sections) et refuse les valeurs vides.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

type Json = { [k: string]: unknown };

function flatten(obj: Json, prefix = '', out = new Map<string, unknown>()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v as Json, key, out);
    else out.set(key, v);
  }
  return out;
}

function load(name: string): Map<string, unknown> {
  const p = path.join(process.cwd(), 'src', 'i18n', `${name}.json`);
  return flatten(JSON.parse(fs.readFileSync(p, 'utf-8')) as Json);
}

const fr = load('fr');
const en = load('en');

describe('i18n — parité FR/EN', () => {
  it('les deux dictionnaires ont le même nombre de clés', () => {
    expect(fr.size).toBe(en.size);
  });

  it('aucune clé présente en FR et absente en EN', () => {
    const missing = [...fr.keys()].filter((k) => !en.has(k));
    expect(missing, `clés absentes en EN : ${missing.join(', ')}`).toEqual([]);
  });

  it('aucune clé présente en EN et absente en FR', () => {
    const missing = [...en.keys()].filter((k) => !fr.has(k));
    expect(missing, `clés absentes en FR : ${missing.join(', ')}`).toEqual([]);
  });

  it('aucune valeur vide', () => {
    const empty: string[] = [];
    for (const [name, dict] of [['fr', fr], ['en', en]] as const) {
      for (const [k, v] of dict) {
        if (typeof v === 'string' && v.trim() === '') empty.push(`${name}:${k}`);
      }
    }
    expect(empty, `valeurs vides : ${empty.join(', ')}`).toEqual([]);
  });
});
