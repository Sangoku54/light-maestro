# Spec : Auto-Update Electron (light-maestro)

**Date :** 2025-08-15  
**Auteur :** Subagent #29 — Spec auto-update Electron  
**Statut :** Spec d'implémentation (lecture seule, aucune modification du repo)

---

## 1. Dépendances

### 1.1. Package à installer

```
npm install electron-updater
```

**Version recommandée :** `^6.3.9` (dernière stable à date, compatible Electron 28+).

### 1.2. Où l'ajouter

`electron-updater` doit aller dans **`dependencies`** (pas `devDependencies`), car le code de l'app packagée l'importe au runtime. Si il est en `devDependencies`, il ne sera pas inclus dans l'ASAR et l'app plantera en production.

```jsonc
// package.json > dependencies
{
  "dependencies": {
    // ... existant ...
    "electron-updater": "^6.3.9"
  }
}
```

### 1.3. electron-builder

`electron-builder` est déjà en `devDependencies` (`^24.0.0`) — c'est correct, c'est un tool de build.

---

## 2. Config electron-builder : champ `publish`

### 2.1. Pourquoi `provider: github`

`electron-updater` lit un fichier `app-update.yml` généré par electron-builder au moment du packaging. Ce fichier contient la configuration `publish`. Sans champ `publish`, electron-builder ne génère pas de `app-update.yml`, et `electron-updater` ne peut pas fonctionner en production.

GitHub Releases est le provider le plus standard et le mieux supporté par electron-updater. C'est le choix recommandé pour Phase 1.

### 2.2. Config JSON exacte à ajouter dans `package.json > build`

Ajouter le bloc `publish` dans la section `build` existante :

```jsonc
// package.json > build
{
  "build": {
    "appId": "com.lightmaestro.app",
    "productName": "Light Maestro",
    // ... existant ...
    
    "publish": {
      "provider": "github",
      "owner": "vitte",           // ← remplacer par le owner GitHub réel
      "repo": "light-maestro",     // ← remplacer par le repo GitHub réel
      "releaseType": "release"     // release (pas draft/prerelease)
    }
    
    // ... reste de la config existante (win, nsis, mac, linux) ...
  }
}
```

**Notes :**
- `owner` et `repo` doivent correspondre au repo GitHub où les releases seront publiées.
- `releaseType: "release"` → electron-updater ne téléchargera que les releases publiées (pas les drafts).
- Pour publier un release depuis le CI/local : `npm run dist` + `electron-builder --publish always` (nécessite `GH_TOKEN` env var).

### 2.3. Token GitHub pour publier

Pour que electron-builder puisse uploader les artefacts sur GitHub Releases :

```bash
# Variable d'environnement requise pour publier
export GH_TOKEN=ghp_votre_token_github
```

En local, créer un Personal Access Token avec la permission `repo` (ou `contents:write` + `actions:write` pour fine-grained).

---

## 3. Code main.ts

### 3.1. Import

Ajouter en haut de `electron/main.ts`, après les imports existants :

```typescript
import { autoUpdater } from 'electron-updater';
```

### 3.2. Configuration de base

Ajouter après les déclarations globales existantes (vers la ligne 15, après `app.setPath(...)`), une fonction dédiée qui sera appelée après `app.whenReady()` :

