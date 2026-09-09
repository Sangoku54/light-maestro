/**
 * Fixture Analyzer — Module unifié d'analyse des canaux DMX
 *
 * Fusion de analyzeChannels (dmx-channel.ts) et analyzeFixture (dmx-cues.ts)
 * en un seul analyseur complet. Tous les consommateurs utilisent désormais
 * ce module pour éviter la duplication et les bugs d'inconsistance.
 *
 * Correction du bug ch.offset : utilise ch.offset ?? i partout.
 *
 * NOTE-PROGRAMME (TODO): Exploitation maximale à auditer fixture par fixture.
 *   Chaque fixture patchée doit voir TOUS ses canaux QXF/GDTF exploités à 100%
 *   (RGB par pixel, W/A/UV, dimmer, shutter, strobe, effect, speed, beam,
 *   zoom, frost, iris, focus, prism, gobo, pan/tilt, scan, pattern, blank,
 *   rotations). Voir dmx-color.ts:buildRgbSegments (fix Red1..Blue8) et
 *   dmx-playback.ts (per-pixel chase + Effect/Speed génériques).
 *   À FAIRE: parcourir la bibliothèque (resources/fixtures/*.qxf) et vérifier
 *   via tests unitaires que chaque mode (ex: UKing Wall Washer 24ch = 8×RGB)
 *   produit le bon nombre de segments et que chaque offset est écrit chaque frame.
 *   Réf: wall-washer 24×3W — 6/24 LEDs bug → fix 8 segments (2026-09).
 */

import type { PatchedFixture } from '../stores/showStore';
import type { DmxFixtureDefinition, DmxFixtureCapability, DmxFixtureChannel } from '../hooks/dmx-cues';
import { RgbSegment, startsWithRgb, hasColorWord, isRed, isGreen, isBlue, isWhite, isPresetMode, buildRgbSegments, enrichWheelCaps } from './dmx-color';

// Canaux couleur auxiliaires à exclure du calcul RGB (rotation/mouvement…).
const COLOUR_AUX_RE = /rotation|rolling|move|movement|speed|scan|strobe|effect|macro/i;

// Canal « Strobe » dédié : détection par NOM (avant le switch par type) pour
// qu'un canal Strobe (typé Shutter OU Effect selon l'OFL/QLC+) ne finisse
// JAMAIS en shutterOffset (les blocs shutter écrivent 255 → strobe permanent)
// ni en effectOffset (effet générique / safety net 128 = pulse). Exclut les
// composites (« Shutter / Strobe », « Dimmer / Strobe », « Strobe Functions »)
// et les paramètres (« Strobe Speed/Frequency/Duration/Density ») — ce sont
// de vrais shutters ou des vitesses, pas des canaux de strobe.
const STROBE_NAME_RE = /\bstrobe\b/i;
const STROBE_EXCLUDE_RE = /shutter|dimmer|function|multifunctional|pattern|speed|frequency|duration|density|intensity/i;

/** Un canal est un « Strobe » dédié (nom + exclusions + garde caps 0=Closed). */
function isStrobeNamedChannel(ch: DmxFixtureChannel): boolean {
  const name = ch.name ?? '';
  if (!STROBE_NAME_RE.test(name)) return false;
  if (STROBE_EXCLUDE_RE.test(name)) return false;
  const firstCap = ch.capabilities?.[0];
  if (firstCap && firstCap.min === 0 && /closed|dark|blackout/i.test(firstCap.name ?? '')) return false;
  return true;
}

/**
 * Valeur « gate » pour les canaux couleur laser typés Shutter (Red Laser /
 * Green Laser, ex. Galaxian 3D) : un Shutter OFL est fermé 0-31, ouvert 32-255,
 * avec une zone stroboscope possible au milieu — on renvoie donc 0 (fermé) ou
 * 255 (grand ouvert), jamais de valeur intermédiaire qui éteint ou stroboscope
 * le faisceau.
 */
/**
 * Caps 100 % preset-selector (no color word at all): AUTO MODE / SOUND /
 * PROGRAM / CHASE / BUILT-IN / NO FUNCTION / RESET / SELF-... Such a channel
 * is an internal-program selector -> NEVER auto-write it (risk of reset or
 * random program relaunch). A cap named "Red", "Color 1" = real color word ->
 * exploitable channel, not excluded.
 */
function isPresetOnlyCapChannel(ch: DmxFixtureChannel): boolean {
  const caps = ch.capabilities ?? [];
  if (caps.length === 0) return true;
  const PRESET_CAP_RE = /auto|sound|program|chase|built\s*in|follow|stand\s*alone|independent|run|step\s*\d|mode\s*\d|no\s*function|no\s*effect|no\s*fonction|aucun|rien|null|fonction|none|idle|dance|reset|self[\s-]*\w+|user|pattern\s*\d|macro\s*\d/i;
  return caps.every((c) => PRESET_CAP_RE.test(c.name ?? ''));
}

export function laserGateValue(v: number): number { return v > 22 ? 255 : 0; }

