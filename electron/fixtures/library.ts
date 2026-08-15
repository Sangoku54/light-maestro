/**
 * Fixture System — QLC+ compatible fixture definitions
 *
 * Key concepts from QLC+:
 * - Fixtures have modes, each mode defines channel layout
 * - Channels can be: intensity, pan, tilt, color, gobo, shutter, etc.
 * - Colors can be: RGB, CMY, color wheel, fixed colors
 * - Heads: multi-head fixtures (e.g., 4-bar LED)
 *
 * QXF parser handles the real QLC+ XML fixture format:
 * - Root-level <Channel> definitions with capabilities
 * - <Mode> elements reference root channels by name
 * - Supports <Physical> data, <Head> definitions
 */

import fs from 'fs';
import path from 'path';
import { parseStringPromise } from 'xml2js';
import { app } from 'electron';

// ─── Fixture Definition Types ──────────────────────────────
// Mirrors QLC+'s fixture definition format

export interface FixtureCapability {
  min: number;
  max: number;
  name: string;
  color?: string;       // Hex color for color capabilities
  color2?: string;      // Second color for dual-color
  image?: string;       // Gobo image reference
  pan?: number;         // Pan degree
  tilt?: number;        // Tilt degree
  preset?: string;      // QLC+ preset name
}

export interface FixtureChannel {
  name: string;
  type: 'Intensity' | 'Pan' | 'Tilt' | 'Colour' | 'Gobo' | 'Shutter' | 'Speed' | 'Prism' | 'Effect' | 'Beam' | 'Maintenance' | 'Nothing';
  defaultValue?: number;
  capabilities?: FixtureCapability[];
}

export interface FixturePhysical {
  bulbType?: string;
  bulbLumens?: number;
  bulbColorTemp?: number;
  weight?: number;
  width?: number;
  height?: number;
  depth?: number;
  lensName?: string;
  lensDegMin?: number;
  lensDegMax?: number;
  focusType?: 'Fixed' | 'Head' | 'Mirror' | 'Barrel';
  panMax?: number;
  tiltMax?: number;
  powerConsumption?: number;
  DMXConnector?: string;
}

export interface FixtureMode {
  name: string;
  channels: FixtureChannel[];
  physical?: FixturePhysical;
}

export interface FixtureHead {
  channels: number[]; // Channel indices for this head
}

export interface FixtureDefinition {
  id: string;
  manufacturer: string;
  model: string;
  type: 'Color Changer' | 'Dimmer' | 'Effect' | 'Fan' | 'Flower' | 'Hazer' | 'Laser' | 'Moving Head' | 'Other' | 'Scanner' | 'Smoke' | 'Strobe';
  author: string;
  modes: FixtureMode[];
  heads?: FixtureHead[];
  physical?: FixturePhysical;
  // QLC+ compatibility
  qlcplusFile?: string;
}

/** Entrée de la bibliothèque « Budget < 100 € » (resources/fixtures/ofl/budget.json). */
export interface BudgetEntry {
  manufacturer: string;
  model: string;
  priceMin?: number;
  priceMax?: number;
  priceLabel?: string;
  type?: string;
  tags?: string[];
  /** Source de prix vérifiée (URL publique, devise EUR). */
  url?: string;
  /** Date de consultation du prix (AAAA-MM-JJ). */
  checkedAt?: string;
}

// ─── Preset → Type mapping ─────────────────────────────────

const PRESET_TYPE_MAP: Record<string, FixtureChannel['type']> = {
  // Intensity family
  IntensityDimmer: 'Intensity',
  IntensityMasterDimmer: 'Intensity',
  IntensityRed: 'Colour',
  IntensityGreen: 'Colour',
  IntensityBlue: 'Colour',
  IntensityCyan: 'Colour',
  IntensityMagenta: 'Colour',
  IntensityYellow: 'Colour',
  IntensityAmber: 'Colour',
  IntensityWhite: 'Colour',
  IntensityUV: 'Colour',
  IntensityLime: 'Colour',
  IntensityIndigo: 'Colour',
  IntensityHue: 'Colour',
  IntensitySaturation: 'Colour',
  IntensityColorWheel: 'Colour',
  IntensityColorMixMode: 'Colour',

  // Position family
  PositionPan: 'Pan',
  PositionTilt: 'Tilt',
  PositionPanFine: 'Pan',
  PositionTiltFine: 'Tilt',
  PositionPanTiltSpeed: 'Speed',
  PositionPanTiltMacro: 'Effect',

  // Gobo family
  GoboWheel: 'Gobo',
  GoboWheelSpin: 'Gobo',
  GoboWheel2: 'Gobo',
  GoboIndex: 'Gobo',

  // Shutter/Strobe family
  ShutterOpen: 'Shutter',
  ShutterClose: 'Shutter',
  ShutterStrobe: 'Shutter',
  StrobeSpeed: 'Speed',
  StrobeSlowToFast: 'Shutter',
  StrobeFreqRange: 'Shutter',

  // Speed
  SpeedPanTilt: 'Speed',
  SpeedColor: 'Speed',
  SpeedGobo: 'Speed',
  SpeedEffect: 'Speed',

  // Prism
  Prism: 'Prism',
  PrismRotation: 'Prism',
  PrismMacro: 'Prism',

  // Beam
  BeamZoom: 'Beam',
  BeamFocus: 'Beam',
  BeamFrost: 'Beam',
  BeamIris: 'Beam',
  BeamShaper: 'Beam',

  // Effect
  EffectDimmer: 'Effect',
  EffectSpeed: 'Effect',

  // Maintenance
  Maintenance: 'Maintenance',
};

function presetToType(preset: string | undefined): FixtureChannel['type'] {
  if (!preset) return 'Nothing';
  return PRESET_TYPE_MAP[preset] || 'Nothing';
}

function groupToType(group: string | undefined): FixtureChannel['type'] {
  if (!group) return 'Nothing';
  const g = group.toLowerCase();
  if (g === 'intensity') return 'Intensity';
  if (g === 'pan') return 'Pan';
  if (g === 'tilt') return 'Tilt';
  if (g === 'colour' || g === 'color') return 'Colour';
  if (g === 'gobo') return 'Gobo';
  if (g === 'shutter') return 'Shutter';
  if (g === 'speed') return 'Speed';
  if (g === 'prism') return 'Prism';
  if (g === 'effect') return 'Effect';
  if (g === 'beam') return 'Beam';
  if (g === 'maintenance') return 'Maintenance';
  return 'Nothing';
}

