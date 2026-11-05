# Audit : Mock USB DMX + Framework E2E pour Light Maestro

**Date :** 2026-08-15  
**Auteur :** Subagent « Audit fake USB + E2E »  
**Portée :** Évaluation de faisabilité d'un mock USB DMX pour tests end-to-end

---

## 1. État actuel de l'architecture USB

### 1.1 Flux de données complet

```
Renderer (React)
  → IPC (ipcMain.handle 'dmx:*')
    → DMXEngine (engine.ts)
      → SharedArrayBuffer (canaux DMX, zero-copy)
        → Worker thread (worker.ts) — timing 30 fps, drift-free
          → postMessage('frameSent') → engine.handleFrameSent()
            → sendUsbFrame() → child.stdin.write(binary frame)
              → usb-output.js (processus enfant Node.js)
                → SerialPort.write() → USB DMX dongle
```

### 1.2 usb-output.js — Le child process USB

- **Fichier :** `electron/dmx/usb-output.js` (CommonJS, plain Node.js)
- **Rôle :** Processus enfant isolé (spawn via `child_process.spawn` avec `ELECTRON_RUN_AS_NODE=1`)
- **Pourquoi un child process :** Évite les crashes V8 HandleScope de `serialport` dans les worker threads Electron
- **Librairie :** `serialport@13.0.0` (`const { SerialPort } = require('serialport')`)
- **Configuration série :** 250000 baud, 8 data bits, 2 stop bits, parity none (standard DMX-512)
- **Protocole stdin (binaire) :**
  - `0x00` + portId + nameLen + name → open port
  - `0x01` + portId + 513 bytes → send DMX frame
  - `0x02` + portId → close port
  - `0xFF` → shutdown
- **Protocole stdout (JSON lines) :**
  - `{"type":"ready","portId":0,"port":"COM6"}`
  - `{"type":"frame","portId":0}`
  - `{"type":"error","portId":0,"message":"..."}`
  - `{"type":"disconnected","portId":0,"message":"..."}` → exit code 3
- **DMX BREAK/MAB :** Utilise `port.set({brk:true/false})` pour générer le break et le MAB avant chaque frame
- **Gestion robuste :** Détection de débranchement (unplug), retry automatique, RTS HIGH pour transceiver RS-485

### 1.3 worker.ts — Le thread de timing

- **Fichier :** `electron/dmx/worker.ts` (TypeScript, compilé vers `dist/electron/worker.js`)
- **Rôle :** Thread dédié au timing précis (30 fps par défaut, drift-free via `process.hrtime.bigint()`)
- **Communication :** `parentPort.on('message')` pour init/start/stop/addUniverse/removeUniverse
- **IMPORTANT :** Le worker **n'écrit PAS sur l'USB**. Il lit le SharedArrayBuffer et notifie le main process via `postMessage('frameSent')`. C'est `engine.ts` qui dispatch vers les outputs.
- **Pas de dépendance native :** Le worker ne require ni serialport, ni artnet, ni sacn — il gère uniquement le timing

### 1.4 engine.ts — L'orchestrateur

- **Fichier :** `electron/dmx/engine.ts` (TypeScript, ~600 lignes)
- **Classe :** `DMXEngine extends EventEmitter`
- **Responsabilités :**
  - Gère le SharedArrayBuffer (16 universes × 512 canaux)
  - Spawn le worker thread (`new Worker(workerPath)`)
  - Spawn les child processes USB (`child_process.spawn(process.execPath, [scriptPath, portName])`)
  - Dispatch les frames à 30 fps vers USB/Art-Net/sACN
  - Retry automatique USB (fast phase 5s × 12, puis slow phase 30s)
  - Gestion blackout, grand master, HTP/LTP merge
- **IPC handlers exposés :** `dmx:start`, `dmx:stop`, `dmx:setChannel`, `dmx:setChannels`, `dmx:isRunning`, `dmx:blackout`, `dmx:restore`, `dmx:getStatus`, `dmx:addUniverse`, `dmx:syncUniverses`, `dmx:removeUniverse`, `dmx:listSerialPorts`, etc.

### 1.5 Tests actuels

- **Framework :** Vitest 4.x, environment `node`
- **8 fichiers de tests unitaires** dans `src/__tests__/` :
  - `chaser-track.test.ts`, `gencues.test.ts`, `latency-meter.test.ts`, `mtc-decode.test.ts`, `ofl-parse.test.ts`, `osc-decode.test.ts`, `output-arbiter.test.ts`, `playback-clock.test.ts`
