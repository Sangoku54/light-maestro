# plan.md — quit-save-reminder (rétablir le rappel de sauvegarde avant quitter)

## Demande utilisateur
« rétablit la fonction de rappel de sauvegarde du projet avant de quitter le programme, commit, et build le .exe »
→ 3 volets : fix fonctionnel + commit + build exe (accord explicite donné).

## Diagnostic mainline (cause racine)
Le mécanisme de rappel est COMPLET et intact dans le code :
- main.ts L327-331 : close guard (preventDefault + send `app:before-close`)
- preload.ts L143-149 : `onBeforeClose` / `closeAction`
- App.tsx L196-207 : listener → modal si `isDirty`
- App.tsx L437-499 : modal « Sauvegarder & Quitter / Abandonner & Quitter / Annuler » (i18n fr/en OK)
- main.ts L748-753 : `app:close-action` → isQuitting + close

MAIS : l'autosave (45s) appelle `saveProject({silent:true})` qui fait `markClean()` (App.tsx L116) → isDirty repasse à false peu après chaque modification → au quit, `isDirty` est false → fermeture immédiate SANS rappel. La fonction « rappel avant quitter » est morte pour l'usage réel.

## Fix retenu (chirurgical)
Retirer le `markClean()` du chemin autosave (L116) : l'autosave persiste le snapshot de sécurité mais NE marque PLUS le projet propre. Seul le save EXPLICITE (Ctrl+S / Save & Quit) marque propre. Effet :
- isDirty reste true après une modif → le rappel s'affiche au quit ✓
- l'autosave continue de protéger (snapshot récupérable) ✓
- quit sans modifs → pas de modal ✓
- Mettre à jour le commentaire autosave (L350-353).

## Sous-tâches
1. SA-1 — Vérification croisée du diagnostic (avant patch) : confirmer qu'aucun autre chemin de quit ne contourne le guard (tray, Cmd+Q, Alt+F4, plein écran Performance), vérifier z-index modal vs couches plein écran, vérifier que retirer markClean du silent save est sûr (pas d'autre dépendance sur ce comportement), vérifier si un indicateur UI dépend de isDirty (StatusBar). Sortie : .cluster/quit-save-reminder/subagent_01.md
2. Mainline — patch App.tsx (L113-118 : retirer markClean du silent + commentaire) + version bump 1.0.23 (package.json).
3. SA-2 — Revue adverse du diff final : sémantique isDirty, cas Save & Quit / Discard / Annuler, autosave toujours fonctionnel, aucun test cassé. Sortie : subagent_02.md
4. Validation : tsc + vitest.
5. Commit : `fix(quit): rappel de sauvegarde systématique avant quitter (autosave ne marque plus propre)` — App.tsx + package.json. DesignView.tsx (patch dossiers précédent) NON commité (mélangé au WIP utilisateur — signaler).
6. Build 1.0.23 : NSIS + portable, vérification bundle, copie DELIVERY\quit-save-reminder\.
7. Livraison finale.

## Dépendances
SA-1 → patch → SA-2 → tsc/tests → commit → build → DELIVERY.
