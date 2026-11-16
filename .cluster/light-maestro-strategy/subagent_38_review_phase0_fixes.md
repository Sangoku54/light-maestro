# Revue adversarial Phase 0 fixes

**Date :** 2026-08-15 10:12 GMT+2  
**Revue :** Subagent indépendant  
**Commit de base :** `b6252cc` (HEAD)  
**Modifications :** working tree non committé (staged + unstaged)

---

## 1. Blackout au quit (`electron/main.ts`)

### Handler `before-quit`

```typescript
app.on('before-quit', (event) => {
  if (!isQuitting) {
    event.preventDefault();
    isQuitting = true;
    try { dmxEngine.blackout(); } catch (e) { ... }
    setTimeout(() => app.exit(), 100);
    return;
  }
});
```

**Analyse :**
- ✅ Pas de boucle infinie. Premier appel : `isQuitting` false → `preventDefault` + `isQuitting = true` + blackout + `setTimeout(app.exit, 100)`. `app.exit()` redéclenche `before-quit` mais `isQuitting` est true → passe au travers → exit.
- ✅ Le délai de 100ms laisse le temps à la trame USB d'être flushée avant l'arrêt du process.

### `window-all-closed`

```typescript
app.on('window-all-closed', async () => {
  try { dmxEngine.blackout(); } catch {}
  await dmxEngine.stop();
  midiManager.disconnect();
  audioAnalyzer.stopCapture();
  remoteServer.stop();
  oscServer.stop();
  if (process.platform !== 'darwin') app.quit();
});
```

**Analyse :**
- ✅ Blackout avant `stop()`. `app.quit()` déclenche ensuite `before-quit` qui refait blackout (sécurité redondante, pas de problème — blackout est idempotent).
- ⚠️ **P2 — `window-all-closed` est async mais `app.quit()` ne l'attend pas.** Le handler utilise `async` mais `app.quit()` est appelé après les `await` dans le même callback — c'est correct. Cependant, si `dmxEngine.stop()` prend du temps (USB teardown), `before-quit` pourrait se déclencher avant la fin du `stop()`. En pratique, `before-quit` fait blackout (synchrone) puis `app.exit()` après 100ms — suffisant pour le cas nominal.

### `render-process-gone`

```typescript
mainWindow.webContents.on('render-process-gone', (_event, details) => {
  // Immediate blackout — don't wait for watchdog (2s delay)
  try { dmxEngine.blackout(); } catch (e) { ... }
  // ... reload or quit
});
```

**Analyse :**
- ✅ Blackout immédiat, synchrone, avant toute autre logique. Correct.

### Chemin auto-update (`quitAndInstall`)

```typescript
ipcMain.handle('app:install-update', async () => {
  if (currentUpdateStatus.state === 'downloaded') {
    isQuitting = true;                    // ← positionné AVANT
    setTimeout(() => autoUpdater.quitAndInstall(), 500);
    return true;
  }
  return false;
});
```

**Analyse :**
- ✅ `isQuitting = true` est positionné avant `quitAndInstall()`. Quand `quitAndInstall()` ferme les fenêtres → `window-all-closed` → `app.quit()` → `before-quit` : `isQuitting` est déjà true → pas de `preventDefault` → l'app quitte normalement.
- ✅ Aucune boucle infinie possible.
- ⚠️ **P3 — `quitAndInstall()` ne passe PAS par `before-quit` sur toutes les plateformes.** Selon la doc electron-updater, `quitAndInstall()` fait `app.quit()` puis relance. Sur Windows, `app.quit()` déclenche bien `before-quit`. Le blackout est garanti car `isQuitting` est true → `before-quit` passe au travers sans délai — mais le blackout a déjà été fait par `window-all-closed`. Correct.

### Verdict Fix 1 : ✅ — Conforme, pas de boucle infinie, blackout garanti sur tous les chemins de sortie.

---

## 2. Perf P1 boucle chaude (`src/hooks/dmx-playback.ts`)

### Hoisting des pre-computations

Lignes ~655-685 (dans la fonction `tick`, AVANT la boucle `for(const[uniIdx,fixtures]of analysis.byUniverse.entries())`) :

