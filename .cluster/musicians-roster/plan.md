# Plan — Configuration libre des musiciens sur scène (roster + silhouettes)

## Objectif
Remplacer les presets figés de musiciens (solo/duo/.../sextet = `BandConfig`) par une
sélection libre : liste déroulante avec **case à cocher + nombre** pour chaque type
(chanteur, chanteuse, guitariste, bassiste, clavier, batteur, cuivre). Recréer les
silhouettes de tous ces musiciens avec un **léger halo blanc** pour les distinguer sur
fond noir.

## État actuel (vérifié)
- `showStore.ts` : `BandConfig` (union de 7 strings) + `bandConfig?: BandConfig` sur `SavedScene`.
- `Stage3D.tsx` : `BAND_PRESETS` (presets fixes), `buildPositions`, `MUSICIAN_IMAGES`
  (6 photos importées), `MUSICIAN_HEIGHTS`, `loadMusicianTexture`→`loadCutoutTexture`
  (removeBackground + black-out + crop), sprite build effect `[bandConfig, stageDims]`,
  `<select>` figé (lignes ~2175).
- `DesignView.tsx` (SceneEditor) : state `bandConfig`, restore/save/auto-write, props vers `<Stage3D>`.
- Test `scene-3d-config.test.ts` référence `bandConfig`.

## Modèle de données (cible)
- `MusicianKind = 'chanteur' | 'chanteuse' | 'guitariste' | 'bassiste' | 'clavier' | 'batteur' | 'cuivre'`
- `MusicianRoster = Partial<Record<MusicianKind, number>>`
- `SavedScene.musicians?: MusicianRoster` (nouveau champ). `bandConfig` conservé en lecture
  pour migration (anciennes scènes).
- `rosterFromBandConfig(cfg)` : migration preset → roster.

## Fichiers
1. `src/utils/musicians.ts` (NOUVEAU) — types, `MUSICIAN_KINDS`, libellés FR, positions par
   défaut, `rosterFromBandConfig`, helpers (empty/total count).
2. `src/stores/showStore.ts` — remplacer `BandConfig` par `MusicianRoster` importé ; champ
   `musicians?` ; `updateScene` Pick `'bandConfig'` → `'musicians'`.
3. `src/views/Stage3D.tsx` — rendu par roster (N sprites par type, positions étalées),
   halo blanc dans `loadCutoutTexture`, nouvel UI déroulant (checkbox + count), imports SVG
   silhouettes, nouveau kind `cuivre`.
4. `src/views/DesignView.tsx` — state `musicians` (roster), restore (migration), save +
   auto-write, props `musicians`/`onMusiciansChange`.
5. `src/__tests__/scene-3d-config.test.ts` — adapter au roster.

## Sous-agents
- **Silhouettes designer** (round 1) : produit les 7 silhouettes SVG
  (`src/assets/musicians/*.svg`) — figures sombres sur fond transparent, silhouette
  reconnaissable (tête + corps + accessoire distinctif). Vérifier la qualité avant intégration.
- **Code review** (round 2) : revue des risques du refactor (types, migration, rendu, UI).

## Review (S4)
- tsc 0 erreur, vite build OK, tests OK.
- Vérification visuelle offscreen (silhouettes + halo + UI déroulant).

## Delivery (S5)
- Commit + réponse. Livrable : feature fonctionnelle (UI libre + halo + cuivre).
