# Audit NTFS Casing — Conflits de casse dans light-maestro

**Date :** 2026-08-15  
**Agent :** subagent_33_ntfs_casing  
**Workspace :** `light-maestro`

---

## Résumé exécutif

Le projet `light-maestro` est développé sur Windows (NTFS, insensible à la casse) avec `git config core.ignorecase = true`. **Tous les fichiers sur disque sont en minuscules** (ex: `app.tsx`, `topbar.tsx`, `appstore.ts`), mais **la plupart des imports dans le code utilisent une casse mixte** (ex: `App`, `TopBar`, `appStore`).

Sur Windows, ça « marche » par accident parce que NTFS résout les chemins sans tenir compte de la casse. Mais c'est fragile : un `git clone` sur Linux/macOS casserait immédiatement, et certains outils (Vite en mode strict, TypeScript avec `forceConsistentCasingInFileNames: true`) peuvent lever des erreurs.

---

## 1. Tableau des conflits

### 1.1 Fichiers principaux (components, views, app)

| # | Fichier sur disque | Nom dans git | Import utilisé dans le code | Fichier(s) qui importent |
|---|---|---|---|---|
| 1 | `src/app.tsx` | `src/app.tsx` | `./App` | `src/main.tsx` |
| 2 | `src/components/layout/topbar.tsx` | `src/components/layout/topbar.tsx` | `./components/layout/TopBar` | `src/app.tsx` |
| 3 | `src/components/layout/sidebar.tsx` | `src/components/layout/sidebar.tsx` | `./components/layout/Sidebar` | `src/app.tsx` |
| 4 | `src/components/songpresetplayer.tsx` | `src/components/songpresetplayer.tsx` | `../components/SongPresetPlayer` | `src/views/performanceview.tsx`, `src/__tests__/playback-clock.test.ts` |
| 5 | `src/views/quickshowview.tsx` | `src/views/quickshowview.tsx` | `./QuickShowView` | `src/app.tsx`, `src/__tests__/gencues.test.ts`, `src/components/songpresetplayer.tsx` |
| 6 | `src/views/designview.tsx` | `src/views/designview.tsx` | `./DesignView` | `src/app.tsx` |
| 7 | `src/views/performanceview.tsx` | `src/views/performanceview.tsx` | `./PerformanceView` | `src/app.tsx` |
| 8 | `src/views/showmanager.tsx` | `src/views/showmanager.tsx` | `./ShowManager` | `src/views/designview.tsx` |
| 9 | `src/views/stage2deditor.tsx` | `src/views/stage2deditor.tsx` | `./Stage2DEditor` | `src/views/designview.tsx` |
| 10 | `src/views/stage3d.tsx` | `src/views/stage3d.tsx` | `./Stage3D` | `src/views/designview.tsx`, `src/views/quickshowview.tsx` |
| 11 | `src/views/tracktimeline.tsx` | `src/views/tracktimeline.tsx` | `./TrackTimeline` | `src/views/quickshowview.tsx` |

### 1.2 Stores

| # | Fichier sur disque | Nom dans git | Import utilisé dans le code | Fichier(s) qui importent |
|---|---|---|---|---|
| 12 | `src/stores/appstore.ts` | `src/stores/appstore.ts` | `../stores/appStore` ou `./stores/appStore` | `src/app.tsx`, `src/components/layout/sidebar.tsx`, `src/components/layout/topbar.tsx`, `src/engine/midi-actions.ts`, `src/hooks/osc-trigger.ts`, `src/hooks/remote-trigger.ts`, `src/hooks/dmx-playback.ts` (mixte!), `src/utils/dmx-helpers.ts`, `src/views/designview.tsx`, `src/views/performanceview.tsx`, `src/views/quickshowview.tsx`, `src/views/stage3d.tsx`, `src/views/tracktimeline.tsx` |
| 13 | `src/stores/showstore.ts` | `src/stores/showstore.ts` | `../stores/showStore` ou `./stores/showStore` | `src/app.tsx`, `src/components/songpresetplayer.tsx`, `src/engine/dmx-channel.ts`, `src/engine/dmx-color.ts`, `src/engine/midi-actions.ts`, `src/hooks/dmx-cues.ts`, `src/hooks/dmx-playback.ts`, `src/hooks/fixture-tracks.ts`, `src/hooks/midi-trigger.ts`, `src/hooks/mtc-trigger.ts`, `src/hooks/osc-trigger.ts`, `src/hooks/remote-trigger.ts`, `src/hooks/rgb-matrix-playback.ts`, `src/utils/dmx-helpers.ts`, `src/views/designview.tsx`, `src/views/performanceview.tsx`, `src/views/quickshowview.tsx`, `src/views/showmanager.tsx`, `src/views/stage2deditor.tsx`, `src/views/stage3d.tsx`, `src/views/tracktimeline.tsx` |
| 14 | `src/stores/performstore.ts` | `src/stores/performstore.ts` | `../stores/performStore` ou `./stores/performStore` | `src/app.tsx`, `src/engine/midi-actions.ts`, `src/hooks/mtc-trigger.ts` |
| 15 | `src/stores/rgbmatrixstore.ts` | `src/stores/rgbmatrixstore.ts` | `../stores/rgbmatrixStore` | `src/hooks/rgb-matrix-playback.ts`, `src/views/designview.tsx` |