```typescript
// ─── Auto-Updater ─────────────────────────────────────────────
type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes?: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

let currentUpdateStatus: UpdateStatus = { state: 'idle' };

function sendUpdateStatus(status: UpdateStatus): void {
  currentUpdateStatus = status;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app:update-status', status);
  }
}

function setupAutoUpdater(): void {
  const isDev = !app.isPackaged;

  // En dev, electron-updater ne peut pas fonctionner normalement
  // (pas de app-update.yml, pas de version dans le package packagé).
  // On log et on skip — l'auto-update n'a de sens qu'en production.
  if (isDev) {
    console.log('[autoUpdater] Dev mode — auto-update disabled');
    return;
  }

  // Configuration
  autoUpdater.autoDownload = true;   // Téléchargement automatique en arrière-plan
  autoUpdater.autoInstallOnAppQuit = true; // Installe au prochain quit (si l'user ne clique pas le bouton)

  // ─── Events ───────────────────────────────────────────────
  autoUpdater.on('checking-for-update', () => {
    console.log('[autoUpdater] Checking for update...');
    sendUpdateStatus({ state: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`[autoUpdater] Update available: v${info.version}`);
    sendUpdateStatus({
      state: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[autoUpdater] Up to date');
    sendUpdateStatus({ state: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus({
      state: 'downloading',
      percent: Math.round(progress.percent),
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[autoUpdater] Update downloaded: v${info.version}`);
    sendUpdateStatus({ state: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    console.error('[autoUpdater] Error:', err?.message || err);
    sendUpdateStatus({ state: 'error', message: err?.message || String(err) });
  });

  // Lancer la vérification au démarrage
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[autoUpdater] checkForUpdatesAndNotify failed:', err?.message || err);
  });
}
```

### 3.3. Appel au démarrage

Dans le bloc `app.whenReady().then(async () => { ... })` existant, ajouter l'appel **après** `createWindow()` :

```typescript
app.whenReady().then(async () => {
  createWindow();
  createTray();

  // ─── Auto-updater (après la fenêtre pour que les IPC arrivent au renderer) ───
  setupAutoUpdater();

  try {
    await fixtureLibrary.load();
  } catch (err) {
    console.error('Failed to load fixture library:', err);
  }

  // ... reste existant (fixture update check) ...
}).catch((err) => {
  console.error('App startup failed:', err);
});
```

### 3.4. IPC handler : installation manuelle

Ajouter avec les autres IPC handlers (avant `app.whenReady()`) :

```typescript
// ─── IPC: Auto-Update ───────────────────────────────────────
// Le renderer demande l'installation de la mise à jour téléchargée.
// quitAndInstall() ferme l'app, installe, et relance automatiquement.
ipcMain.handle('app:install-update', async () => {
  if (currentUpdateStatus.state === 'downloaded') {
    // Préserver le flux de fermeture existant (save & quit)
    // avant d'installer la mise à jour.
    isQuitting = true;
    autoUpdater.quitAndInstall();
    return true;
  }
  return false;
});

// Le renderer peut demander le statut courant (utile au montage du composant)
ipcMain.handle('app:get-update-status', async () => {
  return currentUpdateStatus;
});
```

### 3.5. Interaction avec le close guard existant

**Point d'attention :** L'app a un close guard (`mainWindow.on('close')` qui fait `e.preventDefault()` puis envoie `app:before-close` au renderer). Quand `quitAndInstall()` est appelé, il déclenche `app.quit()` qui ferme toutes les fenêtres. Le close guard va intercepter ce close.

**Solution :** Le flag `isQuitting = true` est déjà posé avant `quitAndInstall()` (cf. snippet 3.4). Le close guard vérifie `if (isQuitting) return;` → il laisse passer. C'est cohérent avec le pattern existant de `app:close-action`.

Cependant, `quitAndInstall()` peut être rapide. Pour garantir que le renderer ait le temps de faire son autosave avant l'installation, on peut ajouter un petit délai :

```typescript
// Version alternative avec délai pour laisser l'autosave terminer
ipcMain.handle('app:install-update', async () => {
  if (currentUpdateStatus.state === 'downloaded') {
    isQuitting = true;
    // Laisser 500ms au renderer pour finaliser l'autosave en cours
    setTimeout(() => {
      autoUpdater.quitAndInstall();
    }, 500);
    return true;
  }
  return false;
});
```

---

## 4. Preload + types

### 4.1. preload.ts — exposition via contextBridge

Ajouter dans l'objet `app` existant de `contextBridge.exposeInMainWorld('lightMaestro', { ... })` :

```typescript
// Dans electron/preload.ts, étendre l'objet app: existant
app: {
  onBeforeClose: (callback: () => void) => {
    ipcRenderer.on('app:before-close', () => callback());
    return () => { ipcRenderer.removeAllListeners('app:before-close'); };
  },
  closeAction: (action: 'save-and-quit' | 'discard') =>
    ipcRenderer.invoke('app:close-action', action),

  // ─── Auto-Update ─────────────────────────────────────────
  /** Push du statut update depuis le main process vers le renderer. */
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => {
    const handler = (_: any, status: UpdateStatus) => callback(status);
    ipcRenderer.on('app:update-status', handler);
    return () => { ipcRenderer.removeListener('app:update-status', handler); };
  },
  /** Demander l'installation de la mise à jour téléchargée. */
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  /** Récupérer le statut update courant (au montage du composant). */
  getUpdateStatus: () => ipcRenderer.invoke('app:get-update-status'),
},
```

### 4.2. types.d.ts — signatures TypeScript

Ajouter le type `UpdateStatus` et étendre l'interface `LightMaestroAPI` :

```typescript
// ─── Auto-Update ─────────────────────────────────────────────
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string; releaseNotes?: string }
  | { state: 'not-available' }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };
```

Et dans l'interface `LightMaestroAPI`, étendre la section `app:` :

```typescript
interface LightMaestroAPI {
  // ... existant ...

  app: {
    onBeforeClose: (callback: () => void) => () => void;
    closeAction: (action: 'save-and-quit' | 'discard') => Promise<void>;

    /** Push du statut de mise à jour depuis le main process. */
    onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
    /** Installer la mise à jour téléchargée (quit + install + restart). */
    installUpdate: () => Promise<boolean>;
    /** Récupérer le statut de mise à jour courant. */
    getUpdateStatus: () => Promise<UpdateStatus>;
  };

  // ... reste existant ...
}
```

---

## 5. UI : composant UpdateNotification

### 5.1. Placement recommandé

Dans la `TopBar` (cf. `src/components/layout/topbar.tsx`), à gauche du `FixtureUpdateBadge` existant. C'est l'endroit le plus naturel : la TopBar est toujours visible (tous les modes), et il y a déjà un pattern de badge/notification avec le fixture update. Pas de surcharge visuelle : le badge ne s'affiche que quand il y a quelque chose à montrer.

### 5.2. Composant React

Créer `src/components/layout/update-notification.tsx` :

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { DownloadCloud, RefreshCw, AlertCircle, CheckCircle, Loader } from 'lucide-react';
import type { UpdateStatus } from '../../../types';

export const UpdateNotification: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  // Récupérer le statut initial au montage
  useEffect(() => {
    window.lightMaestro.app?.getUpdateStatus?.().then((s) => {
      if (s) setStatus(s);
    });
  }, []);

  // Écouter les push de statut
  useEffect(() => {
    const unsubscribe = window.lightMaestro.app?.onUpdateStatus?.((s) => {
      setStatus(s);
      // Reset dismissed quand un nouveau cycle commence
      if (s.state === 'checking' || s.state === 'available') {
        setDismissed(false);
      }
    });
    return () => { unsubscribe?.(); };
  }, []);

  const handleInstall = useCallback(() => {
    window.lightMaestro.app?.installUpdate?.();
  }, []);

  // Ne rien afficher si rien à montrer
  if (dismissed) return null;
  if (status.state === 'idle' || status.state === 'not-available') return null;

  // ─── Downloading : petit badge non-interactif ───────────
  if (status.state === 'checking') {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-gray-800/30 text-gray-500 no-drag">
        <Loader size={12} className="animate-spin" />
        <span className="hidden md:inline">{t('app.update.checking')}</span>
      </div>
    );
  }

  if (status.state === 'downloading') {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-blue-900/20 text-blue-400 no-drag">
        <DownloadCloud size={12} className="animate-pulse" />
        <span className="hidden md:inline">{t('app.update.downloading', { percent: status.percent })}</span>
      </div>
    );
  }

  // ─── Error : badge rouge, dismissible ───────────────────
  if (status.state === 'error') {
    return (
      <button
        onClick={() => setDismissed(true)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-red-900/20 text-red-400 hover:bg-red-800/30 no-drag transition-colors"
        title={status.message}
      >
        <AlertCircle size={12} />
        <span className="hidden md:inline">{t('app.update.error')}</span>
      </button>
    );
  }

  // ─── Available : badge "mise à jour disponible" ────────
  if (status.state === 'available') {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-amber-900/20 text-amber-400 no-drag">
        <DownloadCloud size={12} />
        <span className="hidden md:inline">{t('app.update.available', { version: status.version })}</span>
      </div>
    );
  }

  // ─── Downloaded : bouton "Installer et redémarrer" ────
  if (status.state === 'downloaded') {
    return (
      <button
        onClick={handleInstall}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-700/40 text-emerald-300 hover:bg-emerald-600/50 no-drag transition-all animate-pulse"
      >
        <RefreshCw size={12} />
        <span className="hidden sm:inline">{t('app.update.installAndRestart')}</span>
      </button>
    );
  }

  return null;
};
```

### 5.3. Intégration dans TopBar

Dans `src/components/layout/topbar.tsx`, ajouter le composant juste avant le `FixtureUpdateBadge` :