// ─── OFL Capability Type → QLC+ Channel Type Mapping ──────

const OFL_TYPE_MAP: Record<string, FixtureChannel['type']> = {
  // Intensity family
  Intensity: 'Intensity',
  ColorIntensity: 'Colour',
  ColorPreset: 'Colour',
  ColorTemperature: 'Colour',

  // Position family
  Pan: 'Pan',
  PanContinuous: 'Pan',
  Tilt: 'Tilt',
  TiltContinuous: 'Tilt',
  // Fine variants (arrivent avec les updates GitHub OFL)
  PositionPanFine: 'Pan',
  PositionTiltFine: 'Tilt',

  // Speed
  PanTiltSpeed: 'Speed',
  Speed: 'Speed',
  EffectSpeed: 'Speed',
  EffectDuration: 'Speed',

  // Shutter / Strobe
  ShutterStrobe: 'Shutter',
  StrobeDuration: 'Shutter',
  StrobeSpeed: 'Speed',

  // Prism
  Prism: 'Prism',
  PrismRotation: 'Prism',

  // Gobo family (types OFL plus récents)
  GoboWheel: 'Gobo',
  GoboWheelRotation: 'Gobo',
  GoboIndex: 'Gobo',
  GoboStencil: 'Gobo',
  GoboShake: 'Gobo',

  // Beam
  BeamAngle: 'Beam',
  BeamPosition: 'Beam',
  Zoom: 'Beam',
  Focus: 'Beam',
  Frost: 'Beam',
  FrostEffect: 'Beam',
  Iris: 'Beam',
  IrisEffect: 'Beam',
  BladeInsertion: 'Beam',
  BladeRotation: 'Beam',
  BladeSystemRotation: 'Beam',

  // Effect
  Effect: 'Effect',
  EffectParameter: 'Effect',
  Generic: 'Effect',
  Fog: 'Effect',
  FogOutput: 'Effect',
  FogType: 'Effect',

  // Maintenance
  Maintenance: 'Maintenance',

  // Rotation (gobo rotation / prism rotation)
  Rotation: 'Speed',

  // Catch-all
  NoFunction: 'Nothing',
  SoundSensitivity: 'Nothing',
  Time: 'Nothing',
};

function oflCapTypeToChannelType(capType: string, channelName: string): FixtureChannel['type'] {
  // Wheel slots: check channel name for Color vs Gobo hint
  if (capType === 'WheelSlot' || capType === 'WheelRotation' || capType === 'WheelShake' || capType === 'WheelSlotRotation') {
    const lower = channelName.toLowerCase();
    if (lower.includes('color') || lower.includes('colour')) return 'Colour';
    if (lower.includes('gobo')) return 'Gobo';
    // Default WheelSlot to Colour (color wheels are more common in OFL)
    if (capType === 'WheelRotation' || capType === 'WheelShake') return 'Colour';
    return 'Gobo';
  }
  return OFL_TYPE_MAP[capType] || 'Nothing';
}

/**
 * Normalise une defaultValue OFL vers un octet DMX 0-255 :
 * - nombre 16-bit (ex. 32639 = 0x7F7F) → octet haut (coarse)
 * - string "50%" → 127/128
 * - nombre 0-255 → tel quel
 */
function normalizeOflDefault(raw: unknown): number {
  if (typeof raw === 'string' && raw.endsWith('%')) {
    const pct = parseFloat(raw);
    if (Number.isFinite(pct)) return Math.round((pct / 100) * 255);
    return 0;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw > 255) return (raw >> 8) & 0xFF;
    if (raw >= 0) return Math.round(raw);
    return 0;
  }
  return 0;
}

// ─── OFL Manufacturer Key → Proper Name ───────────────────

const OFL_MANUFACTURER_MAP: Record<string, string> = {
  '5star-systems': '5Star Systems',
  'abstract': 'Abstract',
  'acoustic-control': 'Acoustic Control',
  'adb': 'ADB',
  'afx': 'AFX',
  'alien-pro': 'Alien Pro',
  'american-dj': 'American DJ',
  'ape-labs': 'Ape Labs',
  'aputure': 'Aputure',
  'arri': 'ARRI',
  'astera': 'Astera',
  'audibax': 'Audibax',
  'ayra': 'Ayra',
  'ayrton': 'Ayrton',
  'beamz': 'BeamZ',
  'big-dipper': 'Big Dipper',
  'bitfocus': 'Bitfocus',
  'blizzard': 'Blizzard',
  'boomtonedj': 'BoomToneDJ',
  'briteq': 'Briteq',
  'cameo': 'Cameo',
  'chauvet-dj': 'Chauvet DJ',
  'chauvet-professional': 'Chauvet Professional',
  'chroma-q': 'Chroma-Q',
  'cinetec': 'Cinetec',
  'clay-paky': 'Clay Paky',
  'clf': 'CLF',
  'coemar': 'Coemar',
  'contest': 'Contest',
  'dedolight': 'Dedolight',
  'dts': 'DTS',
  'dts-italy': 'DTS Italy',
  'ect': 'ECT',
  'elation': 'Elation',
  'elektralite': 'Elektralite',
  'eliminator': 'Eliminator',
  'elumen8': 'Eliminator',
  'equinox': 'Equinox',
  'etc': 'ETC',
  'eurolite': 'Eurolite',
  'event-lighting': 'Event Lighting',
  'expolite': 'Expolite',
  'fos': 'FOS',
  'futurelight': 'Futurelight',
  'gantom': 'Gantom',
  'ge-lighting': 'GE Lighting',
  'glp': 'GLP',
  'gls': 'GLS',
  'gruppe': 'Gruppe',
  'high-end-systems': 'High End Systems',
  'hikari': 'Hikari',
  'iluminarc': 'Iluminarc',
  'img': 'IMG Stageline',
  'jb-lighting': 'JB Lighting',
  'jb-systems': 'JB Systems',
  'kam': 'KAM',
  'keslight': 'KES Light',
  'laserworld': 'Laserworld',
  'lcd': 'LCD',
  'ledj': 'LEDJ',
  'lightmaxx': 'Lightmaxx',
  'lightpro': 'LightPro',
  'lightsky': 'Lightsky',
  'look-solutions': 'Look Solutions',
  'lpg': 'LPG',
  'lss': 'LSS',
  'lth': 'LTH',
  'luminus': 'Luminus',
  'lutec': 'Lutec',
  'macroleds': 'MacroLEDs',
  'magicfx': 'MagicFX',
  'marin': 'Marin',
  'martin': 'Martin',
  'martin-architectural': 'Martin Architectural',
  'martin-rush': 'Martin Rush',
  'mdg': 'MDG',
  'mega-lite': 'Mega Lite',
  'mega-systems': 'Mega Systems',
  'minuit-une': 'Minuit Une',
  'moleculaire': 'Moleculaire',
  'music-hall': 'Music Hall',
  'neo-neon': 'Neo-Neon',
  'nicols': 'Nicols',
  'omni-sistem': 'OmniSistem',
  'optoma': 'Optoma',
  'orlando': 'Orlando',
  'orpheo': 'Orpheo',
  'osram': 'Osram',
  'philips': 'Philips',
  'philips-hue': 'Philips Hue',
  'pls': 'PLS',
  'portman': 'Portman',
  'power-spot': 'Power Spot',
  'proel': 'Proel',
  'prolight': 'Prolight',
  'propar': 'Propar',
  'qtx': 'QTX',
  'renkforce': 'Renkforce',
  'robe': 'Robe',
  'robert-juliat': 'Robert Juliat',
  'sagitter': 'Sagitter',
  'seeburg': 'Seeburg',
  'showtec': 'Showtec',
  'smoke-factory': 'Smoke Factory',
  'sony': 'Sony',
  'sound-king': 'Sound King',
  'spotlight': 'Spotlight',
  'stairville': 'Stairville',
  'steinigke': 'Steinigke',
  'strand': 'Strand',
  'sunrise': 'Sunrise',
  'swisson': 'Swisson',
  'teclec': 'Teclec',
  'triton': 'Triton',
  'ultratec': 'Ultratec',
  'vari-lite': 'Vari-Lite',
  'varytec': 'Varytec',
  'venue': 'Venue',
  'vmb': 'VMB',
  'w-m-f-x': 'W-M-F-X',
  'wolfmix': 'Wolfmix',
  'x-laser': 'X-Laser',
  'yellow-river': 'Yellow River',
  'yuer': 'Yuer',
};

