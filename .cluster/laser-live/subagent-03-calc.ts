/**
 * AUDIT VALEURS LASER — subagent 03 « auditeur des valeurs laser »
 * ==============================================================
 * Lecture seule, NE MODIFIE PAS src/. Script de calcul (vitest, exécution
 * explicite) qui reproduit l'ÉTAT ACTUEL des 4 chemins d'écriture :
 *   A) tick live useDmxPlayback (dmx-playback.ts L741-1170) — SANS bloc laser
 *   B) computeDmxForCue       (dmx-playback.ts L1171-1500, bloc laser L1431-1484)
 *   C) computeDmxCues         (dmx-cues.ts : couleur L710-727 + bloc 7b L931-977 + filet 128 L990-1003)
 *   D) Autoloop/SoundSwitch   (autoloop-runtime L155-190 + moteur AutoloopPlaybackEngine réel)
 * et classe chaque valeur dans les zones OFL réelles des fixtures.
 *
 * Lancer : npx vitest run .cluster/laser-live/subagent-03-calc.ts
 */
import { describe, it, expect } from 'vitest';
import { analyzeFixtureChannels, laserGateValue, type FixtureChannelAnalysis } from '../../src/engine/fixture-analyzer';
import { buildSoundswitchBanks, toAutoloopFixtures } from '../../src/engine/autoloop-runtime';
import { AutoloopPlaybackEngine, type DmxOutput } from '../../src/engine/autoloop-engine';
import type { PatchedFixture } from '../../src/stores/showStore';
import type { DmxFixtureCapability, DmxFixtureChannel, DmxFixtureDefinition } from '../../src/hooks/dmx-cues';
import fs from 'fs';
import path from 'path';

// ── 1. Chargement OFL avec résolution des templates « $pixelKey … » ──
const OFL_TYPE_MAP: Record<string, DmxFixtureChannel['type']> = {
  Intensity: 'Intensity', ColorIntensity: 'Colour', ColorPreset: 'Colour', ColorTemperature: 'Colour',
  Pan: 'Pan', Tilt: 'Tilt', PanTiltSpeed: 'Speed', Speed: 'Speed', EffectSpeed: 'Speed', EffectDuration: 'Speed',
  ShutterStrobe: 'Shutter', StrobeDuration: 'Shutter', StrobeSpeed: 'Speed',
  Prism: 'Prism', PrismRotation: 'Prism',
  GoboWheel: 'Gobo', GoboWheelRotation: 'Gobo', GoboIndex: 'Gobo', GoboStencil: 'Gobo', GoboShake: 'Gobo',
  BeamAngle: 'Beam', BeamPosition: 'Beam', Zoom: 'Beam', Focus: 'Beam', Frost: 'Beam', FrostEffect: 'Beam',
  Iris: 'Beam', IrisEffect: 'Beam', BladeInsertion: 'Beam', BladeRotation: 'Beam', BladeSystemRotation: 'Beam',
  Effect: 'Effect', EffectParameter: 'Effect', Generic: 'Effect', Fog: 'Effect', FogOutput: 'Effect', FogType: 'Effect',
  Maintenance: 'Maintenance',
  Rotation: 'Speed',
  NoFunction: 'Nothing', SoundSensitivity: 'Nothing', Time: 'Nothing',
};
function loadOfl(relPath: string): { def: DmxFixtureDefinition; modeName: string } {
  const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, relPath), 'utf8'));
  const modes: any[] = Array.isArray(raw.modes) ? raw.modes : [raw.modes];
  const mode = modes.reduce((a, b) => (b.channels.length > a.channels.length ? b : a));
  const available: Record<string, any> = raw.availableChannels;
  const tplSuffix = (key: string) => key.replace(/^\$pixelKey\s*/i, '');
  const channels: DmxFixtureChannel[] = [];
  for (const chRef of mode.channels) {
    let def = available[chRef];
    if (!def) {
      const tplKey = Object.keys(available).find(k => k.startsWith('$pixelKey') && chRef.toLowerCase().includes(tplSuffix(k).toLowerCase()));
      if (tplKey) def = available[tplKey];
    }
    if (!def) { channels.push({ name: chRef, type: 'Nothing', capabilities: [] }); continue; }
    const capsArr = def.capabilities ? def.capabilities : def.capability ? [def.capability] : [];
    const firstType = (def.capability?.type) || (Array.isArray(def.capabilities) && def.capabilities[0]?.type) || '';
    const chType = firstType ? (OFL_TYPE_MAP[firstType] || 'Nothing') : 'Nothing';
    const caps: DmxFixtureCapability[] = capsArr.map((c: any) => {
      const dr = c.dmxRange || [0, 255];
      const obj: DmxFixtureCapability = { min: dr[0] ?? 0, max: dr[1] ?? 255, name: c.comment || c.effectName || c.type || '' };
      if (c.color) obj.color = c.color;
      if (c.colorsStart?.length) obj.color = c.colorsStart[0];
      return obj;
    });
    channels.push({ name: def.name || chRef, type: chType, capabilities: caps });
  }
  const isLaserCat = (raw.categories || []).map((c: string) => c.toLowerCase()).some((c: string) => c.includes('laser'));
  const def: DmxFixtureDefinition = {
    id: raw.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
    manufacturer: 'OFL', model: raw.name,
    modes: [{ name: mode.name, channels }], physical: {},
  };
  return { def, modeName: mode.name };
}
const GAL = loadOfl('../../resources/fixtures/ofl/american-dj/galaxian-3d.json');
const IOD = loadOfl('../../resources/fixtures/ofl/cameo/ioda-400-rgy.json');
const BMB = loadOfl('../../resources/fixtures/ofl/american-dj/boom-box-fx2.json');