/**
 * Gate couleur mono-canal : au moins une cap du canal associe une couleur à
 * laser/beam (« Red laser », « Green laser », « Red + Green alternating » —
 * ex. Showtec Dominator ch « Laser »). Sélecteur pilotable, pas un effet.
 */
export function hasLaserColorGateCaps(ch: DmxFixtureChannel): boolean {
  const caps = ch.capabilities ?? [];
  if (caps.length < 2) return false; // 1 seule cap pleine plage = intensité d'une couleur (ex : « Red laser » 0-255), pas un sélecteur
  const colors = new Set<string>();
  for (const c of caps) {
    const m = (c.name ?? '').toLowerCase().match(/red|green|blue|amber|cyan|magenta|yellow|white/i);
    if (m && /(red|green|blue|amber|cyan|magenta|yellow|white).*(laser|beam)|(laser|beam).*(red|green|blue|amber|cyan|magenta|yellow|white)/i.test(c.name ?? '')) {
      colors.add(m[0]);
    }
  }
  // Un sélecteur choisit entre au moins 2 couleurs ; une seule couleur =
  // intensité mono-couleur (route couleur, pas gate).
  return colors.size >= 2;
}

// Canaux dont le type déclare déjà une fonction (autre qu'un sélecteur de
// couleur). Une cap portant `color` sur ces canaux = COULEUR D'AFFICHAGE du
// slot (ex. roue gobo laser « STATIC GRP 1 » en rouge, « ILDA GRP 2 »), PAS un
// mélangeur de couleur. Sans cette garde, hasColorCaps les avale comme canaux
// couleur et le canal n'atteint jamais son routing (Gobo/Effect/pattern/scan).
const NON_COLOR_CAP_TYPE_RE = /^(Intensity|Pan|Tilt|Gobo|Shutter|Strobe|Speed|Prism|Zoom|Frost|Focus|Iris|Maintenance|Nothing)$/;

// ─── Interface unifiée ─────────────────────────────────────────

export interface FixtureChannelAnalysis {
  // Identité
  fixture: PatchedFixture;

  // Intensity
  intensityOffset: number | null;
  ledIntensityOffsets: number[];
  /** Plage d'une courbe d'intensité sur un canal hybride « Dimmer/Strobe »
   *  (type Shutter, caps « Intensity »). Si non-nulle, la valeur 0-255 du
   *  dimmer doit être re-mappée dans [min,max] pour rester en zone intensité
   *  (jamais en zone strobe). */
  intensityCapRange: { min: number; max: number } | null;

  // Shutter / Effect
  shutterOffset: number | null;
  /** Canal « Strobe » dédié (type Shutter OU Effect selon l'OFL/QLC+) : détecté
   *  par NOM. 0 = pas de strobe, valeurs hautes = strobe. N'est PAS un shutter :
   *  ne contrôle pas la luminosité, jamais 255 par défaut (255 = strobe max). */
  strobeOffset: number | null;
  /** Caps du canal Strobe (si présentes) — pour écrire une valeur « off »
   *  caps-aware (Open / No function) au lieu de 0 arbitraire. */
  strobeCaps: DmxFixtureCapability[] | null;
  effectOffset: number | null;
  effectCaps: DmxFixtureCapability[] | null;

  // Couleur
  rgbSegments: RgbSegment[];        // multi-segment RGB (depuis dmx-color.ts)
  rgbOffsets: number[] | null;      // RGB simple (fallback pour consommateurs simples)
  wheelOffset: number | null;
  wheelCaps: DmxFixtureCapability[];

  // Mouvement
  panOffset: number | null;
  panFineOffset: number | null;
  panOffsets: number[];
  tiltOffset: number | null;
  tiltFineOffset: number | null;
  tiltOffsets: number[];

  // Gobo
  goboOffset: number | null;
  goboCaps: DmxFixtureCapability[];

  // Beam
  zoomOffset: number | null;
  frostOffset: number | null;
  irisOffset: number | null;
  focusOffset: number | null;
  beamOffset: number | null;

  // Autres
  prismOffset: number | null;
  prismCaps: DmxFixtureCapability[];
  speedOffset: number | null;
  macroOffsets: number[];
  presetOverrideOffsets: number[];

  // ── Laser ───────────────────────────────────────────────────
  /** Fixture détectée comme laser (type fixtureType OU signature de canaux). */
  isLaser: boolean;
  /** Comment le laser fait de la couleur : additif RGB | roue ColorPreset | gate mono-canal (caps couleur) | aucune. */
  laserColorMode: 'rgb' | 'wheel' | 'gate' | 'none';
  /** Canal « Mode / Mode Select » (DMX/dynamic/auto/sound). */
  laserModeOffset: number | null;
  laserModeCaps: DmxFixtureCapability[];
  /** Gate couleur mono-canal (caps « Red laser / Green laser / … », ex. Showtec Dominator). */
  laserColorGateOffset: number | null;
  laserColorGateCaps: DmxFixtureCapability[];
  /** Master / power switch du laser (« MASTER SXITCH », « Power », « Switch ») :
   *  sélecteur ON/OFF monoligné. Toujours écrit OUVERT par le bloc laser pour
   *  ne JAMAIS laisser le laser éteint faute de valeur écrite. */
  laserMasterOffset: number | null;
  laserMasterCaps: DmxFixtureCapability[];
  /** Canal « Pattern Selection / Pattern » (motifs : ligne, tunnel, vague…). */
  patternOffset: number | null;
  patternCaps: DmxFixtureCapability[];
  /** Canal scan horizontal (« Horizontal Angle/Movement ») = « pan » du laser. */
  scanXOffset: number | null;
  /** Canal scan vertical (« Vertical Angle/Movement ») = « tilt » du laser. */
  scanYOffset: number | null;
  /** « Scanning Speed » (vitesse du balayage). */
  laserSpeedScanOffset: number | null;
  /** « Dynamic Pattern Speed » (vitesse d'animation du motif). */
  laserSpeedPatternOffset: number | null;
  /** « Rotation X/Y/Z-axis » (0 à 3 canaux). */
  laserRotationOffsets: number[];
  /** Canal « Blanking » (blackout du faisceau). */
  blankOffset: number | null;

