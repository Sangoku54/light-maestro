/**
 * SONDE — Positions de fixtures et direction par defaut des faisceaux.
 *
 * But : repondre position par position, sur le CODE REEL, a la question
 * « ou sont les fixtures, vers quoi pointent-elles par defaut, et que valent
 * les canaux pan/tilt DMX reellement ecrits ? ».
 *
 * On ne reimplemente RIEN : on utilise
 *   - `initFixturePosition` (showStore)          : placement + mountMode
 *   - `poseFromPos` / `renderDirFromDmx`          : pose canonique (fixture-pose)
 *   - `computeAimDMX`                             : solveur inverse (sceneAim)
 *   - `clampPanZoneDmx` / `clampTiltZoneDmx`      : bornes ecrites (dmx-movement)
 *   - `analyzeChannels`                           : canaux reels (fixture-analyzer)
 *
 * Sortie : un tableau console lisible + des assertions qui echouent si une
 * fixture de la grille par defaut ne pointe PAS la ou la convention
 * « vue audience » l'exige.
 */
import { describe, it, expect } from 'vitest';
import {
  poseFromPos,
  renderDirFromDmx,
  headingRadForPos,
  mountTiltForMode,
  type PosePos,
} from '../utils/fixture-pose';
import { computeAimDMX } from '../utils/sceneAim';
import { clampPanZoneDmx, clampTiltZoneDmx } from '../engine/dmx-movement';
import { useShowStore } from '../stores/showStore';

const DIMS = { width: 10, depth: 8 };

/** Angle (rad) entre deux vecteurs 3D. */
function angleBetween(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  const na = Math.hypot(a.x, a.y, a.z);
  const nb = Math.hypot(b.x, b.y, b.z);
  return Math.acos(Math.max(-1, Math.min(1, dot / (na * nb))));
}

/** Describe une direction en francais : ou le faisceau pointe. */
function describeDir(d: { x: number; y: number; z: number }): string {
  const parts: string[] = [];
  if (d.y < -0.15) parts.push('vers le bas');
  else if (d.y > 0.15) parts.push('vers le haut');
  else parts.push('horizontal');
  if (d.x > 0.15) parts.push('vers la DROITE (+X)');
  else if (d.x < -0.15) parts.push('vers la GAUCHE (-X)');
  if (d.z > 0.15) parts.push('vers l’ARRIERE (+Z, fond)');
  else if (d.z < -0.15) parts.push('vers le PUBLIC (-Z)');
  return parts.join(' / ');
}

/** Direction attendue par la convention « vue audience » pour une position. */
function expectedDirTag(pos: { x: number; y: number }, mode: string): string {
  if (mode === 'rear') return 'public';
  if (mode === 'top') return 'bas';
  if (mode === 'ground') {
    // Sol : devant le public (y < 0.25) => vers l'arriere ; cotes => vers le centre.
    if (pos.y < 0.25) return 'arriere';
    return 'centre';
  }
  // hanging : vers le public
  return 'public';
}

function dirMatchesTag(d: { x: number; y: number; z: number }, tag: string): boolean {
  switch (tag) {
    case 'public': return d.z < -0.5;
    case 'arriere': return d.z > 0.5;
    case 'bas': return d.y < -0.5;
    case 'centre': {
      // vers le centre horizontal de la scene : X vers 0, et Z vers 0
      return Math.abs(d.x) > 0.3 && Math.abs(d.z) > 0.3;
    }
    default: return false;
  }
}

