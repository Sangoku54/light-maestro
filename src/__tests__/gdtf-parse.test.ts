/**
 * Tests du parser GDTF (`.gdtf` → FixtureDefinition).
 *
 * Le module `electron/fixtures/gdtf` n'importe pas 'electron' : il est testable
 * tel quel sous vitest. On teste :
 *  - le mapping attribut GDTF → type de canal,
 *  - le parsing complet d'un `description.xml` (manufacturer/model, ordre des
 *    canaux trié par Offset, types, capacités depuis les ChannelSets, canal
 *    virtuel Offset="None" ignoré, inférence de type),
 *  - un color wheel (Color1) avec capacités colorées,
 *  - le lecteur ZIP minimal (entrée stored et deflate).
 */
import { describe, it, expect } from 'vitest';
import zlib from 'zlib';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseGdtfXml, readZipEntry, gdtfAttributeToType } from '@electron/fixtures/gdtf';
import { FixtureLibrary } from '@electron/fixtures/library';

const NS = 'xmlns="http://gdtf-share.com/gdtf"';

// ─── Mapping attribut → type ───────────────────────────────

describe('gdtfAttributeToType', () => {
  it('mappe les attributs GDTF courants', () => {
    expect(gdtfAttributeToType('Dimmer')).toBe('Intensity');
    expect(gdtfAttributeToType('ColorAdd_R')).toBe('Colour');
    expect(gdtfAttributeToType('ColorAdd_G')).toBe('Colour');
    expect(gdtfAttributeToType('ColorAdd_B')).toBe('Colour');
    expect(gdtfAttributeToType('ColorRGB_Red')).toBe('Colour');
    expect(gdtfAttributeToType('Pan')).toBe('Pan');
    expect(gdtfAttributeToType('Tilt')).toBe('Tilt');
    expect(gdtfAttributeToType('Gobo1')).toBe('Gobo');
    expect(gdtfAttributeToType('Gobo2')).toBe('Gobo');
    expect(gdtfAttributeToType('Shutter1')).toBe('Shutter');
    expect(gdtfAttributeToType('Prism1')).toBe('Prism');
    expect(gdtfAttributeToType('Zoom')).toBe('Beam');
    expect(gdtfAttributeToType('Iris')).toBe('Beam');
    expect(gdtfAttributeToType('NoFeature')).toBe('Nothing');
    expect(gdtfAttributeToType('SomeUnknownAttr')).toBe('Nothing');
  });

  it('est insensible à la casse et aux underscores', () => {
    expect(gdtfAttributeToType('coloradd_r')).toBe('Colour');
    expect(gdtfAttributeToType('COLORADD_B')).toBe('Colour');
    expect(gdtfAttributeToType('DIMmer')).toBe('Intensity');
  });
});

// ─── Parsing complet ───────────────────────────────────────