function mkPf(defd: DmxFixtureDefinition, startAddress: number): PatchedFixture {
  return {
    id: defd.id + '@' + startAddress, fixtureDefId: defd.id, manufacturer: 'OFL', model: defd.model,
    fixtureType: 'Laser', modeIndex: 0, modeName: defd.modes[0].name,
    universeId: 'u1', startAddress, channelCount: defd.modes[0].channels.length,
    name: defd.model, tier: 'primary', enabled: true,
  };
}

// ── 2. Helpers ──
function zoneLabel(caps: DmxFixtureCapability[] | undefined, v: number | undefined): string {
  if (v === undefined) return '∅ jamais écrit';
  if (!caps || caps.length === 0) return `v=${v} (pas de caps)`;
  const cap = caps.find(c => v >= c.min && v <= c.max);
  return cap ? `v=${v} → [${cap.min}-${cap.max}] «${cap.name}»` : `v=${v} HORS CAPS`;
}
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)];
}
function capMid(cap: DmxFixtureCapability | null | undefined): number { if (!cap) return 128; return Math.round((cap.min + cap.max) / 2); }
function pickLaserModeCap(caps: DmxFixtureCapability[]): DmxFixtureCapability {
  const byName = (re: RegExp) => caps.find((c) => re.test(c.name ?? ''));
  return byName(/dmx|dynamic|manual/i) ?? byName(/auto/i) ?? caps.find((c) => c.max >= 200 && c.min > 0) ?? caps.find((c) => c.min > 0) ?? { min: 128, max: 255, name: 'DMX' };
}
function mapIntensity(level: string, energy: number): number {
  let val: number;
  if (level === 'dynamic') val = Math.round(Math.max(0, 20 + energy * 235));
  else {
    let lo = 120, hi = 220;
    switch (level) { case 'very-low': lo = 40; hi = 130; break; case 'low': lo = 100; hi = 200; break; case 'medium': lo = 140; hi = 240; break; case 'high': lo = 180; hi = 255; break; case 'very-high': lo = 200; hi = 255; break; }
    val = Math.round(Math.max(0, lo + Math.max(0, Math.min(1, energy)) * (hi - lo)));
  }
  return Math.round(val * 1.0);
}

