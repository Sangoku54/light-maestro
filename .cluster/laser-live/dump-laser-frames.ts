/**
 * Traceur des chemins DMX live — dump des frames laser par chemin.
 *
 * Réplique (hors navigateur) les fonctions de calcul de chaque chemin de
 * sortie/lecture de l'app et dump les frames DMX pour les fixtures réelles
 *   - cameo/ioda-400-rgy.json (11ch)
 *   - american-dj/galaxian-3d.json (5ch)
 * aux temps t = 0, 0.5, 1, 2, 4, 8, 10 s.
 *
 * Chemins simulés :
 *   A. tick inline de useDmxPlayback (lecture QuickShow / AutoScript live) —
 *      copie des blocs du tick (src/hooks/dmx-playback.ts L741-1150) pour les
 *      lasers, SANS le bloc laser (celui-ci n'existe que dans computeDmxForCue,
 *      L1431-1484, jamais appelé par le tick hors crossfade < 0.3 s).
 *   B. computeDmxForCue (fonction réelle importée) — utilisée par le crossfade
 *      QuickShow (L678) et par la génération Audio AutoScript (PerformanceView
 *      L1355/L1876) puis rejouée telle quelle.
 *   C. Moteur AutoLoop/SoundSwitch (AutoloopPlaybackEngine réel + banques
 *      buildSoundswitchBanks) — évalue les keyframes bruts, PAS computeDmxForCue.
 */
import fs from 'fs';
import path from 'path';
import { FixtureLibrary } from '../../electron/fixtures/library';
import { analyzeFixtureChannels } from '../../src/engine/fixture-analyzer';
import { computeDmxForCue } from '../../src/hooks/dmx-playback';
import { toAutoloopFixtures, buildSoundswitchBanks } from '../../src/engine/autoloop-runtime';
import { AutoloopPlaybackEngine } from '../../src/engine/autoloop-engine';
import { hexToRgb, mapIntensity, findBestWheelCap, classifyColor } from '../../src/engine/dmx-color';
import type { DmxFixtureDefinition } from '../../src/hooks/dmx-cues';
import type { PatchedFixture } from '../../src/stores/showStore';

const OFL = path.join(process.cwd(), 'resources', 'fixtures', 'ofl');
const lib = new FixtureLibrary();
const TS = [0, 0.5, 1, 2, 4, 8, 10];

interface Loaded {
  mfr: string;
  file: string;
  id: string;
  def: DmxFixtureDefinition;
  mode: { name: string; channels: any[] };
  nCh: number;
  pf: PatchedFixture;
  fa: ReturnType<typeof analyzeFixtureChannels>;
}

function load(mfr: string, file: string, id: string, startAddress = 1): Loaded {
  const raw = fs.readFileSync(path.join(OFL, mfr, file), 'utf8');
  const def = lib.parseOFLFixture(raw, mfr) as unknown as DmxFixtureDefinition;
  const nCh = Math.max(...def.modes.map((m) => m.channels.length));
  const mode = def.modes.find((m) => m.channels.length === nCh)!;
  const pf: PatchedFixture = {
    manufacturer: mfr, model: file, fixtureType: 'laser', modeIndex: 0, modeName: mode.name,
    universeId: 'u1', startAddress, channelCount: nCh, name: file, id, tier: 'primary',
    fixtureDefId: id + '-def',
  } as any;
  const fa = analyzeFixtureChannels(pf, { ...def, modes: [mode] });
  return { mfr, file, id, def, mode, nCh, pf, fa };
}

// Adresses distinctes (comme un vrai patch multi-fixtures) : IODA@1, Galaxian@41.
const FIXTURES = [
  load('cameo', 'ioda-400-rgy.json', 'ioda', 1),
  load('american-dj', 'galaxian-3d.json', 'galaxian', 41),
];

function makeDefs(): Map<string, DmxFixtureDefinition> {
  const m = new Map<string, DmxFixtureDefinition>();
  for (const f of FIXTURES) m.set(f.id + '-def', { ...f.def, modes: [f.mode] });
  return m;
}
const fDefs = makeDefs();
const universes = [{ id: 'u1', name: 'u1', type: 'usb-dmx', channels: 512 }];

function cueAt(t: number, over: Record<string, unknown> = {}) {
  return {
    time: t, section: 'verse', effect: 'color', intensity: 'medium', colors: ['#ff0000'], color: '#ff0000',
    strobe: false, energy: undefined, movementSpeed: undefined, forcedColor: undefined, forcedDimmerVal: undefined,
    movementAmplitude: undefined, movement: undefined, ...over,
  } as any;
}

