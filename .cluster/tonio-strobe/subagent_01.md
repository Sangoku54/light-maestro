# Audit « Vérificateur analyseur » — Fix strobeOffset (Tonio 6 arm strobe permanent)

Date : 2026-08-27 · Agent : subagent vérificateur · Périmètre : `src/engine/fixture-analyzer.ts` + consommateurs + bibliothèque réelle (mesures empiriques).

---

## VERDICT

**Le fix est faisable, mais la regex naïve `/\bstrobe\b/i` est DANGEREUSE : elle casserait ~97 fixtures de la bibliothèque réelle (movers/washes dont le canal « Shutter / Strobe » — leur VRAI shutter — serait détourné vers `strobeOffset`).** La variante restreinte (exclusion des composites) est sûre : **138 fixtures corrigées, 0 régression**.

**Deuxième verdict critique : la classification seule ne tue PAS le strobe utilisateur sur les fixtures non-laser.** Le « safety net » de `dmx-cues.ts` (L1024-1043) écrit 128 sur les canaux jamais écrits ; sur un canal « Strobe » QLC+ (caps typiques : 0-6 Open, 7-255 strobe/pulse/ramp), **128 est dans la zone strobe/pulse** (vérifié : AFX-LMH460Z 70-128=Pulse, Mega Par Profile Plus 128-159=Pulse). Le fix transforme donc 255 (strobe max) en 128 (pulse) pour les non-lasers : mieux, mais pas réglé. **Un consumer « strobe-safe » (écrire la valeur Open/off) est nécessaire** pour le fix utilisateur complet.

**Troisième point : 1 test existant casse** (`laser-exploit.test.ts` L101, DS-1000 « Strobe Effect ») — et c'est une correction légitime (voir Risque R3).

---

## Le mécanisme du bug (validé empiriquement)

1. **Déf custom Tonio** (`custom-tonio-6-arm.json`, canal 11 « Strobe » type `Effect`, sans caps) — mesuré via `diag-tonio.test.ts` (DIAG_TONIO réel) :
   - `effectOffset: 10`, `shutterOffset: null`, `effectCaps: null`, `rgbOffsets: [11,12,13]`, **`isLaser: true`** (la Tonio EST détectée laser : canaux « Red laser »/« Green laser » matchent la signature `/laser/i` de `isLaserFixture` L235-240).
   - Le canal Strobe n'est jamais animé (ch11=0 sur toutes les cues du diag). Il est écrit à 0 par le **safety net** (L1024-1043 : `channelValues[addr] = fa.isLaser ? 0 : 128`), pas par un bloc dédié.
2. **Déf QLC+ (.qxf)** — `electron/fixtures/library.ts` L832 : un canal dont le nom contient « strobe » est typé `'Strobe'` → le switch `fixture-analyzer.ts` L387-389 (`case 'Shutter': case 'Strobe':` → `shutterOffset`) → bloc shutter `dmx-cues.ts` L824-836 écrit **`SHUTTER_OPEN_SAFE = 255`** → sur la Tonio, 255 = strobe → **strobe permanent**. C'est le bug utilisateur.
3. **Chemin 2c** `dmx-cues.ts` L815-817 : un `effectOffset` SANS caps reçoit `8 + ((cueIndex % 24) * 10)` → valeurs 8-238 → strobe. Non déclenché sur la Tonio (rgbOffsets non-null), mais actif sur des fixtures sans RGB avec canal Effect sans caps.
4. **Même famille de bug ailleurs** : Showtec Dominator (« LED Strobe »/« Laser Strobe »), DS-1000 (« Strobe Effect » 1-255=ShutterStrobe → 255 = strobe permanent latent dans les boucles laser `auto-loops.ts` L249), ~138 fixtures réelles.

---

## Vérification des 7 points demandés

