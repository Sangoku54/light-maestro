/**
 * SONDE — Positions REELLES + faisceaux REELS du projet LM/Yolo.lmproj.
 *
 * Le projet est au format enveloppe binaire (LMZPROJ1) : il est decompresse
 * par le VRAI `unpackProject` (electron/project-envelope), puis on analyse
 * chaque fixture avec le VRAI `analyzeChannels` (moteur de production).
 *
 * Pour chaque fixture motorisee (pan/tilt), la sonde compare TROIS vues :
 *
 *  (A) VUE 3D  — ce que Stage3D dessine :
 *      heading = headingRadForPos(...)                    [utils/fixture-pose.ts]
 *      pan     = clampPanZone(heading + rawPan, heading)  [Stage3D.tsx]
 *      tilt    = clampTiltZone(rawElev, mountMode)         [Stage3D.tsx]
 *      rawPan  = mecanique + zeroPan  ;  rawElev = mecanique + staticTilt + zeroTilt
 *
 *  (B) DMX REEL — ce que le moteur ecrit sur le cable :
 *      clampPanZoneDmx / clampTiltZoneDmx                  [engine/dmx-movement.ts]
 *      (meme zone, memes bornes, meme formule que le 3D)
 *
 *  (C) PHYSIQUE — ce que le materiel fait reellement des bytes :
 *      mecanique pure + tare STATIQUE (pos.tilt, physique) + tare ZERO
 *      (zeroPan/zeroTilt, physique : c'est l'offset du zero mécanique du
 *      moteur par rapport a l'hypothese de montage de l'app — preuve : la
 *      formule de clampPanZoneDmx deduit ses bornes de ce meme offset).
 *      Sans clamp logiciel : le materiel ne connait pas nos zones.
 *
 * INVARIANT VERIFIE : (A) et (C) doivent designer le MEME faisceau.
 * Toute divergence est un bug « la 3D ne montre pas le reel ».
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { unpackProject } from '../../electron/project-envelope';
import { FixtureLibrary } from '@electron/fixtures/library';
import { analyzeChannels } from '../engine/fixture-analyzer';
import { computeDmxForCue } from '../hooks/dmx-playback';
import { poseFromPos, type PosePos, type FixtureAimPose, type Vec3 } from '../utils/fixture-pose';
import { clampPanZoneDmx, clampTiltZoneDmx } from '../engine/dmx-movement';
import { clampPanZone, clampTiltZone } from '../views/Stage3D';

const PROJECT = path.join(process.cwd(), 'LM', 'Yolo.lmproj');
const PRESET = path.join(process.cwd(), 'LM', 'Yolo.lmpreset');
const UKING_QXF = path.join(process.cwd(), 'resources', 'fixtures', 'UKing-Wall-Washer-24x3W.qxf');

function pad(s: string, n: number): string {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function describeDir(d: Vec3): string {
  const parts: string[] = [];
  if (d.y < -0.15) parts.push('bas');
  else if (d.y > 0.15) parts.push('haut');
  else parts.push('horizontal');
  if (d.x > 0.15) parts.push('droite');
  else if (d.x < -0.15) parts.push('gauche');
  if (d.z > 0.15) parts.push('arriere');
  else if (d.z < -0.15) parts.push('public');
  return parts.join('/');
}

/** Angle (rad) entre deux vecteurs. */
function angleBetween(a: Vec3, b: Vec3): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  const na = Math.hypot(a.x, a.y, a.z);
  const nb = Math.hypot(b.x, b.y, b.z);
  return Math.acos(Math.max(-1, Math.min(1, dot / (na * nb))));
}

/**
 * (A) Direction telle que Stage3D la dessine.
 * Reproduit a l'identique la boucle de rendu de Stage3D.tsx (~lignes 3166-3200).
 */
function dir3D(panVal: number, tiltVal: number, pose: FixtureAimPose, mode: string): Vec3 {
  const rawPan = ((panVal / 255) - 0.5) * pose.panSpanRad + pose.zeroPanRad;
  const panAbs = pose.headingRad + rawPan;
  const panTarget = clampPanZone(panAbs, pose.headingRad);
  const dmxTilt = ((tiltVal / 255) - 0.5) * pose.tiltSpanRad;
  const rawElev = dmxTilt + pose.staticTilt + pose.zeroTiltRad;
  const elev = clampTiltZone(rawElev, mode);
  const alpha = pose.mountTilt + elev;
  return {
    x: -Math.sin(alpha) * Math.sin(panTarget),
    y: -Math.cos(alpha),
    z: -Math.sin(alpha) * Math.cos(panTarget),
  };
}

/**
 * (C) Direction PHYSIQUE du materiel : mecanique pure + tares physiques
 * (statique + zero), SANS clamp logiciel (le materiel ne connait pas
 * nos zones de balayage).
 */
