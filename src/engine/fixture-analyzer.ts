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
import { RgbSegment, startsWithRgb, hasColorWord, isRed, isGreen, isBlue, isWhite, isPresetMode, buildRgbSegments, enrichWheelCaps, colorKeyOf } from './dmx-color';
import { nominalRoleOf, type NominalRole } from './fixture-routing';

// Canaux couleur auxiliaires à exclure du calcul RGB (rotation/mouvement…).
const COLOUR_AUX_RE = /rotation|rolling|move|movement|speed|scan|strobe|effect|macro/i;

/** Canaux de CONTRÔLE laser (« Angle Control », « CODE CONTROLE », « Waves
 *  Direction »...) : leur nom = contrôle, PAS couleur. Ces canaux ne
 *  doivent jamais devenir une roue couleur, même quand la def colorise
 *  TOUTES ses caps (cas TONIO LASER RGB ALIEN). « control\w* » et « code »
 *  couvrent les fautes du fabricant (« CONTROLE », « CODE CONTROLE »). */
const LASER_CONTROL_NAME_RE = /\b(angle|position|rotation|rotat|spin|movement|move|zoom|axis|scan|direction|control\w*|code)\b/i;

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
 * Un canal typé 'Shutter' est-il vraiment un shutter (ouverture/fermeture) ?
 *
 * Certaines defs typent « PATTERN SIZE » ou « GRAPHIC SIZE » en 'Shutter'
 * (erreur de saisie du fabricant) : l'écrire comme un shutter y injectait
 * des valeurs d'ouverture et modulait la taille du motif en boucle.
 * On exige soit un nom de shutter, soit des caps d'ouverture/fermeture.
 */
