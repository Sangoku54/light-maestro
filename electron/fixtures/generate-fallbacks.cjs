/**
 * Fallback Fixture Generator
 *
 * Generates fixture definition JSON files for popular fixtures
 * when the QLC+ library download/import is unavailable.
 *
 * Usage:
 *   node fixtures/generate-fallbacks.cjs [outputDir]
 *
 * Default output: resources/fixtures/
 */

const fs = require('fs');
const path = require('path');

// ─── Popular Fixture Definitions ───────────────────────────

const POPULAR_FIXTURES = [
  // === Moving Heads ===
  {
    manufacturer: 'Chauvet',
    model: 'Intimidator Spot 260',
    type: 'Moving Head',
    author: 'Light Maestro Fallback',
    modes: [
      { name: '13-channel', channels: [
        { name: 'Pan', type: 'Pan' },
        { name: 'Pan Fine', type: 'Pan' },
        { name: 'Tilt', type: 'Tilt' },
        { name: 'Tilt Fine', type: 'Tilt' },
        { name: 'Pan/Tilt Speed', type: 'Speed' },
        { name: 'Color Wheel', type: 'Colour', capabilities: [
          { min: 0, max: 7, name: 'White' }, { min: 8, max: 15, name: 'Yellow' },
          { min: 16, max: 23, name: 'Magenta' }, { min: 24, max: 31, name: 'Green' },
          { min: 32, max: 39, name: 'Red' }, { min: 40, max: 47, name: 'Cyan' },
          { min: 48, max: 55, name: 'Orange' }, { min: 56, max: 63, name: 'Blue' },
          { min: 64, max: 127, name: 'Color scroll CW slow-fast' },
          { min: 128, max: 191, name: 'Color scroll CCW slow-fast' },
        ]},
        { name: 'Gobo Wheel', type: 'Gobo', capabilities: [
          { min: 0, max: 7, name: 'Open' }, { min: 8, max: 15, name: 'Gobo 1' },
          { min: 16, max: 23, name: 'Gobo 2' }, { min: 24, max: 31, name: 'Gobo 3' },
          { min: 32, max: 39, name: 'Gobo 4' }, { min: 40, max: 47, name: 'Gobo 5' },
          { min: 48, max: 55, name: 'Gobo 6' }, { min: 56, max: 63, name: 'Gobo 7' },
          { min: 64, max: 127, name: 'Gobo scroll CW' },
          { min: 128, max: 191, name: 'Gobo scroll CCW' },
        ]},
        { name: 'Prism', type: 'Prism', capabilities: [
          { min: 0, max: 7, name: 'Open' }, { min: 8, max: 127, name: '3-facet prism' },
          { min: 128, max: 255, name: 'Prism rotation' },
        ]},
        { name: 'Shutter', type: 'Shutter', capabilities: [
          { min: 0, max: 7, name: 'Closed' }, { min: 8, max: 15, name: 'Open' },
          { min: 16, max: 131, name: 'Strobe slow-fast' },
          { min: 132, max: 167, name: 'Pulse slow-fast' },
        ]},
        { name: 'Dimmer', type: 'Intensity', capabilities: [
          { min: 0, max: 255, name: 'Intensity 0-100%' },
        ]},
        { name: 'Focus', type: 'Beam', capabilities: [
          { min: 0, max: 255, name: 'Focus' },
        ]},
        { name: 'Control', type: 'Maintenance', capabilities: [
          { min: 0, max: 9, name: 'No function' },
          { min: 10, max: 19, name: 'Reset' },
          { min: 20, max: 29, name: 'No function' },
        ]},
      ]},
      { name: '9-channel', channels: [
        { name: 'Pan', type: 'Pan' }, { name: 'Tilt', type: 'Tilt' },
        { name: 'Color Wheel', type: 'Colour' }, { name: 'Gobo Wheel', type: 'Gobo' },
        { name: 'Prism', type: 'Prism' }, { name: 'Shutter', type: 'Shutter' },
        { name: 'Dimmer', type: 'Intensity' }, { name: 'Focus', type: 'Beam' },
        { name: 'Control', type: 'Maintenance' },
      ]},
    ],
    physical: { bulbType: 'LED 60W', weight: 5.2, width: 225, height: 350, depth: 230, powerConsumption: 128, DMXConnector: '3-pin XLR' },
  },
  {
    manufacturer: 'Martin',
    model: 'MAC Aura XB',
    type: 'Moving Head',
    author: 'Light Maestro Fallback',
    modes: [
      { name: 'Standard', channels: [
        { name: 'Pan', type: 'Pan' }, { name: 'Pan Fine', type: 'Pan' },
        { name: 'Tilt', type: 'Tilt' }, { name: 'Tilt Fine', type: 'Tilt' },
        { name: 'Red', type: 'Colour' }, { name: 'Green', type: 'Colour' },
        { name: 'Blue', type: 'Colour' }, { name: 'White', type: 'Colour' },
        { name: 'Color Temperature', type: 'Colour' }, { name: 'Shutter', type: 'Shutter' },
        { name: 'Dimmer', type: 'Intensity' }, { name: 'Zoom', type: 'Beam' },
        { name: 'Control', type: 'Maintenance' },
      ]},
    ],
    physical: { bulbType: 'LED 35W RGBW', weight: 5.6, powerConsumption: 170, DMXConnector: '5-pin XLR' },
  },
  {
    manufacturer: 'Robe',
    model: 'Robin 300 Beam',
    type: 'Moving Head',
    author: 'Light Maestro Fallback',
    modes: [
      { name: 'Standard', channels: [
        { name: 'Pan', type: 'Pan' }, { name: 'Pan Fine', type: 'Pan' },
        { name: 'Tilt', type: 'Tilt' }, { name: 'Tilt Fine', type: 'Tilt' },
        { name: 'Color Wheel', type: 'Colour' },
        { name: 'Gobo Wheel', type: 'Gobo' },
        { name: 'Gobo Rotation', type: 'Gobo' },
        { name: 'Prism', type: 'Prism' },
        { name: 'Shutter', type: 'Shutter' },
        { name: 'Dimmer', type: 'Intensity' },
        { name: 'Focus', type: 'Beam' },
        { name: 'Control', type: 'Maintenance' },
      ]},
    ],
    physical: { bulbType: 'Osram Sirius 300W', powerConsumption: 450, DMXConnector: '5-pin XLR' },
  },

  // === LED PARs ===
  {
    manufacturer: 'Chauvet',
    model: 'COLORdash Par-Hex 7',
    type: 'Color Changer',
    author: 'Light Maestro Fallback',
    modes: [
      { name: '6-channel', channels: [
        { name: 'Red', type: 'Colour' }, { name: 'Green', type: 'Colour' },
        { name: 'Blue', type: 'Colour' }, { name: 'Amber', type: 'Colour' },
        { name: 'White', type: 'Colour' }, { name: 'UV', type: 'Colour' },
      ]},
      { name: '11-channel', channels: [
        { name: 'Dimmer', type: 'Intensity' }, { name: 'Red', type: 'Colour' },
        { name: 'Green', type: 'Colour' }, { name: 'Blue', type: 'Colour' },
        { name: 'Amber', type: 'Colour' }, { name: 'White', type: 'Colour' },
        { name: 'UV', type: 'Colour' }, { name: 'Strobe', type: 'Shutter' },
        { name: 'Color Macro', type: 'Colour' },
        { name: 'Auto Programs', type: 'Effect' },
        { name: 'Dimmer Curve', type: 'Beam' },
      ]},
    ],
    physical: { bulbType: 'LED 7x12W RGBAW+UV', weight: 2.5, powerConsumption: 95 },
  },
  {
    manufacturer: 'Elation',
    model: 'SixPar 200',
    type: 'Color Changer',
    author: 'Light Maestro Fallback',
    modes: [
      { name: '6-channel', channels: [
        { name: 'Red', type: 'Colour' }, { name: 'Green', type: 'Colour' },
        { name: 'Blue', type: 'Colour' }, { name: 'Amber', type: 'Colour' },
        { name: 'White', type: 'Colour' }, { name: 'UV', type: 'Colour' },
      ]},
      { name: '10-channel', channels: [
        { name: 'Dimmer', type: 'Intensity' }, { name: 'Red', type: 'Colour' },
        { name: 'Green', type: 'Colour' }, { name: 'Blue', type: 'Colour' },
        { name: 'Amber', type: 'Colour' }, { name: 'White', type: 'Colour' },
        { name: 'UV', type: 'Colour' }, { name: 'Strobe', type: 'Shutter' },
        { name: 'Color Macro', type: 'Colour' },
        { name: 'Dimmer Curve', type: 'Beam' },
      ]},
    ],
    physical: { bulbType: 'LED 6x12W RGBAW+UV', weight: 2.3, powerConsumption: 90 },
  },

  // === Wash Lights ===
  {
    manufacturer: 'Chauvet',
    model: 'Rogue R1 Wash',
    type: 'Moving Head',
    author: 'Light Maestro Fallback',
    modes: [
      { name: '16-channel', channels: [
        { name: 'Pan', type: 'Pan' }, { name: 'Pan Fine', type: 'Pan' },
        { name: 'Tilt', type: 'Tilt' }, { name: 'Tilt Fine', type: 'Tilt' },
        { name: 'Pan/Tilt Speed', type: 'Speed' },
        { name: 'Red', type: 'Colour' }, { name: 'Green', type: 'Colour' },
        { name: 'Blue', type: 'Colour' }, { name: 'White', type: 'Colour' },
        { name: 'Color Temperature', type: 'Colour' },
        { name: 'Color Macro', type: 'Colour' },
        { name: 'Shutter', type: 'Shutter' }, { name: 'Dimmer', type: 'Intensity' },
        { name: 'Zoom', type: 'Beam' },
        { name: 'Control', type: 'Maintenance' },
      ]},
    ],
    physical: { bulbType: 'LED 7x15W RGBW', weight: 6.3, powerConsumption: 132, DMXConnector: '3-pin XLR' },
  },

  // === Strobe / Blinders ===
  {
    manufacturer: 'Martin',
    model: 'Atomic 3000',
    type: 'Strobe',
    author: 'Light Maestro Fallback',
    modes: [
      { name: '3-channel', channels: [
        { name: 'Intensity', type: 'Intensity' },
        { name: 'Duration', type: 'Speed' },
        { name: 'Rate', type: 'Shutter' },
      ]},
    ],
    physical: { bulbType: 'Xenon 3000W', weight: 8.0, powerConsumption: 3000 },
  },

  // === Scanners ===
  {
    manufacturer: 'Chauvet',
    model: 'Intimidator Scan 300',
    type: 'Scanner',
    author: 'Light Maestro Fallback',
    modes: [
      { name: '8-channel', channels: [
        { name: 'Pan', type: 'Pan' }, { name: 'Tilt', type: 'Tilt' },
        { name: 'Color Wheel', type: 'Colour' }, { name: 'Gobo Wheel', type: 'Gobo' },
        { name: 'Shutter', type: 'Shutter' }, { name: 'Dimmer', type: 'Intensity' },
        { name: 'Pan/Tilt Speed', type: 'Speed' },
        { name: 'Control', type: 'Maintenance' },
      ]},
    ],
    physical: { bulbType: 'LED 80W', weight: 4.8, powerConsumption: 95 },
  },

  // === Smoke / Haze ===
  {
    manufacturer: 'Chauvet',
    model: 'Hurricane Haze 2D',
    type: 'Hazer',
    author: 'Light Maestro Fallback',
    modes: [
      { name: '2-channel', channels: [
        { name: 'Haze Output', type: 'Intensity' },
        { name: 'Fan Speed', type: 'Speed' },
      ]},
    ],
    physical: { powerConsumption: 450, DMXConnector: '3-pin XLR' },
  },

  // === Dimmer Packs ===
  {
    manufacturer: 'Showtec',
    model: 'MultiDim',
    type: 'Dimmer',
    author: 'Light Maestro Fallback',
    modes: [
      { name: '6-channel', channels: [
        { name: 'Channel 1', type: 'Intensity' }, { name: 'Channel 2', type: 'Intensity' },
        { name: 'Channel 3', type: 'Intensity' }, { name: 'Channel 4', type: 'Intensity' },
        { name: 'Channel 5', type: 'Intensity' }, { name: 'Channel 6', type: 'Intensity' },
      ]},
    ],
    physical: { powerConsumption: 3680, DMXConnector: '3-pin XLR' },
  },
];

