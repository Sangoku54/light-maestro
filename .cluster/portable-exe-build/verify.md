# Vérification indépendante — exe portable Light Maestro 1.0.14

Date : 2026-08-23 (22:56 CEST)
Vérificateur : subagent indépendant (pas d'accès à l'historique de conversation)
Périmètre : `release\Light Maestro 1.0.14.exe` (portable, electron-builder `--win portable`)

---

## 1. Exe valide — ✅ OK

| Contrôle | Résultat | Preuve |
|---|---|---|
| Fichier présent | ✅ | `release\Light Maestro 1.0.14.exe` |
| En-tête PE | ✅ `MZ` + `PE` | 2 premiers octets = `MZ` ; offset `0x3C`=216 → signature `PE` |
| Taille | ✅ **82 757 348 octets = 78,92 Mo** (~79 Mo attendu) | `Get-Item` |
| SHA256 | ✅ | `3FCD7532620532863B3533FAE4CA58136B664BE35BCBF9FD2C78C2CABD6C1231` |
| Version embarquée | ✅ `1.0.14` | `VersionInfo.FileVersion` = `1.0.14` (exe ET `win-unpacked\Light Maestro.exe`) |

**Fraîcheur vs installateur (LastWriteTime, pas la date affichée) :**

| Fichier | LastWriteTime | Taille |
|---|---|---|
| `Light Maestro 1.0.14.exe` (portable) | **2026-08-23 22:56:12** | 82 757 348 |
| `Light Maestro Setup 1.0.14.exe` (installateur, build 20/08) | 2026-08-20 23:24:08 | 97 390 064 |

→ Le portable est **plus récent de ~3 jours** que l'installateur. ✅

---

## 2. Améliorations présentes dans le build décompressé — ✅ OK

`asar: false` confirmé (config `build.asar: false` + **absence de `app.asar`** : le code est en clair sous `release\win-unpacked\resources\app\`).

Bundle renderer : `release\win-unpacked\resources\app\dist\renderer\assets\index-B3rZKDeD.js` (1 639 847 octets, minifié → 1 ligne).

| Marqueur | Occurrences | Contexte confirmé |
|---|---|---|
| `b-gobo` | 1 | `{id:"b-gobo",attribute:"gobo",values:{gobo:128},interpolate:!1}` |
| `b-prism` | 1 | `{id:"b-prism",attribute:"prism",values:{prism:128},...}` |
| `b-zoom-wide` | 1 | `{id:"b-zoom-wide",attribute:"zoom",values:{zoom:0},rampBeats:2}` (+ `b-zoom-tight` voisin) |
| `b-frost` | 1 | `{id:"b-frost",attribute:"frost",values:{frost:255},rampBeats:2}` (+ `b-iris`, `b-focus` voisins) |
| `amber` | 79 | regex de détection : `Hk=/\b(amber|ambre|a|naranja)\b/i` |
| `ultraviolet` | 3 | regex de détection : `Wk=/\b(uv|ultraviolet|ultra\s*violet)\b/i` |
| `c-white` | 1 | `{id:"c-white",attribute:"color",values:{red:255,green:255,blue:255,white:255}}` |

→ Les 7 marqueurs sont présents **dans le bundle réel du build décompressé**, avec le code fonctionnel associé (pas des faux positifs). ✅

---

## 3. Dépendances natives embarquées — ✅ OK (toutes présentes ET référencées)

Binaires `.node` natifs trouvés sous `release\win-unpacked\resources\app\node_modules\` :

| Dépendance | Binaire | Taille | Requis par (main process) |
|---|---|---|---|
| `better-sqlite3` | `better-sqlite3\build\Release\better_sqlite3.node` | 1 913 344 o | `dist\electron\show\storage.js` ✅ |
| `midi` | `midi\build\Release\midi.node` (+ `bin\win32-x64-123\midi.node`) | 334 336 o | `dist\electron\midi\manager.js` ✅ |
| `@serialport` | `@serialport\bindings-cpp\bin\win32-x64-123\bindings-cpp.node` (+ prebuilds) | 237 056 o | `dist\electron\main.js` + `dmx\usb-output.js` ✅ |
| `ftdi-d2xx` (bonus) | `ftdi-d2xx\build\Release\ftdi-d2xx.Windows.AMD64.node` | 93 696 o | — (non grepé) |

→ Aucune dépendance native manquante. SQLite, MIDI et sortie DMX série ont leurs binaires Win x64. ✅

---

## 4. Risques packaging — ⚠️ 2 avertissements non bloquants

1. **`author` manquant dans `package.json`** — electron-builder émet un warning. **Non bloquant** pour `--win portable` (l'exe a été produit, exit 0 d'après le plan). Impact futur : publish GitHub / mainteneur Linux `.deb`. → *À corriger un jour, pas bloquant.*
2. **`latest.yml` incohérent** — `release\latest.yml` est **obsolète** : `version: 1.0.0`, référence `Light-Maestro-Setup-1.0.0.exe` (97 197 141 o) daté `2026-08-18`. Ne correspond ni à la version 1.0.14 ni aux artefacts actuels. **Non bloquant pour le lancement du portable** (electron-updater ne peut pas auto-updater un exe portable NSIS), mais à signaler pour la propreté du dossier `release`.

**`builder-debug.yml`** : présent (6 235 o, régénéré à 22:56:12). C'est le dump de debug NSIS de electron-builder — **bénin**, pas un indicateur d'échec. Contient bien les macros `PORTABLE_EXECUTABLE_DIR/FILE/APP_FILENAME`, cohérent avec la cible portable.

**`asar: false`** : intentionnel (config), confirmé par l'absence de `app.asar` — le code est chargé depuis `resources\app\` (package.json `main: dist/electron/main.js` ✅ présent). Pas un risque.

---

## Limite méthodologique (honnêteté)

- Je ne peux **pas lancer l'IHM Electron** (contrainte AGENTS.md) → pas de smoke-test GUI.
- L'exe portable est un auto-extracteur NSIS **compressé (LZMA)** : les chaînes (`b-gobo`, etc.) n'apparaissent **pas** en clair dans le binaire (vérifié par scan brut → 0 occurrence, attendu). La preuve que l'exe embarque le bon code repose sur : (a) ordre de build electron-builder (`win-unpacked` régénéré à **22:53:58**, exe produit à **22:56:12**), (b) marqueurs vérifiés dans ce `win-unpacked`, (c) SHA256 identique au plan de build, (d) taille cohérente (82,7 Mo compressés ≈ 347,8 Mo non compressés du `win-unpacked`). → Preuve forte mais indirecte ; le test GUI final reste recommandé à l'utilisateur.

---

## Récapitulatif

| # | Contrôle | Verdict |
|---|---|---|
| 1 | Exe valide (PE/MZ, ~79 Mo, plus récent que Setup) | ✅ OK |
| 2 | Améliorations dans le build décompressé (7/7 marqueurs) | ✅ OK |
| 3 | Dépendances natives (better-sqlite3, midi, @serialport) | ✅ OK |
| 4 | Risques packaging | ⚠️ 2 non bloquants (author manquant, latest.yml obsolète) |

`VERDICT_EXE: RESERVES`