```typescript
// ── Hoist per-frame computations OUT of the fixture loop (perf P1) ──
const dimmerOverrides = dimmerTracksRef?.current && dimmerTracksRef.current.length > 0
  ? computeDimmerTrackOverrides(...)  // une fois par frame
  : null;
const strobeOverrides = strobeTracksRef?.current && strobeTracksRef.current.length > 0
  ? computeStrobeTrackOverrides(...)  // une fois par frame
  : null;
const fixtureTrackTargets: Array<{ ft: FixtureTrack; targets: string[] }> = [];
if (fixtureTracksRef?.current && fixtureGroupsRef?.current) {
  for (const ft of fixtureTracksRef.current) {
    // resolveTrackTargets appelé UNE FOIS par track, pas par fixture
    fixtureTrackTargets.push({ ft, targets: resolveTrackTargets(ft, ...) });
  }
}
const fixtureTrackMap = new Map<string, Array<...>>();
// Build per-fixture lookup
```

**Vérifications :**

- ✅ `dimmerOverrides` — construit AVANT la boucle fixture, utilisé à la ligne 715-718 dans la boucle via `.get(pf.id)`.
- ✅ `strobeOverrides` — construit AVANT la boucle fixture, utilisé à la ligne 813 via `.get(pf.id)`.
- ✅ `resolveTrackTargets` — appelé uniquement à la ligne 672, AVANT la boucle fixture. **Aucun appel dans la boucle fixture.**
- ✅ `fixtureTrackMap` — lookup par `pf.id` utilisé à 4 endroits dans la boucle (lignes 697, 729, 815, 869), tous via `.get(pf.id)` — O(1).
- ✅ `FixtureTrack` est importé (ligne 15) : `import { resolveTrackTargets, computeEfxOverrides, type EfxTrackRef, type FixtureTrack, type MovementBlock } from './fixture-tracks';`

### Non-régression comportementale

La logique dans la boucle fixture utilise les pre-computed values de manière identique à l'ancienne version inline :
- `dimmerOverrides.get(pf.id)` remplace l'ancien calcul inline → même signature, même résultat.
- `strobeOverrides.get(pf.id)` remplace l'ancien calcul inline → même signature, même résultat.
- `fixtureTrackMap.get(pf.id)` remplace l'ancien `resolveTrackTargets` par fixture → même résultat car la résolution est par fixture-id, pas par position dans la boucle.

⚠️ **P3 — Subtilité :** `resolveTrackTargets` était auparavant appelé par fixture, mais son résultat ne dépend que de `ft`, `patchedFixtures` et `fixtureGroups` — pas de la fixture en cours de traitement. Le hoisting est donc behaviorally équivalent.

### Verdict Fix 2 : ✅ — Hoisting correct, pas de régression, imports OK.

---

## 3. Bug ch.offset (`src/views/Stage3D.tsx` et `src/views/DesignView.tsx`)

### Stage3D.tsx

Ligne 265 :
```typescript
const off = ch.offset ?? i;
```

Utilisé pour :
- `colourChannels.push({ offset: off, ... })` (ligne 269)
- `result.intensityOffset = off` (ligne 274)
- `result.shutterOffset = off` (ligne 277)
- `result.panOffset = off` (ligne 280)
- `result.panOffsets.push(off)` (ligne 281)
- `result.tiltOffset = off` (ligne 284)
- `result.tiltOffsets.push(off)` (ligne 285)
- `result.goboOffset = off` (ligne 288)

✅ `ch.offset ?? i` utilisé partout pertinent.

### DesignView.tsx

Lignes 242-249 :
```typescript
modeChannels: Array<{ name: string; type: string; defaultValue?: number; capabilities?: any[]; offset?: number }>

const channels: AnalyzedChannel[] = modeChannels.map((ch, i) => ({
  index: ch.offset ?? i,
  name: ch.name || `Ch ${i + 1}`,
  type: ch.type || 'Nothing',
  dmxAddress: fixture.startAddress + (ch.offset ?? i),
  defaultValue: ch.defaultValue,
  capabilities: ch.capabilities,
}));
```

- ✅ Type de `modeChannels` inclut `offset?: number`.
- ✅ `ch.offset ?? i` utilisé pour `index` et `dmxAddress`.

### Verdict Fix 3 : ✅ — Fix correct dans les deux fichiers, type étendu.

---

## 4. NTFS casing

### Fichiers renommés (18 R dans git diff)

