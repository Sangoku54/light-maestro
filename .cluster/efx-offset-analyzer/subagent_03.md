# Rapport 03 — Configuration matérielle minimale préconisée pour light-maestro

*Analyse d'exigences système — basée exclusivement sur le code réel du dépôt (v1.0.24). Aucun fichier projet modifié.*

---

## 1. Stack inventoriée (versions réelles, `package.json`)

| Composant | Version | Rôle |
|---|---|---|
| Electron | ^30.0.0 (Chromium ~124 / Node 20) | Shell applicatif, multi-fenêtres, IPC |
| React / react-dom | ^18.2.0 | UI (DesignView 325 Ko, QuickShowView 217 Ko, PerformanceView 199 Ko) |
| three | ^0.184.0 | Moteur 3D Stage3D (WebGLRenderer) |
| zustand | ^4.4 | Stores d'état (showStore, performStore) |
| Vite / TypeScript | ^5.0 / ^5.3 | Build |
| better-sqlite3 | ^12.0.0 | Indexation scènes/chasers des gros shows (`show/storage.ts`) |
| serialport / ftdi-d2xx / enttec-open-dmx-usb | ^13 / ^1.3 / ^4.0 | Sortie USB-DMX (dongles) |
| artnet ^1.4 / dmxnet ^0.9 / sacn ^4.6 | — | Art-Net / sACN réseau |
| midi ^2.0 | — | Mapping MIDI, MTC timecode |

Cibles de build : **Windows x64 (NSIS + portable)**, macOS dmg, Linux AppImage — `package.json` `build.win/macos/linux`.
Install déployée mesurée (`release/win-unpacked`) : **~348 Mo** (exe 169 Mo, resources 94 Mo dont bibliothèque fixtures 20,7 Mo / 2 370 fichiers).

## 2. Charges par sous-système et facteurs dimensionnants

