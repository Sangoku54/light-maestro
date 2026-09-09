/**
 * Probe d'exploitation : analyse RÉELLE des 13 fixtures patchées du projet
 * « LM/Yolo.lmproj ». Résout chaque def (custom depuis customFixtures du
 * projet, UKing via le QXF embarqué) puis exécute le vrai moteur
 * (analyzeChannels + computeDmxForCue) comme en session live.
 *
 * But : montrer, fixture par fixture, quels canaux DMX le moteur dérive
 * (intensity / pan / tilt / RGB / shutter / strobe / macro) et sur quelles
 * adresses réelles du universe-1 — pour valider l'exploitation des fixtures
 * patchées et repérer d'éventuelles fixtures « muettes ».
 */
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { unpackProject } from '../../electron/project-envelope';
import { FixtureLibrary } from '@electron/fixtures/library';
import { analyzeChannels } from '../engine/fixture-analyzer';
import { classifyGoboCap } from '../engine/gobo-engine';
import { computeDmxForCue } from '../hooks/dmx-playback';
import { auditFixtureCoverage, formatCoverageWarning } from '../engine/fixture-coverage';
// @ts-ignore — le fichier contient du JSX, genCues est du TS pur
import { genCues } from '../views/QuickShowView';

const PROJECT = path.join(process.cwd(), 'LM', 'Yolo.lmproj');
const UKING_QXF = path.join(process.cwd(), 'resources', 'fixtures', 'UKing-Wall-Washer-24x3W.qxf');

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

