// ─── Autoloop SoundSwitch 2.9 — Module 2 : générateur « Autoscript » ───────
//
// Port TypeScript pur (zéro dépendance React/Electron/`window`/stores/hooks)
// du module `generator.py` du prototype Python. Ce module ne fait qu'importer
// les types figés de `autoloop-types` (module 1) : il ne les redéfinit jamais.
//
// Clone de la fonction « Autoloop » de SoundSwitch 2.9 : à partir d'un jeu de
// cues (positions + attributs), d'une liste de fixtures et d'une catégorie
// cible, on produit une `AutoloopTimeline` — une timeline continue alignée sur
// les bars, remplie de keyframes DMX (`ChannelKey`) triés par `beat`.
//
// ALGORITHME — vue d'ensemble
// ---------------------------
// On construit d'abord un « plan » par beat (liste de slots temporels), puis on
// applique les contraintes (greedy LRU avec lookahead sur les couleurs), puis on
// linéarise le plan en `ChannelKey`.
//
//   1. Normalisation   : fusion des règles, filtrage des fixtures par catégorie.
//   2. Planification   : placement des cues sur la grille `targetBars * 4`
//                        beats (grille = 1 beat).
//      a. Couleurs     : un nouveau cue couleur au début de chaque bloc de
//                        `colorChangeEveryBars` bars, choisi par greedy LRU
//                        (jamais la même couleur à moins de
//                        `minColorRepeatBars` bars).
//      b. Attributs    : les cues non-couleur (gobo/focus/zoom/…) sont posés à
//                        des beats discrets espacés d'au moins 2 bars.
//   3. Linéarisation   : chaque cue → ChannelKey DMX ABSOLUES, une par
//                        (fixture, canal logique). Rampe → 2 clés
//                        (ancre + cible) ; snap → 1 clé.
//   4. Position        : chaque PositionCue est échantillonné par beat, pour
//                        chaque fixture de la catégorie, en pan/tilt
//                        (interpolation linéaire entre beats, rampBeats = 1).
//   5. Tri stable par beat.

import {
  AttributeCue,
  AutoloopTimeline,
  AutoloopFixture,
  ChannelKey,
  FixtureCategory,
  PositionCue,
  BEATS_PER_BAR,
  computePan,
  computeTilt,
} from './autoloop-types';

// ---------------------------------------------------------------------------
// Constantes publiques
// ---------------------------------------------------------------------------

/** Règles par défaut du générateur (fusionnées avec `rules` si fourni). */
export const DEFAULT_RULES = {
  minColorRepeatBars: 2,
  colorChangeEveryBars: 4,
} as const;

/**
 * Espacement minimal entre deux cues d'attribut non-couleur, en bars.
 *
 * (Correspond à `MIN_ATTRIBUTE_SPACING_BARS` du Python.)
 */
export const MIN_ATTRIBUTE_SPACING_BARS = 2;

/** Entrée du générateur : cues, fixtures et règles cibles d'un Autoloop. */
export interface AutoscriptInput {
  /** Durée cible du loop en bars (8/16/32/64/128 chez SoundSwitch ; ≥ 1 accepté). */
  targetBars: number;
  /** Fixtures disponibles (le générateur filtre par catégorie). */
  fixtures: AutoloopFixture[];
  /** Catégorie de fixtures ciblée par le loop. */
  category: FixtureCategory;
  /** Mouvements pan/tilt à matérialiser en keyframes. */
  positionCues: PositionCue[];
  /** Cues d'attribut (couleur, gobo, focus, zoom, …). */
  attributeCues: AttributeCue[];
  /**
   * Cues d'intensité (Control Track « dimmer ») : une « respiration » lumineuse.
   *
   * Contrairement aux AttributeCue (couleur/gobo/…), ces cues pilote le canal
   * logique `dimmer`/`intensity` avec une **rampe symétrique** (montée + descente)
   * qui produit un vrai effet de fondu, pas un snap. Elles sont réparties
   * uniformément sur le loop (≥ 1 bar d'écart) indépendamment des couleurs.
   * Aucune parmi elles n'est requise : si absente, le show reste en intensité
   * constante (comportement historique).
   */
  dimmerCues?: AttributeCue[];
  /**
   * Cues de strobe (Control Track « strobe ») : pics lumineux sur temps fort.
   *
   * Chaque cue écrit le canal logique `strobe`/`shutter` à 255 (plein flash) en
   * **snap** (interpolate interdit, les strobes ne balayent pas), placée aux
   * frontières de bar (beat multiple de 4). Aucune n'est requise : sans strobe,
   * les fixtures restent en continu (état historique).
   */
  strobeCues?: AttributeCue[];
  /** Surcharges de règles (fusionnées avec {@link DEFAULT_RULES}). */
  rules?: { minColorRepeatBars?: number; colorChangeEveryBars?: number };
  /**
   * Courbe d'énergie normalisée (0..1), une valeur par beat, pour une génération
   * **section-aware** : la cadence de changement de couleur s'accélère dans les
   * sections fortes (drop/chorus) et ralentit dans les calmes (intro/verse).
   * Absente → cadence uniforme (comportement historique, aucune régression).
   */
  energyCurve?: number[];
}

