# Livraison — Installeur Windows Light Maestro

**Date** : 2026-08-18
**Commit** : `fb6ef1c` — *build: fiabilise le packaging electron-builder (asar:false, copie usb-output.js, --publish never)*

## Livrable

| Fichier | Taille | Chemin |
|---|---|---|
| **Light Maestro Setup 1.0.0.exe** | 92,7 MB | `release\Light Maestro Setup 1.0.0.exe` |
| **Light Maestro 1.0.0.exe** (portable) | 92,5 MB | `release\Light Maestro 1.0.0.exe` |

Deux formats :
- **Setup** (NSIS) : assistant d'installation, choix du dossier, raccourcis Bureau + menu Démarrer.
- **Portable** : exe autonome « embarquant tout » — à copier tel quel sur l'autre machine et lancer (aucune installation).

## Ce qui a été corrigé (3 audits convergents : natif / chemins packagés / config)

### Bloquants
1. **`asar: false`** (ex `true`) — l'app cumule les 3 motifs qui rendent l'asar dangereux :
   - `new Worker(__dirname/worker.js)` (worker_threads ≠ fiable dans l'asar) ;
   - `spawn(process.execPath, [usb-output.js], ELECTRON_RUN_AS_NODE=1)` → le fils Node pur ne peut lire ni le script ni `require('serialport')` depuis `app.asar` ;
   - modules natifs (`.node`).
   → tout devient des fichiers réels, les chemins `__dirname`/`app.getAppPath()` fonctionnent sans retouche de code.
2. **Copie de `electron/dmx/usb-output.js`** dans le build (`scripts/copy-static.cjs`, chaîné dans `build`). `tsc` ne copie pas les `.js` purs → la sortie DMX USB était cassée sur un checkout propre.
3. **`--publish never`** sur `dist` (ex `electron-builder` nu avec `publish: github`) → aucune publication accidentelle.

### Nettoyage
4. **`three` + `@types/three` déplacés en `devDependencies`** — utilisés uniquement par le renderer (bundlé par Vite), ~801 fichiers dédoublonnés retirés du paquet.
5. `ftdi-d2xx`/`enttec-open-dmx-usb` : non `require()`s à ce jour (dormants) — avec `asar:false`, plus aucun risque d'extraction.

## Vérifications effectuées

- `tsc -p tsconfig.electron.json` : OK (exit 0).
- `vite build` : OK (1493 modules, `index-*.js` 1,6 MB).
- `electron-builder --publish never` : exit 0, `win-unpacked` + NSIS + blockmap générés.
- `resources/app/` = vrai dossier (asar absent) : `dist/electron/dmx/{engine,worker,usb-output,sacn-receiver}.js` présents.
- 2361 fixtures embarquées dans `resources/app/resources/fixtures`.
- **ABI native validée en réel** (ELECTRON_RUN_AS_NODE sur le binaire packagé) :
  - `better-sqlite3` 12.11.1 → OK
  - `midi` 2.0.0 → OK (Output/Input)
  - `serialport` 13.0.0 → OK

## Reste à tester par l'utilisateur (impossible sans hardware/IHM)

- Lancement de l'installeur sur une machine cible (install + raccourcis + lancement).
- Sortie **Art-Net / sACN** (sans matériel USB, testable en réseau).
- Sortie **USB DMX** (nécessite le dongle ; le chemin `usb-output.js` + `serialport` est désormais correct).

## Notes

- L'icône vient de `resources/icon.png` (256×256, conversion auto en `.ico` par electron-builder). Passer à ≥512 pour un rendu plus net (source vectorielle dispo dans `assets/logo/icon.svg`).
- `release/` et `dist/` sont gitignorés → l'installeur n'est pas versionné.