describe('Yolo.lmproj — analyse des fixtures patchées (moteur réel)', () => {
  let lib: FixtureLibrary;
  let patched: any[];
  let customDefs: Map<string, any>;
  let ukingDef: any;

  // Preset Yolo + analyse (pour le générateur de cues)
  let presetQ: any = null;
  let analysis: any = null;

  beforeAll(async () => {
    expect(fs.existsSync(PROJECT)).toBe(true);
    // Le projet peut être en JSON pur (ancien format) ou en conteneur binaire
    // "LMZPROJ1" (project-envelope) — unpackProject gère les deux.
    const packed = await unpackProject(PROJECT);
    const proj = JSON.parse(packed.content);
    if (packed.blobs.length > 0) {
      console.log(`[YOLO-PROBE] projet au format enveloppe LMZPROJ1 — ${packed.blobs.length} blob(s) audio embarqué(s)`);
    }
    patched = proj.showStore.patchedFixtures || [];
    customDefs = new Map((proj.customFixtures || []).map((d: any) => [d.id, d]));

    lib = new FixtureLibrary();
    const xml = fs.readFileSync(UKING_QXF, 'utf8');
    ukingDef = await lib.parseQLC(xml, UKING_QXF);
    if (ukingDef) lib.add(ukingDef);

    console.log(`[YOLO-PROBE] ${patched.length} fixtures patchées, universes=`,
      proj.showStore.universes.map((u: any) => `${u.name}(${u.type}:${u.serialPort})`).join(', '));

    // ── Preset « Yolo » : sections + quickShow (config) + analyse réelle ──
    const presetPath = path.join(process.cwd(), 'LM', 'Yolo.lmpreset');
    if (fs.existsSync(presetPath)) {
      presetQ = JSON.parse(fs.readFileSync(presetPath, 'utf8'));
      analysis = presetQ.analysis ?? null;
      console.log(`[YOLO-PROBE] preset chargé: bpm=${analysis?.bpm} duration=${analysis?.duration?.toFixed(1)}s, ${presetQ.sections?.length} sections`);
    } else {
      console.log('[YOLO-PROBE] pas de Yolo.lmpreset — sweep généré sur sections synthétiques');
    }
  }, 30000);

  it('résout chaque def et affiche l\'analyse moteur par fixture', async () => {
    const resolvedAll = patched.map((pf) => {
      let def: any;
      if (pf.fixtureDefId.startsWith('custom-')) {
        def = customDefs.get(pf.fixtureDefId);
      } else {
        def = lib.get(pf.fixtureDefId);
      }
      return { pf, def };
    });

    // Résolution de toutes les defs
    for (const { pf, def } of resolvedAll) {
      expect(def, `${pf.name} (${pf.fixtureDefId}) doit résoudre une def`).toBeTruthy();
    }

    // Analyse moteur
    console.log('\n=== ANALYSE MOTEUR (analyzeChannels) ===');
    // Le LASER 4W porte une vraie roue de graphiques laser (10 slots STATIC/ILDA
    // GRP) : ses caps ont `color:#ff0000` mais ce sont des GOBO/gfx, pas un
    // mélangeur couleur. hasColorCaps ne doit PAS les avaler (régression.
    // NON_COLOR_CAP_TYPE_RE) → goboOffset doit être détecté.
    const laser4w = resolvedAll.find((r) => r.pf.name.includes('LASER 4W'));
    expect(laser4w?.def, 'LASER 4W doit résoudre sa def').toBeTruthy();
    const faLaser = analyzeChannels(laser4w!.pf, laser4w!.def);
    expect(faLaser.goboOffset, 'LASER 4W : roue de graphiques gobo non détectée').not.toBeNull();
    expect(faLaser.goboCaps.length, 'LASER 4W : goboCaps vides').toBeGreaterThan(0);

    // Régression MAINTENANCE (Tonio Mini Beam Pro) : le canal 12 « MAINTENANCE »
    // (caps NO FONCTION / RESET) ne doit JAMAIS devenir un effet — l'écrire à
    // capMid (~228) déclencherait le RESET de la tête en pleine lecture.
    const beamPro = resolvedAll.find((r) => r.pf.name.includes('Beam Pro #1'));
    const faBeam = analyzeChannels(beamPro!.pf, beamPro!.def);
    expect(faBeam.effectOffset, 'Beam Pro : MAINTENANCE ne doit pas être un effet').toBeNull();
    expect(faBeam.presetOverrideOffsets, 'Beam Pro : MACRO/MAINTENANCE doivent être exclus des écritures')
      .toContain(11);
    expect(faBeam.presetOverrideOffsets, 'Beam Pro : MAINTENANCE doit être exclu des écritures')
      .toContain(12);
    expect(faBeam.wheelOffset, 'Beam Pro : la roue doit rester vide (RGB pur)').toBeNull();

    // Régression RGB ALIEN : « MODE SELECTION » (laser) ne doit plus être avalé
    // comme roue de couleur → laserModeOffset, et la vraie roue « COLOR » (ch. 8)
    // doit être choisie (préférence nom explicitement couleur).
    const rAliens = resolvedAll.filter((r) => r.pf.name.includes('RGB ALIEN'));
    expect(rAliens.length).toBeGreaterThan(0);
    for (const rAli of rAliens) {
      const faAli = analyzeChannels(rAli.pf, rAli.def);
      expect(faAli.isLaser, 'RGB ALIEN : doit être laser').toBe(true);
      expect(faAli.laserModeOffset, 'RGB ALIEN : MODE SELECTION non détecté comme mode laser').not.toBeNull();
      expect(faAli.wheelOffset, 'RGB ALIEN : roue COLOR non détectée').not.toBeNull();
      expect(faAli.scanXOffset, 'RGB ALIEN : scanX non détecté').not.toBeNull();
      expect(faAli.scanYOffset, 'RGB ALIEN : scanY non détecté').not.toBeNull();
    }
    for (const { pf, def } of resolvedAll) {
      const mode = def?.modes?.[pf.modeIndex];
      const fa = analyzeChannels(pf, def);
      const base = pf.startAddress;
      const fmt = (path: string, ch: number) => (ch !== null && ch !== undefined ? `${ch}->${base + ch}` : '–');
      const rgb = (fa.rgbSegments || []).map((s: any) =>
        `[R${base + s.r}${s.g !== null ? ' G' + (base + s.g) : ''}${s.b !== null ? ' B' + (base + s.b) : ''}${s.w !== null ? ' W' + (base + s.w) : ''}]`);
      const doors = (fp: number[], fn: string) => (fp || []).map((x: number) => `${fn}${x}->${base + x}`).join(', ') || '–';
      console.log([
        `\n• ${pf.name}`,
        `  def=${pf.fixtureDefId} | mode=${mode?.name ?? '?'} (${pf.channelCount}ch) @${base}`,
        `  intensity=${fmt('', fa.intensityOffset)} | shutter=${fmt('', fa.shutterOffset)} | strobe=${fmt('', fa.strobeOffset)}`,
        `  pan=${doors(fa.panOffsets, 'p')} | tilt=${doors(fa.tiltOffsets, 't')}`,
        `  rgb=${rgb.length ? rgb.join(' ') : '–'} | rgbOffsets=${fa.rgbOffsets?.map((o: number) => o + '->' + (base + o)).join(',') || '–'}`,
        `  wheel=${fmt('', fa.wheelOffset)} | gobo=${fmt('', fa.goboOffset)} | zoom=${fmt('', fa.zoomOffset)} | beam=${fmt('', fa.beamOffset)}`,
        `  macros=${fa.macroOffsets.map((o: number) => o + '->' + (base + o)).join(',') || '–'} | isLaser=${fa.isLaser}`,
      ].join('\n'));
    }
  });

  it('computeDmxForCue produit bien de la lumière + du mouvement par fixture', () => {
    for (const { pf, def } of patched.map((pf) => {
      const def = pf.fixtureDefId.startsWith('custom-') ? customDefs.get(pf.fixtureDefId) : (
        lib.get(pf.fixtureDefId)
      );
      return { pf, def };
    })) {
      expect(def).toBeTruthy();
    }

    const defs = new Map<any, any>();
    for (const pf of patched) {
      const def = pf.fixtureDefId.startsWith('custom-') ? customDefs.get(pf.fixtureDefId) : lib.get(pf.fixtureDefId);
      defs.set(pf.fixtureDefId, def);
    }

    const cue = {
      time: 10, section: 'chorus', intensity: 'high', color: '#ff3333',
      movement: 'sweep', effect: 'vegas', energy: 0.85, colors: ['#ff3333', '#33ff33'],
    } as any;
    const dmx = computeDmxForCue(cue, patched, defs, [{ id: 'universe-1' }], {
      primary: 100, secondary: 70, tertiary: 40, other: 40,
    } as any);

    console.log('\n=== DMX RÉEL (computeDmxForCue, cue chorus high sweep) ===');
    let totalWritten = 0;
    for (const d of dmx) {
      const keys = Object.keys(d.channelValues).map(Number).sort((a, b) => a - b);
      totalWritten += keys.length;
      console.log(`universe=${d.universe} écrits=${keys.length} ch —`,
        keys.map((k) => `${k}=${d.channelValues[k]}`).join(' '));
    }
    expect(dmx.length).toBe(1);
    expect(totalWritten).toBeGreaterThan(0);

    // Chaque fixture doit avoir ≥1 canal non zéro (atténuation) dans sa plage
    for (const pf of patched) {
      const start = pf.startAddress;
      const end = start + pf.channelCount - 1;
      const written = dmx[0]?.channelValues || {};
      const nonZero = Object.keys(written)
        .map(Number)
        .filter((k) => k >= start && k <= end && (written[k] ?? 0) > 0);
      console.log(`[YOLO-PROBE] ${pad(pf.name, 38)} plage=${start}-${end} canaux>0=${nonZero.length}`);
    }

    // Vérifications douces mais utiles (régression) :
    // 1. Les washes/stage + beam + mini MH doivent avoir un intensity (ou segments RGB)
    for (const pf of patched) {
      const fa = analyzeChannels(pf, defs.get(pf.fixtureDefId));
      if (fa.isLaser) continue;
      expect(
        fa.intensityOffset !== null || (fa.rgbSegments && fa.rgbSegments.length > 0),
        `${pf.name} doit avoir intensity ou RGB pour être visible`,
      ).toBe(true);
    }
    // 2. Cohérence : si le mode déclare un canal Intensity/Shutter-dimmer, le
//    moteur DOIT trouver intensityOffset (jamais de fixture « muette » qui
//    possède pourtant un vrai dimmer). La 6 ARM (hybride laser+bee-eye) est
//    le cas d'école : isLaser=true mais DIMMER réel présent → intensity=9.
    for (const pf of patched) {
      const fa = analyzeChannels(pf, defs.get(pf.fixtureDefId));
      const mode = defs.get(pf.fixtureDefId)?.modes?.[pf.modeIndex];
      const hasIntensityChannel = (mode?.channels || []).some(
        (c: any) => c.type === 'Intensity' || (c.type === 'Shutter' && /\bdimmer\b/i.test(c.name || '')),
      );
      if (!hasIntensityChannel) continue;
      expect(fa.intensityOffset, `${pf.name} possède un canal Intensity mais le moteur ne l'a pas détecté`).not.toBe(null);
    }
  });

  it('centre du mouvement (capture) : le sweep est décalé par fixture, jamais hors plage', () => {
    const defs = new Map<any, any>();
    for (const pf of patched) {
      const def = pf.fixtureDefId.startsWith('custom-') ? customDefs.get(pf.fixtureDefId) : lib.get(pf.fixtureDefId);
      defs.set(pf.fixtureDefId, def);
    }

    // Une fixture mobile réelle (pan+tilt), non-laser : cas TONIO Mini Moving Head.
    const mobile = patched.find((pf) => {
      const fa = analyzeChannels(pf, defs.get(pf.fixtureDefId));
      return fa.panOffsets.length > 0 && fa.tiltOffsets.length > 0 && !fa.isLaser;
    });
    expect(mobile, 'au moins une fixture pan+tilt dans Yolo.lmproj').toBeTruthy();
    const mfa = analyzeChannels(mobile!, defs.get(mobile!.fixtureDefId));
    const panOff = mfa.panOffsets[0];
    const tiltOff = mfa.tiltOffsets[0];

    const cue = {
      time: 10, section: 'chorus', intensity: 'high', color: '#ff3333',
      movement: 'sweep', effect: 'vegas', energy: 0.85, colors: ['#ff3333', '#33ff33'],
    } as any;
    const tiers = { primary: 100, secondary: 70, tertiary: 40, other: 40 } as any;
    const uni = [{ id: 'universe-1' }];
    const NO = undefined;

    const sans = computeDmxForCue(cue, patched, defs, uni, tiers, NO, NO, NO, NO, NO, undefined);
    const positions: Record<string, any> = {};
    for (const pf of patched) positions[pf.id] = { x: 0.5, y: 0.3, h: 0.5, heading: 0, centerPan: 45, centerTilt: 30 };
    const avec = computeDmxForCue(cue, patched, defs, uni, tiers, NO, NO, NO, NO, NO, positions);

    // 1. Aucun canal pan/tilt hors plage avec tare, et la tête mobile bouge vraiment.
    let diff = 0;
    for (const d of avec) {
      for (const pf of patched) {
        const fa = analyzeChannels(pf, defs.get(pf.fixtureDefId));
        for (const off of fa.panOffsets) {
          const v = d.channelValues[pf.startAddress + off];
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(255);
          if (pf.id === mobile!.id) diff += Math.abs((v ?? 0) - (sans[0]?.channelValues?.[pf.startAddress + off] ?? 0));
        }
        for (const off of fa.tiltOffsets) {
          const v = d.channelValues[pf.startAddress + off];
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(255);
          if (pf.id === mobile!.id) diff += Math.abs((v ?? 0) - (sans[0]?.channelValues?.[pf.startAddress + off] ?? 0));
        }
      }
    }
    expect(diff).toBeGreaterThan(0);

    // 2. Le décalage suit la définition de degrés → DMX (21 pan / 43 tilt pour
    //    45°/30°, sauf quand le clamp 0-255 ou la scène corrige).
    const pA = sans[0]?.channelValues?.[mobile!.startAddress + panOff] ?? 128;
    const pB = avec[0]?.channelValues?.[mobile!.startAddress + panOff] ?? 128;
    const tA = sans[0]?.channelValues?.[mobile!.startAddress + tiltOff] ?? 128;
    const tB = avec[0]?.channelValues?.[mobile!.startAddress + tiltOff] ?? 128;
    const pDelta = pB - pA;
    const tDelta = tB - tA;
    // En cas de clampage, le delta finit plus petit : on vérifie l'énonce
    // « le zéro décale vers la droite/haut » (signe) + amplitude raisonnable.
    expect(Math.abs(pDelta)).toBeGreaterThanOrEqual(1);
    expect(Math.abs(pDelta)).toBeLessThanOrEqual(21);
    expect(Math.abs(tDelta)).toBeGreaterThanOrEqual(1);
    expect(Math.abs(tDelta)).toBeLessThanOrEqual(43);
    console.log(`[YOLO-PROBE] centre(mouvement) ${mobile!.name}: pan ${pA}→${pB} (Δ${pDelta}), tilt ${tA}→${tB} (Δ${tDelta})`);
  });

  it('roue couleur : les Mini Moving Head changent de couleur selon la palette (plus de rouge figé)', () => {
    const defs = new Map<any, any>();
    for (const pf of patched) {
      defs.set(pf.fixtureDefId, pf.fixtureDefId.startsWith('custom-')
        ? customDefs.get(pf.fixtureDefId)
        : lib.get(pf.fixtureDefId));
    }
    const minis = patched.filter((pf) => pf.fixtureDefId === 'custom-tonio-mini-moving-head');
    expect(minis.length).toBeGreaterThan(0);

    const wheelValueFor = (pf: any, color: string) => {
      const cue = {
        time: 10, section: 'chorus', intensity: 'high', color,
        movement: 'sweep', effect: 'vegas', energy: 0.85, colors: [color],
      } as any;
      const dmx = computeDmxForCue(cue, [pf], new Map([[pf.fixtureDefId, defs.get(pf.fixtureDefId)]]), [{ id: 'universe-1' }], {
        primary: 100, secondary: 70, tertiary: 40, other: 40,
      } as any);
      const fa = analyzeChannels(pf, defs.get(pf.fixtureDefId));
      return dmx[0]?.channelValues?.[pf.startAddress + fa.wheelOffset];
    };

    // Slots attendus de la roue Stage-Right reproduite dans la def custom :
    // rouge→RED 70-79, vert→GREEN 50-59, bleu→BLUE 60-69.
    const expectedSlots: Array<[string, string, [number, number]]> = [
      ['#ff2222', 'rouge', [70, 79]],
      ['#22ff22', 'vert', [50, 59]],
      ['#0044ff', 'bleu', [60, 69]],
    ];
    for (const pf of minis) {
      const values: Record<string, number> = {};
      for (const [hex] of expectedSlots) values[hex] = wheelValueFor(pf, hex);
      const distinct = new Set(Object.values(values)).size;
      console.log(`[ROUE] ${pf.name} @${pf.startAddress} rouge=${values['#ff2222']} vert=${values['#22ff22']} bleu=${values['#0044ff']}`);
      for (const [hex, label, [lo, hi]] of expectedSlots) {
        const v = values[hex];
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
        // Le ciblage par slot : la palette doit tomber dans LA sous-plage
        // réelle de la roue (le moteur écrit le milieu du cap choisi).
        expect(v, `${pf.name} : palette ${label} doit viser le slot ${lo}-${hi}, reçu ${v}`).toBeGreaterThanOrEqual(lo);
        expect(v, `${pf.name} : palette ${label} doit viser le slot ${lo}-${hi}, reçu ${v}`).toBeLessThanOrEqual(hi);
      }
      // La roue doit produire des positions DIFFÉRENTES selon la palette :
      // par le passé elle restait scotchée sur #ff0000 (même valeur partout).
      expect(distinct, `${pf.name} : roue figée sur une seule couleur (rouge=${values['#ff2222']}, vert=${values['#22ff22']}, bleu=${values['#0044ff']})`).toBeGreaterThan(1);
    }
  });

  it('gobos : exploitation intelligente (tenues + repos, jamais de défilé continu)', () => {
    const defs = new Map<any, any>();
    for (const pf of patched) {
      defs.set(pf.fixtureDefId, pf.fixtureDefId.startsWith('custom-')
        ? customDefs.get(pf.fixtureDefId)
        : lib.get(pf.fixtureDefId));
    }
    const goboFixtures = patched
      .map((pf) => ({ pf, fa: analyzeChannels(pf, defs.get(pf.fixtureDefId)) }))
      .filter((f) => f.fa.goboOffset !== null && f.fa.goboCaps && f.fa.goboCaps.length > 0);
    expect(goboFixtures.length, 'aucune fixture gobo détectée dans le show').toBeGreaterThan(0);
    for (const f of goboFixtures) {
      console.log(`[GOBO] ${f.pf.name} @${f.pf.startAddress} slots=${f.fa.goboCaps.map((c: any) => `${c.name}(${c.min}-${c.max})`).join(' · ')}`);
    }

    // Même config + mêmes sections que le sweep → mêmes cues.
    const qs = presetQ?.quickShow ?? {};
    const cfg = {
      musicStyle: qs.musicStyle || 'dance',
      colorScheme: qs.colorScheme || 'auto',
      intensity: qs.intensity ?? 'dynamic',
      movement: qs.movement ?? 'dynamic',
      beatDivision: qs.beatDivision ?? 4,
      audioReactive: qs.audioReactive !== false,
      sectionAware: qs.sectionAware !== false,
      customPalette: qs.customPalette ?? [],
    };
    let sections: any[];
    let bpm: number;
    if (presetQ?.sections?.length && analysis) {
      sections = presetQ.sections.map((s: any) => ({ type: s.type, startTime: s.startTime, endTime: s.endTime, energy: s.energy ?? 0.5, color: s.color ?? '#888' }));
      bpm = analysis.bpm || 120;
    } else {
      sections = [
        { type: 'intro', startTime: 0, endTime: 15, energy: 0.3, color: '#888' },
        { type: 'verse', startTime: 15, endTime: 35, energy: 0.5, color: '#888' },
        { type: 'build', startTime: 35, endTime: 45, energy: 0.7, color: '#888' },
        { type: 'chorus', startTime: 45, endTime: 70, energy: 0.9, color: '#888' },
        { type: 'verse', startTime: 70, endTime: 90, energy: 0.6, color: '#888' },
      ];
      bpm = 120;
    }
    const cues = genCues(sections, bpm, cfg.beatDivision, cfg, [], 7, analysis);
    expect(cues.length).toBeGreaterThan(0);

    for (const f of goboFixtures) {
      const gAddr = f.pf.startAddress + f.fa.goboOffset;
      const mids = new Set(f.fa.goboCaps.map((c: any) => Math.round((c.min + c.max) / 2)));
      const animMids = new Set(
        f.fa.goboCaps.filter((c: any) => classifyGoboCap(c) === 'animate')
          .map((c: any) => Math.round((c.min + c.max) / 2)),
      );
      const seq: number[] = [];
      for (const cue of cues) {
        const dmx = computeDmxForCue({ ...cue, energy: cue.energy, bpm }, patched, defs, [{ id: 'universe-1' }], {
          primary: 100, secondary: 70, tertiary: 40, other: 40,
        } as any);
        const written: Record<number, number> = {};
        for (const d of dmx) Object.assign(written, d.channelValues);
        const v = written[gAddr];
        if (v !== undefined) seq.push(v);
      }
      expect(seq.length, `${f.pf.name} : canal gobo jamais écrit`).toBeGreaterThan(0);

      // 1. Valeurs toujours À L'INTÉRIEUR des slots réels de la def.
      for (const v of seq) {
        expect(mids.has(v), `${f.pf.name} : valeur gobo hors slots reçue (${v})`).toBe(true);
      }
      // 2. La roue n'est pas figée sur un seul slot quand la def en propose plusieurs.
      if (mids.size > 1) {
        expect(new Set(seq).size, `${f.pf.name} : gobo figé sur un seul slot`).toBeGreaterThan(1);
      }
      // 3. PAS de défilé continu : changements < 50 % + des plages constantes (tenues/repos).
      let tr = 0;
      for (let i = 1; i < seq.length; i++) if (seq[i] !== seq[i - 1]) tr++;
      expect(tr, `${f.pf.name} : défilement continu (${tr}/${seq.length} changements)`).toBeLessThan(seq.length * 0.5);
      let best = 0, cur = 0;
      let prev: number | null = null;
      for (const v of seq) {
        if (v === prev) cur++;
        else { best = Math.max(best, cur); cur = 1; }
        prev = v;
      }
      expect(Math.max(best, cur), `${f.pf.name} : aucun repos (toujours en train de changer)`).toBeGreaterThanOrEqual(4);
      // 4. Slots animate (AUTO/SPIN/CHANGE/DITHER…) rares : < 35 % de la timeline.
      if (animMids.size > 0) {
        const animCount = seq.filter((v) => animMids.has(v)).length;
        console.log(`[GOBO] ${f.pf.name} : ${tr}/${seq.length} changements, repos=${Math.max(best, cur)} samples, slots animate=${animCount}/${seq.length}`);
        expect(animCount, `${f.pf.name} : slots animate trop présents (${animCount}/${seq.length})`).toBeLessThan(seq.length * 0.35);
      }
    }
  });

  it('sweep timeline complet : chaque fixture est éclairée, aucune valeur hors plage', () => {
    const defs = new Map<any, any>();
    for (const pf of patched) {
      defs.set(pf.fixtureDefId, pf.fixtureDefId.startsWith('custom-')
        ? customDefs.get(pf.fixtureDefId)
        : lib.get(pf.fixtureDefId));
    }

    // ── Config QuickShow du preset Yolo (ou défaut) ──
    const qs = presetQ?.quickShow ?? {};
    const cfg = {
      musicStyle: qs.musicStyle || 'dance',
      colorScheme: qs.colorScheme || 'auto',
      intensity: qs.intensity ?? 'dynamic',
      movement: qs.movement ?? 'dynamic',
      beatDivision: qs.beatDivision ?? 4,
      audioReactive: qs.audioReactive !== false,
      sectionAware: qs.sectionAware !== false,
      customPalette: qs.customPalette ?? [],
    };

    // ── Sections : réelles (preset) ou synthétiques de secours ──
    let sections: any[];
    let bpm: number;
    if (presetQ?.sections?.length && analysis) {
      sections = presetQ.sections.map((s: any) => ({ type: s.type, startTime: s.startTime, endTime: s.endTime, energy: s.energy ?? 0.5, color: s.color ?? '#888' }));
      bpm = analysis.bpm || 120;
    } else {
      sections = presetQ?.sections?.length ? presetQ.sections.map((s: any) => ({ type: s.type, startTime: 0, endTime: 10, energy: 0.5, color: '#888' })) : [
        { type: 'intro', startTime: 0, endTime: 15, energy: 0.3, color: '#888' },
        { type: 'verse', startTime: 15, endTime: 35, energy: 0.5, color: '#888' },
        { type: 'build', startTime: 35, endTime: 45, energy: 0.7, color: '#888' },
        { type: 'chorus', startTime: 45, endTime: 70, energy: 0.9, color: '#888' },
        { type: 'verse', startTime: 70, endTime: 90, energy: 0.6, color: '#888' },
      ];
      bpm = 120;
    }

    // ── Générer TOUS les cues du show (vrai moteur de génération) ──
    const cues: any[] = genCues(sections, bpm, cfg.beatDivision, cfg, [], 7, analysis);
    expect(cues.length).toBeGreaterThan(0);
    console.log(`\n[YOLO-SWEEP] ${cues.length} cues générés sur ${sections.length} sections (bpm=${bpm})`);

    // ── Construire la résolution fixture → canaux utiles ──
    const fixtures = patched.map((pf) => {
      const fa = analyzeChannels(pf, defs.get(pf.fixtureDefId));
      return { pf, fa, start: pf.startAddress, end: pf.startAddress + pf.channelCount - 1 };
    });

    // ── Exécuter le moteur sur CHAQUE cue et agréger ──
    const lit = new Set<string>();        // fixtures ayant reçu ≥1 canal non-zéro dans leur plage
    const overflowChannels = new Set<number>(); // canaux écrits hors de TOUTES les plages fixtures
    let totalCues = 0;
    let maxWritten = 0;
    for (const cue of cues) {
      const dmx = computeDmxForCue({ ...cue, energy: cue.energy }, patched, defs, [{ id: 'universe-1' }], {
        primary: 100, secondary: 70, tertiary: 40, other: 40,
      } as any);
      totalCues++;
      const written: Record<number, number> = {};
      for (const d of dmx) Object.assign(written, d.channelValues);
      const keys = Object.keys(written).map(Number);
      maxWritten = Math.max(maxWritten, keys.length);
      for (const f of fixtures) {
        const inRange = keys.filter((k) => (written[k] ?? 0) > 0 && k >= f.start && k <= f.end);
        if (inRange.length) lit.add(f.pf.id || f.pf.name);
      }
      // Détection débordement : canal écrit >0 mais dans AUCUNE plage fixture
      const inAnyRange = (k: number) => fixtures.some((f) => k >= f.start && k <= f.end);
      for (const k of keys) {
        if ((written[k] ?? 0) > 0 && !inAnyRange(k)) overflowChannels.add(k);
      }
    }

    console.log(`[YOLO-SWEEP] cue analysés=${totalCues}, max canaux/snapshot=${maxWritten}`);
    for (const f of fixtures) {
      const ok = lit.has(f.pf.id || f.pf.name);
      console.log(`${ok ? '✅' : '❌'} ${pad(f.pf.name, 38)} plage=${f.start}-${f.end} éclairée=${ok}`);
    }
    if (overflowChannels.size) {
      console.log(`\n[YOLO-SWEEP] ⚠ canaux écrits hors de toutes les plages: ${[...overflowChannels].sort((a, b) => a - b).join(', ')}`);
    }

    // Assertions dures : chaque fixture éclairée ≥1 fois, aucun débordement
    // hors des plages fixtures (plages exclusives = chaque canal écrit doit
    // appartenir à une fixture).
    for (const f of fixtures) {
      expect(
        lit.has(f.pf.id || f.pf.name),
        `Fixture ${f.pf.name} n'a reçu AUCUNE valeur dans sa plage sur toute la timeline`,
      ).toBe(true);
    }
    expect([...overflowChannels], 'Le moteur écrit sur des canaux hors de toutes les plages fixtures').toEqual([]);
  });

  it('couverture : chaque canal parlant est détecté et piloté par le moteur (aucun mutisme)', () => {
    console.log('\n=== COUVERTURE CANAL-À-CANAL (auditFixtureCoverage) ===');
    for (const pf of patched) {
      const def = pf.fixtureDefId.startsWith('custom-') ? customDefs.get(pf.fixtureDefId) : lib.get(pf.fixtureDefId);
      expect(def, `${pf.name} : def non résolue`).toBeTruthy();
      const fa = analyzeChannels(pf, def);
      const report = auditFixtureCoverage(pf, def, fa);
      const msg = formatCoverageWarning(report);
      if (msg) console.log(msg);
      console.log(
        `  [COUV] ${report.writtenChannels}/${report.totalChannels} canaux écrits · ` +
        `${report.channels.filter(c => c.status !== 'written').length} exclus/parasites — ` +
        `${report.warnings.length} canal(aux) parlant(s) non écrit(s)`,
      );
      expect(
        report.warnings,
        `${pf.name} : canal(aux) parlant(s) jamais écrit(s) → def ou analyse à corriger : ` +
        report.warnings.map((c) => `ch${c.offset} "${c.name}" (${c.type})`).join(', '),
      ).toEqual([]);
      // L'analyse moteur doit produire un audit exploitable pour toute fixture résolue.
      expect(report.totalChannels).toBeGreaterThan(0);
    }
  });
});