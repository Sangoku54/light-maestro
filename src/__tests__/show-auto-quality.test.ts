import { describe, it, expect, beforeEach } from 'vitest';
import type { TrackSection, TrackAnalysis } from '../hooks/audio-analysis';
// @ts-ignore — le fichier contient du JSX ailleurs, genCues est du TS pur
import { genCues } from '../views/QuickShowView';
import { sectionMoveFor, sampleSectionLoopRaw, type SectionMoveLoop } from '../engine/autoscript-loops';
import { getSectionEnvelope, sampleCurve, clearSectionEnvelopes } from '../engine/autoscript-envelopes';
import { SECTION_MIN_INTENSITY } from '../hooks/dmx-cues';

/**
 * SONDE DE QUALITÉ DU SHOW AUTO
 *
 * Mesure les grandeurs objectives du défaut signalé :
 * « les mouvements sont toujours rapides, sans nuance de rapidité ni de
 * dimmer ».
 *
 * Ce test est la régression : il verrouille une vitesse bornée et
 * hiérarchisée, une vraie nuance de vitesse intra-section, un dimmer
 * CONTINU (pas un escalier) et une trajectoire interpolée.
 */

// ─── Helpers ──────────────────────────────────────────────

function makeSection(type: TrackSection['type'], start: number, end: number, energy = 0.5): TrackSection {
  return { type, startTime: start, endTime: end, energy, color: '#888' };
}

const SECTIONS: TrackSection[] = [
  makeSection('intro', 0, 16, 0.3),
  makeSection('verse', 16, 48, 0.5),
  makeSection('build', 48, 64, 0.7),
  makeSection('drop', 64, 96, 0.95),
  makeSection('chorus', 96, 128, 0.85),
  makeSection('outro', 128, 144, 0.25),
];

const CFG = {
  musicStyle: 'techno',
  colorScheme: 'auto',
  intensity: 'dynamic',
  movement: 'dynamic',
  beatDivision: 4,
  audioReactive: true,
  sectionAware: true,
  customPalette: [],
};

const BPM = 120;

/**
 * Analyse réaliste : RMS en rampe dans chaque section ( creux → pic),
 * beats réguliers, forces strong/weak alternées.
 */
function makeAnalysis(duration = 144): TrackAnalysis {
  const len = 512;
  const rmsCurve = new Array(len).fill(0).map((_, i) => {
    const t = i / (len - 1);
    // intro calme → verse moyen → build en montée → drop fort → outro calme
    if (t < 0.11) return 0.18 + t * 1.2;
    if (t < 0.33) return 0.42 + Math.sin(t * 22) * 0.16;
    if (t < 0.44) return 0.5 + (t - 0.33) * 3.2;
    if (t < 0.66) return 0.88 - Math.sin(t * 40) * 0.2;
    if (t < 0.88) return 0.8 + Math.sin(t * 30) * 0.14;
    return 0.4 - (t - 0.88) * 2;
  });
  const beats: number[] = [];
  const beatStrengths: ('strong' | 'weak')[] = [];
  for (let t = 0; t < duration; t += 60 / BPM) {
    beats.push(t);
    beatStrengths.push(Math.round(t / (60 / BPM)) % 4 === 0 ? 'strong' : 'weak');
  }
  return {
    duration,
    sampleRate: 44100,
    bpm: BPM,
    beats,
    beatPositions: beats,
    beatStrengths,
    downbeats: beats.filter((_, i) => i % 4 === 0),
    timeSignature: '4/4',
    key: 'C',
    keyConfidence: 0.8,
    genre: JSON.stringify({ genre: 'techno' }),
    atmosphere: 'energetic',
    energyCurve: new Array(len).fill(0).fill(0, 0, len).map((_, i) => rmsCurve[i]),
    rmsCurve,
    spectralCentroidCurve: new Array(len).fill(0.5),
    onsetCurve: new Array(len).fill(0).map((_, i) => (i % 17 === 0 ? 0.8 : 0.05)),
    lowCurve: new Array(len).fill(0.4),
    midCurve: new Array(len).fill(0.3),
    highCurve: new Array(len).fill(0.2),
  };
}