// ---------------------------------------------------------------------------
// État privé
// ---------------------------------------------------------------------------

/**
 * Compteur monotone d'identifiants de timelines (unicité intra-processus).
 *
 * Équivalent TypeScript de `itertools.count(1)` : chaque appel à
 * `generateAutoscript` consomme un id unique croissant.
 */
let idCounter = 1;

/**
 * Placement d'un cue sur la grille : un couple `(beat, cue)`.
 *
 * `beat` est un flottant (le pas de grille est de 1 beat, mais la répartition
 * uniforme des attributs non-couleur peut produire des beats fractionnaires).
 */
type Placement = [beat: number, cue: AttributeCue];

// ---------------------------------------------------------------------------
// Helpers privés
// ---------------------------------------------------------------------------

/**
 * Adresse DMX absolue (1-based) du canal logique pour une fixture.
 *
 * `fixture.address` est l'adresse de base (1-based) ; `channelMap` donne
 * l'*offset* (0-based) d'un attribut logique. L'adresse absolue vaut donc
 * `address + offset`. Retourne `null` si la fixture ne possède pas ce canal.
 */
function channelAddress(fixture: AutoloopFixture, logical: string): number | null {
  const offset = fixture.channelMap[logical];
  return offset === undefined ? null : fixture.address + offset;
}

/**
 * Planifie les cues couleur sur les frontières de blocs (règles « jamais la
 * même couleur sur 2 mesures consécutives » + « changement toutes les N bars »).
 *
 * Chaque bloc de `changeEveryBars` bars reçoit un cue couleur au début du bloc.
 * Le choix est un **greedy avec lookahead LRU** (Least Recently Used) :
 *
 * - candidates « légales » : `id ≠` couleur du bloc précédent ET non utilisée
 *   depuis moins de `minRepeatBars` bars (`blockBeat - lastUsed ≥ minGapBeats`) ;
 * - parmi elles on prend la **plus anciennement utilisée** (LRU) pour maximiser
 *   la marge avant sa prochaine réutilisation et réduire les impasses ;
 * - dégradation en 2 paliers : si aucune légale, on exige seulement
 *   « ≠ précédente » ; dernier recours (une seule couleur effective) on
 *   réutilise la première.
 *
 * L'espacement minimal entre deux occurrences d'une même couleur vaut
 * `minRepeatBars * BEATS_PER_BAR` beats.
 *
 * SECTION-AWARE (optionnel) : si `energyCurve` (énergie 0..1 par beat) est fourni,
 * la taille du bloc varie selon l'énergie locale — haute énergie (drop/chorus)
 * raccourcit le bloc (changement de couleur plus fréquent), basse énergie
 * (intro/verse) l'allonge. La cadence oscille entre `0.5 ×` et `2 ×` de
 * `changeEveryBars`, sans jamais descendre sous 1 bar (contrainte de lisibilité).
 *
 * @returns Liste de paires `(beat, cue)` ordonnées chronologiquement.
 */
