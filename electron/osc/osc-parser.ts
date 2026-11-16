/**
 * Parseur binaire OSC (Open Sound Control) — lot #16 (OSC entrant).
 *
 * Spec 1.0 (Stanford, Matt Wright, mars 2002) : opensoundcontrol.stanford.edu/spec-1_0.html
 *
 * - Zéro dépendance, aucun import electron : module pur, testable hors d'Electron
 *   (même contrainte que `electron/remote/server.ts` et `electron/midi/mtc.ts`).
 * - Big-endian partout, alignement 4 octets, padding nul.
 * - Gère : messages (adresse + type tags + args i/f/s/b/T/F), bundles `#bundle`
 *   (timetag 64 bits lu en bigint mais IGNORÉ : exécution immédiate, décision v1),
 *   type tag string absente (robustesse spec : message sans arguments).
 * - Tout type inconnu → `OscParseError` (rejet du message ENTIER, jamais
 *   d'exécution partielle — règle d'or de la spec).
 * - Toutes les lectures passent par des gardes de bornes : jamais de lecture
 *   hors buffer (Buffer.readInt32BE throw sinon). Une erreur de parse = le
 *   paquet entier est écarté côté serveur (drop + log), jamais de crash.
 * - Récursion des bundles bornée à `MAX_BUNDLE_DEPTH` (paquet hostile → erreur).
 */

/** Argument OSC décodé. */
export type OscArg =
  | { type: 'i'; value: number } // int32 big-endian
  | { type: 'f'; value: number } // float32 big-endian
  | { type: 's'; value: string } // OSC-string (nul-terminée + padding 4)
  | { type: 'b'; value: Buffer } // OSC-blob (taille int32 + données + padding)
  | { type: 'T'; value: true } // 0 octet dans le packet
  | { type: 'F'; value: false }; // 0 octet dans le packet

/** Message OSC décodé : adresse (commence par '/') + arguments ordonnés. */
export interface OscMessage {
  address: string;
  args: OscArg[];
}

/** Packet OSC : soit un Message, soit un Bundle (récursif). */
export type OscPacket =
  | { kind: 'message'; message: OscMessage }
  | { kind: 'bundle'; timetag: bigint; elements: OscPacket[] };

/** Erreur de parsing : le paquet est malformé, à écarter entièrement. */
export class OscParseError extends Error {
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(`${message} (offset ${offset})`);
    this.name = 'OscParseError';
    this.offset = offset;
  }
}

/** Profondeur maximale de récursion des bundles (anti stack overflow). */
export const MAX_BUNDLE_DEPTH = 16;

/** Taille max d'un packet accepté (octets). UDP IPv4 plafonne à ~65 Ko. */
export const MAX_PACKET_BYTES = 64 * 1024;

const BUNDLE_TAG = '#bundle';
/**
 * Lit une OSC-string à `offset` : séquence de caractères non nuls terminée par
 * `\0`, puis 0 à 3 `\0` de padding pour que le total soit un multiple de 4.
 * Retourne la string (sans le `\0` final) et l'offset après le padding.
 * Décode en UTF-8 (tolérant : octets invalides remplacés, jamais d'échec).
 */
function readOscString(buffer: Buffer, offset: number): { value: string; end: number } {
  if (offset >= buffer.length) {
    throw new OscParseError('OSC-string: buffer vide', offset);
  }
  const nul = buffer.indexOf(0, offset);
  if (nul === -1) {
    throw new OscParseError('OSC-string non terminée', offset);
  }
  const value = buffer.toString('utf8', offset, nul);
  // Padding : prochain multiple de 4 après le `\0` (inclus).
  const end = Math.ceil((nul + 1) / 4) * 4;
  if (end > buffer.length) {
    throw new OscParseError('OSC-string: padding hors bornes', nul);
  }
  return { value, end };
}

/**
 * Lit un bloc de `size` octets alignés sur 4 (padding inclus) ; le contenu utile
 * fait `size` octets, suivi de 0 à 3 zéros. Retourne le contenu et l'offset après
 * le padding. Le padding n'est PAS validé octet par octet (tolérance : la spec
 * impose des zéros, certains émetteurs envoient autre chose sans que le contenu
 * soit ambigu — on n'échoue jamais sur un paquet par ailleurs lisible).
 */
function readBlob(buffer: Buffer, offset: number): { value: Buffer; end: number } {
  if (offset + 4 > buffer.length) {
    throw new OscParseError('blob: taille manquante', offset);
  }
  const size = buffer.readInt32BE(offset);
  if (size < 0 || offset + 4 + size > buffer.length) {
    throw new OscParseError(`blob: taille incohérente (${size})`, offset);
  }
  const value = buffer.subarray(offset + 4, offset + 4 + size);
  const end = offset + 4 + Math.ceil(size / 4) * 4;
  if (end > buffer.length) {
    throw new OscParseError('blob: padding hors bornes', offset + 4 + size);
  }
  return { value, end };
}