const SPOT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<GDTF DataVersion="1.2" ${NS}>
  <FixtureType Name="TestSpot" ShortName="TS" Manufacturer="Generic">
    <AttributeDefinitions>
      <Attributes>
        <Attribute Name="Dimmer" Pretty="Dimmer"/>
        <Attribute Name="ColorAdd_R" Pretty="Red"/>
        <Attribute Name="ColorAdd_G" Pretty="Green"/>
        <Attribute Name="ColorAdd_B" Pretty="Blue"/>
        <Attribute Name="Pan" Pretty="Pan"/>
        <Attribute Name="Tilt" Pretty="Tilt"/>
      </Attributes>
    </AttributeDefinitions>
    <Geometries>
      <Geometry Name="Base">
        <Axis Name="Yoke"><Beam Name="Head"/></Axis>
      </Geometry>
    </Geometries>
    <DMXModes>
      <DMXMode Name="8-Ch" Geometry="Head">
        <DMXChannels>
          <DMXChannel Offset="5" Geometry="Head">
            <LogicalChannel Attribute="Pan"><ChannelFunction Attribute="Pan" DMXFrom="0/1"/></LogicalChannel>
          </DMXChannel>
          <DMXChannel Offset="6" Geometry="Head">
            <LogicalChannel Attribute="Tilt"><ChannelFunction Attribute="Tilt" DMXFrom="0/1"/></LogicalChannel>
          </DMXChannel>
          <DMXChannel Offset="1" Geometry="Head">
            <LogicalChannel Attribute="Dimmer" Master="Grand">
              <ChannelFunction Attribute="Dimmer" DMXFrom="0/1">
                <ChannelSet Name="closed" DMXFrom="0/1"/>
                <ChannelSet Name="open" DMXFrom="255/1"/>
              </ChannelFunction>
            </LogicalChannel>
          </DMXChannel>
          <DMXChannel Offset="2" Geometry="Head">
            <LogicalChannel Attribute="ColorAdd_R"><ChannelFunction Attribute="ColorAdd_R" DMXFrom="0/1"/></LogicalChannel>
          </DMXChannel>
          <DMXChannel Offset="3" Geometry="Head">
            <LogicalChannel Attribute="ColorAdd_G"><ChannelFunction Attribute="ColorAdd_G" DMXFrom="0/1"/></LogicalChannel>
          </DMXChannel>
          <DMXChannel Offset="4" Geometry="Head">
            <LogicalChannel Attribute="ColorAdd_B"><ChannelFunction Attribute="ColorAdd_B" DMXFrom="0/1"/></LogicalChannel>
          </DMXChannel>
          <DMXChannel Offset="None" Geometry="Head">
            <LogicalChannel Attribute="Dimmer"><ChannelFunction Attribute="Dimmer" DMXFrom="0/1"/></LogicalChannel>
          </DMXChannel>
        </DMXChannels>
      </DMXMode>
    </DMXModes>
  </FixtureType>
</GDTF>`;

describe('parseGdtfXml — fixture spot 8 canaux', () => {
  it('extrait manufacturer/model/type et trie les canaux par Offset', async () => {
    const def = await parseGdtfXml(SPOT_XML);
    expect(def).not.toBeNull();
    expect(def!.manufacturer).toBe('Generic');
    expect(def!.model).toBe('TestSpot');
    expect(def!.type).toBe('Moving Head'); // Pan + Tilt présents
    expect(def!.id).toBe('Generic-TestSpot');
    expect(def!.modes).toHaveLength(1);
    expect(def!.modes[0].name).toBe('8-Ch');

    // Offset="None" (canal virtuel) est ignoré → 6 canaux
    const names = def!.modes[0].channels.map((c) => c.name);
    expect(names).toEqual(['Dimmer', 'Red', 'Green', 'Blue', 'Pan', 'Tilt']);
  });

  it('type les canaux et dérive les capacités depuis les ChannelSets', async () => {
    const def = await parseGdtfXml(SPOT_XML);
    const ch = def!.modes[0].channels;

    expect(ch[0].type).toBe('Intensity');
    expect(ch[0].capabilities).toEqual([
      { min: 0, max: 254, name: 'closed' },
      { min: 255, max: 255, name: 'open' },
    ]);

    expect(ch[1].type).toBe('Colour'); // Red
    expect(ch[1].capabilities).toBeUndefined(); // pas de ChannelSet
    expect(ch[4].type).toBe('Pan');
    expect(ch[5].type).toBe('Tilt');
  });
});

// ─── Color wheel (Color1) avec capacités colorées ──────────

const WHEEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<GDTF DataVersion="1.2" ${NS}>
  <FixtureType Name="ColorWheel" Manufacturer="Acme">
    <AttributeDefinitions>
      <Attributes>
        <Attribute Name="Dimmer" Pretty="Dimmer"/>
        <Attribute Name="Color1" Pretty="Color"/>
      </Attributes>
    </AttributeDefinitions>
    <Geometries><Geometry Name="Base"/></Geometries>
    <DMXModes>
      <DMXMode Name="Default" Geometry="Base">
        <DMXChannels>
          <DMXChannel Offset="1" Geometry="Base">
            <LogicalChannel Attribute="Color1">
              <ChannelFunction Attribute="Color1" DMXFrom="0/1">
                <ChannelSet Name="Red" DMXFrom="0/1"/>
                <ChannelSet Name="Green" DMXFrom="85/1"/>
                <ChannelSet Name="Blue" DMXFrom="170/1"/>
              </ChannelFunction>
            </LogicalChannel>
          </DMXChannel>
        </DMXChannels>
      </DMXMode>
    </DMXModes>
  </FixtureType>
</GDTF>`;

