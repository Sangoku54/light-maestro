import { describe, it, expect } from 'vitest';
import { mapIntensity } from '../engine/dmx-color';

// Non-régression : le Tier Mix utilisateur exprime le niveau FINAL.
// L'ancien code sur-multipliait par la base structurelle (secondaire :
// 0.7 × 0.7 = 0.49 au lieu de 0.70) — faisceaux du groupe secondaire
// invisibles malgré un Tier Mix à 70 %.
describe('mapIntensity — Tier Mix sans double pénalité', () => {
  // level 'medium' (140-240), energy 0.5 → base 190
  it('secondaire à 70% donne 70% (pas 49%)', () => {
    expect(mapIntensity('medium', 0.5, 'secondary', { primary: 100, secondary: 70, tertiary: 40 })).toBe(133);
  });

  it('secondaire à 50% donne 50% (pas 35%)', () => {
    expect(mapIntensity('medium', 0.5, 'secondary', { primary: 100, secondary: 50, tertiary: 40 })).toBe(95);
  });

  it('tertiaire à 40% donne 40% (pas 16%)', () => {
    expect(mapIntensity('medium', 0.5, 'tertiary', { primary: 100, secondary: 70, tertiary: 40 })).toBe(76);
  });

  it('primaire à 100% inchangé', () => {
    expect(mapIntensity('medium', 0.5, 'primary', { primary: 100, secondary: 70, tertiary: 40 })).toBe(190);
  });

  it('sans réglages : bases structurelles conservées (1.0 / 0.7 / 0.4)', () => {
    expect(mapIntensity('medium', 0.5, 'primary')).toBe(190);
    expect(mapIntensity('medium', 0.5, 'secondary')).toBe(133);
    expect(mapIntensity('medium', 0.5, 'tertiary')).toBe(76);
    expect(mapIntensity('medium', 0.5, 'other')).toBe(190);
  });
});