/** Décode un message OSC à partir de `offset` (adresse + tags + args). */
function parseMessage(buffer: Buffer, offset: number): { message: OscMessage; end: number } {
  const addr = readOscString(buffer, offset);
  if (!addr.value.startsWith('/')) {
    throw new OscParseError(`adresse OSC invalide (doit commencer par '/')`, offset);
  }
  let cursor = addr.end;
  const args: OscArg[] = [];

  // Type tag string : présente si la string suivante commence par ','.
  // Robustesse spec 1.0 : les vieilles implémentations l'omettent → 0 argument.
  if (cursor < buffer.length && buffer[cursor] === 0x2c /* ',' */) {
    const tags = readOscString(buffer, cursor);
    cursor = tags.end;
    for (const tag of tags.value.slice(1)) {
      switch (tag) {
        case 'i': {
          if (cursor + 4 > buffer.length) {
            throw new OscParseError(`arg 'i' tronqué`, cursor);
          }
          args.push({ type: 'i', value: buffer.readInt32BE(cursor) });
          cursor += 4;
          break;
        }
        case 'f': {
          if (cursor + 4 > buffer.length) {
            throw new OscParseError(`arg 'f' tronqué`, cursor);
          }
          args.push({ type: 'f', value: buffer.readFloatBE(cursor) });
          cursor += 4;
          break;
        }
        case 's': {
          const s = readOscString(buffer, cursor);
          args.push({ type: 's', value: s.value });
          cursor = s.end;
          break;
        }
        case 'b': {
          const blob = readBlob(buffer, cursor);
          args.push({ type: 'b', value: blob.value });
          cursor = blob.end;
          break;
        }
        case 'T':
          args.push({ type: 'T', value: true });
          break;
        case 'F':
          args.push({ type: 'F', value: false });
          break;
        default:
          // Règle d'or de la spec : type inconnu → rejeter le message ENTIER.
          throw new OscParseError(`type tag inconnu '${tag}'`, cursor);
      }
    }
  }

  return { message: { address: addr.value, args }, end: cursor };
}

/** Décode un bundle `#bundle` + timetag + éléments (récursif, borné). */
function parseBundle(buffer: Buffer, offset: number, depth: number): { packet: OscPacket; end: number } {
  if (depth > MAX_BUNDLE_DEPTH) {
    throw new OscParseError(`bundle: profondeur maximale dépassée`, offset);
  }
  if (offset + 16 > buffer.length) {
    throw new OscParseError('bundle: en-tête tronqué', offset);
  }
  // Le tag est l'OSC-string `#bundle\0` : 7 caractères + NUL (8 octets),
  // puis le timetag 8 octets. Comparaison tolérante (latin1, pas d'UTF-8
  // multi-octets possible sur un tag) + vérification explicite du NUL.
  if (
    buffer.toString('latin1', offset, offset + 7) !== BUNDLE_TAG ||
    buffer[offset + 7] !== 0
  ) {
    throw new OscParseError('bundle: tag invalide', offset);
  }
  const timetag = buffer.readBigUInt64BE(offset + 8);
  let cursor = offset + 16;
  const elements: OscPacket[] = [];
  while (cursor < buffer.length) {
    if (cursor + 4 > buffer.length) {
      throw new OscParseError('bundle: taille d\'élément tronquée', cursor);
    }
    const size = buffer.readInt32BE(cursor);
    if (size < 0 || cursor + 4 + size > buffer.length) {
      throw new OscParseError(`bundle: taille d'élément incohérente (${size})`, cursor);
    }
    cursor += 4;
    if (size === 0) {
      // Élément vide : autorisé par la spec → ignorer proprement.
      continue;
    }
    const element = parseOscPacket(buffer.subarray(cursor, cursor + size), depth + 1);
    elements.push(element);
    cursor += size;
  }
  return { packet: { kind: 'bundle', timetag, elements }, end: cursor };
}

/**
 * Point d'entrée : décode un packet OSC complet (message OU bundle).
 * Lève `OscParseError` sur tout paquet malformé — l'appelant écarte le paquet.
 */
export function parseOscPacket(buffer: Buffer, depth = 0): OscPacket {
  if (!Buffer.isBuffer(buffer)) {
    throw new OscParseError('paquet: Buffer attendu', 0);
  }
  if (buffer.length < 4) {
    throw new OscParseError(`paquet trop court (${buffer.length} octets)`, 0);
  }
  if (buffer.length > MAX_PACKET_BYTES) {
    throw new OscParseError(`paquet trop grand (${buffer.length} octets)`, 0);
  }
  const first = buffer[0];
  if (first === 0x2f /* '/' */) {
    const { message, end } = parseMessage(buffer, 0);
    // Le message doit occuper le paquet entier (pas de données parasites).
    if (end !== buffer.length) {
      throw new OscParseError(`message: données parasites après la fin (${buffer.length - end} octets)`, end);
    }
    return { kind: 'message', message };
  }
  if (first === 0x23 /* '#' */) {
    const { packet, end } = parseBundle(buffer, 0, depth);
    if (end !== buffer.length) {
      throw new OscParseError('bundle: données parasites après la fin', end);
    }
    return packet;
  }
  throw new OscParseError(`paquet ni message ni bundle (1er octet 0x${first.toString(16)})`, 0);
}
