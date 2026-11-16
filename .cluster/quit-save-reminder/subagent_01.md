# Rapport de vérification croisée — Rappel de sauvegarde avant quit (close guard)

Agent : subagent_01 (vérification croisée, aucun fichier modifié)
Date : 2026-08-27 — Arbre de travail : HEAD `3aeddcc` + modifications non commitées (dont `electron/main.ts`, `electron/preload.ts`, `src/App.tsx`)
Note : le main process est dans `electron/` (pas `src/main/`). Les numéros de ligne cités sont ceux de l'arbre de travail actuel.

---

## 1. Chemins de quit — passage par le close guard ?

**Verdict : OK** (avec 2 notes ATTENTION mineures, aucune ne contourne le guard pour l'utilisateur)

Inventaire exhaustif des chemins de sortie :

| Chemin | Code | Passe par le guard ? |
|---|---|---|
| Croix fenêtre (X) — fenêtre frameless `titleBarStyle:'hidden'` + `titleBarOverlay` (boutons natifs conservés) | `electron/main.ts:196-216` → `mainWindow.on('close')` `electron/main.ts:327-332` | ✅ OUI : `preventDefault()` + `send('app:before-close')` → renderer décide |
| Alt+F4 | idem (événement `close` de la fenêtre) | ✅ OUI |
| Tray → Quit | `electron/main.ts:343` : `mainWindow?.webContents.send('app:before-close')` | ✅ OUI (même chemin que la croix) |
| Menu application / Cmd+Q | Aucun : `Menu.setApplicationMenu(null)` `electron/main.ts:851` | ➖ N'existe pas |
| Bouton UI custom (TopBar/views) | Aucun : le bouton Power de la TopBar est le **blackout**, pas un quit (`src/components/layout/TopBar.tsx:183` + toggle L186-198). Aucun `window.close()`/`closeAction` hors App.tsx dans tout `src/` | ➖ N'existe pas |
| Serveur HTTP LAN (remote) | `electron/remote/server.ts` — aucune commande quit/exit/shutdown | ➖ N'existe pas |

**⚠️ Note 1 — `before-quit` + `app.exit()` (bypass général) :** `electron/main.ts:887-897` :
```js
app.on('before-quit', (event) => {
  if (!isQuitting) {
    event.preventDefault();
    isQuitting = true;
    ...
    setTimeout(() => app.exit(), 100);   // exit forcé, pas d'événement close
    return;
  }
});
```
Tout `app.quit()` avec `isQuitting=false` → `app.exit()` en 100 ms **sans** `app:before-close` → bypass du guard. Les seuls appels à `app.quit()` sont :
- `electron/main.ts:67` (uncaughtException — crash main, guard sans objet) ✅ acceptable
- `electron/main.ts:294` (renderer-gone — renderer mort, guard impossible) ✅ acceptable
- `electron/main.ts:906` (window-all-closed — ne peut survenir qu'après un close autorisé par le guard) ✅

Aucun chemin **utilisateur** n'appelle `app.quit()` directement → **pas de bypass utilisateur**.

**⚠️ Note 2 — `app:install-update` :** `electron/main.ts:833-837` pose `isQuitting = true` puis `autoUpdater.quitAndInstall()` → bypass volontaire du guard (l'utilisateur a explicitement cliqué « installer »). Acceptable, mais si `isDirty` au moment de l'installation, pas de rappel — cas rare, non bloquant.

**⚠️ Note 3 — session-end Windows (arrêt/redémarrage OS) :** aucun handler `session-end`/`query-session-end`. Le guard `preventDefault()` sur `close` pendant un shutdown OS peut bloquer la fermeture (Windows force le kill après délai). L'autosave 45 s limite la perte. Hors scope du fix, à noter seulement.

---

## 2. Plein écran / overlays — le modal peut-il être MASQUÉ ?

**Verdict : PROBLÈME** — oui, le modal (z-[100]) peut être masqué par des overlays plein écran déjà ouverts.

Le modal est rendu en fin d'arbre App, après StatusBar : `src/App.tsx:438-440`
```jsx
{showCloseModal && (
  <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={handleCancelClose}>
```
Aucun des conteneurs intermédiaires (`main`, divs de vues, `app-shell`) ne crée de stacking context (pas de transform/filter/opacity/z-index/position) → les z-index sont **globaux**. Inventaire des couches ≥ 100 :

| Overlay | z-index | Plein écran ? | Masque le modal z-100 ? |
|---|---|---|---|
| `src/App.tsx:440` — modal close guard | 100 | oui | — (le sujet) |
| `src/views/PerformanceView.tsx:834` — menu contextuel widget VC | 100 | non (menu petit, `clampRect`) | Non — même z, DOM plus tard → modal au-dessus |
| `src/views/PerformanceView.tsx:944` — **WidgetConfigModal** (config widget VC) | **110** | oui (`fixed inset-0`) | ⚠️ OUI |
| `src/views/QuickShowView.tsx:40` — **PromptModal** (remplace window.prompt) | **200** | oui (`fixed inset-0`) | ⚠️ OUI |
| `src/views/TrackTimeline.tsx:3425, 3507` — gradient picker / édition bloc couleur | **9999** | oui | ⚠️ OUI |
| `src/views/TrackTimeline.tsx:3551, 3591, 3632` — édition blocs dimmer/strobe/etc. | **9998** | oui | ⚠️ OUI |

(TrackTimeline est utilisé par QuickShowView : `src/views/QuickShowView.tsx:18-19, 2966, 3477-3479`.)

**Scénario réel :** l'utilisateur configure un widget VC (WidgetConfigModal ouvert), clique sur la croix (bouton natif toujours cliquable, fenêtre frameless) → `app:before-close` → `showCloseModal=true` → le modal se rend **sous** l'overlay z-110 → rien de visible. Cliquer le backdrop de l'overlay le ferme, et **là seulement** le modal apparaît. Comportement « l'app n'a rien fait » trompeur (récupérable, mais bug UX réel).

**Fix minimal (1 ligne) :** passer le modal à `z-[10000]` (au-dessus du max actuel 9999) — `src/App.tsx:440`. Le modal est déjà rendu en dernier dans le DOM à la racine d'App, donc aucune autre couche ne peut le dépasser après ça.

---

## 3. Sûreté du fix markClean-autosave

**Verdict : OK** — retirer `if (ok) useAppStore.getState().markClean();` (`src/App.tsx:117`) du chemin silent est sûr. Deux points analysés :

### (a) Dépendances sur « autosave → propre »
Lectures de `isDirty` dans tout `src/` (hors store) : **3 seulement, toutes dans App.tsx** :
- `src/App.tsx:71` (destructuring dans saveProject — épuré, pas une lecture métier)
- `src/App.tsx:200` (close guard : décision modal/immediate) — c'est justement le comportement visé
- `src/App.tsx:357` (skip autosave)

**Aucun indicateur « non sauvegardé »** dans StatusBar/TopBar : StatusBar (`src/App.tsx:507-585`) n'affiche que DMX/BPM/blackout/analyse. Aucun autre composant ne lit `isDirty` (grep exhaustif `isDirty` sur tous les .ts/.tsx : uniquement App.tsx, appStore.ts, et les ~60 `markDirty()` des stores).

**Cohérence sémantique après fix :** `markClean` = « le projet est sauvegardé dans un fichier .lmproj » (save explicite `src/App.tsx:124`, ou New/Open `L326`). L'autosave écrit un snapshot de secours dans `userData/autosave.json`, **pas** le fichier projet → le projet n'est PAS « propre » après autosave → le rappel au quit est exactement le comportement voulu. Rien ne « reste allumé » à tort : il n'y a pas d'indicateur, et s'il y en avait un, « non sauvegardé » serait correct.

### (b) Conséquence : réécriture autosave toutes les 45 s sans fin
Après fix, `isDirty` reste `true` après l'autosave → la condition `if (!isDirty) return` (`src/App.tsx:357`) ne skippe plus jamais → le snapshot complet (tout le showStore : scenes/chasers/effects/cueLists/shows/songPresets/mtcMarkers/patchedFixtures + widgets) est resérialisé (JSON.stringify sur le thread principal) + écrit sur disque **toutes les 45 s, indéfiniment, même sans aucune activité** (~1920 écritures/jour, ordre de grandeur : centaines de Mo à quelques Go/jour selon la taille du projet, plus des pics CPU réguliers).

**Amélioration minimale recommandée (timestamp, ~5 lignes) :**
1. `src/stores/appStore.ts` — interface (L141-143) + état initial (L254) : ajouter `dirtyAt: number | null` (initial `null`) ; `markDirty` (L255) : `set({ isDirty: true, dirtyAt: Date.now() })` (le timestamp se met à jour à chaque édition → reflète la dernière modif).
2. `src/App.tsx` — boucle autosave (L353-360) : variable module `let lastAutosaveAt = 0;` puis :
```ts
const id = setInterval(() => {
  const st = useAppStore.getState();
  if (!st.isDirty) return;
  if (st.dirtyAt && lastAutosaveAt >= st.dirtyAt) return; // déjà snapshotté après la dernière modif
  saveProject({ silent: true }).then((ok) => { if (ok) lastAutosaveAt = Date.now(); });
}, AUTOSAVE_INTERVAL_MS);
```
Effet : pendant l'édition active → écrit toutes les 45 s (comme aujourd'hui) ; dès que l'utilisateur arrête d'éditer → 1 seule écriture puis skip jusqu'à la prochaine modif. Aucune régression sur la récupération. (Alternative acceptable si le projet est petit : ne rien faire et assumer l'écriture/45 s.)

---

## 4. Save & Quit — parcours complet après fix

**Verdict : OK** — le parcours « Sauvegarder & Quitter » reste correct.

`src/App.tsx:363-380` :
```ts
const handleSaveAndQuit = async () => {
  setSaving(true);
  try {
    const saved = await saveProject();              // L368 — dialog .lmproj (non-silent)
    if (!saved) {
      await saveProject({ silent: true });          // L372 — dialog annulé/échec → snapshot autosave
    }
  } catch { ... }
  useAppStore.getState().markClean();               // L377 — markClean explicite conservé
  setSaving(false);
  window.lightMaestro.app.closeAction('discard');   // L379 → main.ts:749-754 → isQuitting=true → close OK
};
```
- **Chemin nominal :** save dialog OK → `markClean` (L124) → closeAction. ✅
- **Chemin dialog annulé :** `saved=false` → autosave silent (sans markClean après fix — sans impact) → **markClean explicite L377** → closeAction → quitte. ✅ Le fix ne casse rien : le markClean de L377 couvre le cas où le silent ne nettoie plus.
- **Mutual exclusion** `projectSaveInFlight` (`src/App.tsx:52`) : l'autosave du tick 45 s pendant un dialog ouvert est skippé proprement. ✅

**Cas « dialog annulé → quitte quand même » : acceptable ?** Oui sur le principe (l'utilisateur a choisi « Sauvegarder & Quitter », annuler le dialog de fichier n'annule pas la volonté de quitter ; le snapshot est écrit). **MAIS attention pré-existante (hors scope du fix) :** le snapshot autosave n'est **jamais relu** — aucun `storage.get('autosave')` dans le code (seul le `set` à `src/App.tsx:116`). Le commentaire « session stays recoverable » (L371) est théorique : pas de parcours de restauration dans l'UI. À noter pour un futur ticket, pas un blocage du fix.

---

## 5. Autres dépendances de isDirty / tests

**Verdict : OK** — aucun test ne dépend du comportement actuel.

- Grep `isDirty` dans `src/__tests__/` (24 fichiers .ts) : **0 résultat**.
- Grep `markClean` / `markDirty` / `autosave` / `AUTOSAVE` / `onBeforeClose` / `closeAction` / `showCloseModal` / `before-close` dans les tests : **0 résultat**.
- Grep `appStore` / `App.tsx` / `storage` dans les tests : **0 résultat** — aucun test n'importe le store app ou App.tsx (les tests couvrent moteurs/parsers : dmx-movement, ofl-parse, gencues, auto-loops, etc.).
- Autres dépendances de `isDirty` : uniquement les ~60 appels `markDirty()` dans `src/stores/showStore.ts` et `src/stores/performStore.ts` (écritures, pas de lecture conditionnelle) — aucun ne change de comportement si `isDirty` reste true après autosave.

---

## 6. Historique git

**Verdict : OK** — la régression est datée et le fix rétablit le comportement d'origine.

- `git log -S 'markClean' -- src/App.tsx` → `59ae67f` (mais l'autosave est arrivé avant, masqué par le rename `src/app.tsx` → `src/App.tsx` dans 59ae67f ; `git show` confirme) :
- `git log -S 'AUTOSAVE_INTERVAL_MS'` → **`6681b91`** (2026-08-14, « Phase 0 fiabilisation : … save&quit complet + autosave + atomicite … ») : introduit l'autosave 45 s **et** le `if (ok) markClean()` du chemin silent (`git show 6681b91:src/app.tsx` L93-94) → **c'est ici que la régression est née**.
- `git log -S 'showCloseModal'` / `git log -S 'onBeforeClose'` → **`d9493d4`** (2026-07-25, « v1: DMX stable ») : close guard main (`electron/main.ts:327-332`), tray Quit (L343), modal renderer + `closeAction` (`src/app.tsx` L55-70 identique à l'actuel). À cette époque **pas d'autosave** → `isDirty` restait true après 45 s → **le rappel était systématique dès qu'il y avait des modifs non sauvegardées**. C'est le comportement que le fix restaure.
- `git blame electron/main.ts:887-897` → `59ae67f` (2026-08-15) : before-quit blackout (`app.exit()`), renames de fichiers.
- Chronologie : 07-25 → rappel systématique (isDirty jamais nettoyé) ; **08-14 → régression** (autosave → clean → plus de rappel si inactif > 45 s) ; 08-15 → blackout quit + restructuration.

---

## VERDICT GLOBAL : le fix markClean-autosave est **SÛR** (avec 2 ajustements recommandés)

Le retrait de `if (ok) useAppStore.getState().markClean();` (`src/App.tsx:117`) est correct, minimal et rétablit le comportement pré-6681b91 : `isDirty` ne reflète plus que la sauvegarde explicite du fichier projet ; l'autosave reste un snapshot de secours. Aucun test, aucun indicateur UI, aucun autre chemin ne dépend du comportement actuel.

**Ajustements exacts recommandés (par ordre d'importance) :**

1. **Anti-masquage du modal — 1 ligne, à faire avec le fix :**
   `src/App.tsx:440` : `z-[100]` → `z-[10000]` (au-dessus du max actuel 9999 : TrackTimeline L3425/3507/3551/3591/3632, QuickShowView L40, PerformanceView L944). Sans ça, le rappel peut être invisible si un éditeur de blocs / config widget / prompt est ouvert au moment du quit.

2. **Éviter l'écriture autosave sans fin (perf/SSD) — optionnel mais recommandé, ~5 lignes :**
   - `src/stores/appStore.ts` : ajouter `dirtyAt: number | null` (interface L141-143, état initial L254 `null`) ; `markDirty` (L255) → `set({ isDirty: true, dirtyAt: Date.now() })`.
   - `src/App.tsx` L353-360 : skip si `lastAutosaveAt >= dirtyAt` (détail en section 3b). Si le projet JSON est petit et que l'on accepte ~1920 écritures/jour, cet ajustement peut être différé.

3. **Rappels hors scope (à noter, non bloquants) :** (a) le snapshot autosave n'est jamais relu (pas de restauration UI) ; (b) `app:install-update` (main.ts:833-837) et session-end Windows contournent le guard — comportements volontaires/limites OS, à documenter plutôt qu'à corriger.
