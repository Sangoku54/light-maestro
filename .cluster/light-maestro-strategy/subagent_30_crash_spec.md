# Spec : Crash Reporting — Light Maestro (Electron)

**Date** : 2025-08-15  
**Auteur** : Subagent « Spec crash-reporting Electron »  
**Cible** : `electron/main.ts`, `electron/preload.ts`, `electron/utils/crash-logger.ts` (nouveau), `src/types.d.ts`, `src/i18n/fr.json`, `src/i18n/en.json`

---

## 1. CrashReporter Electron (minidumps natifs)

### Principe

Electron embarque `crashReporter` (basé sur Crashpad sur Windows). En Phase 1, on active le crash reporter **sans upload** — les minidumps `.dmp` sont écrits en local dans `app.getPath('userData')/logs/minidumps/`.

### Où l'appeler

**Avant `app.whenReady()`** — Crashpad doit être démarré le plus tôt possible, avant tout crash natif potentiel. Dans `electron/main.ts`, juste après `app.setPath('userData', ...)` :

```typescript
import { crashReporter } from 'electron';

// ─── Crash reporter (native minidumps, local only — Phase 1) ───
const minidumpDir = path.join(app.getPath('userData'), 'logs', 'minidumps');
fs.mkdirSync(minidumpDir, { recursive: true });

crashReporter.start({
  submitURL: '',               // Pas de serveur distant en Phase 1
  uploadToServer: false,       // Privacy : rien ne quitte la machine
  compress: true,              // Minidumps compressés
  crashDir: minidumpDir,       // Override du dossier de dump (Windows)
  ignoreSystemCrashHandler: true, // On gère nous-mêmes
  extra: {
    appName: 'Light Maestro',
    appVersion: app.getVersion(),
    platform: process.platform,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
  },
});
```

### Pièges Windows / Crashpad

- **Crashpad** est l'implémentation par défaut sur Windows. Il crée un sous-dossier `reports/` dans `crashDir` et y écrit les `.dmp`.
- Sans `submitURL` + `uploadToServer: false`, les dumps restent locaux. Aucun réseau.
- `ignoreSystemCrashHandler: true` évite le dialogue Windows "Le programme a cessé de fonctionner" — Electron gère le crash et peut relancer.
- Les minidumps `.dmp` ne sont **pas lisibles sans tooling** (WinDbg, minidump_stackwalk). Pour Phase 1, on se contente de les archiver. L'utilisateur peut les partager pour debug.
- **`crashReporter.start()` doit être appelé avant `app.whenReady()`** — c'est documenté par Electron. Si appelé après, les crashes natifs qui surviennent pendant l'init ne sont pas capturés.

### Activation conditionnelle

Dans l'app packagée uniquement. En dev, les crashes sont déjà visibles dans la console :

```typescript
if (app.isPackaged) {
  crashReporter.start({ /* ... comme ci-dessus ... */ });
}
```

---

## 2. Exceptions JS main process

### `uncaughtException` et `unhandledRejection`

Le main process n'a actuellement **aucune** gestion de ces events. On ajoute deux handlers qui loggent le crash et décident de la suite.

**Politique de relance** : pour une app de scène (DMX live), **on ne relance pas automatiquement** — un crash main process signifie que l'état est corrompu, relancer peut aggraver. On logge, on blackout les sorties, on notifie l'utilisateur, puis on quitte proprement.

