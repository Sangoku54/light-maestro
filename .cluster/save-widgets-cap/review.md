# review.md — Sauvegarde projet impossible après ~8 widgets (onglet Performance)

## Demande utilisateur
« Je fais des sauvegardes à chaque nouveau preset paramétré dans un widget de l'onglet Performance. J'arrive à sauvegarder 8 widgets, et après, quand je clique sur le bouton "sauvegarder", il ne se passe plus rien. »

## Cause racine (confirmée par mesure, pas par hypothèse)
- Le projet .lmproj embarque **l'audio complet en base64** : `songPresets[].audioFileBase64` (le preset « 1on6 » = **55 Mo**), `shows[].audioFileBase64` + `shows[].tracks[].items[].audioFileBase64` (l'audio est COPIÉ dans les tracks de show à l'ajout).
- `saveProject` (App.tsx) fait `JSON.stringify(data, null, 2)` sur cet ensemble ; la limite de taille d'une string en V8 est ~536 Mo (2^29-24) — **au-delà, JSON.stringify jette RangeError: Invalid string length**.
- 8 presets × ~55 Mo ≈ 440 Mo + shows + overhead JSON → le 9ᵉ ajout fait dépasser la limite → le catch de saveProject fait `return false` **sans aucune information visible** (console.error seulement) → « il ne se passe plus rien ». Le bouton Enregistrer, Ctrl+S, l'autosave 45 s et Save & Quit passent tous par le même chemin.
- Même sous la limite, le stringify de 200-400 Mo **gèle le renderer** plusieurs secondes.
- Mesures : yolo.lmproj (vrai projet utilisateur) = 72,5 Mo dont 55,5 Mo de songPresets (1 preset audio 55 Mo) + 16,7 Mo de shows (track « Hope remastered » 16,65 Mo en items[].audioFileBase64). Limite V8 reproduite empiriquement : RangeError à ~256-536 Mo.

## Fix livré (commit 818bc83)
**Externalisation des blobs audio** (option validée par l'auditeur impacts : gzip inefficace sur de l'audio déjà compressé ; l'audio absent ne casse rien — le DMX joue sur horloge virtuelle, comportement conçu et testé) :
1. **Nouveau module `src/utils/project-audio.ts`** :
   - `externalizeProjectAudio(presets, shows)` : retire les blobs audio des presets, du show (`audioFileBase64`) et des track items (`tracks[].items[].audioFileBase64`), les remplace par `audioRef: 'audio-<hash16>'`, déduplique par hash SHA-256 du contenu (un même audio dans preset + track = 1 fichier), seuil 1 Ko (les petits champs restent en clair), **traitement séquentiel** (le hachage de 8×55 Mo en parallèle pousserait le renderer à ~1 Go).
   - `resolveProjectAudio(presets, shows, get)` : résout les `audioRef` au chargement depuis userData ; les blobs v1 en clair passent tels quels ; un blob manquant → audio absent (playback DMX sur horloge virtuelle, pas de crash).
   - `resolveWidgetAudio(widgets, get)` : résout `config.audioRef` des widgets audioAutoScript (config.audioDataUrl).
   - `writeAudioBlobs(blobs, storage)` : écrit les blobs dans userData via IPC storage, **skip si déjà stocké** (les saves suivants ne réécrivent pas des dizaines de Mo), échecs loggués (console.warn) sans bloquer la sauvegarde.
2. **App.tsx** : saveProject utilise l'externalisation (payload du projet : 72,5 Mo → ~1 Mo sur le vrai fichier de test) ; les blobs sont écrits **avant** l'autosave (jamais de référence pendante en cas de crash) et **après le choix du chemin** pour le save explicite (annulation = rien n'est stocké) ; le widget `audioAutoScript` (config.audioDataUrl) est lui aussi externalisé. loadProject résout les blobs **awaité avant l'hydratation des stores et avant vcSetWidgets** ; setShows/setSongPresets désormais unconditional (anti-fuite d'état entre projets).
3. **Types** (showStore.ts) : `audioFileBase64` optionnel + `audioRef?: string` sur SongPreset / ShowData / ShowTrackItem.
4. **electron/main.ts + preload.ts** : handler `storage:has`.

## Preuve sur les vraies données (sonde sur yolo.lmproj, exécution du code corrigé)
- presets : 55,5 Mo → 0,4 Mo ; shows : 16,7 Mo → 0,0 Mo ; 2 blobs externalisés (55,0 + 16,7 Mo) en 227 ms ; résolution en 1 ms ; restauration à l'identique (comparaison stricte des data URLs avant/après).
- Payload projet final ≈ 1 Mo → la limite V8 n'est plus atteignable avec des dizaines de presets/widgets.

## Processus de revue
- 3 auditeurs dispatchés (2 ont échoué à cause d'une interruption de session, 1 livré : « Auditeur impacts presets/widgets » — rapport subagent_03.md) : verdict « faisable, runtime structurellement prêt » (audio absent = horloge virtuelle testée, strip showData déjà opérationnel, triple présence des blobs à traiter, portabilité).
- Revue adverse du diff (subagent_04.md) : **REFUSÉ initial avec 2 blocants prouvés** : (1) les vrais champs sont des data URLs (`data:audio/mpeg;base64,…`) → mon atob sur le champ brut throw Invalid character → fix : parsing du data URL + hash sur la partie base64 pure + blob stocké complet ; (2) les widgets audioAutoScript embarquent config.audioDataUrl (plafond déplacé, pas supprimé) → fix : extraction des audioDataUrl des widgets + résolution au load. Findings secondaires corrigés : blobs écrits avant l'autosave, hachage séquentiel (pic mémoire), échecs d'écriture loggés. Corrigé puis **preuve empirique sur yolo.lmproj réel : PROBE_OK**.

## Validation
- tsc 0 (renderer + electron), vitest **320/320** (8 tests project-audio : hash, seuil, externalize/dédup items, resolve v1/v2/manquant, data URLs réels, resolveWidgetAudio, writeAudioBlobs skip, round-trip complet).
- Sonde sur yolo.lmproj réel : externalisation + restauration à l'identique ✓.
- Commit `818bc83` (6 fichiers). ⚠ Mélange assumé avec du WIP non commité dans main.ts (fixtures:importGDTF) et showStore.ts (disabledFixtures) — signalé à l'utilisateur.

## Backlog (hors périmètre, documenté)
- ~28 fixtures « Strobe / Speed / Sensitivity » [Nothing] → safety net 128 = pulse (turn strobe).
- Blobs orphelins dans userData (preset supprimé → blob reste) : pas de GC — les fichiers `audio-<hash>.json` s'accumulent (~55 Mo chacun) ; nettoyage à ajouter si le disque devient un sujet.
- Le .lmproj n'est plus auto-contenu pour l'AUDIO sur une autre machine (les références pointent vers userData locale) : les méta-données restent complètes, l'audio manque → playback DMX sur horloge virtuelle. Les exports .lmshow/.lmpreset restent auto-contenus.
- DesignView export .lmproject (chemin secondaire) : non couvert par l'externalisation (export manuel rare, format v1 assumé).