function dirPhys(panVal: number, tiltVal: number, pose: FixtureAimPose): Vec3 {
  const rawPan = ((panVal / 255) - 0.5) * pose.panSpanRad + pose.zeroPanRad;
  const phi = pose.headingRad + rawPan;
  const dmxTilt = ((tiltVal / 255) - 0.5) * pose.tiltSpanRad;
  const alpha = pose.mountTilt + dmxTilt + pose.staticTilt + pose.zeroTiltRad;
  return {
    x: -Math.sin(alpha) * Math.sin(phi),
    y: -Math.cos(alpha),
    z: -Math.sin(alpha) * Math.cos(phi),
  };
}

describe.skipIf(!fs.existsSync(PROJECT))('Yolo.lmproj — positions reelles et DMX reels', () => {
  let patched: any[] = [];
  let positions: Record<string, any> = {};
  let customDefs = new Map<string, any>();
  let lib: FixtureLibrary;
  let dims = { width: 10, depth: 8 };
  let presetSections: any[] = [];

  beforeAll(async () => {
    const packed = await unpackProject(PROJECT);
    const proj = JSON.parse(packed.content);
    patched = proj.showStore.patchedFixtures || [];
    positions = proj.showStore.fixturePositions || {};
    if (proj.showStore.stageDims) dims = proj.showStore.stageDims;
    customDefs = new Map((proj.customFixtures || []).map((d: any) => [d.id, d]));

    lib = new FixtureLibrary();
    if (fs.existsSync(UKING_QXF)) {
      const xml = fs.readFileSync(UKING_QXF, 'utf8');
      const def = await lib.parseQLC(xml, UKING_QXF);
      if (def) lib.add(def);
    }
    if (fs.existsSync(PRESET)) {
      const p = JSON.parse(fs.readFileSync(PRESET, 'utf8'));
      presetSections = p.sections || [];
    }
  }, 30000);

  it('tableau position par position + DMX pan/tilt reellement ecrits', async () => {
    const defs = new Map<any, any>();
    for (const pf of patched) {
      const def = pf.fixtureDefId.startsWith('custom-')
        ? customDefs.get(pf.fixtureDefId)
        : lib.get(pf.fixtureDefId);
      if (def) defs.set(pf.fixtureDefId, def);
    }

    console.log(`\n[YOLO-POSE] ${patched.length} fixtures patchees, scene ${dims.width}x${dims.depth} m, ${presetSections.length} sections de preset`);
    console.log('\n=== YOLO — POSITION / MONTAGE / DIRECTION PAR DEFAUT (vue 3D) ===');
    console.log(
      `${pad('fixture', 30)} ${pad('addr', 9)} ${pad('X/Z/h (m)', 18)} ${pad('mount', 8)} `
      + `${pad('heading', 9)} ${pad('3D defaut', 18)} ${pad('materiel defaut', 18)} ${pad('bornes DMX pan/tilt', 22)}`,
    );

    const motorisees: any[] = [];

    for (const pf of patched) {
      const def = defs.get(pf.fixtureDefId);
      const fa = def ? analyzeChannels(pf, def) : null;
      const pos = positions[pf.id] || { x: 0.5, y: 0.5, h: 3, mountMode: 'hanging' };
      const mode = pos.mountMode ?? 'hanging';
      const mx = ((pos.x - 0.5) * dims.width).toFixed(2);
      const mz = ((pos.y - 0.5) * dims.depth).toFixed(2);
      const mh = (pos.h ?? 0).toFixed(2);
      const addr = `${pf.startAddress}-${pf.startAddress + pf.channelCount - 1}`;
      const captured = (pos.centerPan ?? 0) !== 0 || (pos.centerTilt ?? 0) !== 0;

      const hasPanTilt = !!fa && (fa.panOffsets.length > 0 || fa.tiltOffsets.length > 0);
      if (!hasPanTilt) {
        console.log(
          `${pad(pf.name, 30)} ${pad(addr, 9)} ${pad(`${mx}/${mz}/${mh}`, 18)} ${pad(mode, 8)} `
          + `${pad('—', 9)} ${pad('statique', 18)} ${pad('statique', 18)} ${pad('(pas de pan/tilt)', 22)}`,
        );
        continue;
      }

      const panMax = fa.panMaxDeg ?? 540;
      const tiltMax = fa.tiltMaxDeg ?? 180;
      const pose = poseFromPos(pos as PosePos, mode, dims, true, { panMaxDeg: panMax, tiltMaxDeg: tiltMax });

      // Valeurs moteur AU REPOS : centre capture (ou neutre) + zone moteur.
      const zeroPd = Math.round(((pos.centerPan ?? 0) / 540) * 255);
      const zeroTd = Math.round(((pos.centerTilt ?? 0) / 180) * 255);
      const panLo = clampPanZoneDmx(0, panMax, pos.zeroPan);
      const panHi = clampPanZoneDmx(255, panMax, pos.zeroPan);
      const tiltLo = clampTiltZoneDmx(0, tiltMax, mode, pos.tilt, pos.zeroTilt);
      const tiltHi = clampTiltZoneDmx(255, tiltMax, mode, pos.tilt, pos.zeroTilt);
      const restPan = Math.round(Math.max(panLo, Math.min(panHi, 128 + zeroPd)));
      const restTilt = Math.round(Math.max(tiltLo, Math.min(tiltHi, 128 + zeroTd)));

      const d3dIdle = dir3D(restPan, restTilt, pose, mode);
      const dPhysIdle = dirPhys(restPan, restTilt, pose);
      const deltaIdle = (angleBetween(d3dIdle, dPhysIdle) * 180) / Math.PI;

      const headingDeg = ((pose.headingRad * 180) / Math.PI).toFixed(1);
      const panAddr = fa.panOffsets.map((o: number) => pf.startAddress + o).join(',');
      const tiltAddr = fa.tiltOffsets.map((o: number) => pf.startAddress + o).join(',');

      console.log(
        `${pad(pf.name, 30)} ${pad(addr, 9)} ${pad(`${mx}/${mz}/${mh}`, 18)} ${pad(mode, 8)} `
        + `${pad(`${headingDeg}°`, 9)} ${pad(describeDir(d3dIdle), 18)} ${pad(describeDir(dPhysIdle), 18)} `
        + `${pad(`pan@${panAddr}[${panLo.toFixed(0)}-${panHi.toFixed(0)}]`, 22)} `
        + `tilt@${tiltAddr}[${tiltLo.toFixed(0)}-${tiltHi.toFixed(0)}]`
        + (captured ? '  [centre capture]' : ''),
      );

      // INVARIANT : au repos, la 3D et le materiel designent le meme faisceau.
      expect(deltaIdle, `${pf.name} : la vue 3D et le materiel divergent au repos (${deltaIdle.toFixed(2)}°)`).toBeLessThan(0.5);

      motorisees.push({ pf, fa, pos, mode, pose, d3dIdle, dPhysIdle, restPan, restTilt, panMax, tiltMax, captured });
    }

    // ── DMX reel ecrit par le moteur sur un VRAI cue du preset ──
    const chorus = presetSections.find((s) => s.type === 'chorus') || presetSections[0];
    const intro = presetSections.find((s) => s.type === 'intro') || presetSections[0];
    const uni = [{ id: 'universe-1' }];
    const tiers = { primary: 100, secondary: 70, tertiary: 40, other: 40 } as any;

    const realPositions: Record<string, any> = {};
    for (const pf of patched) {
      const p = positions[pf.id];
      if (p) realPositions[pf.id] = p;
    }

    const mkCue = (sec: any, extra: any = {}) => ({
      time: (sec?.startTime ?? 0) + 2,
      section: sec?.type ?? 'chorus',
      intensity: 'high',
      color: '#ff3333',
      movement: 'sweep',
      energy: sec?.energy ?? 0.8,
      ...extra,
    } as any);

    const dmxMoving = computeDmxForCue(
      mkCue(chorus), patched, defs, uni, tiers,
      undefined, undefined, undefined, undefined, undefined, realPositions,
    );
    const dmxStatic = computeDmxForCue(
      mkCue(intro, { movement: 'static', movementAmplitude: 0 }),
      patched, defs, uni, tiers,
      undefined, undefined, undefined, undefined, undefined, realPositions,
    );
    const writtenMoving = dmxMoving[0]?.channelValues ?? {};
    const writtenStatic = dmxStatic[0]?.channelValues ?? {};

    console.log(`\n=== YOLO — DMX REEL ECRIT (cue "${chorus?.type}" en mouvement) ===`);
    console.log(`${pad('fixture', 30)} ${pad('pan', 20)} ${pad('tilt', 30)} ${pad('3D montre', 20)} ${pad('materiel', 20)} ecart`);

    let maxDelta = 0;
    for (const m of motorisees) {
      const { pf, fa } = m;
      const panAddrs = fa.panOffsets.map((o: number) => pf.startAddress + o);
      const tiltAddrs = fa.tiltOffsets.map((o: number) => pf.startAddress + o);
      const panVals = panAddrs.map((a) => writtenMoving[a] ?? 128);
      const tiltVals = tiltAddrs.map((a) => writtenMoving[a] ?? 128);

      for (const v of panVals) {
        expect(v, `pan manquant pour ${pf.name}`).toBeGreaterThanOrEqual(0);
        expect(v, `pan hors plage pour ${pf.name}`).toBeLessThanOrEqual(255);
        expect(Number.isInteger(v), `pan non entier pour ${pf.name} : ${v}`).toBe(true);
      }
      for (const v of tiltVals) {
        expect(v, `tilt manquant pour ${pf.name}`).toBeGreaterThanOrEqual(0);
        expect(v, `tilt hors plage pour ${pf.name}`).toBeLessThanOrEqual(255);
        expect(Number.isInteger(v), `tilt non entier pour ${pf.name} : ${v}`).toBe(true);
      }

      // Borne moteur : la valeur ecrite doit etre DANS la zone.
      const panLo = clampPanZoneDmx(0, m.panMax, m.pos.zeroPan);
      const panHi = clampPanZoneDmx(255, m.panMax, m.pos.zeroPan);
      const tiltLo = clampTiltZoneDmx(0, m.tiltMax, m.mode, m.pos.tilt, m.pos.zeroTilt);
      const tiltHi = clampTiltZoneDmx(255, m.tiltMax, m.mode, m.pos.tilt, m.pos.zeroTilt);
      for (const v of panVals) {
        expect(v, `${pf.name} : pan ${v} hors zone [${panLo},${panHi}]`).toBeGreaterThanOrEqual(panLo - 0.001);
        expect(v, `${pf.name} : pan ${v} hors zone [${panLo},${panHi}]`).toBeLessThanOrEqual(panHi + 0.001);
      }
      for (const v of tiltVals) {
        expect(v, `${pf.name} : tilt ${v} hors zone [${tiltLo},${tiltHi}]`).toBeGreaterThanOrEqual(tiltLo - 0.001);
        expect(v, `${pf.name} : tilt ${v} hors zone [${tiltLo},${tiltHi}]`).toBeLessThanOrEqual(tiltHi + 0.001);
      }

      const d3d = dir3D(panVals[0], tiltVals[0], m.pose, m.mode);
      const dPh = dirPhys(panVals[0], tiltVals[0], m.pose);
      const delta = (angleBetween(d3d, dPh) * 180) / Math.PI;
      maxDelta = Math.max(maxDelta, delta);

      console.log(
        `${pad(pf.name, 30)} ${pad(`[${panAddrs.join(',')}]=${panVals.join(',')}`, 20)} `
        + `${pad(`[${tiltAddrs.join(',')}]=${tiltVals.join(',')}`, 30)} `
        + `${pad(describeDir(d3d), 20)} ${pad(describeDir(dPh), 20)} ${delta.toFixed(2)}°`,
      );

      // INVARIANT : en mouvement aussi, 3D == materiel.
      expect(delta, `${pf.name} : la vue 3D et le materiel divergent (${delta.toFixed(2)}°)`).toBeLessThan(0.5);
    }

    // ── Au repos (cue statique) : ce que le moteur ecrit vraiment ──
    console.log(`\n=== YOLO — DMX REEL AU REPOS (cue "${intro?.type}", mouvement=static) ===`);
    console.log(`${pad('fixture', 30)} ${pad('pan', 20)} ${pad('tilt', 30)} ${pad('materiel', 20)} ecart 3D/reel`);

    for (const m of motorisees) {
      const { pf, fa } = m;
      const panAddrs = fa.panOffsets.map((o: number) => pf.startAddress + o);
      const tiltAddrs = fa.tiltOffsets.map((o: number) => pf.startAddress + o);
      const panVals = panAddrs.map((a) => writtenStatic[a] ?? 128);
      const tiltVals = tiltAddrs.map((a) => writtenStatic[a] ?? 128);
      const d3d = dir3D(panVals[0], tiltVals[0], m.pose, m.mode);
      const dPh = dirPhys(panVals[0], tiltVals[0], m.pose);
      const delta = (angleBetween(d3d, dPh) * 180) / Math.PI;
      maxDelta = Math.max(maxDelta, delta);

      console.log(
        `${pad(pf.name, 30)} ${pad(`[${panAddrs.join(',')}]=${panVals.join(',')}`, 20)} `
        + `${pad(`[${tiltAddrs.join(',')}]=${tiltVals.join(',')}`, 30)} `
        + `${pad(describeDir(dPh), 20)} ${delta.toFixed(2)}°`,
      );

      expect(delta, `${pf.name} : la vue 3D et le materiel divergent au repos du preset (${delta.toFixed(2)}°)`).toBeLessThan(0.5);
    }

    expect(motorisees.length).toBeGreaterThan(0);
    console.log(`\n[YOLO-POSE] ${motorisees.length} fixture(s) motorisee(s) — ecart max 3D/materiel = ${maxDelta.toFixed(2)}°`);
  }, 30000);
});
