/**
 * Fixture Writers — écritures DMX partagées par les 3 moteurs.
 *
 * Le même code est utilisé par :
 *   - le tick live           (src/hooks/dmx-playback.ts)
 *   - le snapshot/crossfade  (src/hooks/dmx-playback.ts → computeDmxForCue)
 *   - la matérialisation D3  (src/hooks/dmx-cues.ts → computeDmxCues)
 *
 * Objectif : un canal détecté par l'analyseur doit TOUJOURS être piloté,
 * avec une valeur dans la plage réelle de la fixture (caps) et un état
 * déterministe quand aucun rôle ne peut l'animer.
 */

import type { DmxFixtureCapability } from '../hooks/dmx-cues';
import type { FixtureChannelAnalysis } from './fixture-analyzer';
import { capMid, laserGateValue } from './fixture-analyzer';
import { hexToRgb, splitRgbw, type RgbSegment } from './dmx-color';
import { neutralCapValue } from './fixture-routing';

/**
 * Cap explicitement NEUTRE (« Nothing », « Rien », « Other channel »,
 * « No function », « Manual »…) : on écrit son MIN = état « rien »,
 * jamais un programme interne ni une macro.
 *
 * « off »/« closure » sont exclus : un canal « Laser light closure » écrit
 * à 0 éteindrait le laser (le master laser a son propre traitement).
 */
const NEUTRAL_CAP_RE =
  /\b(no\s*function|nothing|no\s*effect|rien|aucun|other\s*channel|normal|default|manual|disabled?)\b/i;

/**
 * Valeur DÉTERMINISTE et sûre pour un canal à capacités sans rôle dédié.
 *
 * 1) cap neutre → son min (état « rien »)
 * 2) sinon → le milieu de la 1ʳᵉ cap (état connu, dans la plage déclarée)
 */
export function capabilityValue(caps: DmxFixtureCapability[] | null | undefined): number {
  if (!caps || caps.length === 0) return 0;
  const neutral = caps.find((c) => NEUTRAL_CAP_RE.test(c.name ?? ''));
  if (neutral) return Math.max(0, Math.min(255, neutral.min));
  return capMid(caps[0]);
}

/**
 * Écrit tous les canaux à capacités sans rôle dédié (rotation, polarité,
 * direction, taille de motif…) : la fixture reçoit un état CONNU au lieu
 * d'une valeur arbitraire laissée par le hardware.
 */
export function writeCapabilityChannels(
  chVals: Record<number, number>,
  base: number,
  fa: FixtureChannelAnalysis,
): void {
  for (const c of fa.capabilityChannels) {
    chVals[base + c.offset] = capabilityValue(c.caps);
  }
}

/**
 * Ramène une valeur 0-255 dans une plage de capability réelle.
 *
 * Sans cette contrainte, un sinus générique peut écrire une valeur dans une
 * zone « interdite » de la fixture (ex. prisme : Open 0-9 / Prism In 10-63 /
 * CW 64-159 → une valeur 200 tombe hors de toute cap → état indéfini).
 */
