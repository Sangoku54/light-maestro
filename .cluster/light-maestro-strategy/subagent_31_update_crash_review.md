# Revue adversariale — Lot #20 : Auto-update + Crash-reporting

**Date :** 2026-08-15  
**Auditeur :** Subagent #31 (revue adversariale)  
**Fichiers audités :** `crash-logger.ts`, `main.ts`, `preload.ts`, `types.d.ts`, `update-notification.tsx`, `TopBar.tsx`, `package.json`, `fr.json`, `en.json`

---

## Verdict : **LIVRABLE**

Le lot #20 est fonctionnellement correct, sécurisé, et ne présente aucun problème MAJEUR. Les quelques points mineurs listés ci-dessous sont des cosmétiques ou du mort-code i18n sans impact sur la stabilité.

**Validation :**
- `tsc -p tsconfig.electron.json` → EXIT 0 ✓
- `tsc -p tsconfig.json` → EXIT 0 ✓
- `vitest run` → 123/123 tests verts ✓

---

## 1. Auto-update

| Point | Statut | Sévérité |
|-------|--------|----------|
| Import `autoUpdater` depuis `electron-updater` | OK | — |
| `setupAutoUpdater()` appelé après `createWindow()` dans `whenReady()` | OK | — |
| Close guard contourné par `isQuitting = true` avant `quitAndInstall()` | OK | — |
| Champ `publish` dans `package.json > build` | OK | — |
| `autoUpdater.autoInstallOnAppQuit = true` vs flux "save & quit" | OK | — |
| Dev mode : `setupAutoUpdater` return early, `UpdateNotification` ne crash pas | OK | — |

**Détails :**

- L'import `import { autoUpdater } from 'electron-updater'` est correct.
- `setupAutoUpdater()` est appelé après `createWindow()` et `createTray()` dans `app.whenReady().then(...)`. `sendUpdateStatus()` vérifie `mainWindow && !mainWindow.isDestroyed()` avant d'envoyer.
- `app:install-update` handler : `isQuitting = true` puis `setTimeout(() => autoUpdater.quitAndInstall(), 500)`. Le close guard (`mainWindow.on('close')`) laisse passer quand `isQuitting` est true. Aucun `preventDefault()`. Correct.
- `publish` : `provider: "github"`, `owner: "vitte"`, `repo: "light-maestro"`, `releaseType: "release"`. Format valide pour electron-builder.
- `autoInstallOnAppQuit = true` : si une update a été téléchargée et l'utilisateur quitte (save & quit ou discard), l'update s'installe au quit. C'est le comportement standard de electron-updater, acceptable.
- En dev, `setupAutoUpdater()` retourne immédiatement. `getUpdateStatus()` retourne `{ state: 'idle' }`. `UpdateNotification` rend `null` pour `idle`. Pas de crash.

---

## 2. Crash-reporting

| Point | Statut | Sévérité |
|-------|--------|----------|
| `crashReporter.start()` avant `app.whenReady()`, condition `app.isPackaged` | OK | — |
| `process.on('uncaughtException')` : flag `isCrashing`, blackout, try/catch | OK | — |
| `process.on('unhandledRejection')` : non fatal (ne quitte pas) | OK | — |
| `render-process-gone` : reload/relance safe, `mainWindow` null check | OK | — |
| `unresponsive` + timeout 10s : `forcefullyCrashRenderer` | OK | — |
| `crashLogger.log()` : `appendFileSync` garantit l'écriture | OK | — |
| Rotation des logs (10 fichiers max) | OK | — |
| Path traversal guard sur `readLog` | OK | — |
| Interaction avec le watchdog | OK | — |

**Détails :**