function scheduleColors(
  colorCues: AttributeCue[],
  lengthBeats: number,
  minRepeatBars: number,
  changeEveryBars: number,
  energyCurve?: number[],
): Placement[] {
  if (colorCues.length === 0) return [];

  const placements: Placement[] = [];
  // Dernier beat où chaque couleur (par id) a été posée — contrainte de répétition.
  const lastUsed = new Map<string, number>();

  const minGapBeats = minRepeatBars * BEATS_PER_BAR;
  const baseBlockBeats = changeEveryBars * BEATS_PER_BAR;
  let previousId: string | null = null;

  /** Âge (dernier beat d'utilisation) d'une couleur ; `-Infinity` si jamais utilisée. */
  const age = (cue: AttributeCue): number =>
    lastUsed.get(cue.id) ?? Number.NEGATIVE_INFINITY;

  /** La cue d'âge minimal (LRU) ; conserve la première sur égalité, comme `min` en Python. */
  const oldest = (arr: AttributeCue[]): AttributeCue =>
    arr.reduce((best, cur) => (age(cur) < age(best) ? cur : best));

  /** Énergie locale (0..1) au bloc `blockBeat` : moyenne de la courbe sur le bloc. */
  const localEnergy = (blockBeat: number, blockLen: number): number => {
    if (!energyCurve || energyCurve.length === 0) return 0.5;
    const start = Math.min(energyCurve.length - 1, Math.floor(blockBeat));
    const end = Math.min(energyCurve.length - 1, Math.floor(blockBeat + blockLen));
    if (end <= start) return energyCurve[start] ?? 0.5;
    let sum = 0;
    for (let i = start; i <= end; i++) sum += energyCurve[i] ?? 0;
    return sum / (end - start + 1);
  };

  let blockBeat = 0;
  while (blockBeat < lengthBeats) {
    // Taille du bloc : modulée par l'énergie si `energyCurve` fournie.
    let blockBeats = baseBlockBeats;
    if (energyCurve && energyCurve.length > 0) {
      const e = localEnergy(blockBeat, baseBlockBeats);
      // e ∈ [0,1] → multiplicateur ∈ [0.5, 2]. Énergie haute → bloc court (cadence rapide).
      const mult = 2 - 1.5 * e; // e=0 → 2× (lent), e=1 → 0.5× (rapide)
      blockBeats = Math.max(BEATS_PER_BAR, Math.round(baseBlockBeats * mult));
    }
    blockBeats = Math.min(blockBeats, lengthBeats - blockBeat);
    // 1) candidates strictes : légales sur les deux contraintes.
    const candidates = colorCues.filter(
      (c) =>
        c.id !== previousId &&
        blockBeat - (lastUsed.get(c.id) ?? Number.NEGATIVE_INFINITY) >= minGapBeats,
    );

    let chosen: AttributeCue;
    if (candidates.length > 0) {
      chosen = oldest(candidates); // lookahead LRU
    } else {
      // 2) relaxe de la contrainte de répétition : juste « ≠ précédente ».
      const relaxed = colorCues.filter((c) => c.id !== previousId);
      if (relaxed.length > 0) {
        chosen = oldest(relaxed);
      } else {
        // 3) une seule couleur effective : réutilisation (dégradation).
        chosen = colorCues[0];
      }
    }

    placements.push([blockBeat, chosen]);
    lastUsed.set(chosen.id, blockBeat);
    previousId = chosen.id;
    blockBeat += blockBeats;
  }

  return placements;
}

/**
 * Planifie les cues d'attribut non-couleur à des beats discrets.
 *
 * Espacement minimal de `minSpacingBars` bars entre deux cues. Si l'espace le
 * permet (`n * minGap ≤ lengthBeats`), on répartit **uniformément** sur la
 * boucle (`spacing = lengthBeats / n`, gap ≥ minGap) ; sinon on conserve
 * l'espacement minimal et on reboucle (**wraparound modulo**) pour ne perdre
 * aucun cue.
 *
 * @returns Liste de paires `(beat, cue)`.
 */
