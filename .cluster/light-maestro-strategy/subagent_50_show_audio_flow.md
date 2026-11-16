# Subagent 50 — Analyse : flux de lancement d'un show (.lmshow), l'audio ne se lance pas

**Date :** 2026-08-16
**Objet :** Tracer le flux de lancement d'un show et déterminer pourquoi les lights se lancent mais l'AUDIO ne se lance pas.
**Méthode :** Analyse statique uniquement — aucun changement de code appliqué.

---

## 1. Conclusion (cause racine)

**Cause racine identifiée avec certitude :** dans `startShowPlayback()` (PerformanceView.tsx), la variable locale `audioCtx` était déclarée à `null` (L234) et **jamais initialisée**. Le tick de playback contient :

```ts
// PerformanceView.tsx, L346-347 (état AVANT fix)
const ctx = audioCtx;
if (!ctx || ctx.state === 'closed') return;
```

→ `ctx` était **toujours `null`** → le branche audio se terminait par un `return` silencieux à chaque tick → **l'audio du show n'était JAMAIS lu**, tandis que le moteur DMX démarrait (`window.lightMaestro?.dmx?.start?.()`, L302) et que les branches scene/chaser/efx tournaient → « les lights se lancent, pas l'audio ».

Ce bug a été corrigé par le commit **`948ffe1` « fix: show playback never played audio (AudioContext never created) »** (2026-08-16 18:58, HEAD actuel) : création lazy de l'AudioContext à la première lecture audio (PerformanceView.tsx L348-359) + miroir dans `showPlaybackRef.current.audioCtx` pour que le nettoyage existant fonctionne.

**Ce n'est PAS** un problème de mauvais champ (`audioFileBase64` vs `audioDataBase64`) : le code lit `item.audioFileBase64`, et c'est exactement le champ présent dans les .lmshow réels.

---

## 2. Flux complet (avec chemins + lignes exactes)

Fichier principal : `light-maestro/src/views/PerformanceView.tsx` (le composant est monté une seule fois, `App.tsx:415`).

### 2.1. Configuration du widget VC « Play Show » (actionType `loadShow`)
- **L915-923** (select actionType) : `loadShow` → ouvre un file picker `.lmshow/.lmproj`, parse le JSON, `setConfig({..., actionType:'loadShow', showName, showData: p })`.
- **L951-988** (panneau config) : choix d'un show depuis le store (`setConfig({..., showId, showName, showData: show })`, L964) ou via « Browse... » (L975-983).

### 2.2. Sauvegarde du projet : `showData` est strippé
- **App.tsx L71-81** (`saveProject`) : `showData` (multi-Mo) est retiré des configs de widgets persistées, remplacé par `showId: showData.id` et `showName: showData.name`.
- **Conséquence :** après rechargement de projet, `config.showData` est absent → `activate()` fait une résolution par le store (voir 2.3).

### 2.3. `activate()` — PerformanceView.tsx L1608
- **L1614** : branche `if (config.actionType === 'loadShow')`.
- **L1609-1612** : toggle — si `__lm_perfPlayActive`, stop + return.
- **L1626-1637** : résolution du show :
  ```ts
  let p = config.showData;
  if (!p) {
    const storeShows = useShowStore.getState().shows;
    p = storeShows.find((s) => s.name === config.showName || s.id === config.showId);
  }
  if (!p) { /* file picker dialog → JSON.parse */ }
  ```
- **L1640-1664** : restauration du contenu du show dans le store global (`setScenes`, `setChasers`, `setEffects`, `setShowUniverses`, `setPatchedFixtures`, …).
- **L1666-1673** : restauration audio top-level `.lmproject` (`p.audioFileBase64 && p.audioFileName` → `__lm_loadAudioFile`).