// ─── Generator ─────────────────────────────────────────────

function generate(outputDir) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let count = 0;
  for (const raw of POPULAR_FIXTURES) {
    // Assign default capabilities to channels without them
    const def = {
      id: `${raw.manufacturer}-${raw.model}`.replace(/\s+/g, '-'),
      manufacturer: raw.manufacturer,
      model: raw.model,
      type: raw.type,
      author: raw.author,
      modes: raw.modes.map((mode) => ({
        name: mode.name,
        channels: mode.channels.map((ch) => ({
          name: ch.name,
          type: ch.type,
          defaultValue: 0,
          capabilities: ch.capabilities || (ch.type === 'Intensity'
            ? [{ min: 0, max: 255, name: 'Intensity 0-100%' }]
            : ch.type === 'Shutter'
              ? [{ min: 0, max: 7, name: 'Closed' }, { min: 8, max: 255, name: 'Open / Strobe' }]
              : undefined
          ),
        })),
      })),
      physical: raw.physical,
    };

    const filename = `${def.id}.json`;
    const filePath = path.join(outputDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(def, null, 2));
    console.log(`  Generated: ${filename}`);
    count++;
  }

  console.log(`\nGenerated ${count} fallback fixture definitions in ${outputDir}`);
  return count;
}

// ─── CLI ───────────────────────────────────────────────────

const outputDir = process.argv[2] || path.join(__dirname, '..', '..', 'resources', 'fixtures');
console.log(`Fallback Fixture Generator`);
console.log(`Output: ${outputDir}\n`);
generate(outputDir);