- `crashReporter.start()` est appelé au top-level du module (avant `whenReady`), wrappé dans `if (app.isPackaged)` et `try/catch`. Correct selon la doc Electron qui recommande de démarrer le crashReporter le plus tôt possible.
- `isCrashing` empêche les boucles de re-crash. Le blackout est dans un `try/catch {}`. Le `setTimeout(() => app.quit(), 500)` est en dehors du try/catch mais c'est une fonction safe d'Electron.
- `unhandledRejection` logue et notifie le renderer mais n'appelle pas `app.quit()`. Non fatal. Correct.
- `render-process-gone` : vérifie `!mainWindow || mainWindow.isDestroyed()` avant `createWindow()`, sinon `mainWindow.webContents.reload()`. Le handler est sur `mainWindow.webContents`, donc si la fenêtre est détruite, le handler ne se déclenche pas. Le check défensif est approprié.
- `unresponsive` → log + notify renderer → timeout 10s → `forcefullyCrashRenderer()`. Le timer est cleared sur l'événement `responsive`. 10s est un bon délai. `forcefullyCrashRenderer` va déclencher `render-process-gone` qui gère le reload. Flux cohérent.
- `appendFileSync` : écriture synchrone, garantit que le log est sur disque avant le quit. Correct pour un crash logger.
- Rotation : `readdirSync` + `filter` + `sort` par mtime + `unlinkSync` au-delà de 10 fichiers. Le tout dans `try/catch`. Safe.
- Path traversal : `filepath.startsWith(LOG_DIR)`. Testé sur Windows avec `..`, chemins absoluls, et `path.join` — tous rejetés correctement. Le `path.join` normalise `..` avant le `startsWith`, donc aucun contournement possible.
- Watchdog : le crash reporter appelle `dmxEngine.blackout()` dans `uncaughtException`, ce qui est redondant avec le watchdog mais pas conflictuel. Le watchdog a sa propre logique (heartbeat timeout → blackout + stop). En cas de crash fatal, `app.quit()` intervient avant que le watchdog ne se déclenche. Aucune interférence.

---

## 3. Types + IPC

| Point | Statut | Sévérité |
|-------|--------|----------|
| Types `UpdateStatus` cohérents (main.ts ↔ types.d.ts) | OK | — |
| Types `CrashLogNotification`, `CrashLogEntry` cohérents | OK | — |
| Canaux IPC nommés de façon cohérente | OK | — |
| `CrashLogEntry` dans crash-logger.ts sans champ `type` | OK | — |
| `crashLogger.log(type, entry)` : 1er arg = type séparé | OK | — |

**Détails :**

- `UpdateStatus` est défini à l'identique dans `main.ts` (local) et `types.d.ts` (export). Les 7 états (`idle`, `checking`, `available`, `not-available`, `downloading`, `downloaded`, `error`) sont cohérents.
- `CrashLogNotification` (types.d.ts) : `{ type: string; message: string; timestamp: number }`. Les payloads envoyés par main.ts via `app:crash-log` ont exactement cette forme.
- `CrashLogEntry` (types.d.ts) : `{ filename: string; size: number; mtime: number }`. Correspond au retour de `crashLogger.listLogs()`.
- `CrashLogEntry` (crash-logger.ts) : interface interne pour les données du log (`message`, `stack`, `name`, `exitCode`, `reason`). Pas de champ `type` — c'était le bug corrigé. Le 1er argument de `crashLogger.log()` est `type: string`, séparé de l'entry. Correct.
- **Note** : deux interfaces portent le nom `CrashLogEntry` (une dans crash-logger.ts pour les données, une dans types.d.ts pour la liste de fichiers). Pas de conflit de compilation car elles vivent dans des processus séparés (main vs renderer). C'est une confusion nominale mineure mais pas un bug.

| Canal IPC | main.ts (sender/handler) | preload.ts (bridge) | types.d.ts (contract) |
|-----------|--------------------------|---------------------|----------------------|
| `app:update-status` | `sendUpdateStatus()` → `webContents.send` | `ipcRenderer.on` + cleanup | `onUpdateStatus` |
| `app:install-update` | `ipcMain.handle` | `ipcRenderer.invoke` | `installUpdate` |
| `app:get-update-status` | `ipcMain.handle` | `ipcRenderer.invoke` | `getUpdateStatus` |
| `app:crash-log` | `webContents.send` (3 sites) | `ipcRenderer.on` + cleanup | `onCrashLog` |
| `app:get-crash-logs` | `ipcMain.handle` | `ipcRenderer.invoke` | `getCrashLogs` |
| `app:read-crash-log` | `ipcMain.handle` | `ipcRenderer.invoke` | `readCrashLog` |

Tous les canaux sont cohérents. ✓

---

## 4. UI

| Point | Statut | Sévérité |
|-------|--------|----------|
| `UpdateNotification` gère tous les states (7) | OK | — |
| Cleanup unsubscribe dans `useEffect` | OK | — |
| Import dans `TopBar` au bon endroit | OK | — |
| Clés i18n utilisées existent dans fr.json et en.json | OK | — |

**Détails :**

- `UpdateNotification` gère : `idle` (null), `not-available` (null), `checking` (spinner), `downloading` (percent), `available` (badge amber), `downloaded` (bouton vert install), `error` (bouton rouge dismissable). Tous les states couverts.
- Le `useEffect` d'abonnement retourne `() => { unsubscribe?.() }`. `onUpdateStatus` dans preload.ts retourne bien une fonction de cleanup qui appelle `ipcRenderer.removeListener`. Correct.
- Le `useEffect` initial appelle `getUpdateStatus()` avec `.catch(() => {})` — safe en dev quand l'IPC n'existe pas encore.
- Import : `import { UpdateNotification } from './update-notification'` au top du fichier `TopBar.tsx`. Utilisé dans le JSX `<UpdateNotification />`. Correct.
- Toutes les clés i18n utilisées (`app.update.checking`, `app.update.downloading`, `app.update.error`, `app.update.available`, `app.update.installAndRestart`) existent dans fr.json et en.json. ✓