export function snapValueToCaps(
  value: number,
  caps: DmxFixtureCapability[] | null | undefined,
): number {
  const v = Math.max(0, Math.min(255, Math.round(value)));
  if (!caps || caps.length === 0) return v;
  const hit = caps.find((c) => v >= c.min && v <= c.max);
  if (hit) return v;
  let best = caps[0];
  let bestDist = Infinity;
  for (const c of caps) {
    const d = v < c.min ? c.min - v : v - c.max;
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return capMid(best);
}

/**
 * Découpe une position 0-255 en (coarse, fine) 16 bits.
 *
 * Le canal coarse reçoit la partie entière, le canal « fine » le reste
 * (0-255 = 1/256 de pas coarse). Sans ça, une tête 16 bits ne bouge
 * qu'en 8 bits (crénelage visible).
 */
export function coarseFineParts(value: number): { coarse: number; fine: number } {
  const v = Math.max(0, Math.min(255, value));
  const coarse = Math.floor(v);
  const fine = Math.round((v - coarse) * 255);
  return { coarse: Math.max(0, Math.min(255, coarse)), fine: Math.max(0, Math.min(255, fine)) };
}

/**
 * Écrit un axe (pan/tilt/dimmer) coarse + son canal « fine » apparié.
 *
 * - Sans canal fine : la valeur est arrondie (comportement historique).
 * - Avec canal fine  : le coarse descend d'un cran pour porter la fraction
 *   dans le fine → la position lue par la fixture est celle calculée.
 */
export function writeAxisPair(
  chVals: Record<number, number>,
  coarseAddr: number,
  fineAddr: number | null | undefined,
  value: number,
): void {
  const v = Math.max(0, Math.min(255, value));
  if (fineAddr === null || fineAddr === undefined) {
    chVals[coarseAddr] = Math.round(v);
    return;
  }
  const { coarse, fine } = coarseFineParts(v);
  chVals[coarseAddr] = coarse;
  chVals[fineAddr] = fine;
}

/**
 * Écrit un canal de couleur (coarse + éventuel octet LSB 16 bits).
 *
 * La valeur 0-255 est répartie entre le canal coarse (partie entière) et le
 * canal « fine » (partie fractionnaire × 255). La couleur perçue par la
 * fixture est IDENTIQUE — on gagne seulement 8 bits de résolution.
 */
export function writeColourChannel(
  chVals: Record<number, number>,
  coarseAddr: number,
  fineAddr: number | null | undefined,
  value: number,
): void {
  const v = Math.max(0, Math.min(255, value));
  if (fineAddr === null || fineAddr === undefined) {
    chVals[coarseAddr] = Math.round(v);
    return;
  }
  const { coarse, fine } = coarseFineParts(v);
  chVals[coarseAddr] = coarse;
  chVals[fineAddr] = fine;
}

/**
 * Écrit un segment RGB(W) complet, octets de sous-résolution compris.
 *
 * `w` doit être la composante achromatique déjà extraite (splitRgbw) : c'est
 * ce qui garantit que la couleur est PRÉSERVÉE (même teinte, même luminance)
 * tout en pilotant les 4 canaux d'une RGBW.
 */
export function writeRgbSegment(
  chVals: Record<number, number>,
  base: number,
  seg: RgbSegment,
  r: number,
  g: number,
  b: number,
  w: number,
): void {
  writeColourChannel(chVals, base + seg.r, seg.rFine ?? null, r);
  writeColourChannel(chVals, base + seg.g, seg.gFine ?? null, g);
  if (seg.b !== null) writeColourChannel(chVals, base + seg.b, seg.bFine ?? null, b);
  if (seg.w !== null) writeColourChannel(chVals, base + seg.w, seg.wFine ?? null, w);
  // Amber / UV : non pilotés séparément (la couleur vient du triplet RGB).
  if (seg.a !== null && seg.a !== undefined) chVals[base + seg.a] = 0;
  if (seg.uv !== null && seg.uv !== undefined) chVals[base + seg.uv] = 0;
}

/**
 * Applique un facteur d'intensité aux valeurs DÉJÀ écrites d'un segment
 * (fixture sans dimmer dédié) — y compris les octets de sous-résolution.
 */
export function scaleRgbSegment(
  chVals: Record<number, number>,
  base: number,
  seg: RgbSegment,
  dScale: number,
): void {
  const sc = (a: number | null | undefined) => {
    if (a === null || a === undefined) return;
    const addr = base + a;
    if (chVals[addr] !== undefined) chVals[addr] = Math.round(chVals[addr] * dScale);
  };
  sc(seg.r); sc(seg.rFine); sc(seg.g); sc(seg.gFine);
  sc(seg.b); sc(seg.bFine); sc(seg.w); sc(seg.wFine);
}

/**
 * Contexte d'écriture des canaux « nominaux » (rôles déduits du LIBELLÉ du
 * canal, cf. fixture-routing.ts).
 */
export interface NominalWriteContext {
  /** Temps (s) — animation des rôles vitesse / rotation. */
  time: number;
  /** Énergie 0-1 — module des vitesses. */
  energy: number;
}

/**
 * Écrit les canaux dont le rôle a été déduit du LIBELLÉ.
 *
 * POLITIQUE (cf. fixture-routing.ts) :
 *
 *  - CONTINU (zoom, focus, frost, iris) : même valeur que le canal PRIMAIRE
 *    → un second zoom suit le premier (au lieu de rester figé).
 *  - SÉLECTION (gobo, roue, prisme) : le PRIMAIRE est animé, le SECONDAIRE
 *    reçoit l'état NEUTRE (« open », « no gobo ») → la fixture reste dans un
 *    état connu, sans superposer deux motifs.
 *  - ROTATION / VITESSE : valeur ANIMÉE (la roue tourne, la vitesse varie).
 *  - STROBE / SHUTTER : la valeur du canal PRIMAIRE (même état).
 *  - CTO / CMY : 0 (neutre — la couleur vient de la palette RGB, on ne la
 *    modifie pas).
 */
export function writeNominalChannels(
  chVals: Record<number, number>,
  base: number,
  fa: FixtureChannelAnalysis,
  ctx: NominalWriteContext,
): void {
  if (!fa.nominalChannels.length) return;
  const primary = (off: number | null): number | undefined =>
    off === null ? undefined : chVals[base + off];

  for (const nc of fa.nominalChannels) {
    let v: number | undefined;
    switch (nc.role) {
      case 'zoom': v = primary(fa.zoomOffset); break;
      case 'focus': v = primary(fa.focusOffset); break;
      case 'frost': v = primary(fa.frostOffset); break;
      case 'iris': v = primary(fa.irisOffset); break;
      case 'prism':
      case 'gobo':
      case 'wheel': {
        // SÉLECTION : le secondaire reste à l'état neutre déclaré par la def.
        const neutral = neutralCapValue(nc.caps);
        v = neutral !== null
          ? neutral
          : (nc.caps.length > 0 ? capabilityValue(nc.caps) : 0);
        break;
      }
      case 'rotate': {
        // Rotation de roue / indexation : animation continue 0-255.
        const phase = ctx.time * 2.2 + nc.offset * 0.7;
        v = Math.round(128 + Math.sin(phase) * 127);
        break;
      }
      case 'speed': {
        const phase = ctx.time * 3 + nc.offset * 0.9;
        v = Math.round(50 + ctx.energy * 150 + Math.sin(phase) * 10);
        break;
      }
      case 'strobe': v = primary(fa.strobeOffset); break;
      case 'shutter': v = primary(fa.shutterOffset); break;
      case 'cto':
      case 'cmy':
        // Neutre : la correction de température / le mélangeur CMY sont
        // pilotés par leurs propres canaux (cmyOffsets), pas ici.
        v = 0;
        break;
      default:
        v = nc.caps.length > 0 ? capabilityValue(nc.caps) : 0;
        break;
    }
    if (v === undefined) continue;
    chVals[base + nc.offset] = snapValueToCaps(v, nc.caps);
  }
}

/**
 * Écrit les octets LSB des paires « fine » ↔ « coarse » (16 bits).
 *
 * Le canal coarse porte une valeur ENTIÈRE (0-255) : son LSB vaut donc 0.
 * On l'écrit EXPLICITEMENT (au lieu de laisser le canal muet) pour que la
 * fixture lise une valeur 16 bits stable et cohérente avec le coarse.
 */
export function writeFinePairs(
  chVals: Record<number, number>,
  base: number,
  fa: FixtureChannelAnalysis,
): void {
  for (const p of fa.finePairs) {
    chVals[base + p.fineOffset] = 0;
  }
}

/**
 * Couleur soustractive d'une fixture CMY (Cyan / Magenta / Yellow).
 *
 * C = 255-R, M = 255-G, Y = 255-B : le blanc (255,255,255) ne met aucun
 * pigment (0,0,0) et le rouge pur (255,0,0) met magenta + jaune.
 */
export function writeCmyChannels(
  chVals: Record<number, number>,
  base: number,
  fa: FixtureChannelAnalysis,
  r: number,
  g: number,
  b: number,
): void {
  const { c, m, y } = fa.cmyOffsets;
  if (c === null && m === null && y === null) return;
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  if (c !== null) chVals[base + c] = cl(255 - r);
  if (m !== null) chVals[base + m] = cl(255 - g);
  if (y !== null) chVals[base + y] = cl(255 - b);
}

/**
 * Pixels BLANCS autonomes (barre à pixels blancs, sans triplet RGB associé) :
 * ils reçoivent la composante ACHROMATIQUE de la palette (min(R,G,B)).
 *
 * Un rouge pur (255,0,0) → 0 (les pixels blancs restent éteints, la couleur
 * reste rouge) ; un blanc (255,255,255) → 255 (les pixels blancs s'allument).
 * C'est exactement la décomposition RGBW, appliquée à des canaux blancs
 * isolés.
 */
export function writeWhitePixels(
  chVals: Record<number, number>,
  base: number,
  fa: FixtureChannelAnalysis,
  r: number,
  g: number,
  b: number,
): void {
  if (!fa.whitePixels.length) return;
  const w = Math.max(0, Math.min(255, Math.round(Math.min(r, g, b))));
  for (const off of fa.whitePixels) chVals[base + off] = w;
}

/**
 * Canaux couleur « en doublon » (ex. « Green 2 (inner leds) ») : ils
 * reçoivent la MÊME composante de la palette que le canal principal.
 *
 * Seules les couleurs DÉJÀ présentes dans le RGB de la fixture sont
 * concernées (cf. analyseur) : on ne modifie jamais la couleur validée,
 * on allume simplement les zones/LEDs qui were restées noires.
 */
export function writeExtraColourChannels(
  chVals: Record<number, number>,
  base: number,
  fa: FixtureChannelAnalysis,
  r: number,
  g: number,
  b: number,
  scale = 1,
): void {
  if (!fa.extraColourChannels.length) return;
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v * scale)));
  for (const c of fa.extraColourChannels) {
    const v = c.key === 'r' ? r : c.key === 'g' ? g : b;
    chVals[base + c.offset] = cl(v);
  }
}