### 2.1 Moteur DMX (main process) — charge CPU/IPC faible mais temps réel
- **`electron/dmx/engine.ts:59-61`** : `DMX_CHANNELS = 512`, `MAX_UNIVERSES = 16`, SAB = 16×512 = 8 192 octets (SharedArrayBuffer, zéro-copie).
- **`electron/dmx/engine.ts:62`** : `FRAME_RATE = 30` (worker `dmx/worker.ts` : `DEFAULT_FRAME_RATE = 30`, cadence via `process.hrtime`, ajustable `setFrameRate`).
- Sorties : 1 **processus enfant Node par univers USB** (`dmx/usb-output.js`, serialport 250 000 bauds), Art-Net et sACN dans le main, **réception sACN multicast + merge HTP** (`dmx/sacn-receiver.ts`).
- Côté renderer, **`src/hooks/dmx-playback.ts`** fait tourner un tick `requestAnimationFrame` (fréquence d'affichage, ~60 fps) qui **recalcule toutes les cues par frame** (strobe/color/dimmer/chaser/scenes/EFX, lignes 58-315) puis pousse via IPC → SAB.
- Bilan CPU : modeste (un worker + 30 fps de frames 512 octets), mais **sensible à la latence/charge du thread principal renderer** — un CPU à 2 cœurs à basse fréquence fera janker le tick rAF quand les vues lourdes sont affichées.
- Réseau : 16 univers à 30 fps ≈ 480 paquets/s ≈ 240 Ko/s en sACN — négligeable, mais **multicast + Wi-Fi = pertes** → Ethernet recommandé pour Art-Net/sACN.

### 2.2 Stage3D (renderer, WebGL/three) — **facteur dimensionnant GPU n°1**
- **`src/views/Stage3D.tsx:752-758`** : `new THREE.WebGLRenderer({ antialias: true })`, `setPixelRatio(min(devicePixelRatio, 2))`, `shadowMap PCFSoftShadowMap` activé, tone mapping ACESFilmic, + environment map PMREM `RoomEnvironment` (l.769) pour les matériaux métalliques.
- **Par fixture patchée** (l.420-735) : groupe multi-meshes `MeshStandardMaterial`, têtes avec `castShadow: true` (l.506, 649, 706), **1 `PointLight` dynamique par tête** (l.1307, intensité ×25 à l.1666/1728) + 1 par tête supplémentaire (l.1338), cône de faisceau, spot au sol + glow, traînée `Float32Array` de 80 points (`MAX_TRAIL_POINTS = 80`, l.52).
- **Multi pan/tilt** : `extraHeads[]` (l.689-713) — une fixture 6 bras (type Tonio) = **6+ têtes, 6+ PointLights, 6+ cônes** pour une seule fixture. Aucun cap sur le nombre de fixtures ni de lumières dans le code.
- Décor : 300 particules de fumée (l.~984), 4 fermes triangulaires + 4 colonnes, sprites musiciens.
- Boucle : rAF à la fréquence du moniteur + **polling DMX à 60 fps** (`DMX_POLL_INTERVAL = 1000/60`, l.51) → `updateDmxState()` parcourt toutes les fixtures par frame.
- **Aucun fallback WebGL** : `new WebGLRenderer` non protégé (pas de try/catch, pas de handler `webglcontextlost`) → **WebGL2 matériel requis**, un GPU/driver défaillant casse la vue 3D (pas de bascule Stage2D en mode performance ; Stage2DEditor n'existe que dans la sidebar Design).

### 2.3 Audio — **facteur dimensionnant RAM n°1** (chiffré par le code)
- L'audio est **embarqué en base64** dans les .lmpreset/.lmshow/.lmproj. Fichiers réels du dépôt : **51,7 à 59,6 Mo par chanson** (`baby.lmpreset` 51,7 Mo, `1on6.lmpreset` 55,7 Mo, `everybody.lmpreset` 59,6 Mo), shows 16,7–59 Mo, `yolo.lmproj` 72,5 Mo.
- Décodage renderer : `fetch(dataUrl)` → `arrayBuffer` → `AudioContext.decodeAudioData` (`useAudioFileLoader.tsx:47-80`, `audio-cache.ts:60-73`). L'AudioBuffer PCM Float32 pèse **durée × 44,1 kHz × canaux × 4 o** ≈ **0,35 Mo/s** → **~63 Mo pour 3 min stéréo** (c'est exactement ce que calcule `getAudioCacheStats`, `audio-cache.ts:81-85`).
- **Cache `_bufferCache` sans limite ni purge** (`audio-cache.ts:16`, Map module-level ; aucun `.delete`/LRU dans tout le code — vérifié) : chaque chanson préchargée reste en RAM toute la session.
- À cela s'ajoute la **chaîne base64 conservée dans les stores** (~55 Mo/chanson en RAM) + l'ArrayBuffer binaire transitoire pendant le décode (~41 Mo).
- **Le code le documente lui-même** (`src/utils/project-audio.ts:8-11,119`) : « 55 Mo par chanson ! », « le JSON.stringify du projet dépasse la taille max de string V8 (~536 Mo) → RangeError », et « le hachage de 8×55 Mo en parallèle pousserait le renderer à **~1 Go de RAM** ». Fix v2 : blobs externalisés dans `userData/audio-<hash>.json`, dédupliqués SHA-256 → **~55 Mo de disque par chanson unique**.
- Analyse audio (beat/onset/sections/stems) : FFT via Web Audio côté renderer, traitée ~60×/s dans `electron/audio/analyzer.ts` — CPU modéré mais récurrent.

### 2.4 Sauvegardes / sérialisation
- Save = `JSON.stringify(projet entier)` (`DesignView.tsx:6531`, `QuickShowView.tsx:927-953`, `App.tsx:150`) : **pics RAM ≈ 2-3× la taille du projet** (projet 72 Mo → pic >200 Mo). Les blobs audio sont externalisés AVANT stringify (v2), mais **les anciens projets v1 en clair restent limités à ~8 chansons** avant le RangeError V8.
- `better-sqlite3` pour l'indexation scènes/chasers des gros shows (`show/storage.ts`) — I/O disque aléatoires modestes.

### 2.5 Shell Electron / processus
- Fenêtre min **1024×700** (`main.ts:198-199`), pas de `disableHardwareAcceleration` → composition GPU obligatoire même sans 3D.
- Processus simultanés : main + GPU + renderer + worker DMX + 1 child USB par univers + splash → **5+ processus**, chacun avec son heap Node/V8.
- Services réseau embarqués : remote HTTP 0.0.0.0:8080 (`remote/server.ts`), OSC UDP 9000, réception sACN multicast.

## 3. Paliers de configuration

### 3.1 MINIMALE — « show DMX simple sans 3D » (1-2 univers USB/virtual, peu d'audio)
| Poste | Recommandation | Justification code |
|---|---|---|
| CPU | 2 cœurs / 4 threads x64 ≥ 2,0 GHz (i3-8100, Ryzen 3) | Worker DMX 30 fps + tick rAF + React sans Stage3D monté |
| RAM | **8 Go** | Electron ~1,2-1,5 Go au total ; 1 chanson décodée ≈ 150-200 Mo (base64 + PCM) |
| GPU | iGPU quelconque **WebGL2** (Intel UHD 620+) | Chromium compose en GPU de toute façon ; Stage3D non utilisé |
| Disque | SSD, **10 Go libres** | App 348 Mo + OS + userData (projets 0,7-72 Mo + blobs) |
| OS | Windows 10/11 x64 (builds testés NSIS/portable) | `package.json` build |
| Réseau | USB-DMX dongle ; Ethernet si Art-Net/sACN | `usb-output.js` 1 process/univers ; multicast sACN fragile en Wi-Fi |

### 3.2 RECOMMANDÉE — show complet (Stage3D + plusieurs univers + audio embarqué)
| Poste | Recommandation | Justification code |
|---|---|---|
| CPU | 4-6 cœurs ≥ 2,5 GHz (i5-10400, Ryzen 5 5600) | Tick rAF 60 fps (dmx-playback + Stage3D en parallèle) + décodage WebAudio + analyzer FFT 60 Hz |
| RAM | **16 Go** | Renderer 2-4 Go avec 5-10 chansons en cache non borné (63 Mo PCM + 55 Mo base64 chacune) + main + 3D + pics de save (project-audio.ts documente ~1 Go pour 8 blobs) |
| GPU | 2 Go VRAM min — GTX 1650 / Iris Xe / RX 6400 | PCFSoft shadows + 1 PointLight/tête + AA ×2 : ~20-30 fixtures multi-têtes tiennent ; au-delà, voir palier 3 |
| Disque | SSD **30-50 Go libres** | ~55 Mo/chanson en userData (dédup SHA-256) + app + projets |
| Écran | 1920×1080 | UI min 1024×700, TrackTimeline canvas large |

### 3.3 CONFORT SPECTACLE — grosses scènes (20+ fixtures multi pan/tilt, 10+ univers, fumée, double écran)
| Poste | Recommandation | Justification code |
|---|---|---|
| CPU | 8 cœurs ≥ 3 GHz | Somme des ticks rAF + IPC 60 fps + worker + N children USB |
| RAM | **32 Go** | Cache audio sans purge + pics de sérialisation |
| GPU | **4-8 Go VRAM dédiée** (RTX 3050+) | Nombre de lumières **non borné** (1 PointLight/tête, ex. 6 bras/fixture) → coût O(têtes) en forward rendering + ombres + AA |
| Disque | SSD NVMe 100 Go+ | Bibliothèque audio complète (55 Mo/titre) + projets + minidumps crashReporter |
| Réseau | Ethernet dédié Art-Net/sACN | 480 paquets/s multicast, latence critique |

## 4. Points de vigilance (issus du code, chiffrés)

1. **RAM audio = risque n°1** : 1 chanson ≈ 55 Mo (chaîne base64 en store) + ~41 Mo (ArrayBuffer transitoire) + **63 Mo de PCM par 3 min dans un cache jamais purgé** (`audio-cache.ts:16`, aucun LRU/delete dans le dépôt). 10 chansons préchargées ≈ **2 Go rien que pour l'audio du renderer**. Sous 16 Go, charger les chansons au fil du show.
2. **GPU 3D sans filet** : pas de cap sur fixtures/lumières dans Stage3D, pas de try/catch autour de `new WebGLRenderer` (l.752), pas de handler `webglcontextlost` → une GPU ou un driver WebGL2 insuffisant **casse la vue 3D sans message** ; un GPU 2 Go est le plancher, pas le luxe.
3. **Disque userData** : blobs externalisés ~55 Mo/chanson (`audio-<hash>.json`, dédupliqués) + projets 0,7-72 Mo + minidumps. Pas de purge automatique visible → prévoir la place, surveiller `userData`.
4. **Projets legacy v1** : audio en clair dans le JSON — au-delà de ~8 chansons, `JSON.stringify` dépasse la limite V8 (~536 Mo) → sauvegarde en RangeError (documenté `project-audio.ts:8-11` ; fixé en v2 par externalisation, mais un vieux projet volumineux fera un pic RAM à la conversion).
5. **Temps réel > raw power** : le moteur DMX est à 30 fps via worker/SAB, mais la fluidité perçue (pan/tilt 3D à 60 fps, fades) dépend du **thread renderer** — privilégier fréquence CPU et SSD (chargement blobs/projets, better-sqlite3) à un nombre de cœurs élevé.
6. **Réseau** : sortie Art-Net/sACN en Wi-Fi = frames perdues (multicast) ; Ethernet filaire pour le show, le remote LAN (port 8080) tolère le Wi-Fi.

**Réponse courte à la demande** : pour tourner « sans problème » dans l'usage réel du programme (Stage3D + audio + plusieurs univers), la configuration minimale préconisée est **16 Go RAM, 4-6 cœurs ≥ 2,5 GHz, GPU 2 Go compatible WebGL2, SSD 50 Go libres**. En dessous (8 Go, iGPU ancien), l'app fonctionne mais en usage dégradé : DMX sans la vue 3D et 2-3 chansons max chargées simultanément.