  // Méta
  channelCount: number;
  universeIndex: number;
}

// ─── Type alias pour compatibilité ─────────────────────────────

/** Alias rétro-compatible pour les consommateurs de dmx-channel.ts */
export type ChannelAnalysis = FixtureChannelAnalysis;

// ─── Fonction unifiée ──────────────────────────────────────────

const _logged = new Set<string>();

// ─── Helpers laser ────────────────────────────────────────────

/** Valeur d'activation au centre de la plage DMX d'une capacité. */
export function capMid(cap: DmxFixtureCapability | null | undefined): number {
  if (!cap) return 128;
  return Math.round((cap.min + cap.max) / 2);
}

/**
 * Synthétise `count` bandes DMX équidistantes quand un canal « Pattern
 * Selection » n'a aucune capability déclarée (cas EL-400RGB/CS-1000RGB :
 * OFL ne fournit pas les motifs). Le générateur cycle alors sur N motifs.
 */
export function synthPatternCaps(count = 8): DmxFixtureCapability[] {
  const caps: DmxFixtureCapability[] = [];
  const step = 256 / count;
  for (let i = 0; i < count; i++) {
    caps.push({
      min: Math.floor(i * step),
      max: Math.max(Math.floor(i * step), Math.floor((i + 1) * step) - 1),
      name: `Pattern ${i + 1}`,
    });
  }
  return caps;
}

/**
 * Choisit le cap « Mode » d'un laser : priorité DMX > dynamic > auto > premier
 * cap non nul > cap synthétique. Jamais « Sound » ni « Off » (le laser doit
 * rester pilotable en DMX, jamais figé dans un programme interne aléatoire).
 */
export function pickLaserModeCap(caps: DmxFixtureCapability[]): DmxFixtureCapability {
  const byName = (re: RegExp) => caps.find((c) => re.test(c.name ?? ''));
  return (
    byName(/dmx|dynamic|manual/i) ??
    byName(/auto/i) ??
    caps.find((c) => c.max >= 200 && c.min > 0) ??
    caps.find((c) => c.min > 0) ??
    { min: 128, max: 255, name: 'DMX' }
  );
}

/**
 * Détecte une fixture laser FX (DMX). Trois sources :
 *  1. le type de fixture normalisé contient « laser » ;
 *  2. signature laser dans les canaux/caps (nom ou cap contenant « laser »,
 *     ou cap « Laser off ») — les vrais lasers OFL sont souvent typés
 *     « Color Changer » (EL-400, IODA, Twin Effect, Boom Box Fx2…) et sans
 *     ça leur canal mode reste sur « Laser off »/« NoFunction » : le laser ne
 *     s'allume jamais en lecture ;
 *  3. (fallback) triple conjonction de canaux : « pattern » + axe de scan
 *     (horizontal/vertical angle · scan · circular) + un canal couleur.
 */