function scheduleAttributes(
  attributeCues: AttributeCue[],
  lengthBeats: number,
  minSpacingBars: number,
): Placement[] {
  if (attributeCues.length === 0) return [];

  const n = attributeCues.length;
  const minGap = minSpacingBars * BEATS_PER_BAR;

  let beats: number[];
  if (n * minGap <= lengthBeats) {
    // Assez d'espace : répartition uniforme (gap ≥ minGap).
    const spacing = lengthBeats / n;
    beats = Array.from({ length: n }, (_, i) => i * spacing);
  } else {
    // Trop de cues : espacement minimal + wraparound (dégradation documentée).
    beats = Array.from({ length: n }, (_, i) => (i * minGap) % lengthBeats);
  }

  return attributeCues.map((cue, i): Placement => [beats[i], cue]);
}

/**
 * Planifie les cues de strobe sur les frontières de bar (beats multiples de 4).
 *
 * Un strobe de SoundSwitch « pique » sur les temps forts : on les place donc sur
 * les frontières de bar (beat 0, 4, 8, …) pour une synchronisation musicale
 * naturelle. Chaque cue produit une seule impulsion (snap), répartie à raison
 * d'au plus un strobe par bar pour ne pas saturer visuellement.
 *
 * @param strobeCues cues de strobe (canaux `strobe`/`shutter`).
 * @param lengthBeats durée totale du loop en beats.
 * @returns Liste de paires `(beat, cue)` sur les frontières de bar.
 */
function scheduleStrobes(
  strobeCues: AttributeCue[],
  lengthBeats: number,
): Placement[] {
  if (strobeCues.length === 0) return [];

  const placements: Placement[] = [];
  // Bar actuelles disponibles : frontières `0, BEATS_PER_BAR, 2*BEATS_PER_BAR, …`.
  const barCount = Math.floor(lengthBeats / BEATS_PER_BAR);
  for (let b = 0; b < barCount; b++) {
    const beat = b * BEATS_PER_BAR;
    // Cycle les cues de strobe (plusieurs vitesses/patterns → alternance).
    placements.push([beat, strobeCues[b % strobeCues.length]]);
  }
  return placements;
}

/**
 * Planifie les cues d'intensité en « respiration » (rampe montée/descente).
 *
 * Chaque cue dimmer est réparti uniformément sur le loop (spacing = lengthBeats/n),
 * comme {@link scheduleAttributes}, mais la valeur produite est animée par une
 * rampe symétrique : le moteur monte puis descend autour de la valeur cible,
 * créant un fondu « respiratoire » plutôt qu'un palier statique.
 *
 * Cette répartition est **indépendante** de {@link scheduleColors} : couleur et
 * intensité évoluent chacune sur leur grille, ce qui évite la corrélation
 * monotone (toujours changer couleur ET intensité au même beat).
 *
 * @param dimmerCues cues d'intensité (canaux `dimmer`/`intensity`).
 * @param lengthBeats durée totale du loop en beats.
 * @returns Liste de paires `(beat, cue)`.
 */
function scheduleDimmers(
  dimmerCues: AttributeCue[],
  lengthBeats: number,
): Placement[] {
  if (dimmerCues.length === 0) return [];

  const n = dimmerCues.length;
  const spacing = lengthBeats / n;
  return dimmerCues.map((cue, i): Placement => [i * spacing, cue]);
}

/**
 * Émet les clés des pistes de « contrôle » (strobe / intensité) de façon dédiée.
 *
 * - **Strobe** : un snap à 255 (flash) sur le canal logique, `rampBeats` forcé à 0
 *   (interpolation interdite : un strobe ne « balaye » pas). Après l'impulsion,
 *   on ré-écrit 0 au beat suivant (refermeture), pour éviter un strobe permanent.
 * - **Intensité** : on émet la valeur cible du cue avec sa `rampBeats` (fondu) ;
 *   si le cue ne mentionne aucun canal `dimmer`/`intensity` explicitement, on
 *   cible 255 (plein) en fade sur ces canaux logiques.
 *
 * Ces canaux sont routés via `channelAddress` (clés logiques `strobe`, `shutter`,
 * `dimmer`, `intensity` présentes dans le `channelMap` de la fixture) ; une
 * fixture sans ces canaux est simplement ignorée.
 *
 * @param strobePlacements paires `(beat, cue)` des strobes.
 * @param dimmerPlacements paires `(beat, cue)` des intensités.
 * @param fixtures fixtures cibles (déjà filtrées par catégorie).
 * @returns Liste de `ChannelKey` (non triée ici).
 */
