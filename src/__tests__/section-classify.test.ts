/**
 * Tests objectifs de la classification des sections (autoscript).
 *
 * Ces tests valident directement `classifySections` (la fonction pure qui
 * transforme des segments spectraux en types musicaux) sur des signaux
 * synthétiques représentatifs, SANS dépendre de Web Audio.
 *
 * Le but : garantir qu'une structure musicale typique est bien reconnue
 * (intro → verse → chorus → bridge → chorus → outro), et que les énergies
 * relatives gouvernent la classification plutôt que des seuils absolus
 * fragiles.
 */
import { describe, it, expect } from 'vitest';
import { classifySections, type SegmentFeatures } from '../hooks/audio-analysis';

function makeSegments(list: Array<{ t0: number; t1: number; e: number; l: string }>) {
  const segments: SegmentFeatures[] = list.map(s => ({
    startF: Math.round(s.t0 * 10),
    endF: Math.round(s.t1 * 10),
    startT: s.t0,
    endT: s.t1,
    energy: s.e,
    bassRatio: 0.5,
    centroidNorm: 0.5,
    flatness: 0.5,
    subBassRatio: 0.3,
  }));
  const labels = list.map(s => s.l);
  return { segments, labels };
}

describe('classifySections — structure musicale typique', () => {
  // Structure VCCVBC : intro/verse/chorus/verse/bridge/chorus/outro
  const { segments, labels } = makeSegments([
    { t0: 0, t1: 8, e: 0.15, l: 'I' },   // intro (calme)
    { t0: 8, t1: 20, e: 0.45, l: 'A' },  // verse
    { t0: 20, t1: 28, e: 0.75, l: 'B' }, // chorus
    { t0: 28, t1: 40, e: 0.45, l: 'A' }, // verse (répété)
    { t0: 40, t1: 48, e: 0.30, l: 'C' }, // bridge (unique)
    { t0: 48, t1: 56, e: 0.80, l: 'B' }, // chorus (répété)
    { t0: 56, t1: 64, e: 0.15, l: 'O' }, // outro (calme)
  ]);
  const duration = 64;

  it('reconnaît une intro calme en début de morceau', () => {
    const r = classifySections(segments, duration, labels);
    expect(r[0].type).toBe('intro');
  });

  it('reconnaît un outro calme en fin de morceau', () => {
    const r = classifySections(segments, duration, labels);
    expect(r[r.length - 1].type).toBe('outro');
  });

  it('reconnaît le chorus comme la section répétée la plus énergique', () => {
    const r = classifySections(segments, duration, labels);
    // Les segments 2 et 5 (label B) sont répétés et énergiques → chorus
    expect(r[2].type).toBe('chorus');
    expect(r[5].type).toBe('chorus');
  });

  it('reconnaît le verse comme la section répétée d’énergie moyenne', () => {
    const r = classifySections(segments, duration, labels);
    expect(r[1].type).toBe('verse');
    expect(r[3].type).toBe('verse');
  });

  it('reconnaît le bridge comme une section unique à énergie contrastée', () => {
    const r = classifySections(segments, duration, labels);
    expect(r[4].type).toBe('bridge');
  });

  it('ne laisse aucun segment en "unknown"', () => {
    const r = classifySections(segments, duration, labels);
    for (const s of r) {
      expect(s.type).not.toBe('unknown');
    }
  });
});

