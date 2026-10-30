/**
 * Round-trip UI (mètres, origine coin) ↔ store (normalisé, origine centre) des supports.
 *
 * Régression : les conversions multipliaient/divisaient span par stageDims.width
 * alors que le rendu 3D utilise rig.span en MÈTRES → l'UI affichait 60 m pour un
 * pont de 6 m, et chaque aller-retour x↔cx corrompait la position (−25 m pour un
 * pont centré). Ces tests verrouillent la convention : span = mètres partout.
 */
import { describe, it, expect } from 'vitest';
import { rigToMeters, rigFromMeters, makeRig, DEFAULT_RIG_SPANS } from '../utils/stage-rigs';
import type { StageRig } from '../utils/stage-rigs';

const DIMS = { width: 10, depth: 8 };

function roundTrip(rig: StageRig) {
  const m = rigToMeters(rig, DIMS);
  return rigFromMeters({ x: m.x, y: m.y, w: m.w, d: m.d, h: m.h, r: m.r }, DIMS);
}

describe('rig meters ↔ store round-trip (span en mètres)', () => {
  it('truss par défaut : cx/cy/span invariants après aller-retour', () => {
    const truss = makeRig('t1', 'truss', 1);
    const back = roundTrip(truss);
    expect(back.cx).toBeCloseTo(truss.cx, 9);
    expect(back.cy).toBeCloseTo(truss.cy, 9);
    expect(back.span).toBeCloseTo(truss.span, 9);
    // span est bien en MÈTRES dans l'UI (pas span × largeur de scène)
    const m = rigToMeters(truss, DIMS);
    expect(m.w).toBeCloseTo(DEFAULT_RIG_SPANS.truss, 9);
  });

  it('pont centré : arête gauche positive et cohérente (pas de −25 m)', () => {
    const truss = makeRig('t2', 'truss', 1); // cx 0.5, span 6
    const m = rigToMeters(truss, DIMS);
    // Centre 5 m, longueur 6 m → arête gauche à 2 m du bord gauche
    expect(m.x).toBeCloseTo(2, 9);
  });

  it('fader X +1.5 m → cx bouge de exactement 0.15 (10 m de scène)', () => {
    const truss = makeRig('t3', 'truss', 1);
    const m = rigToMeters(truss, DIMS);
    const cxAfter = (m.x + 1.5 + m.w / 2) / DIMS.width;
    expect(cxAfter).toBeCloseTo(truss.cx + 1.5 / DIMS.width, 9);
  });

  it('changement de longueur : le centre reste FIXE (flux commit → resync → relecture)', () => {
    const truss = makeRig('t4', 'truss', 1); // span 6, cx 0.5
    const m = rigToMeters(truss, DIMS);      // arête gauche 2 m, w 6 m
    // Phase commit (code réel) : le centre est calculé avec l'ANCIENNE largeur.
    const oldCenter = m.x + m.w / 2; // 5 m
    const cxCommitted = oldCenter / DIMS.width;
    expect(cxCommitted).toBeCloseTo(truss.cx, 9);
    // Phase resync : le store a { cx: 0.5, span: 8 } → l'UI redérive l'arête gauche.
    const newLeftEdge = cxCommitted * DIMS.width - 8 / 2; // 1 m
    expect(newLeftEdge).toBeCloseTo(1, 9);
    // Phase relecture : round-trip depuis la nouvelle arête → centre inchangé, span 8.
    const back = rigFromMeters({ x: newLeftEdge, y: m.y, w: 8, d: m.d, h: m.h, r: m.r }, DIMS);
    expect(back.cx).toBeCloseTo(truss.cx, 9);
    expect(back.span).toBeCloseTo(8, 9);
  });

  it('frontBar et tBar : round-trip cy exact', () => {
    for (const kind of ['frontBar', 'backBar', 'totem', 'tBar'] as const) {
      const rig = makeRig('x', kind, 1);
      const back = roundTrip(rig);
      expect(back.cy, `cy ${kind}`).toBeCloseTo(rig.cy, 9);
      expect(back.cx, `cx ${kind}`).toBeCloseTo(rig.cx, 9);
    }
  });

  it('drag 3D (pt.x/W + 0.5) cohérent avec la position du groupe 3D', () => {
    // Le drag 3D écrit cx = pt.x / W + 0.5 (pt en coordonnées 3D centrées).
    // Le rendu place le groupe à (cx − 0.5) × W. Pour un pont centré (cx 0.5),
    // le groupe 3D est à x = 0 — le centre de la scène 3D est l'origine.
    const rig = makeRig('t5', 'truss', 1);
    const r = rigToMeters(rig, DIMS);
    const cxFromDrag = (r.x + r.w / 2) / DIMS.width;
    expect(cxFromDrag, 'cx = centre mètres / W').toBeCloseTo(rig.cx, 9);
    const groupX = (cxFromDrag - 0.5) * DIMS.width;
    // Position 3D = centre depuis bord gauche − W/2 (scène 3D centrée à l'origine)
    expect(groupX).toBeCloseTo(r.x + r.w / 2 - DIMS.width / 2, 9);
  });
});
