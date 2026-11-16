# Implémentation — Sous-menus paramétrables + exploitation des capacités par l'autoscript

Date : 2026-08-23
Demande utilisateur :
1. Toutes les options du menu déroulant « type de canal » de l'éditeur de fixtures doivent avoir le sous-menu paramétrable (capacités min/max/nom, couleur seulement pour Colour).
2. L'autoscript doit analyser et exploiter TOUS les sous-menus (= capacités) de TOUTES les fixtures, pas seulement RGB/pan-tilt/dimmer/shutter.

## Volet 1 — Éditeur de fixtures (`src/views/DesignView.tsx`)

- `CHANNEL_TYPES` étendu : ajout `Zoom`, `Frost`, `Focus`, `Iris` (reconnus par l'analyseur mais absents de l'éditeur).
- Nouvelle constante `CAPABILITY_LABELS` (libellés Colors / Gobo Patterns / Macros, fallback « Capabilities »).
- `addCapability` rendu type-aware : n'ajoute `color` que pour `Colour` (plus de `color:'#ff0000'` parasite sur les non-couleur).
- Les 3 blocs conditionnels (Colour/Gobo/Macro) remplacés par **un seul bloc unifié** rendu pour **tous** les types ; `<input type="color">` conditionné à `ch.type === 'Colour'`.
- Fix du mapping de préchargement du create-tab : `defaultVal`→`defaultValue`, `caps`→`capabilities` (les capacités et défauts n'étaient plus perdus en édition préchargée).

Bonus : généraliser le sous-menu débloque l'édition des capacités `Effect` (déjà consommées par le moteur `effectCaps` mais impossibles à saisir avant).

## Volet 1b — Cohérence éditeur ↔ analyseur

- `src/hooks/dmx-cues.ts` : ajout `'Strobe'` au type `DmxFixtureChannel.type`.
- `src/engine/fixture-analyzer.ts` : ajout `case 'Strobe':` (traité comme `Shutter`) — un canal « Strobe » créé dans l'éditeur pilote désormais le shutter.

## Volet 2 — Générateur d'autoscript (`src/engine/auto-loops.ts`)

- **Prérequis** : switch d'import `./dmx-channel` → `./fixture-analyzer` (analyseur unifié), récupérant `effectCaps`, `speedOffset`, `zoomOffset`, `frostOffset`, `irisOffset`, `focusOffset` corrects (le legacy fusionnait à tort Frost+Focus et ignorait effect/speed).
- 8 nouveaux `AutoLoopKind` : `color-wheel`, `gobo`, `effect`, `prism`, `beam-zoom`, `beam-frost`, `beam-iris`, `beam-focus`.
- Helper `capMid(cap) = round((min+max)/2)` — toute activation de capacité écrit le **milieu de sa plage DMX**, jamais 0/255 codé en dur.
- 5 builders : `buildColorWheelLoop` (chase sur roue, fixtures sans RGB), `buildGoboLoop` (chase de motifs + rotation via `speedOffset`), `buildEffectLoop` (saute le « No Effect » min=0), `buildPrismLoop` (4 états 128/170/255/0), `buildBeamLoop` (sinus 0..255 sur zoom/frost/iris/focus).
- Intégration dans `generateAutoLoops`, `generateLoopLibrary` (extension `Cap`/`kinds`/`switch`) et `generateLoopFromRecipe` (round-trip).
- Champ `variant` ajouté à `AutoLoop`/`LoopRecipe` (gobo rotate/static ; sous-canal beam).

## Volet 2b — UI catalogue (`src/views/AutoLoopsPanel.tsx`)

- `KIND_META` étendu aux 8 nouveaux kinds (icônes + accents) — requis car le type est exhaustif.

## Vérification

- `tsc` (renderer `--noEmit` + electron) : exit 0.
- `vitest` suite complète : **229 tests passés** (16 fichiers), dont 10 nouveaux tests (capacités).

## Revue adversarial + corrections

Revue indépendante (rapport `.cluster/fixture-submenus/review.md`) : verdict initial NO-GO, corrigé.
- **H1 (bloquant, corrigé)** : les boucles `beam-*` ne se généraient pas pour les fixtures réelles qui typent zoom/frost/iris/focus en `Beam` (GDTF `BeamZoom/BeamFocus/… → 'Beam'`). Fix : `case 'Beam'` route désormais par nom (`/\bzoom\b/`, `/\bfrost\b/`, `/\biris\b/`, `/\bfocus\b/`) vers les offsets dédiés, fallback `beamOffset` conservé.
- **M2 (corrigé)** : `isPresetMode` excluait tout canal nommé « macro/auto/sound » avant le switch, y compris ceux porteurs de capacités (« Color Macro », « Prism Macro »). Fix : exclusion seulement si le canal est **sans** capacités (un canal macro-nommé avec caps est un vrai canal à exploiter).
- **M3 (corrigé)** : prism utilisait des états codés en dur. Ajout de `prismCaps` à l'analyseur ; `buildPrismLoop` utilise `capMid` quand les caps existent, fallback conventionnel sinon.
- **B7 (corrigé)** : le premier canal `Effect` sans caps avalait `effectCaps` ; l'analyseur repointe désormais sur le premier canal Effect **ayant** des caps.
- **B4/B5/B6 (laissés, basse sévérité)** : builders protégés par les filtres amont (pas de division/modulo à risque), doc `variant`/`palette` mineure, speed gobo step 0 = 128 (arrêt) assumé.

## Piège connu (naming)

`isPresetMode = /presets?|macro|auto|sound/i` exclut de l'analyse tout canal dont le **nom** contient « macro/auto/sound/preset ». Un canal de type `Effect` nommé « Effect Macro » serait exclu à tort → le nommer « Effect » (ou sans ces mots). Les fixtures réelles GDTF/OFL utilisent des noms propres qui peuvent contenir « macro » : à surveiller si un canal d'effet n'est pas détecté.

## Fichiers modifiés

- `src/engine/auto-loops.ts`
- `src/engine/fixture-analyzer.ts`
- `src/hooks/dmx-cues.ts`
- `src/views/DesignView.tsx`
- `src/views/AutoLoopsPanel.tsx`
- `src/__tests__/auto-loops.test.ts`