function emitControlTrackKeys(
  strobePlacements: Placement[],
  dimmerPlacements: Placement[],
  fixtures: AutoloopFixture[],
): ChannelKey[] {
  const keys: ChannelKey[] = [];
  const STROBE_LOGICAL = ['strobe', 'shutter'];
  const DIMMER_LOGICAL = ['dimmer', 'intensity'];

  // ── Strobe : snap 255 puis refermeture (0) au beat suivant. ──
  for (const [beat, cue] of strobePlacements) {
    for (const fixture of fixtures) {
      for (const logical of STROBE_LOGICAL) {
        const addr = channelAddress(fixture, logical);
        if (addr === null) continue;
        keys.push({ channel: String(addr), beat, value: 255, rampBeats: 0 });
        keys.push({ channel: String(addr), beat: beat + 1, value: 0, rampBeats: 0 });
      }
    }
  }

  // ── Intensité : fondu via la rampBeats du cue. ──
  for (const [beat, cue] of dimmerPlacements) {
    const ramp = Math.max(0, cue.rampBeats ?? 1);
    const explicit = Object.keys(cue.values).some((k) => DIMMER_LOGICAL.includes(k));
    for (const fixture of fixtures) {
      if (explicit) {
        for (const [logical, value] of Object.entries(cue.values)) {
          const addr = channelAddress(fixture, logical);
          if (addr === null) continue;
          keys.push({ channel: String(addr), beat, value, rampBeats: ramp });
        }
      } else {
        for (const logical of DIMMER_LOGICAL) {
          const addr = channelAddress(fixture, logical);
          if (addr === null) continue;
          keys.push({ channel: String(addr), beat, value: 255, rampBeats: ramp });
        }
      }
    }
  }

  return keys;
}

/**
 * Linéarise les placements d'attribut en `ChannelKey` DMX absolues.
 *
 * - **Adresse absolue en chaîne.** `channel = String(fixture.address +
 *   fixture.channelMap[logical])`. La timeline ne transporte AUCUNE table de
 *   fixtures (uniquement la catégorie) : le moteur de playback ne pourrait pas
 *   remapper un nom logique (« pan ») vers une adresse. On encode donc l'adresse
 *   absolue en chaîne, ce qui rend chaque clé auto-suffisante pour l'émission DMX.
 * - **Rampe effective.** `ramp = rampBeats` si `rampBeats > 0` ET
 *   `interpolate !== false`, sinon 0 (snap). Un gobo en `interpolate === false`
 *   ne « balaye » pas les gobos intermédiaires.
 * - **Rampe → 2 clés** : une ancre à `max(0, beat - ramp)` avec la valeur
 *   précédente du canal (snap), puis la cible à `beat` avec `rampBeats = ramp`.
 *   **Snap ou première occurrence du canal → 1 clé.**
 * - La « valeur précédente » est suivie par canal absolu (`current`) ; pour la
 *   première occurrence d'un canal on fait un snap (rien à interpoler).
 *
 * Note (limite connue) : si une rampe chevauche un cue antérieur du même canal,
 * l'ancre reprend la dernière valeur connue (approximation).
 *
 * @param placements paires `(beat, cue)`, traitées dans l'ordre chronologique
 *                   (la fonction les trie elle-même par `beat`).
 * @param fixtures   fixtures cibles (déjà filtrées par catégorie).
 * @returns Liste de `ChannelKey` (non triée ici).
 */