```typescript
import { crashLogger } from './utils/crash-logger';

// ─── Main process exception handlers ───
let isCrashing = false;

process.on('uncaughtException', (error: Error) => {
  if (isCrashing) return; // Éviter la boucle de crash
  isCrashing = true;

  crashLogger.log('uncaughtException', {
    message: error.message,
    stack: error.stack || '',
    name: error.name,
  });

  // Safety : blackout les sorties DMX avant de quitter
  try {
    dmxEngine.blackout();
  } catch (e) {
    // Déjà mort, rien à faire
  }

  // Notifier le renderer si possible
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:crash-log', {
      type: 'uncaughtException',
      message: error.message,
      timestamp: Date.now(),
    });
  }

  // Quitter après un court délai (laisser le log s'écrire)
  setTimeout(() => {
    app.quit();
  }, 500);
});

process.on('unhandledRejection', (reason: unknown) => {
  crashLogger.log('unhandledRejection', {
    message: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack || '' : '',
    name: reason instanceof Error ? reason.name : 'Unknown',
  });

  // Ne pas quitter sur unhandledRejection — c'est une promise rejetée,
  // pas un crash fatal. Logger et continuer.
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:crash-log', {
      type: 'unhandledRejection',
      message: reason instanceof Error ? reason.message : String(reason),
      timestamp: Date.now(),
    });
  }
});
```

### Décision : relancer ou quitter ?

| Event | Action | Raison |
|---|---|---|
| `uncaughtException` | **Quitter** (après blackout + log) | État potentiellement corrompu, une app DMX ne doit pas continuer dans un état instable |
| `unhandledRejection` | **Logger + continuer** | Une promise rejetée n'est pas fatale, l'app peut fonctionner |
| Crash natif (segfault) | **Crashpad** écrit le .dmp, l'OS ferme l'app | Pas récupérable en JS |

---

## 3. Crash renderer

### `render-process-gone`

Quand le process de rendu crash (segfault, OOM, etc.), Electron émet `render-process-gone` sur les `webContents`. Le watchdog actuel détecte déjà l'absence de heartbeat et blackout. On ajoute le logging explicite :

```typescript
// Dans createWindow(), après la création de mainWindow :
mainWindow.webContents.on('render-process-gone', (_event, details) => {
  const reason = details.reason; // 'crashed' | 'oom' | 'killed' | etc.
  const exitCode = details.exitCode;

  crashLogger.log('render-process-gone', {
    reason,
    exitCode,
    message: `Renderer process gone: ${reason} (exit code ${exitCode})`,
  });

  // Le watchdog a déjà déclenché le blackout (pas de heartbeat = timeout)
  // On logge juste l'événement pour le diagnostic.

  // Demander à l'utilisateur : relancer ou quitter ?
  if (mainWindow && !mainWindow.isDestroyed()) {
    // La fenêtre est peut-être déjà détruite. Si oui, on recrée.
  }

  // Si la fenêtre est toujours là mais le renderer est mort, on recharge.
  try {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
    } else {
      // Recharger la page — le renderer redémarre
      mainWindow.webContents.reload();
    }
  } catch (e) {
    crashLogger.log('renderer-reload-failed', {
      message: `Failed to reload renderer: ${e instanceof Error ? e.message : String(e)}`,
    });
    app.quit();
  }
});
```

### `unresponsive`

Le renderer peut se figer sans crasher (boucle infinie, deadlock). On logge + timeout :

```typescript
let unresponsiveTimer: NodeJS.Timeout | null = null;
const UNRESPONSIVE_TIMEOUT_MS = 10_000; // 10s avant de considérer comme crash

mainWindow.webContents.on('unresponsive', () => {
  crashLogger.log('renderer-unresponsive', {
    message: 'Renderer became unresponsive',
  });

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:crash-log', {
      type: 'unresponsive',
      message: 'Renderer became unresponsive',
      timestamp: Date.now(),
    });
  }

  // Timeout : si le renderer ne répond toujours pas après 10s, on le kill
  unresponsiveTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      crashLogger.log('renderer-unresponsive-kill', {
        message: 'Renderer killed after 10s unresponsive timeout',
      });
      mainWindow.webContents.forcefullyCrashRenderer();
    }
  }, UNRESPONSIVE_TIMEOUT_MS);
});

mainWindow.webContents.on('responsive', () => {
  if (unresponsiveTimer) {
    clearTimeout(unresponsiveTimer);
    unresponsiveTimer = null;
  }
});
```

---

## 4. Module de logs : `electron/utils/crash-logger.ts`

Nouveau fichier. Écrit les logs dans `app.getPath('userData')/logs/` avec rotation (10 derniers fichiers).