describe('parseGdtfXml — color wheel', () => {
  it('infère Color Changer et mappe les slots de roue en couleurs', async () => {
    const def = await parseGdtfXml(WHEEL_XML);
    expect(def!.type).toBe('Color Changer');
    const ch = def!.modes[0].channels[0];
    expect(ch.type).toBe('Colour');
    expect(ch.capabilities).toEqual([
      { min: 0, max: 84, name: 'Red', color: '#ff0000' },
      { min: 85, max: 169, name: 'Green', color: '#00ff00' },
      { min: 170, max: 255, name: 'Blue', color: '#0000ff' },
    ]);
  });
});

// ─── Canaux 16 bits (fine) ───────────────────────────────

const SIXTEEN_XML = `<?xml version="1.0" encoding="UTF-8"?>
<GDTF DataVersion="1.2" ${NS}>
  <FixtureType Name="Moving16" Manufacturer="Acme">
    <AttributeDefinitions>
      <Attributes>
        <Attribute Name="Pan" Pretty="Pan"/>
        <Attribute Name="Tilt" Pretty="Tilt"/>
      </Attributes>
    </AttributeDefinitions>
    <Geometries><Geometry Name="Base"/></Geometries>
    <DMXModes>
      <DMXMode Name="Default" Geometry="Base">
        <DMXChannels>
          <DMXChannel Offset="1,2" Default="65535/2" Geometry="Base">
            <LogicalChannel Attribute="Pan"><ChannelFunction Attribute="Pan" DMXFrom="0/2"/></LogicalChannel>
          </DMXChannel>
          <DMXChannel Offset="3,4" Geometry="Base">
            <LogicalChannel Attribute="Tilt"><ChannelFunction Attribute="Tilt" DMXFrom="0/2"/></LogicalChannel>
          </DMXChannel>
        </DMXChannels>
      </DMXMode>
    </DMXModes>
  </FixtureType>
</GDTF>`;

describe('parseGdtfXml — canaux 16 bits', () => {
  it('émet un canal fine pour chaque slot 16 bits (footprint DMX juste)', async () => {
    const def = await parseGdtfXml(SIXTEEN_XML);
    const names = def!.modes[0].channels.map((c) => c.name);
    expect(names).toEqual(['Pan', 'Pan fine', 'Tilt', 'Tilt fine']);
    const pan = def!.modes[0].channels[0];
    const panFine = def!.modes[0].channels[1];
    expect(pan.type).toBe('Pan');
    expect(pan.defaultValue).toBe(255); // 65535/2 → octet coarse
    expect(panFine.type).toBe('Pan');
    expect(panFine.defaultValue).toBe(255); // octet bas de 65535
    expect(panFine.capabilities).toBeUndefined();
  });
});

// ─── Multi-LogicalChannel (sous-modes exclusifs) ───────────

const MULTILC_XML = `<?xml version="1.0" encoding="UTF-8"?>
<GDTF DataVersion="1.2" ${NS}>
  <FixtureType Name="GoboSelectRotate" Manufacturer="Acme">
    <AttributeDefinitions>
      <Attributes>
        <Attribute Name="Gobo1" Pretty="Gobo"/>
        <Attribute Name="Gobo1PosRotate" Pretty="Gobo Rotate"/>
      </Attributes>
    </AttributeDefinitions>
    <Geometries><Geometry Name="Base"/></Geometries>
    <DMXModes>
      <DMXMode Name="Default" Geometry="Base">
        <DMXChannels>
          <DMXChannel Offset="1" Geometry="Base">
            <LogicalChannel Attribute="Gobo1">
              <ChannelFunction Attribute="Gobo1" DMXFrom="0/1">
                <ChannelSet Name="Gobo 1" DMXFrom="0/1"/>
              </ChannelFunction>
            </LogicalChannel>
            <LogicalChannel Attribute="Gobo1PosRotate">
              <ChannelFunction Attribute="Gobo1PosRotate" DMXFrom="0/1">
                <ChannelSet Name="Rotate CW" DMXFrom="0/1"/>
              </ChannelFunction>
            </LogicalChannel>
          </DMXChannel>
        </DMXChannels>
      </DMXMode>
    </DMXModes>
  </FixtureType>
</GDTF>`;

