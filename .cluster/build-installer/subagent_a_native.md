# Audit modules natifs — Light Maestro (Electron 30)

Date : 2026-08-18 — Auditeur packaging (subagent A)

## Environnement mesuré (réel, pas spéculé)

| Élément | Valeur mesurée |
|---|---|
| `node -v` | v22.22.0 |
| `npm -v` | 11.17.0 |
| `npx electron --version` | v30.5.1 |
| ABI Electron 30 (runtime node embarqué) | Node **20.16.0**, ABI/modules **123**, NAPI **9** |
| ABI Node local (22.22.0) | ABI/modules **127**, NAPI **10** |
| `npm config get node_gyp` | `undefined` (valeur par défaut) |
| `where node-gyp` | introuvable dans le PATH (normal) |
| node-gyp global | **12.4.0** fourni/bundlé avec npm (npm ls -g) |
| Python | `python` → **3.13.12** ; `py` → **3.14.3** |

⚠️ **Écart ABI important** : Node local = ABI 127, Electron 30 = ABI 123. Tout module natif ABI-sensible compilé pour Node 22 ne se chargera PAS dans Electron 30. (C'est le cas classique qui impose electron-rebuild.)

---

## 1. Inventaire des dépendances natives

### Dépendances candidates (`dependencies` + `optionalDependencies`)

| Dep | Version | Native ? | Mécanisme | Prebuilt ? | ABI stable (N-API) ? |
|---|---|---|---|---|---|
| **better-sqlite3** | 12.11.1 | ✅ OUI (API V8 directe, pas N-API) | `prebuild-install \|\| node-gyp rebuild --release` | Prebuilt Electron **disponibles** via GitHub releases (prebuild-install), mais **pas de dossier `prebuilds/` localement** → compilé | ❌ ABI-sensible |
| **serialport** → `@serialport/bindings-cpp` | 13.0.0 / bindings-cpp 13.0.0 | ✅ OUI (natif) | `node-gyp-build` + node-addon-api 8.3.0 | ✅ `prebuilds/win32-x64/@serialport+bindings-cpp.node` présent (+ 11 autres plateformes) | ✅ **N-API 8** (ABI-stable) |
| **midi** | 2.0.0 | ✅ OUI (natif) | `binding.gyp` + **NAN** | ❌ Aucun prebuild (pas de dossier prebuilds, pas de script install) → **compilation requise** | ❌ NAN (ABI-sensible) |
| **ftdi-d2xx** | 1.3.1 | ✅ OUI (natif) | `cmake-js` / CMakeLists.txt, `NAPI_VERSION=8` | ✅ Prebuilt **livrés dans le package** (`build/Release/ftdi-d2xx.Windows.AMD64.node` + Darwin/Linux) | ✅ **N-API 8** (ABI-stable) |
| **enttec-open-dmx-usb** (optional) | 4.0.1 | ⚠️ PAS de natif propre (wrapper JS pur) | dépend de `serialport ^11` | ⚠️ hérite du natif via son **serialport imbriqué** (voir §4) | ✅ (via N-API imbriqué) |

### Dépendances vérifiées NON natives (aucune action)

`dmxnet` (0.9.0, pur JS : jspack/netmask/winston), `artnet` (1.4.0, dgram), `sacn` (4.6.2, pur JS), `electron-store` (11, pur JS/ESM), `electron-updater`, `three`/`@types/three`, `xml2js`, `uuid`, `i18next`, `react-i18next`, `zustand`, etc.

**Aucune autre dep native suspecte détectée** au-delà de la liste ci-dessus.

---

## 2. Détail par dep native

### better-sqlite3 (12.11.1)
- `binding.gyp` présent → source à compiler. `src/` = `addon.cpp`, `better_sqlite3.cpp` (API V8, **pas** de `napi.h`/`node_api`).
- `dependencies` = `bindings` + `prebuild-install`. `engines` = node 20–26 (OK pour Electron 30 / Node 20.16).
- **Pas de dossier `prebuilds/`** → le binaire actuel a été **compilé depuis les sources**, pas téléchargé.
- `build/Release/better_sqlite3.node` présent + `build/Release/.forge-meta` = **`x64--123`** → preuve d'un **electron-rebuild déjà effectué pour ABI 123 (Electron 30)**.
- Chargé sous Electron (`ELECTRON_RUN_AS_NODE`) → **OK**.

### serialport / @serialport/bindings-cpp (13.0.0)
- `bindings-cpp` : `binding.gyp` présent mais **N-API** (`node-addon-api` 8.3.0, `binary.napi_versions=[8]`, `#include <napi.h>` partout dans `src/`).
- `prebuilds/win32-x64/@serialport+bindings-cpp.node` **présent** → prebuilt N-API, **ABI-stable**, aucun rebuild nécessaire.
- Chargé sous Electron → **OK**.

### midi (2.0.0)
- `binding.gyp` : `include_dirs` référence `require('nan')` + `vendor/rtmidi` → **NAN**, **pas** de `napi.h` dans `src/` → **ABI-sensible**.
- **Aucun prebuild** (pas de dossier `prebuilds/`, pas de script `install` dans `package.json` — `scripts` = test uniquement). npm a donc compilé `build/Release/midi.node` via `node-gyp rebuild` auto.
- `build/Release/midi.node` présent. Chargé sous Electron → **OK** ⇒ binaire actuellement compilé pour **ABI 123** (sinon il aurait échoué au chargement).
- **Pour un build neuf : compilation obligatoire** (electron-rebuild).

### ftdi-d2xx (1.3.1)
- **N-API 8** (`CMakeLists.txt` : `add_definitions(-DNAPI_VERSION=8)` ; `src/main.c` : `#include <node_api.h>`).
- `main.js` : `require('./build/Release/ftdi-d2xx.Windows.AMD64.node')` → binaires **prebuilt fournis dans le package** (`ftdi-d2xx.Windows.AMD64.node`, `Darwin.arm64/x86_64`, `Linux.x86_64`).
- ABI-stable → **aucun rebuild nécessaire**. Chargé sous Electron → **OK**.

### enttec-open-dmx-usb (4.0.1, optional)
- Pas de `binding.gyp`, pas de build natif propre. Wrapper JS (`eventemitter3` + `serialport`).
- **Piège packaging** : il embarque sa **propre copie imbriquée** `node_modules/enttec-open-dmx-usb/node_modules/` avec `serialport@11.0.1` + `@serialport/bindings-cpp@11.0.3`, dont le prebuilt est `prebuilds/win32-x64/node.napi.node` (N-API, ABI-stable).
- Aucun rebuild nécessaire, mais voir §5 (asarUnpack).

---

## 3. État de la toolchain (MSVC + Python + node-gyp)

| Composant | État |
|---|---|
| MSVC / cl.exe | ✅ **présent** : `C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Tools\MSVC\14.51.36231\bin\Hostx64\x64\cl.exe` |
| VS Build Tools 2026 | ✅ installé (18.6.2, MSVC 14.51.36231) |
| VS Build Tools 2019 | ✅ installé (16.11, MSVC 14.29.30133) |
| Windows SDK | ✅ `10.0.19041.0` + `10.0.26100.0` |
| Python | ✅ 3.13.12 + 3.14.3 |
| node-gyp | ✅ bundlé avec npm (12.4.0) — utilisable sans installation globale |

> `Get-Command cl.exe` ne renvoie rien dans une session PowerShell normale : c'est **normal**, cl.exe n'est pas dans le PATH par défaut. node-gyp le localise via vswhere (présent) et charge l'environnement DevCmd lui-même. **Le compilateur C++ et le SDK sont bien là.**

---

## 4. Comment les modules actuels tournent-ils sous Electron 30 (dev `npx electron .`) ?

Test de chargement réel sous `ELECTRON_RUN_AS_NODE=1 npx electron` (ABI 123) :

| Module | Résultat chargement | Via |
|---|---|---|
| better-sqlite3 | ✅ OK | **Compilation** (electron-rebuild, marqueur `x64--123`) |
| serialport / bindings-cpp | ✅ OK | **Prebuilt N-API** (`prebuilds/win32-x64`) |
| midi | ✅ OK | **Compilation** (NAN, compilé ABI 123) |
| ftdi-d2xx | ✅ OK | **Prebuilt N-API** (livré dans build/Release) |
| enttec-open-dmx-usb | ✅ OK | **Prebuilt N-API imbriqué** (serialport 11) |

⇒ **Tous les modules natifs actuellement installés sont déjà fonctionnels sous Electron 30.** Les ABI-sensibles (better-sqlite3, midi) ont déjà été compilés pour ABI 123 ; les N-API (serialport, ftdi-d2xx) chargent les prebuilds.

---

## 5. Risque packaging à signaler (hors périmètre « rebuild », mais bloquant au runtime packagé)

`build.asarUnpack` liste :
```
node_modules/better-sqlite3/**
node_modules/midi/**
node_modules/serialport/**
node_modules/@serialport/**
resources/**/*
```
… mais **pas** `node_modules/enttec-open-dmx-usb/**`.

Or `enttec-open-dmx-usb` contient une copie imbriquée de `serialport@11` + `@serialport/bindings-cpp@11.0.3` avec un vrai `.node` (`prebuilds/win32-x64/node.napi.node`). Une fois packagé en **asar**, ce `.node` imbriqué ne pourra pas être chargé (les binaires natifs doivent être décompressés de l'asar). ⇒ **Ajouter `node_modules/enttec-open-dmx-usb/**` à `asarUnpack`** (sinon le device Enttec échouera dans l'app installée, même si le dev fonctionne).

---

## 6. Conclusion

**Rebuild natif faisable tel quel — aucun bloquant.**

- **À recompiler pour Electron 30 (ABI 123)** : `better-sqlite3` (prebuilt Electron existent via prebuild-install, sinon compile) et `midi` (compile obligatoire, NAN, aucun prebuilt).
- **Aucune recompilation nécessaire** : `serialport`/`@serialport/bindings-cpp`, `ftdi-d2xx`, et le natif imbriqué de `enttec-open-dmx-usb` (tous N-API, prebuilt ABI-stable).
- **Toolchain complète** : MSVC (VS 2026 Build Tools 14.51 + VS 2019 14.29), Windows SDK 10.0.19041/26100, Python 3.13/3.14, node-gyp 12.4.0 bundlé. `electron-builder` pourra exécuter son rebuild natif (`install-app-deps`) sans rien installer de plus.
- **Action requise hors rebuild** : ajouter `node_modules/enttec-open-dmx-usb/**` à `asarUnpack`.