export function isLaserFixture(pf: PatchedFixture, channels: DmxFixtureChannel[]): boolean {
  // Exclure les vidéoprojecteurs laser (panasonic PT-RZ120/RZ120L…) : « Laser »
  // y désigne la source lumineuse (laser-phosphore), pas un effet laser. Leur
  // signature = contrôles d'optique/entrée propres aux projecteurs.
  const isVideoProjector = channels.some((c) =>
    /^(input select|lens|lens function|lens control|geometry|keystone|(custom )?masking|fade in|fade out|light output|slideshow|white balance|dvi|hdmi|sdi)/i.test((c.name ?? '').trim()),
  );
  if (isVideoProjector) return false;
  const norm = String(pf.fixtureType ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (norm.includes('laser')) return true;
  // Signature laser dans les canaux/caps (ex. « Laser off » est TOUJOURS sur
  // le canal mode d'un laser FX — jamais sur un par/bar LED).
  const laserSig = channels.some(
    (c) => /laser/i.test(c.name ?? '') || (c.capabilities ?? []).some((cap) => /laser/i.test(cap.name ?? '')),
  );
  if (laserSig) return true;
  const names = channels.map((c) => (c.name ?? '').toLowerCase());
  const hasPattern = names.some((n) => /\bpattern\b/.test(n));
  const hasScanAxis = names.some(
    (n) => /(horizontal|vertical)\s*(angle|movement|position)/.test(n) || /\bscan/.test(n) || /\bcircular/.test(n),
  );
  const hasColor = channels.some(
    (c) => /\bcolor|colour\b/i.test(c.name ?? '') && (c.type === 'Colour' || (c.capabilities ?? []).some((cap) => cap.color)),
  );
  return hasPattern && hasScanAxis && hasColor;
}

export function analyzeFixtureChannels(
  pf: PatchedFixture,
  def: DmxFixtureDefinition | undefined,
): FixtureChannelAnalysis {
  const channels = def?.modes[pf.modeIndex]?.channels ?? [];
  const isLaser = isLaserFixture(pf, channels);

  const fa: FixtureChannelAnalysis = {
    fixture: pf,
    intensityOffset: null,
    ledIntensityOffsets: [],
    intensityCapRange: null,
    shutterOffset: null,
    strobeOffset: null,
    strobeCaps: null,
    effectOffset: null,
    effectCaps: null,
    rgbSegments: [],
    rgbOffsets: null,
    wheelOffset: null,
    wheelCaps: [],
    panOffset: null,
    panFineOffset: null,
    panOffsets: [],
    tiltOffset: null,
    tiltFineOffset: null,
    tiltOffsets: [],
    goboOffset: null,
    goboCaps: [],
    zoomOffset: null,
    frostOffset: null,
    irisOffset: null,
    focusOffset: null,
    beamOffset: null,
    prismOffset: null,
    prismCaps: [],
    speedOffset: null,
    macroOffsets: [],
    presetOverrideOffsets: [],
    isLaser,
    laserColorMode: 'none',
    laserModeOffset: null,
    laserModeCaps: [],
    laserColorGateOffset: null,
    laserColorGateCaps: [],
    laserMasterOffset: null,
    laserMasterCaps: [],
    patternOffset: null,
    patternCaps: [],
    scanXOffset: null,
    scanYOffset: null,
    laserSpeedScanOffset: null,
    laserSpeedPatternOffset: null,
    laserRotationOffsets: [],
    blankOffset: null,
    channelCount: channels.length,
    universeIndex: 0,
  };

  const colourChannels: Array<{ offset: number; name: string; caps?: DmxFixtureCapability[] }> = [];

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const off = ch.offset ?? i;
    const chName = (ch.name?.trim() ?? '');

    // Preset override channels — excluded from auto-generated DMX. Mais un
    // canal au nom « macro/auto/sound » qui PORTE des capacités (ex. « Color
    // Macro », « Prism Macro ») peut être un vrai canal DMX à exploiter, pas
    // un mode utilisateur. On exclut donc aussi les canaux à caps 100 %
    // « présélection » (Auto/Sound/Program/Chase/Reset/Maintenance… sans aucun
    // mot de couleur) : les écrire en lecture déclencherait des programmes
    // internes ou pire un RESET (« MAINTENANCE » Beam Pro → cap RESET = 228).
    if (isPresetMode.test(chName)
      && (!ch.capabilities?.length || isPresetOnlyCapChannel(ch))) {
      fa.presetOverrideOffsets.push(off);
      continue;
    }
    if (/(maintenance|reset|self[\s-]*test|calibrat)/i.test(chName)
      && (!ch.capabilities?.length || isPresetOnlyCapChannel(ch))) {
      fa.presetOverrideOffsets.push(off);
      continue;
    }

    // Macro channels — excluded only when they carry no exploitable
    // capabilities. A « Color Macro / Prism Macro / Effect Macro » channel
    // WITH capabilities is a real DMX channel to exploit, not a user mode.
    if (ch.type === 'Macro' && !ch.capabilities?.length) {
      fa.macroOffsets.push(off);
      continue;
    }

    // Shutter/Dimmer hybride (from dmx-channel.ts)
    const isShutterDimmer = /\bdimmer\b/i.test(chName) && ch.type === 'Shutter';
    if (isShutterDimmer && fa.intensityOffset === null) {
      fa.intensityOffset = off;
      // Canal « Dimmer / Strobe » (ex. Stage Wash 7x10W) : un seul canal encode
      // la courbe d'intensité (cap nommée « Intensity », ici 8-134) ET le strobe
      // (135-255). Traitement EXCLUSIF en intensité : le canal ne doit jamais
      // être re-déclaré shutter/strobe (double écriture 0-255 → strobe) ni
      // recevoir une valeur hors zone intensité. On mémorise la courbe pour
      // re-mapper la valeur dimmer, et on SAUTE le switch générique.
      const intCap = (ch.capabilities ?? []).find(c => /intensity|dimm/i.test(c.name ?? ''));
      if (intCap) {
        fa.intensityCapRange = { min: Math.max(0, Math.min(255, intCap.min)), max: Math.max(0, Math.min(255, intCap.max)) };
      }
      continue;
    }

    // Auto-detect RGB by name (from dmx-cues.ts — broader pattern)
    const chNameLower = chName.toLowerCase();
    const isRgbNamed = /^(red|green|blue|r|g|b)(\s*\(?\d*\)?)?$/i.test(chNameLower);

    // Colour channel detection (merged from both analyzers)
    // Pour un laser, on capture aussi les canaux nommés rouge/vert/bleu même
    // typés Shutter/Nothing (OFL Galaxian 3D : « Red Laser »/« Green Laser »
    // typés ShutterStrobe) — sinon ils sont perdus (ni RGB complet ni roue).
    // Canal dont les caps portent une couleur = sélecteur de slots/roue. Mais un
// canal Macro/Nothing dont le NOM est un sélecteur de MODE/setup (« MODE
// SELECTION », « MASTER SXITCH », « AUTO MODE »…) n'est JAMAIS une roue
// couleur : ses caps colorisées lui viennent de la def (ex. modes nommés par
// couleur) et il doit rester pour son vrai routing (mode laser, effect…).
const SETUP_SELECTOR_NAME_RE = /\b(mode|master|switch|selection|program|programme|function|maintenance|reset|setup|menu|level|status|operation|running|sound|auto)\b/i;
/** Canaux de MOUVEMENT/contrôle laser (« Angle Control », « H. Position »,
 *  « X Rotation », « Waves Direction »…) : leur nom = contrôle laser, pas une
 *  roue couleur — même quand leur def colorise leurs caps. */
const LASER_MOTION_NAME_RE = /\b(angle|position|rotation|rotat|spin|movement|move|zoom|axis|scan|direction|control)\b/i;

const hasColorCaps = ch.capabilities?.some(cap => cap.color)
    && !NON_COLOR_CAP_TYPE_RE.test(ch.type)
    && !((ch.type === 'Macro' || ch.type === 'Nothing')
      && (SETUP_SELECTOR_NAME_RE.test(chName)
        || (isLaser && LASER_MOTION_NAME_RE.test(chName))));
    const isLaserColorNamed = isLaser && (isRed.test(chName) || isGreen.test(chName) || isBlue.test(chName)) && !COLOUR_AUX_RE.test(chName);
    // Gate couleur mono-canal laser (caps « Red laser / Green laser / … »,
    // ex. Showtec Dominator) : interceptée AVANT la collecte couleur — ses
    // caps portent `color: true` dans l'OFL et l'auraient avalée comme canal
    // couleur générique (jamais atteinte par le routing laser).
    if (isLaser && fa.laserColorGateOffset === null && hasLaserColorGateCaps(ch)) {
      fa.laserColorGateOffset = off;
      fa.laserColorGateCaps = enrichWheelCaps(ch.capabilities ?? []);
      fa.laserColorMode = 'gate';
      continue;
    }
    if (isRgbNamed || isLaserColorNamed || startsWithRgb.test(chName) || ch.type === 'Colour' || (ch.type === 'Beam' && hasColorWord.test(chName)) || hasColorCaps) {
      colourChannels.push({ offset: off, name: chName, caps: ch.capabilities });
      continue;
    }

    // Strobe par NOM (avant le switch par type) : un canal nommé « Strobe »
    // (type Effect OU Shutter/Strobe, QLC+ .qxf) ne doit jamais finir en
    // shutterOffset (blocs shutter → 255 = strobe permanent) ni en
    // effectOffset (jamais écrit proprement). Garde : si la 1re cap couvre 0
    // avec un nom Closed/Dark (rares fixtures où « Strobe » = shutter
    // ouvert/fermé, 0 = éteint), on laisse le switch le traiter.
    if (isStrobeNamedChannel(ch) && fa.strobeOffset === null) {
      fa.strobeOffset = off;
      fa.strobeCaps = ch.capabilities ?? null;
      continue;
    }

    // ── Laser routing (avant le switch générique) : matcher par NOM les
    // canaux signature d'un laser, pour qu'ils ne soient ni avalés (caps
    // vides → Nothing) ni déplacés (BeamPosition → beamOffset, Rotation →
    // speedOffset…). Gated `isLaser` : zéro impact sur les autres fixtures.
    if (isLaser) {
      let matched = false;
      if (/^(mode|mode\s*select|mode\s*selection)$/i.test(chName) || (!fa.laserModeOffset && /laser.*mode|mode.*laser/i.test(chName))) {
        if (fa.laserModeOffset === null) { fa.laserModeOffset = off; fa.laserModeCaps = ch.capabilities ?? []; }
        matched = true;
      } else if (fa.laserModeOffset === null && /^(show\s*mode|program|show)$/i.test(chName)) {
        // Modes réels OFL (IODA « Program », Stinger « Show Mode », Fusion
        // « Show ») : les capter comme MODE pilotable (valeur stable choisie
        // par pickLaserModeCap) au lieu de les laisser cycler comme
        // shutter/effect génériques. Gated isLaser ; inactif si un « Mode »
        // propre a déjà été capté plus tôt.
        fa.laserModeOffset = off;
        fa.laserModeCaps = ch.capabilities ?? [];
        matched = true;
      } else if (/scann?ing\s*speed/i.test(chName)) {
        if (fa.laserSpeedScanOffset === null) fa.laserSpeedScanOffset = off;
        matched = true;
      } else if (/(dynamic|pattern).*speed|speed.*(dynamic|pattern)/i.test(chName)) {
        if (fa.laserSpeedPatternOffset === null) fa.laserSpeedPatternOffset = off;
        matched = true;
      } else if (/rotat\w*(\s+over)?\s*[\s_-]*(x|y|z)|\b(x|y|z)[\s_-]*(axis[\s_-]*)?(rolling|spin|rotat\w*)/i.test(chName)) {
        fa.laserRotationOffsets.push(off);
        matched = true;
      } else if (/laser.*(rotat\w*|rolling|spin)|(red|green|blue|white|amber|yellow|color).*(rotat\w*|rolling|spin)|(rotat\w*|rolling|spin).*laser/i.test(chName)) {
        // Rotations à nom composé des lasers (Galaxian 3D : « Red Laser
        // Rotation », Showtec « Rotating Laser ») : axes de rotation
        // graphique, pas des speed génériques.
        fa.laserRotationOffsets.push(off);
        matched = true;
      } else if (/^(x|y)[\s_-]*(axis[\s_-]*)?(moving|movement|position|angle)/i.test(chName)) {
        // Axes à deux lettres des lasers OFL (IODA 400/600/1000, Twin Effect…) :
        // « X/Y Axis Moving » sont des axes de balayage, pas des rotations.
        if (chName[0].toLowerCase() === 'x' && fa.scanXOffset === null) fa.scanXOffset = off;
        else if (chName[0].toLowerCase() === 'y' && fa.scanYOffset === null) fa.scanYOffset = off;
        matched = true;
      } else if (/horizontal/i.test(chName) && /vertical/i.test(chName)) {
        // Channel mixte "Horizontal / vertical movement" (Laserworld CS-1000RGB ch4) : Y d'abord
        if (fa.scanYOffset === null) fa.scanYOffset = off;
        else if (fa.scanXOffset === null) fa.scanXOffset = off;
        matched = true;
      } else if (/horizontal.*(angle|movement|position)|move.*(hori(?!z)|horiz)/i.test(chName)) {
        // Variantes TONIO : « HORIZONTAL MOVEMENT » mais aussi « MOVE HORONTALY »
        // (orthographe défectueuse du fabricant) — l'axe horizontal du laser.
        if (fa.scanXOffset === null) fa.scanXOffset = off;
        matched = true;
      } else if (/vertical.*(angle|movement|position)|move.*verti/i.test(chName)) {
        if (fa.scanYOffset === null) fa.scanYOffset = off;
        matched = true;
      } else if (fa.laserColorGateOffset === null && hasLaserColorGateCaps(ch)) {
        // Gate couleur mono-canal : caps « Red laser / Green laser / … »
        // (Showtec Dominator ch « Laser ») — sélecteur pilotable, le bloc
        // laser l'ouvre sur la palette.
        fa.laserColorGateOffset = off;
        fa.laserColorGateCaps = ch.capabilities ?? [];
        fa.laserColorMode = 'gate';
        matched = true;
      } else if (fa.laserMasterOffset === null && /^(master(\s*switch|\s*sxitch)?|power(\s*switch)?|switch(-\d+)?)$/i.test(chName) && (ch.capabilities?.length ?? 0) >= 2) {
        // Master/power switch du laser (ex. TONIO « MASTER SXITCH » caps OFF/ON).
        // Slot séparé du mode : le bloc laser l'écrira TOUJOURS OUVERT pour que
        // le laser ne soit jamais muet par défaut.
        fa.laserMasterOffset = off;
        fa.laserMasterCaps = ch.capabilities ?? [];
        matched = true;
      } else if (/\bblank/i.test(chName)) {
        if (fa.blankOffset === null) fa.blankOffset = off;
        matched = true;
      } else if (/\bpattern\b/i.test(chName)) {
        if (fa.patternOffset === null) { fa.patternOffset = off; fa.patternCaps = ch.capabilities ?? []; }
        matched = true;
      }
      if (matched) continue;
    }

    switch (ch.type) {
      case 'Intensity':
        if (fa.intensityOffset === null) {
          fa.intensityOffset = off;
        } else {
          fa.ledIntensityOffsets.push(off);
        }
        break;
      case 'Shutter':
      case 'Strobe':
        if (isStrobeNamedChannel(ch)) {
          if (fa.strobeOffset === null) { fa.strobeOffset = off; fa.strobeCaps = ch.capabilities ?? null; }
        } else if (fa.shutterOffset === null) fa.shutterOffset = off;
        break;
      case 'Effect': {
        const hasCaps = (ch.capabilities?.length ?? 0) > 0;
        if (fa.effectOffset === null) {
          fa.effectOffset = off;
          fa.effectCaps = ch.capabilities ?? null;
        } else if ((fa.effectCaps?.length ?? 0) === 0 && hasCaps) {
          // Premier canal Effect sans capacités : on repointe sur celui qui en a.
          fa.effectOffset = off;
          fa.effectCaps = ch.capabilities;
        }
        break;
      }
      case 'Pan':
        if (fa.panOffset === null) fa.panOffset = off;
        else if (fa.panFineOffset === null && /\bfine\b/i.test(chName)) fa.panFineOffset = off;
        if (!/\bfine\b/i.test(chName)) fa.panOffsets.push(off);
        break;
      case 'Tilt':
        if (fa.tiltOffset === null) fa.tiltOffset = off;
        else if (fa.tiltFineOffset === null && /\bfine\b/i.test(chName)) fa.tiltFineOffset = off;
        if (!/\bfine\b/i.test(chName)) fa.tiltOffsets.push(off);
        break;
      case 'Gobo':
        if (fa.goboOffset === null) {
          fa.goboOffset = off;
          fa.goboCaps = ch.capabilities ?? [];
        }
        break;
      case 'Prism':
        if (fa.prismOffset === null) {
          fa.prismOffset = off;
          fa.prismCaps = ch.capabilities ?? [];
        }
        break;
      case 'Zoom':
        if (fa.zoomOffset === null) fa.zoomOffset = off;
        break;
      case 'Frost':
        if (fa.frostOffset === null) fa.frostOffset = off;
        break;
      case 'Focus':
        if (fa.focusOffset === null) fa.focusOffset = off;
        break;
      case 'Iris':
        if (fa.irisOffset === null) fa.irisOffset = off;
        break;
      case 'Speed':
        if (fa.speedOffset === null) fa.speedOffset = off;
        break;
      case 'Beam': {
        // Les fixtures réelles typent zoom/frost/iris/focus en 'Beam' (GDTF
        // BeamZoom/BeamFocus/… → 'Beam'). On route par nom vers l'offset dédié ;
        // sinon on conserve beamOffset (fallback générique).
        if (/\bzoom\b/.test(chNameLower)) {
          if (fa.zoomOffset === null) fa.zoomOffset = off;
        } else if (/\bfrost\b/.test(chNameLower)) {
          if (fa.frostOffset === null) fa.frostOffset = off;
        } else if (/\biris\b/.test(chNameLower)) {
          if (fa.irisOffset === null) fa.irisOffset = off;
        } else if (/\bfocus\b/.test(chNameLower)) {
          if (fa.focusOffset === null) fa.focusOffset = off;
        } else if (fa.beamOffset === null) {
          fa.beamOffset = off;
        }
        break;
      }
      case 'Macro': {
        // Macro non-couleur porteur de capacités (prism/gobo/effect/speed
        // macro). Les macros COULEUR sont déjà routées via colourChannels
        // (hasColorCaps → roue). On route par nom, sinon effect générique.
        if (/\bprism\b/i.test(chName)) {
          if (fa.prismOffset === null) { fa.prismOffset = off; fa.prismCaps = ch.capabilities ?? []; }
        } else if (/\bgobo\b/i.test(chName)) {
          if (fa.goboOffset === null) { fa.goboOffset = off; fa.goboCaps = ch.capabilities ?? []; }
        } else if (/\beffect\b/i.test(chName)) {
          if (fa.effectOffset === null) { fa.effectOffset = off; fa.effectCaps = ch.capabilities ?? null; }
        } else if (/\bspeed\b/i.test(chName)) {
          if (fa.speedOffset === null) fa.speedOffset = off;
        } else if (fa.effectOffset === null) {
          fa.effectOffset = off;
          fa.effectCaps = ch.capabilities ?? null;
        }
        break;
      }
    }
  }

  // ─── Colour analysis (merged from both analyzers) ───────────

  if (colourChannels.length > 0) {
    // RGB detection (from dmx-channel.ts — using buildRgbSegments)
    const hasRgbStart = colourChannels.some(c => startsWithRgb.test(c.name));
    const hasRgbWords = colourChannels.some(c => isRed.test(c.name))
      && colourChannels.some(c => isGreen.test(c.name))
      && colourChannels.some(c => isBlue.test(c.name));
    const hasRgbNames = (hasRgbStart || hasRgbWords) && colourChannels.length >= 3;
    const hasColorCaps = colourChannels.some(c => c.caps?.some(cap => cap.color));

    if (hasRgbNames) {
      // Use buildRgbSegments from dmx-color.ts (from dmx-channel.ts)
      fa.rgbSegments = buildRgbSegments(colourChannels);
      // Also compute simple rgbOffsets for dmx-cues.ts consumers
      const rIdx = colourChannels.findIndex(c => !/\bfine\b/i.test(c.name) && /red|\br\b/i.test(c.name));
      const gIdx = colourChannels.findIndex(c => !/\bfine\b/i.test(c.name) && /green|\bg\b/i.test(c.name));
      const bIdx = colourChannels.findIndex(c => !/\bfine\b/i.test(c.name) && /blue|\bb\b/i.test(c.name));
      if (rIdx >= 0 && gIdx >= 0 && bIdx >= 0) {
        fa.rgbOffsets = [colourChannels[rIdx].offset, colourChannels[gIdx].offset, colourChannels[bIdx].offset];
      } else {
        fa.rgbOffsets = colourChannels.slice(0, 3).map(c => c.offset);
      }
    } else if (hasColorCaps) {
      // Color wheel with capabilities. Si plusieurs canaux portent des caps
      // colorisées (ex. laser : canal « COLOR » + canaux de contrôle dont la
      // def colorise les caps), on préfère le canal au nom EXPLICITEMENT
      // couleur/roue — sinon un « Angle Control » serait choisi comme roue.
      const wheel =
        colourChannels.find(c => /\b(color|colour|wheel|cto|amber|hue|saturation|kelvin|white)\b/i.test(c.name) && c.caps?.some(cap => cap.color)) ||
        colourChannels.find(c => c.caps?.some(cap => cap.color));
      if (wheel) {
        fa.wheelOffset = wheel.offset;
        fa.wheelCaps = enrichWheelCaps(wheel.caps ?? []);
      }
    } else if (colourChannels.filter((c) => !COLOUR_AUX_RE.test(c.name)).length >= 3) {
      // Fallback: treat first 3 as RGB (hors canaux de rotation/mouvement —
      // un « Red Laser Rotation » ne doit pas devenir le 3e canal RGB).
      const plainColours = colourChannels.filter((c) => !COLOUR_AUX_RE.test(c.name));
      fa.rgbSegments = buildRgbSegments(plainColours);
      if (fa.rgbSegments.length === 0) {
        fa.rgbSegments = [{ r: plainColours[0].offset, g: plainColours[1].offset, b: plainColours[2].offset, w: null }];
      }
      fa.rgbOffsets = plainColours.slice(0, 3).map(c => c.offset);
    } else if (colourChannels.length === 1) {
      // Single color channel — treat as wheel
      fa.wheelOffset = colourChannels[0].offset;
      const ch = channels.find((c, idx) => (c.offset ?? idx) === colourChannels[0].offset);
      if (ch?.capabilities && ch.capabilities.length > 0) {
        fa.wheelCaps = enrichWheelCaps(ch.capabilities);
      }
    }
  }

  // Fill wheelCaps if wheelOffset is set but caps are empty (from dmx-channel.ts)
  if (fa.wheelOffset !== null && fa.wheelCaps.length === 0) {
    const ch = channels.find((c, idx) => (c.offset ?? idx) === fa.wheelOffset);
    if (ch?.capabilities && ch.capabilities.length > 0) {
      fa.wheelCaps = enrichWheelCaps(ch.capabilities);
    }
  }

  // ── Lasers 2 canaux couleur (Galaxian 3D : « Red Laser » + « Green Laser »,
  // typés Shutter dans l'OFL, capturés via isLaserColorNamed plus haut) ──
  // Détection par nom en excluant les canaux de rotation/mouvement ; n'entre
  // jamais en conflit avec une roue ou des segments RGB déjà résolus.
  if (fa.isLaser && fa.wheelOffset === null && fa.rgbSegments.length === 0) {
    const plainColours = colourChannels.filter((c) => !COLOUR_AUX_RE.test(c.name));
    const red = plainColours.find((c) => isRed.test(c.name));
    const green = plainColours.find((c) => isGreen.test(c.name));
    const blue = plainColours.find((c) => isBlue.test(c.name));
    if (red && green) fa.rgbOffsets = [red.offset, green.offset];
    else if (red && blue) fa.rgbOffsets = [red.offset, blue.offset];
    else if (green && blue) fa.rgbOffsets = [green.offset, blue.offset];
  }

  // ── Laser post-processing ──
  fa.laserColorMode = fa.rgbOffsets !== null ? 'rgb' : fa.wheelOffset !== null ? 'wheel' : 'none';
  // Canaux Pattern sans capabilities (EL-400/CS-1000) → synthèse de 8 motifs.
  if (fa.patternOffset !== null && (fa.patternCaps.length === 0 || (fa.patternCaps.length === 1 && fa.patternCaps[0].max - fa.patternCaps[0].min >= 255))) {
    fa.patternCaps = synthPatternCaps(8);
  }

  

  return fa;
}

