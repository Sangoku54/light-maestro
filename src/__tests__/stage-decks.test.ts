/**
 * Plateaux de scène multi-rects : hauteur de base, migration, conversions.
 */
import { describe, it, expect } from 'vitest';
import {
  defaultStageDecks,
  defaultNewDeckHeight,
  sanitizeDeckUpdates,
  migrateStageDecks,
  deckContains,
  deckTopAt,
  deckRectMeters,
  deckToMeters,
  deckFromMeters,
  largestDeck,
  LEGACY_STAGE_HEIGHT,
  type StageDeck,
} from '../utils/stage-decks';

const T = (cx: number, cy: number, w: number, d: number, h: number, id = 'a', name = 'A'): StageDeck =>
  ({ id, name, cx, cy, w, d, h });

describe('stage-decks — plateaux multi-rects', () => {
  it('défaut : plateau unique identique à l’ancien rectangle', () => {
    const [deck] = defaultStageDecks();
    expect(deck).toMatchObject({ cx: 0.5, cy: 0.5, w: 1, d: 1, h: LEGACY_STAGE_HEIGHT });
    // Rendu inchangé : tout point est à 1,5 m.
    expect(deckTopAt(defaultStageDecks(), 0, 0)).toBe(1.5);
    expect(deckTopAt(defaultStageDecks(), 0.5, 0.5)).toBe(1.5);
    expect(deckTopAt(defaultStageDecks(), 1, 1)).toBe(1.5);
  });

  it('migration : projet ancien / corrompu → plateau par défaut', () => {
    expect(migrateStageDecks(undefined)).toEqual(defaultStageDecks());
    expect(migrateStageDecks(null)).toEqual(defaultStageDecks());
    expect(migrateStageDecks([])).toEqual(defaultStageDecks());
    expect(migrateStageDecks([{ nope: true }]).length).toBe(1);
    // Placement LIBRE : cx/cy non bornés (hors scène autorisé), valeurs finies conservées.
    // Seules gardes : taille ≥ 0.05 (plateau invisible sinon), hauteur ≥ 0.
    const [deck] = migrateStageDecks([{ cx: 9, cy: -3, w: 0, d: 99, h: -2 }]);
    expect(deck.cx).toBe(9);
    expect(deck.cy).toBe(-3);
    expect(deck.w).toBe(0.05);
    expect(deck.d).toBe(99);
    expect(deck.h).toBe(0);
  });

  it('défilé en T : podium + runway, hauteurs indépendantes', () => {
    const podium = T(0.5, 0.25, 1, 0.4, 1.0, 'podium', 'Podium');
    const runway = T(0.5, 0.7, 0.25, 0.6, 0.6, 'runway', 'Runway');
    const decks = [podium, runway];
    // Sur le podium.
    expect(deckTopAt(decks, 0.1, 0.2)).toBe(1.0);
    // Sur le runway.
    expect(deckTopAt(decks, 0.5, 0.8)).toBe(0.6);
    // Chevauchement → le plus haut gagne.
    expect(deckTopAt(decks, 0.5, 0.35)).toBe(1.0);
    // Hors plateaux → le sol.
    expect(deckTopAt(decks, 0.05, 0.9)).toBe(0);
  });

  it('contenance aux bords (inclus)', () => {
    const deck = T(0.5, 0.5, 0.4, 0.4, 1);
    expect(deckContains(deck, 0.3, 0.5)).toBe(true);
    expect(deckContains(deck, 0.7, 0.5)).toBe(true);
    expect(deckContains(deck, 0.29, 0.5)).toBe(false);
  });

  it('conversions mètres ↔ normalisé (aller-retour)', () => {
    const dims = { width: 10, depth: 8 };
    const deck = T(0.5, 0.5, 0.4, 0.5, 0.8);
    const m = deckToMeters(deck, dims);
    expect(m).toMatchObject({ x: 3, y: 2, w: 4, d: 4, h: 0.8 });
    const back = deckFromMeters(m, dims);
    expect(back.cx).toBeCloseTo(0.5, 5);
    expect(back.cy).toBeCloseTo(0.5, 5);
    const r = deckRectMeters(deck, dims);
    expect(r).toMatchObject({ x: 0, z: 0, w: 4, d: 4 });
  });

  it('largestDeck : pose des musiciens sur le plus grand plateau', () => {
    expect(largestDeck([])).toBeNull();
    const small = T(0.1, 0.1, 0.2, 0.2, 0.4, 's', 'Petit');
    const big = T(0.5, 0.5, 0.8, 0.8, 1.0, 'b', 'Grand');
    expect(largestDeck([small, big])).toBe(big);
  });

  it('defaultNewDeckHeight : empilé visible, jamais enterré', () => {
    expect(defaultNewDeckHeight([])).toBe(0.4);
    expect(defaultNewDeckHeight(defaultStageDecks())).toBe(1.9);
    expect(defaultNewDeckHeight([T(0.5, 0.5, 1, 1, 1.0), T(0.5, 0.7, 0.4, 0.3, 1.9)])).toBe(2.3);
  });

  it('sanitizeDeckUpdates : vide/invalide ignoré, jamais de NaN en store', () => {
    // Champ vidé → Number('') === 0 : le store doit l'ignorer (pas de H à 0).
    expect(sanitizeDeckUpdates({ h: 0, w: 0.4 })).toEqual({ h: 0, w: 0.4 });
    expect(sanitizeDeckUpdates({ h: Number('') })).toEqual({ h: 0 });
    expect(sanitizeDeckUpdates({ h: NaN })).toEqual({});
    expect(sanitizeDeckUpdates({ h: undefined })).toEqual({});
    expect(sanitizeDeckUpdates({ name: '   ' })).toEqual({});
    expect(sanitizeDeckUpdates({ name: 'Runway' })).toEqual({ name: 'Runway' });
    expect(sanitizeDeckUpdates({})).toEqual({});
    expect(sanitizeDeckUpdates({ rot: 450 })).toEqual({ rot: 90 });
    expect(sanitizeDeckUpdates({ rot: NaN })).toEqual({});
  });

  it('rotation plane : contenance dans le repère pivoté', () => {
    // Carré 0,4 × 0,4 pivoté à 45° → losange, pointes sur les axes à .283.
    const deck = { ...T(0.5, 0.5, 0.4, 0.4, 0.8), rot: 45 };
    expect(deckContains(deck, 0.5, 0.5)).toBe(true);
    expect(deckContains(deck, 0.5, 0.78)).toBe(true);
    expect(deckContains(deck, 0.5, 0.79)).toBe(false);
    // Ancien coin (.7, .7) : hors du losange.
    expect(deckContains(deck, 0.7, 0.7)).toBe(false);
    // Au-delà de la pointe Est (.783).
    expect(deckContains(deck, 0.85, 0.5)).toBe(false);
    // Sans rotation : comportement inchangé.
    expect(deckContains({ ...deck, rot: 0 }, 0.7, 0.5)).toBe(true);
    // Base (deckTopAt) suit la rotation.
    expect(deckTopAt([deck], 0.5, 0.78)).toBe(0.8);
    expect(deckTopAt([deck], 0.7, 0.7)).toBe(0);
  });
});
