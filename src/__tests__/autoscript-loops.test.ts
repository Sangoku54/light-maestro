import { describe, it, expect, beforeEach } from 'vitest';
import {
  SECTION_BEATS_PER_CYCLE,
  SECTION_BASE_PATTERN,
  RAMP_MAX_SEC,
  setSectionChain,
  sectionChain,
  clearSectionLoopCache,
  resolveMovePattern,
  getSectionMoveLoop,
  sectionMoveFor,
  sectionPhase01,
  sampleSectionLoop,
  sampleSectionLoopRaw,
  phaseToIndexOffset,
  movementAmp,
  type SectionLike,
  type SectionMoveLoop,
} from '../engine/autoscript-loops';

const SECTIONS: SectionLike[] = [
  { type: 'intro', startTime: 0, endTime: 8 },
  { type: 'verse', startTime: 8, endTime: 16 },
  { type: 'build', startTime: 16, endTime: 24 },
  { type: 'drop', startTime: 24, endTime: 32 },
];

const cueFor = (start: number, end: number, movement = 'circle', section = 'verse', bpm = 120) =>
  ({ movement, section, sectionStart: start, sectionEnd: end, bpm });

describe('autoscript-loops — les sections deviennent des boucles', () => {
  beforeEach(() => {
    setSectionChain(SECTIONS, { 0: 'circle', 8: 'sweep', 16: 'zigzag', 24: 'spiral' });
  });

  it('chaque cue de section porte des bornes valides (sinon null = replay historique)', () => {
    expect(sectionMoveFor(cueFor(0, 8), 1)).not.toBeNull();
    expect(sectionMoveFor({ movement: 'circle', bpm: 120 }, 1)).toBeNull();
    expect(sectionMoveFor({ sectionStart: 8, sectionEnd: 8, movement: 'circle' }, 1)).toBeNull();
    expect(sectionMoveFor({ sectionStart: 16, sectionEnd: 8, movement: 'circle' }, 1)).toBeNull();
    expect(sectionMoveFor(cueFor(0, 8), 0)).toBeNull();
  });

  it('cycles verrouillés sur les beats + échantillonnage anti-aliasé', () => {
    const drop = sectionMoveFor(cueFor(24, 32, 'spiral', 'drop'), 1)!;   // 16 beats @120 → 3 beats/tour
    const verse = sectionMoveFor(cueFor(8, 16, 'sweep', 'verse'), 1)!;   // 16 beats → 6 beats/tour
    const intro = sectionMoveFor(cueFor(0, 8, 'circle', 'intro'), 1)!;   // 16 beats → 8 beats/tour

    // Cadence de base : le mouvement n'est plus « toujours rapide ».
    // À 120 BPM, 3 beats/tour = 1 tour / 1,5 s (0,67 tour/s) en drop.
    expect(SECTION_BEATS_PER_CYCLE.drop).toBe(3);
    expect(SECTION_BEATS_PER_CYCLE.chorus).toBe(4);
    expect(SECTION_BEATS_PER_CYCLE.verse).toBe(6);
    expect(SECTION_BEATS_PER_CYCLE.intro).toBe(8);
    expect(drop.cycles).toBe(5);
    expect(drop.samples).toBe(40);
    expect(verse.cycles).toBe(3);
    expect(verse.samples).toBe(24);
    expect(intro.cycles).toBe(2);
    expect(intro.samples).toBe(16);
    for (const loop of [drop, verse, intro]) {
      expect(loop.samples).toBeGreaterThanOrEqual(loop.cycles * 8);
      expect(loop.samples).toBeLessThanOrEqual(128);
      expect(loop.samples).toBe(Math.min(128, Math.max(8, Math.round(loop.cycles * 8))));
    }
  });

  it('trajectoire CONTINUE : interpolation entre deux échantillons voisins', () => {
    // Avant : `Math.floor()` → la tête sautait d'une position à l'autre
    // (le module annonçait pourtant « interpolation au tick »).
    const loop = sectionMoveFor(cueFor(24, 32, 'circle', 'drop'), 1)!;
    let maxJump = 0;
    let prev = sampleSectionLoopRaw(loop, 0, 0, 0);
    // 60 fps sur 2 s de section
    const steps = 120;
    for (let i = 1; i <= steps; i++) {
      const p = (i / steps) * (2 / 8);
      const cur = sampleSectionLoopRaw(loop, p, 0, 0);
      maxJump = Math.max(maxJump, Math.hypot(cur[0] - prev[0], cur[1] - prev[1]));
      prev = cur;
    }
    // Sans interpolation, le saut était de ~0,78 (un échantillon entier).
    expect(maxJump).toBeLessThan(0.12);
  });

  it('enveloppe de vitesse : la phase accélère sur les pics, ralentit dans les creux', () => {
    // Section de 8 s : calme (0,4) puis stromal (1,6).
    const speed = new Array(64).fill(1).map((_, i) => (i < 32 ? 0.4 : 1.6));
    const section = { type: 'verse', startTime: 8, endTime: 16 };
    const warped = getSectionMoveLoop(section, 'sweep', 120, 1, true, speed);
    const uniform = getSectionMoveLoop(section, 'sweep', 120, 1, true);
    // Le nombre de cycles est inchangé (la section boucle pareil)…
    expect(warped.cycles).toBe(uniform.cycles);

    // …mais au milieu de la section, la boucle « warpée » est en RETARD :
    // elle a couvert moins de tours que la boucle uniforme.
    const mid = Math.floor(uniform.samples / 2);
    const midUniform = uniform.warp[mid];
    const midWarped = warped.warp[mid];
    expect(midUniform).toBeGreaterThan(uniform.cycles / 2 - 0.1);
    expect(midUniform).toBeLessThan(uniform.cycles / 2 + 0.1);
    expect(midWarped).toBeLessThan(midUniform - 0.1);
    expect(midWarped).toBeGreaterThan(0);
    // La fin de section reste alignée : le même nombre de tours au total.
    expect(warped.warp[warped.samples - 1]).toBeCloseTo(warped.cycles, 3);
  });

  it('normalisation : amplitude réelle exploitéée, axe constant jamais amplifié', () => {
    const staticLoop = sectionMoveFor(cueFor(8, 16, 'static', 'verse'), 1)!;
    const panOnly = sectionMoveFor(cueFor(8, 16, 'panOnly', 'verse'), 1)!;

    const pans: number[] = [];
    const tilts: number[] = [];
    for (let i = 0; i <= 64; i++) {
      const [x, y] = sampleSectionLoop(staticLoop, i / 64, 0, 0);
      pans.push(x); tilts.push(y);
    }
    expect(Math.max(...pans) - Math.min(...pans)).toBeGreaterThan(1.5); // 'static' (±0.1) occupe toute la course
    expect(Math.max(...tilts) - Math.min(...tilts)).toBeGreaterThan(1.5);

    const tiltValues = new Set<number>();
    for (let i = 0; i <= 32; i++) tiltValues.add(sampleSectionLoopRaw(panOnly, i / 32, 0, 0)[1]);
    expect([...tiltValues].every((v) => v === 0)).toBe(true); // axe inutile → 0, pas ±1
  });

  it('raccord : la section démarre sur la dernière valeur de la précédente', () => {
    const verse = sectionMoveFor(cueFor(8, 16, 'sweep', 'verse'), 2)!;
    expect(verse.prev).not.toBeNull();
    for (let m = 0; m < 2; m++) {
      const start = sampleSectionLoop(verse, 0, m, 0);
      const endOfPrev = sampleSectionLoopRaw(verse.prev!, 1, m, 0);
      expect(start[0]).toBeCloseTo(endOfPrev[0], 5);
      expect(start[1]).toBeCloseTo(endOfPrev[1], 5);
    }
    // le fondu est borné : après la fenêtre, on lit la boucle courante pure
    expect(verse.rampFrac).toBeGreaterThan(0);
    expect(verse.rampFrac).toBeLessThanOrEqual(RAMP_MAX_SEC / 8);
    const late = sampleSectionLoop(verse, 0.5, 0, 0);
    const lateRaw = sampleSectionLoopRaw(verse, 0.5, 0, 0);
    expect(late).toEqual(lateRaw);
  });

  it('la première section n’a pas de raccord (pas de précédente)', () => {
    const intro = sectionMoveFor(cueFor(0, 8, 'circle', 'intro'), 1)!;
    expect(intro.prev).toBeNull();
    expect(sampleSectionLoop(intro, 0, 0, 0)).toEqual(sampleSectionLoopRaw(intro, 0, 0, 0));
  });

  it('multi-moteurs : chaque moteur suit une trajectoire différente', () => {
    const loop = sectionMoveFor(cueFor(24, 32, 'circle', 'drop'), 4)!;
    expect(loop.motors).toBe(4);
    const seqs = [0, 1, 2, 3].map((m) => {
      const vals: string[] = [];
      for (let i = 0; i < 32; i++) vals.push(sampleSectionLoopRaw(loop, i / 32, m, 0).join(','));
      return vals.join('|');
    });
    expect(new Set(seqs).size).toBe(4);
    expect(Math.max(...loop.pan)).toBeLessThanOrEqual(1);
    expect(Math.min(...loop.pan)).toBeGreaterThanOrEqual(-1);
    expect(Math.max(...loop.tilt)).toBeLessThanOrEqual(1);
    expect(Math.min(...loop.tilt)).toBeGreaterThanOrEqual(-1);
  });

  it('sectionPhase01 bornée et phaseToIndexOffset cohérent avec un tour', () => {
    expect(sectionPhase01({ sectionStart: 8, sectionEnd: 16 }, 4)).toBe(0);
    expect(sectionPhase01({ sectionStart: 8, sectionEnd: 16 }, 20)).toBe(1);
    expect(sectionPhase01({ sectionStart: 8, sectionEnd: 16 }, 12)).toBeCloseTo(0.5, 6);
    expect(sectionPhase01({}, 5)).toBe(0);

    const loop = sectionMoveFor(cueFor(8, 16, 'sweep', 'verse'), 1)!;
    expect(phaseToIndexOffset(0, loop)).toBe(0);
    expect(phaseToIndexOffset(Math.PI * 2, loop)).toBe(loop.samples / loop.cycles); // un tour = samples/cycles pas
    expect(phaseToIndexOffset(Math.PI, loop)).toBe(Math.round(loop.samples / loop.cycles / 2));
    expect(phaseToIndexOffset(-Math.PI / 2, loop)).toBeGreaterThanOrEqual(0);
    expect(phaseToIndexOffset(-Math.PI / 2, loop)).toBeLessThan(loop.samples);
  });

  it('movementAmp : amplitude toujours dans la course réelle du centre (jamais plaqué)', () => {
    for (let center = 0; center <= 255; center++) {
      const amp = movementAmp(128, center, 128);
      expect(amp).toBeGreaterThanOrEqual(0);
      expect(center + amp).toBeLessThanOrEqual(255);
      expect(center - amp).toBeGreaterThanOrEqual(0);
    }
    expect(movementAmp(128, 128, 128)).toBe(127);   // centre médian : 127 de chaque côté
    expect(movementAmp(128, 40, 128)).toBe(40);      // centre excentré : borné par le bord
    expect(movementAmp(90, 128, 30)).toBe(30);       // limite de scène respectée
    expect(movementAmp(-5, 128, 128)).toBe(0);
    expect(movementAmp(128, 300, 128)).toBe(0);      // centre hors plage → pas de mouvement
  });

  it('résolution des patterns : nom explicite, nom de section, inconnu', () => {
    expect(resolveMovePattern('circle')).toBe('circle');
    expect(resolveMovePattern('panOnly')).toBe('panOnly');
    expect(resolveMovePattern('verse')).toBe(SECTION_BASE_PATTERN.verse);
    expect(resolveMovePattern('drop')).toBe(SECTION_BASE_PATTERN.drop);
    expect(resolveMovePattern('inconnu-quelconque')).toBeNull();
    expect(resolveMovePattern(undefined)).toBeNull();
  });

  it('boucle sans mouvement explicite : pattern de base de la section', () => {
    const loop = sectionMoveFor({ section: 'drop', sectionStart: 24, sectionEnd: 32, bpm: 120 }, 1)!;
    expect(loop.pattern).toBe(SECTION_BASE_PATTERN.drop);
    expect(sectionMoveFor({ section: 'section-inconnue', sectionStart: 40, sectionEnd: 48 }, 1)).toBeNull();
  });

  it('déterminisme : cache par clé, chaîne remise à zéro par setSectionChain', () => {
    const a = sectionMoveFor(cueFor(8, 16, 'sweep', 'verse'), 2)!;
    const b = sectionMoveFor(cueFor(8, 16, 'sweep', 'verse'), 2)!;
    expect(a).toBe(b); // même objet servi par le cache

    const other = sectionMoveFor(cueFor(8, 16, 'sweep', 'verse'), 3)!;
    expect(other).not.toBe(a);
    expect(other.samples).toBe(a.samples);

    const before = sectionMoveFor(cueFor(24, 32, 'spiral', 'drop'), 1)!;
    clearSectionLoopCache();
    const after = sectionMoveFor(cueFor(24, 32, 'spiral', 'drop'), 1)!;
    expect(after).not.toBe(before);
    expect(after.pan).toEqual(before.pan); // contenu identique, objet neuf

    setSectionChain(SECTIONS);
    expect(sectionChain().length).toBe(SECTIONS.length);
    const restarted = sectionMoveFor(cueFor(8, 16, 'sweep', 'verse'), 2)!;
    expect(restarted).not.toBe(a);
    // movements retirés : le raccord part maintenant du pattern de base de l'intro
    expect(restarted.prev).not.toBeNull();
    expect(restarted.prev!.pattern).toBe(SECTION_BASE_PATTERN.intro);
  });

  it('getSectionMoveLoop construit la même boucle que sectionMoveFor', () => {
    const direct: SectionMoveLoop = getSectionMoveLoop(
      { type: 'verse', startTime: 8, endTime: 16 },
      'sweep',
      120,
      2,
    );
    const viaCue = sectionMoveFor(cueFor(8, 16, 'sweep', 'verse'), 2)!;
    expect(direct).toBe(viaCue);
  });
});
