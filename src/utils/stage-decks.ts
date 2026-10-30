/**
 * Plateaux de scène (multi-rects) — phase 1 du design libre de scène.
 *
 * La scène n'est plus un rectangle unique : c'est une liste de plateaux
 * rectangulaires (podium, runway en T, estrade DJ, risers…), chacun avec sa
 * position, ses dimensions et sa hauteur propres.
 *
 * Repère : coordonnées NORMALISÉES 0-1 ramenées au cadre `stageDims`
 * (même repère que `FixturePos`), hauteurs en MÈTRES (niveau du sol = 0).
 * Garder le repère normalisé évite toute migration des positions existantes :
 * un projet sans plateaux reçoit un plateau unique identique à l'ancien
 * rectangle (même rendu au pixel près).
 */

export interface StageDeck {
  /** Identifiant stable (usage interne + persistance). */
  id: string;
  /** Nom affiché (ex. « Podium », « Runway »). */
  name: string;
  /** Centre X normalisé 0-1 (largeur du cadre). */
  cx: number;
  /** Centre Y normalisé 0-1 (profondeur du cadre). */
  cy: number;
  /** Largeur normalisée (fraction de la largeur du cadre). */
  w: number;
  /** Profondeur normalisée (fraction de la profondeur du cadre). */
  d: number;
  /** Hauteur du dessus du plateau en mètres (sol = 0). */
  h: number;
  /** Rotation PLANE autour du centre, en degrés, sens horaire vu du dessus
   *  (0 = aligné). Pas de bascule 3D : le plateau reste horizontal. */
  rot?: number;
}

/** Angle normalisé 0-360 (degrés). */
export function normAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Hauteur historique du plateau unique (rendu inchangé par défaut). */
export const LEGACY_STAGE_HEIGHT = 1.5;

/** Plateau unique équivalent à l'ancien rectangle (migration / défaut). */
export function defaultStageDecks(): StageDeck[] {
  return [{ id: 'main', name: 'Scène', cx: 0.5, cy: 0.5, w: 1, d: 1, h: LEGACY_STAGE_HEIGHT }];
}

/** Normalise des données chargées (projet ancien ou corrompu) vers des plateaux valides. */
export function migrateStageDecks(saved: unknown): StageDeck[] {
  if (!Array.isArray(saved) || saved.length === 0) return defaultStageDecks();
  const decks: StageDeck[] = [];
  for (const [i, raw] of saved.entries()) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const num = (v: unknown, fb: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
    decks.push({
      id: typeof r.id === 'string' && r.id ? r.id : `deck-${i}`,
      name: typeof r.name === 'string' && r.name ? r.name : `Plateau ${i + 1}`,
      cx: Math.min(1, Math.max(0, num(r.cx, 0.5))),
      cy: Math.min(1, Math.max(0, num(r.cy, 0.5))),
      w: Math.min(2, Math.max(0.05, num(r.w, 0.4))),
      d: Math.min(2, Math.max(0.05, num(r.d, 0.3))),
      h: Math.min(10, Math.max(0, num(r.h, 0.4))),
      rot: normAngle(num(r.rot, 0)),
    });
  }
  return decks.length > 0 ? decks : defaultStageDecks();
}

