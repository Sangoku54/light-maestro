# Audit de fidélité — `autoloop-types.ts` vs prototype Python `autoloop/`

**Objet** : contrat TypeScript `src/engine/autoloop-types.ts` audité contre le
prototype Python (`models.py`, `generator.py`, `banks.py`, `playback.py`).

**Conclusion générale** : le port est fidèle à ~90 %. Une **divergence bloquante**
porte sur les **valeurs de chaîne de `FixtureCategory`** (snake_case TS vs
PascalCase Python). Une **divergence mineure** porte sur l'**arrondi** de
`clampDmx` (banker's rounding Python vs half-up JS). Le reste est conforme.

---

## Conformité par point

### Point 1 — `clampDmx` (ordre borne-puis-arrondi) : **ÉCART (mineur, non bloquant)**

- **Ordre des opérations** : identique. Python `int(round(max(0.0, min(255.0, v))))`
  et TS `Math.round(Math.max(0, Math.min(255, v)))` bornent **avant** d'arrondir.
  La garantie « 255.6 ne devient pas 256 » est conservée. ✅
- **Arrondi** : **divergence**. Python `round()` (float) applique l'**arrondi
  bancaire** (*banker's rounding*, au pair le plus proche) ; `Math.round` applique
  l'**arrondi half-up** (vers +∞). Sur les valeurs exactement à `.5` :

  | valeur | Python `round` | JS `Math.round` |
  |--------|----------------|-----------------|
  | 0.5    | 0              | 1               |
  | 1.5    | 2              | 2               |
  | 2.5    | 2              | 3               |
  | 3.5    | 4              | 4               |
  | 254.5  | 254            | 255             |

  Divergence uniquement sur les `.5` **impairs** (0.5, 2.5, 4.5…). Après clamp,
  l'intervalle est [0, 255] donc 255.5 ne peut pas survenir. En pratique, les
  sorties trigonométriques ne tombent quasiment jamais sur un `.5` exact, donc
  l'impact est un écart DMX de ±1 sur des cas rarissimes — **non bloquant**,
  mais à connaître si une conformité bit-à-bit est exigée.

### Point 2 — `computePan` / `computeTilt` : **OK**

Formules identiques à `PositionCue.pan/tilt` :

- **Cercle** : `pan = center + r·cos(ω·beat + φ)`, `tilt = center + r·sin(ω·beat + φ)` ✅
- **Huit (Lissajous 1:2)** : `pan = center + r·sin(ω·beat + φ)`,
  `tilt = center + r·sin(2·ω·beat + φ)` ✅ (tilt à fréquence double) ✅

Le TS retombe sur la même branche par défaut (`if circle ... else figure_eight`),
exactement comme le Python (`if CIRCLE ... # FIGURE_EIGHT`). Aucune différence.

### Point 3 — `timelineLengthBeats` = `bars * 4` : **OK**

Python `length_beats()` = `self.bars * 4` (littéral) ; TS
`timeline.bars * BEATS_PER_BAR` avec `BEATS_PER_BAR = 4`. Sémantiquement identique
(le littéral Python est simplement promu en constante nommée côté TS).

### Point 4 — `RepeatMode` : **OK**

TS `'infinite' | 'track_duration'` correspond exactement aux valeurs de l'enum
Python : `INFINITE = "infinite"`, `TRACK_DURATION = "track_duration"`. ✅

### Point 5 — `FixtureCategory` : **ÉCART (BLOQUANT — fidélité)**

Le TS déclare :

```ts
export type FixtureCategory = 'wash_primary' | 'wash_secondary' | 'spot';
```

L'enum Python `FixtureCategory(str, Enum)` porte les **valeurs** :

```python
WASH_PRIMARY    = "Wash_Primary"
WASH_SECONDARY  = "Wash_Secondary"
SPOT            = "Spot"
```

Les littéraux TS (`wash_primary`/`wash_secondary`/`spot`) ne correspondent **ni aux
noms de membres** (`WASH_PRIMARY`…) **ni aux valeurs** (`"Wash_Primary"`…).

Pourquoi c'est bloquant :
1. `generator.py` génère l'id de timeline avec `f"autoscript-{category.value}-{target_bars}b-…"`,
   soit `autoscript-Wash_Primary-8b-1` — un port fidèle produirait donc des ids
   différents.
2. Toute sérialisation/desérialisation croisée (JSON de fixtures/timelines partagé
   avec le prototype, tests golden) casse : `"Wash_Primary"` côté Python ne
   matchera pas `'wash_primary'` côté TS.
3. Le filtrage `f.category == category` dans `generate_autoscript` compare des
   valeurs ; si les fixtures TS sont construites avec `'wash_primary'` alors que
   l'`AutoloopTimeline.category` attend la même chaîne, le filtre fonctionne en
   interne TS, mais rompt l'interopérabilité avec le modèle de données Python.

### Point 6 — `ChannelKey` (convention « adresse DMX absolue en chaîne ») : **OK**

- Champs : `channel: string`, `beat: number`, `value: number`, `rampBeats?: number`
  ↔ Python `channel: str`, `beat: float`, `value: int`, `ramp_beats: float = 0.0`. ✅
- La **double convention** est bien documentée côté TS : le générateur encode
  l'adresse DMX absolue en chaîne (`str(address)`, ex. `"13"`), et le moteur
  accepte aussi un nom logique remappé via `channelMap`. C'est exactement le
  comportement de `_resolve_address` dans `playback.py` (`channel_map.get(channel)`
  puis `int(channel)`). ✅
- `string` couvre les deux formes (aucun discriminant nécessaire ; Python fait de
  même avec `str`). ✅

### Point 7 — `AutoloopFixture` vs `_channel_address` : **OK**

TS `AutoloopFixture` : `id: string`, `category`, `universe: number`,
`address: number` (1-based), `channelMap: Record<string, number>` (offset 0-based).

↔ Python `Fixture` : mêmes champs (`address` 1-based, `channel_map` offset 0-based). ✅

La règle `_channel_address = fixture.address + offset` (1-based + 0-based) est
cohérente avec les conventions documentées des deux côtés. La fonction elle-même
n'appartient pas à ce fichier (elle sera dans `autoscript-generator.ts`), mais le
**contrat de données** est correct. ✅

> Note : le renommage `Fixture` → `AutoloopFixture` est un choix de naming
> documenté, sans impact sémantique.

### Point 8 — `AutoloopTimeline` : **OK** (note mineure)

Champs : `id`, `bars`, `category`, `keys`, `positionCue?` couvrent bien tout ce
que `generator.py` produit (`id, bars, category, keys, position_cue=None`) et tout
ce que `playback.py` consomme (`bars`, `keys`, `length_beats()`, `position_cue`). ✅

- `positionCue?: PositionCue | null` est plus large que Python
  (`position_cue: PositionCue | None = None`) : compatible. ✅
- `length_beats()` est une **méthode** en Python mais une **fonction standalone**
  `timelineLengthBeats(timeline)` en TS. Ce n'est pas un écart de type, mais les
  modules dépendants (`autoloop-engine.ts`) doivent impérativement passer par la
  fonction (ne pas chercher `loop.lengthBeats()`). ✅
- **Note mineure** : Python définit `keys: list[ChannelKey] = field(default_factory=list)`
  (champ **omissible**, défaut `[]`), alors que TS déclare `keys: ChannelKey[]`
  **requis**. En pratique `generator.py` émet toujours `keys`, donc l'impact est
  nul pour le flux nominal ; si une timeline vide (ex. banque vierge) devait être
  matérialisable sans `keys`, il faudrait passer à `keys?: ChannelKey[]`.

### Point 9 — `PositionCue` / `AttributeCue` (champs + défauts) : **OK** (note mineure)

**PositionCue** — champs identiques : `id`, `shape`, `speed` (float), `phase`
(float), `radius` (0..128), `centerPan/centerTilt` défaut 128. ✅

- `radius` : TS `number` (doc 0..128) ↔ Python `int` (doc 0..128). Aucune
  vérification de borne d'aucun côté (ni nominal TS ni runtime Python). ✅
- **Note mineure** : Python pose `center_pan: int = 128` **au constructeur**
  (champ toujours présent), tandis que TS les déclare optionnels et applique le
  défaut **au calcul** (`cue.centerPan ?? 128` dans `computePan/computeTilt`).
  Sémantiquement équivalent **tant qu'on passe par ces fonctions** ; un
  consommateur qui lirait `cue.centerPan` directement obtiendrait `undefined` au
  lieu de `128`.

**AttributeCue** — champs identiques : `id`, `attribute`, `values`, `rampBeats`
(défaut 0 = snap), `interpolate` (défaut true). ✅

- `rampBeats?: number` / `interpolate?: boolean` sont optionnels ; le défaut est
  porté par le commentaire, pas par le type. Les modules dépendants devront
  appliquer `rampBeats ?? 0` et `interpolate ?? true` (comme le fait implicitement
  `generator.py` via les défauts de dataclass). ✅

---

## Écarts bloquants

1. **`FixtureCategory` — valeurs de chaîne divergentes** (point 5).
   C'est le seul écart qui **casse la fidélité** : les littéraux TS
   (`'wash_primary' | 'wash_secondary' | 'spot'`) ne correspondent pas aux valeurs
   réelles de l'enum Python (`"Wash_Primary" | "Wash_Secondary" | "Spot"`).
   Conséquence directe : ids de timeline (`autoscript-…`) non reproductibles,
   sérialisation croisée et tests golden rompus.

Aucune divergence ne casse la **compilation** (le fichier TS est syntaxiquement et
typiquement valide). Les autres points signalés (arrondi, `keys` requis, défauts
résolus au calcul) sont des **écarts de fidélité mineurs**, pas bloquants.

---

## Recommandations

### R1 (obligatoire) — corriger les littéraux de `FixtureCategory`

Remplacer :

```ts
export type FixtureCategory = 'wash_primary' | 'wash_secondary' | 'spot';
```

par :

```ts
export type FixtureCategory = 'Wash_Primary' | 'Wash_Secondary' | 'Spot';
```

⚠️ Effet de bord : tout module TS qui référence déjà les littéraux snake_case
(`'wash_primary'`, etc.) devra être mis à jour. Vérifier `autoscript-generator.ts`,
`autoloop-engine.ts`, `autoloop-banks.ts` et tout seed/fixture de test.

### R2 (recommandé) — aligner l'arrondi de `clampDmx` si fidélité bit-à-bit exigée

Si une conformité exacte avec `round()` de Python est requise (tests golden
comparant les valeurs DMX émises), remplacer l'implémentation par un arrondi
bancaire (half-to-even) :

```ts
function roundHalfToEven(x: number): number {
  const r = Math.round(x);
  // Si la partie fractionnaire est exactement 0.5, arrondir au pair le plus proche.
  if (x - Math.floor(x) === 0.5) {
    return 2 * Math.round(x / 2);
  }
  return r;
}

export function clampDmx(v: number): number {
  return roundHalfToEven(Math.max(0, Math.min(255, v)));
}
```

Sinon (si l'écart de ±1 DMX sur les `.5` exacts est jugé négligeable), **documenter
explicitement** la divergence dans le commentaire JSDoc de `clampDmx` pour éviter
toute surprise future.

### R3 (facultatif) — `keys` optionnel pour refléter le défaut Python

Pour refléter `field(default_factory=list)` et permettre une timeline vide sans
`keys` :

```ts
export interface AutoloopTimeline {
  id: string;
  bars: number;
  category: FixtureCategory;
  keys?: ChannelKey[];
  positionCue?: PositionCue | null;
}
```

Puis appliquer `timeline.keys ?? []` dans les consommateurs. Facultatif : le flux
nominal (`generator.py` → `playback.py`) émet toujours `keys`.

### R4 (documentation) — consigner la résolution des défauts

Préciser, dans `PositionCue`/`AttributeCue`, que les champs optionnels sont résolus
par les fonctions de calcul (`centerPan ?? 128`, `centerTilt ?? 128`,
`rampBeats ?? 0`, `interpolate ?? true`) — pour que `autoscript-generator.ts` et
`autoloop-engine.ts` appliquent les mêmes défauts que les dataclasses Python.