// ─── Recursive file walker ─────────────────────────────────

function getAllFiles(dir: string, ...extensions: string[]): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllFiles(fullPath, ...extensions));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.includes(ext)) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

// ─── Fixture Library ───────────────────────────────────────

export class FixtureLibrary {
  private fixtures: Map<string, FixtureDefinition> = new Map();
  private searchIndex: { id: string; manufacturer: string; model: string; type: string }[] = [];
  private normalizedKeys: Set<string> = new Set();

  async load(): Promise<number> {
    // Clear existing data for a full reload
    this.fixtures.clear();
    this.searchIndex = [];
    this.normalizedKeys.clear();
    this.budgetCache = null; // invalidate budget cache on reload

    // Load bundled QXF/JSON fixtures (recursively)
    const fixturesDir = path.join(app.getAppPath(), 'resources', 'fixtures');
    if (fs.existsSync(fixturesDir)) {
      await this.loadDirectory(fixturesDir);
    }

    // Load OFL fixtures (separate directory, different format)
    const oflDir = path.join(app.getAppPath(), 'resources', 'fixtures', 'ofl');
    if (fs.existsSync(oflDir)) {
      await this.loadOflDirectory(oflDir);
    }

    // Load user data OFL fixtures (override bundled with same ID)
    const userOflDir = path.join(app.getPath('userData'), 'ofl-fixtures');
    if (fs.existsSync(userOflDir)) {
      const result = await this.loadOflDirectory(userOflDir, { overwrite: true });
      if (result.added > 0) {
        console.log(`User data OFL: ${result.added} fixtures loaded (overrides bundled)`);
      }
    }

    // Load custom fixtures from user data
    const userFixturesDir = path.join(app.getPath('userData'), 'fixtures');
    if (fs.existsSync(userFixturesDir)) {
      await this.loadDirectory(userFixturesDir);
    }

    console.log(`Fixture library loaded: ${this.fixtures.size} fixtures`);
    return this.fixtures.size;
  }

