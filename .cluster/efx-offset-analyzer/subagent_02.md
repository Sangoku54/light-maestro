# SA-2 — Statut « jaune » d'analyse des fixtures : localisation, critères, causes, plan

Rapport d'analyse (aucun fichier source modifié). Périmètre : `src/engine/fixture-analyzer.ts`, `src/engine/dmx-color.ts`, vues + composants, fixtures custom réelles de l'utilisateur.

---

## (a) Où est le « jaune » ? — Constat principal

**Il n'existe AUCUN badge de statut d'analyse vert/jaune/rouge dans le code.** Recherche exhaustive (`yellow`, `amber`, `coverage`, `analyzed`, `unmapped`, `mapped`, `partial`, `quality`, `unknown`, `warn`) dans `src/views/*` et `src/components/*` : l'analyseur `analyzeFixtureChannels` (fixture-analyzer.ts L242) ne produit **aucun score ni statut de couverture** — il retourne des offsets. Aucun composant ne calcule de couleur à partir d'une couverture d'analyse. L'utilisateur ne peut donc pas voir un « statut d'analyse » qui n'existe pas — le jaune qu'il voit provient d'une des 3 sources suivantes, toutes identifiées :

### Source 1 — Pastille d'identité de fixture (cause la plus probable)

**Fichier : `src/stores/showStore.ts` L1064-1073**
```ts
const FIXTURE_COLORS = [
  '#ff0064', '#6400ff', '#00c8ff', '#ffc800',   // index 3 = JAUNE
  '#00ff88', '#ff6600', '#ff00cc', '#00ffcc',
  '#cc00ff', '#ffcc00', '#0064ff', '#ff0099',   // index 9 = JAUNE
  '#44ff44', '#ff3300', '#9900ff', '#00e5ff',
  '#ff8800', '#8800ff', '#00ffaa', '#ff0044',
  '#4488ff', '#ff4488', '#44ffcc', '#ffaa00',   // index 23 = jaune-orange
];
export function getFixtureColor(index: number): string // L1071-1073
```
La pastille colorée d'une fixture est **fonction de son index de patch** (pas de son analyse). 3 teintes jaunes sur 24 → toute fixture patchée en 4ᵉ, 10ᵉ ou 24ᵉ position est durablement « jaune ». Affichée comme pastille unique (2×2 px) ou **disque plein** :

| Vue | Fichier + lignes | Index utilisé |
|---|---|---|
| Patch → table « Patched Fixtures » | DesignView.tsx L4602-4603 + pastille L4619 (`fixtureColorIndex.get(f.id) ?? 0`) | index **dans l'univers** (L4255-4256) |
| Patch → « DMX Address Map » | DesignView.tsx L5085 (`baseColor = getFixtureColor(cIdx)`) → cellules du grid | index dans l'universe (L4567 `colorIndex={fixtureColorIndex}`) |
| SceneEditor → sections par tier | DesignView.tsx L1390 (`allFixtures.indexOf(pf)`) + pastille L1401 | index **global** |
| Vue 2D (Stage2DEditor) | Stage2DEditor.tsx L216-217 (`color = getFixtureColor(i)`), disque plein L275-278 (`ctx.fillStyle = … : color`) | index global |
| Bouton test patch | DesignView.tsx L5800 (`isTesting ? '#10b981' : getFixtureColor(i)`) | index global |

**Point clé Stage2D L238-240 + L271-283** : si la fixture a une `thumbnailId`, on dessine l'image + contour tier (violet/bleu/gris). Sinon → **disque entièrement rempli avec la couleur d'identité**. Les 2 fixtures custom (`custom-tonio-6-arm`, `custom-stage-right-stage-wash-7x10w`) ont été patchées avant l'arrivée des thumbnails (`addThumbnailId` DesignView L4160, bouton Patch désactivé sans vignette L5711 `disabled={!thumbnailId}`) → **pas de thumbnailId** → disques pleins. Si leurs index tombent sur 3 ou 9 → **2 heads affichées en jaune plein et permanent**, dans toutes les vues d'édition/analyse. L'utilisateur interprète ces pastilles comme un état de validation.