---

## 5. i18n

| Point | Statut | Sévérité |
|-------|--------|----------|
| Clés `app.update.*` utilisées existent dans les 2 fichiers | OK | — |
| Clés `app.crash.*` — toutes orphelines (pas encore d'UI) | MINEUR | Cosmétique |
| `app.update.downloaded` — orpheline (state `downloaded` utilise `installAndRestart`) | MINEUR | Cosmétique |
| `app.update.upToDate` — orpheline (state `not-available` rend null) | MINEUR | Cosmétique |

**Clés `app.update.*` dans fr.json / en.json :**

| Clé | fr.json | en.json | Utilisée |
|-----|---------|---------|----------|
| `checking` | ✓ | ✓ | ✓ (update-notification.tsx:37) |
| `available` | ✓ | ✓ | ✓ (update-notification.tsx:67) |
| `downloading` | ✓ | ✓ | ✓ (update-notification.tsx:45) |
| `downloaded` | ✓ | ✓ | ✗ |
| `installAndRestart` | ✓ | ✓ | ✓ (update-notification.tsx:79) |
| `error` | ✓ | ✓ | ✓ (update-notification.tsx:58) |
| `upToDate` | ✓ | ✓ | ✗ |

**Clés `app.crash.*` :** 11 clés dans chaque fichier (`title`, `noLogs`, `lastSession`, `seeDetails`, `dismiss`, `liveError`, `rendererGone`, `unresponsive`, `logsDir`, `fileSize`, `noContent`). Aucune n'est utilisée dans le renderer — elles sont préparées pour un futur composant crash-log UI. Ce n'est pas un bug mais du travail en cours.

---

## 6. Sécurité

| Point | Statut | Sévérité |
|-------|--------|----------|
| `crashReporter` avec `uploadToServer: false` | OK | — |
| `submitURL: ''` (vide) | OK | — |
| `readCrashLog` expose seulement LOG_DIR | OK | — |
| `autoUpdater` télécharge depuis GitHub Releases | OK | — |

**Détails :**

- `crashReporter.start({ submitURL: '', uploadToServer: false, compress: true, ignoreSystemCrashHandler: true })`. Aucun upload réseau. Les minidumps sont stockés localement dans `userData/logs/minidumps`. Pas de fuite.
- `readCrashLog(filename)` : `path.join(LOG_DIR, filename)` puis `filepath.startsWith(LOG_DIR)`. Testé avec traversal `..`, chemins absolus, et `path.join` — tous rejetés. Le guard est robuste sur Windows.
- `autoUpdater` utilise la config `publish` de `package.json` (`provider: "github"`, `owner: "vitte"`, `repo: "light-maestro"`). Les updates proviennent uniquement des GitHub Releases de ce repo. Aucune surface d'attaque externe.

---

## Résumé des points mineurs (non bloquants)

1. **`app.update.downloaded` orpheline** — Le state `downloaded` affiche `installAndRestart` au lieu de `downloaded`. La clé "Mise à jour prête" / "Update ready" n'est jamais affichée. *Suggestion* : utiliser `t('app.update.downloaded')` comme tooltip ou texte secondaire dans le bouton du state `downloaded`.

2. **`app.update.upToDate` orpheline** — Le state `not-available` rend `null` (rien ne s'affiche). La clé "À jour" / "Up to date" n'est jamais montrée. *Suggestion* : afficher brièvement un badge "À jour" qui se dismiss après 3s.

3. **Clés `app.crash.*` orphelines (11 clés)** — Préparées pour une future UI de crash logs. Acceptable en l'état.

4. **`isCrashing` jamais reset** — Si l'app survive à un `uncaughtException` (improbable car `app.quit()` est appelé), `isCrashing` reste true. Pas un bug pratique car l'app quitte.

5. **`type` dans la liste d'exclusion de `crashLogger.log()`** — Reliquat du bug corrigé où `type` était dans `CrashLogEntry`. L'interface n'a plus de champ `type`, donc l'exclusion est inutile mais inoffensive.

---

**Conclusion :** Le lot #20 est **LIVRABLE**. Aucune correction requise. Les 5 points mineurs sont cosmétiques ou du mort-code préparatoire, sans impact sur la stabilité, la sécurité ou le fonctionnement.
