# Plan — Compiler un installeur Windows .exe (Light Maestro)

## Tâche
Produire un installeur Windows NSIS `.exe` autonome qui embarque tout le nécessaire
(Electron, modules natifs recompilés, fixtures, renderer prébuildé, icône).

## Faits S1 (validés)
- App Electron 30, `main: dist/electron/main.js`, `electron-builder@24` déjà configuré (nsis x64, appId com.lightmaestro.app, productName Light Maestro).
- Build = `tsc -p tsconfig.electron.json` (main → dist/electron) + `vite build` (renderer → dist/renderer).
- Dépendances natives : `better-sqlite3`, `serialport`, `midi`, `ftdi-d2xx`, `enttec-open-dmx-usb` (optional) → ABI Electron à gérer.
- `publish: github` → builder par défaut publie sur tag ; il faudra `--publish never`.

## Axes de vérification (round 1 — 3 subagents parallèles)
1. **A — natif + outillage** → `subagent_A_native.md` : quelles deps sont natives, prebuilt vs source, présence de la toolchain node-gyp (VS Build Tools + Python), et comportement exact d'electron-builder (rebuild).
2. **B — chemins runtime packagés** → `subagent_B_paths.md` : audit de tous les `path.join(__dirname,…)`, `app.getAppPath()`, `process.resourcesPath`, `spawn/fork/Worker` dans `electron/**` → ce qui casse sous `asar:true` vs `asar:false` + correctif exact (config et/ou code).
3. **C — revue config builder** → `subagent_C_config.md` : revue adversariale de la section `build` de package.json + scripts ; gaps (copie usb-output.js, icône .ico, globs `files`, `asarUnpack`, publish).

## Dépendances
- A, B, C indépendants (round 1).
- Round 2 (mainline) : synthèse → correctifs (script de build + config asar/icône + éventuel fix de chemin) → `electron-builder --publish never` → vérif de l'exe produit.

## Livrable
`DELIVERY/` : l'installeur `.exe` (ou le chemin dans `release/`) + `instructions-installation.md`.
