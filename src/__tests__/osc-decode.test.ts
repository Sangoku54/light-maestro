/**
 * Tests du lot #16 (OSC entrant) :
 *   - parseur binaire OSC pur (electron/osc/osc-parser.ts) : messages,
 *     bundles, types i/f/s/b/T/F, padding 4 octets, big-endian, erreurs
 *   - mapping d'adresses (electron/osc/server.ts mapOscAddress) : id + index
 *     1-based, routes d'action = déclencheur (valeur ignorée), /blackout et
 *     /grandmaster lisent la valeur
 *
 * Pattern du repo : fonctions pures, environnement node (vitest.config.ts),
 * comme mtc-decode.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  OscParseError,
  parseOscPacket,
  MAX_BUNDLE_DEPTH,
  type OscArg,
} from '../../electron/osc/osc-parser';
import { mapOscAddress } from '../../electron/osc/server';

// ─── Helpers d'encodage OSC (miroir test-only du format binaire) ─────────

/** Encode une OSC-string : contenu + \0 + padding multiple de 4. */
function oscString(value: string): Buffer {
  const body = Buffer.from(value, 'utf8');
  const withNul = Buffer.concat([body, Buffer.from([0])]);
  const padded = Buffer.alloc(Math.ceil(withNul.length / 4) * 4);
  withNul.copy(padded);
  return padded;
}

/** Encode un message OSC : address + typestring + args encodés. */
function oscMessage(address: string, args: OscArg[] = []): Buffer {
  const parts: Buffer[] = [oscString(address)];
  if (args.length > 0) {
    const tags = Buffer.from(',' + args.map((a) => a.type).join(''));
    parts.push(oscString(tags.toString('utf8')));
    for (const arg of args) {
      if (arg.type === 'i') {
        const b = Buffer.alloc(4);
        b.writeInt32BE(arg.value);
        parts.push(b);
      } else if (arg.type === 'f') {
        const b = Buffer.alloc(4);
        b.writeFloatBE(arg.value);
        parts.push(b);
      } else if (arg.type === 's') {
        parts.push(oscString(arg.value));
      } else if (arg.type === 'b') {
        const size = Buffer.alloc(4);
        size.writeInt32BE(arg.value.length);
        const padded = Buffer.alloc(Math.ceil(arg.value.length / 4) * 4);
        arg.value.copy(padded);
        parts.push(size, padded);
      }
      // T/F : aucun octet.
    }
  }
  return Buffer.concat(parts);
}

/** Encode un bundle : tag `#bundle\0` (8 octets, OSC-string) + timetag + éléments. */
function oscBundle(elements: Buffer[]): Buffer {
  const tag = Buffer.from('#bundle\0');
  const timetag = Buffer.alloc(8);
  timetag.writeBigUInt64BE(1n);
  const parts: Buffer[] = [tag, timetag];
  for (const el of elements) {
    const size = Buffer.alloc(4);
    size.writeInt32BE(el.length);
    parts.push(size, el);
  }
  return Buffer.concat(parts);
}

// ─── Parseur : messages ──────────────────────────────────────────────────

