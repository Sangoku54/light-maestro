# Re-check adversarial — Micro-fixes « robustesse » du lot Remote web LAN (#17)

**Date :** 2026-08-14 — **Auteur :** subagent re-vérification (perspective adversarial, code réel + preuves d'exécution)
**Périmètre :** les 4 micro-fixes répondant aux P2/P3 du rapport `risk-remote.md`, posés sur le commit 60bf739 (déjà revu 2× LIVRABLE).
**Méthode :** lecture des fichiers réels (`electron/remote/server.ts` 590 lignes en entier, `remote-trigger.ts`, `main.ts`, `performanceview.tsx`), exécution des preuves demandées + 2 vérifications supplémentaires (race stop-immédiat, miroir i18n). **Aucun fichier du repo modifié** (1 scratch ajouté dans `.openclaw/tmp/`, hors commit).

---

## VERDICT : **LIVRABLE** ✅

Les 4 fixes sont présents dans le code réel, corrects, complets, et sans régression détectée. Toutes les preuves d'exécution passent. Aucun nouveau bug introduit (0 régression signalée ; 2 réserves cosmétiques P3, voir plus bas).

---

## Tableau fix → vérification → preuve

| # | Fix attendu | Vérification dans le code réel | Preuve d'exécution |
|---|-------------|-------------------------------|--------------------|
| 1 | **Statut honnête `starting`** | `RemoteStatus.starting: boolean` requis dans `server.ts` (L28-29) **et** `src/types.d.ts` (L62-63). Garde d'idempotence `(this.running \|\| this.starting) && this.server` (L115). `start()` : `starting=true` après l'attache des handlers, avant `srv.listen()` (L163) ; bascule à `listening` → `running=true, starting=false` (L141-143) ou `error` → `running=false, starting=false, lastError` (L151-156). `stop()` reset `starting=false` (L176). `getStatus()` expose `starting` (L197). Panneau : interface locale `starting?: boolean` (L3091), badge « Démarrage… » (L3242-3248) + pastille ambre, bordure verte si `running \|\| starting`. i18n `perform.remote.statusStarting` fr « Démarrage… » / en « Starting… » | `npx tsc -p tsconfig.electron.json --noEmit` → **exit 0** ; `npx tsc --noEmit` → **exit 0** ; smoke : `assert.ok(st.running !== st.starting, 'running XOR starting')` + `running=true/starting=false` après listening → **SMOKE OK** ; `recheck-starting-eaddrinuse` : retour `{"running":false,"starting":true}` → error → `{"running":false,"starting":false,"lastError":"Port … (EADDRINUSE)"}` → **EADDRINUSE/STARTING OK** ; i18n mirror → **PASS** (22 clés fr/en) |
| 2 | **Détachement des listeners au stop** | Handlers stockés en champs privés `onListening`/`onError` (L92-93), assignés en closure (L140-158), attachés `srv.on(...)` (L159-160). `stop()` : `srv.off('listening', this.onListening)` / `srv.off('error', this.onError)` **avant** `closeAllConnections()/close()` (L182-185), puis `this.onListening = null; this.onError = null` (L186-187). Pas de fuite de référence : après stop, les handlers du vieux `srv` ne peuvent plus corrompre un re-start (testé : re-start rapide après stop dans le script EADDRINUSE, step 4, → `running=true` + nouveau token). | **EADDRINUSE/STARTING OK** (cycle starting→error→re-start→stop, listeners détachés) ; **bonus :** scratch `recheck-stop-race.cjs` — `start()` puis `stop()` **dans le même tick** sur port occupé (fenêtre où l'event `error` n'est pas encore arrivé, donc où le détachement pourrait laisser un `'error'` non géré) → **STOP-RACE OK**, pas de crash, état propre, re-start fonctionnel |
| 3 | **`pending` sur état non horodaté** | `GET /api/state` : `if (!snap \|\| typeof snap.timestamp !== 'number') → { pending: true }` (L229-233). Page embarquée : `render()` → `if (state.pending) { statusEl.textContent = 'Synchronisation...'; return; }` (avant tout rendu d'état vide) ; `lastGood` non mis à jour pendant pending → le fallback « Serveur injoignable » reste fonctionnel. **Non-régression critique vérifiée :** `remote-trigger.ts` `buildSnapshot()` pousse bien `timestamp: Date.now()` → `pending` est transitoire, jamais permanent. | **SMOKE OK** : `assert.deepStrictEqual(await r.json(), { pending: true })` sans snapshot, puis snapshot horodaté servi sans `pending` (`snap.pending === undefined`) ; `remote-i18n-check.cjs` → PASS |
| 4 | **503 si renderer mort** | `emitCommand()` retourne `boolean` : `!win \|\| win.isDestroyed() \|\| win.webContents.isDestroyed()` → `false` (L373-377). Les 4 handlers (`handleScene`, `handleChaser`, `handleBlackout`, `handleGrandMaster`) répondent **503 `{ok:false,error:'renderer indisponible'}`** si `false`, sinon 200 `{ok:true}`. | **SMOKE OK** : `mainWindow=null` → 503 sur scene/blackout/grandmaster ; renderer restauré → 200 ; 7 commandes normalisées reçues par le mock `webContents.send` |

---

## Preuves d'exécution (toutes refaites à la main)

| Preuve | Résultat |
|--------|----------|
| `npx tsc -p tsconfig.electron.json --noEmit` | **exit 0**, 0 erreur |
| `npx tsc --noEmit` | **exit 0**, 0 erreur |
| `npx vitest run` | **44 passed** (5 fichiers) — le compte rendu fait foi, pas l'exit code |
| `npm run build` | **exit 0** (« ✓ built in 9.52s ») — dist régénéré AVANT les smokes (ils chargent `dist/electron/remote/server.js`) |
| `node .openclaw/tmp/remote-smoke.cjs` | **SMOKE OK** — toutes les routes : XOR starting, auth 401/200, page FR, pending→cache, 7 commandes, 503 renderer absent, 400, 404, id encodé, stop, restart token |
| `node .openclaw/tmp/recheck-starting-eaddrinuse.cjs` | **EADDRINUSE/STARTING OK** — cycle starting→error→re-start→stop |
| Scan U+FFFD (server.ts, types.d.ts, performanceview.tsx, fr.json, en.json) | **0 U+FFFD** sur les 5 fichiers |
| Zonage `git diff --stat` | **5 fichiers exactement** : server.ts (+74/−…), types.d.ts (+2), performanceview.tsx (+20/−…), fr.json (+1), en.json (+1). `1on6.lmpreset` / `yolo.lmproj` = données utilisateur (shows de test), ignorés conformément au périmètre |
| Bonus : `node .openclaw/tmp/recheck-stop-race.cjs` | **STOP-RACE OK** — pas de crash sur start→stop immédiat (port occupé) |
| Bonus : `node .openclaw/tmp/remote-i18n-check.cjs` | **PASS** — 22 clés `perform.remote.*` en miroir fr/en, pas de mojibake |

---

## Non-régressions vérifiées (demandées)

1. **remote-trigger.ts** — type local `RemotePreloadApi.getStatus?: () => Promise<{ running: boolean }>` : le contrat réel (types.d.ts) a un champ **en plus** (`starting`) → structurellement compatible (typage structurel ; et l'accès se fait via cast `as unknown as`). `serverRunning = !!st?.running` : inchangé, le gate push reste correct (pas de push pendant `starting` — le 1ᵉʳ push arrive ≤3,5 s après listening, comportement existant documenté au risque #4 du rapport). `timestamp: Date.now()` présent. **Aucune erreur TS** (prouvé : tsc 0/0).
2. **main.ts** — `remote:start` retourne le statut de `start()` sans supposer `running=true` au retour (le panneau lit le statut retourné et re-lit via `remote:getStatus`). `remote:getStatus` : `if (!status.running) return status;` → pendant `starting`, pas d'URLs (correct : rien n'écoute encore) ; elles arrivent au poll suivant une fois `running=true`. Aucune supposition de l'ancien contrat.
3. **Polling du panneau (~L3160)** — `setError(st.lastError ?? null)` : l'erreur est re-dérivée du serveur à **chaque** poll. Scénario EADDRINUSE après le re-read de `handleStart` (qui fait `setError(null)` puis `if (st.lastError) setError(st.lastError)`) : le poll 3 s suivant voit `lastError` non-null → l'erreur est affichée, jamais effacée par un `setError(null)` inconditionnel (aucun trouvé). Pendant la fenêtre `starting`, l'utilisateur voit « Démarrage… » (pastille ambre), **jamais** « Actif » trompeur — objectif du fix #1 atteint.

---

## Régressions trouvées

**Aucune.** (0 P0, 0 P1, 0 P2, 0 P3.)

## Réserves (cosmétiques, non bloquantes)

1. **Indentation i18n** (P3, cosmétique) : `"statusStarting"` est indenté à 4 espaces dans `fr.json`/`en.json` au lieu de 6 (alignement du bloc). JSON valide (build + i18n-check OK), zéro impact runtime.
2. **`starting?: boolean` optionnel côté panneau** (P3, défensif) : l'interface locale de `performanceview.tsx` déclare `starting` optionnel alors que le contrat réel (`types.d.ts`) le rend requis. Sans conséquence (le champ est toujours présent ; l'accès `!!status?.starting` tolère l'optionnel). Pas une non-régression — simple note pour le prochain refactor de types.
3. **Fenêtre `starting` sans URLs** : pendant les ~ms de `listen()`, `remote:getStatus` ne remplit pas les URLs (`running=false`) → le panneau affiche « Démarrage… » sans URLs quelques instants. Comportement voulu et honnête (l'URL n'est pas valide avant l'écoute réelle), auto-réparant au poll suivant.

## Conclusion

Les 4 micro-fixes répondent exactement aux P2/P3 ciblés (risques #1, #3, #4, #9 du rapport de risque), sans effet de bord détecté y compris sur le cas limite de course start→stop immédiat (testé empiriquement). Le lot Remote web LAN (#17) + micro-fixes = **LIVRABLE**.
