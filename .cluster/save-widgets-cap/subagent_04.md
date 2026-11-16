# Revue adverse — Fix « sauvegarde projet impossible après ~8 widgets »

**Revue :** subagent_04 (adversaire) — 2026-08-27
**Périmètre :** `src/utils/project-audio.ts` (nouveau), `src/App.tsx` (saveProject / __lm_open), `src/stores/showStore.ts`, `electron/main.ts`, `electron/preload.ts`, `src/__tests__/project-audio.test.ts`
**Validation mécanique effectuée :** `tsc --noEmit` → 0 erreur ; `vitest run project-audio.test.ts` → 6/6 passent ; **sonde node sur `yolo.lmproj` réel** (voir CRITIQUE-1).

---

## VERDICT GLOBAL : ❌ REFUSÉ

L'architecture est saine (externalisation + dédup par hash + résolution au chargement, ordre save/load correct), mais **le fix ne fonctionne pas sur les vraies données** : il plante sur le format réel des blobs, exactement avec le symptôme d'origine (sauvegarde silencieusement impossible). Deux blocants, un contrat description/code non respecté, plusieurs risques résiduels à documenter.

---

## 1. CRITIQUE-1 — `atob()` crashe sur les vraies données (data URLs) → la sauvegarde reste cassée, silencieusement

**Fichier :** `project-audio.ts:42-55` (`audioKeyOf`), appelé par `extractAudioField:60`, lui-même appelé pour chaque preset/show/track par `externalizeProjectAudio:82-110`.

`audioKeyOf` fait `atob(b64)` sur le champ **brut**. Or **tous** les `audioFileBase64` réels sont des **data URLs** (`data:audio/mpeg;base64,…`), pas du base64 nu :

- `QuickShowView.tsx:2080, 2143, 2280` → `audioFileBase64: audioDataUrl` (résultat `FileReader.readAsDataURL`) ;
- `PerformanceView.tsx:1100-1109` → reconstruit explicitement le préfixe `data:` s'il manque ;
- `SongPresetPlayer.tsx:183` utilise `preset.audioFileBase64` directement comme URL audio → incompatible avec du base64 nu ;
- **Preuve sur disque** (`yolo.lmproj` réel) : blob #1 = 17 459 931 chars `data:audio/mpeg;base64,SUQzBAA…`, blob #2 = 57 703 959 chars `data:audio/mpeg;base64,UklGRnZ…` — **les deux font échouer `atob` avec `Invalid character`** (sonde exécutée sous Node 22, comportement identique au renderer Chromium).

**Chaîne d'échec :** `atob` throw → `extractAudioField` rejette → `Promise.all` de `externalizeProjectAudio` rejette → `catch` de `saveProject` (App.tsx:146-148) → `return false` → `__lm_save`/TopBar (`TopBar.tsx:125`) ignorent le résultat → **aucun dialogue, aucun toast** : symptôme d'origine inchangé. Le chemin de migration v1→v2 (ancien projet rouvert puis resauvegardé) plante pareil, car les blobs inline v1 sont aussi des data URLs.

**Pourquoi les tests passent quand même :** les 6 tests n'alimentent que du base64 nu (`b64()` du test). Le cas réel n'est pas couvert — c'est précisément le test qui aurait attrapé le bug.

**Correction attendue :** retirer le préfixe avant hachage (ex. `const payload = field.includes(',') ? field.slice(field.indexOf(',') + 1) : field`), garder le champ complet (data URL) dans le blob écrit pour que la résolution/relecture reste identique, et **ajouter un test avec une vraie data URL**.

## 2. CRITIQUE-2 — Les widgets `audioAutoScript` embarquent `audioDataUrl` hors du fix → le plafond existe toujours

`PerformanceView.tsx:1309-1310` : la config du widget stocke `audioDataUrl` (data URL complète, ~50 Mo). `saveProject` ne strip que `config.showData` (App.tsx:75-85) et `externalizeProjectAudio` ne touche ni `vcWidgets` ni `appStore`. Un projet avec plusieurs widgets audio-autoscript réintègre les blobs dans le JSON → même `RangeError: Invalid string length` → même échec silencieux. Le plafond n'est pas supprimé, il est déplacé.

---

## Points vérifiés (avec numéros de ligne réels)

### ✅ 1. `externalizeProjectAudio` — strip / préservation / dédup / seuil (conception correcte, exécution bloquée par CRITIQUE-1)
- **Strip réel** : déstructuration + rest, pas un simple spread — presets `project-audio.ts:88`, tracks `:104`, shows `:109` (`audioFileBase64` ET ancien `audioRef` retirés, puis `...value` réappliqué). Presets sans audio (`undefined`) → `{}` → clé absente du JSON. `''` conservé tel quel (testé).
- **Préservation des autres champs** : `...rest` / `...tRest` / `...sRest` (88, 104, 109-110) ; `tracks` non-array préservée (`:98-108`) ; réapplication après `sFields` sans collision de clés (`:110`).
- **Dédup** : `Map` clé→blob `:75-79`, retour `Array.from(blobs.values())` `:120`. Test preset+show+track = 1 blob ✔ (test l.71-100).
- **Seuil** : `field.length < 1024` → en clair (`:59`) — appliqué et testé. ⚠ nuance : c'est une longueur **base64** (≈ 768 octets décodés), pas « 1 Ko d'audio » (cf. MINEUR-4).