### 1.3 Hooks

| # | Fichier sur disque | Nom dans git | Import utilisé dans le code | Fichier(s) qui importent |
|---|---|---|---|---|
| 16 | `src/hooks/useaudiocapture.tsx` | `src/hooks/useaudiocapture.tsx` | `./hooks/useAudioCapture` | `src/app.tsx` |
| 17 | `src/hooks/useaudiofileloader.tsx` | `src/hooks/useaudiofileloader.tsx` | `./hooks/useAudioFileLoader` | `src/app.tsx`, `src/views/quickshowview.tsx` |
| 18 | `src/hooks/usefixturetest.ts` | `src/hooks/usefixturetest.ts` | `../hooks/useFixtureTest` | `src/views/designview.tsx` |

### 1.4 Utils

| # | Fichier sur disque | Nom dans git | Import utilisé dans le code | Fichier(s) qui importent |
|---|---|---|---|---|
| 19 | `src/utils/fixturethumbnails.ts` | `src/utils/fixturethumbnails.ts` | `../utils/fixtureThumbnails` | `src/views/designview.tsx`, `src/views/stage2deditor.tsx` |

### 1.5 Cas particulier : imports mixtes pour le même fichier

| # | Fichier sur disque | Imports trouvés | Problème |
|---|---|---|---|
| 20 | `src/stores/appstore.ts` | `../stores/appStore` (11 fichiers) **ET** `../stores/appstore` (1 fichier: `dmx-playback.ts`) | **Inconsistance** : `dmx-playback.ts` utilise la casse minuscule, tous les autres utilisent la casse mixte |

### 1.6 Fichiers sans conflit (déjà alignés)

Tous les fichiers `electron/` ont des imports en minuscules qui correspondent aux noms sur disque. Aucun conflit côté electron.

Les hooks/utils/engine suivants sont en minuscules dans les imports ET sur disque : `audio-analysis`, `dmx-cues`, `dmx-playback`, `fixture-tracks`, `midi-trigger`, `mtc-trigger`, `osc-trigger`, `remote-trigger`, `rgb-matrix-playback`, `dmx-channel`, `dmx-color`, `dmx-movement`, `midi-actions`, `mtc-markers`, `output-arbiter`, `dmx-bridge`, `dmx-helpers`, `fixture-test-state`, `latency-meter`, `renderer-watchdog`.

---

## 2. Risques

### 2.1 Build Vite
- **Risque actuel : faible.** Vite sur Windows résout les imports sans tenir compte de la casse (délègue au système de fichiers). Le build fonctionne.
- **Risque futur : élevé.** Si le build est lancé sur CI Linux (Docker), tous les imports avec casse incorrecte échoueront.
- **HMR cassé :** Vite peut avoir des problèmes de cache HMR quand le nom importé ne correspond pas au nom réel — il peut créer des entrées de cache dupliquées.

### 2.2 Git
- **`core.ignorecase = true`** : git masque les différences de casse. Un `git mv` pour changer la casse nécessite une étape intermédiaire.
- **Pull/clone sur Linux/macOS :** Les développeurs sur ces plateformes auraont des imports cassés.
- **Branches/merges :** Si deux branches utilisent des casses différentes pour le même fichier, git peut créer des doublons ou perdre des changements.

