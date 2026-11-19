/**
 * Routage NOMINAL des canaux de fixture.
 *
 * Les manufacturers nomment leurs canaux de façon fiable (« Zoom »,
 * « Pan/Tilt Speed », « Gobo 1 rotation », « Cyan »…). Le TYPE déclaré par la
 * def (QLC+ .qxf / OFL / GDTF) est en revanche souvent `Nothing`, ou pire
 * faux (« PATTERN SIZE » typé Shutter, « Program Speed » typé Nothing).
 *
 * C'est l'inverse du raisonnement habituel : le LIBELLÉ est la source de
 * vérité, le type n'est qu'un indice. Ce module donne les règles de routage
 * par nom, et la POLITIQUE d'écriture associée à chaque rôle.
 *
 * POLITIQUE (pourquoi on écrit quoi) :
 *
 *  - CONTINU (zoom, focus, frost, iris) : valeur ANIMÉE, identique au canal
 *    primaire — ce sont des paramètres continus d'une même tête.
 *  - SÉLECTION (gobo, roue couleur, index de prisme) : le PRIMAIRE est
 *    animé ; les SECONDAIRES reçoivent l'état NEUTRE (« open », « no gobo »)
 *    → la fixture reste dans un état connu sans superposer deux motifs.
 *  - ROTATION / INDEXATION : valeur ANIMÉE (la roue tourne, l'index défile) —
 *    c'est le cœur de l'exploitation d'une moving head.
 *  - VITESSE : valeur ANIMÉE (50 + énergie × 150).
 *  - STROBE : la valeur de vitesse du strobe (0 si inactive).
 *  - OBTURATION : la valeur d'ouverture du shutter primaire.
 *  - BLANC AUTONOME : la composante achromatique de la palette.
 *  - CTO/CTB/CTP, CMY : voir les rôles dédiés (couleur secondaire).
 *  - NEUTRE : 0 — canal sans rôle mais ÉCRIT explicitement (plus de « muet »).
 */

export type NominalRole =
  /** Continu : zoom, focus, frost, iris. */
  | 'zoom' | 'focus' | 'frost' | 'iris'
  /** Sélection : gobo, roue couleur, index de prisme. */
  | 'prism' | 'gobo' | 'wheel'
  /** Rotation / indexation d'une roue ou d'un prisme. */
  | 'rotate'
  /** Vitesse de mouvement / d'effet. */
  | 'speed'
  /** Strobe (vitesse). */
  | 'strobe'
  /** Obturation (ouverture / fermeture). */
  | 'shutter'
  /** Mouvement : pan / tilt (canal coarse ou « fine »). */
  | 'pan' | 'tilt'
  /** Pixel blanc autonome (sans triplet RGB associé). */
  | 'white'
  /** Température couleur (CTO / CTB / CTP). */
  | 'cto'
  /** Mélangeur CMY (cyan / magenta / yellow). */
  | 'cmy'
  /** Aucun rôle fonctionnel → état neutre 0. */
  | 'neutral';

/**
 * Règles de routage par libellé, évaluées DANS L'ORDRE (la première qui
 * matche gagne).
 *
 * L'ordre est capital :
 *  - « speed » AVANT « pan »/« tilt » → « Pan/Tilt Speed » est une vitesse,
 *    pas un bras de pan/tilt (sinon la tête recevait une position au lieu
 *    d'une vitesse de mouvement : vitesse figée au minimum tout le show).
 *  - « strobe » AVANT « speed » → « Strobe Rate » est un strobe.
 *  - « rotation » AVANT « gobo »/« prism » → « Gobo 1 rotation » est une
 *    rotation de roue, pas une sélection de motif.
 */
const NOMINAL_RULES: Array<{ re: RegExp; role: NominalRole }> = [
  // ── Vitesses (avant mouvement : « Pan/Tilt Speed ») ──────────────
  { re: /\bspeed\b/i, role: 'speed' },
  // ── Strobe ───────────────────────────────────────────────────────
  { re: /\bstrobe\b/i, role: 'strobe' },
  // ── Mouvement ────────────────────────────────────────────────────
  { re: /\bpan\b/i, role: 'pan' },
  { re: /\btilt\b/i, role: 'tilt' },
  // ── Optique continue ─────────────────────────────────────────────
  { re: /\bzoom\b/i, role: 'zoom' },
  { re: /\bfocus\b/i, role: 'focus' },
  { re: /\bfrost\b/i, role: 'frost' },
  { re: /\biris\b/i, role: 'iris' },
  // ── Rotation / indexation (avant gobo / prism) ───────────────────
  { re: /\b(prism|gobo|pattern|wheel)\b[\s\S]*\b(rotat|index|spin|scroll|revolve|direction|orbit)\w*/i, role: 'rotate' },
  { re: /\b(rotat|index|spin|scroll|revolve|direction|orbit)\w*[\s\S]*\b(prism|gobo|pattern|wheel)\b/i, role: 'rotate' },
  // ── Prisme / Gobo (sélection) ────────────────────────────────────
  { re: /\bprism\b/i, role: 'prism' },
  { re: /\b(gobo|pattern)\b/i, role: 'gobo' },
  // ── Roue couleur ─────────────────────────────────────────────────
  { re: /\b(color|colour)\s*wheel\b/i, role: 'wheel' },
  { re: /\bwheel\s*(color|colour)\b/i, role: 'wheel' },
  // ── Obturation ───────────────────────────────────────────────────
  { re: /\bshutter\b/i, role: 'shutter' },
  // ── Couleur secondaire ───────────────────────────────────────────
  { re: /\b(cto|ctb|ctp)\b/i, role: 'cto' },
  { re: /\b(cyan|magenta|yellow|lime)\b/i, role: 'cmy' },
];

/**
 * Rôle déduit du LIBELLÉ du canal (null si le nom ne dit rien).
 *
 * @param name  libellé du canal
 * @param isFine true si le canal est un « … fine » (sous-résolution) : un
 *               canal fine n'est jamais un rôle à part, il est apparié à
 *               son canal coarse.
 */
export function nominalRoleOf(name: string | undefined, isFine: boolean): NominalRole | null {
  if (isFine) return null;
  const n = (name ?? '').trim();
  if (!n) return null;
  for (const rule of NOMINAL_RULES) {
    if (rule.re.test(n)) return rule.role;
  }
  return null;
}

/**
 * Cap « neutre » d'un canal à capacités : l'état « rien / ouvert » d'une
 * sélection (gobo ouvert, roue sur open…). On écrit le MIN de cette cap.
 *
 * Utilisé pour les canaux SECONDAIRES d'une famille de sélection : la
 * fixture reste dans un état connu (2e roue de gobo vide) au lieu de
 * superposer un motif non demandé.
 */
export function neutralCapValue(
  caps: Array<{ min: number; max: number; name?: string }> | null | undefined,
): number | null {
  if (!caps || caps.length === 0) return null;
  const neutral = caps.find((c) =>
    /\b(open|no\s*gobo|no\s*pattern|no\s*effect|none|nothing|disabled|inactive|empty|standard|default)\b/i
      .test(c.name ?? ''));
  if (neutral) return Math.max(0, Math.min(255, neutral.min));
  return null;
}

/** Rôles où le canal est une SÉLECTION (le secondaire reçoit l'état neutre). */
export const SELECTION_ROLES: ReadonlySet<NominalRole> = new Set<NominalRole>(['gobo', 'wheel', 'prism']);