function emitAttributeKeys(
  placements: Placement[],
  fixtures: AutoloopFixture[],
): ChannelKey[] {
  const keys: ChannelKey[] = [];
  const current = new Map<string, number>(); // adresse DMX (str) → dernière valeur posée

  const sorted = [...placements].sort((a, b) => a[0] - b[0]);

  for (const [beat, cue] of sorted) {
    const rawRamp = cue.rampBeats ?? 0;
    const ramp = rawRamp > 0 && cue.interpolate !== false ? rawRamp : 0;

    for (const fixture of fixtures) {
      for (const [logical, value] of Object.entries(cue.values)) {
        const address = channelAddress(fixture, logical);
        if (address === null) continue; // fixture sans ce canal : on saute
        const ch = String(address);

        const prev = current.get(ch);
        if (ramp > 0 && prev !== undefined) {
          // Début de rampe : ancre la valeur précédente (snap).
          const anchorBeat = Math.max(0, beat - ramp);
          if (anchorBeat < beat) {
            keys.push({ channel: ch, beat: anchorBeat, value: prev, rampBeats: 0 });
          }
          // Fin de rampe : valeur cible, interpolation sur `ramp`.
          keys.push({ channel: ch, beat, value, rampBeats: ramp });
        } else {
          // Snap (rampe nulle ou première occurrence du canal).
          keys.push({ channel: ch, beat, value, rampBeats: 0 });
        }

        current.set(ch, value);
      }
    }
  }

  return keys;
}

/**
 * Échantillonne les `PositionCue` par beat en pan/tilt.
 *
 * Pour chaque PositionCue et chaque fixture de la catégorie, on émet un
 * keyframe pan et un keyframe tilt **par beat**, mappés vers les noms logiques
 * `pan`/`pan2`/… et `tilt`/`tilt2`/… (multi-bras, phase décalée par moteur —
 * effet vague ; un pan unique = « master partagé » écrit une seule fois).
 * `rampBeats = 1.0` entre beats (interpolation linéaire lisse, approchant la
 * trajectoire trigonométrique continue sans effet « escalier ») ; le beat 0 sert
 * d'ancre (`rampBeats = 0.0`). Les valeurs pan/tilt sont calculées via
 * `computePan(cue, beat)` / `computeTilt(cue, beat)` du module 1.
 *
 * Plusieurs PositionCue sont échantillonnés dans l'ordre : à beat égal, le
 * dernier écrit gagne côté moteur (le tri stable final conserve cet ordre).
 *
 * @param positionCues liste des mouvements à matérialiser.
 * @param fixtures     fixtures cibles (déjà filtrées par catégorie).
 * @param lengthBeats  durée totale du loop en beats.
 * @returns Liste de `ChannelKey` (non triée ici).
 */
