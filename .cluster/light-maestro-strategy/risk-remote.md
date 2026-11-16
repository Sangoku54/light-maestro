# Analyse de risque indépendante — Lot « Remote web LAN » (#17, commit 60bf739)

**Date :** 2026-08-14 — **Auteur :** subagent analyse risque (perspective adversarial bug, pas sécurité)
**Méthode :** lecture des fichiers réels (server.ts 569 lignes, remote-trigger.ts, main.ts, preload.ts, midi-actions.ts, output-arbiter.ts, dmx-bridge.ts, engine.ts, RemotePanel) + traçage des chemins start/stop/push/command. Aucun fichier modifié.

---

## Verdict global : **RISQUE FAIBLE**

Le lot est défensivement bien construit : les courses suspectées a priori (push vs stop, double-subscribe, timers après unmount) sont **couvertes par le design** — le push va dans un cache main (`setSnapshot`), jamais directement dans le serveur HTTP ; les cleanups React sont complets ; l'arbitre LTP gère la cohabitation MIDI/remote de façon documentée. Les bugs réels trouvés sont des **P2 transitoires ou hérités**, aucun P0/P1 crédible n'a été identifié. 44/44 vitest + tsc 0/0 restent cohérents avec cette lecture.

---

## Tableau des risques

| # | Risque | Sévérité | Probabilité | Scénario utilisateur concret | Mitigation / état |
|---|--------|----------|-------------|------------------------------|-------------------|
| 1 | **État « Actif » trompeur pendant la fenêtre EADDRINUSE** | P2 (affichage faux transitoire) | Moyenne | Port 8080 déjà occupé (autre service web, 2ᵉ instance). `start()` met `running=true` **synchroniquement** ; l'event `'error'` (EADDRINUSE) est asynchrone. `handleStart` re-lit `getStatus()` immédiatement, mais si l'erreur arrive **après** ce re-read (quelques ms), le panneau affiche « Actif » + URLs pendant ≤3 s alors que rien n'écoute. L'utilisateur scanne l'URL, la page ne charge pas, puis l'erreur rouge apparaît au poll suivant. | Auto-réparant (poll 3 s). Amélioration possible : dans `start()`, ne déclarer `running=true` qu'à l'event `listening`, et exposer un flag « démarrage en cours ». **Non bloquant.** |
| 2 | **Désync scènes VC console vs page web (dette héritée, pas introduite)** | P2 (bug visible) | Moyenne | L'utilisateur lance une scène depuis la Virtual Console, regarde son téléphone : la scène **n'apparaît pas active** et le bouton « Stop » web est un **no-op**. Le moteur scènes du hook (midi-actions `activeScenes`) est un miroir du VCButtonWidget (dette documentée en tête de midi-actions.ts) ; les scènes jouées par le vrai composant VC n'y sont pas. | Dette connue (refactor VCButtonWidget au backlog). **À documenter dans l'UI web ou la doc utilisateur** : « la page reflète les déclenchements web/MIDI, pas les boutons de la console ». Non régressif (même comportement MIDI). |
| 3 | **Serveur HTTP vivant + renderer mort → perte silencieuse de contrôle** | P2 (perte de contrôle sans message) | Faible | Le renderer crashe/gele pendant un show (watchdog → fail-safe blackout moteur). Le serveur HTTP continue de répondre (état figé), la page web affiche « Connecté », mais les POST → `webContents.send('remote:command')` vers un renderer mort → **commandes perdues silencieusement** (le `post().catch(()=>{})` de la page masque l'échec, et le serveur répond 200 avant même de savoir si la commande a été délivrée). | Le watchdog protège le matériel (blackout), mais pas l'UX web. Mitigation possible : `emitCommand` vérifie `webContents.isDestroyed()` / répond 503, ou heartbeat serveur↔renderer. Probabilité faible (crash renderer en show), impact réel. |
| 4 | **Page web affiche un état vide pendant ≤3,5 s au démarrage** | P3 (cosmétique transitoire) | Élevée (à chaque start) | `GET /api/state` sert `{}` tant que le hook n'a pas fait son 1ᵉʳ cycle (refreshStatus 3 s + push 500 ms). Un téléphone connecté juste après le start voit « Aucune scène », blackout off, GM 100, puis l'état réel arrive. | Transitoire, auto-réparant. Amélioration : serveur → `{ pending: true }` ou la page affiche « Synchronisation… » tant que `timestamp` absent. |
| 5 | **`'state' in wrapped` sur payload non-objet → TypeError dans le handler main** | P3 (log erreur, pas de crash) | Faible (seul un renderer bugué/malveillant l'envoie) | `remote:state` reçoit une string/number → `'state' in wrapped` throw. **Confirmé non-critique** : throw dans `ipcMain.handle` = promesse rejetée + log Electron, pas de crash du main ni du renderer (pushState est fire-and-forget via `ipcRenderer.send`). | Déjà documenté P3 (~L160 main.ts). Le push suivant (500 ms) restaure le snapshot. |
| 6 | **Snapshot non-sérialisable (BigInt/cycles) → 500 pour tous les clients web** | P3 | Très faible | Le structured clone IPC accepte BigInt/cycles ; s'ils arrivaient dans le cache, `JSON.stringify` de `sendJson` throw → catch global de `createServer` → 500 sur **tous** les polls pendant ≤500 ms, puis le push suivant valide répare. | Auto-réparant. Le hook ne pousse que number/boolean/string/null (vérifié : latency-meter → `number\|null`, stores → booléens/nombres). |
| 7 | **Fenêtre de 2 s « canaux à 0 » après un stop de scène/chaser remote** | P3 (comportement attendu, visible) | Moyenne | Stop d'une scène depuis le téléphone → `flushZeros` → `writeTransient` 2000 ms : les canaux restent **verrouillés à 0** pendant 2 s même si une source HTP (quickshow 40) devrait reprendre la main (LTP 70 > HTP 40, même à 0). L'utilisateur peut croire à une panne. | Comportement LTP existant (identique MIDI/VC) — pas une non-régression. Documenter dans les notes de version si besoin. |
| 8 | **Page web 401 permanente après redémarrage du serveur** | P3 | Moyenne | Token régénéré à chaque `start()` ; la page web garde l'ancien token en `sessionStorage` → 401 en boucle. L'utilisateur doit rouvrir l'URL depuis le panneau. | UX connue (P3 token en clair documenté). Amélioration possible : la page détecte 401 et propose « rouvrir depuis Light Maestro ». |
| 9 | **Stale listeners `'error'`/`'listening'` de l'ancien serveur après `stop()`** | P3 | Très faible | `stop()` ne détache pas les listeners de l'ancien `http.Server`. Si un event résiduel arrive après un `start()` rapide, `this.running`/`this.lastError` du **nouveau** serveur pourraient être corrompus. En pratique, post-close les events sont rares (EADDRINUSE n'arrive qu'au listen). | Faible risque. Mitigation propre : `srv.off('error', handler)` dans `stop()`. |
| 10 | **Slider GM de la page web écrasé pendant le drag par un snapshot stale** | P3 | Faible | `render()` (toutes les 500 ms) réécrit `gm.value` ; pendant un drag, si le POST throttle 150 ms a échoué, le slider « saute » en arrière au snapshot suivant. | Au pire visuel ; le snapshot reflète la valeur appliquée (miroir store + moteur), donc saut uniquement si la commande a échoué. |
| 11 | **Pas de timeout explicite sur les requêtes HTTP** | P3 (non-risque) | — | Pas de `req.setTimeout`/`server.requestTimeout` configuré. | **Couvert par les defaults Node** (headersTimeout 60 s, requestTimeout 300 s, keepAliveTimeout 5 s) → pas d'accumulation durable de sockets. Corps limité à 64 Ko. |
| 12 | **N clients web × poll 500 ms** | P3 (non-risque) | — | N téléphones pollent `/api/state` à 2 req/s chacun + JSON.stringify du snapshot par requête. | Charge triviale pour un serveur local (snapshot de métadonnées ~10-50 Ko). RAS. |

---

## Vérifications des courses/races suspectées (résultats)

1. **Push 500 ms vs arrêt du serveur** → **aucun risque**. Le push passe par `ipcRenderer.send('remote:state')` → `setSnapshot()` : il écrit dans un **cache main**, jamais dans le serveur HTTP. Un push « en vol » pendant un stop est stocké puis effacé par `stop()` (`snapshot = null`). Aucun crash possible, aucune incohérence durable. Le « crash » imaginable (push → serveur éteint) n'existe pas dans ce design.
2. **Hook vs démarrage tardif du serveur** → le 1ᵉʳ snapshot arrive ≤3,5 s (refreshStatus 3 s + push 500 ms), couvert (risque #4, P3).
3. **Double-subscribe `onCommand`** → le hook s'abonne une fois avec unsubscribe au cleanup ; en dev, StrictMode fait mount→cleanup→mount (fenêtre synchrone, aucun event IPC ne peut s'y glisser) ; en prod pas de double-mount. **Pas de double dispatch.**
4. **Timers (hook 3 s + 500 ms, panneau 3 s, copyTimer)** → tous avec cleanup/`cancelled` guard vérifié. Le panneau n'appelle `setState` qu'après `if (cancelled) return`. **Pas de setState après unmount.**
5. **Arbitre MIDI (75) + remote (70) simultanés** → LTP trié par priorité : midi gagne sur les canaux partagés, remote garde les siens ; le stop d'une source flushe avec **sa** source (`handle.sourceId`), reprise de main propre à la release. `registerSource` préserve les valeurs existantes. **Comportement documenté et testé (44/44).** Seul effet visible : désync d'affichage multi-contrôleur (les deux scènes « actives » dans le snapshot alors qu'une seule sort) — P3.
6. **`writeTransient` → `this.release` dans le setTimeout** → arrow function → `this` lexical = `dmxBridge` (appel en méthode). **Pas de bug** (vérifié, source de confusion classique).
7. **`blackout()`/`applyGrandMaster()` sur moteur arrêté** (chemin remote quand le moteur ne tourne pas) → `channelView` initialisé au constructeur, `sendXxxFrame` no-op défensifs, try/catch partout. **Pas de crash**, et l'état blackout/GM est cohérent au démarrage suivant (SAB déjà à 0).
8. **`getLatencyMs()`** → `number | null` (jamais d'objet/NaN). Sérialisation IPC sûre.

---

## Top 3 des risques les plus probables (ordre)

1. **Risque #1 — Fenêtre « Actif » trompeuse sur EADDRINUSE** (P2, probabilité moyenne) : le seul cas d'usage réel où un utilisateur verra un comportement faux, mais transitoire et auto-réparant. Recommandation : déclarer `running` à l'event `listening` (retourner plutôt un état « starting ») ou accepter les 3 s de latence.
2. **Risque #2 — Désync console VC ↔ page web** (P2, probabilité moyenne) : l'utilisateur qui mixe console physique et téléphone verra des états faux et des stops inefficaces. Dette héritée du lot MIDI, pas une régression — mais c'est le désync le plus **visible** en usage réel. Documenter.
3. **Risque #3 — Renderer mort + serveur qui répond** (P2, probabilité faible) : perte silencieuse de contrôle depuis le téléphone pendant un show. Le watchdog protège le matériel ; l'UX web reste trompeuse. Mitigation simple : `emitCommand` → 503 si la fenêtre est détruite/unresponsive.

---

## Pistes d'amélioration rapides (non bloquantes)

- `start()` : ne passer `running=true` qu'à `listening` (ou flag `starting`), pour que le statut retourné par `remote:start` soit honnête.
- `stop()` : `srv.off('error')` / `srv.off('listening')` avant `close()`.
- Serveur : répondre `{ pending: true }` sur `/api/state` tant qu'aucun snapshot n'a `timestamp`.
- `emitCommand` : si `mainWindow` détruit/unresponsive → 503 (au lieu de 200 puis perte silencieuse).
- Page web : sur 401, afficher « Token obsolète — rouvrez l'URL depuis Light Maestro » (déjà partiellement fait).