describe('parseGdtfXml — multi-LogicalChannel', () => {
  it('ne garde que le 1er LogicalChannel (pas de concaténation)', async () => {
    const def = await parseGdtfXml(MULTILC_XML);
    const ch = def!.modes[0].channels[0];
    expect(ch.name).toBe('Gobo'); // pretty name du 1er attribut
    expect(ch.capabilities).toHaveLength(1);
    expect(ch.capabilities![0].name).toBe('Gobo 1');
  });
});

// ─── Lecteur ZIP minimal ───────────────────────────────────

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Construit un ZIP minimal valide (CRC et tailles corrects).
 * `method` : 0 = stored, 8 = deflate (les vrais .gdtf utilisent deflate).
 */
function makeZip(entries: { name: string; content: Buffer }[], method: 0 | 8 = 0): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const raw = e.content;
    const comp = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const crc = crc32(raw);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); // version needed
    lh.writeUInt16LE(0, 6); // flags
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(comp.length, 18); // compressed size
    lh.writeUInt32LE(raw.length, 22); // uncompressed size
    lh.writeUInt16LE(nameBuf.length, 26);
    chunks.push(lh, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // version made by
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8); // flags
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42); // local header offset
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

describe('readZipEntry — extraction d’une entrée', () => {
  it('lit description.xml depuis une archive stored', () => {
    const xml = '<?xml version="1.0"?><GDTF/>';
    const zip = makeZip([
      { name: 'description.xml', content: Buffer.from(xml, 'utf8') },
      { name: 'wheels/gobo1.png', content: Buffer.from([1, 2, 3, 4]) },
    ]);
    const entry = readZipEntry(zip, 'description.xml');
    expect(entry).not.toBeNull();
    expect(entry!.toString('utf8')).toBe(xml);
  });

  it('lit une entrée deflate (méthode 8, celle des vrais .gdtf)', () => {
    const xml = '<?xml version="1.0"?><GDTF DataVersion="1.2"/>';
    const zip = makeZip([{ name: 'description.xml', content: Buffer.from(xml, 'utf8') }], 8);
    const entry = readZipEntry(zip, 'description.xml');
    expect(entry).not.toBeNull();
    expect(entry!.toString('utf8')).toBe(xml);
  });

  it('retourne null si l’entrée n’existe pas', () => {
    const zip = makeZip([{ name: 'description.xml', content: Buffer.from('x') }]);
    expect(readZipEntry(zip, 'missing.xml')).toBeNull();
  });
});

// ─── Auto-import au lancement (loadGdtfDirectory) ─────────

describe('loadGdtfDirectory — import d’office d’un dossier', () => {
  it('charge les .gdtf, ignore les autres fichiers et dédoublonne', async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GDTF DataVersion="1.2" ${NS}>
  <FixtureType Name="AutoSpot" Manufacturer="Acme">
    <AttributeDefinitions><Attributes><Attribute Name="Dimmer" Pretty="Dimmer"/></Attributes></AttributeDefinitions>
    <Geometries><Geometry Name="Base"/></Geometries>
    <DMXModes>
      <DMXMode Name="Default" Geometry="Base">
        <DMXChannels>
          <DMXChannel Offset="1" Geometry="Base">
            <LogicalChannel Attribute="Dimmer"><ChannelFunction Attribute="Dimmer" DMXFrom="0/1"><ChannelSet Name="Open" DMXFrom="0/1"/></ChannelFunction></LogicalChannel>
          </DMXChannel>
        </DMXChannels>
      </DMXMode>
    </DMXModes>
  </FixtureType>
</GDTF>`;
    const zip = makeZip([{ name: 'description.xml', content: Buffer.from(xml, 'utf8') }], 8);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gdtf-auto-'));
    fs.writeFileSync(path.join(dir, 'autospot.gdtf'), zip);
    fs.writeFileSync(path.join(dir, 'readme.txt'), 'not a fixture');

    try {
      const lib = new FixtureLibrary();
      const r = await lib.loadGdtfDirectory(dir);
      expect(r.added).toBe(1);
      expect(r.skipped).toBe(0);
      expect(lib.hasFixture('Acme', 'AutoSpot')).toBe(true);

      // Second passage : dédoublonné, aucun ajout.
      const r2 = await lib.loadGdtfDirectory(dir);
      expect(r2.added).toBe(0);
      expect(r2.skipped).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