```tsx
// Ajouter l'import en haut du fichier
import { UpdateNotification } from './update-notification';

// Dans le JSX du header, avant <FixtureUpdateBadge />
{/* Auto-update notification */}
<UpdateNotification />

{/* Fixture update status — existant */}
<FixtureUpdateBadge />
```

---

## 6. i18n

### 6.1. Clés à ajouter dans `src/i18n/fr.json`

Ajouter dans la section `app` existante (après `"version": "Light Maestro v1.0"`) :

```jsonc
{
  "app": {
    "title": "Light Maestro",
    "version": "Light Maestro v1.0",
    "update": {
      "checking": "Recherche de mises à jour…",
      "available": "Mise à jour v{{version}} disponible",
      "downloading": "Téléchargement… {{percent}}%",
      "downloaded": "Mise à jour prête",
      "installAndRestart": "Installer et redémarrer",
      "error": "Échec de la mise à jour",
      "upToDate": "À jour"
    }
  }
}
```

### 6.2. Clés à ajouter dans `src/i18n/en.json`

```jsonc
{
  "app": {
    "title": "Light Maestro",
    "version": "Light Maestro v1.0",
    "update": {
      "checking": "Checking for updates…",
      "available": "Update v{{version}} available",
      "downloading": "Downloading… {{percent}}%",
      "downloaded": "Update ready",
      "installAndRestart": "Install and restart",
      "error": "Update failed",
      "upToDate": "Up to date"
    }
  }
}
```

---

## 7. Pièges et points d'attention

### 7.1. electron-updater ne fonctionne pas en dev

**Problème :** En mode dev (`!app.isPackaged`), electron-updater ne peut pas fonctionner car :
- Il n'y a pas de fichier `app-update.yml` (généré par electron-builder au packaging).
- La version lue par electron-updater vient du `package.json` mais le mécanisme de check nécessite une app packagée.

**Solution :** Le code de la spec (section 3.2) fait un `if (isDev) { return; }` qui skip proprement en dev. C'est l'approche recommandée par la documentation electron-updater.

**Alternative pour tester en dev :** Utiliser `forceDevUpdateConfig` :

```typescript
// Optionnel : pour tester le flow en dev
// Nécessite un fichier dev-app-update.yml à la racine du projet
if (isDev) {
  autoUpdater.forceDevUpdateConfig = true;
  // Créer un fichier dev-app-update.yml à la racine :
  // owner: vitte
  // repo: light-maestro
  // provider: github
}
```

Créer le fichier `dev-app-update.yml` à la racine du projet :

```yaml
provider: github
owner: vitte
repo: light-maestro
```

⚠️ **Ce fichier ne doit pas être commité** (ou alors avec un `.gitignore` adapté). Il sert uniquement au dev local.

### 7.2. autoUpdater doit être après `app.whenReady()`

`electron-updater` initialise des listeners et accède à `app.getVersion()`. Si appelé avant `app.whenReady()`, cela peut crasher ou retourner des valeurs erronées. La spec place `setupAutoUpdater()` **après** `createWindow()` dans le bloc `whenReady()` — c'est correct.

### 7.3. Code signing

| Plateforme | Code signing requis pour auto-update ? |
|---|---|
| **macOS** | ✅ Oui. Sans code signing, macOS bloque le téléchargement et l'installation. electron-updater vérifie la signature. |
| **Windows (NSIS)** | ❌ Non obligatoire. NSIS installe sans signature, mais l'utilisateur aura un SmartScreen warning. electron-updater fonctionne sans signature. |
| **Linux (AppImage)** | ❌ Non requis. |

Pour Phase 1 (Windows only), le code signing n'est **pas bloquant**. Pour la Phase 3 (distribution publique macOS), il faudra un Apple Developer ID ($99/an).

### 7.4. `publish` obligatoire

Sans champ `publish` dans la config electron-builder, **aucun fichier `app-update.yml` n'est généré**. electron-updater ne trouvera pas de source de mise à jour et échouera silencieusement (ou avec une erreur `Cannot read property 'provider' of undefined`).

La section 2.2 couvre ce point. C'est la cause #1 des auto-updates qui "ne marchent pas".

### 7.5. Versioning

electron-updater compare `app.getVersion()` (lu depuis `package.json > version`) avec la version du release GitHub. Pour qu'une mise à jour soit détectée :
- La version du release GitHub doit être **strictement supérieure** à la version locale.
- Les versions doivent suivre SemVer (`1.0.0`, `1.0.1`, `1.1.0`, etc.).
- Le tag du release GitHub doit être `v1.0.1` (avec le préfixe `v`).