```typescript
// electron/utils/crash-logger.ts
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const LOG_DIR = path.join(app.getPath('userData'), 'logs');
const MAX_LOG_FILES = 10;

export interface CrashLogEntry {
  type: string;
  message: string;
  stack?: string;
  name?: string;
  exitCode?: number;
  reason?: string;
  [key: string]: unknown;
}

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function rotateLogs(): void {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => f.startsWith('crash-') && f.endsWith('.log'))
      .map(f => ({
        name: f,
        path: path.join(LOG_DIR, f),
        mtime: fs.statSync(path.join(LOG_DIR, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.mtime - a.mtime);

    // Supprimer les fichiers au-delà de MAX_LOG_FILES
    for (let i = MAX_LOG_FILES; i < files.length; i++) {
      try { fs.unlinkSync(files[i].path); } catch {}
    }
  } catch {
    // Rotation non critique — ne pas crasher le crash-logger
  }
}

export const crashLogger = {
  log(type: string, entry: CrashLogEntry): void {
    try {
      ensureLogDir();
      rotateLogs();

      const filename = `crash-${getTimestamp()}.log`;
      const filepath = path.join(LOG_DIR, filename);
      const timestamp = new Date().toISOString();

      const lines = [
        `========================================`,
        `Timestamp: ${timestamp}`,
        `Type: ${type}`,
        `Message: ${entry.message}`,
      ];

      if (entry.name) lines.push(`Error Name: ${entry.name}`);
      if (entry.stack) lines.push(`Stack:`, entry.stack);
      if (entry.exitCode !== undefined) lines.push(`Exit Code: ${entry.exitCode}`);
      if (entry.reason) lines.push(`Reason: ${entry.reason}`);

      // Champs supplémentaires
      for (const [key, value] of Object.entries(entry)) {
        if (!['type', 'message', 'stack', 'name', 'exitCode', 'reason'].includes(key)) {
          lines.push(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
        }
      }

      lines.push(`========================================`, '');

      fs.appendFileSync(filepath, lines.join('\n'), 'utf-8');
    } catch {
      // Le crash-logger ne doit jamais crasher l'app.
      // Si l'écriture échoue, on est silencieusement ignoré.
    }
  },

  listLogs(): Array<{ filename: string; size: number; mtime: number }> {
    try {
      ensureLogDir();
      return fs.readdirSync(LOG_DIR)
        .filter(f => f.startsWith('crash-') && f.endsWith('.log'))
        .map(f => {
          const stat = fs.statSync(path.join(LOG_DIR, f));
          return { filename: f, size: stat.size, mtime: stat.mtime.getTime() };
        })
        .sort((a, b) => b.mtime - a.mtime);
    } catch {
      return [];
    }
  },

  readLog(filename: string): string | null {
    try {
      const filepath = path.join(LOG_DIR, filename);
      if (!filepath.startsWith(LOG_DIR)) return null; // Path traversal guard
      return fs.readFileSync(filepath, 'utf-8');
    } catch {
      return null;
    }
  },

  getLogDir(): string {
    return LOG_DIR;
  },
};
```

### Design notes

- **`fs.appendFileSync`** (pas async) : en cas de crash, on veut que le log soit écrit **avant** que le process ne meure. Synchrone = garantie d'écriture.
- **Rotation simple** : on garde les 10 derniers fichiers `crash-*.log`. Au-delà, on supprime les plus anciens.
- **Path traversal guard** sur `readLog` : empêche un renderer compromis de lire des fichiers arbitraires.
- **Le crash-logger ne lève jamais** : tous les appels sont wrappés dans `try/catch` silencieux. Un crash-logger qui crash rend le debugging impossible.

---

## 5. IPC

### Canaux

| Canal | Direction | Usage |
|---|---|---|
| `app:crash-log` | Main → Renderer (push) | Notifie le renderer d'une erreur non fatale (unhandledRejection, unresponsive) |
| `app:get-crash-logs` | Renderer → Main (invoke) | Retourne la liste des fichiers log |
| `app:read-crash-log` | Renderer → Main (invoke) | Retourne le contenu d'un fichier log |