describe('classifySections — énergie relative (robustesse)', () => {
  it('un morceau globalement calme retrouve quand même chorus/verse par contraste relatif', () => {
    // Énergies toutes basses en absolu, mais le chorus reste le plus haut.
    const { segments, labels } = makeSegments([
      { t0: 0, t1: 8, e: 0.05, l: 'I' },
      { t0: 8, t1: 20, e: 0.12, l: 'A' },
      { t0: 20, t1: 28, e: 0.20, l: 'B' },
      { t0: 28, t1: 40, e: 0.12, l: 'A' },
      { t0: 40, t1: 48, e: 0.08, l: 'C' },
      { t0: 48, t1: 56, e: 0.22, l: 'B' },
      { t0: 56, t1: 64, e: 0.05, l: 'O' },
    ]);
    const r = classifySections(segments, 64, labels);
    expect(r[2].type).toBe('chorus');
    expect(r[5].type).toBe('chorus');
    expect(r[1].type).toBe('verse');
    expect(r[3].type).toBe('verse');
    expect(r[4].type).toBe('bridge');
  });

  it('un morceau sans vraie montée ne force pas un faux drop', () => {
    const { segments, labels } = makeSegments([
      { t0: 0, t1: 10, e: 0.3, l: 'A' },
      { t0: 10, t1: 20, e: 0.35, l: 'B' },
      { t0: 20, t1: 30, e: 0.33, l: 'A' },
      { t0: 30, t1: 40, e: 0.32, l: 'B' },
      { t0: 40, t1: 50, e: 0.3, l: 'A' },
    ]);
    const r = classifySections(segments, 50, labels);
    // Pas de pic d'énergie net → pas de drop.
    for (const s of r) {
      expect(s.type).not.toBe('drop');
    }
  });
});

describe('classifySections — drop et build', () => {
  it('reconnaît un drop comme un pic non-répété après une montée (build)', () => {
    // intro → verse → verse → build (montée) → drop (pic) → outro
    // (le verse est répété, comme dans une vraie chanson)
    const { segments, labels } = makeSegments([
      { t0: 0, t1: 8, e: 0.12, l: 'I' },   // intro
      { t0: 8, t1: 16, e: 0.40, l: 'A' },  // verse
      { t0: 16, t1: 24, e: 0.42, l: 'A' }, // verse (répété)
      { t0: 24, t1: 32, e: 0.60, l: 'D' }, // build (unique, montée)
      { t0: 32, t1: 40, e: 0.95, l: 'X' }, // drop (unique pic)
      { t0: 40, t1: 48, e: 0.12, l: 'O' }, // outro
    ]);
    const r = classifySections(segments, 48, labels);
    expect(r[0].type).toBe('intro');
    expect(r[1].type).toBe('verse');
    // Le drop (énergie 0.95, unique) doit être reconnu.
    expect(r[4].type).toBe('drop');
    expect(r[5].type).toBe('outro');
  });

  it('ne marque pas "drop" un chorus répété même très énergique', () => {
    const { segments, labels } = makeSegments([
      { t0: 0, t1: 8, e: 0.1, l: 'I' },
      { t0: 8, t1: 16, e: 0.5, l: 'A' },
      { t0: 16, t1: 24, e: 0.9, l: 'B' },
      { t0: 24, t1: 32, e: 0.5, l: 'A' },
      { t0: 32, t1: 40, e: 0.9, l: 'B' },
      { t0: 40, t1: 48, e: 0.1, l: 'O' },
    ]);
    const r = classifySections(segments, 48, labels);
    // B répété (0.9) = chorus, pas drop.
    expect(r[2].type).toBe('chorus');
    expect(r[4].type).toBe('chorus');
    expect(r[2].type).not.toBe('drop');
  });
});

describe('detectSectionBoundaries — extraction de frontières', () => {
  it('sépare des blocs d’énergie bien distincts', async () => {
    const { detectSectionBoundaries } = await import('../hooks/audio-analysis');
    // 8 secondes : 2s calme / 2s fort / 2s calme / 2s fort, à 10 Hz (80 frames)
    const n = 80;
    const energy: number[] = [];
    const low: number[] = [];
    const centroid: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = i / 10; // secondes
      const strong = t >= 2 && t < 4 ? 0.9 : t >= 6 ? 0.9 : 0.1;
      energy.push(strong);
      low.push(strong);
      centroid.push(strong);
    }
    // Novelty curve : pic aux frontières (2s→frame 20, 4s→40, 6s→60)
    const novelty = new Array(n).fill(0);
    [20, 40, 60].forEach(f => { novelty[f] = 1; novelty[f - 1] = 0.6; novelty[f + 1] = 0.6; });
    const b = detectSectionBoundaries(novelty, energy, low, centroid, 10, 8, 2);
    // Doit détecter au moins les frontières 20 et 60 (début/fin inclus)
    expect(b).toContain(0);
    expect(b).toContain(n - 1);
    // Au moins 3 sections (pas tout fusionné en un seul bloc)
    expect(b.length).toBeGreaterThanOrEqual(3);
  });
});