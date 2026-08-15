/**
 * Fixture Analyzer — Module unifié d'analyse des canaux DMX
 *
 * Fusion de analyzeChannels (dmx-channel.ts) et analyzeFixture (dmx-cues.ts)
 * en un seul analyseur complet. Tous les consommateurs utilisent désormais
 * ce module pour éviter la duplication et les bugs d'inconsistance.
 *
 * Correction du bug ch.offset : utilise ch.offset ?? i partout.
 */

import type { PatchedFixture } from '../stores/showStore';
import type { DmxFixtureDefinition, DmxFixtureCapability } from '../hooks/dmx-cues';
import { RgbSegment, startsWithRgb, hasColorWord, isRed, isGreen, isBlue, isWhite, isPresetMode, buildRgbSegments } from './dmx-color';

// ─── Interface unifiée ─────────────────────────────────────────

export interface FixtureChannelAnalysis {
  // Identité
  fixture: PatchedFixture;

  // Intensity
  intensityOffset: number | null;
  ledIntensityOffsets: number[];

  // Shutter / Effect
  shutterOffset: number | null;
  effectOffset: number | null;
  effectCaps: DmxFixtureCapability[] | null;

  // Couleur
  rgbSegments: RgbSegment[];        // multi-segment RGB (depuis dmx-color.ts)
  rgbOffsets: number[] | null;      // RGB simple (fallback pour consommateurs simples)
  wheelOffset: number | null;
  wheelCaps: DmxFixtureCapability[];

  // Mouvement
  panOffset: number | null;
  panFineOffset: number | null;
  panOffsets: number[];
  tiltOffset: number | null;
  tiltFineOffset: number | null;
  tiltOffsets: number[];

  // Gobo
  goboOffset: number | null;
  goboCaps: DmxFixtureCapability[];

  // Beam
  zoomOffset: number | null;
  frostOffset: number | null;
  irisOffset: number | null;
  focusOffset: number | null;
  beamOffset: number | null;

  // Autres
  prismOffset: number | null;
  speedOffset: number | null;
  macroOffsets: number[];
  presetOverrideOffsets: number[];

  // Méta
  channelCount: number;
  universeIndex: number;
}

// ─── Type alias pour compatibilité ─────────────────────────────

/** Alias rétro-compatible pour les consommateurs de dmx-channel.ts */
export type ChannelAnalysis = FixtureChannelAnalysis;

// ─── Fonction unifiée ──────────────────────────────────────────

const _logged = new Set<string>();