/** Le point normalisé (x, y) est-il sur le plateau (repère pivoté) ? */
export function deckContains(deck: StageDeck, x: number, y: number): boolean {
  // Le plateau est rendu avec rotation.y = -rot (horaire pour rot > 0).
  // Pour tester l'appartenance, il faut appliquer la rotation inverse : +rot.
  const a = -((deck.rot ?? 0) * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = x - deck.cx;
  const dy = y - deck.cy;
  const lx = dx * c + dy * s;
  const lz = -dx * s + dy * c;
  return Math.abs(lx) <= deck.w / 2 && Math.abs(lz) <= deck.d / 2;
}

/**
 * Hauteur de base (dessus du plateau) au point normalisé (x, y).
 * Chevauchement → le plus haut gagne. Hors plateaux → le sol (0),
 * sauf si aucun plateau n'existe (fallback historique 1,5 m).
 */
export function deckTopAt(decks: StageDeck[], x: number, y: number): number {
  if (decks.length === 0) return LEGACY_STAGE_HEIGHT;
  let top = 0;
  let found = false;
  // First pass: exact containment (x,y within deck bounds)
  for (const deck of decks) {
    if (deckContains(deck, x, y)) {
      found = true;
      if (deck.h > top) top = deck.h;
    }
  }
  if (found) return top;
  // Fallback: no deck contains the exact point.
  // Only for axis-aligned decks (rot ≈ 0) that represent stage extensions:
  // if the point's y is within the deck's y-range but x is just outside,
  // the fixture is on the side of the deck and should get the deck's height.
  let fallbackTop = 0;
  for (const deck of decks) {
    const rot = deck.rot ?? 0;
    if (Math.abs(rot) > 5) continue; // only for nearly axis-aligned decks
    const a = -(rot * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // Check if y is within deck's y-range (with small tolerance)
    const dy = y - deck.cy;
    const dx = x - deck.cx;
    const ly = -dx * s + dy * c; // local y
    if (Math.abs(ly) > deck.d / 2 + 0.05) continue; // y outside deck's range (+5cm tolerance)
    // x is outside but within x-span (with small tolerance)
    const lx = dx * c + dy * s;
    if (Math.abs(lx) <= deck.w / 2 + 0.05) {
      if (deck.h > fallbackTop) fallbackTop = deck.h;
    }
  }
  return fallbackTop;
}

/** Rectangle du plateau en mètres, centré sur le cadre (pour Three.js / canvas). */
export function deckRectMeters(
  deck: StageDeck,
  stageDims: { width: number; depth: number },
): { x: number; z: number; w: number; d: number } {
  return {
    x: (deck.cx - 0.5) * stageDims.width,
    z: (deck.cy - 0.5) * stageDims.depth,
    w: deck.w * stageDims.width,
    d: deck.d * stageDims.depth,
  };
}

/** Conversion champ UI (mètres, origine coin) ↔ modèle (normalisé, origine centre). */
export function deckToMeters(
  deck: StageDeck,
  stageDims: { width: number; depth: number },
): { name: string; x: number; y: number; w: number; d: number; h: number; r: number } {
  return {
    name: deck.name,
    x: Math.round((deck.cx - deck.w / 2) * stageDims.width * 10) / 10,
    y: Math.round((deck.cy - deck.d / 2) * stageDims.depth * 10) / 10,
    w: Math.round(deck.w * stageDims.width * 10) / 10,
    d: Math.round(deck.d * stageDims.depth * 10) / 10,
    h: deck.h,
    r: Math.round(normAngle(deck.rot ?? 0) * 10) / 10,
  };
}

/** Conversion inverse (champ UI → modèle). */
export function deckFromMeters(
  m: { x: number; y: number; w: number; d: number; h: number },
  stageDims: { width: number; depth: number },
): { cx: number; cy: number; w: number; d: number; h: number } {
  const w = Math.min(2, Math.max(0.05, m.w / stageDims.width));
  const d = Math.min(2, Math.max(0.05, m.d / stageDims.depth));
  // No clamp on cx/cy — decks can be placed freely anywhere, even outside the main stage.
  return {
    cx: (m.x + m.w / 2 - stageDims.width / 2) / stageDims.width + 0.5,
    cy: (m.y + m.d / 2 - stageDims.depth / 2) / stageDims.depth + 0.5,
    w,
    d,
    h: Math.min(10, Math.max(0, m.h)),
  };
}

/** Le plus grand plateau (pose des musiciens par défaut). */
export function largestDeck(decks: StageDeck[]): StageDeck | null {
  if (decks.length === 0) return null;
  let best = decks[0];
  for (const deck of decks) {
    if (deck.w * deck.d > best.w * best.d) best = deck;
  }
  return best;
}

/**
 * Hauteur par défaut d'un plateau ajouté : empilé 0,4 m AU-DESSUS du plus
 * haut existant (jamais enterré dans un autre volume → visible aussitôt).
 */
export function defaultNewDeckHeight(decks: StageDeck[]): number {
  let top = 0;
  for (const deck of decks) {
    if (deck.h > top) top = deck.h;
  }
  return Math.round((top + 0.4) * 10) / 10;
}

/**
 * Assainit une mise à jour de plateau : ignore les champs vides/invalides
 * (ex. champ vidé → `Number('') === 0` → plateau coulé à 0 par accident).
 * Ne conserve que les valeurs finies + nom non vide.
 */
export function sanitizeDeckUpdates(updates: Partial<StageDeck>): Partial<StageDeck> {
  const clean: Partial<StageDeck> = {};
  if (typeof updates.name === 'string' && updates.name.trim()) {
    clean.name = updates.name.trim().slice(0, 40);
  }
  for (const k of ['cx', 'cy', 'w', 'd', 'h'] as const) {
    const v = updates[k];
    if (typeof v === 'number' && Number.isFinite(v)) clean[k] = v;
  }
  if (typeof updates.rot === 'number' && Number.isFinite(updates.rot)) {
    clean.rot = normAngle(updates.rot);
  }
  return clean;
}
