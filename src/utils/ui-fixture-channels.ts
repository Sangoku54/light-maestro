// ─── Analyse des canaux d'une fixture (côté UI) ──────────────────────────
//
// Extrait de DesignView.tsx pour être testable : le probe `ui-analyzer-probe`
// testait jusqu'ici une COPIE de cette fonction, ce qui ne garantissait rien
// sur le code réellement exécuté par l'application.
//
// Affichage SEUL : ces types n'ont aucune influence sur le calcul DMX. Le
// moteur exploite ses propres canaux (`src/engine/fixture-analyzer.ts`).

import { displayTypeForChannel } from '../engine/fixture-analyzer';
import type { PatchedFixture } from '../stores/showStore';

export interface AnalyzedChannel {
  /** Position du canal dans le mode (vaut `offset ?? position`). */
  index: number;
  name: string;
  type: string;
  /** Adresse DMX absolue (univers de la fixture inclus via startAddress). */
  dmxAddress: number;
  defaultValue?: number;
  capabilities?: Array<{ min: number; max: number; name: string; color?: string }>;
}

export interface AnalyzedFixtureChannels {
  fixture: PatchedFixture;
  channels: AnalyzedChannel[];
  rgbGroup?: { r: number; g: number; b: number }; // positions dans `channels`
  panIdx?: number;
  tiltIdx?: number;
  dimmerIdx?: number;
  shutterIdx?: number;
  goboIdx?: number;
  colorWheelIdx?: number;
}

/**
 * Analyse les canaux d'une fixture pour l'affichage des contrôles.
 *
 * Les indices `dimmerIdx`, `panIdx`, … sont des POSITIONS dans `channels`
 * (pas la valeur de `channel.index`, qui vaut `offset ?? position` — deux
 * numérotations différentes qui ne coïncident que si aucun offset n'est
 * défini sur le mode).
 */
export function analyzeFixtureChannels(
  fixture: PatchedFixture,
  modeChannels: Array<{ name: string; type: string; defaultValue?: number; capabilities?: any[]; offset?: number }>
): AnalyzedFixtureChannels {
  const channels: AnalyzedChannel[] = modeChannels.map((ch, i) => ({
    index: ch.offset ?? i,
    name: ch.name || `Ch ${i + 1}`,
    type: displayTypeForChannel(ch),
    dmxAddress: fixture.startAddress + (ch.offset ?? i),
    defaultValue: ch.defaultValue,
    capabilities: ch.capabilities,
  }));

  const result: AnalyzedFixtureChannels = { fixture, channels };

  // Identify key channels
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    if (ch.type === 'Intensity' && result.dimmerIdx === undefined) result.dimmerIdx = i;
    if (ch.type === 'Pan' && result.panIdx === undefined) result.panIdx = i;
    if (ch.type === 'Tilt' && result.tiltIdx === undefined) result.tiltIdx = i;
    if (ch.type === 'Shutter' && result.shutterIdx === undefined) result.shutterIdx = i;
    if (ch.type === 'Gobo' && result.goboIdx === undefined) result.goboIdx = i;
  }

  // RGB group detection : two-pass. First pass scans for a true R-G-B
  // triplet (consecutive Colour channels named Red/Green/Blue). Only
  // after that pass completes do we fall back to colorWheelIdx, so that
  // non-RGB Colour channels like "Foreground Color" / "Background Color"
  // (Acme Dotline 360) don't hijack the slot.
  for (let i = 0; i < channels.length - 2; i++) {
    const c = channels[i];
    const n = c.name.toUpperCase();
    if (c.type !== 'Colour') continue;
    if (!/RED| R |^R$/.test(n)) continue;
    const g = channels[i + 1];
    const b = channels[i + 2];
    if (!g || g.type !== 'Colour') continue;
    if (!b || b.type !== 'Colour') continue;
    const gn = g.name.toUpperCase();
    const bn = b.name.toUpperCase();
    if (/GREEN| G |^G$/.test(gn) && /BLUE| B |^B$/.test(bn)) {
      result.rgbGroup = { r: i, g: i + 1, b: i + 2 };
      break;
    }
  }

  // Second pass : assign colorWheelIdx only to Colour channels not in rgbGroup
  if (!result.rgbGroup) {
    for (let i = 0; i < channels.length; i++) {
      if (channels[i].type === 'Colour' && result.colorWheelIdx === undefined) {
        result.colorWheelIdx = i;
      }
    }
  }

  return result;
}