### ✅ 2. `resolveProjectAudio` — v1 / v2 / manquant / tracks
- v1 inline : `hydrate` retourne tel quel tout `audioFileBase64` string (`:146-147`), testé (`REVG`) ✔.
- v2 : `fetchBlob` via le getter, `try/catch` → `undefined` (`:130-138`) ; testé ✔.
- Manquant → `audioFileBase64: undefined`, pas de crash (`:139`, `:155`), testé ✔ ; **tracks résolues aussi** (`:157-164`, testé) ✔.
- Note : les objets hydratés gardent `audioRef` (spread) — sans conséquence (le re-save re-strippe les deux et retombe sur la même clé), mais à connaître.

### ✅ 3. `saveProject` (App.tsx) — ordre et payload (hors CRITIQUE-1/2)
- Externalize **avant** construction de `data` : appel `:97-100`, `shows: showsOut` `:116`, `songPresets: songPresetsOut` `:117` → le payload `storage.set('autosave')`/`project.save` contient bien les versions allégées ✔.
- Save explicite : `JSON.stringify` `:134` → `project.save` `:135` → `writeAudioBlobs` **après** `:136` → annulation du dialogue = aucun blob écrit ✔ (conforme à l'intention).
- Autosave : ⚠ `storage.set('autosave', data)` `:129` est fait **AVANT** `writeAudioBlobs` `:130` — **contraire à la description du fix** (« avant le set »). Cf. MOYEN-1.
- Autres blobs dans le payload : `appStore` → rien (grep) ; `customFixtures` → JSON de définitions, petit ; widgets → `showData` strippé (75-85), configs playSong/playShow = ids seulement (PerformanceView:1075-1078, 1706-1710). **MAIS** `vcWidgets[].config.audioDataUrl` non couvert → CRITIQUE-2.

### ✅ 4. `loadProject` (`__lm_open`, App.tsx:287-361)
- `importCustomFixtureDefs` avant résolution des fixtures `:294` ✔.
- `resolveProjectAudio` **awaité** `:309` **avant** `ss.setShows` `:334` / `ss.setSongPresets` `:335` et **avant** `vcSetWidgets` `:345` ✔.
- `setShows`/`setSongPresets` **unconditionnels** `:334-335` (+ `setSceneFolders` `:328`) — pas de fuite d'état du projet précédent ✔.
- Fallback sans API storage `:313-315` : presets/shows bruts → projets v2 sans blob = horloge virtuelle, projets v1 inline fonctionnels ✔. (Réservé aux tests/web : en prod Electron l'API est toujours là.)

### ✅ 5. Wiring main/preload, store, types
- `storage:has` : `electron/main.ts:746-749` (`fs.existsSync`) ; preload `electron/preload.ts:135` ✔. `storage:set` est atomique temp+rename (`main.ts:735-741`) → un crash en cours d'écriture ne laisse pas de fichier à moitié écrit (rend le `has`-skip sûr).
- `showStore.ts` : `audioFileBase64` devient optionnel + `audioRef` sur `ShowTrackItem` (`:94-95`), `ShowData` (`:112-113`), `SongPreset` (`:177-180`) ; `setShows`/`setSongPresets` simples `set()` (`:987-991`, `:1025-1029`) ✔.

### ✅ 6. Widget Play Show après load
- Au save, `config.showData` strippé mais `showId`/`showName` conservés (App.tsx:75-85) ; au play, résolution `shows.find(s => s.name === config.showName || s.id === config.showId)` sur le **store** (PerformanceView:1706-1710) — store déjà peuplé avec les shows résolus avant le montage des widgets ✔. Le fallback file-picker `.lmshow` (1712-1714) lit un fichier self-contained ✔.

### ✅ Validation mécanique
- `npx tsc --noEmit` → **0 erreur**.
- `npx vitest run src/__tests__/project-audio.test.ts` → **6/6 passent** (mais ne couvrent pas le format réel, cf. CRITIQUE-1).

---

## Problèmes classés par gravité

| # | Gravité | Problème | Localisation |
|---|---------|----------|--------------|
| 1 | 🔴 **CRITIQUE** | `atob()` throw sur les data URLs réelles → `saveProject` catch → `return false` silencieux. **Le bug d'origine n'est pas corrigé.** | `project-audio.ts:45` |
| 2 | 🔴 **CRITIQUE** | `vcWidgets[].config.audioDataUrl` (widgets audioAutoScript) non externalisé → RangeError toujours possible | `PerformanceView.tsx:1309-1310` vs `App.tsx:75-85` |
| 3 | 🟠 MOYEN | Autosave : blobs écrits **après** `set('autosave')` (description du fix : avant). Crash entre les deux → snapshot de récupération avec refs pendantes (audio perdu à la restauration). Des orphelins seraient inoffensifs ; des refs pendantes non. Inverser l'ordre. | `App.tsx:129-130` |
| 4 | 🟠 MOYEN | **Non-portabilité du .lmproj** : le fichier ne contient plus l'audio → copié sur une autre machine, tout l'audio devient horloge virtuelle **silencieusement**. Incohérent avec `.lmshow` qui reste self-contained (`ShowManager.tsx:912-928`). Conçu ainsi (commentaire `project-audio.ts:131-134`) mais non documenté utilisateur. | `App.tsx:134-136` |
| 5 | 🟠 MOYEN | Échec d'écriture des blobs **totalement avalé** (`catch {}`) : projet sauvé avec refs vers blobs inexistants, `saveProject` retourne true, aucun warn. Rechargement = audio disparu sans explication. | `project-audio.ts:186-188` |
| 6 | 🟡 MINEUR | **Pic mémoire au save** : `Promise.all` sur tous presets/shows/tracks (`:82`, `:96`) → 8 × (55 Mo string + ~41 Mo binaire `atob` + ~41 Mo Uint8Array) ≈ **~1 Go transitoire** dans le renderer. `writeAudioBlobs`, lui, est séquentiel — hasher aussi en séquentiel (ou par lots). | `project-audio.ts:82, 96` |
| 7 | 🟡 MINEUR | **Blobs orphelins** : aucun GC des `audio-*.json` dans userData (deleteShow `showStore.ts:977`, removeSongPreset `:1013`, `__lm_new` App.tsx:255-282 ne nettoyent pas). Croissance disque non bornée, non documentée. (Un GC naïf serait dangereux : blobs partagés entre projets → au minimum documenter.) | userData |
| 8 | 🟡 MINEUR | Seuil « 1 Ko » mesuré en **caractères base64** (≈ 768 o décodés) — cosmétique, mais le commentaire `:20` induit en erreur. | `project-audio.ts:20-21, 59` |
| 9 | 🟡 MINEUR | Latences acceptables mais réelles : 1er save = N IPC de ~55 Mo + `JSON.stringify`+`writeFileSync` dans le main (~1-5 s une fois, puis skip via `has`) ; open = N `JSON.parse` de ~55 Mo dans le main (~1-3 s). À mesurer sur cible. | `main.ts:730-744` |
| 10 | ⚪ INFO | Clé = 64 bits du SHA-256 → collisions négligeables à cette échelle ; `has`-skip sûr car clé = hash du contenu. | `project-audio.ts:52-54` |

## Tests — couverture (question 6)

- **Présents et corrects pour les fonctions pures** : hash déterministe, seuil, strip+dédup (preset+show+track=1 blob), resolve v1/v2/manquant (tracks incluses), `writeAudioBlobs` skip, round-trip complet. 6/6 verts, tsc vert.
- **Manques qui comptent** :
  - **Aucun test avec data URL** (`data:audio/mpeg;base64,…`) → CRITIQUE-1 invisible. À ajouter en priorité absolue avec le fix ;
  - pas de test d'intégration `saveProject`/autosave (fonction non exportée, nécessiterait un harnais Electron) — acceptable, mais un test « format réel » du pipeline externalize→write→resolve suffit à verrouiller CRITIQUE-1 ;
  - bordures du seuil (1023/1024/1025) et chemin d'erreur de `writeAudioBlobs` non testés — mineur.

## Recommandations (dans l'ordre)

1. **Corriger `audioKeyOf`** pour tolérer les data URLs (strip du préfixe avant `atob`, stocker le champ complet dans le blob) + **test data URL immédiat**.
2. **Externaliser `config.audioDataUrl`** des widgets (même mécanique) ou le stripper au save avec re-résolution au load — sinon CRITIQUE-2.
3. **Inverser l'ordre autosave** : `writeAudioBlobs` avant `storage.set('autosave', data)` (refs pendantes impossibles, orphelins inoffensifs).
4. Un `console.warn` (voire toast « audio non persisté ») dans le catch de `writeAudioBlobs`.
5. Documenter la non-portabilité du .lmproj (README/aide + réflexion : option « embarquer l'audio » au save explicite, à l'image du .lmshow).
6. Séquentialiser le hachage (boucle `for…of` sur presets puis shows/tracks) pour plafonner la mémoire.
7. Décider d'une politique orphelins (documenter, ou GC prudent à la sortie : ne supprimer que les `audio-*` non référencés par **tous** les .lmproj connus — risqué, sinon assumer la croissance).

---

**Conclusion :** bonne architecture, mauvaise exécution sur le terrain. Le point 1 est rédhibitoire : tant que `atob` reçoit des data URLs, chaque save d'un projet réel échoue comme avant. Fixer CRITIQUE-1 + CRITIQUE-2, re-passer la sonde sur `yolo.lmproj`, ajouter le test data URL, et le design pourra être approuvé sur la base de cette revue (les points 1-6 hors blocants sont conformes).