const SHUTTER_NAME_RE = /shutter|open|close|closed|aperture|diaphragm|iris|strobe|dimmer|gate/i;
const SHUTTER_CAP_RE = /\b(open|closed|close|shutter|dark|blackout|on|off)\b/i;
function isShutterLikeChannel(ch: DmxFixtureChannel): boolean {
  const name = (ch.name ?? '').trim();
  if (!name) return true;                       // sans nom : on respecte le type
  if (SHUTTER_NAME_RE.test(name)) return true;
  const caps = ch.capabilities ?? [];
  return caps.length > 0 && caps.every((c) => SHUTTER_CAP_RE.test(c.name ?? ''));
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

/**
 * Canaux de MODE / PROGRAMME : ils ne pilotent PAS la lumière mais lancent un
 * programme interne du fixture (AUTO, SOUND, RESET, PROGRAM, MAINTENANCE…) ou
 * une macro qui écrase notre pilotage. On ne les écrit JAMAIS : ils sont
 * seulement listés (presetOverrideOffsets) pour que l'audit les assume.
 *
 * « automatic » n'est PAS « auto » (\bauto\b) : « AUTOMATIC SCALING PATTERN »
 * est un vrai canal de pilotage, « AUTO MODE » est un programme interne.
 */
const MODE_PROGRAMME_RE =
  /\b(auto|sound|run|program|programme|reset|maintenance|setup|menu|calibrat|self[\s-]*test|macro|presets?|function|manual|mode|switch|power)\b/i;

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

/**
 * Type d'affichage d'un canal : les définitions (custom/OFL/GDTF) laissent
 * souvent `type` vide ou 'Nothing' alors que le moteur exploite le canal via
 * son NOM (Pattern Selection → motifs, Scanning Speed → vitesse, Red Laser →
 * couleur…). Dérive la fonction réelle pour l'affichage — même logique que
 * l'analyse par nom ci-dessous. AFFICHAGE SEUL : aucune influence sur le DMX.
 */
export function displayTypeForChannel(ch: { name?: string; type?: string }): string {
  const t = (ch.type || '').trim();
  if (t && t !== 'Nothing') return t;
  const n = (ch.name || '').toLowerCase();
  if (/scan/.test(n)) return 'Speed';
  if (/speed/.test(n)) return 'Speed';
  if (/pattern/.test(n)) return 'Gobo';
  if (/gobo/.test(n)) return 'Gobo';
  if (/strobe/.test(n)) return 'Strobe';
  if (/prism/.test(n)) return 'Prism';
  if (/zoom/.test(n)) return 'Zoom';
  if (/focus/.test(n)) return 'Focus';
  if (/iris/.test(n)) return 'Iris';
  if (/frost/.test(n)) return 'Frost';
  if (/dim|master/.test(n)) return 'Intensity';
  if (/shutter/.test(n)) return 'Shutter';
  if (/colou?r|red|green|blue|amber|uv|white/.test(n)) return 'Colour';
  if (/macro|mode|function|select/.test(n)) return 'Macro';
  return t || 'Nothing';
}

// ─── Interface unifiée ─────────────────────────────────────────

export interface FixtureChannelAnalysis {
  // Identité
  fixture: PatchedFixture;

  // Intensity
  intensityOffset: number | null;
  ledIntensityOffsets: number[];
  /** Canal « fine » du dimmer (16 bits) : il porte le LSB, pas la valeur
   *  grossière (sinon le dimmer n'a que 8 bits de résolution). */
  intensityFineOffset: number | null;
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
  /** Canaux « fine » appariés aux bras (index parallèle à panOffsets).
   *  null = ce bras n'a pas de canal fine (mouvement 8 bits). */
  panFineOffsets: Array<number | null>;
  tiltOffset: number | null;
  tiltFineOffset: number | null;
  tiltOffsets: number[];
  /** Canaux « fine » appariés aux bras (index parallèle à tiltOffsets). */
  tiltFineOffsets: Array<number | null>;

  // Gobo
  goboOffset: number | null;
  goboCaps: DmxFixtureCapability[];

  // Beam
  zoomOffset: number | null;
  zoomCaps: DmxFixtureCapability[];
  frostOffset: number | null;
  frostCaps: DmxFixtureCapability[];
  irisOffset: number | null;
  irisCaps: DmxFixtureCapability[];
  focusOffset: number | null;
  focusCaps: DmxFixtureCapability[];
  beamOffset: number | null;

  // Autres
  prismOffset: number | null;
  prismCaps: DmxFixtureCapability[];
  speedOffset: number | null;
  /** TOUS les canaux de vitesse (plusieurs fixtures en ont 2 : pan/tilt +
   *  couleur/effet). Le premier reste `speedOffset` (compatibilité). */
  speedOffsets: number[];
  /** Canaux à capacités qui n'ont pas de rôle dédié : ils recevront une
   *  valeur DÉTERMINISTE (état connu de la fixture) au lieu d'être laissés
   *  indéfinis (la fixture garderait un état arbitraire). */
  capabilityChannels: Array<{ offset: number; caps: DmxFixtureCapability[] }>;
  /** Canaux dont le rôle est déduit du LIBELLÉ (le type déclaré par la def est
   *  souvent `Nothing` ou faux). Politique d'écriture : cf. fixture-routing. */
  nominalChannels: Array<{ offset: number; caps: DmxFixtureCapability[]; role: NominalRole }>;
  /** Mélangeurs CMY (cyan / magenta / yellow) : la couleur se calcule en
   *  soustractif (C=255-R, M=255-G, Y=255-B) → une fixture CMY devient
   *  pilotable en couleur au lieu d'être ignorée. */
  cmyOffsets: { c: number | null; m: number | null; y: number | null };
  /** Pixels blancs autonomes (canaux blancs sans triplet RGB associé). */
  whitePixels: number[];
  /** Canaux couleur HORS segment dont la couleur existe déjà dans le RGB
   *  principal de la fixture (ex. « Green 2 (inner leds) » d'un Par à 2
   *  zones) : ils reçoivent la MÊME composante de la palette → la 2e zone
   *  est allumée dans la couleur du show au lieu de rester noire. */
  extraColourChannels: Array<{ offset: number; key: 'r' | 'g' | 'b' }>;
  /** Canaux COULEUR auxiliaires (caps colorisées) sans rôle dédié : LED
   *  orange / violet / bleu de fond d'une RGB+ (Chauvet Ovation F-915VW :
   *  « Orange », « Royal Blue », « Lime »), ou « Red + Orange Dimmer ».
   *  Ils sont ÉCRITS à 0 (éteints) et JAMAIS à une valeur de cap : les
   *  allumer ajouterait une couleur non demandée et modifierait la couleur
   *  du show, qui est validée par l'utilisateur. */
  auxColourChannels: number[];
  /** Canaux « fine » (sous-résolution 16 bits) appariés à leur canal COARSE
   *  par proximité de libellé (« Zoom fine » → « Zoom », « White Pixel null
   *  fine » → « White Pixel null »). Le fine porte le LSB de la valeur du
   *  coarse ; sans appariement il restait figé à une valeur arbitraire. */
  finePairs: Array<{ fineOffset: number; coarseOffset: number }>;
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
  /** Canaux couleur de LASER (« Red laser », « Green laser »…) : ce sont des
   *  GATES ouvert/fermé. Ils ne doivent jamais recevoir une valeur continue
   *  (sinon on tombe dans la zone fermée / stroboscope de la def). */
  laserGateOffsets: Array<{ offset: number; key: 'r' | 'g' | 'b' | 'w' }>;
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
  /** Plages mécaniques réelles (QXF <Physical> PanMax/TiltMax, degrés).
   *  Absentes → convention 540/180 (décodage 3D historique). */
  panMaxDeg: number;
  tiltMaxDeg: number;
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
 * Choisit le cap « Mode » d'un laser : priorité DMX > dynamic > manual >
 * premier cap pilotable > auto > cap synthétique.
 *
 * On n'atteint « auto » qu'en dernier recours : un cap AUTO = le laser rejoue
 * son programme interne (couleur et mouvement ignorent notre palette).
 * Les caps « closed / off / rien » sont exclus du choix pilotable.
 */
export function pickLaserModeCap(caps: DmxFixtureCapability[]): DmxFixtureCapability {
  const byName = (re: RegExp) => caps.find((c) => re.test(c.name ?? ''));
  const isDead = (c: DmxFixtureCapability) =>
    /auto|sound|closed|closure|off|rien|nothing|no\s*function|stand\s*alone/i.test(c.name ?? '');
  return (
    byName(/dmx|dynamic|manual/i) ??
    caps.find((c) => !isDead(c)) ??
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
   // Les LED bars (GigBar 2, etc.) peuvent avoir un canal "Laser" dans leur mode
   // mais ce sont avant tout des barres LED — ne pas les classifier comme lasers.
   if (norm.includes('ledbar') || norm.includes('led_bar') || norm.includes('ledbar')) return false;
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
    intensityFineOffset: null,
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
    panFineOffsets: [],
    tiltOffset: null,
    tiltFineOffset: null,
    tiltOffsets: [],
    tiltFineOffsets: [],
    goboOffset: null,
    goboCaps: [],
    zoomOffset: null,
    zoomCaps: [],
    frostOffset: null,
    frostCaps: [],
    irisOffset: null,
    irisCaps: [],
    focusOffset: null,
    focusCaps: [],
    beamOffset: null,
    prismOffset: null,
    prismCaps: [],
    speedOffset: null,
    speedOffsets: [],
    capabilityChannels: [],
    nominalChannels: [],
    cmyOffsets: { c: null, m: null, y: null },
    whitePixels: [],
    extraColourChannels: [],
    auxColourChannels: [],
    finePairs: [],
    macroOffsets: [],
    presetOverrideOffsets: [],
    isLaser,
    laserColorMode: 'none',
    laserModeOffset: null,
    laserModeCaps: [],
    laserColorGateOffset: null,
    laserColorGateCaps: [],
    laserGateOffsets: [],
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
    // Plages mécaniques : QXF <Physical> (per-mode sinon global), défauts 540/180
    panMaxDeg: (def?.modes[pf.modeIndex]?.physical?.panMax ?? def?.physical?.panMax ?? 540),
    tiltMaxDeg: (def?.modes[pf.modeIndex]?.physical?.tiltMax ?? def?.physical?.tiltMax ?? 180),
  };

  const colourChannels: Array<{ offset: number; name: string; caps?: DmxFixtureCapability[] }> = [];

  // ── Collecte pan/tilt ─────────────────────────────────────────
  // Les canaux « fine » sont APPARIÉS au coarse qui les précède
  // (convention DMX : coarse, fine, coarse, fine…) → 16 bits par axe.
  // Sans cet appariement, une tête multi-bras n'a qu'un canal fine pour
  // plusieurs bras (mouvement crénelé, bras figé).
  const panCoarse: Array<{ off: number; idx: number }> = [];
  const panFine: Array<{ off: number; idx: number }> = [];
  const tiltCoarse: Array<{ off: number; idx: number }> = [];
  const tiltFine: Array<{ off: number; idx: number }> = [];

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

    // ── Sélecteurs de PROGRAMME interne (hors laser) ────────────────
    // Un canal « Program » / « Mode » / « Auto » / « Run » lance un programme
    // INTERNE de la fixture : l'écrire (255) déclencherait un reset ou un
    // mode auto qui écrase notre pilotage couleur/mouvement. Il doit donc
    // être écarté AVANT le switch par type — sinon un canal « Program » typé
    // Shutter atterrissait dans beamOffset et recevait une valeur de largeur
    // de faisceau (commande qui n'a rien à voir).
    //
    // La règle est ANCRÉE EN DÉBUT de nom (pas un simple mot n'importe où) :
    // « Dimmer Mode », « Color Mix Mode » restent au switch générique et sont
    // filtrés par la passe finale (mêmes issues, sans risque de voler un
    // canal de pilotage à un sélecteur).
    //
    // Exception : un canal qui porte des caps COLORÉES est un vrai canal
    // couleur (roue) → il reste exploitable.
    const PROGRAM_SELECTOR_RE =
      /^\s*(auto|sound|run|running|program|programme|reset|maintenance|setup|menu|calibration|self[\s-]*test|manual|stand\s*alone|factory|service|display|operating|dmx|show)\b/i;
    if (!isLaser && PROGRAM_SELECTOR_RE.test(chName)
      && !ch.capabilities?.some(cap => cap.color)) {
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
 *  roue couleur — même quand leur def colorise leurs caps.
 *  « control\w* » et « code » couvrent les fautes du fabricant
 *  (« CONTROLE », « CODE CONTROLE »). */
const LASER_MOTION_NAME_RE = /\b(angle|position|rotation|rotat|spin|movement|move|zoom|axis|scan|direction|control\w*|code)\b/i;

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
      // Canal couleur de LASER (« Red laser », « Green laser ») : ce sont des
      // GATES (ouvert/fermé) → ils ne doivent pas recevoir une valeur
      // continue (zone fermée / stroboscope selon la def).
      if (isLaser && /laser/i.test(chName)) {
        const key = colorKeyOf(chName);
        if (key === 'r' || key === 'g' || key === 'b' || key === 'w') {
          fa.laserGateOffsets.push({ offset: off, key });
        }
      }
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
        // Si l'axe est DÉJÀ pris (« VERTICAL ANGLE » avant « VERTICAL
        // POSITION »), le canal n'est PAS un axe : c'est un sélecteur
        // (« position » vs « mouvement ») → on le laisse à la passe finale
        // (état déterministe). Le marquer « matched » le faisait perdre.
        if (fa.scanXOffset === null) { fa.scanXOffset = off; matched = true; }
      } else if (/vertical.*(angle|movement|position)|move.*verti/i.test(chName)) {
        if (fa.scanYOffset === null) { fa.scanYOffset = off; matched = true; }
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

    // ── Canaux pan/tilt « fine » et pan/tilt typés 'Nothing' ────────
    // Beaucoup de defs (OFL, QLC+, GDTF) typent les canaux de sous-résolution
    // « Pan fine » / « Tilt fine » en 'Nothing' : ils passaient sous le
    // radar et la tête ne bougeait qu'en 8 bits (crénelage visible).
    const isFineName = /\bfine\b/i.test(chName);
    const isSpeedName = /speed/i.test(chName);
    const mentionsPan = /\bpan\b/i.test(chName);
    const mentionsTilt = /\btilt\b/i.test(chName);
    if (isFineName && !isSpeedName && (mentionsPan || mentionsTilt)) {
      if (mentionsPan) panFine.push({ off, idx: i });
      else tiltFine.push({ off, idx: i });
      continue;
    }
    // Pan/tilt coarse mais typé 'Nothing' (« Pan », « Tilt », « Pan 1 »…).
    // Les noms composés (« Pan/Tilt Speed ») sont exclus : c'est une vitesse.
    if (!isSpeedName && ch.type !== 'Pan' && /^pan(\s*\d+)?$/i.test(chName)) {
      panCoarse.push({ off, idx: i });
      continue;
    }
    if (!isSpeedName && ch.type !== 'Tilt' && /^tilt(\s*\d+)?$/i.test(chName)) {
      tiltCoarse.push({ off, idx: i });
      continue;
    }

    switch (ch.type) {
      case 'Intensity':
        if (fa.intensityOffset === null) {
          fa.intensityOffset = off;
        } else if (isFineName) {
          // « Dimmer fine » : c'est le LSB du dimmer (16 bits), pas une tête
          // supplémentaire → il ne doit pas recevoir la valeur grossière.
          if (fa.intensityFineOffset === null) fa.intensityFineOffset = off;
        } else {
          fa.ledIntensityOffsets.push(off);
        }
        break;
      case 'Shutter':
      case 'Strobe':
        if (isStrobeNamedChannel(ch)) {
          if (fa.strobeOffset === null) { fa.strobeOffset = off; fa.strobeCaps = ch.capabilities ?? null; }
        } else if (isShutterLikeChannel(ch)) {
          if (fa.shutterOffset === null) fa.shutterOffset = off;
        } else if (fa.beamOffset === null) {
          // Canal typé Shutter mais nommé autrement (« PATTERN SIZE » du
          // TONIO LASER 4W) : ce n'est PAS un shutter — l'écrire comme tel
          // pilotait la taille du motif avec des valeurs d'ouverture.
          fa.beamOffset = off;
        }
        break;
      case 'Effect': {
        // Un canal typé Effect mais nommé « Prism Rotation », « Gobo
        // Rotation »… est une ROTATION, pas un effet générique : on le
        // laisse passer à la passe NOMINALE (qui l'anime) au lieu de le
        // figer sur une valeur « effet » constante.
        if (nominalRoleOf(chName, false) === 'rotate') break;
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
        if (isSpeedName) {
          // « Pan/Tilt Speed » typé Pan : c'est une vitesse, pas un bras.
          if (fa.speedOffset === null) fa.speedOffset = off;
          fa.speedOffsets.push(off);
          break;
        }
        if (isFineName) { panFine.push({ off, idx: i }); break; }
        panCoarse.push({ off, idx: i });
        break;
      case 'Tilt':
        if (isSpeedName) {
          if (fa.speedOffset === null) fa.speedOffset = off;
          fa.speedOffsets.push(off);
          break;
        }
        if (isFineName) { tiltFine.push({ off, idx: i }); break; }
        tiltCoarse.push({ off, idx: i });
        break;
      case 'Gobo':
        // Un canal « fine » (sous-résolution 16 bits) ne doit JAMAIS devenir
        // le primaire : il est apparié à son coarse par la passe d'appariement.
        if (!isFineName && fa.goboOffset === null) {
          fa.goboOffset = off;
          fa.goboCaps = ch.capabilities ?? [];
        }
        break;
      case 'Prism':
        if (!isFineName && fa.prismOffset === null) {
          fa.prismOffset = off;
          fa.prismCaps = ch.capabilities ?? [];
        }
        break;
      case 'Zoom':
        if (!isFineName && fa.zoomOffset === null) { fa.zoomOffset = off; fa.zoomCaps = ch.capabilities ?? []; }
        break;
      case 'Frost':
        if (!isFineName && fa.frostOffset === null) { fa.frostOffset = off; fa.frostCaps = ch.capabilities ?? []; }
        break;
      case 'Focus':
        if (!isFineName && fa.focusOffset === null) { fa.focusOffset = off; fa.focusCaps = ch.capabilities ?? []; }
        break;
      case 'Iris':
        if (!isFineName && fa.irisOffset === null) { fa.irisOffset = off; fa.irisCaps = ch.capabilities ?? []; }
        break;
      case 'Speed':
        if (fa.speedOffset === null) fa.speedOffset = off;
        fa.speedOffsets.push(off);
        break;
      case 'Beam': {
        // Les fixtures réelles typent zoom/frost/iris/focus en 'Beam' (GDTF
        // BeamZoom/BeamFocus/… → 'Beam'). On route par nom vers l'offset dédié ;
        // sinon on conserve beamOffset (fallback générique).
        // Un canal « fine » (16 bits) n'est JAMAIS le primaire : il est
        // apparié à son coarse (« Zoom » / « Zoom Fine (16bit) »).
        //
        // FALLBACK CAPACITÉS : quand le libellé du canal est générique
        // (« Beam 1 », « Optique »), on regarde les NOMS des capacités : l'OFL
        // y conserve le type exact de la capability (« Zoom », « Frost »,
        // « Focus », « Iris »). Sans ce fallback, ces canaux tombaient dans
        // beamOffset (rôle générique) et n'étaient pas pilotés par leur
        // paramètre dédié.
        const beamRole = !isFineName
          ? (/\bzoom\b/.test(chNameLower) ? 'zoom'
            : /\bfrost\b/.test(chNameLower) ? 'frost'
            : /\biris\b/.test(chNameLower) ? 'iris'
            : /\bfocus\b/.test(chNameLower) ? 'focus'
            : (ch.capabilities ?? []).some(c => /\bzoom\b/i.test(c.name ?? '')) ? 'zoom'
            : (ch.capabilities ?? []).some(c => /\bfrost\b/i.test(c.name ?? '')) ? 'frost'
            : (ch.capabilities ?? []).some(c => /\biris\b/i.test(c.name ?? '')) ? 'iris'
            : (ch.capabilities ?? []).some(c => /\bfocus\b/i.test(c.name ?? '')) ? 'focus'
            : null)
          : null;
        if (beamRole === 'zoom') {
          if (fa.zoomOffset === null) { fa.zoomOffset = off; fa.zoomCaps = ch.capabilities ?? []; }
        } else if (beamRole === 'frost') {
          if (fa.frostOffset === null) { fa.frostOffset = off; fa.frostCaps = ch.capabilities ?? []; }
        } else if (beamRole === 'iris') {
          if (fa.irisOffset === null) { fa.irisOffset = off; fa.irisCaps = ch.capabilities ?? []; }
        } else if (beamRole === 'focus') {
          if (fa.focusOffset === null) { fa.focusOffset = off; fa.focusCaps = ch.capabilities ?? []; }
        } else if (fa.beamOffset === null) {
          fa.beamOffset = off;
        }
        break;
      }
      case 'Macro': {
        // Macro non-couleur porteur de capacités (prism/gobo/effect/speed
        // macro). Les macros COULEUR sont déjà routées via colourChannels
        // (hasColorCaps → roue). On route par nom ; une macro SANS nom
        // reconnu (« BEE EYE MOTOR », « CHOICE COLOR »…) n'est PAS un effet :
        // elle est laissée à la passe finale (canal à capacités → état
        // déterministe). L'ancien fallback la pilotait comme un effet
        // générique → elle recevait des valeurs de macro incontrôlées.
        if (/\bprism\b/i.test(chName)) {
          if (fa.prismOffset === null) { fa.prismOffset = off; fa.prismCaps = ch.capabilities ?? []; }
        } else if (/\bgobo\b/i.test(chName)) {
          if (fa.goboOffset === null) { fa.goboOffset = off; fa.goboCaps = ch.capabilities ?? []; }
        } else if (/\beffect\b/i.test(chName)) {
          if (fa.effectOffset === null) { fa.effectOffset = off; fa.effectCaps = ch.capabilities ?? null; }
        } else if (/\bspeed\b/i.test(chName)) {
          if (fa.speedOffset === null) fa.speedOffset = off;
          fa.speedOffsets.push(off);
        }
        break;
      }
    }
  }

  // ── Appariement pan/tilt coarse ↔ fine ─────────────────────────
  // Convention DMX : le canal « fine » suit son canal coarse. On apparie
  // donc chaque fine au coarse le plus RÉCENT qui le précède → 16 bits par
  // axe ET par bras.
  //
  // Attention : l'appariement par « premier coarse suivant » était faux
  // pour les bras incomplets (« Pan », « Pan 2 », « Pan 2 fine ») : le fine
  // du 2ᵉ bras était attribué au 1ᵉᵉ bras → le bras 1 recevait une
  // sous-résolution qui n'était pas la sienne, et le bras 2 bougeait en
  // 8 bits (crénelage).
  const pairAxes = (
    coarse: Array<{ off: number; idx: number }>,
    fine: Array<{ off: number; idx: number }>,
  ): Array<number | null> => {
    const paired: Array<number | null> = coarse.map(() => null);
    const used = new Set<number>();
    for (const f of fine) {
      // Coarse le plus récent qui précède ce fine.
      let best = -1;
      for (let i = 0; i < coarse.length; i++) {
        if (coarse[i].idx < f.idx && (best < 0 || coarse[i].idx > coarse[best].idx)) best = i;
      }
      if (best >= 0 && paired[best] === null) {
        paired[best] = f.off;
        used.add(f.idx);
      }
    }
    // Fines sans coarse correspondant (canal 16 bits orphelin) : conservés
    // à la suite pour qu'ils ne soient jamais perdus.
    for (const f of fine) if (!used.has(f.idx)) paired.push(f.off);
    return paired;
  };
  fa.panOffsets = panCoarse.map(c => c.off);
  fa.panFineOffsets = pairAxes(panCoarse, panFine);
  fa.tiltOffsets = tiltCoarse.map(c => c.off);
  fa.tiltFineOffsets = pairAxes(tiltCoarse, tiltFine);
  fa.panOffset = fa.panOffsets.length > 0 ? fa.panOffsets[0] : null;
  fa.tiltOffset = fa.tiltOffsets.length > 0 ? fa.tiltOffsets[0] : null;
  fa.panFineOffset = fa.panFineOffsets.find((o): o is number => o !== null) ?? null;
  fa.tiltFineOffset = fa.tiltFineOffsets.find((o): o is number => o !== null) ?? null;

  // ── Mélangeurs CMY (cyan / magenta / yellow) ─────────────────────
  // ATTENTION : ce bloc doit précéder l'analyse RGB. Une fixture CMY
  // (ex. Ayrton Domino : Cyan, Magenta, Yellow) n'a PAS de triplet RGB :
  // sans ce retrait, les 3 canaux tombaient dans le fallback « 3 premiers
  // canaux couleur = RGB » → la fixture affichait du CYAN sur le canal
  // ROUGE (couleur complètement fausse) et le moteur pilotait trois canaux
  // sans rapport.
  {
    const lower = (n: string) => (n ?? '').trim().toLowerCase();
    // Un mélangeur CMY porte un mot-couleur explicite, éventuellement
    // composé (« Cyan Color », « Magenta Color », « Yellow »…). Les canaux
    // « fine » sont exclus : ce sont les LSB 16 bits de leur coarse
    // (appariés par la passe d'appariement fine↔coarse).
    const cmyKeyOf = (n: string): 'c' | 'm' | 'y' | null => {
      const s = lower(n);
      if (/\bfine\b/.test(s)) return null;
      if (/\bcyan\b/.test(s)) return 'c';
      if (/\bmagenta\b/.test(s)) return 'm';
      if (/\b(yellow|lime)\b/.test(s)) return 'y';
      return null;
    };
    const cmyCandidates = colourChannels.filter(c => cmyKeyOf(c.name) !== null);
    // Un canal qui porte des caps COLORÉES est une ROUE (sélecteur de
    // couleur) et non un mélangeur CMY.
    const mixers = cmyCandidates.filter(c => !(c.caps ?? []).some(cap => cap.color));
    const cCh = mixers.find(x => cmyKeyOf(x.name) === 'c');
    const mCh = mixers.find(x => cmyKeyOf(x.name) === 'm');
    const yCh = mixers.find(x => cmyKeyOf(x.name) === 'y');
    if ((cCh && mCh) || (cCh && yCh) || (mCh && yCh)) {
      fa.cmyOffsets = { c: cCh?.offset ?? null, m: mCh?.offset ?? null, y: yCh?.offset ?? null };
      // On retire les canaux CMY de la liste couleur : ils ne doivent PAS
      // devenir un segment RGB.
      for (const cand of cmyCandidates) {
        const idx = colourChannels.indexOf(cand);
        if (idx >= 0) colourChannels.splice(idx, 1);
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
      // Also compute simple rgbOffsets for dmx-cues.ts consumers.
      // On passe par colorKeyOf (PAS par une regex sur le texte) : « B EYE
      // RED » matchait /\br\b/ → le triplet simple pointait sur le canal
      // ROUGE (au lieu du bleu), et le canal bleu n'était jamais piloté.
      //
      // On PRÉFÈRE le nom EXACT (« Blue ») au nom composé (« Royal Blue ») :
      // colorKeyOf('Royal Blue') = 'b' (dernier mot-couleur) → sans cette
      // préférence, le triplet simple pointait sur « Royal Blue » au lieu du
      // vrai bleu, et le canal « Royal Blue » était ensuite clamé comme
      // « canal couleur piloté » alors qu'il ne l'est pas.
      const EXACT_WORD: Record<'r' | 'g' | 'b', RegExp> = {
        r: /^red\s*\d*$/i,
        g: /^green\s*\d*$/i,
        b: /^blue\s*\d*$/i,
      };
      // Le triplet simple DOIT provenir d'UN SEUL segment : sinon on
      // MÉLANGE deux engines couleur d'une même fixture (ETC Source Four
      // « RGB Plus 7 » : « Red » du moteur Plus 7 + « Green Emulated » +
      // « Blue » du moteur Plus 7 → la couleur demandée partait dans deux
      // engines différents, la teinte affichée n'était PAS celle de la
      // palette, et le canal bleu du moteur principal restait muet).
      //
      // On prend donc le 1ᵉʳ segment COMPLET (R+G+B) ; à l'intérieur de ce
      // segment, le nom EXACT (« Blue ») prime sur le nom composé
      // (« Royal Blue »).
      const seg = fa.rgbSegments.find(s => s.r !== null && s.g !== null && s.b !== null)
        ?? fa.rgbSegments[0];
      if (seg && seg.r !== null && seg.g !== null) {
        const inSeg = new Set<number>(
          [seg.r, seg.g, seg.b].filter((v): v is number => v !== null),
        );
        const exact = (key: 'r' | 'g' | 'b') => colourChannels.find(
          c => !/\bfine\b/i.test(c.name)
            && inSeg.has(c.offset)
            && EXACT_WORD[key].test((c.name ?? '').trim()),
        );
        const rOff = exact('r')?.offset ?? seg.r;
        const gOff = exact('g')?.offset ?? seg.g;
        const bOff = seg.b !== null ? (exact('b')?.offset ?? seg.b) : null;
        fa.rgbOffsets = bOff !== null ? [rOff, gOff, bOff] : [rOff, gOff];
      }
    } else if (hasColorCaps) {
      // Color wheel with capabilities. Si plusieurs canaux portent des caps
      // colorisées (ex. laser : canal « COLOR » + canaux de contrôle dont la
      // def colorise les caps), on préfère le canal au nom EXPLICITEMENT
      // couleur/roue — sinon un « Angle Control » serait choisi comme roue.
      // Le repli exclut les canaux de CONTRÔLE : « CODE CONTROLE » (faute du
      // fabricant pour « CODE CONTROL ») n'est pas une roue de couleur.
      const wheel =
        colourChannels.find(c => /\b(color|colour|wheel|cto|amber|hue|saturation|kelvin|white)\b/i.test(c.name) && c.caps?.some(cap => cap.color)) ||
        colourChannels.find(c => c.caps?.some(cap => cap.color) && !LASER_CONTROL_NAME_RE.test(c.name));
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
  if (fa.isLaser && fa.wheelOffset === null && fa.rgbSegments.length === 0) {
    const plainColours = colourChannels.filter((c) => !COLOUR_AUX_RE.test(c.name));
    const red = plainColours.find((c) => isRed.test(c.name));
    const green = plainColours.find((c) => isGreen.test(c.name));
    const blue = plainColours.find((c) => isBlue.test(c.name));
    if (red && green) fa.rgbOffsets = [red.offset, green.offset];
    else if (red && blue) fa.rgbOffsets = [red.offset, blue.offset];
    else if (green && blue) fa.rgbOffsets = [green.offset, blue.offset];
  }

  // ── Passe finale : aucun canal ne doit rester « muet » ─────────
  // Un canal sans rôle dédié garde sinon une valeur arbitraire (souvent
  // 0 = fermé) : le moteur lui écrira un état DÉTERMINISTE et connu.
  const claimed = new Set<number>();
  const claim = (o: number | null | undefined) => {
    if (o !== null && o !== undefined) claimed.add(o);
  };
  claim(fa.intensityOffset); fa.ledIntensityOffsets.forEach(claim);
  claim(fa.intensityFineOffset);
  claim(fa.shutterOffset); claim(fa.strobeOffset); claim(fa.effectOffset);
  claim(fa.wheelOffset); claim(fa.goboOffset); claim(fa.prismOffset);
  claim(fa.zoomOffset); claim(fa.frostOffset); claim(fa.irisOffset);
  claim(fa.focusOffset); claim(fa.beamOffset);
  fa.speedOffsets.forEach(claim);
  fa.panOffsets.forEach(claim); fa.panFineOffsets.forEach(claim);
  fa.tiltOffsets.forEach(claim); fa.tiltFineOffsets.forEach(claim);
  fa.rgbOffsets?.forEach(claim);
  for (const seg of fa.rgbSegments) {
    claim(seg.r); claim(seg.g); claim(seg.b); claim(seg.w); claim(seg.a); claim(seg.uv);
    // Canaux « fine » couleur (LSB 16 bits) : ils appartiennent au segment.
    claim(seg.rFine); claim(seg.gFine); claim(seg.bFine); claim(seg.wFine);
  }
  claim(fa.laserModeOffset); claim(fa.laserColorGateOffset); claim(fa.laserMasterOffset);
  claim(fa.patternOffset); claim(fa.scanXOffset); claim(fa.scanYOffset);
  claim(fa.laserSpeedScanOffset); claim(fa.laserSpeedPatternOffset); claim(fa.blankOffset);
  fa.laserRotationOffsets.forEach(claim);
  fa.presetOverrideOffsets.forEach(claim);
  fa.macroOffsets.forEach(claim);
  // Mélangeurs CMY : écrits par writeCmyChannels (couleur soustractive).
  claim(fa.cmyOffsets.c); claim(fa.cmyOffsets.m); claim(fa.cmyOffsets.y);

  // ── Appariement générique « fine » ↔ « coarse » ────────────────────
  // Règle : un canal « X fine » appartient au canal « X » qui le précède
  // (convention DMX 16 bits). On compare le libellé SANS le mot « fine » :
  // « Zoom fine » → « Zoom », « White Pixel null fine » → « White Pixel
  // null », « Dimmer 2 fine » → « Dimmer 2 ».
  //
  // Cette passe précède la passe NOMINALE : sinon un « Zoom Fine (16bit) »
  // serait capté comme rôle zoom (primaire) au lieu d'être le LSB du
  // « Zoom » — la tête recevrait sa valeur grossière sur l'octet de
  // sous-résolution (mouvement crénelé, paramètre figé).
  {
    const baseName = (n: string) => (n ?? '')
      .toLowerCase()
      .replace(/\bfine\b/g, ' ')
      .replace(/\b(coarse|16\s*bits?)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // On parcourt les canaux dans l'ordre DMX : le coarse le plus RÉCENT
    // portant le même libellé de base est le candidat (convention 16 bits).
    const lastCoarse = new Map<string, number>();
    for (let i = 0; i < channels.length; i++) {
      const ch = channels[i];
      const nm = (ch.name ?? '').trim();
      const off = ch.offset ?? i;
      if (!nm) continue;
      if (/\bfine\b/i.test(nm)) {
        if (claimed.has(off)) continue;
        const base = baseName(nm);
        const coarseOff = lastCoarse.get(base);
        if (coarseOff === undefined || coarseOff === off) continue;
        fa.finePairs.push({ fineOffset: off, coarseOffset: coarseOff });
        claimed.add(off);
        continue;
      }
      const base = baseName(nm);
      if (base) lastCoarse.set(base, off);
    }
  }

  // ── Passe nominal : le LIBELLÉ du canal prime sur le type déclaré ──
  // Le type d'une def est très souvent `Nothing` (QLC+/OFL) ou faux
  // (« Zoom » typé Nothing, « Pan/Tilt Speed » typé Nothing…). Sans ce
  // routage, ces canaux ne recevaient JAMAIS de valeur : la tête bougeait
  // en 8 bits et à vitesse minimale, le zoom ne changeait jamais, la roue
  // de gobo ne tournait pas.
  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const off = ch.offset ?? i;
    if (claimed.has(off)) continue;
    const name = (ch.name ?? '').trim();
    const caps = ch.capabilities ?? [];
    const role = nominalRoleOf(name, /\bfine\b/i.test(name));
    if (!role) continue;

    switch (role) {
      case 'speed':
        // Vitesse : le PREMIER canal reste `speedOffset` (compatibilité),
        // les suivants rejoignent `speedOffsets` (déjà écrits par le moteur).
        if (fa.speedOffset === null) fa.speedOffset = off;
        fa.speedOffsets.push(off);
        break;
      case 'pan':
        panCoarse.push({ off, idx: i });
        break;
      case 'tilt':
        tiltCoarse.push({ off, idx: i });
        break;
      case 'zoom':
        if (fa.zoomOffset === null) { fa.zoomOffset = off; fa.zoomCaps = caps; }
        else fa.nominalChannels.push({ offset: off, caps, role });
        break;
      case 'focus':
        if (fa.focusOffset === null) { fa.focusOffset = off; fa.focusCaps = caps; }
        else fa.nominalChannels.push({ offset: off, caps, role });
        break;
      case 'frost':
        if (fa.frostOffset === null) { fa.frostOffset = off; fa.frostCaps = caps; }
        else fa.nominalChannels.push({ offset: off, caps, role });
        break;
      case 'iris':
        if (fa.irisOffset === null) { fa.irisOffset = off; fa.irisCaps = caps; }
        else fa.nominalChannels.push({ offset: off, caps, role });
        break;
      case 'prism':
        if (fa.prismOffset === null) { fa.prismOffset = off; fa.prismCaps = caps; }
        else fa.nominalChannels.push({ offset: off, caps, role });
        break;
      case 'gobo':
        if (fa.goboOffset === null) { fa.goboOffset = off; fa.goboCaps = caps; }
        else fa.nominalChannels.push({ offset: off, caps, role });
        break;
      case 'wheel':
        if (fa.wheelOffset === null) { fa.wheelOffset = off; fa.wheelCaps = caps; }
        else fa.nominalChannels.push({ offset: off, caps, role });
        break;
      case 'strobe':
        if (fa.strobeOffset === null) { fa.strobeOffset = off; fa.strobeCaps = caps ? caps : null; }
        else fa.nominalChannels.push({ offset: off, caps, role });
        break;
      case 'shutter':
        if (fa.shutterOffset === null) fa.shutterOffset = off;
        else fa.nominalChannels.push({ offset: off, caps, role });
        break;
      default:
        // rotate / white / cto / cmy : pas de champ primaire → liste dédiée.
        fa.nominalChannels.push({ offset: off, caps, role });
        break;
    }
    claimed.add(off);
  }

  // Les canaux pan/tilt routés par NOM sont ré-appariés (coarse ↔ fine).
  if (panCoarse.length > 0 || tiltCoarse.length > 0) {
    fa.panOffsets = panCoarse.map(c => c.off);
    fa.panFineOffsets = pairAxes(panCoarse, panFine);
    fa.tiltOffsets = tiltCoarse.map(c => c.off);
    fa.tiltFineOffsets = pairAxes(tiltCoarse, tiltFine);
    fa.panOffset = fa.panOffsets.length > 0 ? fa.panOffsets[0] : null;
    fa.tiltOffset = fa.tiltOffsets.length > 0 ? fa.tiltOffsets[0] : null;
    fa.panFineOffset = fa.panFineOffsets.find((o): o is number => o !== null) ?? null;
    fa.tiltFineOffset = fa.tiltFineOffsets.find((o): o is number => o !== null) ?? null;
  }

  // Canaux couleur BLANCS qui n'appartiennent à aucun segment RGB : pixels
  // blancs autonomes (barre à 25 pixels blancs + 1 triplet RGB, GLP-KNV-Arc).
  // Ils étaient laissés à 0 → la moitié de la fixture ne s'allumait jamais.
  {
    const usedColour = new Set<number>();
    for (const seg of fa.rgbSegments) {
      [seg.r, seg.g, seg.b, seg.w, seg.a, seg.uv, seg.rFine, seg.gFine, seg.bFine, seg.wFine]
        .forEach(o => { if (o !== null && o !== undefined) usedColour.add(o); });
    }
    for (const c of colourChannels) {
      if (usedColour.has(c.offset)) continue;
      if (colorKeyOf(c.name) === 'w') {
        fa.whitePixels.push(c.offset);
        // Claimé : les pixels blancs ont leur propre écriture
        // (writeWhitePixels) — ils ne doivent pas finir dans les canaux à
        // capacités « état déterministe » (double écriture contradictoire).
        claimed.add(c.offset);
      }
    }
  }

  // ── Canaux couleur « en doublon » d'une couleur déjà présente ──────
  // Exemple : Par à 2 zones « Red », « Green 1 (outer leds) », « Blue »,
  // « Amber », « Green 2 (inner leds) », « UV » → le 2e vert est un canal
  // de couleur réel de la fixture : sans lui, la zone interne reste noire.
  //
  // Règle : on ne PILOTE que les doublons d'une couleur DÉJÀ présente dans
  // le RGB principal (r/g/b). Les couleurs absentes du show (amber, UV,
  // lime) restent à 0 → on ne modifie JAMAIS la couleur validée.
  {
    const usedColour = new Set<number>();
    for (const seg of fa.rgbSegments) {
      [seg.r, seg.g, seg.b, seg.w, seg.a, seg.uv, seg.rFine, seg.gFine, seg.bFine, seg.wFine]
        .forEach(o => { if (o !== null && o !== undefined) usedColour.add(o); });
    }
    const mainKeys = new Set<'r' | 'g' | 'b'>();
    for (const seg of fa.rgbSegments) {
      mainKeys.add('r'); mainKeys.add('g');
      if (seg.b !== null) mainKeys.add('b');
    }
    if (fa.rgbOffsets) {
      if (fa.rgbOffsets[0] !== undefined) mainKeys.add('r');
      if (fa.rgbOffsets[1] !== undefined) mainKeys.add('g');
      if (fa.rgbOffsets[2] !== undefined) mainKeys.add('b');
    }
    const wheelOff = fa.wheelOffset;
    const gateOffs = new Set<number>(fa.laserGateOffsets.map(g => g.offset));
    if (fa.laserColorGateOffset !== null) gateOffs.add(fa.laserColorGateOffset);
    for (const c of colourChannels) {
      if (usedColour.has(c.offset)) continue;
      if (c.offset === wheelOff) continue;
      if (gateOffs.has(c.offset)) continue;
      if (claimed.has(c.offset)) continue;
      // Un canal de ROUE (caps colorisées) est un sélecteur, pas un LED.
      if ((c.caps ?? []).some(cap => cap.color)) continue;
      const key = colorKeyOf(c.name);
      if (key !== 'r' && key !== 'g' && key !== 'b') continue;
      // Un canal de TEMPERATURE de couleur (« Color Temp Blue », « CCT »)
      // n'est PAS un LED bleu : l'écrire décalerait la teinte.
      if (/\b(temp|temperature|cct|ctb|ctc|cto|correct|correction)\b/i.test(c.name)) continue;
      if (!mainKeys.has(key)) continue;
      fa.extraColourChannels.push({ offset: c.offset, key });
      claimed.add(c.offset);
    }
  }

  for (let i = 0; i < channels.length; i++) {
    const ch = channels[i];
    const off = ch.offset ?? i;
    if (claimed.has(off)) continue;
    const name = (ch.name ?? '').trim();
    const caps = ch.capabilities ?? [];
    // (1) Sélecteurs de mode / programme → JAMAIS écrits : ils lanceraient
    //     un programme interne, un RESET ou une macro qui écrase notre
    //     pilotage (couleur, mouvement). Ils restent tracés pour l'audit.
    if (MODE_PROGRAMME_RE.test(name)) {
      fa.presetOverrideOffsets.push(off);
      continue;
    }
    // (2) Macro utilisateur sans capacités : elle reste à l'utilisateur.
    if (ch.type === 'Macro' && caps.length === 0) {
      fa.macroOffsets.push(off);
      continue;
    }
    // (3) Canal à capacités sans rôle dédié → état déterministe écrit par
    //     le moteur (rotation, polarité, direction, taille de motif…).
    if (caps.length > 0) {
      // SAUF si le canal est un VRAI canal couleur à caps colorisées (LED
      // auxiliaire orange / violet, « Red + Orange Dimmer », « Intensity of
      // the blue LED background illumination »…).
      //
      // ATTENTION : certaines defs colorisent TOUTES leurs caps, y compris
      // des canaux de CONTRÔLE laser (« ANGLE CONTROLE », « HORIZONTAL
      // ROTATION », « CODE CONTROLE » du TONIO LASER RGB ALIEN). Ces
      // canaux ne sont pas des couleurs : les traiter comme des « couleur
      // auxiliaire » les éteignait (0) et figeait le laser. On exige donc
      // que le canal soit typé Colour OU que son NOM porte un mot-couleur.
      const isColourChannel = ch.type === 'Colour' || hasColorWord.test(name);
      if (isColourChannel && caps.some(cap => cap.color)) {
        // L'allumer, meme a 50 %, ajouterait une couleur non demandée → on
        // l'ÉTEINT explicitement (0) au lieu de lui donner un état « cap ».
        fa.auxColourChannels.push(off);
        claimed.add(off);
        continue;
      }
      fa.capabilityChannels.push({ offset: off, caps });
    }
  }

  // ── Laser post-processing ──
  // Le mode « gate » (canal couleur mono-canal dédié, ex. Showtec Dominator)
  // est DÉJÀ décidé par l'analyse : l'ancien code l'écrasait
  // inconditionnellement → la branche d'écriture du gate devenait
  // INATTEIGNABLE (canau laser muet).
  if (fa.laserColorMode !== 'gate') {
    fa.laserColorMode = fa.rgbOffsets !== null ? 'rgb' : fa.wheelOffset !== null ? 'wheel' : 'none';
  }
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