### 7.6. Interaction avec le close guard

L'app a un close guard qui intercepte `mainWindow.on('close')` avec `e.preventDefault()`. Quand `autoUpdater.quitAndInstall()` appelle `app.quit()`, cela déclenche `window-all-closed` puis `before-quit`. Le close guard du renderer est contourné par le flag `isQuitting = true` (cf. section 3.5).

**Cependant**, `autoUpdater.autoInstallOnAppQuit = true` installe aussi au quit normal. Si l'utilisateur ferme l'app normalement après qu'une mise à jour a été téléchargée, l'installation se fera automatiquement. C'est le comportement souhaité.

### 7.7. GitHub Releases : format des artefacts

electron-builder publie sur GitHub Releases les fichiers suivants :
- `Light Maestro Setup 1.0.1.exe` (installer NSIS)
- `Light Maestro Setup 1.0.1.exe.blockmap` (pour les delta updates)
- `latest.yml` (metadata pour electron-updater)

**Ne pas supprimer `latest.yml` du release** — electron-updater le lit pour connaître la dernière version disponible.

### 7.8. Rate limiting GitHub

GitHub API a un rate limit de 60 req/h non authentifié. electron-updater fait 1 requête par check. En utilisation normale (1 check au démarrage), pas de souci. Si l'utilisateur redémarre l'app fréquemment, cela peut poser problème.

**Solution (Phase 3) :** Définir `GH_TOKEN` côté app (env var) pour passer à 5000 req/h. En Phase 1, pas nécessaire.

---

## 8. Résumé — Checklist d'implémentation

| # | Tâche | Fichier(s) | Estimé |
|---|---|---|---|
| 1 | `npm install electron-updater` | `package.json` | 1 min |
| 2 | Ajouter `publish` dans `build` | `package.json` | 2 min |
| 3 | Import + `setupAutoUpdater()` + IPC handlers | `electron/main.ts` | 15 min |
| 4 | Exposer `onUpdateStatus`, `installUpdate`, `getUpdateStatus` | `electron/preload.ts` | 5 min |
| 5 | Types `UpdateStatus` + étendre `LightMaestroAPI.app` | `src/types.d.ts` | 5 min |
| 6 | Composant `UpdateNotification` | `src/components/layout/update-notification.tsx` | 15 min |
| 7 | Intégrer `<UpdateNotification />` dans TopBar | `src/components/layout/topbar.tsx` | 2 min |
| 8 | Clés i18n `app.update.*` | `src/i18n/fr.json`, `src/i18n/en.json` | 5 min |
| 9 | (Optionnel) `dev-app-update.yml` pour tester en dev | racine du projet | 2 min |
| 10 | Build de test : `npm run dist` → vérifier `app-update.yml` dans `release/` | — | 5 min |

**Total estimé :** ~1h de travail.

---

## 9. Flow de test (Phase 1)

### 9.1. Test en dev (sans GitHub)

1. Lancer `npm run dev` → le console affiche `[autoUpdater] Dev mode — auto-update disabled`.
2. Le composant `UpdateNotification` ne s'affiche pas (status = `idle`).
3. ✅ L'infra est en place mais inactive.

### 9.2. Test en prod (packagé, avec GitHub Release)

1. `npm version patch` (bump `1.0.0` → `1.0.1`).
2. `GH_TOKEN=xxx npm run dist` → electron-builder génère l'installer + publie un release GitHub.
3. Installer la v1.0.0 (ou simuler en éditant `package.json > version` à `0.9.0` et rebuild).
4. Lancer l'app packagée → au bout de ~3s, le badge "Mise à jour v1.0.1 disponible" apparaît.
5. Le téléchargement se fait en arrière-plan → badge "Téléchargement… X%".
6. À la fin → bouton vert "Installer et redémarrer".
7. Cliquer → l'app ferme, NSIS installe, l'app relance en v1.0.1.
8. ✅ Flow complet validé.

### 9.3. Vérifier que `app-update.yml` est bien généré

Après `npm run dist`, vérifier :

```powershell
# Le fichier doit exister dans le dossier d'output
Get-Content release\win-unpacked\resources\app-update.yml
```

Contenu attendu :

```yaml
provider: github
owner: vitte
repo: light-maestro
releaseType: release
```

Si ce fichier n'existe pas, le champ `publish` est mal configuré.

---

**Fin de la spec.** Aucun fichier du repo n'a été modifié.