- **Aucun test E2E** — pas de Playwright, pas de Spectron, pas de electron-playwright-helpers
- **Aucun test sur les fichiers `electron/dmx/*`** — couverture = 0 sur le moteur DMX

### 1.6 Dépendance notée

- `@serialport/binding-mock` est présent dans `node_modules/` (package transitiF de serialport@13) — fournit un `MockBinding` qui simule un port série en mémoire

---

## 2. Options de Mock USB DMX

### Option A : Mock SerialPort au niveau require/import

**Principe :** Remplacer `require('serialport')` dans `usb-output.js` par un mock qui simule le comportement d'un port série.

**Faisabilité technique :**

`usb-output.js` fait `const { SerialPort } = require('serialport')` au niveau module. On peut intercepter ce require de plusieurs façons :

1. **Module proxy** : Créer un fichier `serialport-mock.js` qui exporte une classe `SerialPort` simulée et l'injecter via `NODE_PATH` ou `require.cache`
2. **`@serialport/binding-mock`** : Le package est déjà dans node_modules. Il fournit `MockBinding.createPort(path, options)` et `SerialPort.binding = MockBinding`. Utilisation :
   ```js
   const { SerialPort } = require('serialport');
   const MockBinding = require('@serialport/binding-mock');
   MockBinding.createPort('COM_TEST', { echo: false, record: true });
   SerialPort.binding = MockBinding;
   ```
3. **Injection par variable d'environnement** : `usb-output.js` pourrait vérifier `process.env.DMX_MOCK=1` et charger le mock au lieu du vrai module

**Impact sur le code :**

- `usb-output.js` : Modification minimale (ajouter un check env var au début) ou zéro si on utilise le monkey-patching de `require.cache`
- `engine.ts` : Aucune modification si le child process charge le mock lui-même
- Le child process reste un processus séparé — le mock est isolé

**Ce qu'on peut tester :**

- Le protocole binaire stdin/stdout entre engine et usb-output
- La création de frames DMX (513 bytes : start code + 512 canaux)
- La séquence BREAK/MAB (les appels `port.set({brk:true/false})` sont enregistrés par le mock)
- La détection de débranchement (simuler une erreur sur le mock)
- Le retry automatique du moteur

**Limites :**

- Le mock `@serialport/binding-mock` ne simule pas le timing réel du break/MAB (les callbacks sont asynchrones mais instantanés)
- Pas de vérification que les bonnes valeurs DMX arrivent sur un vrai fil — on vérifie seulement ce qui est passé à `SerialPort.write()`

| Critère | Note |
|---------|------|
| **Complexité** | ⭐ Faible (2-3 jours) |
| **Fidélité** | ⭐⭐⭐ Moyenne (protocole binaire réel, mais timing simulé) |
| **ROI** | ⭐⭐⭐⭐⭐ Excellent — débloque tout le reste |
| **Modifications code** | Minimes (1 fichier, ~10 lignes) |
| **Maintenance** | Faible — le mock suit l'API serialport |

### Option B : Fake USB device (virtual COM port Windows)

**Principe :** Créer un port COM virtuel sur Windows qui se comporte comme un dongle DMX USB.

**Outils :**

- **com0com** : Créateur de ports COM virtuels pair-à-pair (gratuit, open source)
- **HUB4COM / com2tcp** : Permet de rediriger le trafic entre ports COM
- **Eltima Virtual Serial Port Driver** : Commercial, plus user-friendly

**Architecture :**

```
Light Maestro → COM6 (virtuel) ←→ COM7 (virtuel) ← programme de test (lecture/validate)
```

**Faisabilité technique :**

- com0com crée une paire de ports COM connectés : ce qui est écrit sur COM6 est lu sur COM7
- Le programme de test lit COM7 et valide les frames DMX reçues
- Aucune modification du code de Light Maestro — il voit un vrai port COM

**Problèmes :**

- **DMX BREAK/MAB :** Le protocole DMX utilise des signaux de break (ligne série basse pendant >88µs) qui ne sont PAS des données série standard. `usb-output.js` utilise `port.set({brk:true/false})` pour générer ces signaux. Un port COM virtuel **ne simule pas les signaux de break** — il les ignore ou les transforme en données. C'est un blocker pour la validation du timing DMX.
- **Installation :** com0com nécessite un driver Windows signé (problème de sécurité et de CI/CD)
- **Non portable :** Linux/macOS utiliseraient des solutions différentes (socat, tty0tty)
- **Lourd :** Chaque machine de dev et CI doit installer le driver