// ── A. tick live (SANS bloc laser — reproduit L741-1170) ──
function tickLive(anim: FixtureChannelAnalysis, energy: number, intensity: string, paletteColor: string | undefined, ct: number): Record<number, number> {
  const pf = anim.fixture, base = pf.startAddress, ch: Record<number, number> = {};
  const dimmerVal = mapIntensity(intensity, energy);
  if (anim.intensityOffset !== null) { const a = base + anim.intensityOffset; if (!ch[a] || dimmerVal > ch[a]) ch[a] = dimmerVal; }
  if (anim.rgbSegments.length > 0 && paletteColor) {
    const [r, g, b] = hexToRgb(paletteColor);
    for (const seg of anim.rgbSegments) { ch[base + seg.r] = r; ch[base + seg.g] = g; ch[base + seg.b] = b; if (seg.w !== null) ch[base + seg.w] = 0; }
    if (anim.intensityOffset === null) { const ds = dimmerVal / 255; for (const seg of anim.rgbSegments) { ch[base + seg.r] = Math.round((ch[base + seg.r] ?? 0) * ds); ch[base + seg.g] = Math.round((ch[base + seg.g] ?? 0) * ds); ch[base + seg.b] = Math.round((ch[base + seg.b] ?? 0) * ds); } }
  } else if (anim.wheelOffset !== null && paletteColor && anim.wheelCaps.length > 0) {
    const c = anim.wheelCaps[0]; ch[base + anim.wheelOffset] = Math.round((c.min + c.max) / 2);
  }
  if (anim.shutterOffset !== null) {
    const s = base + anim.shutterOffset;
    ch[s] = anim.intensityOffset === null ? Math.max(8, Math.min(255, 8 + Math.round((dimmerVal / 255) * 247))) : 255;
  }
  const fxPhase = ct * Math.PI * 2;
  if (anim.goboOffset !== null) { const a = base + anim.goboOffset; if (anim.goboCaps.length > 0) { const gi = Math.floor((fxPhase * 0.5) % anim.goboCaps.length); ch[a] = Math.round((anim.goboCaps[gi].min + anim.goboCaps[gi].max) / 2); } else ch[a] = Math.round(energy * 255); }
  if (anim.prismOffset !== null) ch[base + anim.prismOffset] = Math.round(Math.max(0, Math.min(255, 64 + Math.sin(fxPhase * 0.7) * 128 * energy)));
  if (anim.zoomOffset !== null) ch[base + anim.zoomOffset] = Math.round(64 + Math.sin(fxPhase * 0.4) * 96 * energy + 64 * energy);
  if (anim.frostOffset !== null) ch[base + anim.frostOffset] = Math.round(Math.max(0, 255 - energy * 255));
  if (anim.irisOffset !== null) ch[base + anim.irisOffset] = Math.round(40 + energy * 200 + Math.sin(fxPhase * 0.5) * 15 * energy);
  if (anim.focusOffset !== null) ch[base + anim.focusOffset] = Math.round(80 + energy * 120 + Math.sin(fxPhase * 0.3) * 30);
  if (anim.beamOffset !== null) ch[base + anim.beamOffset] = Math.max(0, Math.min(255, 60 + Math.round(energy * 30)));
  if (anim.speedOffset !== null) ch[base + anim.speedOffset] = 40 + Math.round(energy * 40);
  return ch; // AUCUN bloc isLaser : mode/pattern/scan/rot/blank/rgbOffsets jamais écrits
}