describe('parseOscPacket - messages', () => {
  it('décode un message sans argument (typestring absente)', () => {
    const buf = oscString('/scene/abc/play');
    const pkt = parseOscPacket(buf);
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') {
      expect(pkt.message.address).toBe('/scene/abc/play');
      expect(pkt.message.args).toEqual([]);
    }
  });

  it('décode un message avec typestring seule (0 argument)', () => {
    // Typestring `,` seule : forme OSC valide. Le helper n'émet la typestring
    // que si args > 0 → construction manuelle pour couvrir ce chemin.
    const buf = Buffer.concat([oscString('/blackout'), oscString(',')]);
    const pkt = parseOscPacket(buf);
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') {
      expect(pkt.message.address).toBe('/blackout');
      expect(pkt.message.args).toEqual([]);
    }
  });

  it('décode un float32 big-endian', () => {
    const buf = oscMessage('/grandmaster', [{ type: 'f', value: 0.5 }]);
    const pkt = parseOscPacket(buf);
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') {
      expect(pkt.message.args[0]).toEqual({ type: 'f', value: 0.5 });
    }
  });

  it('décode un int32 big-endian', () => {
    const buf = oscMessage('/grandmaster', [{ type: 'i', value: 42 }]);
    const pkt = parseOscPacket(buf);
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') {
      expect(pkt.message.args[0]).toEqual({ type: 'i', value: 42 });
    }
  });

  it('décode T/F (zéro octet)', () => {
    const buf = oscMessage('/blackout', [{ type: 'T', value: true }]);
    const pkt = parseOscPacket(buf);
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') {
      expect(pkt.message.args[0]).toEqual({ type: 'T', value: true });
    }
  });

  it('décode une string et un blob avec padding', () => {
    const blob = Buffer.from([1, 2, 3]);
    const buf = oscMessage('/x', [{ type: 's', value: 'hi' }, { type: 'b', value: blob }]);
    const pkt = parseOscPacket(buf);
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') {
      expect(pkt.message.args[0]).toEqual({ type: 's', value: 'hi' });
      expect(pkt.message.args[1]).toEqual({ type: 'b', value: Buffer.from([1, 2, 3]) });
    }
  });

  it('gère le padding de string non-multiple de 4', () => {
    // "abcdef" (6) + \0 = 7 → padding à 8
    const buf = oscString('/abcdefgh');
    const pkt = parseOscPacket(buf);
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') {
      expect(pkt.message.address).toBe('/abcdefgh');
    }
  });

  it('rejette un type tag inconnu (message entier écarté)', () => {
    const addr = oscString('/scene/x/play');
    const tags = oscString(',c'); // 'c' = char, non géré
    const buf = Buffer.concat([addr, tags]);
    expect(() => parseOscPacket(buf)).toThrow(OscParseError);
  });

  it('rejette une adresse qui ne commence pas par /', () => {
    const buf = oscString('scene/x/play');
    expect(() => parseOscPacket(buf)).toThrow(OscParseError);
  });

  it('rejette un paquet trop court', () => {
    expect(() => parseOscPacket(Buffer.from([0x2f, 0x00]))).toThrow(OscParseError);
  });

  it('rejette un premier octet ni / ni #', () => {
    expect(() => parseOscPacket(Buffer.from([0x41, 0x42, 0x43, 0x44]))).toThrow(OscParseError);
  });

  it('rejette un message avec données parasites après la fin', () => {
    const msg = oscMessage('/scene/x/play');
    const buf = Buffer.concat([msg, Buffer.from([0, 0, 0, 0])]);
    expect(() => parseOscPacket(buf)).toThrow(OscParseError);
  });

  it('rejette un arg int tronqué', () => {
    const addr = oscString('/grandmaster');
    const tags = oscString(',i');
    const buf = Buffer.concat([addr, tags, Buffer.from([0, 0])]); // 2 octets au lieu de 4
    expect(() => parseOscPacket(buf)).toThrow(OscParseError);
  });
});

// ─── Parseur : bundles ───────────────────────────────────────────────────

