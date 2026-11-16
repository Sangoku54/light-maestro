# Revue adverse — Fix « rappel de sauvegarde avant de quitter »

Agent : subagent_02 (revue adverse, aucun fichier modifié)
Date : 2026-08-27
Base : HEAD 3aeddcc + working tree (fix non commité)

---

## A. Sémantique isDirty / dirtyAt — VERDICT : OK

- `src/stores/appStore.ts:256-258` — `dirtyAt: 0` initial, `markDirty: () => set({ isDirty: true, dirtyAt: Date.now() })`, `markClean: () => set({ isDirty: false, dirtyAt: 0 })`. Cohérent, atomic.
- Tous les appels `markDirty()` (src/stores/showStore.ts ~50 sites, performStore.ts 8 sites) passent par le même setter — aucune écriture directe `isDirty: true/false` hors store (vérifié par grep, aucun `isDirty: true|false` hors appStore.ts:255).
- **Aucun endroit ne dépendait de l'ancien comportement « l'autosave rend propre »** : grep exhaustif → `isDirty` n'est lu QUE dans App.tsx:201 (close guard) et App.tsx:360 (autosave). Aucun indicateur UI (StatusBar, TopBar, StateBar) ne lit isDirty. Pas de régression possible de ce côté.
- Exclusion de la persistance : `partialize` (appStore.ts:456-471) n'inclut pas isDirty ni dirtyAt ✓ ; `saveProject` App.tsx:71 destructure `dirtyAt` hors de `persistable` ✓ ; le `merge` (appStore.ts:474-481) reçoit `...current` par défaut → après rechargement localStorage, dirtyAt=0/isDirty=false ✓ (le commentaire « NOT persisted - resets on reload » reste vrai).
- Nota (pré-existant, hors périmètre du fix) : DesignView.tsx:6539/6549/6594 appellent `markClean()` après un *export* `.lmproject` (format design-v1 différent du .lmproj). C'était déjà le cas avant le fix ; sémantiquement discutable (un export ≠ un save projet), mais inchangé et ne touche pas le mécanisme autosave/quit. À corriger un jour, pas bloquant ici.

## B. Boucle autosave — VERDICT : OK (1 micro-race à connaître)

