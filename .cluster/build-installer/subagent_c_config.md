# Revue adversarial electron-builder — Light Maestro

Revue de la section `build` de `package.json`, des scripts npm, de `tsconfig.electron.json`, du `.gitignore` et de l'arborescence réelle du projet. **Revue uniquement, aucun build lancé.** Vérifications croisées avec le build déjà présent dans `release/` (app.asar inspecté via `@electron/asar`).

---

## État des lieux vérifié

- `build` dans `package.json` : `"build": "tsc -p tsconfig.electron.json && vite build"`
- `pack` : `electron-builder --dir` ; `dist` : `electron-builder` (sans flag `--publish`)
- `tsconfig.electron.json` : `outDir=dist/electron`, `rootDir=electron`, `include=["electron"]`, **pas de `allowJs`**, `composite:true`, `declaration:true`, `sourceMap:true`
- `files` : `["dist/**/*", "resources/**/*", "node_modules/**/*", "package.json"]`
- `asarUnpack` : `better-sqlite3`, `midi`, `serialport`, `@serialport`, `resources`
- `directories.buildResources: "resources"` — **le dossier runtime des fixtures sert aussi de dossier d'assets de build**
- Icône : **aucun `.ico`** dans le projet. `resources/icon.png` = **256×256** (le minimum requis). Présence confirmée de `assets/logo/icon-512.png` et `assets/logo/icon-1024.png`.
- `resources/` contient : `fixtures/` (bibliothèque QLC+/OFL, ~2495 fichiers) + `icon.png`
- Modules natifs réellement requis à l'exécution (grep des sources) :
  - `serialport` (dans `usb-output.js` + `main.ts` `dmx:listSerialPorts`) → binding natif = `@serialport/bindings-cpp` (`.node` dans `prebuilds/`)
  - `midi` (dans `electron/midi/manager.ts`)
  - `better-sqlite3` (dans `electron/show/storage.ts`)
  - `ftdi-d2xx` et `enttec-open-dmx-usb` : **aucun `require()` à l'exécution** (seulement `declare module 'enttec-open-dmx-usb'` dans `electron/types.d.ts`). Dormants.

---

## GAPS

### G1 — HAUTE — `electron/dmx/usb-output.js` jamais copié par le build (sortie DMX USB cassée en packagé)

**Constat :**
- `tsc -p tsconfig.electron.json` ne compile **ni ne copie** les fichiers `.js` (`allowJs` absent). Seuls les `.ts` sont émis vers `dist/electron/`.
- `dist/electron/dmx/engine.js` fait `path.join(__dirname, 'usb-output.js')` (lignes 314 et 502) et `spawn(process.execPath, [scriptPath, ...])`. Ce fichier **doit** exister à côté de `engine.js`.
- Preuve : `dist/electron/dmx/usb-output.js` a le **même LastWriteTime que la source** (`electron/dmx/usb-output.js`, 14/08 10:05) alors que les `.js` compilés (`engine.js`) datent du 17/08 — il a été **copié à la main**, pas par `tsc`.
- `dist/` est dans le `.gitignore` → `git ls-files` ne tracke que `electron/dmx/usb-output.js` (la source). Un **clone propre + `npm run build`** ne produira **pas** `dist/electron/dmx/usb-output.js`.
- Conséquence : en app packagée (et même en `npm run start` / `npm run dev`), le spawn du child process USB échoue → **aucune sortie DMX USB**. Art-Net/sACN non impactés (dans le main process).

**Correctif exact (Option A — recommandée, script node de copie) :**

Créer `scripts/copy-static.cjs` :
```js
// Copie les fichiers statiques non compilés par tsc vers dist/electron
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const copies = [
  ['electron/dmx/usb-output.js', 'dist/electron/dmx/usb-output.js'],
];

for (const [src, dest] of copies) {
  const destAbs = path.join(root, dest);
  fs.mkdirSync(path.dirname(destAbs), { recursive: true });
  fs.copyFileSync(path.join(root, src), destAbs);
  console.log(`[copy-static] ${src} -> ${dest}`);
}
```

Modifier les scripts `package.json` :
```json
"dev:electron": "tsc -p tsconfig.electron.json && node scripts/copy-static.cjs && electron .",
"build": "tsc -p tsconfig.electron.json && node scripts/copy-static.cjs && vite build",
"start": "tsc -p tsconfig.electron.json && node scripts/copy-static.cjs && vite build && electron ."
```

**Options alternatives :**
- **B** : renommer `usb-output.js` → `usb-output.ts` en ajoutant `// @ts-nocheck` en tête (code CJS pur, `module: CommonJS` le recompilerait tel quel). Moins propre (callbacks `function(err)` non typés sous `strict`).
- **C** : `extraResources` (copie hors asar dans `resources/`) — nécessite de changer le code pour `process.resourcesPath` au lieu de `__dirname`. Plus invasif, déconseillé ici.