describe('parseOscPacket - bundles', () => {
  it('décode un bundle avec deux messages (timetag ignoré)', () => {
    const buf = oscBundle([oscMessage('/scene/a/play'), oscMessage('/scene/b/stop')]);
    const pkt = parseOscPacket(buf);
    expect(pkt.kind).toBe('bundle');
    if (pkt.kind === 'bundle') {
      expect(pkt.timetag).toBe(1n);
      expect(pkt.elements).toHaveLength(2);
      expect(pkt.elements[0]).toMatchObject({ kind: 'message' });
    }
  });

  it('décode des bundles imbriqués', () => {
    const inner = oscBundle([oscMessage('/scene/a/play')]);
    const outer = oscBundle([inner]);
    const pkt = parseOscPacket(outer);
    expect(pkt.kind).toBe('bundle');
    if (pkt.kind === 'bundle') {
      expect(pkt.elements[0]).toMatchObject({ kind: 'bundle' });
    }
  });

  it('ignore les éléments vides (taille 0)', () => {
    const tag = Buffer.from('#bundle\0');
    const timetag = Buffer.alloc(8);
    const size = Buffer.alloc(4); // 0
    const buf = Buffer.concat([tag, timetag, size]);
    const pkt = parseOscPacket(buf);
    expect(pkt.kind).toBe('bundle');
    if (pkt.kind === 'bundle') {
      expect(pkt.elements).toHaveLength(0);
    }
  });

  it('rejette une profondeur de bundles excessive', () => {
    let buf = oscMessage('/scene/a/play');
    for (let i = 0; i <= MAX_BUNDLE_DEPTH + 1; i++) {
      buf = oscBundle([buf]);
    }
    expect(() => parseOscPacket(buf)).toThrow(OscParseError);
  });

  it('rejette un bundle au tag invalide', () => {
    const buf = Buffer.concat([oscString('#notabundle'), oscMessage('/x')]);
    expect(() => parseOscPacket(buf)).toThrow(OscParseError);
  });

  it("rejette un bundle avec taille d'élément incohérente", () => {
    const tag = Buffer.from('#bundle\0');
    const timetag = Buffer.alloc(8);
    const size = Buffer.alloc(4);
    size.writeInt32BE(9999);
    const buf = Buffer.concat([tag, timetag, size]);
    expect(() => parseOscPacket(buf)).toThrow(OscParseError);
  });
});

// ─── Mapping : scènes et chasers ─────────────────────────────────────────

describe('mapOscAddress - scènes/chasers', () => {
  it('mappe /scene/<id>/play', () => {
    const pkt = parseOscPacket(oscMessage('/scene/scn-1/play'));
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') {
      expect(mapOscAddress(pkt.message)).toEqual({ type: 'scene', id: 'scn-1', action: 'play' });
    }
  });

  it('mappe /scene/<id>/toggle avec valeur ignorée (push TouchOSC 1.0)', () => {
    const pkt = parseOscPacket(oscMessage('/scene/scn-1/toggle', [{ type: 'f', value: 1 }]));
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') {
      expect(mapOscAddress(pkt.message)).toEqual({ type: 'scene', id: 'scn-1', action: 'toggle' });
    }
  });

  it('mappe /scene/<id>/toggle avec valeur 0.0 : PAS de stop fantôme', () => {
    // Le release d'un push button TouchOSC envoie 0.0 — la route d'action doit
    // ignorer la valeur et déclencher le toggle quand même (spec lot #16).
    const pkt = parseOscPacket(oscMessage('/scene/scn-1/toggle', [{ type: 'f', value: 0 }]));
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') {
      expect(mapOscAddress(pkt.message)).toEqual({ type: 'scene', id: 'scn-1', action: 'toggle' });
    }
  });

  it('mappe /scene/index/<n>/play en index 0-based', () => {
    const pkt = parseOscPacket(oscMessage('/scene/index/3/play'));
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') {
      expect(mapOscAddress(pkt.message)).toEqual({ type: 'scene', index: 2, action: 'play' });
    }
  });

  it('rejette /scene/index/0/play (index 1-based obligatoire)', () => {
    const pkt = parseOscPacket(oscMessage('/scene/index/0/play'));
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') {
      expect(mapOscAddress(pkt.message)).toBeNull();
    }
  });

  it('rejette une action de scène inconnue', () => {
    const pkt = parseOscPacket(oscMessage('/scene/scn-1/explode'));
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') {
      expect(mapOscAddress(pkt.message)).toBeNull();
    }
  });

  it('mappe /chaser/<id>/next et /chaser/index/2/previous', () => {
    const p1 = parseOscPacket(oscMessage('/chaser/ch-9/next'));
    expect(p1.kind).toBe('message');
    if (p1.kind === 'message') {
      expect(mapOscAddress(p1.message)).toEqual({ type: 'chaser', id: 'ch-9', action: 'next' });
    }
    const p2 = parseOscPacket(oscMessage('/chaser/index/2/previous'));
    expect(p2.kind).toBe('message');
    if (p2.kind === 'message') {
      expect(mapOscAddress(p2.message)).toEqual({ type: 'chaser', index: 1, action: 'previous' });
    }
  });

  it('rejette une adresse inconnue', () => {
    const pkt = parseOscPacket(oscMessage('/foo/bar'));
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') {
      expect(mapOscAddress(pkt.message)).toBeNull();
    }
  });
});

