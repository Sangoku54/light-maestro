# Subagent 19 — Serveur web LAN (lot #17 Remote web LAN)

**Date** : 2026-08-14 · **Agent** : serveur-web-lan · **Base** : `a82b953` (Phase 1 lot 2) + état working tree

## Construit

| Fichier | Statut | Contenu |
|---|---|---|
| `electron/remote/server.ts` | **NOUVEAU** (~370 lignes) | Serveur HTTP embarqué (`node:http` seul) + classe `RemoteServer` + page web embarquée |
| `electron/main.ts` | modifié (+39/−1) | Zone remote uniquement : imports, instance globale, 4 handlers IPC, câblage `setMainWindow`, stop au quit |
| `electron/preload.ts` | modifié (+7) | `remote: { getStatus, start, stop }` — exactement la DÉCISION du brief |
| `src/types.d.ts` | modifié | `RemoteStatus`, `RemoteSceneEntry`, `RemoteChaserEntry`, `RemoteStateSnapshot` + `remote` sur `LightMaestroAPI` (miroir) |
| `.openclaw/tmp/remote-smoke.cjs` | outil test | Smoke test runtime du module compilé (18 assertions) |

## Détails clés du serveur (`electron/remote/server.ts`)

- **`RemoteServer`** : `start(): RemoteStatus` (idempotent, redémarrable après erreur), `stop(): void` (ferme le port, efface token+snapshot, `closeAllConnections`), `getStatus(): RemoteStatus`, `setSnapshot()`, `setMainWindow()`, `getToken()`.
- **Réseau** : `0.0.0.0`, port 8080 par défaut, `process.env.LM_REMOTE_PORT` (validation 1–65535, fallback + warn si invalide).
- **Auth** : token `crypto.randomBytes(16).toString('hex')` à chaque `start()` ; header `X-Auth-Token` OU query `?token=` ; comparaison **temps constant** (sha256 + `timingSafeEqual`) ; 401 sinon. **Jamais loggé** (le log de démarrage n'affiche ni IP ni token ; seule sortie = URLs dans `remote:getStatus`).
- **Routes** : `GET /` (page embarquée), `GET /api/state` (cache du snapshot, `{}` si vide), `POST /api/scene/:id` (`play|stop|toggle`), `POST /api/chaser/:id` (`play|stop|next|previous`), `POST /api/blackout` (`on: boolean`), `POST /api/grandmaster` (`value: 0..1`). Body JSON limité 64 Ko (413), JSON invalide → 400, id URL-encodé décodé (`decodeURIComponent` safe), route inconnue → 404. Headers : `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, charset utf-8.
- **Commandes** : émises **une seule fois** au renderer (server.ts:321) :
  `this.mainWindow?.webContents.send('remote:command', command)` avec le format normalisé exact du brief : `{type:'scene',id,action}`, `{type:'chaser',id,action}`, `{type:'blackout',on}`, `{type:'grandMaster',value}`.
- **Page embarquée** (FR, dark, tactiles) : token query → `sessionStorage` → header `X-Auth-Token` ; poll `api/state` 500 ms ; boutons scène Lecture/Stop/Bascule, chaser ◀/Lecture/Stop/▶, blackout ON/OFF (rouge), slider grand master (throttle 150 ms) ; état « Serveur injoignable » si le poll échoue > 2,5 s. Construite **sans backticks ni `${`** (concaténation) pour rester dans le template TS ; charset utf-8 déclaré.
- **IPC** : le serveur n'importe electron qu'en `import type` (aucun require runtime) → testable hors Electron.

## Câblage main (`electron/main.ts`, zone remote uniquement)

```ts
ipcMain.handle('remote:start', () => remoteServer.start());
ipcMain.handle('remote:stop', () => { remoteServer.stop(); return remoteServer.getStatus(); });
ipcMain.handle('remote:getStatus', () => { /* + URLs LAN via os.networkInterfaces() */ });
ipcMain.handle('remote:state', (_e, payload) => { /* unwrap {state} OU direct → setSnapshot */ });
```

- `remote:getStatus` : `os.networkInterfaces()` → IPv4 non-internal → `http://<ip>:<port>/?token=<token>` (token via accessor `getToken()`, jamais loggé).
- `remote:state` : **`handle`** (pas `on`) — reçoit les pushes `ipcRenderer.send` ET `invoke` ; réponse sans contenu (équivalent 204). Accepte les deux formes : `{ state: snapshot }` (brief) et snapshot direct (producteur réel, voir décisions).
- `remoteServer.setMainWindow(mainWindow)` dans `createWindow`, `setMainWindow(null)` au `closed`, `remoteServer.stop()` dans `window-all-closed`. Rien d'autre touché (MIDI/DMX/show intacts — vérifié au diff).

## Décisions

1. **Preload = getStatus/start/stop uniquement** (DÉCISION explicite du brief respectée). Pas d'`onState`, pas de `onCommand`/`pushState`.
2. **⚠️ CONTRAT INTER-AGENTS DÉCOUVERT** : le working tree contient déjà `src/hooks/remote-trigger.ts` (**untracked**, pré-existant, hors de ma zone — je n'y ai pas touché) qui consomme `remote:command` et pousse `remote:state` (snapshot **direct**, pas wrapper) toutes les 500 ms. Son docstring demande au preload `onCommand` + `pushState` (+ optionnel `dmx:applyGrandMaster`). Il se désactive proprement si absents (gardes typeof + logs debug). **Conséquence** : tant que le preload n'expose pas `onCommand`/`pushState`, la page web fonctionne mais les boutons ne pilotent pas encore le moteur (le hook attend). Mon `remote:state` (main) est compatible avec la forme directe du hook (testé). **Recommandation revue** : le prochain lot ajoute 2–3 lignes au preload (`onCommand`, `pushState`) pour activer le pont de bout en bout ; `dmx:applyGrandMaster` (canal IPC main, zone DMX — interdit dans ce lot) pour activer grandMaster.
3. **Types snapshot enrichis** : `latencyMs`/`dmxRunning`/`timestamp` ajoutés (optionnels) dans server.ts ET src/types.d.ts pour refléter le contrat réel du producteur (remote-trigger.ts). Format de commande : mon union == celle du hook (`scene id action?`, `chaser id action?`, `blackout on?`, `grandMaster value?`) — compatibles.
4. **« Répond 204 »** : le push est fire-and-forget (`ipcRenderer.send` côté hook) ; `handle` résout sans contenu pour les éventuels callers `invoke` ; pas de canal d'ack supplémentaire (inutile, l'UI web poll `api/state`).
5. **Sécurité** : bind 0.0.0.0 = exposition LAN assumée (token seul, **pas de TLS** — limite documentée, LAN de confiance) ; body limité ; comparaison token en temps constant.
6. **Échec de listen** (EADDRINUSE) : log + `running=false` ; `start()` nettoie un serveur mort avant recréation (redémarrable) ; nouveau token à chaque `start()`.
7. `'remote:command'` n'apparaît qu'**une seule fois en émission** (server.ts:321) ; `'remote:state'` reçu **une seule fois** (main.ts:158, `ipcMain.handle`). Les seules autres occurrences sont des commentaires de doc (dont le hook pré-existant).

## Vérifications (état final)

| Commande | Résultat |
|---|---|
| `npx tsc --noEmit` | **0 erreur** |
| `npx tsc -p tsconfig.electron.json --noEmit` | **0 erreur** |
| `npx vitest run` | **44/44 passed** |
| `npm run build` | **exit 0** (tsc electron + vite build ✓) |
| `node .openclaw/tmp/remote-smoke.cjs` | **SMOKE OK** — toutes routes validées |

Smoke test (module compilé `dist/electron/remote/server.js`, mock `webContents.send` injecté via `setMainWindow`) : démarrage/port env, token 32 hex, 401 sans/mauvais token, 200 header+query, page FR (lang fr, NOIR TOTAL, api/state, X-Auth-Token, sessionStorage, endpoints), `/api/state` vide puis snapshot servi, 7 commandes normalisées reçues dans l'ordre exact, validations 400 (action invalide, on non booléen, value hors [0,1], JSON invalide), 404, id URL-encodé décodé, stop (port libéré), redémarrage avec nouveau token (ancien → 401).

## Points pour la revue

1. **Activer le pont renderer** (preload `onCommand`/`pushState` + `dmx:applyGrandMaster`) — voir décision 2. Vérifier que `useRemoteTriggers` est bien monté dans `app.tsx`.
2. Le serveur est **LAN ouvert + token** : valider que c'est le niveau voulu (pas de TLS/whitelist d'IP dans ce lot).
3. `remote:state` en `handle` plutôt que `on` (choix délibéré, compatible send ET invoke).
4. Page web : le slider GM envoie la valeur en continu (throttle 150 ms) ; blackout optimiste au clic (état réel au prochain poll).
5. Fichiers modifiés hors lot : **aucun** — `src/views`, `src/hooks`, `src/engine`, `electron/midi`, `electron/dmx` intacts (seuls `remote-trigger.ts`/`midi-actions.ts` étaient déjà modifiés/untracked dans le working tree avant moi).
6. Grep final : émission `remote:command` = server.ts:321 (1×) ; réception `remote:state` = main.ts:158 (1×).