/**
 * Canaux COULEUR auxiliaires (LED orange / violet / bleu de fond d'une RGB+).
 *
 * Ils sont ÉCRITS à 0 (éteints) et JAMAIS à une valeur de cap : les allumer,
 * meme a mi-puissance, ajouterait une couleur non demandée et modifierait la
 * couleur du show — qui est validée par l'utilisateur.
 */
export function writeAuxColourChannels(
  chVals: Record<number, number>,
  base: number,
  fa: FixtureChannelAnalysis,
): void {
  for (const off of fa.auxColourChannels) chVals[base + off] = 0;
}

/**
 * Écrit les gates couleur d'un laser (« Red laser », « Green laser »…).
 *
 * Ces canaux sont des GATES : ils s'ouvrent (255) ou se ferment (0). Une
 * valeur continue (ex. 120) tombe dans la zone « fermée / stroboscope » de
 * la def → le faisceau scintille au lieu de s'ouvrir.
 */
export function writeLaserGates(
  chVals: Record<number, number>,
  base: number,
  fa: FixtureChannelAnalysis,
  paletteColor: string | undefined,
): void {
  if (!fa.laserGateOffsets.length) return;
  const [r, g, b] = paletteColor ? hexToRgb(paletteColor) : [255, 255, 255];
  let vr = laserGateValue(r);
  let vg = laserGateValue(g);
  let vb = laserGateValue(b);
  // Palette non représentable (bleu/violette sur un laser R/G) : ouvrir R+G
  // plutôt que d'éteindre le faisceau (« ça ne fait rien »).
  if (vr === 0 && vg === 0 && vb === 0 && (r > 22 || g > 22 || b > 22)) {
    vr = 255;
    vg = 255;
  }
  for (const gate of fa.laserGateOffsets) {
    const v = gate.key === 'r' ? vr : gate.key === 'g' ? vg : gate.key === 'b' ? vb : (vr || vg || vb ? 255 : 0);
    chVals[base + gate.offset] = v;
  }
}