### `electron/main.ts` — Handlers

```typescript
import { crashLogger } from './utils/crash-logger';

// ─── IPC: Crash logs ───
ipcMain.handle('app:get-crash-logs', async () => {
  return crashLogger.listLogs();
});

ipcMain.handle('app:read-crash-log', async (_event, filename: string) => {
  return crashLogger.readLog(filename);
});
```

### `electron/preload.ts` — Exposition

Ajouter dans l'objet `app` existant :

```typescript
app: {
  onBeforeClose: (callback: () => void) => { /* ... existant ... */ },
  closeAction: (action: 'save-and-quit' | 'discard') => { /* ... existant ... */ },

  // ─── Crash reporting ───
  onCrashLog: (callback: (data: { type: string; message: string; timestamp: number }) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('app:crash-log', handler);
    return () => { ipcRenderer.removeListener('app:crash-log', handler); };
  },
  getCrashLogs: () => ipcRenderer.invoke('app:get-crash-logs'),
  readCrashLog: (filename: string) => ipcRenderer.invoke('app:read-crash-log', filename),
},
```

### `src/types.d.ts` — Types

Ajouter dans l'interface `LightMaestroAPI`, section `app` :

```typescript
app: {
  onBeforeClose: (callback: () => void) => () => void;
  closeAction: (action: 'save-and-quit' | 'discard') => Promise<void>;

  // ─── Crash reporting ───
  /** Push main→renderer : une erreur non fatale a été capturée. */
  onCrashLog: (callback: (data: CrashLogNotification) => void) => () => void;
  /** Liste les fichiers de crash log disponibles. */
  getCrashLogs: () => Promise<CrashLogEntry[]>;
  /** Lit le contenu d'un fichier de crash log. */
  readCrashLog: (filename: string) => Promise<string | null>;
};
```

Nouveaux types à ajouter en haut du fichier :

```typescript
/** Notification push main→renderer pour une erreur non fatale. */
export interface CrashLogNotification {
  type: string;        // 'unhandledRejection' | 'unresponsive' | etc.
  message: string;
  timestamp: number;   // Date.now()
}

/** Entrée dans la liste des crash logs. */
export interface CrashLogEntry {
  filename: string;    // "crash-2025-08-15-084201.log"
  size: number;        // bytes
  mtime: number;       // timestamp ms
}
```

---

## 6. UI

### Principe : discret, pas intrusif

L'app est utilisée en live. Un dialog modal au milieu d'un concert = catastrophe. On opte pour :

1. **Au démarrage** : si un crash log existe dans les dernières 24h, afficher un **toast discret** en bas à droite (non-bloquant) : « ⚠ Un crash a été détecté lors de la dernière session. [Voir détails] [Ignorer] ».
2. **Dans les Settings** (onglet Configuration → Settings) : une section « Crash Logs » avec la liste des 10 derniers fichiers, possibilité de les ouvrir/consulter.

### Snippet — Toast au démarrage

À ajouter dans `src/app.tsx` (ou un hook dédié), après l'init :

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