---

### G2 — HAUTE (sécurité de publication) — `dist` sans `--publish never` + auto-update Windows non signé

**Constat :**
- `"dist": "electron-builder"` sans flag. Avec `publish.provider=github` présent dans `package.json`, le mode effectif par défaut est **`onTagOrDraft`** : electron-builder publie sur GitHub **si le HEAD est taggé ou en CI** (et `GH_TOKEN` présent). Localement sans tag sur HEAD (`git describe --exact-match` = vide, les tags existants sont des `backup/*` et `checkpoint-*`, pas `v1.0.0`) et sans `GH_TOKEN`/`GITHUB_TOKEN`, la publication est **skippée** — mais le comportement reste implicite et fragile (un tag `v1.0.0` + CI = publication non voulue).
- L'**auto-update Windows** (`electron-updater`) exige : (1) un installeur **signé**, (2) `latest.yml` publié sur la release GitHub, (3) un `app-update.yml` embarqué (ou feed URL passé en code). Vérifié : **`app-update.yml` est absent** de `release/win-unpacked/resources/`. `setupAutoUpdater()` appelle `autoUpdater.checkForUpdatesAndNotify()` sans feed URL → échec silencieux capturé par le `.catch` → **l'app démarre quand même** (aucun crash). Le guard `if (!app.isPackaged)` est correct et présent.

**Correctif exact :**
```json
"dist": "electron-builder --publish never"
```
(pour une build locale non signée). La publication réelle se fera via un workflow CI dédié avec `--publish always` sur tag + certificat de signature. Ne pas s'appuyer sur l'auto-update tant que la signature n'est pas en place.

---

### G3 — MOYENNE — `asarUnpack` incomplet pour les modules natifs dormants `ftdi-d2xx` / `enttec-open-dmx-usb`

**Constat :**
- `ftdi-d2xx` contient des binaires natifs (`.node` : `build/Release/ftdi-d2xx.Windows.AMD64.node`, etc.) et des `.lib`/`.a`. `enttec-open-dmx-usb` dépend de `serialport@^11`.
- Ils **ne sont pas** dans `asarUnpack` → ils sont embarqués **dans** `app.asar` (vérifié : `app.asar.unpacked/node_modules` ne contient que `@serialport`, `better-sqlite3`, `midi`, `serialport`).
- Aujourd'hui inoffensif : aucun `require()` à l'exécution. Mais si le support FTDI/ENTTEC est activé plus tard, `require()` d'un `.node` **depuis l'asar échoue** (« Module did not self-register » / cannot find). Le `declare module 'enttec-open-dmx-usb'` dans `types.d.ts` indique que c'est prévu.

**Correctif exact (au choix) :**
1. Les **retirer** des dépendances (inutilisés) : supprimer `ftdi-d2xx` de `dependencies` et `enttec-open-dmx-usb` de `optionalDependencies`.
2. Ou, si prévu, les ajouter à `asarUnpack` :
```json
"asarUnpack": [
  "node_modules/better-sqlite3/**",
  "node_modules/midi/**",
  "node_modules/serialport/**",
  "node_modules/@serialport/**",
  "node_modules/ftdi-d2xx/**",
  "node_modules/enttec-open-dmx-usb/**",
  "resources/**/*"
]
```

Note : les modules natifs **réellement utilisés** (`better-sqlite3`, `midi`, `serialport`, `@serialport/bindings-cpp`) sont **bien couverts**. `bindings` (transitif) est du pur JS, pas besoin d'unpack.

---

### G4 — MOYENNE — `three` (et `@types/three`) en `dependencies` = doublon de ~5 MB dans l'installeur

**Constat :**
- `three` est une dépendance **renderer** déjà bundlée par Vite (`dist/renderer/assets/*.js`). Elle n'a rien à faire dans `node_modules` de l'app packagée.
- Vérifié dans `app.asar` : `three` = **801 fichiers** embarqués, en doublon du bundle renderer.
- Même logique que `react`, `react-dom`, `zustand`, `lucide-react` qui sont, eux, correctement en `devDependencies`.

**Correctif exact :**
Déplacer de `dependencies` → `devDependencies` :
```json
"three": "^0.184.0",
"@types/three": "^0.184.1"
```
(puis `npm install` pour régénérer le lockfile).

---

### G5 — BASSE — `files` avec `node_modules/**/*` est redondant et invite les G3/G4

**Constat :**
- electron-builder inclut **déjà automatiquement** les dépendances de production. Le glob `node_modules/**/*` est un anti-pattern.
- Vérifié : malgré ce glob, les devDeps (`electron`, `vite`, `react`, `typescript`, `electron-builder`…) sont **bien exclus** de l'asar (0 entrée chacun) — la déduplication devDeps fonctionne. Mais le glob force l'inclusion de `three`, `ftdi-d2xx`, `enttec-open-dmx-usb`.