`src/App.tsx:356-365` :
```ts
let lastAutosaveAt = 0;
const id = setInterval(async () => {
  const { isDirty, dirtyAt } = useAppStore.getState();
  if (!isDirty) return;
  if (lastAutosaveAt >= dirtyAt) return;
  const ok = await saveProject({ silent: true });
  if (ok) lastAutosaveAt = Date.now();
}, AUTOSAVE_INTERVAL_MS);
```
- Cas (1) modif→T1, autosave→écrit, lastAutosaveAt=T2>T1 → skip aux ticks suivants ✓ (plus d'écriture/45s sans fin).
- Cas (2) nouvelle modif→T3>T2 → réécriture ✓.
- Cas (3) save explicite→markClean (dirtyAt=0, isDirty=false) → skip ✓.
- Cas (4) échec snapshot→ok=false→lastAutosaveAt inchangé→retenté au tick suivant ✓ ; chevauchement avec un save en cours → `projectSaveInFlight` (App.tsx:53,65) renvoie false → retenté ✓. Pas de boucle infinie possible.
- Closure : `lastAutosaveAt` local à l'effet, deps `[]` → stable. `clearInterval(id)` présent dans le cleanup (L364) ✓.
- **Micro-race (mineure, à documenter)** : `lastAutosaveAt = Date.now()` est pris APRÈS le save. Si une modif survient pendant la fenêtre async du save (après le `getState()` de capture, avant la fin de l'écriture), on a dirtyAt=T3 < lastAutosaveAt → la modif ne sera PAS incluse dans le snapshot autosave et ne sera ré-écrite qu'à la prochaine modif (T4 > lastAutosaveAt). Impact : le slot autosave peut être en retard d'une modif ; isDirty reste true donc le quit guard couvre la perte ; et le slot autosave n'est de toute façon jamais relu au démarrage (write-only, cf. infra). Correctif de durcissement possible : `const dirtySnapshot = dirtyAt; ... if (ok) lastAutosaveAt = dirtySnapshot;` — strictement plus sûr (re-save au tick suivant si modif pendant le save). Non bloquant.
- **Fait notable** : le slot `'autosave'` est écrit (App.tsx:118) mais JAMAIS relu au démarrage (grep : seule occurrence). C'est un slot de récupération manuelle, pas un restore automatique — la cohérence dirty/clean n'en dépend pas. ✓

## C. Modal z-index — VERDICT : OK

- Inventaire complet des z-index (grep `z-[n]`) : 60×8, 70×6, 100×1 (menu contextuel PerformanceView:834), 110×1 (WidgetConfigModal PerformanceView:944), 200×1 (PromptModal QuickShowView:40), 9998×3, 9999×2 (TrackTimeline:3425/3507/3551/3591/3632), **10000×1 (App.tsx:445)**. Aucun style `zIndex` inline plus haut. z-[10000] est bien le maximum → le modal passe au-dessus de tous les overlays existants. ✓
- Comportement conservé : backdrop `onClick={handleCancelClose}` (App.tsx:446), panneau `stopPropagation` (App.tsx:449), boutons Save&Quit / Discard / Annuler intacts (L464-499). Pas d'Escape-to-close — pré-existant, pas une régression.

## D. Save & Quit / Discard / Cancel — VERDICT : OK

- `handleSaveAndQuit` (App.tsx:368-385) : `saveProject()` réussi → markClean interne (L125) puis markClean explicite (L382, redondant mais inoffensif) → closeAction ✓. Dialog annulé → `project:save` renvoie null (main.ts:699) → saveProject renvoie false → fallback `saveProject({silent:true})` (sans markClean maintenant, mais L382 markClean quand même) → closeAction ✓. Le comportement « quit quand même » est documenté dans le code et cohérent avec le choix utilisateur ; le snapshot autosave garde la session récupérable.
- `handleDiscardAndQuit` (L387-390) : markClean + closeAction ✓.
- « Annuler » (L392-394) : `setShowCloseModal(false)`, isDirty reste true → le prochain quit re-déclenchera le modal ✓.
- Chaîne main : `app:close-action` (main.ts:750-755) pose `isQuitting=true` puis `mainWindow.close()` → le handler `close` (main.ts:328-331) laisse passer ✓. `before-quit` (main.ts:888-895) : blackout + app.exit — pas de fuite.

## E. Régressions possibles — VERDICT : OK

- Aucun test ne référence isDirty/markClean/markDirty/autosave/saveProject (grep src/__tests__ vide) → pas de casse de tests, mais aussi **aucune couverture** sur ce mécanisme (à noter : un test unitaire du pattern « autosave ne rend plus propre » serait bienvenu).
- Couverture tsc : `tsconfig.json` inclut `"src"` → appStore.ts ET App.tsx compilés par le check renderer ✓ ; `tsconfig.electron.json` n'inclut que `electron` (appStore.ts n'y est PAS compilé — pas un problème, le build electron utilise dist/electron, et le renderer est transpilé par Vite ; les .ts du renderer n'ont pas à être dans le config electron).
- Relance : `npx tsc --noEmit -p tsconfig.json` → **0 erreur** ; `npx tsc --noEmit -p tsconfig.electron.json` → **0 erreur** ; vitest (auto-loops.test.ts) → 32/32 pass.
- Autre chemin de quit : tray Quit (main.ts:343) → `app:before-close` → guard ✓. `app:install-update` (main.ts:833-837) pose isQuitting=true sans passer par le guard — mais c'est une action initiée par l'utilisateur depuis le renderer après téléchargement de l'update ; hors périmètre du fix, acceptable (le slot autosave limite la perte).

## F. Écran de veille / session-end Windows — VERDICT : PROBLÈME (déclaration du brief inexacte)

Le brief indique « main.ts L833-837 contourne le guard — signalé comme volontaire ». **Faux : les lignes 833-837 sont le handler `app:install-update`** (autoUpdater.quitAndInstall), sans rapport avec le session-end. Grep exhaustif : **il n'existe AUCUN `powerMonitor` / `session-end` / `query-session-end` / `shutdown` / `lock-screen` dans tout electron/**.
Conséquences réelles :
- **Veille** : pas d'événement `close` au sleep → aucun impact, l'app reprend au resume. OK.
- **Arrêt / déconnexion Windows** : le OS émet WM_QUERYENDSESSION ; avec un `preventDefault()` dans le handler `close`, Windows affichera « Cette application empêche l'arrêt » (ou tuera le process selon la config), et les changements non sauvegardés peuvent être perdus (le slot autosave 45s limite la perte à ≤45s de travail).
Ce n'est pas un « contournement volontaire » : c'est un non-traitement. **Recommandation** : soit l'accepter explicitement comme risque résiduel (l'autosave 45s + quit guard couvrent 99 % des cas), soit ajouter `powerMonitor.on('shutdown')` / un flush autosave synchrone sur `query-session-end` — à trancher hors de ce fix, mais la note du brief doit être corrigée.

## G. Vérification TypeScript — VERDICT : OK

- `npx tsc --noEmit -p tsconfig.json` → exit 0 (0 erreur)
- `npx tsc --noEmit -p tsconfig.electron.json` → exit 0 (0 erreur)
- Vitest ciblé → 32/32 pass.

---

## VERDICT GLOBAL : APPROUVÉ

Le fix est correct et atteint son objectif : l'autosave ne masque plus la saleté du projet, le rappel quit se déclenche à nouveau, et la boucle autosave ne réécrit plus en continu. Points validés : A ✓, B ✓ (1 micro-race documentée), C ✓, D ✓, E ✓, G ✓. F : pas de session-end handling du tout (le brief le présentait à tort comme volontaire) — risque résiduel à acter explicitement, hors périmètre du fix.

### Corrections / actions recommandées (non bloquantes)
1. **B (durcissement optionnel)** App.tsx:361-363 — capturer `dirtyAt` AVANT le save et affecter `lastAutosaveAt = dirtyAtSnapshot` au lieu de `Date.now()`, pour qu'une modif survenue pendant la fenêtre du save soit re-snapshottée au tick suivant :
   ```ts
   const dirtySnapshot = dirtyAt;
   const ok = await saveProject({ silent: true });
   if (ok) lastAutosaveAt = dirtySnapshot;
   ```
2. **F** — Corriger la note du brief (L833-837 = auto-update, pas session-end) et décider explicitement : accepter le risque (documenter) ou ajouter `powerMonitor.on('shutdown')` + flush autosave. Aucun code requis pour ce fix.
3. **Tests** — Ajouter un test unitaire verrouillant « saveProject({silent:true}) ne rend plus propre » (aucun test ne couvre actuellement le mécanisme).
4. **Hors périmètre, à mettre au backlog** : DesignView.tsx:6539/6549/6594 (`markClean()` après export .lmproject) — l'export marque le projet propre, ce qui peut désactiver le rappel quit à tort ; idem, non régressé par ce fix.