function useCrashCheck() {
  const { t } = useTranslation();
  const [crashNotification, setCrashNotification] = useState<CrashLogEntry | null>(null);

  useEffect(() => {
    // Vérifier au démarrage si un crash récent existe
    window.lightMaestro.app.getCrashLogs().then(logs => {
      if (!logs || logs.length === 0) return;
      const lastLog = logs[0]; // Trié par mtime desc
      const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
      if (lastLog.mtime > twentyFourHoursAgo) {
        setCrashNotification(lastLog);
      }
    }).catch(() => { /* silencieux */ });

    // Écouter les crashes en temps réel
    const unsubscribe = window.lightMaestro.app.onCrashLog((data) => {
      console.warn('[crash-report]', data.type, data.message);
    });
    return () => { unsubscribe(); };
  }, []);

  return crashNotification;
}
```

### Snippet — Panneau Settings

Dans la vue Settings de l'onglet Configuration (`src/views/designview.tsx` ou un composant dédié) :

```tsx
function CrashLogsPanel() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<CrashLogEntry[]>([]);
  const [selectedLog, setSelectedLog] = useState<string | null>(null);
  const [logContent, setLogContent] = useState<string | null>(null);

  useEffect(() => {
    window.lightMaestro.app.getCrashLogs().then(setLogs).catch(() => {});
  }, []);

  const handleRead = async (filename: string) => {
    const content = await window.lightMaestro.app.readCrashLog(filename);
    setSelectedLog(filename);
    setLogContent(content);
  };

  if (logs.length === 0) {
    return <p className="text-zinc-500 text-sm">{t('app.crash.noLogs')}</p>;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-zinc-300">{t('app.crash.title')}</h3>
      <div className="space-y-1">
        {logs.map(log => (
          <button
            key={log.filename}
            onClick={() => handleRead(log.filename)}
            className="block w-full text-left text-xs text-zinc-400 hover:text-zinc-200 p-2 rounded hover:bg-zinc-800"
          >
            {log.filename} — {(log.size / 1024).toFixed(1)} KB
          </button>
        ))}
      </div>
      {logContent && (
        <pre className="text-xs text-zinc-400 bg-zinc-900 p-3 rounded max-h-64 overflow-auto">
          {logContent}
        </pre>
      )}
    </div>
  );
}
```

---

## 7. i18n

### `src/i18n/fr.json` — Ajouter dans la racine :

```json
{
  "app": {
    "crash": {
      "title": "Crash Logs",
      "noLogs": "Aucun crash enregistré",
      "lastSession": "Un crash a été détecté lors de la dernière session.",
      "seeDetails": "Voir les détails",
      "dismiss": "Ignorer",
      "liveError": "Une erreur non fatale s'est produite",
      "rendererGone": "Le processus de rendu a crashé. Relance en cours…",
      "unresponsive": "L'interface ne répond plus",
      "logsDir": "Dossier des logs",
      "fileSize": "{size} KB",
      "noContent": "Contenu vide ou illisible"
    }
  }
}
```

### `src/i18n/en.json` — Ajouter dans la racine :

```json
{
  "app": {
    "crash": {
      "title": "Crash Logs",
      "noLogs": "No crashes recorded",
      "lastSession": "A crash was detected during the last session.",
      "seeDetails": "View details",
      "dismiss": "Dismiss",
      "liveError": "A non-fatal error occurred",
      "rendererGone": "Renderer process crashed. Reloading…",
      "unresponsive": "Interface became unresponsive",
      "logsDir": "Logs directory",
      "fileSize": "{size} KB",
      "noContent": "Empty or unreadable content"
    }
  }
}
```

---

## 8. Interaction avec le watchdog

### État actuel du watchdog

Le watchdog (`electron/main.ts`, lignes ~190-230) fonctionne ainsi :

1. Le renderer ping `watchdog:ping` toutes les 500 ms.
2. Si aucun ping pendant 2000 ms → `watchdogFired = true`, `watchdogArmed = false`, `dmxEngine.blackout()`, `dmxEngine.stop()`.
3. Le renderer est présumé mort. Le watchdog se réarme au prochain ping.

### Comment le crash-reporter interagit

| Scénario | Watchdog | Crash Reporter | Résultat |
|---|---|---|---|
| **Renderer crash (segfault)** | Timeout heartbeat → blackout | `render-process-gone` → log + reload | Watchdog blackout **en premier** (< 2s), crash logger écrit le rapport, reload du renderer |
| **Renderer hang (boucle infinie)** | Timeout heartbeat → blackout | `unresponsive` → log, après 10s `forcefullyCrashRenderer` → `render-process-gone` | Watchdog blackout, crash logger trace l'unresponsive, force-kill après 10s, reload |
| **Main process crash (uncaughtException)** | N/A (le main meurt) | `uncaughtException` handler → log + blackout + quit | L'app quitte. Au prochain démarrage, le toast « dernier crash » s'affiche |
| **DMX worker crash** | `workerLost = true` → blackout | `dmxEngine.on('error')` existe déjà → forward au renderer | Le watchdog gère déjà ce cas. Le crash logger peut capturer l'erreur dans `unhandledRejection` si la promise n'est pas catchée |

### Règle d'or : **le crash reporter ne casse jamais le watchdog**

- Le crash reporter **ne touche pas** à `watchdogArmed`, `watchdogFired`, `watchdogLastPing`.
- Le crash reporter **ne appelle pas** `dmxEngine.blackout()` pour le renderer crash — c'est le job du watchdog. Le crash reporter ne blackout que pour `uncaughtException` main process (où le watchdog n'est pas concerné).
- Si `render-process-gone` se déclenche, le watchdog a **déjà** fait son blackout (le heartbeat est mort avant que le crash ne soit détecté). Le crash reporter se contente de logger et relancer.

### Diagramme de séquence — Renderer crash

```
T=0     Renderer crash (segfault)
T=0     Heartbeat stops
T+2s    Watchdog: watchdogFired = true → blackout + stop engine
T+2s    Electron: render-process-gone event
T+2s    Crash logger: écrit "render-process-gone" dans crash-*.log
T+2s    createWindow() ou webContents.reload()
T+3s    Renderer redémarre, heartbeat reprend
T+3s    Watchdog: watchdogFired = false, watchdogArmed = true (re-armé)
```

---

## 9. Pièges et précautions

### 9.1 CrashReporter sur Windows

- **Crashpad** (le handler par défaut sur Windows) crée un dossier `reports/` à l'intérieur de `crashDir`. Les fichiers `.dmp` ne sont pas lisibles sans WinDbg ou `minidump_stackwalk`.
- **`crashReporter.start()` doit être appelé avant `app.whenReady()`**. C'est non-négociable. Dans le code actuel, on l'insère juste après `app.setPath('userData', ...)` et avant `app.whenReady().then(...)`.
- **Pas d'upload en Phase 1** : `uploadToServer: false` + `submitURL: ''`. Privacy totale. L'utilisateur peut manually partager le `.dmp` si besoin.
- **`ignoreSystemCrashHandler: true`** : évite le dialogue Windows "Rechercher une solution en ligne". L'app gère son propre crash.

### 9.2 `uncaughtException` et continuation

- Après `uncaughtException`, l'état de l'app est **indéfini**. Les timers, les connexions série, les handles MIDI — tout peut être dans un état incohérent.
- **On ne continue pas** : on blackout, on log, on quitte. C'est la décision la plus sûre pour une app de scène.
- Si on voulait relancer automatiquement, on utiliserait `app.relaunch()` + `app.quit()`. Pas recommandé en Phase 1 — l'utilisateur doit savoir que ça a crashé.

### 9.3 `unhandledRejection` et fausses alertes

- Certaines libraries (serialport, midi) rejettent des promises de façon non fatale (ex: port série déconnecté). On **ne quitte pas** sur `unhandledRejection`.
- On logge quand même — c'est utile pour le diagnostic. Si une promise rejetée est récurrente, elle apparaîtra dans les logs.

### 9.4 `render-process-gone` et fenêtre détruite

- Quand le renderer crash, `mainWindow` peut être `null` ou détruit. Le code doit vérifier `mainWindow && !mainWindow.isDestroyed()` avant d'envoyer un IPC.
- `mainWindow.webContents.reload()` peut échouer si le webContents est dans un état irrécupérable. On wrap dans un `try/catch` et on `createWindow()` en fallback.

### 9.5 Le crash-logger ne doit jamais crasher

- Tous les appels du crash-logger sont wrappés dans `try/catch` silencieux. Si le filesystem est en lecture seule, plein, ou que le chemin n'existe pas, le crash-logger échoue silencieusement. Un crash-logger qui crash rend le debugging impossible.

### 9.6 Minidumps et ASAR

- Les minidumps sont écrits dans `app.getPath('userData')`, **pas** dans le dossier de l'app. Pas de conflit avec ASAR.
- En dev, `crashReporter` n'est pas activé (condition `app.isPackaged`). Les crashes en dev sont visibles dans la console et le terminal.

### 9.7 Taille des logs

- Chaque crash log fait ~1-5 KB (stack trace + metadata). 10 fichiers max = ~50 KB. Négligeable.
- Les minidumps `.dmp` peuvent faire 100 KB - 1 MB chacun. Crashpad gère sa propre rotation (généralement 32 fichiers max). Pas besoin de rotation manuelle pour les minidumps en Phase 1.

### 9.8 Concurrence : `appendFileSync` et crash simultané

- Si deux crashes se produisent dans la même seconde, ils écrivent dans le **même fichier** (même timestamp). `appendFileSync` est atomique pour les petites écritures sur Windows (NTFS). C'est acceptable — les entrées seront concaténées, séparées par les lignes `===`.

---

## 10. Récapitulatif des modifications

| Fichier | Action | Description |
|---|---|---|
| `electron/utils/crash-logger.ts` | **Créer** | Nouveau module : écriture logs, rotation, lecture |
| `electron/main.ts` | **Modifier** | Ajouter `crashReporter.start()`, `process.on('uncaughtException')`, `process.on('unhandledRejection')`, `webContents.on('render-process-gone')`, `webContents.on('unresponsive')`, IPC handlers `app:get-crash-logs` + `app:read-crash-log` |
| `electron/preload.ts` | **Modifier** | Ajouter `onCrashLog`, `getCrashLogs`, `readCrashLog` dans `app` |
| `src/types.d.ts` | **Modifier** | Ajouter `CrashLogNotification`, `CrashLogEntry`, étendre `app` dans `LightMaestroAPI` |
| `src/i18n/fr.json` | **Modifier** | Ajouter `app.crash.*` |
| `src/i18n/en.json` | **Modifier** | Ajouter `app.crash.*` |
| `src/app.tsx` (ou hook) | **Modifier** | Ajouter `useCrashCheck()` — toast au démarrage + écoute live |
| Vue Settings | **Modifier** | Ajouter `CrashLogsPanel` dans l'onglet Settings |

### Ordre d'implémentation recommandé

1. `electron/utils/crash-logger.ts` — module autonome, testable indépendamment
2. `electron/main.ts` — crashReporter + exception handlers + IPC
3. `electron/preload.ts` — exposition IPC
4. `src/types.d.ts` — types TypeScript
5. `src/i18n/fr.json` + `src/i18n/en.json` — clés i18n
6. UI — toast + panneau Settings (peut être fait en dernier, non bloquant)

---

## 11. Test

### Test manuel : uncaughtException

```typescript
// Dans la console DevTools du main process (ou un bouton de debug) :
setTimeout(() => {
  throw new Error('Test crash: uncaughtException');
}, 5000);
```

Vérifier :
- Un fichier `crash-YYYY-MM-DD-HHMMSS.log` est créé dans `%APPDATA%/light-maestro/logs/`
- Le fichier contient le stack trace
- L'app blackout les sorties et quitte

### Test manuel : unhandledRejection

```typescript
Promise.reject(new Error('Test: unhandledRejection'));
```

Vérifier :
- Un fichier log est créé
- L'app **ne quitte pas**
- Le renderer reçoit `app:crash-log`

### Test manuel : renderer crash

Dans la console DevTools du renderer :
```javascript
process.crash(); // Crash natif du renderer
```

Vérifier :
- Le watchdog déclenche le blackout (< 2s)
- Un fichier log `render-process-gone` est écrit
- Le renderer redémarre (reload)

### Test manuel : crash natif (minidump)

```typescript
// Dans le main process :
process.crash();
```

Vérifier :
- Un fichier `.dmp` est créé dans `%APPDATA%/light-maestro/logs/minidumps/reports/`
- L'app quitte (crash natif non récupérable)
- Au prochain démarrage, le toast s'affiche
