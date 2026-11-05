# Subagent B — Audit des chemins runtime en mode packagé (asar:true vs asar:false)

Projet : `light-maestro`. Objectif : déterminer ce qui casse sous `asar:true` vs `asar:false` et donner le correctif exact.
Audit **statique uniquement** (pas de build). Fichiers analysés : tout `electron/**` (+ `dist/` pour vérifier la chaîne de build).

---

## 0. Rappel du layout packagé (ce que deviennent les chemins)

Deux points d'ancrage utilisés par le code, et ce qu'ils valent en mode packagé :

| Symbole | `asar:true` | `asar:false` |
|---|---|---|
| `__dirname` (tout module compilé) | `$INST\resources\app.asar\dist\electron\<sous-dossier>` | `$INST\resources\app\dist\electron\<sous-dossier>` |
| `app.getAppPath()` | `$INST\resources\app.asar` (racine de l'archive, **pas un vrai dossier**) | `$INST\resources\app` (vrai dossier) |
| `process.resourcesPath` | `$INST\resources` | `$INST\resources` |

(`$INST` = répertoire d'installation NSIS ; `dist/electron/` = sortie de `tsc`, `dist/renderer/` = sortie de `vite build`.)

**Règle qui décide de tout** : Electron patche `fs` + `require()` pour lire *à travers* l'asar **uniquement dans le process Electron (main + renderer)**. Les process **fils** (`spawn` avec `ELECTRON_RUN_AS_NODE=1`) et les **worker_threads** ne bénéficient pas de ce patch de façon fiable → ils ne voient pas l'intérieur de `app.asar`.

---

## 1. Tableau des cas (fichier:ligne → verdict)

Légende : ✅ = fonctionne, ❌ = casse, ⚠️ = fragile/non fiable.

| # | Cas | Fichier:ligne | Chemin résolu **packagé** (`asar:true`) | asar:true | asar:false |
|---|---|---|---|---|---|
| 1 | `new Worker(worker.js)` | `electron/dmx/engine.ts:224,230` | `…\resources\app.asar\dist\electron\dmx\worker.js` | ⚠️ fragile (voir §2a) | ✅ |
| 2 | `spawn(process.execPath, [usb-output.js], ELECTRON_RUN_AS_NODE=1)` | `engine.ts:322,342,345` | script `…\app.asar\dist\electron\dmx\usb-output.js` | ❌ (voir §2b) | ✅ |
| 3 | `cwd` du spawn USB (`__dirname/../../../`) | `engine.ts:341` | `…\resources\app.asar` (**c'est un fichier, pas un dossier**) | ❌ (chdir ENOENT) | ✅ |
| 4 | Retry timer USB (même spawn) | `engine.ts:492` | idem #2/#3 | ❌ | ✅ |
| 5 | `require('serialport')` dans le **fils** USB | `usb-output.js:22` | résolution module → `app.asar\node_modules\serialport` (invisible du fils) | ❌ | ✅ |
| 6 | Fixtures QXF/JSON | `fixtures/library.ts:462,468` | `app.getAppPath()/resources/fixtures` = `…\app.asar\resources\fixtures` | ✅ (fs patché + asarUnpack) | ✅ |
| 7 | Fixtures OFL | `library.ts:468` | `…\app.asar\resources\fixtures\ofl` | ✅ | ✅ |
| 8 | budget.json | `library.ts:1258` | `…\app.asar\resources\fixtures\ofl\budget.json` | ✅ | ✅ |
| 9 | Fixtures user (override) | `library.ts:474,483,1170,1204` | `userData\ofl-fixtures`, `userData\fixtures` | ✅ | ✅ |
| 10 | splash.html | `main.ts:174-176` | `__dirname/../renderer/splash.html` = `…\app.asar\dist\renderer\splash.html` | ✅ (loadFile lit l'asar) | ✅ |
| 11 | preload.js | `main.ts:212` | `__dirname/preload.js` = `…\app.asar\dist\electron\preload.js` | ✅ | ✅ |
| 12 | renderer index.html (loadFile) | `main.ts:253,261,267` | `__dirname/../renderer/index.html` | ✅ (loadFile) | ✅ |
| 13 | `ensureBuilt()` / `buildRendererAsync()` (`npx vite build`) | `main.ts:89-97,122-135` | ne s'exécute **pas** en mode packagé (`app.isPackaged` court-circuite) | ✅ (nop) | ✅ |
| 14 | presets.json / show-store.json / storage:* | `main.ts:716-741` | `userData\*.json` (vrai dossier, hors asar) | ✅ | ✅ |
| 15 | `app.setPath('userData', appData\light-maestro)` | `main.ts:28` | `%APPDATA%\light-maestro` | ✅ | ✅ |
| 16 | Crash logs / minidumps | `utils/crash-logger.ts:7`, `main.ts:32` | `userData\logs` | ✅ | ✅ |
| 17 | MIDI mapping store | `midi/manager.ts:340-341` | `userData\…` | ✅ | ✅ |
| 18 | Show save/load + SQLite index | `show/storage.ts:185-193,301-302` | `userData\shows\*.lmshow`, `userData\shows.db` | ✅ | ✅ |
| 19 | `require('serialport')` **process main** (listSerialPorts) | `main.ts:422` | `app.asar\node_modules\serialport` (unpacked) | ✅ (require patché + asarUnpack) | ✅ |
| 20 | `require('midi')`, `require('better-sqlite3')` | `midi/manager.ts:79,147`, `storage.ts:13` | unpacked via asarUnpack | ✅ | ✅ |
| 21 | `require('artnet')` / `require('sacn')` | `engine.ts:444,461`, `sacn-receiver.ts:170` | JS pur, dans l'asar | ✅ | ✅ |
| 22 | OFL updater (bundled SHA) | `fixtures/updater.ts:101-102` | `app.getAppPath()/../resources/…` ET `app.getAppPath()/resources/…` | ✅ (fs patché) | ✅ |
| 23 | OFL updater (unzip via `execSync powershell/unzip`) | `updater.ts:326,332` | opère sur `os.tmpdir()` (hors asar) | ✅ | ✅ |
| 24 | electron-updater (`app-update.yml`) | `main.ts:setupAutoUpdater` | lu par electron-updater depuis `process.resourcesPath` = `…\resources\app-update.yml` (**hors asar**) | ✅ | ✅ |
| 25 | `process.resourcesPath` utilisé nulle part | — | — | (0 occurrence) | (0 occurrence) |

---

## 2. Détail des ruptures sous `asar:true`

### 2a. Cas #1 — `new Worker(path.join(__dirname,'worker.js'))` → ⚠️ fragile

`worker.js` est du JS **pur** (n'importe que `worker_threads`). En théorie, `new Worker()` tourne dans le **même process** que le main, donc il *peut* hériter du `Module._load` patché d'Electron et lire le fichier dans l'asar. **En pratique c'est un point de douleur documenté** (electron/electron#18540, #26996, #40612) : le worker a son propre registre de modules et le patch asar n'y est pas toujours appliqué, selon la version d'Electron. Comportement non déterministe.

- `asar:true` : ⚠️ **peut marcher aujourd'hui et casser au prochain bump d'Electron** — ne pas compter dessus.
- `asar:false` : ✅ déterministe (vrai fichier).

### 2b. Cas #2/#3/#4/#5 — `spawn(process.execPath, [usb-output.js], ELECTRON_RUN_AS_NODE=1)` → ❌ casse à 3 niveaux

Le fils est lancé comme **Node pur** (pas d'Electron, donc **aucun patch asar**). Trois défaillances indépendantes :

1. **Script illisible** : `argv[1]` = `…\app.asar\dist\electron\dmx\usb-output.js`. Le fils fait `fs.readFileSync` sur un chemin dont le segment `app.asar` est un **fichier** (archive), pas un dossier → **ENOENT**. Le script ne démarre pas.
2. **cwd invalide** : `cwd = path.join(__dirname,'..','..','..')` = `…\resources\app.asar` (un fichier). `spawn` tente un `chdir` vers un non-dossier → **erreur ENOENT** dès le spawn.
3. **Dépendance native introuvable** : même si 1 et 2 étaient contournés, `require('serialport')` (ligne 22 de `usb-output.js`) résout depuis `app.asar\dist\electron\dmx` vers `app.asar\node_modules\serialport` — invisible du fils → **module not found**.

**Conséquence fonctionnelle** : en app packagée `asar:true`, la sortie USB DMX est **morte** (l'engine retente 3× puis émet « USB … failed after 3 attempts »), quel que soit `asarUnpack`, car `dist/electron/dmx/usb-output.js` n'est **pas** dans `asarUnpack`.

---

## 3. Constats transverses (indépendants du choix asar, mais bloquants pour l'installeur)

1. **`usb-output.js` n'est PAS produit par le build.** `tsc -p tsconfig.electron.json` (`include: ["electron"]`, pas de `allowJs`) ne copie **pas** les `.js`/`.html`. Or `dist/` est dans `.gitignore`, et aucun script de build ne copie `electron/dmx/usb-output.js` → `dist/electron/dmx/usb-output.js` (qui existe aujourd'hui, hash identique à la source, timestamp du 14/08) est une **copie manuelle** qui n'existera pas sur un checkout propre / CI. Sans lui, `path.join(__dirname,'usb-output.js')` pointe vers un fichier absent **même en `asar:false`**. → **À corriger dans le pipeline de build** (cf. §5, correctif 2).
2. **Icône** : `resources/icon.png` seulement, **pas de `.ico`**. NSIS exige un `.ico` pour l'installeur/exe (échec ou icône par défaut). → hors périmètre chemins (cf. subagent C), mais signalé.
3. **`resources/fixtures/ofl-commit-sha.txt` absent** → `updater.ts` démarre sans SHA bundle, le 1er lancement télécharge tout l'OFL. Mineur, pas un bug asar. (À noter : le fallback `app.getAppPath()/../resources/fixtures/ofl-commit-sha.txt` résout `…\resources\resources\fixtures\…` = chemin erroné ; seul `altBundledPath` (`app.getAppPath()/resources/…`) est correct.)

---

## 4. Recommandation finale (tranchée)

### ✅ `asar: false` — recommandé, zéro changement de code

C'est le choix à prendre. L'app cumule **exactement** les trois motifs qui rendent `asar:true` dangereux :
- un `worker_threads` lancé par chemin (`new Worker(__dirname/worker.js)`) ;
- un **child process** `spawn(process.execPath, [script], ELECTRON_RUN_AS_NODE=1)` dont le `cwd` tombe dans l'asar ;
- des **modules natifs** (`serialport`, `better-sqlite3`, `midi`) + `electron-updater`.

Avec `asar:false`, tout le layout devient un vrai dossier `resources\app\`, donc **tous les cas du tableau passent à ✅ sans toucher au code** (les cas 1→5, 6→25). `asarUnpack` devient inutile (ignoré). Seul le correctif **build** (usb-output.js) reste obligatoire.

**Config exacte (`package.json` → `build`) :**
```json
"asar": false,
```
(garder `files`, `win/nsis`, `publish` tels quels ; retirer `asarUnpack` pour la lisibilité — il est sans effet.)

### Alternative (si `asar:true` doit absolument être conservé) — plus de travail, plus fragile

**Config (`package.json`) :** ajouter l'unpack des scripts lancés hors-process :
```json
"asar": true,
"asarUnpack": [
  "node_modules/better-sqlite3/**",
  "node_modules/midi/**",
  "node_modules/serialport/**",
  "node_modules/@serialport/**",
  "resources/**/*",
  "dist/electron/dmx/**/*"
]
```

**Correctif de chemin (`electron/dmx/engine.ts`) :** ajouter un helper et l'utiliser sur les 2 chemins + le cwd :

```ts
import { app } from 'electron';            // en haut de engine.ts (déjà importé ? non — à ajouter)

/** Résout le chemin réel quand app.asar est utilisé : bascule vers app.asar.unpacked. */
function realPath(p: string): string {
  return app.isPackaged ? p.replace('app.asar', 'app.asar.unpacked') : p;
}
```

Puis :
- Ligne ~224 : `const workerPath = realPath(path.join(__dirname, 'worker.js'));`
- Ligne ~322 et ~492 : `const scriptPath = realPath(path.join(__dirname, 'usb-output.js'));`
- Ligne ~341 : remplacer
  ```ts
  const projectRoot = path.join(__dirname, '..', '..', '..');
  const child = spawn(process.execPath, [scriptPath, portName], {
    stdio: ['pipe','pipe','pipe'],
    cwd: projectRoot,
  ```
  par
  ```ts
  const child = spawn(process.execPath, [scriptPath, portName], {
    stdio: ['pipe','pipe','pipe'],
    cwd: path.dirname(scriptPath),   // vrai dossier : le require('serialport') du fils résout vers app.asar.unpacked\node_modules
  ```

> ⚠️ Même avec ce correctif, le `require('serialport')` du fils ne marche que parce que `serialport`/`@serialport` sont unpackés **et** que `cwd` (ou le chemin du script) se trouve sous `app.asar.unpacked`. C'est une chaîne fragile ; c'est précisément ce que `asar:false` élimine d'un coup.

---

## 5. Correctif build obligatoire (quel que soit le choix asar)

`usb-output.js` doit être copié dans `dist/electron/dmx/`. Ajouter au pipeline (ex. script Node cross-platform, ou `shx`/`copyfiles`) :

```jsonc
// package.json — scripts
"build": "tsc -p tsconfig.electron.json && vite build && node scripts/copy-static.mjs"
```

`scripts/copy-static.mjs` :
```js
import { copyFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'dist', 'electron', 'dmx'), { recursive: true });
copyFileSync(join(root, 'electron', 'dmx', 'usb-output.js'),
             join(root, 'dist', 'electron', 'dmx', 'usb-output.js'));
```

(`splash.html` n'a **pas** besoin d'être copié : `main.ts` lit `../renderer/splash.html`, produit par `vite build` via `public/splash.html`. Le `dist/electron/splash.html` présent est un artefact mort.)

---

## 6. Verdict en une phrase

**Passe en `asar:false`** (correctif config à 1 ligne) + **corrige le build pour copier `usb-output.js`** (correctif pipeline). Ne garde `asar:true` que si l'exigence d'anti-tamper est explicite, au prix du correctif de chemin + unpack + validation réelle du worker en production.