**Correctif exact :** retirer la ligne `"node_modules/**/*"` de `files` (les natifs restent gérés par `asarUnpack`) :
```json
"files": [
  "dist/**/*",
  "resources/**/*",
  "package.json"
]
```

---

### G6 — BASSE — Icône : pas de `.ico` commité, `icon.png` au minimum vital

**Constat :**
- Aucun `build/icon.ico` ni `resources/icon.ico`. `resources/icon.png` = **256×256**.
- electron-builder convertit un PNG ≥256 en `.ico` (confirmé : `release/.icon-ico/icon.ico` a bien été généré) → **le build ne casse pas**. Mais 256 est le strict minimum : les tailles 512/1024 ne peuvent pas être dérivées, l'icône de l'installeur/du raccourci sera légèrement floue.
- `assets/logo/` contient `icon-512.png`, `icon-1024.png`, `icon.svg`, `icon-full.svg`.

**Correctif exact :** générer/proposer un PNG ≥512 comme source. Soit remplacer `resources/icon.png` par un upscale 512 (`assets/logo/icon-512.png`), soit pointer explicitement :
```json
"win": {
  "target": [{ "target": "nsis", "arch": ["x64"] }],
  "icon": "assets/logo/icon-512.png"
}
```

---

### G7 — BASSE — Artefacts de build embarqués dans l'asar (`*.map`, `*.tsbuildinfo`)

**Constat :**
- `sourceMap:true` → les `dist/electron/**/*.js.map` partent dans l'installeur (poids mort + fuite de source).
- `composite:true` → `dist/tsconfig.electron.tsbuildinfo` est embarqué (vu dans l'asar).
- Les `.d.ts` sont déjà exclus par défaut par electron-builder (`!**/*.d.ts`, visible dans `builder-debug.yml`).

**Correctif exact :** exclure ces artefacts dans `files` :
```json
"files": [
  "dist/**/*",
  "!dist/**/*.map",
  "!dist/**/*.tsbuildinfo",
  "resources/**/*",
  "package.json"
]
```
(ou passer `sourceMap:false` en build de prod).

---

### G8 — BASSE — `directories.buildResources: "resources"` mélange assets de build et données runtime

**Constat :**
- Le dossier `resources/` (2495 fixtures runtime) sert aussi de dossier d'assets de build. Fonctionnel (electron-builder y trouve `icon.png`), mais sémantiquement faux et fragile (tout ajout d'un fichier de config d'installeur irait se mélanger aux fixtures).

**Correctif exact (optionnel) :** créer un dossier `build/` dédié et pointer dessus :
```json
"directories": {
  "output": "release",
  "buildResources": "build"
}
```
y placer `build/icon.ico` (ou `build/icon.png`) et les éventuels `installer.nsh`.

---

## Point 2 (rappel) — Ce qui N'EST PAS embarqué par erreur

Avec `files = [dist/**/*, resources/**/*, node_modules/**/*, package.json]`, **aucun** de ces éléments n'est packagé (hors patterns, confirmé) :
- les fichiers racine `.lmpreset` / `.lmshow` / `.lmproj` (1on6, baby, Believe, Corona, everybody, DDL, Hope, Hope2, yolo, …)
- `memory/`, `.openclaw/`, `.cluster/`, `evolution-drafts/`, `projects/`, `docs/`, `assets/`, `src/`, `electron/` (sources), `public/`, `index.html`, `launch.bat/.vbs`, `readme.md`, `license.txt`, `package-lock.json` (exclu par défaut), configs Vite/Tailwind/PostCSS.
→ **Rien à corriger** sur ce point : les données personnelles et les sources ne fuient pas dans l'installeur. Seul `resources/**/*` (fixtures, volontairement) part dans l'app.

---

## Résumé

**Config prête après 2 correctifs bloquants + 1 passe de nettoyage :**

1. **G1 (obligatoire)** : ajouter la copie de `electron/dmx/usb-output.js` → `dist/electron/dmx/usb-output.js` dans `build`/`start`/`dev:electron` (script `scripts/copy-static.cjs`).
2. **G2 (obligatoire)** : `"dist": "electron-builder --publish never"` pour les builds locales non signées.
3. **G3+G4+G5 (recommandé)** : retirer `node_modules/**/*` de `files`, déplacer `three`/`@types/three` en devDeps, et retirer (ou unpack) `ftdi-d2xx`/`enttec-open-dmx-usb`.

Optionnels (qualité) : G6 (icône ≥512), G7 (exclure `.map`/`.tsbuildinfo`), G8 (`buildResources` dédié).