### 1. Ordre des checks par nom + insertion — CONFIRMÉ, insertion entre L313 et L320
Boucle actuelle (lignes réelles) :
- L274 `presetOverrideOffsets` (isPresetMode && !caps)
- L282 `macroOffsets` (type Macro && !caps)
- L286-289 `isShutterDimmer` (nom « dimmer » + type Shutter → intensityOffset)
- L300 `isLaserColorNamed` (isLaser + rouge/vert/bleu + **`!COLOUR_AUX_RE`** → « Strobe » déjà exclu)
- L309 gate couleur laser (`hasLaserColorGateCaps`) → continue
- L312-313 collecte couleur → `continue`
- **L315-318 = point d'insertion du check strobe (après la collecte couleur, avant le `if (isLaser)` L320)**
- L320-376 routing laser (gated isLaser) : AUCUNE regex ne matche « Strobe » (vérifié une à une : mode/scan speed/pattern speed/rotations/X-Y axis/horizontal-vertical/blank/pattern) → un canal « Strobe » laser tombe dans le switch aujourd'hui
- L379 `switch (ch.type)` — L387-389 `case 'Shutter': case 'Strobe':` → shutterOffset ; L391 `case 'Effect':` → effectOffset

**Un canal nommé « Strobe » (type Effect/Shutter/Strobe/Nothing) n'est attrapé par AUCUN check avant le switch** → le check par nom est nécessaire et non conflictuel, à condition d'être **avant le switch**. Position après la collecte couleur : les canaux *strobe* typés Colour (18 dans la bibliothèque : « Strobe Red/Green/Blue/Amber », « Red/Green/Blue/White Strobe »…) restent dans `colourChannels` → **zéro régression RGB**.

### 2. COLOUR_AUX_RE (L16) — CONFIRMÉ, déjà aligné
`COLOUR_AUX_RE = /rotation|rolling|move|movement|speed|scan|strobe|effect|macro/i` contient **déjà « strobe »**. Utilisé à :
- L300 (`isLaserColorNamed`) : un canal nommé « Strobe » n'est jamais un canal couleur laser ;
- L508/L511/L540 (fallbacks RGB) : jamais compté comme 3e canal RGB.

Le nouveau check est **indépendant et complémentaire** — aucun conflit.