| Critère | Note |
|---------|------|
| **Complexité** | ⭐⭐⭐ Élevée (driver, setup, validation program) |
| **Fidélité** | ⭐⭐ Faible (pas de break/MAB, timing non réaliste) |
| **ROI** | ⭐ Faible — beaucoup d'effort pour un résultat partiel |
| **Modifications code** | Aucune |
| **Maintenance** | ⭐⭐⭐ Élevée — driver à maintenir, CI complexe |

### Option C : Injection de dépendances (output device en paramètre)

**Princème :** Refactorer `engine.ts` pour accepter une interface d'output abstraite, puis injecter un mock en tests.

**Interface proposée :**

```typescript
interface DMXOutputDevice {
  open(portName: string): Promise<void>;
  sendFrame(data: Uint8Array): void;
  close(): void;
  on(event: 'ready' | 'error' | 'disconnected', cb: Function): void;
}
```

**Refactor nécessaire :**

1. Extraire l'output USB de `engine.ts` dans une classe `UsbDmxOutput implements DMXOutputDevice`
2. Ajouter un paramètre `outputFactory?: (config: UniverseConfig) => DMXOutputDevice` au constructeur de `DMXEngine`
3. Par défaut, utiliser la vraie implémentation USB
4. En tests, injecter un `MockDmxOutput` qui enregistre les frames

**Impact sur le code :**