// ── B. computeDmxForCue — bloc laser L1431-1484 (état actuel, avec laserGateValue) ──
function laserBlockCue(anim: FixtureChannelAnalysis, ch: Record<number, number>, energy: number, paletteColor: string | undefined, cue: { time: number; section: string; strobe?: boolean }, dropBoost: boolean) {
  const pf = anim.fixture;
  const laserT = cue.time;
  const laserPhase = ((pf.startAddress % 16) / 16) * 2 * Math.PI;
  const lissajous = pf.startAddress % 3 === 2;
  const laserRadius = 60 + Math.round(energy * 40);
  const isDrop = cue.section.toLowerCase() === 'drop' || dropBoost;
  const isChorus = cue.section.toLowerCase() === 'chorus';
  if (anim.laserModeOffset !== null) ch[pf.startAddress + anim.laserModeOffset] = capMid(pickLaserModeCap(anim.laserModeCaps));
  if (anim.patternOffset !== null && anim.patternCaps.length > 0) { const idx = Math.floor(laserT / 2) % anim.patternCaps.length; ch[pf.startAddress + anim.patternOffset] = capMid(anim.patternCaps[idx]); }
  if (anim.scanXOffset !== null) ch[pf.startAddress + anim.scanXOffset] = Math.round(128 + laserRadius * Math.sin(2 * Math.PI * laserT + laserPhase));
  if (anim.scanYOffset !== null) { const yv = lissajous ? Math.sin(4 * Math.PI * laserT + laserPhase) : Math.cos(2 * Math.PI * laserT + laserPhase); ch[pf.startAddress + anim.scanYOffset] = Math.round(128 + laserRadius * yv); }
  if (anim.laserColorMode === 'wheel' && anim.wheelOffset !== null && anim.wheelCaps.length > 0 && ch[pf.startAddress + anim.wheelOffset] === undefined) { const idx = Math.floor(laserT / 2) % anim.wheelCaps.length; ch[pf.startAddress + anim.wheelOffset] = capMid(anim.wheelCaps[idx]); }
  // R/G typés Shutter = GATES binaires : laserGateValue (v > 22 → 255, sinon 0)
  if (anim.rgbOffsets && anim.rgbSegments.length === 0 && ch[pf.startAddress + anim.rgbOffsets[0]] === undefined) {
    const [rr0, gg0, bb0] = paletteColor ? hexToRgb(paletteColor) : [Math.round(255 * energy), Math.round(255 * energy), 0];
    const rr = laserGateValue(rr0), gg = laserGateValue(gg0), bb = laserGateValue(bb0);
    if (anim.rgbOffsets[0] !== undefined) ch[pf.startAddress + anim.rgbOffsets[0]] = rr;
    if (anim.rgbOffsets[1] !== undefined) ch[pf.startAddress + anim.rgbOffsets[1]] = gg;
    if (anim.rgbOffsets[2] !== undefined) ch[pf.startAddress + anim.rgbOffsets[2]] = bb;
  }
  if (anim.laserSpeedScanOffset !== null) ch[pf.startAddress + anim.laserSpeedScanOffset] = Math.round(128 + 60 * Math.sin(2 * Math.PI * laserT + laserPhase));
  if (anim.laserSpeedPatternOffset !== null) ch[pf.startAddress + anim.laserSpeedPatternOffset] = Math.round(128 + 64 * Math.sin(2 * Math.PI * laserT / 4));
  anim.laserRotationOffsets.forEach((off, i) => { ch[pf.startAddress + off] = Math.round(128 + 65 * Math.sin(2 * Math.PI * laserT / (4 * (i + 1)) + laserPhase)); });
  if (anim.blankOffset !== null) ch[pf.startAddress + anim.blankOffset] = (isDrop || isChorus) && cue.strobe ? 255 : 0;
}

// ── C. computeDmxCues — couleur L710-727 + bloc 7b L931-977 + filet 128 L990-1003 ──
function dmxCuesCompute(anim: FixtureChannelAnalysis, energy: number, paletteColor: string | undefined, beat: number, isDrop: boolean, strobe: boolean): Record<number, number> {
  const pf = anim.fixture, base = pf.startAddress, ch: Record<number, number> = {};
  // 1) intensité (floor 128 « SoundSwitch »)
  if (anim.intensityOffset !== null) ch[base + anim.intensityOffset] = 128 + Math.round(energy * 127);
  // 2) couleur (section 2) : gate pour lasers rgb 2 canaux
  if (anim.rgbOffsets && paletteColor) {
    let [r, g, b] = hexToRgb(paletteColor);
    const laserGate = anim.isLaser && anim.laserColorMode === 'rgb' && anim.rgbSegments.length === 0;
    if (laserGate) { r = laserGateValue(r); g = laserGateValue(g); b = laserGateValue(b); }
    else if (anim.intensityOffset === null) { const scale = (128 + Math.round(energy * 127)) / 255; r = Math.round(r * scale); g = Math.round(g * scale); b = Math.round(b * scale); }
    if (anim.rgbOffsets[0] !== undefined) ch[base + anim.rgbOffsets[0]] = r;
    if (anim.rgbOffsets[1] !== undefined) ch[base + anim.rgbOffsets[1]] = g;
    if (anim.rgbOffsets[2] !== undefined) ch[base + anim.rgbOffsets[2]] = b;
  } else if (anim.wheelOffset !== null && paletteColor && anim.wheelCaps.length > 0) {
    ch[base + anim.wheelOffset] = capMid(anim.wheelCaps[0]);
  }
  // 3) shutter
  if (anim.shutterOffset !== null) ch[base + anim.shutterOffset] = strobe && isDrop ? 100 : anim.intensityOffset === null ? 128 + Math.round(energy * 127) : 255;
  // 4) bloc 7b laser
  const laserPhase = ((pf.startAddress % 16) / 16) * 2 * Math.PI;
  const lissajous = pf.startAddress % 3 === 2;
  if (anim.laserModeOffset !== null) ch[base + anim.laserModeOffset] = capMid(pickLaserModeCap(anim.laserModeCaps));
  if (anim.patternOffset !== null && anim.patternCaps.length > 0) { const idx = Math.floor(beat / 8) % anim.patternCaps.length; ch[base + anim.patternOffset] = capMid(anim.patternCaps[idx]); }
  if (anim.scanXOffset !== null) ch[base + anim.scanXOffset] = 128 + Math.round(90 * Math.sin(2 * Math.PI * beat / 4 + laserPhase));
  if (anim.scanYOffset !== null) { const yv = lissajous ? Math.sin(4 * Math.PI * beat / 4 + laserPhase) : Math.cos(2 * Math.PI * beat / 4 + laserPhase); ch[base + anim.scanYOffset] = 128 + Math.round(90 * yv); }
  if (anim.laserColorMode === 'wheel' && anim.wheelOffset !== null && anim.wheelCaps.length > 0 && ch[base + anim.wheelOffset] === undefined) { const idx = Math.floor(beat / 8) % anim.wheelCaps.length; ch[base + anim.wheelOffset] = capMid(anim.wheelCaps[idx]); }
  if (anim.laserSpeedScanOffset !== null) ch[base + anim.laserSpeedScanOffset] = 128 + Math.round(60 * Math.sin(2 * Math.PI * beat / 4 + laserPhase));
  if (anim.laserSpeedPatternOffset !== null) ch[base + anim.laserSpeedPatternOffset] = 128 + Math.round(64 * Math.sin(2 * Math.PI * beat / 16));
  anim.laserRotationOffsets.forEach((off, i) => { ch[base + off] = 128 + Math.round(70 * Math.sin(2 * Math.PI * beat / (16 * (i + 1)) + laserPhase)); });
  if (anim.blankOffset !== null) ch[base + anim.blankOffset] = isDrop && strobe ? 255 : 0;
  // 5) filet de sécurité : tout canal non reconnu → 128
  for (let c = 0; c < anim.channelCount; c++) { const a = base + c; if (ch[a] === undefined) ch[a] = 128; }
  return ch;
}