### 3. Tests laser (L93 / L409 / L101) — L93 et L409 SANS impact, **L101 CASSE**
- **L93** (`effectOffset` null, EL-400) : la def `laserWheel` n'a AUCUN canal *strobe* → non affecté.
- **L409** (`effectOffset` null, « Show Mode » laser) : idem, non affecté. (Note : la tâche attribuait L93/L409 à « Galaxian 3D / Showtec Dominator » — en réalité ce sont EL-400 et laser-stinger ; Galaxian et Dominator ne sont pas testés sur effectOffset dans ce fichier, mais dans `library-coverage.test.ts` L112-120, qui n'asserte que `laserColorGateOffset`/`laserRotationOffsets` → non affecté.)
- **Galaxian 3D réel** (`ofl/american-dj/galaxian-3d.json`) : canaux « Red Laser », « Green Laser », « Red Laser Rotation », « Green Laser Rotation », « Macros » → **AUCUN canal Strobe** → non affecté (L434 `shutterOffset` null OK).
- **Showtec Dominator réel** : « LED Strobe »@3 + « Laser Strobe »@6 existent, MAIS son `shutterOffset` actuel = « Programs »@0 (premier canal typé Shutter capturé — « Programs » n'est pas attrapé par le routing laser : `/^(show\s*mode|program|show)$/i` ne matche pas « Programs », trailing « s » + ancre `$`). Après fix : `strobeOffset=3`, **shutterOffset inchangé (0)** → `library-coverage` non affecté.
- **⚠ L101 (`expect(fa.shutterOffset).toBe(2)`, DS-1000 « Strobe Effect »@2)** : « Strobe Effect » matche `/\bstrobe\b/i` (variantes A/B/C) → deviendrait `strobeOffset=2`, `shutterOffset=null` → **test rouge**. Variante D (`^Strobe$`) ne matche pas « Strobe Effect » → L101 passerait. Voir R3.

### 4. Shutter ET strobe séparés — CONFIRMÉ, sans conflit
Le check par nom ne capture que les canaux nommés *strobe* ; un canal « Shutter » séparé ne matche pas → reste `shutterOffset` via le switch. Exemple mesuré : `American-DJ-Quad-Phase-HP` (« Strobe »@2 type Nothing + « Shutter »@3) → shutter inchangé, strobeOffset=2. 67 fixtures gardent un `shutterOffset` issu d'un autre nom (aucune régression).

### 5. dmx-cues.ts L40 — PAS lié, rien à casser
L40 est le membre `'Strobe'` de l'union `DmxFixtureChannel['type']` (type de canal, pas un « AnalysisType »). Le switch L387-389 groupe `'Shutter'` + `'Strobe'` → shutterOffset. Après fix, un canal nommé « Strobe » (type quelconque, y compris `'Strobe'`) est capturé par le nom avant le switch. Un canal typé `'Strobe'` sans « strobe » dans le nom est quasi inexistant (l'importeur QLC+ dérive le type DU nom, `library.ts` L832) et resterait shutterOffset — comportement inchangé. **Aucun changement nécessaire dans dmx-cues.ts pour le champ analysé.**

### 6. auto-loops.ts — CONFIRMÉ (fichier exact : auto-loops.ts, pas autoloop-runtime.ts)
- L820 / L1082 : `shutters = fixtures.filter(f => f.analysis.shutterOffset !== null)` → un canal Strobe (désormais `strobeOffset`) n'y figure plus → `buildStrobeLoop` (L340-351, écrit `on ? 255 : 0` sur shutterOffset) ne l'écrit plus. ✓
- L734 / L825 / L1115 : `effects = fixtures.filter(f => f.analysis.effectOffset !== null && (effectCaps?.length ?? 0) > 0)` → exclu. ✓
- Le fix ne touchant qu'à fixture-analyzer, `strobeOffset` est ignoré par ces filtres par construction. ✓

### 7. autoloop-runtime.ts L84 — CONFIRMÉ
`if (fa.effectOffset !== null) channelMap['effect'] = fa.effectOffset;` → Tonio effectOffset=null après fix → pas de canal « effect ». L83 (`shutter`) idem. ✓

---

## Risques (avec mesures)

### R1 — CRITIQUE : regex naïve = ~97 régressions
Mesures sur la bibliothèque réelle (longest mode, 600+ fixtures) :
- **594 canaux** nommés `/\bstrobe\b/i` (types : Shutter 322, Nothing 243, Colour 18, Speed 5, Effect 5, Intensity 1).
- **Variante A naïve `/\bstrobe\b/i`** : **245 fixtures** perdent shutterOffset (dont **84 composites « Shutter… »** (« Shutter / Strobe » ×82, « Shutter/Strobe » ×3…) + 3 « Strobe / Shutter » + 5 « Dimmer / Strobe » + 4 « Strobe Functions » + « Strobe Multifunctional » + « Strobe Patterns »… ≈ **97 composites**), + 4 perdent effectOffset.
- Conséquence : les movers dont le « Shutter / Strobe » est le seul shutter ne seraient plus ouverts → safety net écrit **128** → sur les caps « Shutter / Strobe » QLC+ (zone strobe 96-191) → **strobe permanent sur les movers** : on remplace le bug par un bug pire.
- **Variante B** (`\bstrobe\b` + exclut `shutter|dimmer`) : 152 changements shutter, **0 composite**, 4 effect.
- **Variante C** (`\bstrobe\b` + exclut `shutter|dimmer|function|multifunctional|pattern|speed|frequency|duration|density|intensity`) : **138 changements shutter (tous de vrais canaux Strobe : « Strobe », « Strobe N », « Beam/LED/Laser/12Hz/Extended/Linear Strobe », « Strobe PAR 1 », « Derby 1 Strobe », « Strobe effect », « Clas Strobe »…) + 1 effect (« Clas Strobe », vrai strobe, OK)**. **C'est la variante recommandée.**
- **Variante D** (`^\s*strobe(\s*\d+)?\s*$/i`) : 129 shutter, 0 effect — la plus étroite (préserve L101) mais rate les strobes suffixés (« Strobe Effect », « LED Strobe », « Beam Strobe », « Laser Strobe »…). Acceptable en secours, pas recommandée.

### R2 — CRITIQUE : la classification seule n'éteint pas le strobe des non-lasers
Safety net (`dmx-cues.ts` L1024-1043) : canal non écrit → 0 si laser, **128 sinon**. Sur les canaux « Strobe » QLC+ (vérifié AFX-LMH460Z : 70-128=Pulse ; Mega Par Profile Plus : 128-159=Pulse), **128 = pulse/strobe**. Donc : 255 → 128 (amélioration), pas 0. **Le consumer doit écrire une vraie valeur « strobe off »** : cap `shutterEffect: "Open"` (présente sur LMH460Z 0-6 et Mega Par 32-63) sinon 0. La Tonio, elle, est laser-flag → safety net 0 → OK **si 0 = off sur sa plage Strobe** (à confirmer avec le manuel ; le custom def n'a pas de caps ni defaultValue).

### R3 — Test à mettre à jour : laser-exploit.test.ts L101 (DS-1000 « Strobe Effect »)
Variantes A/B/C → `shutterOffset` null pour le DS-1000. **C'est une correction** : « Strobe Effect » 1-255 = ShutterStrobe → les boucles laser (`auto-loops.ts` L249 etc.) et le bloc shutter écrivent 255 = **strobe permanent latent sur le DS-1000**. Mettre à jour la ligne : `expect(fa.shutterOffset).toBe(null); expect(fa.strobeOffset).toBe(2);` avec un commentaire. (Variante D : test inchangé mais fix incomplet.)

### R4 — dmx-helpers.ts L123-141 échappe au fix
`buildFixtureOnChannelValues` (« Allumer ») fait sa propre analyse **par type** (`ch.type === 'Shutter'` → écrit 255, L137-141). Un « Strobe » QLC+ typé Shutter/Strobe recevra **toujours 255** ici. À corriger (déléguer à l'analyseur ou appliquer la même exclusion par nom).

### R5 — dmx-cues.ts 2c (L815-817)
Après fix, le « Strobe » Effect sans caps n'est plus effectOffset → 2c ne l'écrit plus. Les canaux Effect légitimes sans caps (autres fixtures) continuent — pas de régression.

### R6 — Legacy dmx-channel.ts (vestigial)
`dmx-channel.ts` L41 route `'Shutter'` ET `'Effect'` → shutterOffset. **Non importé nulle part dans src/electron** (vérifié) → aucun impact, mais si un jour on le réactive, il faudra le même traitement.

---

## Ordre exact d'insertion du check proposé

**Fichier : `src/engine/fixture-analyzer.ts`**

1. **Constantes** (à côté de `COLOUR_AUX_RE`, L16) :
```ts
const STROBE_NAME_RE = /\bstrobe\b/i;                    // nom du canal
const STROBE_EXCLUDE_RE = /shutter|dimmer|function|multifunctional|pattern|speed|frequency|duration|density|intensity/i; // composites + paramètres
```

2. **Interface** (après `effectOffset` L52-54) :
```ts
strobeOffset: number | null;
```

3. **Initialisation** (bloc L219-221) :
```ts
strobeOffset: null,
```

4. **Boucle — entre L313 (`continue;` de la collecte couleur) et L320 (`if (isLaser) {`)** :
```ts
// Strobe par NOM (avant le switch par type) : un canal nommé « Strobe »
// (type Effect OU Shutter/Strobe, QLC+ .qxf) ne doit JAMAIS finir en
// shutterOffset (les blocs shutter écrivent 255 → strobe permanent) ni en
// effectOffset (jamais écrit, ou écrit comme effet générique). Exclut les
// composites (« Shutter / Strobe », « Dimmer / Strobe », « Strobe Functions »)
// et les paramètres (« Strobe Speed/Frequency/Duration/Density »).
if (STROBE_NAME_RE.test(chName) && !STROBE_EXCLUDE_RE.test(chName)) {
  if (fa.strobeOffset === null) fa.strobeOffset = off;
  continue;
}
```
Positionnement justifié : (a) après la collecte couleur → les *strobe* typés Colour restent couleur (0 régression RGB) ; (b) avant le switch → jamais shutterOffset/effectOffset ; (c) hors du gate `isLaser` → fonctionne pour les non-lasers (le Tonio custom est laser-flag mais d'autres fixtures ne le sont pas) ; (d) le routing laser (L320-376) ne matche pas « Strobe », donc l'ordre laser/check est indifférent — placer avant reste le plus défensif.

---

## Cas limites

| Cas | Comportement après fix (variante C) |
|---|---|
| « Shutter / Strobe », « Strobe / Shutter », « Shutter, Strobe », « Shutter/Strobe » (~92) | **Inchangés** (shutterOffset) — exclus par `shutter` |
| « Dimmer / Strobe », « Dimmer & Strobe » (6), « White/UV Strobe Dimmer » | Inchangés — exclus par `dimmer` |
| « Strobe Functions/Multifunctional/Patterns » (8) | Inchangés — exclus |
| « Strobe Speed/Frequency/Duration/Density », « Zone X Y Strobe Rate/Duration » (48) | Inchangés (restent shutterOffset s'ils y étaient) — exclus |
| « Strobe » exact, « Strobe 1-32 », « Beam/LED/Laser/12Hz/Extended/Linear Strobe », « Derby 1/2 Strobe », « Strobe PAR 1-4 », « Strobe effect/Effect », « Clas Strobe » | **→ strobeOffset** (cible du fix) |
| « Strobe 16bit » + « Strobe 16bit fine » (10) | Coarse → strobeOffset ; fine ignoré (champ unique) |
| « Strobe Red/Green/Blue/Amber », « Red/Green/Blue/White Strobe » (18, typés Colour) | Inchangés (restent colourChannels) |
| « Strobing », « strobe3 » (Cameo Thunder Wash) | Inchangés — `\bstrobe\b` ne matche pas « strobing »/« strobe3 » |
| Multi-strobe (Dominator « LED Strobe »+« Laser Strobe ») | Premier match → strobeOffset ; second avalé par le `continue` ; shutterOffset réel intact |
| Laser DS-1000 « Strobe Effect » | → strobeOffset (fix latent du 255 permanent dans les boucles laser) — test L101 à updater |
| Tonio custom (« Strobe » Effect sans caps) | → strobeOffset ; effectOffset null ; safety net laser → 0 ; **strobe stoppé seulement si 0 = off** |

---

## Recommandations

1. **Adopter la variante C** (regex + exclusions ci-dessus), avec un test de non-régression bibliothèque : comparer avant/après `shutterOffset`/`effectOffset`/`rgbOffsets` de chaque fixture (le bon endroit : `library-coverage.test.ts` — y ajouter un compteur « fixtures dont shutterOffset provient d'un canal nommé strobe »).
2. **Ajouter le consumer « strobe-safe »** (indispensable pour le fix utilisateur) : dans `dmx-cues.ts` après le bloc shutter (L824-836) et dans les baselines `auto-loops.ts` (L249-548) — si `strobeOffset !== null` : écrire la valeur de la cap `shutterEffect: "Open"` (capMid) si présente, sinon 0. **Ne jamais laisser le safety net écrire 128 sur un canal strobe.**
3. **Corriger `dmx-helpers.ts`** (L123-141) : déléguer à `analyzeFixtureChannels` ou appliquer la même logique par nom pour « Allumer ».
4. **Mettre à jour `laser-exploit.test.ts` L101** (shutterOffset null / strobeOffset 2) avec commentaire — c'est le fix, pas une régression.
5. **Vérifier le manuel Tonio** : valeur DMX = « strobe off » sur le canal 11 (0 supposé) pour calibrer le consumer, et ajouter `defaultValue: 0` sur le canal Strobe du custom def (canal jamais écrit → valeur de repos déterministe).
6. **Ajouter `strobeOffset` au debug log** (fixture-analyzer L564) pour le suivi opérationnel.
7. **Optionnel** : `strobeCaps` (comme `effectCaps`) pour permettre au futur consumer d'écrire une valeur caps-aware sur les canaux à caps.

## Fichiers touchés si on implémente
- `src/engine/fixture-analyzer.ts` (champ + init + check) — le seul fichier REQUIS pour la classification.
- Recommandé : `src/hooks/dmx-cues.ts` (consumer strobe-safe + safety net), `src/engine/auto-loops.ts` (baselines), `src/utils/dmx-helpers.ts` (Allumer), `src/__tests__/laser-exploit.test.ts` (L101), `src/__tests__/library-coverage.test.ts` (compteurs), `resources/fixtures/custom/custom-tonio-6-arm.json` (defaultValue).