| Avant (minuscules) | Après (PascalCase/camelCase) |
|---|---|
| src/app.tsx | src/App.tsx |
| src/components/songpresetplayer.tsx | src/components/SongPresetPlayer.tsx |
| src/components/layout/sidebar.tsx | src/components/layout/Sidebar.tsx |
| src/components/layout/topbar.tsx | src/components/layout/TopBar.tsx |
| src/hooks/useaudiocapture.tsx | src/hooks/useAudioCapture.tsx |
| src/hooks/useaudiofileloader.tsx | src/hooks/useAudioFileLoader.tsx |
| src/hooks/usefixturetest.ts | src/hooks/useFixtureTest.ts |
| src/stores/appstore.ts | src/stores/appStore.ts |
| src/stores/performstore.ts | src/stores/performStore.ts |
| src/stores/rgbmatrixstore.ts | src/stores/rgbmatrixStore.ts |
| src/stores/showstore.ts | src/stores/showStore.ts |
| src/utils/fixturethumbnails.ts | src/utils/fixtureThumbnails.ts |
| src/views/designview.tsx | src/views/DesignView.tsx |
| src/views/performanceview.tsx | src/views/PerformanceView.tsx |
| src/views/quickshowview.tsx | src/views/QuickShowView.tsx |
| src/views/showmanager.tsx | src/views/ShowManager.tsx |
| src/views/stage2deditor.tsx | src/views/Stage2DEditor.tsx |
| src/views/stage3d.tsx | src/views/Stage3D.tsx |
| src/views/tracktimeline.tsx | src/views/TrackTimeline.tsx |

**Compte : 19 renommages** (pas 18 — l'énoncé en dit 18, il y en a 19).

### Fichiers `.tmp-casing-fix` oubliés

```
git ls-files | Select-String "\.tmp-casing-fix"
```
→ Aucun résultat. ✅

### Imports — vérification de la casse

Tous les imports vérifiés via `Select-String` utilisent la bonne casse :
- `../stores/showStore` ✅
- `../stores/appStore` ✅
- `../stores/performStore` ✅
- `../stores/rgbmatrixStore` ✅
- `../components/SongPresetPlayer` ✅
- `./components/layout/Sidebar` ✅
- `./components/layout/TopBar` ✅
- `../hooks/useAudioCapture` ✅
- `../hooks/useAudioFileLoader` ✅
- `../hooks/useFixtureTest` ✅
- `../utils/fixtureThumbnails` ✅
- `./Stage3D` ✅
- `./Stage2DEditor` ✅
- `./ShowManager` ✅
- `./TrackTimeline` ✅
- `../views/DesignView` ✅
- `../views/PerformanceView` ✅
- `../views/QuickShowView` ✅

### tsconfig.json

```json
"forceConsistentCasingInFileNames": true
```
✅ Présent à la ligne 10 du tsconfig.json.

### Verdict Fix 4 : ✅ — 19 fichiers renommés (pas 18), aucun fichier temporaire oublié, imports corrects, tsconfig OK.

---

## 5. Non-régression

### `npx tsc --noEmit`
```
Process exited with code 0.
```
✅ **0 erreur.**

### `npx tsc -p tsconfig.electron.json --noEmit`
```
(no output)
```
✅ **0 erreur.**

### `npx vitest run`
```
Test Files  8 passed (8)
     Tests  123 passed (123)
  Duration  1.88s
```
✅ **123/123 tests verts.**

### `npm run build`
```
vite v5.4.21 building for production...
✓ 1485 modules transformed.
✓ built in 5.45s
```
✅ **Build OK.**

---

## Résumé des problèmes identifiés

| Sévérité | Fix | Description |
|---|---|---|
| P2 | Blackout quit | `window-all-closed` est async ; `dmxEngine.stop()` pourrait ne pas finir avant `app.quit()`. En pratique, le blackout synchrone dans `before-quit` couvre ce cas. |
| P3 | Blackout quit | `quitAndInstall()` ne passe pas par `before-quit` sur toutes les plateformes, mais `isQuitting=true` + `window-all-closed` blackout garantit la sécurité. |
| P3 | Perf P1 | `resolveTrackTargets` était appelé par fixture avant, mais son résultat ne dépend pas de la fixture courante — le hoisting est équivalent. |
| — | NTFS casing | 19 fichiers renommés, pas 18 comme annoncé. |

**Aucun P0 ou P1 identifié.**

---

## Recommandation finale

### ✅ LIVRABLE

Les 4 fixes sont corrects, ne causent pas de régression, et passent tous les tests de non-régression (tsc 0 erreurs, 123/123 tests, build OK). Les problèmes identifiés sont tous P2/P3 — acceptable pour une livraison. Le seul point d'attention est le comptage des fichiers renommés (19 au lieu de 18 annoncé), ce qui suggère qu'un fichier a été oublié dans le décompte initial mais bien été renommé — pas un problème en soi.
