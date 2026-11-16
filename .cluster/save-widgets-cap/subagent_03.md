# Audit impacts presets/widgets — externalisation des blobs audio (.lmproj v2)

**Date :** 2026-08-27 — **Auteur :** subagent « Auditeur impacts presets/widgets »
**Périmètre :** consommateurs de `songPresets`, `shows`/`showData`, save/load .lmproj, tests, migration v1→v2.
**Objet du fix audité :** le .lmproj devient trop gros (55 Mo de `audioFileBase64` par preset, shows complets) → sauvegarde impossible après ~8 widgets. Fix proposé : externaliser les blobs hors .lmproj (userData, références par id) OU gzip.

---

## VERDICT GLOBAL

**Le fix est faisable sans casser le runtime, sous 4 conditions :**

1. **L'audio absent ne casse RIEN aujourd'hui** — c'est un comportement conçu et testé (horloge virtuelle). Un `audioFileBase64` vide/absent = pas de son, mais le DMX joue. Tous les chemins de lecture sont guardés ou tombent en fallback silencieux. **Aucun crash possible.**
2. **Le strip `showData` → `showId`/`showName` au save est DÉJÀ en place et fonctionnel** (App.tsx L82-90 + résolution par `storeShows.find` dans le widget Play Show). La résolution `showId → shows` après save/load marche aujourd'hui. **Externaliser les shows est donc cohérent avec l'existant** — mais attention au point 4.
3. **⚠️ Recommandation forte : externaliser uniquement les BLOBS audio, PAS les shows.** Le .lmproj est un format autonome et portable (les `customFixtures` sont embarqués expressément pour l'ouverture sur machine vierge, commentaire App.tsx L73-75). Sortir les shows du fichier casse la portabilité : .lmproj ouvert ailleurs → widgets Play Show muets (fallback file picker). Garder les shows + songPresets (squelettes sans blobs) dans le fichier, et déplacer les blobs vers userData avec `audioRef` par id.
4. **⚠️ gzip ne résout PAS le problème des blobs** : l'audio (MP3/WAV→base64) est déjà compressé, gzip gagne ~0-5 % dessus. gzip aide le JSON structurel seulement. Si gzip est choisi, il faut le combiner avec le strip des blobs, sinon le .lmproj reste ~55 Mo×N.

**Le vrai risque de casse n'est pas l'audio manquant, c'est la COURSE ASYNCHRONE au load** : si les blobs/shows sont résolus depuis userData en async, l'hydratation doit être `await`ée AVANT `vcSetWidgets`, sinon les widgets Play Show/Play Song voient un store vide → file picker (Show) ou `console.warn` + bouton mort (Song).

---

## 1. songPresets — consommateurs (grep `songPresets` dans src)

### Écritures (5 sites)

| Fichier:Ligne | Usage | audioFileBase64 nécessaire ? |
|---|---|---|
| `src/App.tsx:106` | saveProject : `showStore.songPresets` embarqué tel quel dans le .lmproj (**source du 55 Mo**) | Non au save — c'est LE champ à striper/externaliser |
| `src/App.tsx:302` | __lm_open : `setSongPresets(data.showStore.songPresets)` — hydratation directe, **sans branche schemaVersion** | Non en mémoire pour jouer (voir verdict), oui seulement pour le son |
| `src/App.tsx:266` | __lm_new : `setSongPresets([])` | — |
| `src/views/QuickShowView.tsx:2074-2094` | handleLoadPreset (import .lmpreset) : sync `setSongPresets([...])`, `audioFileBase64: audioDataUrl` (data URL reconstruit) | Champ toujours écrit (éventuellement `''`) |
| `src/views/QuickShowView.tsx:2136-2159` | handleSaveAsPreset : update in place (id stable pour les widgets), `audioFileBase64: audioDataUrl \|\| ''` | **Déjà `''` si pas de fichier audio** — le runtime supporte déjà l'absence de fait |
| `src/views/QuickShowView.tsx:2274-2296` | Re-import preset (liste locale) : update in place, `audioFileBase64: audioDataUrl` | Idem |
| `src/views/PerformanceView.tsx:1124-1135` | Widget playSong « Browse .lmpreset » : add/updateSongPreset, `audioFileBase64: audioSrc` (mime reconstruit) | Idem |
| `src/views/PerformanceView.tsx:1749` | Widget loadShow (.lmproject) : `if (p.songPresets) s.setSongPresets(p.songPresets)` | Non |
| `src/views/DesignView.tsx:6528,6587` | **2ᵉ chemin de sérialisation** : export .lmproject (`lightmaestro/design-v1`) embarque `songPresets` avec blobs ; import → setSongPresets | ⚠️ À couvrir par le fix aussi (ou assumer que l'export manuel reste v1) |
| `src/stores/showStore.ts:999,1006,1013,1020` | addSongPreset / removeSongPreset / updateSongPreset / setSongPresets — marquent tous `markDirty()` | — |

### Lectures (6 sites)

| Fichier:Ligne | Usage | Comportement si `audioFileBase64` vide/absent |
|---|---|---|
| `src/views/PerformanceView.tsx:926,1075-1081` | WidgetConfigModal : liste déroulante des presets (id/name/durée) | OK — n'utilise pas l'audio |
| `src/views/PerformanceView.tsx:1578-1591` | getSongLabel + **preload idle** : `preloadAudioUrl(sp.audioFileBase64 \|\| sp.audioDataBase64)` | **No-op silencieux** (guard `if (!url) return` dans audio-cache.ts) |
| `src/views/PerformanceView.tsx:1790-1793` | activate playSong : résolution `songId` puis fallback `songName` ; introuvable → `console.warn('PlaySong: preset not found', ...)` + return | **Pas de crash, bouton inerte + warn console** |
| `src/components/SongPresetPlayer.tsx:183` | `audioUrl = preset.audioFileBase64 \|\| preset.audioDataBase64` → decode → source node | **Absent → pas d'audio, horloge virtuelle pilote le DMX** (resolvePlaybackTime, commentaires explicites « a virtual wall-clock takes over so the show ALWAYS advances ») |
| `src/views/ShowManager.tsx:1300,1324,1437-1440` | Track audio : resources = songPresets → `handleAddItemToTrack(..., p.audioFileBase64)` copié dans `ShowTrackItem.audioFileBase64` | Item audio sans base64 → copie `undefined` → guardé partout en lecture (L210, L647) |
| `src/utils/audio-cache.ts` | `preloadAudioUrl` / `decodeAudioUrl` / `normalizeAudioUrl` | `undefined`/`null`/`''` → **null, aucun effet de bord** (testé) |

**Verdict songPresets :** `audioFileBase64` n'est nécessaire **en mémoire** que pour produire du son. Vide/absent → le preset joue son DMX sur horloge virtuelle, sans warning bloquant (le seul warn est « preset not found », qui n'arrive QUE si le preset entier est absent du store, pas si seul l'audio manque). Le type `SongPreset.audioFileBase64: string` (showStore.ts:175) est **requis en TS mais tolérant au runtime** (`''` est déjà produit par handleSaveAsPreset). Rendre le champ `audioFileBase64?: string` + ajouter `audioRef?: string` est sans risque.

---

## 2. shows (ShowData) — consommateurs (grep `shows` / `setShows` / `showData`)

### Écritures

| Fichier:Ligne | Usage | Notes |
|---|---|---|
| `src/App.tsx:106` | saveProject : `shows: showState.shows` embarqué (**source 2 du poids**) | Le show embarque `audioFileBase64` (ShowData) + chaque `ShowTrackItem.audioFileBase64` (copié depuis les presets au moment de l'ajout en track) |
| `src/App.tsx:300` | __lm_open : `if (data.showStore.shows) ss.setShows(...)` | ⚠️ Truthy-check : un fichier sans `shows` ne reset PAS le store → fuite d'état possible du projet précédent (déjà vrai aujourd'hui) |
| `src/App.tsx:265` | __lm_new : `setShows([])` | — |
| `src/views/PerformanceView.tsx:1766-1769` | Widget loadShow (fallback .lmshow/.lmproj ou store) : construit `showData {id,name,duration,tracks,audioFileBase64,audioFileName}` puis `s.setShows([...shows.filter(id!==), showData])` + `__lm_perfPlayShow` + event `lm-perf-play-show` | **Le show chargé vit dans le store** — cohérent avec la résolution par id |
| `src/views/ShowManager.tsx:955-965` | openDialog .lmshow : merge `useShowStore.setState({ shows: [...others, show] })` | Idem |
| `src/views/ShowManager.tsx:910,922-927` | Export .lmshow (`format: 'lightmaestro/show'`) : `audioFileBase64: selectedShow.audioFileBase64` + tracks | Format autonome embarqué — ne pas casser |
| `src/stores/showStore.ts` | createShow / updateShow / deleteShow / getShow / setShows — marquent dirty | — |

### Lecture cruciale — widget « Play Show » (VCButtonWidget activate, PerformanceView ~L1700-1770)

```ts
let p = config.showData;                        // (1) config embarquée (session courante, pas encore save/load)
if (!p) {
  const storeShows = useShowStore.getState().shows;
  p = storeShows.find((s: any) =>
    s.name === config.showName || s.id === config.showId  // (2) APRÈS save/load : résolution par id/nom
  );
}
if (!p) { /* (3) file picker .lmshow/.lmproj */ }
```

**Le bouton retrouve le show PAR `showId`/`showName` → `showStore.shows`, PAS par `config.showData`** (sauf session courante sans save). Le strip existant est donc déjà « sûr » : le show vit dans le store, le fichier ne garde que la référence. ⚠️ Détail : le `find` OR nom/id peut matcher un show homonyme avant de vérifier l'id (ambiguïté si deux shows portent le même nom) — risque faible, préexistant.

Après résolution, le widget **re-sette** le store (`setScenes`, `setChasers`, `setShows`, …) depuis le show trouvé, puis :
- `p.tracks || p.format?.startsWith('lightmaestro/show')` → playback local Performance (via `__lm_perfPlayShow`, **volontairement hors structured clone**, commentaire L1772-1774) ;
- sinon (.lmproject) → bascule QuickShow + `__lm_triggerPlay`.

### Playback show (PerformanceView startShowPlayback L230-380, ShowManager L210-213/L647-650)

Tous les usages de `item.audioFileBase64` sont **guardés** (`if (item.audioFileBase64 && ...)`) : preload (L279), déclenchement audio (L347), waveforms (ShowManager L647 `continue` si absent). Une track audio sans blob = silencieuse, le reste du show joue.

**Verdict shows :** strip `showData` déjà fonctionnel ; externaliser les shows (références par id) ne casserait PAS la résolution runtime **sur la même machine** — mais casserait la portabilité du fichier (voir VERDICT point 3). Si le fix choisit malgré tout de retirer `shows` du .lmproj : au load il faut résoudre les id depuis userData AVANT `vcSetWidgets`, et `setShows` doit être appelé (même à `[]`) pour éviter la fuite d'état du projet précédent.

---

## 3. Strip existant — vérification save/load « Play Show »

**✅ C'est déjà le cas aujourd'hui :** après un save/load, le widget Play Show rejoue correctement.

- **Save** (App.tsx L82-90) : `config.showData` retiré, `showId: showData.id`, `showName: showData.name` conservés.
- **Load** (App.tsx __lm_open) : **ordre correct** — `ss.setShows(data.showStore.shows)` (L300) est exécuté AVANT `vcSetWidgets(data.vcWidgets)` (L315). Le store est peuplé quand les widgets sont montés → `storeShows.find(...)` trouve le show.
- Le widget rejoue via le chemin complet (restore scènes/chasers/effects/fixtures + `setShows` + `__lm_perfPlayShow`).

**Implication pour le fix :** le mécanisme de référence par id est déjà éprouvé. Externaliser les shows = même mécanisme, mais en remplaçant la source « embarquée dans le fichier » par « chargée depuis userData », avec la contrainte d'ordre async (voir VERDICT point 4). Aujourd'hui l'hydratation est synchrone (données dans le JSON) → zéro course.

---

## 4. Tests existants — impact format v2

| Test | Contenu | Casse avec v2 (réfs/compression) ? |
|---|---|---|
| `src/__tests__/playback-clock.test.ts` | `resolvePlaybackTime` : horloge virtuelle quand audio absent/paused ; suit l'audio quand il joue ; ne recule jamais | **Non — au contraire, c'est la garantie que « audio absent ≠ show figé »**. Le fix peut s'appuyer dessus |
| `src/__tests__/audio-cache.test.ts` | `normalizeAudioUrl` : data URL intacts, base64 nu préfixé, `undefined/null/''` → null | **Non** — confirme que blob absent → null propre (preload/decode no-op) |
| `src/__tests__/app-store-dirty.test.ts` | dirty tracking (markDirty/markClean) — utilisé par setShows/setSongPresets | Non (ne touche pas la sérialisation) |
| `src/__tests__/scene-3d-config.test.ts` | round-trip JSON scènes via setState (pattern `JSON.stringify → parse → setState`) | Non (scènes seulement) |
| Autres tests (gencues, spatial-choreo, autoscript-sections…) | importent `genCues` de QuickShowView / types de showStore | Non — n'utilisent pas `audioFileBase64` |

**⚠️ GAP : aucun test ne couvre `saveProject`/`loadProject` (.lmproj), la sérialisation v1, une migration v1→v2, ni la résolution widget `showId → shows` après load.** Le fix devra ajouter :
1. round-trip .lmproj v2 (songPresets + shows + widgets) → store hydraté, widgets résolus ;
2. migration v1 (blobs en clair) → lisible tel quel ;
3. v2 avec `audioRef` manquant → warning + playback DMX sur horloge virtuelle (pas de crash) ;
4. ordre : résolution async des réfs avant montage des widgets.

---

## 5. Migration — compatibilité .lmproj v1

**État actuel du load (App.tsx __lm_open L280-330) :** `schemaVersion` (écrit à 1, L91) n'est **JAMAIS LU** au load. Le code hydraterait un v2 sans branche de migration → silencieusement faux si la forme des champs change. **Le fix DOIT ajouter la lecture de `data.schemaVersion` (ou `data.version`, les deux existent).**

Règles d'hydratation à implémenter (par champ) :

| Cas | Comportement attendu |
|---|---|
| `songPresets[].audioFileBase64` présent (v1, blobs en clair) | Hydrater tel quel — **compat v1 totale** |
| `audioFileBase64` absent + `audioRef` présent (v2) | Résoudre le blob depuis userData (ex. `storage.get('media/<audioRef>')`) et reconstruire le data URL ; **ou** hydrater avec `''` et résoudre en lazy au moment du play (l'horloge virtuelle couvre l'intervalle) |
| `audioFileBase64` absent + pas de `audioRef` (v2 incomplet/corrompu) | `console.warn` + hydrater avec `''` → playback DMX OK, pas de son |
| `showStore.shows` absent du fichier (v2 externalisé) | Charger depuis userData AVANT `vcSetWidgets` ; appeler `setShows` **même à `[]`** (convention « Unconditional » déjà utilisée pour `sceneFolders` L296-297 — sinon fuite d'état du projet précédent) |

Patterns existants à imiter : `if (data.customFixtures) await importCustomFixtureDefs(...)` (champ absent → skip propre) ; `ss.setSceneFolders(data.showStore.sceneFolders || [])` (unconditional, commentaire explicite anti-fuite). ⚠️ Attention : `__lm_open` ne reset PAS le showStore en début de load — le fix doit hydrater unconditional pour `shows` et `songPresets` comme pour `sceneFolders`.

---

## Risques de casse (priorisés)

1. **Course async au load** (critique) : si la résolution des blobs/shows depuis userData est async et non `await`ée avant `vcSetWidgets` → widgets Play Show = file picker, Play Song = `console.warn` + bouton mort. Aujourd'hui tout est synchrone (JSON embarqué).
2. **Portabilité du .lmproj** (élevé) : sortir les shows/blobs du fichier casse l'ouverture sur machine vierge (les customFixtures sont embarqués EXACTEMENT pour ça). → Externaliser les blobs seulement, garder structure shows/songPresets dans le fichier.
3. **Triple présence des blobs** (élevé) : un même audio peut exister dans `SongPreset.audioFileBase64`, `ShowData.audioFileBase64` ET `ShowTrackItem.audioFileBase64` (copié à l'ajout en track, ShowManager L443/L1300). Le fix doit traiter les 3 champs, sinon le .lmproj reste gros.
4. **Type TS** `SongPreset.audioFileBase64: string` requis (bas) : à passer en optionnel + `audioRef?: string` ; runtime déjà tolérant (`''` produit par QuickShowView L2143).
5. **DesignView .lmproject export (L6528)** : 2ᵉ chemin sérialisant les blobs — non couvert par saveProject. À traiter ou à assumer (export manuel, moins critique que l'autosave 45 s).
6. **gzip inefficace sur l'audio** (moyen) : MP3 déjà compressé → ~0-5 % de gain sur les blobs. gzip seul ne règle pas le bug.
7. **Fuite d'état au load** (bas, préexistant) : `if (data.showStore.shows)` truthy-check sans reset → hydrater unconditional en v2.
8. **Ambiguïté de nom** (bas, préexistant) : `storeShows.find(s => s.name === showName || s.id === showId)` — deux shows homonymes → le premier matche avant l'id.

## Fichiers concernés par le fix (carte d'impact)

- `src/App.tsx` : saveProject (payload v2 + strip blobs) + __lm_open (migration schemaVersion, résolution réfs, order async) — **le cœur**
- `src/stores/showStore.ts` : types `SongPreset`/`ShowData`/`ShowTrackItem` (champs optionnels + `audioRef`)
- `src/components/SongPresetPlayer.tsx` : lecture `audioRef` (lazy) si voulu — sinon rien (horloge virtuelle couvre)
- `src/views/PerformanceView.tsx` : résolution réfs au play (optionnel), preload (L1590) déjà safe
- `src/views/QuickShowView.tsx` : écritures songPresets (L2077/2139/2276) — champ optionnel, aucun changement requis si `audioRef` géré à l'hydratation
- `src/views/DesignView.tsx` : export .lmproject (décision : v1 assumé ou strip aussi)
- `electron/main.ts` : IPC de lecture/écriture des blobs userData (pattern `storage:get/set` L730-742 déjà en place, userData = `appData/light-maestro`, L28)
- Tests à ajouter : voir §4.

## Conclusion

Le runtime est **structurellement prêt** pour l'externalisation des blobs : audio absent = horloge virtuelle (testé), strip showData déjà opérationnel, guards partout. Le fix le plus sûr = **striper les 3 champs audio des blobs au saveProject (réfs `audioRef` vers userData), garder la structure shows/songPresets dans le .lmproj, migrer par `schemaVersion` au load avec résolution async AVANT vcSetWidgets**. Le gzip seul est insuffisant pour l'audio. Rien dans le code actuel ne casse si `audioFileBase64` est absent — c'est le point de départ du fix.
