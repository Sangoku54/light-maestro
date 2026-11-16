/**
 * GDTF (General Device Type Format) parser
 *
 * Converts a `.gdtf` fixture file into a Light Maestro FixtureDefinition.
 *
 * A `.gdtf` is a ZIP archive containing (at minimum) a `description.xml`.
 * We only read `description.xml` — the `wheels/` (gobo images) and `models/`
 * (3D glTF) entries are visual assets and are not needed to extract the DMX
 * modes, channels and capabilities.
 *
 * Schema reference (verified against the official spec `gdtf-spec.md`):
 *   .cluster/fixture-libraries/subagent_gdtf_schema.md
 *
 * Key facts encoded here:
 *  - Manufacturer/Model come from FixtureType/@Manufacturer and @Name (or @ShortName).
 *  - Geometries are referenced by NAME (DMXMode/@Geometry, DMXChannel/@Geometry).
 *  - DMXChannel/@Offset is a 1-based DMX slot array (one entry per byte, MSB first).
 *    Offset="None" → virtual channel (no DMX address) → skipped.
 *  - A channel's DMX range end is NOT stored: end = next sibling's DMXFrom - 1,
 *    otherwise 256^byteCount - 1.
 *  - ChannelSets are the concrete named ranges ("capabilities").
 *
 * This module deliberately imports nothing from 'electron' so it can be unit
 * tested under vitest. It is wired into the FixtureLibrary in ./library.ts.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { parseStringPromise } from 'xml2js';
import type { FixtureDefinition, FixtureChannel, FixtureCapability } from './library';

// ─── GDTF attribute → channel type mapping ─────────────────
// Attribute names are matched case-insensitively, underscores ignored
// (spec Annex B: "the upper and lower case of attribute names is not taken
// into account").

function normalizeAttr(a: string): string {
  return a.toLowerCase().replace(/_/g, '');
}

const GDTF_EXACT_TYPE: Record<string, FixtureChannel['type']> = {
  dimmer: 'Intensity',
  // additive emitters
  coloraddr: 'Colour',
  coloraddg: 'Colour',
  coloraddb: 'Colour',
  coloraddc: 'Colour',
  coloraddm: 'Colour',
  coloraddy: 'Colour',
  coloraddw: 'Colour',
  coloraddww: 'Colour',
  coloraddcw: 'Colour',
  coloradduv: 'Colour',
  coloraddlime: 'Colour',
  coloraddamber: 'Colour',
  coloraddindigo: 'Colour',
  // subtractive flags
  colorsubc: 'Colour',
  colorsubm: 'Colour',
  colorsuby: 'Colour',
  // indirect RGB / HSB
  colorrgbred: 'Colour',
  colorrgbgreen: 'Colour',
  colorrgbblue: 'Colour',
  hsbhue: 'Colour',
  hsbsaturation: 'Colour',
  hsbbrightness: 'Colour',
  // colour temperature correction
  cto: 'Colour',
  ctb: 'Colour',
  ctc: 'Colour',
  // position
  pan: 'Pan',
  tilt: 'Tilt',
  panrotate: 'Pan',
  tiltrotate: 'Tilt',
  // beam
  zoom: 'Beam',
  iris: 'Beam',
  beamshaper: 'Beam',
  zoommode: 'Beam',
  zoommodespot: 'Beam',
  zoommodebeam: 'Beam',
  // speed / effect / control
  pantiltspeed: 'Speed',
  pantiltmode: 'Effect',
  panmode: 'Effect',
  tiltmode: 'Effect',
  effectspeed: 'Speed',
  effectduration: 'Speed',
  strobemode: 'Shutter',
  colorwheel: 'Colour',
  colorwheelspin: 'Speed',
  colorwheelrotation: 'Speed',
  // no function
  nofeature: 'Nothing',
};

export function gdtfAttributeToType(attr: string): FixtureChannel['type'] {
  if (!attr) return 'Nothing';
  const n = normalizeAttr(attr);
  if (GDTF_EXACT_TYPE[n]) return GDTF_EXACT_TYPE[n];
  // Enumerated families: Gobo1..n, Color1..n (wheel), Shutter1..n, Prism1..n,
  // Frost1..n, Focus1..n, Effects1..n, Control1..n
  if (/^gobo/.test(n)) return 'Gobo';
  if (/^color\d/.test(n)) return 'Colour';
  if (/^shutter/.test(n)) return 'Shutter';
  if (/^strobe/.test(n)) return 'Shutter';
  if (/^prism/.test(n)) return 'Prism';
  if (/^frost/.test(n)) return 'Beam';
  if (/^focus/.test(n)) return 'Beam';
  if (/^effects/.test(n)) return 'Effect';
  if (/^(control|lampcontrol)/.test(n)) return 'Maintenance';
  return 'Nothing';
}

// ─── DMXValue helper ───────────────────────────────────────
// DMXValue format: "value/byteCount" with optional "s" suffix (byte shifting).
// e.g. "0/1", "255/1", "65535/2". With "s", the value occupies the high byte
// of a wider value ("255/1s" = 65280 in 16 bits) → we shift + widen accordingly.

function parseDmxValue(raw: unknown): { value: number; byteCount: number } | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  const m = /^(\d+)\/(\d+)(s)?$/.exec(s);
  if (!m) return null;
  let value = parseInt(m[1], 10);
  let byteCount = parseInt(m[2], 10) || 1;
  if (m[3] === 's') {
    value = value << (8 * byteCount);
    byteCount += 1;
  }
  return { value, byteCount };
}

/** Convert a full-resolution DMX value to its coarse byte (0-255). */
function toCoarse(value: number, byteCount: number): number {
  if (byteCount <= 1) return Math.max(0, Math.min(255, Math.round(value)));
  const coarse = Math.floor(value / Math.pow(256, byteCount - 1));
  return Math.max(0, Math.min(255, coarse));
}

