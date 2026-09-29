/**
 * Vendor un jeu de fixtures GDTF de démonstration dans resources/fixtures/gdtf/.
 *
 * Pourquoi "démo" et pas "vraies" : le dépôt officiel (mvrdevelopment/spec) ne
 * contient pas de fichiers `.gdtf` prêts à l'emploi, et l'API GDTF Share
 * (gdtf-share.com) exige une connexion (302 → login) pour télécharger. Ces
 * fixtures exercent donc le parseur GDTF de l'app sur toute sa palette :
 *   - canaux 8 et 16 bits (coarse + fine),
 *   - tous les types : Intensity, Pan, Tilt, Colour (roue + additif), Shutter,
 *     Gobo, Prism, Beam (zoom/frost/iris/focus), Effect, Speed, Maintenance,
 *   - capacités nommées (roue de couleurs, gobos, prismes, macros),
 *   - plusieurs "géométries" (arbre Base/Yoke/Head).
 *
 * Ré-exécutable : `node scripts/vendor-gdtf.cjs`
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const NS = 'xmlns="http://gdtf-share.com/gdtf"';
const OUT_DIR = path.resolve(__dirname, '..', 'resources', 'fixtures', 'gdtf');

// ─── helpers XML ───────────────────────────────────────────

function channel(c) {
  const df = c.dmxFrom || '0/1';
  const sets = (c.sets || [])
    .map((s) => `                <ChannelSet Name="${s.name}" DMXFrom="${s.from}"/>`)
    .join('\n');
  return `          <DMXChannel Offset="${c.offset}" Geometry="Head">
            <LogicalChannel Attribute="${c.attribute}">
              <ChannelFunction Attribute="${c.attribute}" DMXFrom="${df}">
${sets}
              </ChannelFunction>
            </LogicalChannel>
          </DMXChannel>`;
}

function buildXml(manufacturer, model, attrs, channels) {
  const attrXml = attrs
    .map((a) => `        <Attribute Name="${a.name}" Pretty="${a.pretty}"/>`)
    .join('\n');
  const chanXml = channels.map(channel).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<GDTF DataVersion="1.2" ${NS}>
  <FixtureType Name="${model}" ShortName="${model}" Manufacturer="${manufacturer}">
    <AttributeDefinitions>
      <Attributes>
${attrXml}
      </Attributes>
    </AttributeDefinitions>
    <Geometries>
      <Geometry Name="Base">
        <Axis Name="Yoke"><Beam Name="Head"/></Axis>
      </Geometry>
    </Geometries>
    <DMXModes>
      <DMXMode Name="Default" Geometry="Head">
        <DMXChannels>
${chanXml}
        </DMXChannels>
      </DMXMode>
    </DMXModes>
  </FixtureType>
</GDTF>
`;
}

// ─── helpers ZIP (miroir de la logique du parser) ──────────

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const raw = e.content;
    const comp = zlib.deflateRawSync(raw); // méthode 8 (celle des vrais .gdtf)
    const crc = crc32(raw);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    chunks.push(lh, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += 30 + nameBuf.length + comp.length;
  }
  const cdStart = offset;
  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdStart, 16);
  return Buffer.concat([...chunks, ...central, eocd]);
}

// ─── fixtures ──────────────────────────────────────────────

const A = {
  dimmer: { name: 'Dimmer', pretty: 'Dimmer' },
  shutter: { name: 'Shutter1', pretty: 'Shutter' },
  pan: { name: 'Pan', pretty: 'Pan' },
  tilt: { name: 'Tilt', pretty: 'Tilt' },
  ptspeed: { name: 'PanTiltSpeed', pretty: 'Pan/Tilt Speed' },
  colorwheel: { name: 'Color1', pretty: 'Color' },
  gobo: { name: 'Gobo1', pretty: 'Gobo' },
  prism: { name: 'Prism1', pretty: 'Prism' },
  focus: { name: 'Focus1', pretty: 'Focus' },
  zoom: { name: 'Zoom', pretty: 'Zoom' },
  iris: { name: 'Iris', pretty: 'Iris' },
  frost: { name: 'Frost1', pretty: 'Frost' },
  effect: { name: 'Effects1', pretty: 'Effect' },
  control: { name: 'Control1', pretty: 'Control' },
  red: { name: 'ColorAdd_R', pretty: 'Red' },
  green: { name: 'ColorAdd_G', pretty: 'Green' },
  blue: { name: 'ColorAdd_B', pretty: 'Blue' },
  white: { name: 'ColorAdd_W', pretty: 'White' },
};

const fixtures = [
  {
    manufacturer: 'LightMaestro',
    model: 'Demo Spot 350',
    attrs: [
      A.pan, A.tilt, A.ptspeed, A.dimmer, A.shutter, A.colorwheel, A.gobo,
      A.prism, A.focus, A.zoom, A.iris, A.frost, A.effect, A.control,
    ],
    channels: [
      { offset: '1,2', dmxFrom: '0/2', attribute: 'Pan' },
      { offset: '3,4', dmxFrom: '0/2', attribute: 'Tilt' },
      { offset: '5', attribute: 'PanTiltSpeed', sets: [{ name: 'Fast to Slow', from: '0/1' }] },
      { offset: '6', attribute: 'Dimmer', sets: [{ name: 'Closed', from: '0/1' }, { name: 'Open', from: '255/1' }] },
      {
        offset: '7', attribute: 'Shutter1',
        sets: [
          { name: 'Open', from: '0/1' }, { name: 'Strobe Slow', from: '32/1' },
          { name: 'Strobe Fast', from: '64/1' }, { name: 'Pulse', from: '96/1' },
          { name: 'Closed', from: '128/1' },
        ],
      },
      {
        offset: '8', attribute: 'Color1',
        sets: [
          { name: 'Open', from: '0/1' }, { name: 'Red', from: '20/1' },
          { name: 'Green', from: '40/1' }, { name: 'Blue', from: '60/1' },
          { name: 'Amber', from: '80/1' }, { name: 'UV', from: '100/1' },
          { name: 'CTO', from: '120/1' },
        ],
      },
      {
        offset: '9', attribute: 'Gobo1',
        sets: [
          { name: 'Open', from: '0/1' }, { name: 'Gobo 1', from: '16/1' },
          { name: 'Gobo 2', from: '32/1' }, { name: 'Gobo 3', from: '48/1' },
          { name: 'Gobo 4', from: '64/1' }, { name: 'Gobo 5', from: '80/1' },
        ],
      },
      {
        offset: '10', attribute: 'Prism1',
        sets: [{ name: 'Open', from: '0/1' }, { name: '3-facet', from: '11/1' }, { name: '5-facet', from: '128/1' }],
      },
      { offset: '11', attribute: 'Focus1', sets: [{ name: 'Near to Far', from: '0/1' }] },
      { offset: '12', attribute: 'Zoom', sets: [{ name: 'Narrow to Wide', from: '0/1' }] },
      { offset: '13', attribute: 'Iris', sets: [{ name: 'Open', from: '0/1' }, { name: 'Closed', from: '255/1' }] },
      { offset: '14', attribute: 'Frost1', sets: [{ name: 'Clear to Frost', from: '0/1' }] },
      {
        offset: '15', attribute: 'Effects1',
        sets: [
          { name: 'No Effect', from: '0/1' }, { name: 'Macro 1', from: '32/1' },
          { name: 'Macro 2', from: '64/1' }, { name: 'Macro 3', from: '96/1' },
        ],
      },
      { offset: '16', attribute: 'Control1', sets: [{ name: 'Safe', from: '0/1' }, { name: 'Reset', from: '128/1' }] },
    ],
  },
  {
    manufacturer: 'LightMaestro',
    model: 'Demo Beam 300',
    attrs: [A.pan, A.tilt, A.dimmer, A.shutter, A.colorwheel, A.gobo, A.prism, A.focus, A.zoom, A.iris, A.frost],
    channels: [
      { offset: '1', attribute: 'Pan' },
      { offset: '2', attribute: 'Tilt' },
      { offset: '3', attribute: 'Dimmer', sets: [{ name: 'Closed', from: '0/1' }, { name: 'Open', from: '255/1' }] },
      { offset: '4', attribute: 'Shutter1', sets: [{ name: 'Open', from: '0/1' }, { name: 'Strobe', from: '32/1' }, { name: 'Closed', from: '64/1' }] },
      { offset: '5', attribute: 'Color1', sets: [{ name: 'Open', from: '0/1' }, { name: 'Red', from: '32/1' }, { name: 'Green', from: '64/1' }, { name: 'Blue', from: '96/1' }] },
      { offset: '6', attribute: 'Gobo1', sets: [{ name: 'Open', from: '0/1' }, { name: 'Gobo 1', from: '32/1' }, { name: 'Gobo 2', from: '64/1' }, { name: 'Gobo 3', from: '96/1' }, { name: 'Gobo 4', from: '128/1' }] },
      { offset: '7', attribute: 'Prism1', sets: [{ name: 'Open', from: '0/1' }, { name: '3-facet', from: '11/1' }] },
      { offset: '8', attribute: 'Focus1', sets: [{ name: 'Near to Far', from: '0/1' }] },
      { offset: '9', attribute: 'Zoom', sets: [{ name: 'Narrow to Wide', from: '0/1' }] },
      { offset: '10', attribute: 'Iris', sets: [{ name: 'Open', from: '0/1' }, { name: 'Closed', from: '255/1' }] },
      { offset: '11', attribute: 'Frost1', sets: [{ name: 'Clear to Frost', from: '0/1' }] },
    ],
  },
  {
    manufacturer: 'LightMaestro',
    model: 'Demo Wash 240',
    attrs: [A.pan, A.tilt, A.ptspeed, A.dimmer, A.shutter, A.red, A.green, A.blue, A.white, A.zoom],
    channels: [
      { offset: '1', attribute: 'Pan' },
      { offset: '2', attribute: 'Tilt' },
      { offset: '3', attribute: 'PanTiltSpeed', sets: [{ name: 'Fast to Slow', from: '0/1' }] },
      { offset: '4', attribute: 'Dimmer', sets: [{ name: 'Closed', from: '0/1' }, { name: 'Open', from: '255/1' }] },
      { offset: '5', attribute: 'Shutter1', sets: [{ name: 'Open', from: '0/1' }, { name: 'Strobe', from: '32/1' }] },
      { offset: '6', attribute: 'ColorAdd_R' },
      { offset: '7', attribute: 'ColorAdd_G' },
      { offset: '8', attribute: 'ColorAdd_B' },
      { offset: '9', attribute: 'ColorAdd_W' },
      { offset: '10', attribute: 'Zoom', sets: [{ name: 'Narrow to Wide', from: '0/1' }] },
    ],
  },
  {
    manufacturer: 'LightMaestro',
    model: 'Demo RGBW Par 56',
    attrs: [A.dimmer, A.shutter, A.red, A.green, A.blue, A.white],
    channels: [
      { offset: '1', attribute: 'Dimmer', sets: [{ name: 'Closed', from: '0/1' }, { name: 'Open', from: '255/1' }] },
      { offset: '2', attribute: 'Shutter1', sets: [{ name: 'Open', from: '0/1' }, { name: 'Strobe', from: '32/1' }] },
      { offset: '3', attribute: 'ColorAdd_R' },
      { offset: '4', attribute: 'ColorAdd_G' },
      { offset: '5', attribute: 'ColorAdd_B' },
      { offset: '6', attribute: 'ColorAdd_W' },
    ],
  },
  {
    manufacturer: 'LightMaestro',
    model: 'Demo Strobe 3000',
    attrs: [A.dimmer, A.shutter, A.red, A.green, A.blue],
    channels: [
      { offset: '1', attribute: 'Dimmer', sets: [{ name: 'Closed', from: '0/1' }, { name: 'Open', from: '255/1' }] },
      {
        offset: '2', attribute: 'Shutter1',
        sets: [
          { name: 'Closed', from: '0/1' }, { name: 'Slow', from: '16/1' },
          { name: 'Medium', from: '32/1' }, { name: 'Fast', from: '64/1' },
          { name: 'Pulse', from: '128/1' }, { name: 'Open', from: '255/1' },
        ],
      },
      { offset: '3', attribute: 'ColorAdd_R' },
      { offset: '4', attribute: 'ColorAdd_G' },
      { offset: '5', attribute: 'ColorAdd_B' },
    ],
  },
  {
    manufacturer: 'LightMaestro',
    model: 'Demo Fog 1200',
    attrs: [A.dimmer, A.control],
    channels: [
      { offset: '1', attribute: 'Dimmer', sets: [{ name: 'Closed', from: '0/1' }, { name: 'Open', from: '255/1' }] },
      { offset: '2', attribute: 'Control1', sets: [{ name: 'Off', from: '0/1' }, { name: 'Pump', from: '128/1' }, { name: 'Clean', from: '200/1' }] },
    ],
  },
];

// ─── écriture ──────────────────────────────────────────────

fs.mkdirSync(OUT_DIR, { recursive: true });

for (const f of fixtures) {
  const xml = buildXml(f.manufacturer, f.model, f.attrs, f.channels);
  const zip = makeZip([{ name: 'description.xml', content: Buffer.from(xml, 'utf8') }]);
  const file = `${f.manufacturer}-${f.model}.gdtf`.replace(/\s+/g, '-');
  fs.writeFileSync(path.join(OUT_DIR, file), zip);
  console.log(`wrote ${file} (${zip.length} bytes)`);
}

// ─── README de provenance ──────────────────────────────────

const readme = `# Fixtures GDTF (démo)

Ce dossier est lu au démarrage par \`loadGdtfDirectory\` (electron/fixtures/library.ts)
→ \`resources/fixtures/gdtf/\`. Tous les fichiers \`.gdtf\` ici sont importés
automatiquement (récursif, \`getAllFiles(dir, '.gdtf')\`).

## Provenance

Ces fixtures sont des **fixtures de démonstration générées** (script
\`scripts/vendor-gdtf.cjs\`), pas des fichiers constructeur. Motif : le dépôt
officiel (mvrdevelopment/spec) ne publie pas de \`.gdtf\` prêts, et l'API
GDTF Share (gdtf-share.com) exige une connexion.

Elles exercent le parseur sur toute sa palette : canaux 8/16 bits, roue de
couleurs, gobos, prismes, zoom/frost/iris/focus, effets, macros, RGBW additif,
strobe, maintenance.

## Ajouter de vraies fixtures

Dépose tes \`.gdtf\` constructeurs dans ce dossier (ou dans
\`%APPDATA%\\light-maestro\\gdtf-fixtures\\\`) et relance l'app — import auto.

Régénérer ce jeu : \`node scripts/vendor-gdtf.cjs\`.
`;
fs.writeFileSync(path.join(OUT_DIR, 'README.md'), readme);

console.log(`\nDone. ${fixtures.length} fixtures + README dans ${OUT_DIR}`);