// ─── Mapping : blackout et grand master (la valeur compte) ───────────────

describe('mapOscAddress - blackout/grandMaster', () => {
  it('/blackout T → on:true', () => {
    const pkt = parseOscPacket(oscMessage('/blackout', [{ type: 'T', value: true }]));
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') expect(mapOscAddress(pkt.message)).toEqual({ type: 'blackout', on: true });
  });

  it('/blackout f 0.0 → on:false', () => {
    const pkt = parseOscPacket(oscMessage('/blackout', [{ type: 'f', value: 0 }]));
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') expect(mapOscAddress(pkt.message)).toEqual({ type: 'blackout', on: false });
  });

  it('/blackout i 1 → on:true', () => {
    const pkt = parseOscPacket(oscMessage('/blackout', [{ type: 'i', value: 1 }]));
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') expect(mapOscAddress(pkt.message)).toEqual({ type: 'blackout', on: true });
  });

  it('/blackout sans argument → on:true (déclencheur)', () => {
    const pkt = parseOscPacket(oscMessage('/blackout'));
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') expect(mapOscAddress(pkt.message)).toEqual({ type: 'blackout', on: true });
  });

  it('/grandmaster f 0.5 → value 0.5', () => {
    const pkt = parseOscPacket(oscMessage('/grandmaster', [{ type: 'f', value: 0.5 }]));
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') expect(mapOscAddress(pkt.message)).toEqual({ type: 'grandMaster', value: 0.5 });
  });

  it('/grandmaster i 100 → value 1 (0-100 → 0-1, convention Chamsys)', () => {
    const pkt = parseOscPacket(oscMessage('/grandmaster', [{ type: 'i', value: 100 }]));
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') expect(mapOscAddress(pkt.message)).toEqual({ type: 'grandMaster', value: 1 });
  });

  it('/grandmaster i 50 → value 0.5', () => {
    const pkt = parseOscPacket(oscMessage('/grandmaster', [{ type: 'i', value: 50 }]));
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') expect(mapOscAddress(pkt.message)).toEqual({ type: 'grandMaster', value: 0.5 });
  });

  it('/grandmaster f 1.5 → null (hors bornes 0-1)', () => {
    const pkt = parseOscPacket(oscMessage('/grandmaster', [{ type: 'f', value: 1.5 }]));
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') expect(mapOscAddress(pkt.message)).toBeNull();
  });

  it('/grandmaster i 127 → null (jamais 0-127, spec lot #16)', () => {
    const pkt = parseOscPacket(oscMessage('/grandmaster', [{ type: 'i', value: 127 }]));
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') expect(mapOscAddress(pkt.message)).toBeNull();
  });

  it('/grandmaster sans argument → null', () => {
    const pkt = parseOscPacket(oscMessage('/grandmaster'));
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') expect(mapOscAddress(pkt.message)).toBeNull();
  });

  it("/grandmaster/0.75 → value 0.75 (valeur dans l'adresse)", () => {
    const pkt = parseOscPacket(oscMessage('/grandmaster/0.75'));
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') expect(mapOscAddress(pkt.message)).toEqual({ type: 'grandMaster', value: 0.75 });
  });

  it('/grandmaster/2 → null (hors bornes)', () => {
    const pkt = parseOscPacket(oscMessage('/grandmaster/2'));
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') expect(mapOscAddress(pkt.message)).toBeNull();
  });

  it('multi-args : 1er argument pris, le reste ignoré (multislider Lemur)', () => {
    const pkt = parseOscPacket(oscMessage('/grandmaster', [{ type: 'f', value: 0.25 }, { type: 'f', value: 0.9 }]));
    expect(pkt.kind).toBe('message');
    if (pkt.kind === 'message') expect(mapOscAddress(pkt.message)).toEqual({ type: 'grandMaster', value: 0.25 });
  });
});