function channelMax(byteCount: number): number {
  return Math.pow(256, byteCount) - 1;
}

/** Parse Offset attribute: "None" → 0 bytes, "1" → [1], "1,2" → [1,2]. */
function parseOffset(raw: unknown): { slots: number[]; byteCount: number } {
  if (raw == null) return { slots: [], byteCount: 0 };
  const s = String(raw).trim();
  if (!s || s === 'None') return { slots: [], byteCount: 0 };
  const slots = s.split(',').map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n));
  return { slots, byteCount: slots.length };
}

// ─── Colour name → hex (for color-wheel ChannelSets) ───────

const GDTF_COLOR_MAP: Record<string, string> = {
  red: '#ff0000', green: '#00ff00', blue: '#0000ff', white: '#ffffff',
  black: '#000000', yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff',
  orange: '#ff8000', amber: '#ffbf00', purple: '#8000ff', pink: '#ff80c0',
  uv: '#8000ff', lime: '#00ff00', 'warm white': '#ffe4b5', 'cold white': '#f0f8ff',
  'neutral white': '#f5f5dc', lavender: '#e6e6fa', turquoise: '#40e0d0',
};

function colorHexFromName(name: string): string | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase().trim();
  if (GDTF_COLOR_MAP[lower]) return GDTF_COLOR_MAP[lower];
  for (const [key, hex] of Object.entries(GDTF_COLOR_MAP)) {
    if (lower.includes(key)) return hex;
  }
  return undefined;
}

// ─── Geometry tree walk ────────────────────────────────────

const GEOMETRY_TAGS = [
  'Geometry', 'Axis', 'FilterBeam', 'FilterColor', 'FilterGobo', 'FilterShaper',
  'Beam', 'MediaServerLayer', 'MediaServerCamera', 'MediaServerMaster', 'Display',
  'GeometryReference', 'Laser', 'WiringObject', 'Inventory', 'Structure', 'Support', 'Magnet',
];