  private async loadDirectory(dir: string): Promise<void> {
    const files = getAllFiles(dir, '.qxf', '.json');
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        if (file.endsWith('.qxf')) {
          const def = await this.parseQLC(content, file);
          if (def) this.add(def);
        } else {
          const def = JSON.parse(content) as FixtureDefinition;
          this.add(def);
        }
      } catch (e) {
        console.warn(`Failed to load fixture ${path.basename(file)}:`, e);
      }
    }
  }

  // ─── QLC+ QXF Format Parser ──────────────────────────────
  // Parses the real QLC+ XML fixture definition format.
  // Structure:
  //   <FixtureDefinition>
  //     <Channel Name="Red" Preset="IntensityRed"/>
  //     <Channel Name="Strobe"><Group>Shutter</Group><Capability Min="0" Max="15">...</Capability></Channel>
  //     <Mode Name="7-Ch"><Channel Number="0">Red</Channel>...</Mode>
  //     <Physical>...</Physical>
  //   </FixtureDefinition>

  /** Map common color names to hex — QXF fixtures rarely have Color attributes on capabilities */
  private static COLOR_NAME_MAP: Record<string, string> = {
    red: '#ff0000', green: '#00ff00', blue: '#0000ff',
    white: '#ffffff', black: '#000000',
    yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff',
    orange: '#ff8000', purple: '#8000ff', pink: '#ff80c0',
    amber: '#ffbf00', uv: '#8000ff', 'light blue': '#8080ff',
    'dark blue': '#000080', 'light green': '#80ff80',
    'dark green': '#008000', 'light red': '#ff8080',
    'dark red': '#800000', salmon: '#fa8072', lime: '#00ff00',
    turquoise: '#40e0d0', lavender: '#e6e6fa',
    'warm white': '#ffe4b5', 'cold white': '#f0f8ff',
    'neutral white': '#f5f5dc',
  };

  private static extractColorFromName(name: string): string | undefined {
    if (!name) return undefined;
    const lower = name.toLowerCase().trim();
    // Direct match
    if (FixtureLibrary.COLOR_NAME_MAP[lower]) return FixtureLibrary.COLOR_NAME_MAP[lower];
    // Partial match: "Color 3 (Red)" → find "red" in the name
    for (const [key, hex] of Object.entries(FixtureLibrary.COLOR_NAME_MAP)) {
      if (lower.includes(key)) return hex;
    }
    return undefined;
  }

  async parseQLC(xml: string, filePath?: string): Promise<FixtureDefinition | null> {
    try {
      const parsed = await parseStringPromise(xml, {
        explicitArray: true,
        mergeAttrs: false,
      });
      const fixture = parsed.FixtureDefinition;

      if (!fixture) return null;

      // ── Manufacturer / Model / Type ─────────────────────
      const manufacturer = fixture.Manufacturer?.[0] || 'Unknown';
      const model = fixture.Model?.[0] || 'Unknown';
      const type = (fixture.Type?.[0] as FixtureDefinition['type']) || 'Other';

      // Author lives inside <Creator>
      const author = fixture.Creator?.[0]?.Author?.[0] || 'Unknown';

      // ── Root-level channel definitions ──────────────────
      // These define names, types, and capabilities
      const rootChannels = new Map<string, {
        name: string;
        type: FixtureChannel['type'];
        defaultValue: number;
        capabilities: FixtureCapability[];
      }>();

      const chList = Array.isArray(fixture.Channel) ? fixture.Channel : [];
      for (const ch of chList) {
        const name = ch.$?.Name || 'Unknown';
        // Determine type: Group element takes priority, then Preset attribute
        let chType: FixtureChannel['type'] = 'Nothing';
        const group = ch.Group?.[0]?._;
        if (group) {
          chType = groupToType(group);
        } else if (ch.$?.Preset) {
          chType = presetToType(ch.$?.Preset);
        }

        // Parse capabilities
        const capabilities: FixtureCapability[] = [];
        const caps = Array.isArray(ch.Capability) ? ch.Capability : ch.Capability ? [ch.Capability] : [];
        for (const cap of caps) {
          capabilities.push({
            min: parseInt(cap.$?.Min || '0'),
            max: parseInt(cap.$?.Max || '255'),
            name: cap._ || cap.$?.Name || `Range ${cap.$?.Min || 0}-${cap.$?.Max || 255}`,
            color: cap.$?.Color || cap.$?.Res1 || FixtureLibrary.extractColorFromName(cap._ || cap.$?.Name || ''),
            color2: cap.$?.Color2,
            preset: cap.$?.Preset,
          });
        }

        rootChannels.set(name.toLowerCase(), {
          name,
          type: chType,
          defaultValue: 0,
          capabilities,
        });
      }

      // ── Parse modes ─────────────────────────────────────
      const modes: FixtureMode[] = [];
      const modeList = Array.isArray(fixture.Mode) ? fixture.Mode : fixture.Mode ? [fixture.Mode] : [];

      for (const mode of modeList) {
        const modeName = mode.$?.Name || 'Default';
        const channels: FixtureChannel[] = [];

        const modeChList = Array.isArray(mode.Channel) ? mode.Channel : mode.Channel ? [mode.Channel] : [];
        for (const mch of modeChList) {
          // Mode channels reference root channels by name (in text content _)
          const refName = (mch._ || mch.$?.Name || '').trim();
          const root = rootChannels.get(refName.toLowerCase());

          if (root) {
            channels.push({
              name: root.name,
              type: root.type,
              defaultValue: root.defaultValue,
              capabilities: root.capabilities.length > 0 ? root.capabilities : undefined,
            });
          } else {
            // Channel not found in root — create a bare channel from the reference
            channels.push({
              name: refName || `Channel ${mch.$?.Number || channels.length + 1}`,
              type: 'Nothing',
              defaultValue: 0,
            });
          }
        }

        // ── Physical data (per-mode or global) ────────────
        let physical: FixturePhysical | undefined;
        const physSource = mode.Physical?.[0] || fixture.Physical?.[0];
        if (physSource) {
          physical = {};
          if (physSource.Bulb?.[0]) {
            const b = physSource.Bulb[0].$ || {};
            if (b.Type) physical.bulbType = b.Type;
            if (b.Lumens) physical.bulbLumens = parseFloat(b.Lumens);
            if (b.ColourTemperature) physical.bulbColorTemp = parseFloat(b.ColourTemperature);
          }
          if (physSource.Dimensions?.[0]) {
            const d = physSource.Dimensions[0].$ || {};
            if (d.Weight) physical.weight = parseFloat(d.Weight);
            if (d.Width) physical.width = parseFloat(d.Width);
            if (d.Height) physical.height = parseFloat(d.Height);
            if (d.Depth) physical.depth = parseFloat(d.Depth);
          }
          if (physSource.Lens?.[0]) {
            const l = physSource.Lens[0].$ || {};
            if (l.Name) physical.lensName = l.Name;
            if (l.DegreesMin) physical.lensDegMin = parseFloat(l.DegreesMin);
            if (l.DegreesMax) physical.lensDegMax = parseFloat(l.DegreesMax);
          }
          if (physSource.Focus?.[0]) {
            const f = physSource.Focus[0].$ || {};
            if (f.Type) physical.focusType = f.Type as FixturePhysical['focusType'];
            if (f.PanMax) physical.panMax = parseFloat(f.PanMax);
            if (f.TiltMax) physical.tiltMax = parseFloat(f.TiltMax);
          }
          if (physSource.Technical?.[0]) {
            const t = physSource.Technical[0].$ || {};
            if (t.PowerConsumption) physical.powerConsumption = parseFloat(t.PowerConsumption);
            if (t.DmxConnector) physical.DMXConnector = t.DmxConnector;
          }
        }

        modes.push({
          name: modeName,
          channels,
          physical,
        });
      }

      // ── Global physical ─────────────────────────────────
      let globalPhysical: FixturePhysical | undefined;
      const physSource = fixture.Physical?.[0];
      if (physSource) {
        globalPhysical = {};
        if (physSource.Bulb?.[0]) {
          const b = physSource.Bulb[0].$ || {};
          if (b.Type) globalPhysical.bulbType = b.Type;
          if (b.Lumens) globalPhysical.bulbLumens = parseFloat(b.Lumens);
          if (b.ColourTemperature) globalPhysical.bulbColorTemp = parseFloat(b.ColourTemperature);
        }
        if (physSource.Dimensions?.[0]) {
          const d = physSource.Dimensions[0].$ || {};
          if (d.Weight) globalPhysical.weight = parseFloat(d.Weight);
          if (d.Width) globalPhysical.width = parseFloat(d.Width);
          if (d.Height) globalPhysical.height = parseFloat(d.Height);
          if (d.Depth) globalPhysical.depth = parseFloat(d.Depth);
        }
        if (physSource.Lens?.[0]) {
          const l = physSource.Lens[0].$ || {};
          if (l.Name) globalPhysical.lensName = l.Name;
          if (l.DegreesMin) globalPhysical.lensDegMin = parseFloat(l.DegreesMin);
          if (l.DegreesMax) globalPhysical.lensDegMax = parseFloat(l.DegreesMax);
        }
        if (physSource.Focus?.[0]) {
          const f = physSource.Focus[0].$ || {};
          if (f.Type) globalPhysical.focusType = f.Type as FixturePhysical['focusType'];
          if (f.PanMax) globalPhysical.panMax = parseFloat(f.PanMax);
          if (f.TiltMax) globalPhysical.tiltMax = parseFloat(f.TiltMax);
        }
        if (physSource.Technical?.[0]) {
          const t = physSource.Technical[0].$ || {};
          if (t.PowerConsumption) globalPhysical.powerConsumption = parseFloat(t.PowerConsumption);
          if (t.DmxConnector) globalPhysical.DMXConnector = t.DmxConnector;
        }
      }

      // ── Heads (multi-head fixtures) ─────────────────────
      const heads: FixtureHead[] = [];
      if (fixture.Head) {
        const headList = Array.isArray(fixture.Head) ? fixture.Head : [fixture.Head];
        for (const head of headList) {
          heads.push({
            channels: (head.Channel || []).map((hch: any) => parseInt(hch) || 0),
          });
        }
      }

      // ── Build fixture ID ────────────────────────────────
      const id = `${manufacturer}-${model}`.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '');

      return {
        id,
        manufacturer,
        model,
        type,
        author,
        modes,
        heads: heads.length > 0 ? heads : undefined,
        physical: globalPhysical,
        qlcplusFile: filePath ? path.basename(filePath) : undefined,
      };
    } catch (e) {
      console.warn('Failed to parse QXF:', e);
      return null;
    }
  }

  // ─── OFL Fixture Parser ──────────────────────────────────
  // Parses Open Fixture Library JSON format.
  // Each fixture JSON lives in a manufacturer-key directory.
  // Schema: name, categories, meta, availableChannels, modes

  parseOFLFixture(json: string, manufacturerKey: string): FixtureDefinition | null {
    try {
      const data = JSON.parse(json);

      // ── OFL redirect: skip fixture-redirect.json (points to another fixture) ──
      if (data.redirectTo) return null;

      // ── Manufacturer / Model ────────────────────────────
      const manufacturer = OFL_MANUFACTURER_MAP[manufacturerKey] || manufacturerKey;
      const model = data.name || 'Unknown';

      // ── Type from categories ────────────────────────────
      const categories: string[] = data.categories || [];
      let type: FixtureDefinition['type'] = 'Other';
      for (const cat of categories) {
        const c = cat.toLowerCase();
        if (c.includes('color')) type = 'Color Changer';
        else if (c.includes('moving head')) type = 'Moving Head';
        else if (c.includes('scanner')) type = 'Scanner';
        else if (c.includes('dimmer')) type = 'Dimmer';
        else if (c.includes('strobe')) type = 'Strobe';
        else if (c.includes('laser')) type = 'Laser';
        else if (c.includes('hazer') || c.includes('fog') || c.includes('smoke')) type = 'Smoke';
        else if (c.includes('fan')) type = 'Fan';
        else if (c.includes('flower')) type = 'Flower';
        else if (c.includes('effect')) type = 'Effect';
      }

      // ── Author ──────────────────────────────────────────
      const author = (data.meta?.authors && data.meta.authors.length > 0)
        ? data.meta.authors.join(', ')
        : 'Open Fixture Library';

      // ── Parse availableChannels → channel definitions ───
      const availableChannels = data.availableChannels || {};
      interface ChannelDef {
        name: string;
        type: FixtureChannel['type'];
        defaultValue: number;
        rawDefault?: unknown; // valeur brute OFL (16-bit / %) pour dériver le fine
        capabilities: FixtureCapability[];
      }
      const channelDefs = new Map<string, ChannelDef>();

      for (const [chName, chData] of Object.entries(availableChannels)) {
        const chAny = chData as any;
        // Determine type from first capability
        let chType: FixtureChannel['type'] = 'Nothing';
        let firstCapType = '';

        if (chAny.capability) {
          firstCapType = chAny.capability.type || '';
        } else if (chAny.capabilities && Array.isArray(chAny.capabilities) && chAny.capabilities.length > 0) {
          firstCapType = chAny.capabilities[0].type || '';
        }

        if (firstCapType) {
          chType = oflCapTypeToChannelType(firstCapType, chName);
        }

        // Parse capabilities
        const capabilities: FixtureCapability[] = [];
        const capList = chAny.capabilities
          ? (Array.isArray(chAny.capabilities) ? chAny.capabilities : [chAny.capabilities])
          : chAny.capability ? [chAny.capability] : [];

        for (const cap of capList) {
          const dmxRange = cap.dmxRange || [0, 255];
          const capName = cap.comment || cap.effectName || cap.type || '';
          const capObj: FixtureCapability = {
            min: dmxRange[0] ?? 0,
            max: dmxRange[1] ?? 255,
            name: capName,
          };

          // Color info
          if (cap.color) {
            capObj.color = cap.color;
          }
          if (cap.colorsStart && Array.isArray(cap.colorsStart) && cap.colorsStart.length > 0) {
            capObj.color = cap.colorsStart[0];
          }
          if (cap.colorsEnd && Array.isArray(cap.colorsEnd) && cap.colorsEnd.length > 0) {
            capObj.color2 = cap.colorsEnd[0];
          }

          capabilities.push(capObj);
        }

        channelDefs.set(chName.toLowerCase(), {
          name: chName,
          type: chType,
          defaultValue: normalizeOflDefault(chAny.defaultValue),
          rawDefault: chAny.defaultValue,
          capabilities,
        });
      }

      // ── Index des aliases fine / switching (OFL) ───────────
      // `fineChannelAliases` (ex. "Pan" → ["Pan fine"]) : le canal alias est un
      // clone typé du parent, sans capabilities, nom = alias. Le defaultValue du
      // fine = octet bas du parent 16-bit (neutre), sinon 0.
      const fineAliasMap = new Map<string, ChannelDef>();
      const switchingAliasMap = new Map<string, ChannelDef>();
      for (const [chName, chData] of Object.entries(availableChannels)) {
        const chAny = chData as any;
        const parent = channelDefs.get(chName.toLowerCase());
        if (!parent) continue;
        const aliases: string[] = Array.isArray(chAny.fineChannelAliases) ? chAny.fineChannelAliases : [];
        for (const alias of aliases) {
          const raw = parent.rawDefault;
          const fineDefault = typeof raw === 'number' && raw > 255 ? raw & 0xFF : 0;
          fineAliasMap.set(alias.toLowerCase(), { ...parent, name: alias, defaultValue: fineDefault, capabilities: [] });
        }
        const switchAliases: string[] = Array.isArray(chAny.switchingChannelAliases) ? chAny.switchingChannelAliases : [];
        for (const alias of switchAliases) {
          switchingAliasMap.set(alias.toLowerCase(), { ...parent, name: alias, capabilities: [] });
        }
        if (chAny.switchingChannels && !Array.isArray(chAny.switchingChannelAliases)) {
          // Canal de commutation déclaré sans alias : conservé tel quel dans les modes
          // (résolution via channelDefs), on log simplement pour visibilité.
          console.warn(`OFL switchingChannels sur « ${chName} » : canaux de commutation conservés tels quels`);
        }
      }

      // ── Résolution templateChannels ($pixelKey / $pixelGroup) ──
      const templateChannels = data.templateChannels || {};
      const matrix = data.matrix || {};
      // Pixels : aplatir matrix.pixelKeys (3D) → 1D ; sinon pixelCount → 1..N
      const pixelKeys: string[] = [];
      for (const row of matrix.pixelKeys || []) {
        for (const cell of row) {
          for (const px of cell) pixelKeys.push(String(px));
        }
      }
      if (pixelKeys.length === 0 && Array.isArray(matrix.pixelCount)) {
        let total = 1;
        for (const n of matrix.pixelCount) total *= Number(n) || 1;
        for (let i = 1; i <= total; i++) pixelKeys.push(String(i));
      }
      // Groupes : nom → pixels (une valeur peut être "all" = tous les pixels)
      const pixelGroups: Record<string, string[]> = {};
      for (const [g, list] of Object.entries(matrix.pixelGroups || {})) {
        if (Array.isArray(list)) {
          pixelGroups[g] = list.map(String);
        } else if (list === 'all') {
          pixelGroups[g] = pixelKeys.slice();
        } else {
          pixelGroups[g] = [String(list)];
        }
      }
      // Valeurs candidates de substitution : pixels + noms de groupes
      const pixelCandidates = [...pixelKeys];
      for (const g of Object.keys(pixelGroups)) {
        if (!pixelCandidates.includes(g)) pixelCandidates.push(g);
      }

      // Reverse-match : déduire des valeurs de $pixelKey depuis les réfs de mode
      // (fixtures sans matrix, ex. templates "$pixelKey Laser" + réfs "Red Laser")
      const modeList: any[] = data.modes || [];
      for (const mode of modeList) {
        for (const chRef of (mode.channels || [])) {
          if (typeof chRef !== 'string') continue;
          for (const tplName of Object.keys(templateChannels)) {
            if (!tplName.includes('$pixelKey')) continue;
            const rx = new RegExp('^' + tplName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\$pixelKey/g, '(.+)') + '$', 'i');
            const m = chRef.match(rx);
            if (m && m[1] && !pixelCandidates.includes(m[1])) pixelCandidates.push(m[1]);
          }
        }
      }

      // Map <nom résolu (minuscules) → def> : clé de template substituée
      const resolvedTemplates = new Map<string, ChannelDef>();
      const buildResolved = (tplName: string, tplAny: any, variables: Record<string, string>): void => {
        let resolvedName = tplName;
        for (const [k, v] of Object.entries(variables)) {
          resolvedName = resolvedName.replace(new RegExp('\\$' + k, 'g'), v);
        }
        if (!resolvedName.includes('$')) {
          // Nom final : champ `name` du template substitué, sinon clé substituée
          let displayName = resolvedName;
          if (typeof tplAny.name === 'string' && tplAny.name.includes('$')) {
            displayName = tplAny.name;
            for (const [k, v] of Object.entries(variables)) {
              displayName = displayName.replace(new RegExp('\\$' + k, 'g'), v);
            }
          }
          resolvedTemplates.set(resolvedName.toLowerCase(), {
            name: displayName,
            type: oflCapTypeToChannelType(tplAny.capability?.type || (Array.isArray(tplAny.capabilities) ? tplAny.capabilities[0]?.type : '') || '', tplName),
            defaultValue: normalizeOflDefault(tplAny.defaultValue),
            capabilities: [],
          });
        }
      };
      for (const [tplName, tplData] of Object.entries(templateChannels)) {
        const tplAny = tplData as any;
        if (tplName.includes('$pixelKey')) {
          for (const val of pixelCandidates) buildResolved(tplName, tplAny, { pixelKey: val });
        } else if (tplName.includes('$pixelGroup')) {
          for (const g of Object.keys(pixelGroups)) buildResolved(tplName, tplAny, { pixelGroup: g });
        }
      }

      // ── Parse modes ─────────────────────────────────────
      const modes: FixtureMode[] = [];
      const resolveRef = (chRef: string): FixtureChannel | null => {
        if (!chRef || !chRef.trim()) return null; // réfs vides / null ignorées
        const key = chRef.toLowerCase();
        const def = channelDefs.get(key) || fineAliasMap.get(key) || switchingAliasMap.get(key) || resolvedTemplates.get(key);
        if (def) {
          return {
            name: def.name,
            type: def.type,
            defaultValue: def.defaultValue,
            capabilities: def.capabilities.length > 0 ? def.capabilities : undefined,
          };
        }
        return { name: chRef, type: 'Nothing', defaultValue: 0 };
      };
      const resolveRefs = (refs: unknown[]): FixtureChannel[] => {
        const out: FixtureChannel[] = [];
        for (const chRef of refs) {
          if (chRef === null || chRef === undefined) continue;
          if (typeof chRef === 'string') {
            const ch = resolveRef(chRef);
            if (ch) out.push(ch);
            continue;
          }
          if (typeof chRef === 'object') {
            // Réf objet : { insert: "matrixChannels", repeatFor, channelOrder, templateChannels }
            const ins = (chRef as any).insert;
            if (ins === 'matrixChannels') {
              const repeatFor = String((chRef as any).repeatFor || 'eachPixelABC');
              const channelOrder = String((chRef as any).channelOrder || 'perPixel');
              const tplList: string[] = Array.isArray((chRef as any).templateChannels) ? (chRef as any).templateChannels : [];
              // Ordre des pixels/groupe selon repeatFor
              let order: string[] = [];
              if (repeatFor === 'eachPixelGroup') {
                order = Object.keys(pixelGroups);
              } else if (repeatFor.includes(',')) {
                order = repeatFor.split(',').map((s: string) => s.trim()).filter(Boolean);
              } else {
                order = pixelKeys.length > 0 ? pixelKeys : pixelCandidates;
              }
              if (order.length === 0) order = pixelCandidates;
              // channelOrder perPixel → pour chaque pixel, tous les templates ;
              // perChannel → pour chaque template, tous les pixels
              if (channelOrder === 'perChannel') {
                for (const tplName of tplList) {
                  for (const val of order) {
                    const ch = resolveRef(tplName.replace(/\$pixelKey/g, val));
                    if (ch) out.push(ch);
                  }
                }
              } else {
                for (const val of order) {
                  for (const tplName of tplList) {
                    const ch = resolveRef(tplName.replace(/\$pixelKey/g, val));
                    if (ch) out.push(ch);
                  }
                }
              }
            } else {
              // insert inconnu → canal Nothing de secours
              out.push({ name: JSON.stringify(chRef), type: 'Nothing', defaultValue: 0 });
            }
          }
        }
        return out;
      };

      for (const mode of modeList) {
        const modeName = mode.name || 'Default';
        const modeChannels = (mode.channels || []) as unknown[];
        modes.push({ name: modeName, channels: resolveRefs(modeChannels) });
      }

      // If no modes, create a default mode with all channels
      if (modes.length === 0) {
        const allChannels: FixtureChannel[] = [];
        for (const [, def] of channelDefs) {
          allChannels.push({
            name: def.name,
            type: def.type,
            defaultValue: def.defaultValue,
            capabilities: def.capabilities.length > 0 ? def.capabilities : undefined,
          });
        }
        if (allChannels.length > 0) {
          modes.push({ name: 'Default', channels: allChannels });
        }
      }

      // ── Physical data ───────────────────────────────────
      let physical: FixturePhysical | undefined;
      if (data.physical) {
        const phys = data.physical;
        physical = {};

        if (phys.dimensions) {
          physical.width = phys.dimensions[0];
          physical.height = phys.dimensions[1];
          physical.depth = phys.dimensions[2];
        }
        if (phys.weight != null) physical.weight = phys.weight;
        if (phys.power != null) physical.powerConsumption = phys.power;
        if (phys.DMXconnector) physical.DMXConnector = phys.DMXconnector;

        if (phys.bulb) {
          if (phys.bulb.type) physical.bulbType = phys.bulb.type;
          if (phys.bulb.lumens != null) physical.bulbLumens = phys.bulb.lumens;
          if (phys.bulb.colorTemperature != null) physical.bulbColorTemp = phys.bulb.colorTemperature;
        }

        if (phys.lens) {
          if (phys.lens.name) physical.lensName = phys.lens.name;
          if (phys.lens.degreesMinMax) {
            physical.lensDegMin = phys.lens.degreesMinMax[0];
            physical.lensDegMax = phys.lens.degreesMinMax[1];
          }
        }

        if (phys.focus) {
          if (phys.focus.type) physical.focusType = phys.focus.type as FixturePhysical['focusType'];
          if (phys.focus.panMax != null) physical.panMax = phys.focus.panMax;
          if (phys.focus.tiltMax != null) physical.tiltMax = phys.focus.tiltMax;
        }
      }

      // ── Build fixture ID ────────────────────────────────
      const id = `${manufacturer}-${model}`.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9_-]/g, '');

      return {
        id,
        manufacturer,
        model,
        type,
        author,
        modes,
        physical,
      };
    } catch (e) {
      console.warn(`OFL parse failed (${manufacturerKey}):`, (e as Error).message);
      return null;
    }
  }

  // ─── Load OFL directory ─────────────────────────────────

  async loadOflDirectory(
    dir: string,
    options?: { overwrite?: boolean }
  ): Promise<{ added: number; skipped: number; updated: number }> {
    let added = 0;
    let skipped = 0;
    let updated = 0;
    const overwrite = options?.overwrite ?? false;

    if (!fs.existsSync(dir)) {
      console.log('OFL directory not found:', dir);
      return { added, skipped, updated };
    }

    const mfrDirs = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory());

    for (const mfrDir of mfrDirs) {
      const mfrPath = path.join(dir, mfrDir.name);
      const files = fs.readdirSync(mfrPath, { withFileTypes: true })
        .filter(e => e.isFile() && e.name.endsWith('.json'));

      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(mfrPath, file.name), 'utf-8');
          const def = this.parseOFLFixture(content, mfrDir.name);
          if (!def) continue;
          // Silently skip unparseable fixtures

          // Dedup check
          if (this.hasFixture(def.manufacturer, def.model)) {
            if (overwrite) {
              // Force overwrite: remove old entry from maps and index, re-add
              this.fixtures.delete(def.id);
              this.searchIndex = this.searchIndex.filter(s => s.id !== def.id);
              this.add(def);
              updated++;
            } else {
              skipped++;
            }
            continue;
          }

          this.add(def);
          added++;
        } catch (e) {
          console.warn(`Failed to load OFL fixture ${mfrDir.name}/${file.name}:`, e);
        }
      }
    }

    console.log(`OFL import from ${path.basename(dir)}: ${added} added, ${updated} updated, ${skipped} skipped`);
    return { added, skipped, updated };
  }

  // ─── Import QLC+ fixture definitions ─────────────────────

  async importQLC(filePath: string): Promise<FixtureDefinition | null> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const def = await this.parseQLC(content, filePath);
    if (def) {
      this.add(def);
      // Save to user fixtures
      const userDir = path.join(app.getPath('userData'), 'fixtures');
      fs.mkdirSync(userDir, { recursive: true });
      fs.writeFileSync(path.join(userDir, `${def.id}.json`), JSON.stringify(def, null, 2));
    }
    return def;
  }

  // ─── Normalized dedup key ───────────────────────────────

  private normalizeKey(manufacturer: string, model: string): string {
    return `${manufacturer}-${model}`.toLowerCase().replace(/[^a-z0-9]/g, '-');
  }

  hasFixture(manufacturer: string, model: string): boolean {
    return this.normalizedKeys.has(this.normalizeKey(manufacturer, model));
  }

  // ─── CRUD ────────────────────────────────────────────────

  add(def: FixtureDefinition): void {
    this.fixtures.set(def.id, def);
    this.normalizedKeys.add(this.normalizeKey(def.manufacturer, def.model));
    this.searchIndex.push({
      id: def.id,
      manufacturer: def.manufacturer || 'Unknown',
      model: def.model || 'Unknown',
      type: def.type || 'Other',
    });
  }

  addCustom(def: FixtureDefinition): void {
    def.id = `custom-${def.manufacturer}-${def.model}`.replace(/\s+/g, '-').toLowerCase();
    this.add(def);
    // Persist to disk so custom fixtures survive app restart
    const userDir = path.join(app.getPath('userData'), 'fixtures');
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, `${def.id}.json`), JSON.stringify(def, null, 2));
  }

  get(id: string): FixtureDefinition | undefined {
    return this.fixtures.get(id);
  }

  search(query: string): FixtureDefinition[] {
    const q = query.toLowerCase();
    const results = this.searchIndex
      .filter(f =>
        (f.manufacturer || '').toLowerCase().includes(q) ||
        (f.model || '').toLowerCase().includes(q) ||
        (f.type || '').toLowerCase().includes(q)
      )
      .map(f => this.fixtures.get(f.id)!)
      .filter(Boolean);

    return results;
  }

  getAll(): FixtureDefinition[] {
    return Array.from(this.fixtures.values());
  }

  getByType(type: string): FixtureDefinition[] {
    return this.getAll().filter(f => f.type === type);
  }

  getByManufacturer(manufacturer: string): FixtureDefinition[] {
    const m = manufacturer.toLowerCase();
    return this.getAll().filter(f => f.manufacturer.toLowerCase() === m);
  }

  getStats(): { total: number; byType: Record<string, number>; byManufacturer: Record<string, number> } {
    const byType: Record<string, number> = {};
    const byManufacturer: Record<string, number> = {};
    for (const [, def] of this.fixtures) {
      byType[def.type] = (byType[def.type] || 0) + 1;
      byManufacturer[def.manufacturer] = (byManufacturer[def.manufacturer] || 0) + 1;
    }
    return { total: this.fixtures.size, byType, byManufacturer };
  }

  // ─── Bibliothèque « Budget < 100 € » ──────────────────────
  // Fichier racine de ofl/ (ignoré par loadOflDirectory qui n'itère que les
  // sous-dossiers fabricants). NE PAS le déplacer dans resources/fixtures/
  // (serait parsé comme fixture par loadDirectory).
  private budgetCache: { entries: BudgetEntry[] } | null = null;

  getBudgetList(): { entries: BudgetEntry[] } {
    if (this.budgetCache) return this.budgetCache;
    const p = path.join(app.getAppPath(), 'resources', 'fixtures', 'ofl', 'budget.json');
    if (fs.existsSync(p)) {
      try {
        this.budgetCache = JSON.parse(fs.readFileSync(p, 'utf-8')) as { entries: BudgetEntry[] };
        if (Array.isArray(this.budgetCache?.entries)) return this.budgetCache;
        this.budgetCache = null;
      } catch {
        this.budgetCache = null;
      }
    }
    return { entries: [] };
  }

  // ─── Fixture Instance Creator ────────────────────────────

  createInstance(defId: string, modeIndex: number = 0, startAddress: number = 1): FixtureInstance | null {
    const def = this.fixtures.get(defId);
    if (!def || modeIndex >= def.modes.length) return null;

    const mode = def.modes[modeIndex];
    return new FixtureInstance(def, modeIndex, startAddress);
  }
}