function fmt(dmx: Record<number, number>): string {
  const keys = Object.keys(dmx).map(Number).sort((a, b) => a - b);
  if (keys.length === 0) return '∅ (aucun canal écrit)';
  return keys.map((k) => `ch${k}=${dmx[k]}`).join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// CHEMIN A — tick inline de useDmxPlayback (QuickShow / AutoScript live).
// Copie fidèle des blocs qui s'appliquent à nos 2 lasers (from L741-1150) :
// intensité, segments RGB, roue + palette, shutter, pan/tilt, gobo/prisme/zoom/
// frost/iris/focus. AUCUN bloc laser (mode/pattern/scan/rot/speeds/blank/rgb
// laser) — le tick n'en contient pas.
// ─────────────────────────────────────────────────────────────────────────────
function tickInline(cue: any, fixtures: Loaded[]): Map<number, Record<number, number>> {
  const energy = cue.energy ?? (cue.intensity === 'very-high' ? 0.95 : cue.intensity === 'high' ? 0.8 : cue.intensity === 'medium' ? 0.5 : cue.intensity === 'low' ? 0.25 : 0.1);
  const isDrop = cue.section.toLowerCase() === 'drop';
  const isChorus = cue.section.toLowerCase() === 'chorus';
  const out = new Map<number, Record<number, number>>();
  const merged: Record<number, number> = {};
  for (const f of fixtures) {
    // Le tick réel agrège toutes les fixtures d'un univers dans un seul Record
    // (adresses distinctes ici : pas de conflit).
    const { pf, fa } = f;
    const chVals: Record<number, number> = {};
    const dimmerVal = mapIntensity(cue.intensity, energy, pf.tier, undefined);
    if (fa.intensityOffset !== null) chVals[pf.startAddress + fa.intensityOffset] = chVals[pf.startAddress + fa.intensityOffset] || dimmerVal;
    const paletteColor = cue.forcedColor || cue.color || cue.colors?.[0] || undefined;
    if (fa.rgbSegments.length > 0 && paletteColor) {
      const [r, g, b] = hexToRgb(paletteColor);
      for (const seg of fa.rgbSegments) {
        chVals[pf.startAddress + seg.r] = r; chVals[pf.startAddress + seg.g] = g; chVals[pf.startAddress + seg.b] = b;
        if (seg.w !== null) chVals[pf.startAddress + seg.w] = 0;
      }
      if (fa.intensityOffset === null) {
        const dScale = dimmerVal / 255;
        for (const seg of fa.rgbSegments) {
          chVals[pf.startAddress + seg.r] = Math.round((chVals[pf.startAddress + seg.r] ?? 0) * dScale);
          chVals[pf.startAddress + seg.g] = Math.round((chVals[pf.startAddress + seg.g] ?? 0) * dScale);
          chVals[pf.startAddress + seg.b] = Math.round((chVals[pf.startAddress + seg.b] ?? 0) * dScale);
        }
      }
    } else if (fa.wheelOffset !== null && paletteColor) {
      const caps = fa.wheelCaps;
      let wheelVal: number;
      if (caps.length > 0) {
        const bestCap = findBestWheelCap(caps, paletteColor);
        wheelVal = bestCap ? Math.round((bestCap.min + bestCap.max) / 2)
          : (() => { const [r, g, b] = hexToRgb(paletteColor); const cat2 = classifyColor(r, g, b); const catMap: Record<string, number> = { red: 0.10, orange: 0.20, yellow: 0.30, green: 0.42, cyan: 0.55, blue: 0.68, magenta: 0.78, purple: 0.78, white: 0.02 }; const wPos = catMap[cat2] ?? 0.5; const capIdx = Math.floor(wPos * caps.length) % caps.length; return Math.round((caps[capIdx].min + caps[capIdx].max) / 2); })();
      } else {
        const [r, g, b] = hexToRgb(paletteColor); const cat2 = classifyColor(r, g, b);
        const catMap: Record<string, number> = { red: 0.10, orange: 0.20, yellow: 0.30, green: 0.42, cyan: 0.55, blue: 0.68, magenta: 0.78, purple: 0.78, white: 0.02 };
        wheelVal = Math.round((catMap[cat2] ?? 0.5) * 255);
      }
      chVals[pf.startAddress + fa.wheelOffset] = wheelVal;
    }
    // Shutter : null pour nos 2 lasers → rien. (Simulateur de strobe : exige
    // intensityOffset non-null → rien non plus.)
    // Pan/Tilt : aucun → rien.
    const fxEnergy = cue.energy ?? 0.5;
    const fxPhase = cue.time * Math.PI * 2 * (cue.movementSpeed ?? 1);
    if (fa.goboOffset !== null) { /* aucun ici */ }
    if (fa.prismOffset !== null) { /* aucun ici */ }
    if (fa.zoomOffset !== null) chVals[pf.startAddress + fa.zoomOffset] = Math.round(64 + Math.sin(fxPhase * 0.4) * 96 * fxEnergy + 64 * fxEnergy);
    if (fa.frostOffset !== null) { /* aucun ici */ }
    if (fa.irisOffset !== null) { /* aucun ici */ }
    if (fa.focusOffset !== null) { /* aucun ici */ }
    // ── PAS de bloc laser ici : le tick live n'écrit jamais
    //    laserMode / pattern / scanX / scanY / roue-laser / rgbOffsets-laser /
    //    vitesses / rotations / blank.
    Object.assign(merged, chVals);
  }
  out.set(0, merged);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHEMIN C — moteur AutoLoop (AutoloopPlaybackEngine + banques SoundSwitch).
// Drive réel sur onBarBeat, bpm 120 → 2 beats/s.
// ─────────────────────────────────────────────────────────────────────────────
function runAutoloop(bpm = 120): { bank: number; frames: Record<string, Record<number, number>> }[] {
  const patched = FIXTURES.map((f) => f.pf);
  const fixtures = toAutoloopFixtures(patched, fDefs, universes as any);
  const banks = buildSoundswitchBanks(fixtures);
  const results: { bank: number; frames: Record<string, Record<number, number>> }[] = [];
  for (let bank = 0; bank < 4; bank++) {
    const seen = new Set<string>();
    for (let slot = 0; slot < 32; slot++) {
      const loop = banks.get(bank, slot);
      if (!loop) continue;
      const sig = JSON.stringify(loop.keys.map((k) => k.channel).sort());
      if (seen.has(sig)) continue;
      seen.add(sig);
      let last: Record<number, number> = {};
      const eng = new AutoloopPlaybackEngine({ send: (d: any) => { last = { ...d }; } }, bpm);
      eng.load(loop);
      eng.trigger();
      const frames: Record<string, Record<number, number>> = {};
      for (const t of TS) {
        const totalBeats = t * (bpm / 60);
        const bar = Math.floor(totalBeats / 4);
        const beat = totalBeats - bar * 4;
        eng.onBarBeat(bar, beat);
        frames[String(t)] = { ...last };
      }
      results.push({ bank, frames });
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Verdicts par canal laser
// ─────────────────────────────────────────────────────────────────────────────
function verdict(canaux: Record<number, number>, f: Loaded): string {
  const { pf, fa } = f;
  const modeCh = fa.laserModeOffset !== null ? pf.startAddress + fa.laserModeOffset : null;
  const vMode = modeCh !== null ? canaux[modeCh] : null;
  const R = fa.rgbOffsets?.[0] !== undefined ? canaux[pf.startAddress + fa.rgbOffsets[0]] : undefined;
  const G = fa.rgbOffsets?.[1] !== undefined ? canaux[pf.startAddress + fa.rgbOffsets[1]] : undefined;
  if (f.file === 'ioda-400-rgy.json') {
    if (modeCh !== null && vMode !== undefined && vMode >= 210) return `VISIBLE EN CONTINU (mode DMX ch${modeCh}=${vMode}, pattern+scan écrits)`;
    return `ÉTEINT (ch${modeCh ?? '?'} mode non écrit / non-DMX: ${vMode ?? '∅'})`;
  }
  if (f.file === 'galaxian-3d.json') {
    const rOn = R !== undefined && R > 22; const gOn = G !== undefined && G > 22;
    if (rOn || gOn) return `VISIBLE (R=${R}, G=${G} — écrits par le bloc laser / couleurs AutoLoop)`;
    return `ÉTEINT (R=${R ?? '∅'}, G=${G ?? '∅'} — jamais écrits ou < seuil)`;
  }
  return '?';
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
const names = new Map<string, string>([['ioda', 'IODA-400-RGY'], ['galaxian', 'Galaxian-3D']]);
for (const f of FIXTURES) {
  console.log(`\n### ${names.get(f.id)} (${f.file}) — ${f.nCh}ch | mode@${f.fa.laserModeOffset} pattern@${f.fa.patternOffset} scan@${f.fa.scanXOffset}/${f.fa.scanYOffset} rot=[${f.fa.laserRotationOffsets}] wheel@${f.fa.wheelOffset} rgb=[${f.fa.rgbOffsets}] shutter@${f.fa.shutterOffset}`);
}
const fById = (id: string) => FIXTURES.find((f) => f.id === id)!;

// — Chemin A : tick inline —
console.log('\n═══════════════ CHEMIN A — tick QuickShow/AutoScript live (inline, SANS bloc laser) ═══════════════');
for (const t of TS) {
  const dmx = tickInline(cueAt(t), FIXTURES);
  const c = dmx.get(0)!;
  console.log(`t=${t}s  [${names.get('ioda')}] ${fmt(pickRange(c, fById('ioda')))}   |   [${names.get('galaxian')}] ${fmt(pickRange(c, fById('galaxian')))}`);
}

// — Chemin B : computeDmxForCue (crossfade QuickShow + génération Audio AutoScript) —
console.log('\n═══════════════ CHEMIN B — computeDmxForCue (réel, bloc laser inclus) ═══════════════');
for (const t of TS) {
  const res = computeDmxForCue(cueAt(t), FIXTURES.map((f) => f.pf), fDefs, universes as any);
  const c = res.find((r) => r.universe === 0)?.channelValues ?? {};
  console.log(`t=${t}s  [${names.get('ioda')}] ${fmt(pickRange(c, fById('ioda')))}   |   [${names.get('galaxian')}] ${fmt(pickRange(c, fById('galaxian')))}`);
}

// — Chemin C : AutoLoop (toutes banques × slots peuplés distincts) —
console.log('\n═══════════════ CHEMIN C — AutoLoop/SoundSwitch (AutoloopPlaybackEngine, PAS computeDmxForCue) ═══════════════');
const loopRuns = runAutoloop(120);
for (const run of loopRuns) {
  const f2 = run.frames[String(2)] ?? {};
  const targets = ['ioda', 'galaxian'].filter((id) => coversF2(f2, id));
  console.log(`\n--- banque ${run.bank} (cibles: ${targets.join(', ') || '?'}) ---`);
  for (const t of TS) {
    const c = run.frames[String(t)] ?? {};
    console.log(`t=${t}s  [${names.get('ioda')}] ${fmt(pickRange(c, fById('ioda')))}   |   [${names.get('galaxian')}] ${fmt(pickRange(c, fById('galaxian')))}`);
  }
}

// — Verdicts —
console.log('\n═══════════════ VERDICTS ═══════════════');
for (const f of FIXTURES) {
  // A : t=2s (dernier cue) + Vérif A stationnaire pour 6 valeurs de t
  const aSet = TS.map((t) => pickRange(tickInline(cueAt(t), FIXTURES).get(0)!, f));
  const aUnique = new Set(aSet.map((m) => JSON.stringify(Object.entries(m).sort())));
  const bSet = TS.map((t) => { const r = computeDmxForCue(cueAt(t), FIXTURES.map((x) => x.pf), fDefs, universes as any); return pickRange(r.find((x) => x.universe === 0)?.channelValues ?? {}, f); });
  const runFor = (bank: number) => loopRuns.find((r) => r.bank === bank && coversF2(r.frames[String(2)] ?? {}, f.id));
  const cOne = runFor(0)?.frames[String(2)] ?? {};

  console.log(`\n${names.get(f.id)} (${f.file}) :`);
  console.log(`  A (tick live)        → ${verdictA(aSet, f)} — frames uniques sur t∈{0..10}: ${aUnique.size}`);
  console.log(`  B (computeDmxForCue) → ${verdict(bSet[2], f)} (via crossfade/AudioAutoScript)`);
  console.log(`  C (AutoLoop banque0) → ${verdict(cOne, f)}`);
  const cB1 = runFor(2)?.frames[String(2)] ?? {};
  if (runFor(2)) console.log(`  C (AutoLoop banque2) → ${verdict(cB1, f)}`);
}

function coversF2(f2: Record<number, number>, id: string): boolean {
  const f = fById(id);
  for (let a = f.pf.startAddress; a < f.pf.startAddress + f.nCh; a++) if (f2[a] !== undefined) return true;
  return false;
}

function pickRange(c: Record<number, number>, f: Loaded): Record<number, number> {
  const out: Record<number, number> = {};
  for (let a = f.pf.startAddress; a < f.pf.startAddress + f.nCh; a++) if (c[a] !== undefined) out[a] = c[a];
  return out;
}

function verdictA(frames: Record<number, number>[], f: Loaded): string {
  const c = frames[frames.length - 1] ?? {};
  const { pf, fa } = f;
  if (f.file === 'ioda-400-rgy.json') {
    const modeCh = fa.laserModeOffset !== null ? pf.startAddress + fa.laserModeOffset : null;
    if (modeCh === null) return 'ÉTEINT (pas de canal mode identifié)';
    const v = c[modeCh];
    return v === undefined ? 'ÉTEINT (canal mode jamais écrit par le tick — reste à 0 = "Laser off")' : `mode écrit ${v}`;
  }
  if (f.file === 'galaxian-3d.json') {
    const any = Object.keys(c).length;
    return any === 0 ? 'ÉTEINT (le tick n\'écrit AUCUN canal de la fixture : rgbSegments ∅, wheel ∅, shutter ∅)' : `écrit ${Object.keys(c).length} canaux`;
  }
  return '?';
}