// ── D. Autoloop/SoundSwitch : moteur réel ──
function autoloopReport(fixtures: PatchedFixture[], defs: Map<string, DmxFixtureDefinition>, universes: { id: string }[], L: (s: string) => void) {
  const autoloopFixtures = toAutoloopFixtures(fixtures, defs, universes);
  L(`Fixtures Autoloop :`);
  for (const f of autoloopFixtures) L(`  ${f.id} cat=${f.category} laser=${f.isLaser} map={${Object.entries(f.channelMap).map(([k, v]) => `${k}@${v}`).join(',')}}`);
  const banks = buildSoundswitchBanks(autoloopFixtures);
  const engine = new AutoloopPlaybackEngine({ send: () => {} } as DmxOutput, 120);
  for (let bank = 0; bank < 4; bank++) {
    const loop = banks.select(bank, 0);
    if (!loop) continue;
    const frames: Array<Record<number, number>> = [];
    engine.output = { send(ch: Record<number, number>) { frames.push({ ...ch }); } };
    engine.load(loop); engine.trigger();
    for (let bar = 0; bar < 16; bar++) for (let beat = 0; beat < 4; beat++) engine.onBarBeat(bar, beat);
    const agg = new Map<number, Set<number>>();
    for (const f of frames) for (const [k, v] of Object.entries(f)) { const a = Number(k); if (!agg.has(a)) agg.set(a, new Set()); agg.get(a)!.add(v); }
    L(`\nBanque ${bank} («${(loop as any).id}», ${loop.keys.length} keys, ${loop.bars} bars) — valeurs par adresse sur 64 beats :`);
    for (const [a, setV] of [...agg.entries()].sort((x, y) => x[0] - y[0])) {
      const vals = [...setV].sort((x, y) => x - y);
      const min = Math.min(...vals), max = Math.max(...vals);
      L(`  adr ${String(a).padStart(3)} : ${min === max ? `FIXE ${min}` : `min ${min} … max ${max}`}${vals.length <= 8 ? `  (${vals.join(', ')})` : `  (${vals.length} valeurs)`}`);
    }
  }
}