// ─── Fixture Instance (a patched fixture in your show) ─────

export class FixtureInstance {
  id: string;
  definition: FixtureDefinition;
  modeIndex: number;
  mode: FixtureMode;
  startAddress: number;
  name: string;

  constructor(def: FixtureDefinition, modeIndex: number, startAddress: number) {
    this.id = `fixture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.definition = def;
    this.modeIndex = modeIndex;
    this.mode = def.modes[modeIndex];
    this.startAddress = startAddress;
    this.name = `${def.manufacturer} ${def.model}`;
  }

  get channelCount(): number {
    return this.mode.channels.length;
  }

  get endAddress(): number {
    return this.startAddress + this.channelCount - 1;
  }

  getChannelOffset(channelName: string): number | null {
    const idx = this.mode.channels.findIndex(
      ch => ch.name.toLowerCase() === channelName.toLowerCase()
    );
    return idx >= 0 ? idx : null;
  }

  // Get the DMX channel map for this fixture
  getChannelMap(): Record<string, number> {
    const map: Record<string, number> = {};
    this.mode.channels.forEach((ch, i) => {
      map[ch.name] = this.startAddress + i;
      map[ch.type] = this.startAddress + i; // Also index by type
    });
    return map;
  }

  // Convenience setters for common channel types
  setIntensity(value: number): Record<number, number> {
    for (let i = 0; i < this.mode.channels.length; i++) {
      if (this.mode.channels[i].type === 'Intensity') {
        return { [this.startAddress + i]: value };
      }
    }
    return {};
  }

  setPanTilt(pan: number, tilt: number): Record<number, number> {
    const map: Record<number, number> = {};
    for (let i = 0; i < this.mode.channels.length; i++) {
      if (this.mode.channels[i].type === 'Pan') map[this.startAddress + i] = pan;
      if (this.mode.channels[i].type === 'Tilt') map[this.startAddress + i] = tilt;
    }
    return map;
  }

  setRGB(r: number, g: number, b: number): Record<number, number> {
    const map: Record<number, number> = {};
    let colorIdx = 0;
    for (let i = 0; i < this.mode.channels.length; i++) {
      if (this.mode.channels[i].type === 'Colour') {
        const colors = [r, g, b];
        if (colorIdx < 3) map[this.startAddress + i] = colors[colorIdx++];
      }
    }
    return map;
  }
}