/** Vitesse instantanée (tours/s) d'une boucle à la position p (0..1). */
function instantSpeed(loop: SectionMoveLoop, p: number): number {
  const i = Math.min(loop.samples - 1, Math.max(0, Math.floor(p * loop.samples)));
  const j = Math.min(loop.samples - 1, i + 1);
  const dp = (j - i) / loop.samples;
  if (dp <= 0) return 0;
  const dTurns = loop.warp[j] - loop.warp[i];
  const dur = loop.end - loop.start;
  return (dTurns / dp) / dur;
}

// ─── Tests ────────────────────────────────────────────────

describe('show auto — qualité du mouvement et du dimmer', () => {
  let cues: any[];

  beforeEach(() => {
    clearSectionEnvelopes();
    cues = genCues(SECTIONS, BPM, 4, CFG as any, [], undefined, makeAnalysis());
  });

  it('la vitesse du mouvement est HIÉRARCHISÉE par section', () => {
    const speedOf = (section: string) => {
      const cue = cues.find((c) => c.section === section);
      expect(cue, `cue de section ${section}`).toBeDefined();
      const loop = sectionMoveFor(cue as any, 1)!;
      expect(loop, `boucle de section ${section}`).not.toBeNull();
      return loop.cycles / (cue.sectionEnd - cue.sectionStart);
    };
    const intro = speedOf('intro');
    const verse = speedOf('verse');
    const chorus = speedOf('chorus');
    const drop = speedOf('drop');

    expect(intro).toBeLessThan(verse);
    expect(verse).toBeLessThan(chorus);
    expect(chorus).toBeLessThanOrEqual(drop);
  });

  it('la vitesse est BORNÉE : plus de 2 tours/seconde dans le drop', () => {
    // Avant le correctif : drop = 1 beat/tour → 2 tours/s à 120 BPM, quelle
    // que soit l'énergie du morceau (« toujours rapide »).
    const dropCue = cues.find((c) => c.section === 'drop')!;
    const loop = sectionMoveFor(dropCue as any, 1)!;
    const dur = dropCue.sectionEnd - dropCue.sectionStart;
    const avg = loop.cycles / dur;
    let maxInstant = 0;
    for (let p = 0; p < 1; p += 0.005) maxInstant = Math.max(maxInstant, instantSpeed(loop, p));
    expect(avg).toBeLessThanOrEqual(1.2);
    expect(maxInstant).toBeLessThanOrEqual(1.8);
  });

  it('la vitesse varie avec l\'énergie locale (nuance de rapidité)', () => {
    const dropCue = cues.find((c) => c.section === 'drop')!;
    const env = getSectionEnvelope(dropCue.envId);
    expect(env, 'enveloppe de la section drop').not.toBeNull();
    const speed = env!.speed;
    const min = Math.min(...speed);
    const max = Math.max(...speed);
    // L'enveloppe doit avoir une vraie amplitude…
    expect(max / min).toBeGreaterThan(1.25);
    // …sans changer le nombre de tours de la section (moyenne ≈ 1).
    const mean = speed.reduce((a, b) => a + b, 0) / speed.length;
    expect(mean).toBeGreaterThan(0.85);
    expect(mean).toBeLessThan(1.15);
    // Et la boucle doit refléter cette nuance (vitesse instantanée variable).
    const loop = sectionMoveFor(dropCue as any, 1)!;
    const inst: number[] = [];
    for (let p = 0; p < 0.999; p += 0.005) inst.push(instantSpeed(loop, p));
    expect(Math.max(...inst) / Math.max(0.0001, Math.min(...inst))).toBeGreaterThan(1.15);
  });

  it('le dimmer est CONTINU : beaucoup de valeurs distinctes et un vrai amplitude', () => {
    const verseCue = cues.find((c) => c.section === 'verse')!;
    const env = getSectionEnvelope(verseCue.envId);
    expect(env, 'enveloppe de la section verse').not.toBeNull();

    const dm = env!.dimmer;
    const distinct = new Set(dm.map((v) => Math.round(v * 255))).size;
    // Avant : 5 paliers (very-low…very-high) tenus jusqu'à la cue suivante.
    expect(distinct).toBeGreaterThan(12);
    expect(Math.max(...dm) - Math.min(...dm)).toBeGreaterThan(0.04);
    // Plancher de section respecté.
    const floor = (SECTION_MIN_INTENSITY.verse ?? 60) / 255;
    expect(Math.min(...dm)).toBeGreaterThanOrEqual(floor - 1e-6);
    // Jamais saturé en permanence : le show doit respirer.
    expect(Math.max(...dm)).toBeLessThanOrEqual(1);
  });

  it('le dimmer échantillonné varie à l\'intérieur d\'un beat (respiration)', () => {
    const verseCue = cues.find((c) => c.section === 'verse')!;
    const env = getSectionEnvelope(verseCue.envId)!;
    const samples: number[] = [];
    for (let t = verseCue.sectionStart; t < verseCue.sectionStart + 4; t += 0.02) {
      samples.push(sampleCurve(env.dimmer, verseCue.sectionStart, verseCue.sectionEnd, t));
    }
    const distinct = new Set(samples.map((v) => Math.round(v * 255))).size;
    expect(distinct).toBeGreaterThan(10);
    // Pas de marche d'escalier : les variations restent douces.
    let maxStep = 0;
    for (let i = 1; i < samples.length; i++) {
      maxStep = Math.max(maxStep, Math.abs(samples[i] - samples[i - 1]));
    }
    expect(maxStep).toBeLessThan(0.08);
  });

  it('la trajectoire est CONTINUE (interpolée) sur la timeline réelle', () => {
    const dropCue = cues.find((c) => c.section === 'drop')!;
    const loop = sectionMoveFor(dropCue as any, 1)!;
    // 60 fps sur 2 s de section.
    let maxJump = 0;
    let prev = sampleSectionLoopRaw(loop, 0, 0, 0);
    for (let i = 1; i <= 120; i++) {
      const t = dropCue.sectionStart + (i / 60);
      const p = (t - dropCue.sectionStart) / (dropCue.sectionEnd - dropCue.sectionStart);
      const cur = sampleSectionLoopRaw(loop, p, 0, 0);
      maxJump = Math.max(maxJump, Math.hypot(cur[0] - prev[0], cur[1] - prev[1]));
      prev = cur;
    }
    // Sans interpolation : saut de ~0,8 (un échantillon entier de la boucle).
    expect(maxJump).toBeLessThan(0.12);
  });

  it('le pattern de mouvement change sur un rythme MUSICAL (≥ 8 beats)', () => {
    const dropCues = cues.filter((c) => c.section === 'drop');
    let changes = 0;
    for (let i = 1; i < dropCues.length; i++) {
      if (dropCues[i].movement !== dropCues[i - 1].movement) changes++;
    }
    const sectionBeats = (dropCues[dropCues.length - 1].sectionEnd - dropCues[0].sectionStart) * BPM / 60;
    // Avant : 1 changement toutes les 4 CUES (≈ 0,9 s en drop).
    expect(changes).toBeLessThanOrEqual(Math.ceil(sectionBeats / 8) + 1);
  });

  it('toutes les sections reçoivent une enveloppe (aucune section « plate »)', () => {
    for (const section of SECTIONS) {
      const cue = cues.find((c) => c.sectionStart === section.startTime);
      const env = getSectionEnvelope(cue?.envId);
      expect(env, `enveloppe ${section.type}`).not.toBeNull();
      expect(env!.speed.length).toBeGreaterThan(8);
      expect(env!.dimmer.length).toBeGreaterThan(8);
    }
  });

  it('deux shows coexistants ne se volent pas leurs enveloppes', () => {
    // Identifiants uniques par section : un show régénéré ne doit pas
    // invalider les enveloppes de l'autre (QuickShow + lecteur de preset).
    const first = cues.find((c) => c.section === 'drop')!.envId;
    const other = genCues(SECTIONS, 100, 4, CFG as any, [], 7, makeAnalysis());
    const second = other.find((c) => c.section === 'drop')!.envId;
    expect(second).not.toBe(first);
    expect(getSectionEnvelope(first)).not.toBeNull();
    expect(getSectionEnvelope(second)).not.toBeNull();
  });
});
