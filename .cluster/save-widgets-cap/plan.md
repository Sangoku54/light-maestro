# plan.md — Sauvegarde projet impossible après ~8 widgets (onglet Performance)

## Demande utilisateur
« Je fais des sauvegardes à chaque nouveau preset paramétré dans un widget de l'onglet Performance. J'arrive à sauvegarder 8 widgets, et après, quand je clique sur le bouton "sauvegarder", il ne se passe plus rien. »

## Diagnostic mainline (faits mesurés, yolo.lmproj)
- Le projet .lmproj embarque `showStore.shows` (complets : « New Show » = 16,7 Mo de tracks) et `showStore.songPresets` (avec `audioFileBase64` = L'AUDIO COMPLET en base64 : le preset « 1on6 » = **55 Mo à lui seul**).
- Mesure : yolo.lmproj actuel = 72,5 Mo dont 55,5 Mo de songPresets (1 preset) + 16,7 Mo de shows.
- Limite V8 (testée) : une string JS ne peut pas dépasser ~2^29-24 chars (≈ 536 Mo en one-byte) → `JSON.stringify` d'un objet dont le JSON dépasse cette taille jette **RangeError: Invalid string length** → `saveProject` (App.tsx) catch → `return false` → échec silencieux (console.error seulement, aucun dialogue, aucun toast).
- Scénario utilisateur : 8 widgets « Play Preset »/« Play Show » avec des audio de 40-60 Mo → 8 × 55 Mo ≈ 440 Mo + shows + overhead JSON → proche de la limite ; le 9ᵉ ajout fait dépasser → plus AUCUNE sauvegarde possible (bouton Enregistrer + Ctrl+S + autosave 45 s, tous via saveProject).
- Même sous la limite : JSON.stringify de 200-400 Mo dans le renderer = freeze de plusieurs secondes/minutes (« il ne se passe plus rien »).

## Chemin du bug (vérifié)
TopBar « Enregistrer » → `__lm_save` (App.tsx L331) → `saveProject()` (L64) : `if (projectSaveInFlight) return false` ; construit `data` (appStore + showStore complet + vcWidgets avec showData stripé) ; `JSON.stringify(data, null, 2)` → **RangeError si > ~536 Mo** → catch (L140) → return false. Autosave (L358-368) et Save & Quit (L372-378) passent par le même chemin. Le bouton widget « sauvegarder » (PerformanceView L934) = vcUpdateWidget (en mémoire, OK) ; la persistance réelle = la sauvegarde du projet.

## Fix à concevoir (2 options à arbitrer par les auditeurs)
- **Option A — Externalisation des blobs** : les audio des songPresets et les shows complets sont stockés dans userData (fichiers séparés) ; le .lmproj embarque des références (id) au lieu des blobs → projet léger (~quelques Mo), plus de RangeError. Fallback : si le blob manque au load (autre machine), preset/show chargé sans audio (warning).
- **Option B — Compression gzip** : compresser les champs base64 (audioFileBase64, shows tracks) avant stringify → ~70 % plus petit (440 Mo → ~130 Mo < 536 Mo) ; le projet reste auto-contenu ; stringify ~130 Mo (freeze ~2-5 s).
- Recommandation préliminaire : A pour les blobs audio/shows (robuste, élimine aussi les freezes) ; à valider par les auditeurs.

## Axes subagents (S3)
- SA-1 « Auditeur chaîne de sauvegarde » : tracer TOUS les chemins save/load (saveProject, loadProject, autosave, Save&Quit, IPC presets:save/load, imports .lmpreset/.lmshow, ShowManager save) ; confirmer où les blobs passent ; reproduire le RangeError (seuil exact) ; vérifier qu'aucun autre garde-fou n'existe (taille max, quota). Sortie : subagent_01.md.
- SA-2 « Concepteur du fix stockage » : concevoir l'implémentation EXACTE de l'option choisie (A ou B) — nouveaux handlers IPC éventuels, format de référence, migration schemaVersion, points de compression/décompression, fallback absence de blob, impact autosave. Sortie : subagent_02.md.
- SA-3 « Auditeur impacts widgets/presets » : les consommateurs de songPresets (widget Play Preset, SongPresetPlayer), shows (widget Play Show, ShowManager), exports .lmpreset/.lmshow — l'externalisation casse-t-elle le playback offline, l'export, l'ouverture sur une autre machine ? Tests existants à ajuster. Sortie : subagent_03.md.

## Dépendances
SA-1 → SA-2 → implémentation mainline → revue adverse (SA-4) → tsc + vitest → livraison (pas de build exe sans accord).

## Livrables
- Fix saveProject/loadProject (+ IPC si externalisation)
- Tests (régression : projet avec gros blobs → sauvegarde OK, chargement OK)
- review.md + DELIVERY/quit-save-capacity/ (dossier livraison)
