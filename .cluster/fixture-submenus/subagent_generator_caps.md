# Analyse & proposition — Exploitation des capacités par l'autoscript

Sous-tâche 2 · `generator-caps-analysis`
Fichier cible : `src/engine/auto-loops.ts` (générateur de boucles) + `src/hooks/dmx-cues.ts` (temps réel).
Ne modifie **pas** les sources : ce document est une cartographie + proposition concrète.

---

## 1. Cartographie précise du GAP

### 1.1 Les deux analyseurs coexistent (découverte critique)

`auto-loops.ts` n'utilise **pas** l'analyseur unifié. Vérifié :

- `auto-loops.ts:18` → `import { analyzeChannels, type ChannelAnalysis } from './dmx-channel';`
- `dmx-cues.ts:17` → `import { analyzeFixture, type FixtureChannelAnalysis } from '../engine/fixture-analyzer';`

Or `dmx-channel.ts` est l'**ancien** analyseur (plus étroit), pas l'alias unifié. Conséquences sur le type `ChannelAnalysis` que voit `auto-loops.ts` :

| Champ | `FixtureChannelAnalysis` (unifié, `fixture-analyzer.ts`) | `ChannelAnalysis` (legacy, `dmx-channel.ts`, utilisé par auto-loops) |
|---|---|---|
| `goboOffset` / `goboCaps` | ✅ | ✅ présent (l.14-15) |
| `wheelOffset` / `wheelCaps` | ✅ | ✅ présent (l.9-10) |
| `prismOffset` | ✅ | ✅ présent (l.16) |
| `zoomOffset` | ✅ | ✅ présent (l.17) |
| `frostOffset` | ✅ | ✅ présent (l.18) — **bug** : `case'Frost':case'Focus'` mappe les deux sur `frostOffset` |
| `irisOffset` | ✅ | ✅ présent (l.20) |
| `focusOffset` | ✅ | ❌ **jamais rempli** (bug ci-dessus) |
| `effectOffset` / `effectCaps` | ✅ | ❌ **absent** |
| `speedOffset` | ✅ | ❌ **absent** |
| `beamOffset` | ✅ | ❌ **absent** |
| `rgbOffsets` / `ledIntensityOffsets` | ✅ | ❌ **absent** |
| `panOffset`/`tiltOffset`/`panFineOffset`/`tiltFineOffset` | ✅ | ❌ (seuls `panOffsets[]`/`tiltOffsets[]`) |
| `macroOffsets` | ✅ | ❌ **absent** |

**Recommandation n°0 (prérequis)** : changer la ligne 18 de `auto-loops.ts` pour importer depuis `../engine/fixture-analyzer` :

```ts
import { analyzeChannels, type ChannelAnalysis } from '../engine/fixture-analyzer';
```