⚠️ Incohérence annexedétectée au passage : la même fixture a un index différent entre la table patch (index par univers, L4255) et le SceneEditor/vues 3D-2D (index global, L1390) → sa couleur peut changer d'une vue à l'autre, ce qui renforce l'impression d'un « statut ».

### Source 2 — Beam/lumière 3D jaune (fallback HSL de la roue couleur)

**Fichier : `src/views/Stage3D.tsx` L228-253**
```ts
function wheelValueToColor(value, caps) { …
  // Fallback: map value 0-255 to hue
  return new THREE.Color().setHSL(value / 255, 1, 0.5);   // L253
}
```
Utilisé L1621-1630 : si la fixture a un `wheelOffset` mais des `wheelCaps` vides (ou sans `cap.color`), la lumière/beam 3D prend la couleur **arbitraire** hue = valeurDMX/255 (saturation 1). Valeurs ≈ 30-53 → **jaune**. Or `analyzeFixtureChannels` crée un `wheelOffset` **sans caps** dans la branche « canal couleur unique sans capabilities » (fixture-analyzer.ts L567-574 : `wheelCaps` n'est rempli que si le canal porte des caps — L578-584). Toute head avec un canal « Color/Colour » nu (fréquent en définitions custom/QLC+) → beam 3D de couleur arbitraire, souvent jaune. C'est exactement la famille de bug déjà corrigée côté laser (voir test `src/__tests__/tonio-color-routing.test.ts` L5-6 : « le laser RG sans bleu restait en couleur arbitraire **(jaune)** avant le routing v2 »).

### Source 3 — Faux positifs écartés

- DesignView L4873 : badge **par canal** « Intensity » jaune dans FixtureDetailModal — pas par head.
- DesignView L695 : état drag du dossier « non classé » ; L2296/L3048 : boutons Pause/Charger preset ; L3937 : bouton Stop EFX — pas des fixtures.
- QuickShowView L3048/3080/3108/4036 : boutons preset + bandeau « aucun effet custom » — pas des fixtures.
- ShowManager L850, TrackTimeline L3395+ : contrôles transport / label strobe.
- PerformanceView L3563/3836 : statut de connexion MIDI (vert/ambre/gris).

---

## (b) Canaux reconnus vs non reconnus (`analyzeFixtureChannels`, fixture-analyzer.ts)

### Chaîne de décision (L242-427, L526-599)
1. L308 : preset/mode (`isPresetMode` = `/presets?|macro|auto|sound/i`, dmx-color.ts L88) — **uniquement sans capabilities**.
2. L316 : `Macro` sans capabilities → `macroOffsets` (exclu).
3. L321-325 : `Dimmer` typé `Shutter` → intensityOffset.
4. L347 : collecte couleur — `isRgbNamed` (L340), nom laser couleur (isLaser), `startsWithRgb`, `type === 'Colour'`, `Beam` + `hasColorWord` (dmx-color.ts L81 — inclut le mot **« laser »** !), ou **`hasColorCaps`** (toute cap avec `color`).
5. L372-380 : canal « Strobe » par nom (garde `STROBE_EXCLUDE_RE` L47).
6. L383-426 : routing laser par nom (mode, scan X/Y, pattern, rotations, blanking, gate couleur).
7. L427 switch par type : `Intensity` L428, `Shutter/Strobe` L436, `Effect` L441, `Pan` L453 (fine → panFineOffset L455), `Tilt` L458, `Gobo` L463, `Prism` L469, `Zoom` L474, `Frost` L478, `Focus` L481, `Iris` L484, `Speed` L487, `Beam` L491 (routage par nom zoom/frost/iris/focus), `Macro` L514 (prism/gobo/effect/speed par nom).
8. L526-574 : résolution couleur (segments RGBW par **famille de nom** — routing v2 dmx-color.ts L133-175, accepte R+G sans B `b:null`) ; sinon roue par caps couleur L551 ; sinon RGB forcé L556 ; sinon roue mono-canal L567.

### ✅ Reconnus (routés vers un rôle exploitable)
`Intensity`/`Dimmer` (+ hybride « Dimmer / Strobe » typé Shutter), `Shutter`, `Strobe` (par nom même typé Effect), `Effect`, `Pan`/`Tilt` **typés** (multi-bras : tous les offsets, cf. note multi-pan-tilt), fine **typés Pan/Tilt**, `Gobo`, `Prism`, `Zoom`/`Frost`/`Iris`/`Focus` (y compris typés `Beam`), `Speed` (le 1ᵉʳ), `Colour`/RGB/RGBW multi-segments, roue couleur à caps `color`, macro couleur, canaux laser (mode/pattern/scan/rotation/blank/gate).

### ❌ Non reconnus → restent « orphelins » (aucun rôle, aucun mapping)
1. **Fines typées `Nothing`** — ex. « Pan fine »/« Tilt fine » de la Stage Wash 14ch (type `Nothing`) : le rattachement fine n'existe QUE dans `case 'Pan'`/`case 'Tilt'` (L453-462). Un canal nommé fine mais typé Nothing/Speed est ignoré → `panFineOffset/tiltFineOffset` restent null.
2. **`Nothing` générique** (Reset, Auto/Sound Mode, NoFunction) — pas de case → ignoré (OK fonctionnellement, mais non « couvert »).
3. **Roue preset sans `cap.color`** — ex. « Color Presets » (caps `ColorPreset`/`Seven Colors` sans champ `color`) : collecté comme couleur (L347 via type `Colour`), puis **orphelin** après le routing par famille (dmx-color.ts L141-147 : `pickIn(isRed)` échoue) → `wheelOffset` non setté alors qu'une vraie roue 7 couleurs existe (Stage Wash 14ch). La branche roue L551 exige `hasColorCaps`.
4. **`cap.color` sur un canal fonctionnel** — « Macro fonction » du Tonio (type `Macro`, caps avec `color:"#ff0000"`) : avalé par L347 (`hasColorCaps`) AVANT le case `Macro` → jamais routé en `effectOffset` ; il finit orphelin dans `colourChannels` (famille « macro fonction » sans R/G/B, log confirmé : `colourChannels: 11 [... Macro fonction@21]`). L'auto-run/sound du Tonio n'est pas pilotable.
5. **Types OFL sans case** : `Maintenance`, `Program`, `NoFunction`, `Nothing`, et 2ᵉ/3ᵉ canal `Speed` (« Color Effect Speed », « Strobe Speed » — exclu du strobe dédié par `STROBE_EXCLUDE_RE` mais pas routé en speed non plus).
6. **Noms courants sans type fiable** : « Movement Speed », « Lamp On/Off », « Display », « Blackout », « Sound Active », « Gobo Rotation », « Prism Rotation », « CTO/CTB/Color Temperature » (typé Colour → orphelin quand un RGB existe déjà), « Beam Size/Aperture » (typé Beam sans mot-clé zoom/frost/iris/focus → beamOffset générique, non exploité).

### Cas multi-modes & caches
- L'analyse ne regarde **que** `def.modes[pf.modeIndex]` (L254). Changer de mode re-analyse (la Map est recalculée dans DesignView L1009-1016) — OK. Le log de debug `_logged` (L607) est dédupliqué par `pf.id` : après un changement de mode, **plus aucun log** → diagnostic impossible (piège documenté).
- `dmx-channel.ts` (ancien analyseur, L33 : `isPresetMode.test(chName)` **sans** garde caps) n'est plus importé par personne — fichier mort à supprimer pour éviter une régression si quelqu'un le réimporte (la note `.openclaw/notes/multi-pan-tilt.md` le cite encore comme actif).

---

## (c) Causes probables des « 2 heads jaunes » (cas concrets des 2 customs)

Les 2 heads custom de l'utilisateur : `custom-tonio-6-arm.json` (22ch) et `custom-stage-right-stage-wash-7x10w-led-moving-head.json` (9ch/14ch).

### Cause 1 (dominante) — Pastille d'identité jaune + pas de thumbnail
- Les 2 customs sont patchées manuellement → pas de `thumbnailId` → **disque plein** en vue 2D (Stage2DEditor L275-278) + pastille nue partout ailleurs.
- Avec ≥ 10 fixtures patchées, il suffit que Tonio et Wash occupent des index 3/9/23 pour que **les 2 seuls disques jaunes** de la scène soient… ces 2 heads. Elles « restent » jaunes car la couleur est figée par l'index, jamais par une analyse.
- L'utilisateur connecte « jaune » ↔ « analyse incomplète » alors que l'UI ne porte aucun statut d'analyse. **Le fond de sa demande reste légitime** : l'analyse de ces 2 fixtures a des trous réels (causes 2-4), et l'UI ne permet pas de distinguer une couleur d'identité d'un état.

### Cause 2 — Stage Wash : fines typées `Nothing` non rattachées (14ch)
- « Pan fine » @1, « Tilt fine » @3 (type `Nothing`) → orphelins → `panFineOffset/tiltFineOffset = null`. Mouvement limité à 8 bits, et 2 canaux « non couverts ».

### Cause 3 — Stage Wash 14ch : roue « Color Presets » perdue
- Caps sans `color:true` → jamais `wheelOffset` → la roue 7 couleurs réelle est inutilisable par la genCues/le show (en 9ch il n'y a pas de roue, donc la perte n'apparaît qu'en mode 14ch).

### Cause 4 — Tonio : « Macro fonction » avalé par la collecte couleur
- Caps `color:"#ff0000"` arbitraires (éditeur custom) → `hasColorCaps` → exclu du case `Macro` → `effectOffset` jamais setté → l'effet macro (auto-run/sound) non pilotable, canal non couvert.
- Les lasers RG sont correctement couverts depuis le routing v2 (test `tonio-color-routing.test.ts` : 3 segments, `R19G20Bnull`, log réel du 28/08 : `rgbSegments: R11G12B13; R15G16B17; R19G20Bnull`, `laser: true (rgb)` ✓ — le « jaune arbitraire » du laser RG est bien mort côté analyse).

### Cause 5 — Beam 3D jaune (roue sans caps)
- Toute head avec un canal couleur unique sans caps colorées → `wheelValueToColor` fallback HSL (Stage3D L253) → beam de couleur arbitraire (jaune vers value≈32-53). Si les 2 heads concernées passent par ce chemin dans un preset, leurs beams restent « jaunes » à l'écran indépendamment de l'analyse.

---

## (d) Plan d'optimisation priorisé

### P0 — Dissiper la confusion « pastille = statut » (patch minimal, ~4 lignes)
1. **Palette** : remplacer les 3 jaunes de `FIXTURE_COLORS` (showStore.ts L1067 `'#ffc800'`, L1069 `'#ffcc00'`, L1072 `'#ffaa00'`) par des teintes non-confondables avec les états (ex. `#00b8d4`, `#e91e63`, `#7cb342`). Résiduel : les projets sauvegardés gardent leurs index → la couleur change simplement.
2. **Indice visuel « analyse » au patch** (si on veut un vrai statut, il faut le créer) : ajouter à `FixtureChannelAnalysis` un champ `coverage: { mapped: number; total: number; score: number }` calculé en fin d'`analyzeFixtureChannels` (compter les offsets routés / total des canaux hors presetOverride). Afficher un anneau/badge dans la table Patch (DesignView L4602) : **vert ≥ 80 %**, jaune 50-79 %, rouge < 50 % — avec tooltip listant les canaux non mappés. C'est l'objet que l'utilisateur croit déjà voir : autant le rendre réel et explicite.

### P1 — Combler les trous d'analyse réels (fixture-analyzer.ts)
3. **Rattacher les fines typées Nothing/Speed** : après le switch (L427-523), fallback : si `chName` matche `/\b(fine|precision)\b/i` ET `/pan|pann?\b|x[- ]?axis/i` → `panFineOffset` (si null) ; tilt idem. Garde : ne PAS l'ajouter à `panOffsets[]/tiltOffsets[]` (règle multi-pan-tilt).
4. **Roue orpheline** : après le routing par famille, si `wheelOffset === null` et qu'il reste des `colourChannels` non appariés portant ≥ 2 caps avec des noms couleur/preset (`/colou?r|preset|wheel/i` ou `matchCapToCategory` > 0) → en faire la roue (`wheelOffset/wheelCaps`). Corrige « Color Presets » de la Wash en 14ch.
5. **Ne pas laisser `hasColorCaps` avaler un canal fonctionnel** (L347) : exclure de la collecte couleur les canaux `type === 'Macro'|'Effect'` dont le nom matche `/function|fonction|macro|mode/i` (sauf `isLaser`), et les router dans le switch (case Macro L514 les traite déjà). Corrige « Macro fonction » du Tonio.
6. **2ᵉ canal Speed nommé** (« Color Effect Speed », « Strobe Speed ») → `speedOffset` secondaire ou `effectSpeedOffset` (nouveau champ) ; minimum : les compter comme couverts dans le coverage P0-2.

### P2 — 3D : tuer le jaune arbitraire
7. **Stage3D L1627-1630** : `color = cm.wheelCaps.length ? wheelValueToColor(wheelVal, cm.wheelCaps) : new THREE.Color(0xffffff)` — roue sans caps → blanc (jamais de hue arbitraire). Même garde dans la branche laser L1563-1566.
8. **Log d'analyse** : clé de dédup `_logged` par `${pf.id}@${pf.modeIndex}` (L607) pour que le log réapparaisse après changement de mode.

### P3 — Hygiène
9. Supprimer `src/engine/dmx-channel.ts` (mort, non importé, contient la variante buguée `isPresetMode` sans garde caps L33) et mettre à jour la note `.openclaw/notes/multi-pan-tilt.md` qui le référence.
10. Ajouter au test `library-coverage.test.ts` un invariant I4 : « aucune fixture n'a de colourChannel orphelin portant des caps preset/couleur » (garde-fou du P1-4).

### Patch minimal proposé (si une seule passe)
- showStore.ts : 3 couleurs (P0-1).
- fixture-analyzer.ts : fallback fines (P1-3) + roue orpheline (P1-4) + exclusion fonctionnelle (P1-5) — ~25 lignes, aucune signature publique changée.
- Stage3D.tsx : garde blanc roue vide (P2-7) — 1 ligne.
- Tests à verrouiller après patch : `tonio-color-routing.test.ts` (doit rester 3 segments), `tonio-strobe.test.ts`, `library-coverage.test.ts` (I1-I3), `gencues.test.ts`, `dimmer-track.test.ts` (la Wash passe par le chemin Dimmer/Shutter hybride).

### Validation attendue pour les 2 heads de l'utilisateur
- Tonio 6 arm : coverage 100 % attendu (pan 0, tilts 2-8, dimmer 9, strobe 10, 2 segments RGBW, laser RG, macro → effect) ; disque 2D redevient une identité non-confondable.
- Stage Wash : fines rattachées (14ch), roue Color Presets exploitable, « Auto/Sound » et « Reset » documentés comme volontairement non pilotés dans le tooltip de coverage (canal utilitaire ≠ canal manquant).