- `engine.ts` : Refactor significatif (~100 lignes modifiées) — extraction de la logique USB, modification du constructeur, ajustement des méthodes `startUsbOutput`, `sendUsbFrame`, `trySpawnUsbChild`
- `usb-output.js` : Peut rester tel quel (le child process reste l'implémentation de production)
- Nouveau fichier : `electron/dmx/mock-output.ts` (implémentation de mock)
- Risque : Le refactor touche du code critique en production

**Ce qu'on peut tester :**

- Toute la logique de `DMXEngine` : ajout/suppression d'univers, dispatch de frames, blackout, grand master, retry USB (simulation de déconnexion)
- Les valeurs DMX exactes envoyées à chaque frame
- Le timing de dispatch (30 fps)

| Critère | Note |
|---------|------|
| **Complexité** | ⭐⭐ Moyenne (refactor propre mais touchant du code critique) |
| **Fidélité** | ⭐⭐⭐⭐ Haute (teste la vraie logique du moteur) |
| **ROI** | ⭐⭐⭐ Bon — mais ne teste pas le child process ni le protocole binaire |
| **Modifications code** | Significatives (~100 lignes refactorées) |
| **Maintenance** | Faible — l'interface est stable |

---

## 3. Comparaison des options

| Critère | A : Mock SerialPort | B : Virtual COM | C : DI Refactor |
|---------|--------------------|--------------------|-----------------|
| **Complexité implé** | Faible (2-3j) | Élevée (5-7j) | Moyenne (3-4j) |
| **Fidélité** | Moyenne | Faible (pas de break) | Haute |
| **Couverture** | Engine + usb-output.js + IPC | Engine uniquement (via port COM) | Engine uniquement |
| **Modifications code** | Minimes | Nulles | Significatives |
| **Risque prod** | Nul | Nul | Moyen (refactor) |
| **Portabilité CI** | ✅ (pure JS) | ❌ (driver Windows) | ✅ (pure JS) |
| **Maintenance** | Faible | Élevée | Faible |
| **ROI global** | ⭐⭐⭐⭐⭐ | ⭐ | ⭐⭐⭐ |

---

## 4. Proposition de framework E2E

### 4.1 Choix : Playwright pour Electron

**Pourquoi Playwright ?**

- ** electron-playwright-helpers** : Bibliothèque officielle pour tester les apps Electron avec Playwright
- Supporte le lancement d'Electron, l'accès au main process via `electronApp.evaluate()`, et au renderer via `page`
- Vitest est déjà installé — Playwright s'intègre bien avec Vitest comme runner
- Spectron est deprecated (depuis Electron 19+)
- Playwright est maintenu activement et supporte Electron 30 (la version utilisée)

**Installation nécessaire :**

```bash
npm install -D @playwright/test electron-playwright-helpers
```

### 4.2 Scénarios E2E proposés

| # | Scénario | Description | Prérequis |
|---|---------|-------------|-----------|
| 1 | Démarrage | Lancer l'app, vérifier que la fenêtre s'ouvre | Mock USB |
| 2 | Ajout fixture | Ajouter une fixture, vérifier qu'elle apparaît | Mock USB |
| 3 | Lancement scène | Démarrer le moteur DMX, lancer une scène, vérifier les sorties | Mock USB |
| 4 | Blackout/Restore | Activer blackout, vérifier que les canaux = 0, restaurer | Mock USB |
| 5 | Grand Master | Appliquer un grand master à 50%, vérifier la scaling | Mock USB |
| 6 | USB débranchement | Simuler un débranchement, vérifier le retry | Mock USB |
| 7 | Multi-universes | Configurer 2 universes (1 USB + 1 Art-Net), vérifier le dispatch | Mock USB + Mock Art-Net |
| 8 | Sauvegarde config | Sauvegarder une config, relancer, vérifier la persistence | Mock USB |

### 4.3 Architecture de test proposée

```
tests/
  e2e/
    setup.ts          → Configuration Playwright + Electron + mock USB
    helpers/
      mock-usb.ts     → Mock SerialPort + helpers de validation de frames
      mock-artnet.ts  → Mock Art-Net (optionnel, pour scénarios multi-output)
    scenarios/
      01-startup.spec.ts
      02-fixture.spec.ts
      03-scene.spec.ts
      04-blackout.spec.ts
      05-grandmaster.spec.ts
      06-usb-disconnect.spec.ts
      07-multi-universe.spec.ts
      08-persistence.spec.ts
```

---

## 5. Plan d'implémentation

### Phase 1 : Mock USB (Option A) — Semaine 1

| Étape | Description | Estimation |
|-------|-------------|------------|
| 1.1 | Créer `electron/dmx/usb-output-mock.js` — wrapper qui remplace `require('serialport')` par un mock utilisant `@serialport/binding-mock` | 0.5 jour |
| 1.2 | Ajouter une variable d'environnement `DMX_MOCK=1` qui fait charger le mock au lieu du vrai usb-output.js dans `engine.ts` | 0.5 jour |
| 1.3 | Implémenter l'enregistrement des frames dans le mock (tableau de frames reçues, méthode `getFrames()`) | 0.5 jour |
| 1.4 | Implémenter la simulation de débranchement (méthode `simulateDisconnect()`) | 0.5 jour |
| 1.5 | Tests unitaires du mock lui-même (Vitest) | 0.5 jour |
| 1.6 | Tests d'intégration : engine.ts + mock USB (sans Electron) | 1 jour |

**Total Phase 1 : ~3.5 jours**

### Phase 2 : Framework E2E (Playwright) — Semaine 2

| Étape | Description | Estimation |
|-------|-------------|------------|
| 2.1 | Installer Playwright + electron-playwright-helpers | 0.5 jour |
| 2.2 | Créer `tests/e2e/setup.ts` (lancement Electron avec `DMX_MOCK=1`) | 0.5 jour |
| 2.3 | Scénario 1 : Démarrage + vérification fenêtre | 0.5 jour |
| 2.4 | Scénario 2-3 : Ajout fixture + lancement scène + validation frames | 1 jour |
| 2.5 | Scénario 4-5 : Blackout + Grand Master | 0.5 jour |
| 2.6 | Scénario 6 : Débranchement USB simulé | 0.5 jour |
| 2.7 | Scénario 7-8 : Multi-universes + persistence | 1 jour |
| 2.8 | Configuration CI (GitHub Actions) | 0.5 jour |

**Total Phase 2 : ~5 jours**

### Phase 3 (optionnelle) : Refactor DI (Option C) — Semaine 3

| Étape | Description | Estimation |
|-------|-------------|------------|
| 3.1 | Définir l'interface `DMXOutputDevice` | 0.5 jour |
| 3.2 | Extraire la logique USB de engine.ts dans `UsbDmxOutput` | 1.5 jours |
| 3.3 | Implémenter `MockDmxOutput` pour tests | 0.5 jour |
| 3.4 | Migrer les tests existants vers le mock DI | 0.5 jour |
| 3.5 | Tests de non-régression (comparaison avant/après) | 1 jour |

**Total Phase 3 : ~4 jours**

---

## 6. Recommandation finale

### ✅ Recommandation : Option A (Mock SerialPort) + Playwright E2E

**Justification :**

1. **ROI maximal** : L'Option A donne le meilleur rapport effort/couverture. Pour ~3.5 jours de travail, on débloque les tests E2E de toute l'application sans toucher au code critique.

2. **Risque minimal** : Aucune modification du code de production (ou presque — juste un check de variable d'environnement). Le mock est chargé uniquement en mode test.

3. **Couverture réelle** : Le mock intercepte `serialport` au niveau du child process, ce qui signifie qu'on teste le **vrai protocole binaire** entre engine.ts et usb-output.js, ainsi que la **vraie logique** de retry, de gestion d'erreur, et de dispatch de frames.

4. **`@serialport/binding-mock` déjà disponible** : Le package est déjà dans node_modules (dépendance transitive de serialport@13). L'API `MockBinding.createPort()` + `SerialPort.binding = MockBinding` est exactement ce qu'il faut.

5. **CI-ready** : Pas de driver à installer, pas de port COM virtuel, pas de hardware. Les tests tournent sur n'importe quelle plateforme.

6. **Option C en réserve** : Si le besoin se fait sentir (tests plus fins de la logique du moteur, sans le child process), le refactor DI peut être fait en Phase 3 sans casser les tests de Phase 1/2 — les deux approches sont complémentaires.

### ❌ Contre-indications

- **Option B (Virtual COM)** : Écartée. Trop lourde, pas portable, et le DMX BREAK/MAB n'est pas simulable correctement sur un port COM virtuel.
- **Option C seule (sans Option A)** : Insuffisante. Elle ne teste pas le child process ni le protocole binaire stdin/stdout, qui sont des points de failure majeurs.

### Architecture finale proposée

```
Production :
  engine.ts → spawn child → usb-output.js → require('serialport') → USB dongle

Tests (DMX_MOCK=1) :
  engine.ts → spawn child → usb-output.js → require('serialport-mock') → MockBinding
                                                        ↓
                                          enregistre les frames
                                                        ↓
                                          tests E2E (Playwright) valident
```

### Prochaine étape concrète

Créer `electron/dmx/usb-output-mock.js` qui :
1. Intercepte `require('serialport')` via `Module._resolveFilename` ou un simple check `process.env.DMX_MOCK`
2. Utilise `@serialport/binding-mock` pour créer un port virtuel
3. Enregistre chaque frame reçue dans un tableau accessible via `process.stdout` (JSON lines étendues)
4. Expose des commandes de contrôle (simuler déconnexion, etc.) via stdin

---

## 7. Annexes

### 7.1 Détails techniques du mock `@serialport/binding-mock`

```javascript
const { SerialPort } = require('serialport');
const MockBinding = require('@serialport/binding-mock');

// Créer un port virtuel
MockBinding.createPort('COM_MOCK', { echo: false, record: true });

// Brancher le mock sur SerialPort
SerialPort.binding = MockBinding;

// Le port se comporte comme un vrai port série
const port = new SerialPort({ path: 'COM_MOCK', baudRate: 250000, autoOpen: false });
port.open(() => { /* port ouvert */ });
port.write(buffer, () => { /* écrit */ });

// Lire ce qui a été écrit
const recordedData = MockBinding ports['COM_MOCK'].recording; // Buffer[]
```

### 7.2 Commandes de contrôle étendues (proposition)

Étendre le protocole stdin de usb-output-mock.js avec des commandes de test :

| Commande | Format | Effet |
|----------|--------|-------|
| `0x10` | `[0x10]` | Renvoyer toutes les frames enregistrées (JSON sur stdout) |
| `0x11` | `[0x11]` | Vider le buffer de frames |
| `0x12` | `[0x12] [port_id]` | Simuler un débranchement |
| `0x13` | `[0x13] [port_id]` | Simuler une erreur d'écriture |

### 7.3 Compatibilité Playwright + Electron

```typescript
import { test, expect, _electron as electron } from '@playwright/test';
import { parseElectronApp } from 'electron-playwright-helpers';

test('app launches', async () => {
  const appInfo = parseElectronApp('package.json');
  const electronApp = await electron.launch({
    args: [appInfo.main],
    env: { ...process.env, DMX_MOCK: '1' },
  });
  
  const window = await electronApp.firstWindow();
  await expect(window).toHaveTitle(/Light Maestro/);
  
  // Accès au main process pour vérifier le DMX
  const status = await electronApp.evaluate(({ app }) => {
    // @ts-ignore
    return app.dmxEngine.getStatus();
  });
  
  await electronApp.close();
});
```

---

**Fin du rapport.**