`fixture-analyzer.ts` ré-exporte `analyzeChannels` **et** `ChannelAnalysis` (alias de `FixtureChannelAnalysis`, vérifié l.58 et l.310-313). Mêmes noms → changement à 1 ligne, zéro impact ailleurs, et on récupère `effectCaps`, `speedOffset`, `beamOffset`, `rgbOffsets`, `focusOffset` correct (le bug Frost/Focus est corrigé dans l'unifié : `case 'Focus'` séparé, `fixture-analyzer.ts` l.~178).

### 1.2 GAP par capacité — `auto-loops.ts`

`AutoLoopKind = 'color-chase' | 'movement' | 'dimmer-pulse' | 'strobe'` (l.19).

Le générateur ne lit que 4 champs d'analyse. Vérifié :

- `generateAutoLoops` (l.340-361) : filtres `rgbSegments` (l.348), `panOffsets/tiltOffsets` (l.349-351), `intensityOffset` (l.352-357).
- `generateLoopLibrary` : `Cap` = `rgb/movers/dimmers/shutters` (l.407-418), `kinds` poussés l.420-423, `switch` l.435-451.
- `generateLoopFromRecipe` (l.603-644) : mêmes 4 filtres, `switch` l.626-640.
- `putRgbSegments` (l.167-179) : n'écrit que `rgbSegments` + `w=0`.

**Aucune référence** à `wheelCaps`, `goboCaps`, `effectCaps`, `prismOffset`, `zoomOffset`, `frostOffset`, `irisOffset`, `focusOffset`, `speedOffset`, `macroOffsets` dans tout `auto-loops.ts` (vérifié par grep, 0 occurrence). Les boucles « color-chase » n'écrivent `putRgbSegments` que si `rgbSegments.length > 0` → **une fixture à roue de couleur (wheelCaps, pas de RGB) ne reçoit jamais de couleur** dans le catalogue actuel.

### 1.3 GAP par capacité — `computeDmxCues` (dmx-cues.ts)

Ligne exacte de chaque bloc (vérifié) :

| Capacité | dmx-cues.ts | Détail |
|---|---|---|
| `wheelCaps` | **l.718-763** | match par distance hex (l.724) puis fallback nom (l.742-756), `(min+max)/2` l.760 |
| `goboCaps` | **l.862-869** | `getGoboValue()` (l.348-359), `(min+max)/2` |
| `prismOffset` | **l.872-876** | 0/128/255 codés en dur, drops/chorus only |
| `effectCaps` | **l.879-895** | filtre `min > 0` (l.881-882), `(min+max)/2` l.891 |
| `effectOffset` sans caps | **l.789-792** | fallback `8 + (cueIndex%24)*10` |
| `beamOffset` | **l.898-905** | variation 60..255 par section |
| `speedOffset` | **l.907-913** | 40..255 par section |
| `macroOffsets` (exclusion) | **l.919-923** | safety-net 128 saute les macros |
| `zoomOffset` | ❌ **aucune occurrence** | tombe dans le safety-net → 128 |
| `frostOffset` | ❌ **aucune occurrence** | → 128 |
| `irisOffset` | ❌ **aucune occurrence** | → 128 |
| `focusOffset` | ❌ **aucune occurrence** | → 128 |

**Correction importante** : le brief disait « computeDmxCues exploite DÉJÀ wheel/gobo/prism/effect/speed/macro » — c'est exact, **mais pas zoom/frost/iris/focus**. Ces 4 canaux continus ne sont écrits nulle part dans `computeDmxCues` (vérifié : 0 match pour `fa.zoomOffset`, `fa.frostOffset`, `fa.irisOffset`, `fa.focusOffset`). Ils retombent sur le safety-net l.919-923 à 128. Le `beamOffset` exploité (l.898) provient du type `Beam` (que GDTF utilise pour frost/focus, cf. `electron/fixtures/gdtf.ts:111-112`), pas des types `Zoom/Frost/Iris/Focus` de l'éditeur.

### 1.4 Synthèse du GAP

| Capacité | auto-loops.ts | computeDmxCues | Action proposée |
|---|---|---|---|
| RGB (`rgbSegments`) | ✅ | ✅ | — |
| pan/tilt | ✅ | ✅ | — |
| intensity / shutter | ✅ | ✅ | — |
| **color wheel** (`wheelCaps`) | ❌ | ✅ l.718 | nouveau kind `color-wheel` |
| **gobo** (`goboCaps`) | ❌ | ✅ l.862 | nouveau kind `gobo` |
| **effect** (`effectCaps`) | ❌ | ✅ l.879 | nouveau kind `effect` |
| **prism** (`prismOffset`) | ❌ | ✅ l.872 | nouveau kind `prism` |
| **zoom/frost/iris/focus** | ❌ | ❌ | nouveaux kinds `beam-*` (les 2 fichiers) |
| **speed** (`speedOffset`) | ❌ | ✅ l.907 | à inclure dans `beam`/`gobo` (rotation) |
| **macro** (`macroOffsets`) | ❌ | ❌ (exclusion volontaire l.919) | reste exclu — user-only |

---

## 2. Nouveaux `AutoLoopKind` — signatures + DMX émis

### 2.0 Type + constantes partagées (à étendre)

```ts
export type AutoLoopKind =
  | 'color-chase' | 'movement' | 'dimmer-pulse' | 'strobe'
  | 'color-wheel' | 'gobo' | 'effect' | 'prism'
  | 'beam-zoom' | 'beam-frost' | 'beam-iris' | 'beam-focus';

export const LOOP_KIND_LABEL: Record<AutoLoopKind, string> = {
  /* ...existants... */
  'color-wheel': 'Roue couleur',
  gobo: 'Gobo',
  effect: 'Effet',
  prism: 'Prisme',
  'beam-zoom': 'Zoom',
  'beam-frost': 'Frost',
  'beam-iris': 'Iris',
  'beam-focus': 'Focus',
};

export const LOOP_KIND_ORDER: AutoLoopKind[] = [
  'color-chase', 'color-wheel', 'movement', 'dimmer-pulse', 'strobe',
  'gobo', 'effect', 'prism', 'beam-zoom', 'beam-frost', 'beam-iris', 'beam-focus',
];
```

⚠️ `AutoLoopsPanel.tsx:10` a un `KIND_META: Record<AutoLoopKind, …>` exhaustif → **doit** recevoir les 8 nouvelles entrées (icône + accent), sinon erreur TS (Record indexé sans index signature optionnel). `PerformanceView.tsx` (l.883, l.904) dérive de `LOOP_KIND_ORDER`/`LOOP_KIND_LABEL` → s'adapte automatiquement.

### 2.1 Helper partagé : écrire une valeur dans `[min, max]`

```ts
/** Valeur d'activation au centre de la plage d'une capacité. */
function capMid(cap: DmxFixtureCapability): number {
  return Math.round((cap.min + cap.max) / 2);
}
```

Toute activation de capacité passe par `cap.min`/`cap.max` (pas de 0/255 codés en dur).

### 2.2 `color-wheel` — chase sur roue (fixtures sans RGB)

```ts
function buildColorWheelLoop(
  tier: FixtureTier,
  fixtures: AnalyzedFixture[],          // wheelOffset !== null && wheelCaps.length > 0
  speedBpm: number,
  direction: AutoLoop['direction'] = 'forward',
): AutoLoop {
  // nb de pas = nb de couleurs de la roue (min sur toutes les fixtures pour rester synchrone)
  const capCount = Math.min(...fixtures.map((f) => f.analysis.wheelCaps.length));
  const steps: AutoLoopStep[] = [];
  for (let step = 0; step < capCount; step++) {
    const frame: Record<number, number> = {};
    for (let i = 0; i < fixtures.length; i++) {
      const { pf, analysis } = fixtures[i];
      // chase rotatif : fixture i montre la couleur (i + step) % capCount
      const cap = analysis.wheelCaps[(i + step) % analysis.wheelCaps.length];
      put(frame, absAddr(pf, analysis.wheelOffset!), capMid(cap));
      if (analysis.intensityOffset !== null) put(frame, absAddr(pf, analysis.intensityOffset), 255);
      if (analysis.shutterOffset !== null) put(frame, absAddr(pf, analysis.shutterOffset), 255);
    }
    steps.push({ channels: frame });
  }
  return {
    id: `auto-cw-${tier}`, name: `Color wheel · ${tier}`, tier, kind: 'color-wheel',
    fixtureIds: fixtures.map((f) => f.pf.id), steps, speedBpm, direction,
  };
}
```

- **DMX émis** : `capMid(cap)` sur `absAddr(pf, wheelOffset)` + dimmer/shutter ouverts.
- **Sécurité** : si `wheelCaps` vide → ne pas générer (filtre amont).

### 2.3 `gobo` — chase de motifs + rotation

```ts
function buildGoboLoop(
  tier: FixtureTier,
  fixtures: AnalyzedFixture[],          // goboOffset !== null && goboCaps.length > 0
  speedBpm: number,
  rotate: boolean,                      // true → ajoute une variation de vitesse de rotation
  direction: AutoLoop['direction'] = 'forward',
): AutoLoop {
  const capCount = Math.min(...fixtures.map((f) => f.analysis.goboCaps.length));
  const steps: AutoLoopStep[] = [];
  for (let step = 0; step < capCount; step++) {
    const frame: Record<number, number> = {};
    for (let i = 0; i < fixtures.length; i++) {
      const { pf, analysis } = fixtures[i];
      const cap = analysis.goboCaps[(i + step) % analysis.goboCaps.length];
      put(frame, absAddr(pf, analysis.goboOffset!), capMid(cap));
      // Rotation : si la fixture a un canal Speed, le pousser progressivement.
      if (rotate && analysis.speedOffset !== null) {
        put(frame, absAddr(pf, analysis.speedOffset), 128 + Math.round(127 * (step / capCount)));
      }
      if (analysis.intensityOffset !== null) put(frame, absAddr(pf, analysis.intensityOffset), 255);
      if (analysis.shutterOffset !== null) put(frame, absAddr(pf, analysis.shutterOffset), 255);
    }
    steps.push({ channels: frame });
  }
  return { id: `auto-gb-${tier}`, name: `Gobo · ${tier}`, tier, kind: 'gobo',
    fixtureIds: fixtures.map((f) => f.pf.id), steps, speedBpm, direction,
    variant: rotate ? 'rotate' : 'static' };
}
```

- **DMX émis** : `capMid(cap)` sur `goboOffset` ; si `rotate`, balayage linéaire 128→255 sur `speedOffset` (rotation = vitesse).
- **Limitation connue** : l'analyseur ne garde que le **premier** canal `Gobo` (`fixture-analyzer.ts` `case 'Gobo'` → `if (fa.goboOffset === null)`). Un 2ᵉ canal Gobo (rotation dédiée) n'est pas capturé. Le `speedOffset` sert de proxy de rotation. (Amélioration possible hors scope : collecter `goboOffsets[]`.)

### 2.4 `effect` — macros d'effet intégrées

```ts
function buildEffectLoop(
  tier: FixtureTier,
  fixtures: AnalyzedFixture[],          // effectOffset !== null && effectCaps.length > 0
  speedBpm: number,
  direction: AutoLoop['direction'] = 'forward',
): AutoLoop {
  // Filtrer "No Effect" (min=0) pour ne pas tuer la sortie lumière — même règle que dmx-cues.ts:881-882
  const capsFor = (f: AnalyzedFixture) => {
    const active = f.analysis.effectCaps!.filter((c) => c.min > 0);
    return active.length > 0 ? active : f.analysis.effectCaps!;
  };
  const capCount = Math.min(...fixtures.map((f) => capsFor(f).length));
  const steps: AutoLoopStep[] = [];
  for (let step = 0; step < capCount; step++) {
    const frame: Record<number, number> = {};
    for (let i = 0; i < fixtures.length; i++) {
      const { pf, analysis } = fixtures[i];
      const caps = capsFor({ pf, analysis });
      const cap = caps[(i + step) % caps.length];
      put(frame, absAddr(pf, analysis.effectOffset!), capMid(cap));
      if (analysis.intensityOffset !== null) put(frame, absAddr(pf, analysis.intensityOffset), 255);
      if (analysis.shutterOffset !== null) put(frame, absAddr(pf, analysis.shutterOffset), 255);
    }
    steps.push({ channels: frame });
  }
  return { id: `auto-fx-${tier}`, name: `Effect · ${tier}`, tier, kind: 'effect',
    fixtureIds: fixtures.map((f) => f.pf.id), steps, speedBpm, direction };
}
```

- **DMX émis** : `capMid(cap)` sur `effectOffset`, en sautant `min===0`.
- ⚠️ Dépend du prérequis n°0 : `effectCaps` n'existe pas dans le `ChannelAnalysis` legacy.

### 2.5 `prism` — insertion + rotation

```ts
function buildPrismLoop(
  tier: FixtureTier,
  fixtures: AnalyzedFixture[],          // prismOffset !== null
  speedBpm: number,
): AutoLoop {
  // 4 pas : inséré fixe / rotation lente / rotation rapide / retiré.
  // Le canal Prism n'a PAS de caps dans l'analyseur (prismOffset: number|null) → valeurs conventionnelles.
  const PRISM_STATES = [128, 170, 255, 0];
  const steps: AutoLoopStep[] = PRISM_STATES.map((v) => {
    const frame: Record<number, number> = {};
    for (const { pf, analysis } of fixtures) {
      put(frame, absAddr(pf, analysis.prismOffset!), v);
      if (analysis.intensityOffset !== null) put(frame, absAddr(pf, analysis.intensityOffset), 255);
      if (analysis.shutterOffset !== null) put(frame, absAddr(pf, analysis.shutterOffset), 255);
    }
    return { channels: frame };
  });
  return { id: `auto-pr-${tier}`, name: `Prism · ${tier}`, tier, kind: 'prism',
    fixtureIds: fixtures.map((f) => f.pf.id), steps, speedBpm, direction: 'forward' };
}
```

- **DMX émis** : 128 (inséré), 170 (rotation lente), 255 (rotation rapide), 0 (retiré). Conforme à la convention `dmx-cues.ts:874` (0/128/255). Si l'éditeur (sous-tâche 1) ajoute des caps sur Prism, basculer sur `capMid`.

### 2.6 `beam-*` — zoom / frost / iris / focus (canaux continus)

Un seul builder paramétré, 4 kinds. Ces canaux sont **continus sans capacités** → valeurs réparties 0..255 (pas de `min`/`max`).

```ts
type BeamChannel = 'zoom' | 'frost' | 'iris' | 'focus';

function beamOffsetOf(fa: ChannelAnalysis, k: BeamChannel): number | null {
  switch (k) {
    case 'zoom': return fa.zoomOffset;
    case 'frost': return fa.frostOffset;
    case 'iris': return fa.irisOffset;
    case 'focus': return fa.focusOffset;
  }
}

function buildBeamLoop(
  tier: FixtureTier,
  fixtures: AnalyzedFixture[],          // beamOffsetOf(analysis, k) !== null
  kind: AutoLoopKind,                   // 'beam-zoom' | 'beam-frost' | 'beam-iris' | 'beam-focus'
  speedBpm: number,
  direction: AutoLoop['direction'] = 'forward',
): AutoLoop {
  const k = kind.slice('beam-'.length) as BeamChannel;
  const BEAM_STEPS = 8;
  const steps: AutoLoopStep[] = [];
  for (let step = 0; step < BEAM_STEPS; step++) {
    // sinus plein 0..255 : sweep ouvert↔fermé
    const v = Math.round(255 * (0.5 + 0.5 * Math.sin((step / BEAM_STEPS) * Math.PI * 2)));
    const frame: Record<number, number> = {};
    for (const { pf, analysis } of fixtures) {
      const off = beamOffsetOf(analysis, k);
      if (off === null) continue;
      put(frame, absAddr(pf, off), v);
      if (analysis.intensityOffset !== null) put(frame, absAddr(pf, analysis.intensityOffset), 255);
      if (analysis.shutterOffset !== null) put(frame, absAddr(pf, analysis.shutterOffset), 255);
    }
    steps.push({ channels: frame });
  }
  return { id: `auto-${k}-${tier}`, name: `${k} · ${tier}`, tier, kind,
    fixtureIds: fixtures.map((f) => f.pf.id), steps, speedBpm, direction };
}
```

- **DMX émis** : sinus 0→255 sur l'offset du canal beam correspondant. Rien n'est codé en dur (plage DMX continue).
- Le type `AutoLoopKind` étendu permet 4 kinds distincts → 4 entrées `KIND_META`/`LOOP_KIND_LABEL` (icônes Zoom/Frost/Iris/Focus).

---

## 3. Intégration dans le catalogue & la recette

### 3.1 `generateAutoLoops` (l.340-361) — ajouter un balayage « capacités »

Après le bloc dimmers existant, ajouter par tier :

```ts
const wheels  = fixtures.filter((f) => f.analysis.wheelOffset !== null && f.analysis.wheelCaps.length > 0 && f.analysis.rgbSegments.length === 0);
const gobos   = fixtures.filter((f) => f.analysis.goboOffset !== null && f.analysis.goboCaps.length > 0);
const effects = fixtures.filter((f) => f.analysis.effectOffset !== null && (f.analysis.effectCaps?.length ?? 0) > 0);
const prisms  = fixtures.filter((f) => f.analysis.prismOffset !== null);
const beams   = (k: BeamChannel) => fixtures.filter((f) => beamOffsetOf(f.analysis, k) !== null);

if (wheels.length > 0)  loops.push(buildColorWheelLoop(tier, wheels, speedBpm));
if (gobos.length > 0)   loops.push(buildGoboLoop(tier, gobos, speedBpm, true));
if (effects.length > 0) loops.push(buildEffectLoop(tier, effects, speedBpm));
if (prisms.length > 0)  loops.push(buildPrismLoop(tier, prisms, speedBpm));
for (const k of ['zoom', 'frost', 'iris', 'focus'] as BeamChannel[]) {
  const b = beams(k);
  if (b.length > 0) loops.push(buildBeamLoop(tier, b, `beam-${k}` as AutoLoopKind, speedBpm));
}
```

Note : `color-wheel` cible **explicitement** `rgbSegments.length === 0` (une fixture RGB a déjà `color-chase` ; une fixture à roue n'en a pas).

### 3.2 `generateLoopLibrary` (l.401-451)

Étendre l'interface `Cap` (l.402-406) et le remplissage (l.419-423) :

```ts
interface Cap {
  rgb: AnalyzedFixture[]; movers: AnalyzedFixture[]; dimmers: AnalyzedFixture[];
  shutters: AnalyzedFixture[];
  wheels: AnalyzedFixture[]; gobos: AnalyzedFixture[]; effects: AnalyzedFixture[];
  prisms: AnalyzedFixture[];
  beams: Record<BeamChannel, AnalyzedFixture[]>;
  kinds: AutoLoopKind[];
}
```

`kinds.push(...)` :

```ts
if (wheels.length > 0)  kinds.push('color-wheel');
if (gobos.length > 0)   kinds.push('gobo');
if (effects.length > 0) kinds.push('effect');
if (prisms.length > 0)  kinds.push('prism');
for (const k of ['zoom', 'frost', 'iris', 'focus'] as BeamChannel[])
  if (beams[k].length > 0) kinds.push(`beam-${k}` as AutoLoopKind);
```

Étendre le `switch` du `build()` (l.435-451) :

```ts
case 'color-wheel':
  loop = buildColorWheelLoop(tier, cap.wheels, speed, direction); break;
case 'gobo':
  loop = buildGoboLoop(tier, cap.gobos, speed, rng() < 0.5, direction); break;
case 'effect':
  loop = buildEffectLoop(tier, cap.effects, speed, direction); break;
case 'prism':
  loop = buildPrismLoop(tier, cap.prisms, speed); break;
case 'beam-zoom': case 'beam-frost': case 'beam-iris': case 'beam-focus':
  loop = buildBeamLoop(tier, cap.beams[kind.slice('beam-'.length) as BeamChannel], kind, speed, direction); break;
```

Le mécanisme « guaranteed coverage + random fill » (l.469-479) s'adapte automatiquement puisque `kinds` est la source de vérité.

### 3.3 `LoopRecipe` portable (l.59-74) + `loopToRecipe`/`generateLoopFromRecipe` (l.584-644)

Ajouter un champ optionnel unique pour la variante (sous-canal beam / rotation gobo) :

```ts
export interface LoopRecipe {
  /* ...existants... */
  variant?: string; // 'rotate'|'static' (gobo) · BeamChannel (beam-*)
}
```

`loopToRecipe` : reporter `loop.variant`. `generateLoopFromRecipe` : ajouter les cas au `switch` (l.626-640), avec filtres amont identiques à ceux de 3.1 (retourner `undefined` si aucune fixture capable, comme l.632/637 existant).

```ts
case 'color-wheel': {
  const wheels = fixtures.filter((f) => f.analysis.wheelOffset !== null
    && f.analysis.wheelCaps.length > 0 && f.analysis.rgbSegments.length === 0);
  if (wheels.length === 0) return undefined;
  return buildColorWheelLoop(recipe.tier, wheels, recipe.speedBpm, recipe.direction);
}
case 'gobo': { /* … goboCaps.length > 0 … */ }
case 'effect': { /* … effectCaps.length > 0 … */ }
case 'prism': { /* … prismOffset !== null … */ }
case 'beam-zoom': case 'beam-frost': case 'beam-iris': case 'beam-focus': {
  const k = recipe.variant as BeamChannel;
  const b = fixtures.filter((f) => beamOffsetOf(f.analysis, k) !== null);
  if (b.length === 0) return undefined;
  return buildBeamLoop(recipe.tier, b, recipe.kind, recipe.speedBpm, recipe.direction);
}
```

---

## 4. Stratégie de test

Cible : `src/__tests__/auto-loops.test.ts` (helpers `ch()`/`def()`/`pf()` déjà en place). Ajouter des fixtures synthétiques **avec capacités min/max** pour valider le respect `cap.min`/`cap.max`.

### 4.1 Fixtures de test à ajouter

```ts
const cap = (min: number, max: number, name: string, color?: string): DmxFixtureCapability => ({ min, max, name, color });

// Roue de couleur : Dimmer@0, Colour(wheel)@1 — PAS de RGB
const wheelHead = def('wheel-head', [
  ch('Dimmer', 'Intensity', 0),
  { name: 'Color Wheel', type: 'Colour', offset: 1, capabilities: [
    cap(10, 20, 'Red', '#ff0000'), cap(30, 40, 'Green', '#00ff00'),
    cap(50, 60, 'Blue', '#0000ff'), cap(70, 80, 'White', '#ffffff') ] },
]);

// Gobo : Dimmer@0, Gobo@1, Speed@2
const goboHead = def('gobo-head', [
  ch('Dimmer', 'Intensity', 0),
  { name: 'Gobo', type: 'Gobo', offset: 1, capabilities: [
    cap(8, 15, 'Open'), cap(32, 47, 'Gobo 1'), cap(64, 79, 'Gobo 2'), cap(96, 111, 'Gobo 3') ] },
  ch('Gobo Speed', 'Speed', 2),
]);

// Effect macros : Dimmer@0, Effect@1 (avec "No Effect" min=0)
const fxHead = def('fx-head', [
  ch('Dimmer', 'Intensity', 0),
  { name: 'Effect Macro', type: 'Effect', offset: 1, capabilities: [
    cap(0, 0, 'No Effect'), cap(16, 31, 'Macro 1'), cap(48, 63, 'Macro 2') ] },
]);

// Prisme : Dimmer@0, Prism@1
const prismHead = def('prism-head', [
  ch('Dimmer', 'Intensity', 0), ch('Prism', 'Prism', 1),
]);

// Beam continu : Dimmer@0, Zoom@1, Frost@2, Iris@3, Focus@4
const beamHead = def('beam-head', [
  ch('Dimmer', 'Intensity', 0), ch('Zoom', 'Zoom', 1), ch('Frost', 'Frost', 2),
  ch('Iris', 'Iris', 3), ch('Focus', 'Focus', 4),
]);
```

### 4.2 Tests unitaires à ajouter

1. **color-wheel émet le milieu de plage** — `generateAutoLoops` sur `wheel-head` produit un loop `color-wheel` ; chaque step écrit `(min+max)/2` (ex. Red→15, Green→35, Blue→55) sur `addr = startAddress + 1`, **jamais** 0/255, **jamais** sur les offsets RGB (il n'y en a pas).
2. **color-wheel absent si pas de wheelCaps** — fixture RGB pure ne génère pas de `color-wheel` (régression `rgbSegments.length === 0`).
3. **gobo chase + rotation speed** — `gobo-head` : step 0 écrit `capMid` de Gobo 1 (39) et une valeur de speed croissante ; les `speedOffset` restent dans [0,255].
4. **effect saute "No Effect"** — `fx-head` : aucune valeur `0` émise sur l'offset Effect ; les step parcourent Macro 1/2 (`(16+31)/2=23`, `(48+63)/2=55`).
5. **prism cycle 4 états** — `prism-head` : les steps écrivent {128,170,255,0} sur l'offset Prism.
6. **beam sinus borné** — `beam-head` : pour chaque kind `beam-zoom/frost/iris/focus`, toutes les valeurs sur l'offset cible sont dans [0,255] et couvrent au moins une valeur <64 et une >191 (sweep réel).
7. **round-trip recipe** — pour chaque nouveau kind, `loopToRecipe` puis `generateLoopFromRecipe` reconstruit des frames identiques (étendre la section existante l.394-433).
8. **`generateLoopLibrary` couvre les nouveaux kinds** — un patch mixte (wheelHead + goboHead + fxHead + prismHead + beamHead) produit au moins un loop de chaque nouveau kind dans le catalogue, et reste borné par `count`.
9. **`generateLoopFromRecipe` renvoie `undefined`** si le tier n'a pas la capacité (ex. recipe `gobo` sur patch RGB-only) — miroir du test existant l.430-433.
10. **non-régression `computeDmxCues`** (fichier `gencues.test.ts` ou nouveau) — ajouter une assertion que zoom/frost/iris/focus ne sortent plus 128 fixe une fois l'implémentation (sous-tâche 3) faite dans `computeDmxCues` aussi, si le scope l'inclut. Sinon, le test `computeDmxCues` existant ne doit pas casser.

### 4.3 Ordre d'exécution / dépendances

- Sous-tâche 1 (éditeur) et 2 (cette analyse) sont **indépendantes**.
- L'implémentation (sous-tâche 3) doit d'abord faire le **prérequis n°0** (switch d'import l.18), puis ajouter builders + kinds, puis `KIND_META` dans `AutoLoopsPanel.tsx`, puis les tests.
- Vérif finale : `tsc` (electron + renderer) + `vitest` suite complète.

---

## 5. Résumé

L'autoscript ignore aujourd'hui **toutes** les capacités hors RGB/pan-tilt/dimmer/shutter. Dans `auto-loops.ts`, aucune référence à `wheelCaps/goboCaps/effectCaps/prismOffset/zoomOffset/frostOffset/irisOffset/focusOffset/speedOffset` (grep = 0), et `computeDmxCues` n'exploite **pas** non plus zoom/frost/iris/focus (ils retombent à 128 via le safety-net l.919-923) — contrairement à l'hypothèse initiale. Cause racine n°1 : `auto-loops.ts:18` importe l'analyseur **legacy** `dmx-channel.ts` (qui n'a ni `effectCaps`, ni `speedOffset`, ni `beamOffset`, ni `focusOffset` — et fusionne à tort Frost+Focus), au lieu de l'unifié `fixture-analyzer.ts` déjà utilisé par `dmx-cues.ts:17`. Le fix préalable est un switch d'import à 1 ligne. Ensuite, on ajoute 8 `AutoLoopKind` (`color-wheel`, `gobo`, `effect`, `prism`, `beam-zoom/frost/iris/focus`) avec des builders qui activent chaque capacité via `capMid(cap) = (cap.min + cap.max)/2` (jamais de 0/255 codés en dur) et qui balaient 0..255 pour les canaux continus. L'intégration passe par l'extension du `Cap`/`kinds` de `generateLoopLibrary`, de `LoopRecipe` (champ `variant`), des constantes `LOOP_KIND_LABEL`/`LOOP_KIND_ORDER`, et du `KIND_META` de `AutoLoopsPanel.tsx:10`. Les tests s'appuient sur des fixtures synthétiques à capacités min/max (wheel-head, gobo-head, fx-head, prism-head, beam-head) pour verrouiller le respect des plages DMX et le round-trip des recettes.