function collectGeometries(
  geoSection: any,
  names: Set<string>,
  kinds: Set<string>
): void {
  if (!geoSection) return;
  for (const tag of GEOMETRY_TAGS) {
    const list = geoSection[tag];
    if (!list) continue;
    const arr = Array.isArray(list) ? list : [list];
    for (const g of arr) {
      if (g && g.$ && g.$.Name) names.add(String(g.$.Name));
      kinds.add(tag.toLowerCase());
      collectGeometries(g, names, kinds);
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────

function prettyAttr(attr: string, attrPretty: Map<string, string>): string {
  const key = attr.toLowerCase();
  if (attrPretty.has(key)) return attrPretty.get(key)!;
  const prettified = attr
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim();
  return prettified || attr;
}

function extractAuthor(ft: any): string {
  const rev = ft.Revisions?.[0]?.Revision;
  const revList = rev ? (Array.isArray(rev) ? rev : [rev]) : [];
  for (const r of revList) {
    if (r?.$?.ModifiedBy) return String(r.$.ModifiedBy);
  }
  return 'GDTF Import';
}

function inferType(kinds: Set<string>, attrs: Set<string>): FixtureDefinition['type'] {
  if (kinds.has('laser')) return 'Laser';
  const hasPan = attrs.has('pan') || attrs.has('panrotate');
  const hasTilt = attrs.has('tilt') || attrs.has('tiltrotate');
  const hasColor = [...attrs].some((a) => a.startsWith('color') || a === 'cto' || a === 'ctb' || a === 'ctc' || a.startsWith('hsb'));
  const hasDimmer = attrs.has('dimmer');
  const hasStrobe = [...attrs].some((a) => a.startsWith('shutter') || a.startsWith('strobe'));
  if (hasPan && hasTilt) return 'Moving Head';
  if (hasColor) return 'Color Changer';
  if (hasStrobe) return 'Strobe';
  if (hasDimmer) return 'Dimmer';
  return 'Other';
}

function buildCapabilities(lc: any, byteCount: number): FixtureCapability[] {
  const caps: FixtureCapability[] = [];
  const maxVal = channelMax(byteCount);
  const cfList = lc?.ChannelFunction
    ? (Array.isArray(lc.ChannelFunction) ? lc.ChannelFunction : [lc.ChannelFunction])
    : [];
  const cfStarts = cfList.map((cf: any) => parseDmxValue(cf?.$?.DMXFrom)?.value ?? 0);
  for (let fi = 0; fi < cfList.length; fi++) {
    const cf = cfList[fi];
    const cfStart = cfStarts[fi];
    const cfEnd = fi + 1 < cfList.length ? cfStarts[fi + 1] - 1 : maxVal;
    const csList = cf?.ChannelSet
      ? (Array.isArray(cf.ChannelSet) ? cf.ChannelSet : [cf.ChannelSet])
      : [];

    if (csList.length === 0) {
      // No ChannelSets: a single named function range (rare).
      const cfName = cf?.$?.Name;
      if (cfName) {
        caps.push({ min: toCoarse(cfStart, byteCount), max: toCoarse(cfEnd, byteCount), name: String(cfName) });
      }
      continue;
    }

    const csStarts = csList.map((cs: any) => parseDmxValue(cs?.$?.DMXFrom)?.value ?? cfStart);
    for (let si = 0; si < csList.length; si++) {
      const cs = csList[si];
      const csStart = csStarts[si];
      const csEnd = si + 1 < csList.length ? csStarts[si + 1] - 1 : cfEnd;
      const name = cs?.$?.Name || '';
      if (!name) continue; // unnamed range (e.g. gap between closed/open) → skip
      const cap: FixtureCapability = {
        min: toCoarse(csStart, byteCount),
        max: toCoarse(csEnd, byteCount),
        name,
      };
      const colorHex = colorHexFromName(name);
      if (colorHex) cap.color = colorHex;
      caps.push(cap);
    }
  }
  return caps;
}

// ─── Public API ────────────────────────────────────────────

/** Parse a GDTF `description.xml` document into a FixtureDefinition. */
export async function parseGdtfXml(
  xml: string,
  opts?: { sourceName?: string }
): Promise<FixtureDefinition | null> {
  try {
    const parsed: any = await parseStringPromise(xml, { explicitArray: true, mergeAttrs: false });
    const gdtf = parsed?.GDTF;
    if (!gdtf) return null;
    const ft = Array.isArray(gdtf.FixtureType) ? gdtf.FixtureType[0] : gdtf.FixtureType;
    if (!ft) return null;

    const manufacturer = ft.$?.Manufacturer || 'Unknown';
    const model = ft.$?.Name || ft.$?.ShortName || ft.$?.LongName || 'Unknown';
    const author = extractAuthor(ft) || 'GDTF Import';

    // Attribute map: name (lower) → pretty display name
    const attrPretty = new Map<string, string>();
    const attrList = ft.AttributeDefinitions?.[0]?.Attributes?.[0]?.Attribute;
    const attrs = attrList ? (Array.isArray(attrList) ? attrList : [attrList]) : [];
    for (const a of attrs) {
      if (a?.$?.Name) attrPretty.set(String(a.$.Name).toLowerCase(), String(a.$.Pretty || a.$.Name));
    }

    // Geometry names + kinds (for channel naming and type inference)
    const geometryNames = new Set<string>();
    const geometryKinds = new Set<string>();
    collectGeometries(ft.Geometries?.[0], geometryNames, geometryKinds);

    // Modes
    const modes: FixtureDefinition['modes'] = [];
    const dmxModeList = ft.DMXModes?.[0]?.DMXMode;
    const modeList = dmxModeList ? (Array.isArray(dmxModeList) ? dmxModeList : [dmxModeList]) : [];
    const usedAttrs = new Set<string>();

    for (const mode of modeList) {
      const modeName = mode?.$?.Name || 'Default';
      const rootGeo = mode?.$?.Geometry || '';
      const dmxChList = mode?.DMXChannels?.[0]?.DMXChannel;
      const chList = dmxChList ? (Array.isArray(dmxChList) ? dmxChList : [dmxChList]) : [];

      interface RawChannel { slot: number; geo: string; channel: FixtureChannel; }
      const raw: RawChannel[] = [];
      const geoInMode = new Set<string>();

      for (const ch of chList) {
        if (!ch) continue;
        const offset = parseOffset(ch.$?.Offset);
        if (offset.byteCount === 0) continue; // Offset="None" → virtual channel

        const geo = ch.$?.Geometry || rootGeo || '';
        if (geo) geoInMode.add(geo);

        const lcList = ch.LogicalChannel
          ? (Array.isArray(ch.LogicalChannel) ? ch.LogicalChannel : [ch.LogicalChannel])
          : [];
        const firstLc = lcList[0] || {};
        const attr = String(firstLc.$?.Attribute || firstLc.ChannelFunction?.[0]?.$?.Attribute || 'NoFeature');
        const attrKey = normalizeAttr(attr);
        if (attrKey !== 'nofeature' && attrKey) usedAttrs.add(attrKey);

        const chType = gdtfAttributeToType(attr);
        const chName = prettyAttr(attr, attrPretty);

        const dflt = parseDmxValue(ch.$?.Default ?? firstLc.ChannelFunction?.[0]?.$?.Default);
        // H2 : les LogicalChannel frères sont mutuellement exclusifs (sous-modes
        // du même canal, ex. gobo select/rotate). On ne garde que le 1er.
        const capabilities = buildCapabilities(firstLc, offset.byteCount);
        const coarseDefault = dflt ? toCoarse(dflt.value, dflt.byteCount || offset.byteCount) : 0;

        raw.push({
          slot: offset.slots[0],
          geo,
          channel: {
            name: chName,
            type: chType,
            defaultValue: coarseDefault,
            capabilities: capabilities.length > 0 ? capabilities : undefined,
          },
        });

        // H1 : un canal 16 bits (Offset="1,2") occupe 2 slots DMX. On émet le
        // canal coarse + un canal "fine" (nommé "<nom> fine", détecté comme fine
        // offset par l'analyse) pour que le footprint DMX (channels.length) reste
        // juste — sinon le canal suivant serait adressé sur le slot fine.
        if (offset.byteCount >= 2) {
          raw.push({
            slot: offset.slots[1],
            geo,
            channel: {
              name: `${chName} fine`,
              type: chType,
              defaultValue: dflt ? (dflt.value & 0xff) : 0,
              capabilities: undefined,
            },
          });
        }
      }

      raw.sort((a, b) => a.slot - b.slot);
      const multiGeo = geoInMode.size > 1;
      const channels = raw.map((r) => ({
        ...r.channel,
        name: multiGeo && r.geo ? `${r.geo}_${r.channel.name}` : r.channel.name,
      }));

      modes.push({ name: modeName, channels });
    }

    const type = inferType(geometryKinds, usedAttrs);
    let id = `${manufacturer}-${model}`.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id) {
      // M2 : manufacturer/model non-ASCII → id vide. Fallback sur le GUID FixtureTypeID.
      const ftid = String(ft.$?.FixtureTypeID || '').replace(/[^a-zA-Z0-9_-]/g, '');
      id = `gdtf-${ftid || 'unknown'}`;
    }

    return {
      id,
      manufacturer,
      model,
      type,
      author,
      modes,
      qlcplusFile: opts?.sourceName,
    };
  } catch (e) {
    console.warn('Failed to parse GDTF:', e);
    return null;
  }
}

// ─── Minimal ZIP reader (single entry, no external deps) ───

/**
 * Read a single file entry from a ZIP archive held in memory.
 * Handles stored (method 0) and deflate (method 8) entries — the two methods
 * used by GDTF files (produced by the GDTF Builder / manufacturers).
 */
export function readZipEntry(zip: Buffer, entryName: string): Buffer | null {
  try {
    // Locate End Of Central Directory. A ZIP comment is ≤ 65535 bytes, so
    // scanning the last 64 KiB is enough (models/*.glb can be large — avoid
    // walking the whole buffer byte-by-byte).
    const scanStart = Math.max(0, zip.length - 65557);
    let eocd = -1;
    for (let i = zip.length - 22; i >= scanStart; i--) {
      if (zip.readUInt32LE(i) === 0x06054b50) {
        const commentLen = zip.readUInt16LE(i + 20);
        if (i + 22 + commentLen === zip.length) {
          eocd = i;
          break;
        }
      }
    }
    if (eocd < 0) return null;

    const entryCount = zip.readUInt16LE(eocd + 10);
    const cdOffset = zip.readUInt32LE(eocd + 16);

    // Zip64: sentinel values mean the real offsets live in a Zip64 EOCD we don't
    // parse. Reject explicitly instead of misparsing.
    if (entryCount === 0xffff || cdOffset === 0xffffffff) {
      console.warn('ZIP read: Zip64 archives are not supported');
      return null;
    }

    let p = cdOffset;
    for (let i = 0; i < entryCount; i++) {
      if (zip.readUInt32LE(p) !== 0x02014b50) return null;
      const method = zip.readUInt16LE(p + 10);
      const compSize = zip.readUInt32LE(p + 20);
      const nameLen = zip.readUInt16LE(p + 28);
      const extraLen = zip.readUInt16LE(p + 30);
      const commentLen = zip.readUInt16LE(p + 32);
      const localOffset = zip.readUInt32LE(p + 42);
      const name = zip.toString('utf8', p + 46, p + 46 + nameLen);

      if (name === entryName || name.endsWith('/' + entryName)) {
        if (zip.readUInt32LE(localOffset) !== 0x04034b50) return null;
        const lhNameLen = zip.readUInt16LE(localOffset + 26);
        const lhExtraLen = zip.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + lhNameLen + lhExtraLen;
        const data = zip.subarray(dataStart, dataStart + compSize);
        if (method === 0) return Buffer.from(data);
        if (method === 8) return zlib.inflateRawSync(data);
        return null;
      }

      p += 46 + nameLen + extraLen + commentLen;
    }
    return null;
  } catch (e) {
    console.warn('ZIP read failed:', e);
    return null;
  }
}

/** Extract `description.xml` from a `.gdtf` file (UTF-8). */
export function readGdtfDescriptionXml(gdtfPath: string): string | null {
  const buf = fs.readFileSync(gdtfPath);
  const entry = readZipEntry(buf, 'description.xml');
  if (!entry) return null;
  return entry.toString('utf-8');
}

/** Parse a `.gdtf` file on disk into a FixtureDefinition. */
export async function parseGdtfFile(gdtfPath: string): Promise<FixtureDefinition | null> {
  const xml = readGdtfDescriptionXml(gdtfPath);
  if (!xml) return null;
  return parseGdtfXml(xml, { sourceName: path.basename(gdtfPath) });
}