### 2.4. Détection show vs preset/QuickShow — **PerformanceView.tsx L1682**
```ts
if (p.tracks || p.format?.startsWith('lightmaestro/show')) {
  // → SHOW : playback local Performance view
} else {
  // → preset .lmproject : QuickShow (L1701-1703)
  useAppStore.getState().setMode?.('quick');
  (window as any).__lm_triggerPlay?.();
}
```
- `hope.lmshow` / `Hope2.lmshow` : format **tracks-only** (pas de champ `format`), détectés via `p.tracks` (truthy).
- `everybody.lmshow` : `format: "lightmaestro/show"` + `tracks` (les deux conditions).

### 2.5. Lancement du show — L1684-1699
```ts
const showData = { id, name, duration, tracks: p.tracks || [], audioFileBase64: p.audioFileBase64, audioFileName: p.audioFileName };
s.setShows([...s.shows.filter((sh) => sh.id !== showData.id), showData]);   // L1692
(window as any).__lm_perfPlayActive = true;                                  // L1694
(window as any).__lm_perfPlayShow = showData;                                // L1698
window.dispatchEvent(new Event('lm-perf-play-show'));                        // L1699
```
(Le passage par ref window + Event simple, et non CustomEvent avec detail, est volontaire : pas de structured-clone des multi-Mo de base64, cf. commentaire L1695-1697.)

### 2.6. `startShowPlayback()` — L221 (boucle RAF)
- **L298-304** : démarrage DMX `if (currentState.universes.length > 0) window.lightMaestro?.dmx?.start?.();` → **c'est pour ça que les lights se lancent**.
- **L306-320** : `tick()` ; stop quand `currentMs >= (showData.duration ?? 60000)` (L311).
- **L323** : boucle `for (const track of showData.tracks)`, **L324 `if (track.muted) continue;`**.
- **L327-333** : fenêtre temporelle de l'item (`currentMs < itemStart || currentMs > itemEnd` → skip ; pour l'audio, `startedAudios.delete(item.id)`).
- Branches : Audio **L341-370**, Scene **L371-383**, Chaser **L385-413**, EFX **L416-495**.

---

## 3. Point 1 — Tous les listeners de `'lm-perf-play-show'`

Un seul listener dans tout le code source (`grep lm-perf-play-show src/`) :

| Endroit | Ligne | Rôle |
|---|---|---|
| `src/views/PerformanceView.tsx` — `handlePlayShow` | **L523-530** | Lit `window.__lm_perfPlayShow`, le supprime, appelle `startShowPlayback(showData)` |
| enregistrement `addEventListener` | **L530** | Dans le `useEffect` du moteur (monté avec VirtualConsolePanel) |
| `removeEventListener` (cleanup) | **L540** | |
| garde « pending » (événement dispatché avant montage) | **L533-537** | Rejoue le signal manqué |
| émetteur (dispatch) | **L1699** | Dans `activate()` |

Aucun autre fichier n'écoute ni n'émet cet événement (ni QuickShowView, ni ShowManager, ni App).

---

## 4. Point 2 — Où l'AUDIO devrait être démarrée

### 4.1. Préchargement (best-effort, non bloquant)
- **L270-278** (`preloadAudio`) : pour chaque track `type === 'audio'`, `getAudioBuffer(item.audioFileBase64)` — uniquement si `audioFileBase64` présent.
- **L236-243** (`getAudioBuffer`) : cache local + délégation à `decodeAudioUrl` (`src/utils/audio-cache.ts`, L33-58) : `fetch(url)` → `arrayBuffer()` → `decodeAudioData` via un `AudioContext` partagé module (`getSharedCtx()`, L20-27). Les data-URLs `data:audio/mpeg;base64,…` sont supportées par `fetch` en Chromium.

### 4.2. Lecture effective — **PerformanceView.tsx L341-370** (dans `tick()`)
```ts
if (track.type === 'audio' && item.audioFileBase64 && !pb.startedAudios.has(item.id)) {
  pb.startedAudios.add(item.id);
  const audioOffsetSec = Math.max(0, elapsed) / 1000;
  getAudioBuffer(item.audioFileBase64).then((buffer) => {
    if (!showPlaybackRef.current) return;
    // ⚠️ LE FIX (commit 948ffe1) — L348-359 : création lazy de l'AudioContext
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        showPlaybackRef.current.audioCtx = audioCtx;
      } catch { return; }
    }
    const ctx = audioCtx;
    if (!ctx || ctx.state === 'closed') return;
    if (ctx.state === 'suspended') void ctx.resume();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0, audioOffsetSec);
    pb.audioSources.push(source);
    source.onended = () => { pb.audioSources = pb.audioSources.filter(s => s !== source); };
  }).catch(() => {});
}
```