// ─── Adaptateurs de compatibilité ──────────────────────────────

/**
 * Adaptateur rétro-compatible pour les consommateurs de dmx-channel.ts.
 * Retourne la même analyse complète — l'ancienne interface ChannelAnalysis
 * est maintenant un alias de FixtureChannelAnalysis.
 */
export function analyzeChannels(pf: PatchedFixture, def: DmxFixtureDefinition | undefined): ChannelAnalysis {
  return analyzeFixtureChannels(pf, def);
}

/**
 * Adaptateur rétro-compatible pour les consommateurs de dmx-cues.ts.
 * Retourne la même analyse complète.
 */
export function analyzeFixture(pf: PatchedFixture, def: DmxFixtureDefinition | undefined): FixtureChannelAnalysis {
  return analyzeFixtureChannels(pf, def);
}

/**
 * Remappe une valeur dimmer 0-255 dans la courbe d'intensité d'un canal
 * hybride « Dimmer/Strobe » (intensityCapRange non-nul). Reste en zone
 * intensité, jamais en zone strobe. Sans courbe : clamp simple 0-255.
 */
export function mapIntensityVal(raw: number, fa: FixtureChannelAnalysis): number {
  const v = Math.max(0, Math.min(255, raw));
  if (fa.intensityCapRange) {
    const { min, max } = fa.intensityCapRange;
    if (max <= min) return min;
    return min + Math.round((v / 255) * (max - min));
  }
  return v;
}