export function analyzeFixtureChannels(
  pf: PatchedFixture,
  def: DmxFixtureDefinition | undefined,
): FixtureChannelAnalysis {
  const channels = def?.modes[pf.modeIndex]?.channels ?? [];

  const fa: FixtureChannelAnalysis = {
    fixture: pf,
    intensityOffset: null,
    ledIntensityOffsets: [],
    shutterOffset: null,
    effectOffset: null,
    effectCaps: null,
    rgbSegments: [],
    rgbOffsets: null,
    wheelOffset: null,
    wheelCaps: [],
    panOffset: null,
    panFineOffset: null,
    panOffsets: [],
    tiltOffset: null,
    tiltFineOffset: null,
    tiltOffsets: [],
    goboOffset: null,
    goboCaps: [],
    zoomOffset: null,
    frostOffset: null,
    irisOffset: null,
    focusOffset: null,
    beamOffset: null,
    prismOffset: null,
    speedOffset: null,
    macroOffsets: [],
    presetOverrideOffsets: [],
    channelCount: channels.length,
    universeIndex: 0,
  };

  const colourChannels: Array<{ offset: number; name: string; caps?: DmxFixtureCapability[] }> = [];

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const off = ch.offset ?? i;
    const chName = (ch.name?.trim() ?? '');

    // Preset override channels — excluded from auto-generated DMX
    if (isPresetMode.test(chName)) {
      fa.presetOverrideOffsets.push(off);
      continue;
    }

    // Macro channels — excluded from auto-generated DMX (user-configured only)
    if (ch.type === 'Macro') {
      fa.macroOffsets.push(off);
      continue;
    }

    // Shutter/Dimmer hybride (from dmx-channel.ts)
    const isShutterDimmer = /\bdimmer\b/i.test(chName) && ch.type === 'Shutter';
    if (isShutterDimmer && fa.intensityOffset === null) {
      fa.intensityOffset = off;
    }

    // Auto-detect RGB by name (from dmx-cues.ts — broader pattern)
    const chNameLower = chName.toLowerCase();
    const isRgbNamed = /^(red|green|blue|r|g|b)(\s*\(?\d*\)?)?$/i.test(chNameLower);

    // Colour channel detection (merged from both analyzers)
    const hasColorCaps = ch.capabilities?.some(cap => cap.color);
    if (isRgbNamed || startsWithRgb.test(chName) || ch.type === 'Colour' || (ch.type === 'Beam' && hasColorWord.test(chName)) || hasColorCaps) {
      colourChannels.push({ offset: off, name: chName, caps: ch.capabilities });
      continue;
    }

    switch (ch.type) {
      case 'Intensity':
        if (fa.intensityOffset === null) {
          fa.intensityOffset = off;
        } else {
          fa.ledIntensityOffsets.push(off);
        }
        break;
      case 'Shutter':
        if (fa.shutterOffset === null) fa.shutterOffset = off;
        break;
      case 'Effect':
        if (fa.effectOffset === null) {
          fa.effectOffset = off;
          fa.effectCaps = ch.capabilities ?? null;
        }
        break;
      case 'Pan':
        if (fa.panOffset === null) fa.panOffset = off;
        else if (fa.panFineOffset === null && /\bfine\b/i.test(chName)) fa.panFineOffset = off;
        if (!/\bfine\b/i.test(chName)) fa.panOffsets.push(off);
        break;
      case 'Tilt':
        if (fa.tiltOffset === null) fa.tiltOffset = off;
        else if (fa.tiltFineOffset === null && /\bfine\b/i.test(chName)) fa.tiltFineOffset = off;
        if (!/\bfine\b/i.test(chName)) fa.tiltOffsets.push(off);
        break;
      case 'Gobo':
        if (fa.goboOffset === null) {
          fa.goboOffset = off;
          fa.goboCaps = ch.capabilities ?? [];
        }
        break;
      case 'Prism':
        if (fa.prismOffset === null) fa.prismOffset = off;
        break;
      case 'Zoom':
        if (fa.zoomOffset === null) fa.zoomOffset = off;
        break;
      case 'Frost':
        if (fa.frostOffset === null) fa.frostOffset = off;
        break;
      case 'Focus':
        if (fa.focusOffset === null) fa.focusOffset = off;
        break;
      case 'Iris':
        if (fa.irisOffset === null) fa.irisOffset = off;
        break;
      case 'Speed':
        if (fa.speedOffset === null) fa.speedOffset = off;
        break;
      case 'Beam':
        if (fa.beamOffset === null) fa.beamOffset = off;
        break;
    }
  }

  // ─── Colour analysis (merged from both analyzers) ───────────

  if (colourChannels.length > 0) {
    // RGB detection (from dmx-channel.ts — using buildRgbSegments)
    const hasRgbStart = colourChannels.some(c => startsWithRgb.test(c.name));
    const hasRgbWords = colourChannels.some(c => isRed.test(c.name))
      && colourChannels.some(c => isGreen.test(c.name))
      && colourChannels.some(c => isBlue.test(c.name));
    const hasRgbNames = (hasRgbStart || hasRgbWords) && colourChannels.length >= 3;
    const hasColorCaps = colourChannels.some(c => c.caps?.some(cap => cap.color));

    if (hasRgbNames) {
      // Use buildRgbSegments from dmx-color.ts (from dmx-channel.ts)
      fa.rgbSegments = buildRgbSegments(colourChannels);
      // Also compute simple rgbOffsets for dmx-cues.ts consumers
      const rIdx = colourChannels.findIndex(c => !/\bfine\b/i.test(c.name) && /red|\br\b/i.test(c.name));
      const gIdx = colourChannels.findIndex(c => !/\bfine\b/i.test(c.name) && /green|\bg\b/i.test(c.name));
      const bIdx = colourChannels.findIndex(c => !/\bfine\b/i.test(c.name) && /blue|\bb\b/i.test(c.name));
      if (rIdx >= 0 && gIdx >= 0 && bIdx >= 0) {
        fa.rgbOffsets = [colourChannels[rIdx].offset, colourChannels[gIdx].offset, colourChannels[bIdx].offset];
      } else {
        fa.rgbOffsets = colourChannels.slice(0, 3).map(c => c.offset);
      }
    } else if (hasColorCaps) {
      // Color wheel with capabilities
      const wheel = colourChannels.find(c => c.caps?.some(cap => cap.color));
      if (wheel) {
        fa.wheelOffset = wheel.offset;
        fa.wheelCaps = wheel.caps ?? [];
      }
    } else if (colourChannels.length >= 3) {
      // Fallback: treat first 3 as RGB
      fa.rgbSegments = buildRgbSegments(colourChannels);
      if (fa.rgbSegments.length === 0) {
        fa.rgbSegments = [{ r: colourChannels[0].offset, g: colourChannels[1].offset, b: colourChannels[2].offset, w: null }];
      }
      fa.rgbOffsets = colourChannels.slice(0, 3).map(c => c.offset);
    } else if (colourChannels.length === 1) {
      // Single color channel — treat as wheel
      fa.wheelOffset = colourChannels[0].offset;
      const ch = channels.find((c, idx) => (c.offset ?? idx) === colourChannels[0].offset);
      if (ch?.capabilities && ch.capabilities.length > 0) {
        fa.wheelCaps = ch.capabilities;
      }
    }
  }

  // Fill wheelCaps if wheelOffset is set but caps are empty (from dmx-channel.ts)
  if (fa.wheelOffset !== null && fa.wheelCaps.length === 0) {
    const ch = channels.find((c, idx) => (c.offset ?? idx) === fa.wheelOffset);
    if (ch?.capabilities && ch.capabilities.length > 0) {
      fa.wheelCaps = ch.capabilities;
    }
  }

  // Debug log (from dmx-channel.ts, once per fixture)
  if (!_logged.has(pf.id)) {
    _logged.add(pf.id);
    console.log(`[analyzeFixtureChannels] ${pf.name} (${pf.fixtureType}, tier=${pf.tier}, addr=${pf.startAddress})`,
      `| colourChannels: ${colourChannels.length} [${colourChannels.map(c => `${c.name}@${c.offset}`).join(', ')}]`,
      `| rgbSegments: ${fa.rgbSegments.length > 0 ? fa.rgbSegments.map(s => `R${s.r}G${s.g}B${s.b}`).join('; ') : '∅'}`,
      `| rgbOffsets: ${fa.rgbOffsets ? fa.rgbOffsets.join(',') : '∅'}`,
      `| wheelOffset: ${fa.wheelOffset} (caps:${fa.wheelCaps.length})`,
      `| intensityOffset: ${fa.intensityOffset} shutterOffset: ${fa.shutterOffset}`,
      `| panOffsets: [${fa.panOffsets.join(',')}] tiltOffsets: [${fa.tiltOffsets.join(',')}]`);
  }

  return fa;
}

// ─── Adaptateurs de compatibilité ──────────────────────────────

/**
 * Adaptateur rétro-compatible pour les consommateurs de dmx-channel.ts.
 * Retourne la même analyse complète — l'ancienne interface ChannelAnalysis
 * est maintenant un alias de FixtureChannelAnalysis.
 */
export function analyzeChannels(pf: PatchedFixture, def: DmxFixtureDefinition | undefined): ChannelAnalysis {
  return analyzeFixtureChannels(pf, def);
}

/**
 * Adaptateur rétro-compatible pour les consommateurs de dmx-cues.ts.
 * Retourne la même analyse complète.
 */
export function analyzeFixture(pf: PatchedFixture, def: DmxFixtureDefinition | undefined): FixtureChannelAnalysis {
  return analyzeFixtureChannels(pf, def);
}
