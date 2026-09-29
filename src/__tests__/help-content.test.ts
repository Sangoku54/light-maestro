/**
 * Centre d'aide — intégrité du contenu (aucune fiche vide/cassée).
 */
import { describe, it, expect } from 'vitest';
import { HELP_GROUPS, HELP_PAGES } from '../components/help/helpContent';
import { HELP_GROUPS_EN, HELP_PAGES_EN } from '../components/help/helpContent.en';

describe('centre d’aide — contenu', () => {
  it('19 fiches, ids uniques, groupes valides', () => {
    expect(HELP_PAGES.length).toBe(19);
    const ids = HELP_PAGES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of HELP_PAGES) {
      expect(HELP_GROUPS).toContain(p.group);
    }
    for (const g of HELP_GROUPS) {
      expect(HELP_PAGES.some((p) => p.group === g), `groupe vide : ${g}`).toBe(true);
    }
  });

  it('chaque fiche a pitch + pas-à-pas + astuces + défi non vides', () => {
    for (const p of HELP_PAGES) {
      expect(p.emoji.length, `${p.id} emoji`).toBeGreaterThan(0);
      expect(p.title.length, `${p.id} titre`).toBeGreaterThan(3);
      expect(p.pitch.length, `${p.id} pitch`).toBeGreaterThan(20);
      expect(p.steps.length, `${p.id} steps`).toBeGreaterThanOrEqual(3);
      expect(p.tips.length, `${p.id} tips`).toBeGreaterThanOrEqual(2);
      expect(p.challenge.length, `${p.id} défi`).toBeGreaterThan(10);
      for (const s of [...p.steps, ...p.tips, p.challenge]) {
        expect(s.length, `${p.id} texte vide`).toBeGreaterThan(10);
      }
    }
  });

  it('miroir anglais : mêmes ids, même ordre, groupes valides', () => {
    expect(HELP_PAGES_EN.length).toBe(HELP_PAGES.length);
    expect(HELP_PAGES_EN.map((p) => p.id)).toEqual(HELP_PAGES.map((p) => p.id));
    expect(HELP_GROUPS_EN.length).toBe(HELP_GROUPS.length);
    for (const p of HELP_PAGES_EN) {
      expect(HELP_GROUPS_EN).toContain(p.group);
      expect(p.title.length).toBeGreaterThan(3);
      expect(p.pitch.length).toBeGreaterThan(20);
      expect(p.steps.length).toBeGreaterThanOrEqual(3);
      expect(p.tips.length).toBeGreaterThanOrEqual(2);
      expect(p.challenge.length).toBeGreaterThan(10);
    }
  });
});