describe('SONDE — grille de placement par defaut : position, montage, direction, DMX', () => {
  it('parcourt toute la grille 6 colonnes x N lignes et verifie la convention', () => {
    const store = useShowStore.getState();
    const rows: string[] = [];

    // 13 fixtures = grille 6x3 au minimum ; on couvre 6 lignes (36 positions)
    // pour couvrir les 4 zones (avant / arriere / cotes / centre).
    const TOTAL = 36;

    console.log('\n=== GRILLE DE PLACEMENT PAR DEFAUT (initFixturePosition) ===');
    console.log('idx | col row | pos.x  pos.y  | h    | mount   | heading   | DMX pan/tilt | direction');

    const expectations: { idx: number; mode: string; tag: string; pos: any }[] = [];

    for (let idx = 0; idx < TOTAL; idx++) {
      const id = `probe-${idx}`;
      store.initFixturePosition(id, 'moving_head', idx);
      const p = useShowStore.getState().fixturePositions[id];
      const mode = p.mountMode ?? 'hanging';

      // Pan/Tilt reellement ecrits par le moteur au repos (autoscript fige) :
      // le DMX neutre mecanique est 127.5 ; le moteur ecrit 128.
      const pose = poseFromPos(p as PosePos, mode, DIMS, true);
      const dNeutral = renderDirFromDmx(127.5, 127.5, pose);
      const dAt128 = renderDirFromDmx(128, 128, pose);

      // Bornes reellement appliquees par le moteur sur les valeurs ecrites.
      const panLo = clampPanZoneDmx(0, 540, 0);
      const panHi = clampPanZoneDmx(255, 540, 0);
      const tiltLo = clampTiltZoneDmx(0, 180, mode, 0, 0);
      const tiltHi = clampTiltZoneDmx(255, 180, mode, 0, 0);

      const headingDeg = ((pose.headingRad * 180) / Math.PI).toFixed(1);
      rows.push([
        String(idx).padStart(3),
        `c${idx % 6}r${Math.floor(idx / 6)}`.padEnd(7),
        p.x.toFixed(2).padStart(5),
        p.y.toFixed(2).padStart(5),
        String(p.h).padStart(4),
        mode.padEnd(7),
        `${headingDeg}deg`.padStart(9),
        `128/128 (zone ${panLo.toFixed(1)}-${panHi.toFixed(1)} / ${tiltLo.toFixed(1)}-${tiltHi.toFixed(1)})`,
        describeDir(dNeutral),
      ].join(' | '));

      const tag = expectedDirTag(p, mode);
      expectations.push({ idx, mode, tag, pos: p });

      // La direction au DMX neutre doit respectER la convention.
      expect(
        dirMatchesTag(dNeutral, tag),
        `fixture #${idx} (${mode}, x=${p.x}, y=${p.y}) devrait pointer « ${tag} » mais pointe ${describeDir(dNeutral)}`,
      ).toBe(true);

      // Le DMX ecrit par le moteur (128) doit rester dans la meme zone
      // (ecart mecanique ~1 deg sur une course 540 deg).
      expect(
        dirMatchesTag(dAt128, tag),
        `fixture #${idx} : le DMX 128 ecrit par le moteur sort de la zone « ${tag} »`,
      ).toBe(true);

      // Le tilt au sol ne doit JAMAIS descendre sous l'horizon.
      if (mode === 'ground') {
        expect(tiltLo).toBeGreaterThanOrEqual(127.5);
        expect(dNeutral.y).toBeLessThan(0.001);
      }
    }

    console.log(rows.join('\n'));

    // ── Synthese par zone ──
    const byZone = new Map<string, number>();
    for (const e of expectations) {
      const key = `${e.mode} -> ${e.tag}`;
      byZone.set(key, (byZone.get(key) ?? 0) + 1);
    }
    console.log('\n=== SYNTHESE PAR ZONE ===');
    for (const [k, v] of byZone) console.log(`  ${k.padEnd(22)} ${v} fixture(s)`);

    // La grille doit couvrir les 4 zones attendues.
    expect(byZone.get('rear -> public')).toBeGreaterThan(0);
    expect(byZone.get('ground -> arriere')).toBeGreaterThan(0);
    expect(byZone.get('ground -> centre')).toBeGreaterThan(0);
    expect(byZone.get('hanging -> public')).toBeGreaterThan(0);
  });

  it('l aller-retour DMX est exact : viser un point puis relire le DMX', () => {
    // On vise un point 3D explicite avec le solveur de production, on ecrit les
    // valeurs DMX resultantes, puis on relit la direction via le renderer.
    const cases: { pos: PosePos & { mountMode?: string }; mode: string; target: { x: number; y: number; z: number } }[] = [
      {
        pos: { x: 0.5, y: 0.9, h: 4, mountMode: 'rear' },
        mode: 'rear',
        target: { x: 0, y: 1.5, z: -4 }, // public, devant la scene
      },
      {
        pos: { x: 0.2, y: 0.9, h: 4, mountMode: 'rear' },
        mode: 'rear',
        target: { x: 0, y: 1.5, z: -4 },
      },
      {
        pos: { x: 0.5, y: 0.1, h: 0, mountMode: 'ground' },
        mode: 'ground',
        target: { x: 0, y: 0.5, z: 4 }, // fond de scene
      },
      {
        pos: { x: 0.1, y: 0.5, h: 0, mountMode: 'ground' },
        mode: 'ground',
        target: { x: 4, y: 1.5, z: 0 }, // centre-ish, cote droit
      },
      {
        pos: { x: 0.5, y: 0.5, h: 4, mountMode: 'hanging' },
        mode: 'hanging',
        target: { x: 0, y: 0, z: -4 }, // public
      },
    ];

    console.log('\n=== ALLER-RETOUR VISEE -> DMX -> DIRECTION ===');
    for (const c of cases) {
      const aim = computeAimDMX(c.target, {
        pos: c.pos,
        stageDims: DIMS,
        deckHeight: 0,
        hasPanTilt: true,
        panMaxDeg: 540,
        tiltMaxDeg: 180,
        panCurrent: 128,
      });
      expect(aim, `visée impossible pour ${c.mode}`).not.toBeNull();

      const pose = poseFromPos(c.pos, c.mode, DIMS, true);
      const d = renderDirFromDmx(aim!.pan, aim!.tilt, pose);

      const origin = {
        x: (c.pos.x - 0.5) * DIMS.width,
        y: c.pos.h,
        z: (c.pos.y - 0.5) * DIMS.depth,
      };
      const wanted = {
        x: c.target.x - origin.x,
        y: c.target.y - origin.y,
        z: c.target.z - origin.z,
      };
      const len = Math.hypot(wanted.x, wanted.y, wanted.z);
      const wantedNorm = { x: wanted.x / len, y: wanted.y / len, z: wanted.z / len };

      const err = angleBetween(d, wantedNorm);
      console.log(
        `  ${c.mode.padEnd(7)} pos=(${c.pos.x},${c.pos.y}) visée=(${c.target.x},${c.target.y},${c.target.z})`
        + ` -> DMX pan=${aim!.pan} tilt=${aim!.tilt} -> ${describeDir(d)} (écart ${(err * 180 / Math.PI).toFixed(3)}°)`,
      );

      // Le DMX ecrit doit etre dans [0,255] et reproduire la visee.
      expect(aim!.pan).toBeGreaterThanOrEqual(0);
      expect(aim!.pan).toBeLessThanOrEqual(255);
      expect(aim!.tilt).toBeGreaterThanOrEqual(0);
      expect(aim!.tilt).toBeLessThanOrEqual(255);

      // Tolerance = borne de QUANTIFICATION DMX, pas une valeur arbitraire :
      //   - pan  : 540 deg / 255 pas = 2.118 deg/pas ; le centre mecanique est
      //     127.5 mais le moteur ecrit 128 -> demi-pas = 1.06 deg d'ecart max ;
      //   - tilt : 180 deg / 255 pas = 0.706 deg/pas ; demi-pas = 0.35 deg.
      // Les deux erreurs s'additionnent au pire : ~1.41 deg = 0.0247 rad.
      const panStepRad = ((540 * Math.PI) / 180 / 255);
      const tiltStepRad = ((180 * Math.PI) / 180 / 255);
      const quantBound = panStepRad / 2 + tiltStepRad / 2 + 1e-6;
      expect(err).toBeLessThan(quantBound);
    }
  });

  it('la fixture « au sol devant » vise l arriere : DMX neutre => +Z', () => {
    // Verification ciblee, formule inverse du moteur : mountTilt ground = PI/2,
    // donc dir = (-sin(a)sin(p), -cos(a), -sin(a)cos(p)) ; a = PI/2 => y = 0.
    const pose = poseFromPos({ x: 0.5, y: 0.1, h: 0, mountMode: 'ground' }, 'ground', DIMS, true);
    expect(pose.mountTilt).toBeCloseTo(Math.PI / 2, 6);
    const d = renderDirFromDmx(127.5, 127.5, pose);
    expect(d.z).toBeGreaterThan(0.99);
    expect(d.y).toBeCloseTo(0, 6);
  });

  it('la fixture « arriere » vise le public : DMX neutre => -Z', () => {
    const pose = poseFromPos({ x: 0.5, y: 0.9, h: 4, mountMode: 'rear' }, 'rear', DIMS, true);
    expect(pose.mountTilt).toBeCloseTo(Math.PI / 2, 6);
    const d = renderDirFromDmx(127.5, 127.5, pose);
    expect(d.z).toBeLessThan(-0.99);
    expect(d.y).toBeCloseTo(0, 6);
  });

  it('le heading effectif ignore le heading manuel pour une fixture motorisee', () => {
    // Une fixture AVEC pan/tilt : le heading manuel ne doit PAS primer
    // (c'est l orientation de zone qui compte).
    const p = { x: 0.2, y: 0.9, h: 4, heading: 250, mountMode: 'rear' } as PosePos;
    const hMotor = headingRadForPos(p, 'rear', DIMS, true);
    const pNoMotor = { ...p };
    const hStatic = headingRadForPos(pNoMotor, 'rear', DIMS, false);
    expect(Math.abs(hMotor - hStatic)).toBeGreaterThan(0.1);
    // Le heading manuel n'est respecte que pour une fixture SANS pan/tilt.
    expect(hStatic).toBeCloseTo((250 * Math.PI) / 180, 6);
  });

  it('le mountMode top pointe vers le bas, mountTilt = 0', () => {
    expect(mountTiltForMode('top')).toBe(0);
    const pose = poseFromPos({ x: 0.5, y: 0.5, h: 4, mountMode: 'top' }, 'top', DIMS, true);
    const d = renderDirFromDmx(127.5, 127.5, pose);
    expect(d.y).toBeLessThan(-0.99);
  });
});