### 2.3 TypeScript
- **`tsconfig.json` (renderer) :** `forceConsistentCasingInFileNames: false` — TypeScript **n'alerte pas** sur les conflits de casse. C'est un masque, pas une solution.
- **`tsconfig.electron.json` :** `forceConsistentCasingInFileNames: true` — mais aucun conflit côté electron, donc pas de problème actuel.
- **Si on active `forceConsistentCasingInFileNames: true` dans le tsconfig principal :** ~19 erreurs TypeScript apparaîtraient immédiatement.

### 2.4 Impact sur les imports mixtes (cas #20)
- `dmx-playback.ts` importe `../stores/appstore` (minuscule) alors que tous les autres fichiers importent `../stores/appStore` (mixte). Sur Windows, ça pointe vers le même fichier. Mais ça crée une inconsistency qui rend les refactores de renommage dangereux.

---

## 3. Plan de résolution

### Stratégie recommandée : **Aligner les noms de fichiers sur la casse des imports (PascalCase/camelCase)**

**Justification :** Les imports utilisent la convention standard JavaScript/TypeScript (PascalCase pour les composants, camelCase pour les stores/hooks/utils). C'est la casse que les développeurs s'attendent à voir. Renommer les imports vers le minuscule serait non-standard et illogique.

### Étape 1 : Préparer le terrain

```bash
# Activer la sensibilité à la casse dans git pour ce repo
git config core.ignorecase false
```

⚠️ **ATTENTION :** Cela peut révéler d'autres conflits latents. À faire avec précaution, idéalement sur une branche propre.

### Étape 2 : Renommer les fichiers (git mv avec astuce NTFS)

Sur NTFS, `git mv app.tsx App.tsx` échoue car le système ne voit pas de différence. Il faut utiliser un nom temporaire :

```bash
# Pour chaque fichier, pattern :
git mv src/app.tsx src/app_tmp.tsx
git mv src/app_tmp.tsx src/App.tsx
```

**Liste complète des renommages (19 fichiers) :**

| # | Ancien nom | Nouveau nom |
|---|---|---|
| 1 | `src/app.tsx` | `src/App.tsx` |
| 2 | `src/components/layout/topbar.tsx` | `src/components/layout/TopBar.tsx` |
| 3 | `src/components/layout/sidebar.tsx` | `src/components/layout/Sidebar.tsx` |
| 4 | `src/components/songpresetplayer.tsx` | `src/components/SongPresetPlayer.tsx` |
| 5 | `src/views/quickshowview.tsx` | `src/views/QuickShowView.tsx` |
| 6 | `src/views/designview.tsx` | `src/views/DesignView.tsx` |
| 7 | `src/views/performanceview.tsx` | `src/views/PerformanceView.tsx` |
| 8 | `src/views/showmanager.tsx` | `src/views/ShowManager.tsx` |
| 9 | `src/views/stage2deditor.tsx` | `src/views/Stage2DEditor.tsx` |
| 10 | `src/views/stage3d.tsx` | `src/views/Stage3D.tsx` |
| 11 | `src/views/tracktimeline.tsx` | `src/views/TrackTimeline.tsx` |
| 12 | `src/stores/appstore.ts` | `src/stores/appStore.ts` |
| 13 | `src/stores/showstore.ts` | `src/stores/showStore.ts` |
| 14 | `src/stores/performstore.ts` | `src/stores/performStore.ts` |
| 15 | `src/stores/rgbmatrixstore.ts` | `src/stores/rgbmatrixStore.ts` |
| 16 | `src/hooks/useaudiocapture.tsx` | `src/hooks/useAudioCapture.tsx` |
| 17 | `src/hooks/useaudiofileloader.tsx` | `src/hooks/useAudioFileLoader.tsx` |
| 18 | `src/hooks/usefixturetest.ts` | `src/hooks/useFixtureTest.ts` |
| 19 | `src/utils/fixturethumbnails.ts` | `src/utils/fixtureThumbnails.ts` |

### Étape 3 : Corriger l'import inconsistant

Dans `src/hooks/dmx-playback.ts`, corriger :
```
- import ... from '../stores/appstore'
+ import ... from '../stores/appStore'
```