describe('audit valeurs laser — état actuel du code', () => {
  it('calcule et imprime le rapport', () => {
    const fixtures = [mkPf(GAL.def, 1), mkPf(IOD.def, 17), mkPf(BMB.def, 33)];
    const defs = new Map([[GAL.def.id, GAL.def], [IOD.def.id, IOD.def], [BMB.def.id, BMB.def]]);
    const anims = fixtures.map(f => analyzeFixtureChannels(f, defs.get(f.fixtureDefId)));
    const energies = [0.08, 0.1, 0.25, 0.5, 0.8, 0.95];
    const lines: string[] = [];
    const L = (s: string) => { lines.push(s); console.log(s); };

    L('═══════════════════════════════════════════════════════════');
    L('AUDIT VALEURS LASER — état actuel du code (fichiers 17:57)');
    L('═══════════════════════════════════════════════════════════');
    for (const a of anims) {
      const def = defs.get(a.fixture.fixtureDefId)!;
      L(`\n◆ ${a.fixture.name} — mode «${def.modes[0].name}» ${a.channelCount}ch, addr ${a.fixture.startAddress} | isLaser=${a.isLaser} colorMode=${a.laserColorMode}`);
      L(`  rgbOffsets=${JSON.stringify(a.rgbOffsets)} rgbSegments=${a.rgbSegments.length} wheel=${a.wheelOffset}(${a.wheelCaps.length}) intensity=${a.intensityOffset} shutter=${a.shutterOffset}`);
      L(`  laser: mode=${a.laserModeOffset}(${a.laserModeCaps.length}) pattern=${a.patternOffset}(${a.patternCaps.length}) scan=${a.scanXOffset}/${a.scanYOffset} rot=[${a.laserRotationOffsets}] blank=${a.blankOffset} sScan=${a.laserSpeedScanOffset} sPat=${a.laserSpeedPatternOffset} | génériques: zoom=${a.zoomOffset} beam=${a.beamOffset} speed=${a.speedOffset} effect=${a.effectOffset}`);
    }

    L('\n═══════════════════════════════════════════════════════════');
    L('CHEMIN A — tick live useDmxPlayback (L741-1170) : AUCUN bloc laser');
    L('═══════════════════════════════════════════════════════════');
    for (const a of anims) {
      const ch = tickLive(a, 0.5, 'medium', '#ff0000', 2);
      const base = a.fixture.startAddress;
      const written = [...new Set(Object.keys(ch).map(Number).map(k => k - base))].sort((x, y) => x - y);
      const laserChannels = [...new Set([...(a.rgbOffsets ?? []), a.laserModeOffset, a.patternOffset, a.scanXOffset, a.scanYOffset, ...a.laserRotationOffsets, a.blankOffset, a.laserSpeedScanOffset, a.laserSpeedPatternOffset].filter(v => v !== null && v !== undefined) as number[])].sort((x, y) => x - y);
      L(`\n${a.fixture.name} : canaux écrits par le tick = [${written.length ? written.join(',') : 'aucun'}]`);
      L(`  canaux LASER jamais écrits (mode/pattern/scan/rot/blank/speed) = [${laserChannels.join(',')}]`);
      L(`  ⇒ ces adresses sont ABSENTES du write replace-all → bridge garde la valeur précédente (0 initial)`);
      const chans = defs.get(a.fixture.fixtureDefId)!.modes[0].channels;
      for (const lc of laserChannels) if (lc !== undefined) L(`    • ch${lc + 1} «${chans[lc]?.name}» → reste à 0 ${chans[lc]?.capabilities?.length ? `→ ${zoneLabel(chans[lc].capabilities, 0)}` : ''}`);
    }

    L('\n═══════════════════════════════════════════════════════════');
    L('CHEMIN B — computeDmxForCue (bloc laser L1431-1484, laserGateValue)');
    L('═══════════════════════════════════════════════════════════');
    const aG = anims[0], aI = anims[1], aB = anims[2];
    const chG = defs.get(GAL.def.id)!.modes[0].channels;
    L(`\n◆ GALAXIAN 3D — caps canal R/G@0/1 (ShutterStrobe) :`);
    for (const c of chG[0].capabilities!) L(`   ${c.min}-${c.max} → «${c.name}»`);
    L(`  laserGateValue(v) = v > 22 ? 255 : 0 — seuil = energy > ${(22 / 255).toFixed(4)}`);
    for (const e of energies) {
      const ch: Record<number, number> = {};
      laserBlockCue(aG, ch, e, undefined, { time: 2, section: 'verse' }, false);
      const base = aG.fixture.startAddress;
      const r = ch[base + aG.rgbOffsets![0]], g = ch[base + aG.rgbOffsets![1]];
      L(`  energy=${e} sans palette : round(255×${e})=${Math.round(255 * e)} → R=${r} G=${g} → ${zoneLabel(chG[0].capabilities, r)} | ${zoneLabel(chG[1].capabilities, g)}`);
    }
    for (const pal of ['#ff0000', '#0000ff', '#ffff00', '#ffffff']) {
      const ch: Record<number, number> = {};
      laserBlockCue(aG, ch, 0.5, pal, { time: 2, section: 'verse' }, false);
      const base = aG.fixture.startAddress;
      L(`  energy=0.5 palette ${pal} : R=${ch[base + aG.rgbOffsets![0]]} G=${ch[base + aG.rgbOffsets![1]]} (rota=${ch[base + 2]},${ch[base + 3]})`);
    }

    L(`\n◆ IODA 400 RGY — mode «${IOD.def.modes[0].name}» : Program@0 (${aI.laserModeCaps.length} caps) → pickLaserModeCap = [${pickLaserModeCap(aI.laserModeCaps).min}-${pickLaserModeCap(aI.laserModeCaps).max}] «${pickLaserModeCap(aI.laserModeCaps).name}» → valeur ${capMid(pickLaserModeCap(aI.laserModeCaps))}`);
    const chI = IOD.def.modes[0].channels;
    L(`  «Zoom»@8 caps : ${chI[8].capabilities!.map(c => `[${c.min}-${c.max}]${c.name}`).join(' | ')}`);
    L(`  «Drawing»@9 caps : ${chI[9].capabilities!.map(c => `[${c.min}-${c.max}]${c.name}`).join(' | ')}`);
    L(`  «Scanning Speed»@10 caps : ${chI[10].capabilities!.map(c => `[${c.min}-${c.max}]${c.name}`).join(' | ')}`);
    for (const e of energies) {
      const chB: Record<number, number> = {};
      laserBlockCue(aI, chB, e, '#0000ff', { time: 2, section: 'verse' }, false);
      const chC = dmxCuesCompute(aI, e, undefined, 8, false, false);
      const b = aI.fixture.startAddress;
      L(`\n  energy=${e} : B(mode@0)=${chB[b]} (${zoneLabel(aI.laserModeCaps, chB[b])}) pattern@2=${chB[b + 2]} scan@6/7=${chB[b + 6]}/${chB[b + 7]} vacant wheel@1=${chB[b] === undefined ? '' : ''}${chB[b + 1] ?? '∅(palette)'} sScan@10=${chB[b + 10]} (${zoneLabel(chI[10].capabilities, chB[b + 10])})`);
      L(`     C(filet): zoom@8=${chC[b + 8]} (${zoneLabel(chI[8].capabilities, chC[b + 8])}) drawing@9=${chC[b + 9]} (${zoneLabel(chI[9].capabilities, chC[b + 9])}) speedScan@10=${chC[b + 10]} (${zoneLabel(chI[10].capabilities, chC[b + 10])})`);
    }

    L(`\n◆ BOOM BOX FX2 — mode «${BMB.def.modes[0].name}» : ShowMode@16 (${aB.laserModeCaps.length} caps) → pickLaserModeCap = [${pickLaserModeCap(aB.laserModeCaps).min}-${pickLaserModeCap(aB.laserModeCaps).max}] «${pickLaserModeCap(aB.laserModeCaps).name}» → mode@16=${capMid(pickLaserModeCap(aB.laserModeCaps))}`);
    const chB2 = BMB.def.modes[0].channels;
    L(`  «Show mode»@16 caps : ${chB2[16].capabilities!.map(c => `[${c.min}-${c.max}]«${c.name}»`).join(' ')}`);
    L(`  «Red/Green Laser»@1/2 caps : [0-127]«Closed» [128-255]«Open» | «BeamStrobe»@8 caps : ${chB2[8].capabilities!.slice(0, 3).map(c => `[${c.min}-${c.max}]«${c.name}»`).join(' ')}`);
    for (const e of energies) {
      const ch: Record<number, number> = {};
      laserBlockCue(aB, ch, e, undefined, { time: 2, section: 'verse' }, false);
      const b = aB.fixture.startAddress;
      L(`  energy=${e} : mode@16=${ch[b + 16]} (${zoneLabel(chB2[16].capabilities, ch[b + 16])}) → ${ch[b + 16] >= 70 ? 'SHOW AUTONOME → canaux R/G DMX IGNOTÉS' : 'aiguille sûre'} | R@1=${ch[b + 1]} (${zoneLabel(chB2[1].capabilities, ch[b + 1])}) G@2=${ch[b + 2]} (${zoneLabel(chB2[2].capabilities, ch[b + 2])})`);
    }

    L('\n═══════════════════════════════════════════════════════════');
    L('CHEMIN C — computeDmxCues (couleur gate + 7b + filet 128)');
    L('═══════════════════════════════════════════════════════════');
    for (const e of [0.1, 0.5, 0.8]) {
      const cG = dmxCuesCompute(aG, e, undefined, 0, true, true);
      const cI = dmxCuesCompute(aI, e, undefined, 0, true, true);
      const cB = dmxCuesCompute(aB, e, undefined, 0, true, true);
      const bG = aG.fixture.startAddress, bI = aI.fixture.startAddress, bB = aB.fixture.startAddress;
      L(`\n  energy=${e} sans palette (strobe drop) :`);
      L(`    Galaxian : R@0=${cG[bG]} (${zoneLabel(chG[0].capabilities, cG[bG])}) G@1=${cG[bG + 1]} — Macros@4=${cG[bG + 4]} (${zoneLabel(chG[4].capabilities, cG[bG + 4])}) ⚠ macro autonome`);
      L(`    IODA : mode@0=${cI[bI]} pattern@2=${cI[bI + 2]} wheel@1=${cI[bI + 1]} rot@3..5=${cI[bI + 3]},${cI[bI + 4]},${cI[bI + 5]} zoom@8=${cI[bI + 8]} drawing@9=${cI[bI + 9]} sScan@10=${cI[bI + 10]}`);
      L(`    BoomBox : mode@16=${cB[bB + 16]} (${zoneLabel(chB2[16].capabilities, cB[bB + 16])}) R@1=${cB[bB + 1]} (${zoneLabel(chB2[1].capabilities, cB[bB + 1])}) G@2=${cB[bB + 2]} strobe@8=${cB[bB + 8]} dim@9=${cB[bB + 9]}`);
    }

    L('\n═══════════════════════════════════════════════════════════');
    L('CHEMIN D — Autoloop SoundSwitch (moteur réel, 4 banques)');
    L('═══════════════════════════════════════════════════════════');
    autoloopReport(fixtures, defs, [{ id: 'u1' }], L);

    L('\n═══════════════════════════════════════════════════════════');
    L('VERDICTS');
    L('═══════════════════════════════════════════════════════════');
    L('G1 [BLOQUANT] chemin A : lasers jamais écrits pendant la lecture → éteints 100 % du temps.');
    L('G2 [CRITIQUE] Galaxian chemin B : sans palette → 255/255 dès energy≥0.0863 (jamais <32 car gate'); 
    L('   binaire laserGateValue), MAIS palette sans rouge+vert (bleue/violette/cyan) → 0/0 ≤22 → éteint.');
    L('   Avec palette R/V → état binaire identique à chaque frame → «apparition rare toujours la même».');
    L('G3 [CRITIQUE] Galaxian chemin C sans palette : filet 128 → R=G=128 = STROBE OFL 16-239 (pas fermé,'); 
    L('   pas ouvert stable) + Macros=128 = Macro 8 (120-135) → autonome «toujours le même».');
    L('G4 [CRITIQUE] BoomBox : mode@16 = 175 (Show 8) chemin B/C et 255 (Show 0) chemin D → SHOW');
    L('   AUTONOME : les R/G DMX sont ignorés → «apparition toujours la même» quand le laser s’allume.');
    L('G5 [MOYEN] IODA chemin B : mode=233 (DMX mode) ✓ chaque frame, pattern cycle ✓, scan cercle ✓ ;');
    L('   mais speedScan@10 = 128±60 → dépassement 128 → «with gaps» (trous) une partie du temps ;');
    L('   zoom@8 jamais écrit par B (∅ → garde 0 = manuel wide, inoffensif) ; filet C = 128 = auto zoom.');

    expect(aG.isLaser).toBe(true);
    expect(aI.isLaser).toBe(true);
    expect(aB.isLaser).toBe(true);
    expect(laserGateValue(26)).toBe(255);
    expect(laserGateValue(22)).toBe(0);
  }, 60000);
});