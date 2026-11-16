# review.md — quit-save-reminder (rétablir le rappel de sauvegarde avant quitter)

## Cause racine
Le mécanisme de rappel (close guard) était COMPLET et intact : main.ts close guard (preventDefault + `app:before-close`), preload `onBeforeClose`/`closeAction`, App.tsx listener → modal si `isDirty`, modal « Sauvegarder & Quitter / Abandonner & Quitter / Annuler », IPC `app:close-action`. MAIS l'autosave (45 s) appelait `markClean()` dans `saveProject({silent:true})` → `isDirty` repassait à false peu après chaque modification → au quit, la fermeture était immédiate SANS rappel. La fonction existait dans le code mais n'apparaissait presque plus jamais.

## Fix livré
1. **App.tsx / appStore.ts** : l'autosave ne marque plus le projet propre — seul un save EXPLICITE (Ctrl+S / Save & Quit) appelle `markClean()`. Le rappel quit se redéclenche dès qu'il y a des changements non sauvegardés.
2. **`dirtyAt`** (appStore, non persisté) : timestamp de la dernière modif ; la boucle autosave ne réécrit le snapshot que si `dirtyAt > lastAutosaveAt` (plus d'écriture toutes les 45 s sans fin ; `snapshotAt` capturé avant le save async — micro-race durcie).
3. **Modal close guard : `z-[100]` → `z-[10000]`** : il pouvait être masqué par WidgetConfigModal (z-110), PromptModal (z-200), TrackTimeline (z-9998/9999).
4. **Test ajouté** `src/__tests__/app-store-dirty.test.ts` (3 cas : markDirty/dirtyAt, markClean reset, re-dirty).

## Revue adverse (subagent_02.md) : APPROUVÉ
A→E, G : OK (sémantique isDirty/dirtyAt cohérente, aucun UI ne dépendait de l'autosave-clean, les 4 cas de la boucle corrects, z-[10000] max, Save&Quit/Discard/Annuler cohérents, aucun test existant cassé).
F (acté, hors périmètre) : il n'existe AUCUN handler `powerMonitor`/session-end Windows — un arrêt système peut tuer le process (perte ≤45 s). Non traité dans ce turn, à acter séparément.

## Validation
- tsc renderer 0 / tsc electron 0
- vitest 302/302 (299 + 3 nouveaux)
- Build : vite OK (index-7m1GDQcF.js), NSIS_OK, PORTABLE_OK
- Bundle vérifié : `dirtyAt`, `z-[10000]` présents
- Commit `6f0b129` (4 fichiers : App.tsx, appStore.ts, test, package.json 1.0.23)
- Exe : `DELIVERY\quit-save-reminder\Light Maestro Setup 1.0.23.exe` (92,9 Mo) + `Light Maestro 1.0.23.exe` (78,9 Mo)

## Notes
- Incident process : mon `Set-Content` PowerShell a ajouté un BOM + mojibake à package.json, puis une commande ratée a créé un `package.json` vide à la racine du workspace (cassait esbuild `../package.json`). Les deux réparés (réécriture UTF-8 sans BOM via Node, suppression du fichier parasite). Leçon : ne plus écrire de JSON via Set-Content PS 5.1.
- WIP utilisateur non commité toujours présent dans le working copy (non touché, non commité).