### 4.3. Le nettoyage audio
- `stopPlayback` **L284-291** et `stopAll` **L514-522** : `showPlaybackRef.current.audioCtx?.close()` + stop des `audioSources`. Le ref est alimenté par le fix (L352).

---

## 5. Point 3 — Détection show vs preset/QuickShow

- **L1682** : `if (p.tracks || p.format?.startsWith('lightmaestro/show'))` → SHOW (playback local Performance, aucun changement d'onglet).
- Sinon (L1701-1703) → QuickShow `.lmproject` (`setMode('quick')` + `__lm_triggerPlay`).
- Les trois shows réels sont bien du format show : `hope.lmshow` et `Hope2.lmshow` (tracks-only, `schemaVersion: 1`, pas de `format`), `everybody.lmshow` (`format: "lightmaestro/show"`, show complet avec scenes/chasers/patchedFixtures/universes).

---

## 6. Point 4 — Preuve de la cause racine

### État AVANT le fix (commit parent `948ffe1^`)
Dans le closure de `startShowPlayback` (L221-512) :
- **L234** : `let audioCtx: AudioContext | null = null;`
- **L346** : `const ctx = audioCtx; if (!ctx || ctx.state === 'closed') return;`
- **Aucune affectation** de `audioCtx` dans tout le closure (les seuls `new AudioContext` du fichier étaient dans d'autres fonctions : L1247 analyse, L1576 `_startAudioAutoScript`). Le ref objet L502 initialisait `audioCtx: null`.

→ `ctx` toujours null → la lecture audio sortait silencieusement à chaque fois → **l'audio du show n'était jamais lu**. Les lights marchaient car le moteur DMX démarrait (L302) et les branches scene/chaser/efx n'avaient pas cette dépendance.

### Preuve formelle
- Commit **`948ffe1`** (HEAD, 2026-08-16 18:58:00 +0200) : « fix: show playback never played audio (AudioContext never created) » — diff : +11/-1 dans `startShowPlayback` (création lazy + `void ctx.resume()`).
- Le workspace contient déjà ce fix (vérifié en lecture directe, L348-359).

### Réponses aux hypothèses de la mission
| Hypothèse | Verdict |
|---|---|
| « L'audio du show n'est jamais lu » | **OUI — c'était exactement ça** (ctx null → return silencieux). Corrigé par 948ffe1. |
| « Mauvais champ lu (audioDataBase64 vs audioFileBase64) » | **NON** — le code lit `item.audioFileBase64` (L342), et les .lmshow stockent l'audio dans `items[].audioFileBase64` (data URL `data:audio/mpeg;base64,…` / `data:audio/wav;base64,…`). `audioDataBase64` n'est utilisé que par QuickShow/.lmpreset (QuickShowView.tsx L834-916, L1932-1936 ; SongPresetPlayer.tsx L180 ; PerformanceView.tsx L1031, L1513 — pas dans le flux show). |
| « L'audio est conditionné par quelque chose de faux » | **OUI** — conditionné par `audioCtx` non-null (jamais initialisé). |

---

## 7. Vérifications annexes (données réelles des .lmshow)

Vérifié par inspection JSON des fichiers (racine du projet) :
- `hope.lmshow` (17.5 Mo) : `tracks[0]` = audio, `muted:false`, item `{startTime:0, duration:327273, audioFileBase64:"data:audio/mpeg;base64,…"}` ; `tracks[1]` = chaser « Test ». **Pas de champ `format`** (détection par `p.tracks`). `duration: 327273`.
- `Hope2.lmshow` (17.5 Mo) : identique à hope (même `id: show-1786593921221-6xujgwh3`, name "Hope2").
- `everybody.lmshow` (61.8 Mo) : `format: "lightmaestro/show"`, audio wav 262857 ms, + scenes/chasers/effects/patchedFixtures/universes complets.
- Aucune piste audio mutée, aucun item sans `audioFileBase64` → les données sont saines.

### Autoplay policy (Electron)
`electron/main.ts` : aucune option `autoplayPolicy` ni `--autoplay-policy` (seuls `disable-gpu-*`, `no-force-async-hooks-checks`, `disable-features: Autofill`, `disable-http-cache` en dev, L19-26). La politique par défaut d'Electron (`no-user-gesture-required`) autorise la création/resume d'AudioContext hors geste utilisateur → pas de blocage autoplay attendu dans le shell Electron.

---

## 8. Points de vigilance secondaires (pas la cause du bug, à garder en tête)

1. **`startedAudios.add(item.id)` avant le décodage asynchrone (L342-343)** : si `decodeAudioData` échoue ou si la création lazy du ctx throw, l'item reste marqué « started » → jamais retenté (échec silencieux permanent, `.catch(() => {})`). Même pattern dans le moteur ShowManager (ShowManager.tsx L196-219). Pour `everybody.lmshow` (61.8 Mo → data URL ~82 Mo), le décodage peut prendre plusieurs secondes — l'audio démarre en retard mais démarre.
2. **`hope` et `Hope2` partagent le même `id`** (`show-1786593921221-6xujgwh3`) : `s.setShows(filter(sh.id !== showData.id))` (L1692) et la résolution store par `name || id` (L1633) peuvent faire pointer un widget vers le mauvais show selon l'ordre de chargement. À corriger côté export (id unique par show).
3. **Résolution store après restart** : `showData` est strippé à la sauvegarde (App.tsx L71-81) ; le widget ne fonctionne après restart que si le show est présent dans `showStore.shows` (via ShowManager « Load » L947-961, ou ajouté par un play précédent L1692). Sinon, file picker → si annulé, rien ne se lance.
4. **ShowManager a son propre moteur** (ShowManager.tsx, `startPlayback` L168+, `getAudioCtx` L143-145 appelé eagerly L173) : ce chemin-là n'était PAS affecté par le bug (ctx créé d'office) — cohérent avec un bug limité au flux VC `loadShow`.
5. Le fix est dans HEAD mais **pas forcément dans le build packagé** : `dist/electron/main.js` / `dist/renderer` doivent être régénérés (ou le dev server relancé) pour que l'utilisateur voie l'audio.

---

## 9. Rapport factuel — fichiers et lignes clés

| Élément | Fichier:Ligne |
|---|---|
| `startShowPlayback()` (moteur show) | `src/views/PerformanceView.tsx:221` |
| `let audioCtx = null` (jamais init, bug) | `src/views/PerformanceView.tsx:234` |
| Démarrage DMX (lights) | `src/views/PerformanceView.tsx:298-304` |
| Branche audio du tick + FIX lazy AudioContext | `src/views/PerformanceView.tsx:341-370` (fix L348-359) |
| Ref playback (`audioCtx: null`) | `src/views/PerformanceView.tsx:501-512` |
| `handlePlayShow` + listener | `src/views/PerformanceView.tsx:523-537` |
| `activate()` | `src/views/PerformanceView.tsx:1608` |
| Branche `loadShow` | `src/views/PerformanceView.tsx:1614` |
| Détection show vs QuickShow | `src/views/PerformanceView.tsx:1682` |
| `__lm_perfPlayShow` + dispatch | `src/views/PerformanceView.tsx:1698-1699` |
| Strip `showData` à la sauvegarde | `src/App.tsx:71-81` |
| `decodeAudioUrl` / cache partagé | `src/utils/audio-cache.ts:20-58` |
| Moteur ShowManager (ctx eager) | `src/views/ShowManager.tsx:143-175` |
| Fix commit | `948ffe1` (HEAD, 2026-08-16 18:58) |