### Étape 4 : Activer forceConsistentCasingInFileNames

Dans `tsconfig.json` :
```json
"forceConsistentCasingInFileNames": true
```

Cela empêchera les futurs conflits de casse d'être introduits.

### Étape 5 : Vérifier

```bash
# Build Vite
npm run build

# Type-check
npx tsc --noEmit

# Test
npx vitest run
```

### Étape 6 : Commit

Un seul commit atomique :
```
fix: align file casing with imports (NTFS casing audit)

Renames 19 files to match the casing used in import statements.
Enables forceConsistentCasingInFileNames in tsconfig.json.
```

---

## 4. Notes additionnelles

### Pourquoi ne pas l'inverse (aligner les imports vers le minuscule) ?

1. **Convention JavaScript/TypeScript :** PascalCase pour les composants React, camelCase pour les stores/hooks. C'est le standard de l'écosystème.
2. **Lisibilité :** `import { Stage3D } from './Stage3D'` est plus naturel que `import { Stage3D } from './stage3d'`.
3. **Écosystème :** Les outils (ESLint, Prettier, Next.js, etc.) s'attendent à cette convention.

### Risque du `git config core.ignorecase false`

Si d'autres conflits de casse latents existent (par exemple, deux fichiers qui ne diffèrent que par la casse), les activer pourrait causer des problèmes. Avant de le faire, vérifier avec :

```bash
git ls-files | sort -f | uniq -di
```

### Alternative : script PowerShell pour le renommage en masse

```powershell
$renames = @(
    @('src/app.tsx', 'src/App.tsx'),
    @('src/components/layout/topbar.tsx', 'src/components/layout/TopBar.tsx'),
    @('src/components/layout/sidebar.tsx', 'src/components/layout/Sidebar.tsx'),
    @('src/components/songpresetplayer.tsx', 'src/components/SongPresetPlayer.tsx'),
    @('src/views/quickshowview.tsx', 'src/views/QuickShowView.tsx'),
    @('src/views/designview.tsx', 'src/views/DesignView.tsx'),
    @('src/views/performanceview.tsx', 'src/views/PerformanceView.tsx'),
    @('src/views/showmanager.tsx', 'src/views/ShowManager.tsx'),
    @('src/views/stage2deditor.tsx', 'src/views/Stage2DEditor.tsx'),
    @('src/views/stage3d.tsx', 'src/views/Stage3D.tsx'),
    @('src/views/tracktimeline.tsx', 'src/views/TrackTimeline.tsx'),
    @('src/stores/appstore.ts', 'src/stores/appStore.ts'),
    @('src/stores/showstore.ts', 'src/stores/showStore.ts'),
    @('src/stores/performstore.ts', 'src/stores/performStore.ts'),
    @('src/stores/rgbmatrixstore.ts', 'src/stores/rgbmatrixStore.ts'),
    @('src/hooks/useaudiocapture.tsx', 'src/hooks/useAudioCapture.tsx'),
    @('src/hooks/useaudiofileloader.tsx', 'src/hooks/useAudioFileLoader.tsx'),
    @('src/hooks/usefixturetest.ts', 'src/hooks/useFixtureTest.ts'),
    @('src/utils/fixturethumbnails.ts', 'src/utils/fixtureThumbnails.ts')
)

foreach ($r in $renames) {
    $old = $r[0]; $new = $r[1]; $tmp = $old + '.tmp_rename'
    git mv $old $tmp
    git mv $tmp $new
    Write-Host "Renamed: $old -> $new"
}
```

---

## 5. Conclusion

**19 fichiers** ont un conflit de casse entre leur nom sur disque (minuscules) et les imports dans le code (casse mixte). Le projet fonctionne actuellement sur Windows par accident (NTFS insensible à la casse), mais tout build sur Linux/macOS casserait immédiatement.

La résolution consiste à renommer les fichiers vers la casse standard (PascalCase/camelCase) via `git mv` avec nom temporaire, puis à activer `forceConsistentCasingInFileNames: true` dans le tsconfig principal pour prévenir les régressions futures.

**Priorité : moyenne.** Pas urgent (ça marche sur Windows), mais devrait être fait avant tout passage en CI/CD ou collaboration multiplateforme.