function emitPositionKeys(
  positionCues: PositionCue[],
  fixtures: AutoloopFixture[],
  lengthBeats: number,
): ChannelKey[] {
  const keys: ChannelKey[] = [];

  for (const cue of positionCues) {
    for (const fixture of fixtures) {
      // Noms logiques pan/tilt (multi-bras) : pan, pan2, pan3… / tilt, tilt2…
      const panKeys = Object.keys(fixture.channelMap)
        .filter((k) => /^pan\d*$/.test(k))
        .sort();
      const tiltKeys = Object.keys(fixture.channelMap)
        .filter((k) => /^tilt\d*$/.test(k))
        .sort();

      // Nombre de moteurs (règle multi-pan-tilt : motorCount = max(pan, tilt)).
      // Un pan unique = « pan master partagé » (écrit une fois) ; sinon chaque
      // pan est un bras (phase décalée). Chaque tilt est un bras (effet vague).
      const panCount = panKeys.length;
      const tiltCount = tiltKeys.length;
      const motorCount = Math.max(panCount, tiltCount, 1);
      const phaseStep = (2 * Math.PI) / motorCount;

      for (let beat = 0; beat < lengthBeats; beat++) {
        const ramp = beat === 0 ? 0 : 1;
        for (let m = 0; m < tiltCount; m++) {
          const addr = channelAddress(fixture, tiltKeys[m]);
          if (addr === null) continue;
          keys.push({
            channel: String(addr),
            beat,
            value: computeTilt({ ...cue, centerTilt: fixture.centerTiltDmx ?? cue.centerTilt ?? 128, phase: cue.phase + m * phaseStep }, beat),
            rampBeats: ramp,
          });
        }
        if (panCount === 1) {
          const addr = channelAddress(fixture, panKeys[0]);
          if (addr !== null) {
            keys.push({
              channel: String(addr),
              beat,
              value: computePan({ ...cue, centerPan: fixture.centerPanDmx ?? cue.centerPan ?? 128 }, beat),
              rampBeats: ramp,
            });
          }
        } else {
          for (let m = 0; m < panCount; m++) {
            const addr = channelAddress(fixture, panKeys[m]);
            if (addr === null) continue;
            keys.push({
              channel: String(addr),
              beat,
              value: computePan({ ...cue, centerPan: fixture.centerPanDmx ?? cue.centerPan ?? 128, phase: cue.phase + m * phaseStep }, beat),
              rampBeats: ramp,
            });
          }
        }
      }
    }
  }

  return keys;
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

/**
 * Génère la timeline DMX procédurale d'un Autoloop.
 *
 * @param input entrée figée du générateur (voir {@link AutoscriptInput}).
 * @returns Une `AutoloopTimeline` dont `keys` est la liste des `ChannelKey`
 *          (adresses DMX absolues, triés par `beat`).
 */
export function generateAutoscript(input: AutoscriptInput): AutoloopTimeline {
  // --- 1. Règles : fusion des défauts avec les éventuelles surcharges. ---
  const mergedRules = { ...DEFAULT_RULES, ...(input.rules ?? {}) };
  const minRepeatBars = Math.max(1, Math.trunc(mergedRules.minColorRepeatBars));
  const changeEveryBars = Math.max(1, Math.trunc(mergedRules.colorChangeEveryBars));
  const targetBars = Math.max(1, Math.trunc(input.targetBars));

  // --- 2. Extraction + filtrage des fixtures par catégorie cible. ---
  const category = input.category;
  const fixtures = input.fixtures.filter((f) => f.category === category);
  const positionCues = input.positionCues;
  const attributeCues = input.attributeCues;

  const lengthBeats = targetBars * BEATS_PER_BAR;

  const colorCues = attributeCues.filter((c) => c.attribute === 'color');
  const otherCues = attributeCues.filter((c) => c.attribute !== 'color');

  // ── Pistes de contrôle (Control Tracks SoundSwitch) : intensité + strobe. ──
  // Extraites de `attributeCues` si elles portent l'attribut dédié, sinon des
  // listes dédiées fournies explicitement par l'hôte (dimmerCues / strobeCues).
  const dimmerCues = input.dimmerCues
    ? input.dimmerCues
    : attributeCues.filter((c) => c.attribute === 'dimmer' || c.attribute === 'intensity');
  const strobeCues = input.strobeCues
    ? input.strobeCues
    : attributeCues.filter((c) => c.attribute === 'strobe');

  // --- 3. Plan par beat (slots temporels). ---
  const colorPlacements = scheduleColors(
    colorCues,
    lengthBeats,
    minRepeatBars,
    changeEveryBars,
    input.energyCurve,
  );
  const attrPlacements = scheduleAttributes(
    otherCues,
    lengthBeats,
    MIN_ATTRIBUTE_SPACING_BARS,
  );
  const strobePlacements = scheduleStrobes(strobeCues, lengthBeats);
  const dimmerPlacements = scheduleDimmers(dimmerCues, lengthBeats);

  // --- 4. Linéarisation en ChannelKey. ---
  const keys: ChannelKey[] = [];
  keys.push(...emitAttributeKeys([...colorPlacements, ...attrPlacements], fixtures));
  keys.push(...emitPositionKeys(positionCues, fixtures, lengthBeats));
  keys.push(...emitControlTrackKeys(strobePlacements, dimmerPlacements, fixtures));

  // --- 5. Tri stable par beat (exigence du contrat). ---
  keys.sort((a, b) => a.beat - b.beat);

  // Identifiant unique (compteur monotone, sans état global partagé).
  const loopId = `autoscript-${category}-${targetBars}b-${idCounter++}`;

  // `positionCue` reste null : le mouvement est intégralement matérialisé en
  // keyframes pan/tilt ci-dessus, pour éviter une double application par le
  // moteur de playback.
  return {
    id: loopId,
    bars: targetBars,
    category,
    keys,
    positionCue: null,
  };
}
