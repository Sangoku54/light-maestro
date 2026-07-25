# Light Maestro — Architecture & Design Document

## Vision

**Light Maestro** fusionne la puissance technique de **QLC+** (moteur DMX, Virtual Console, RGB Matrix, EFX) avec l'intelligence audio de **SoundSwitch** (AutoScript, beat detection, stem analysis, DJ integration) dans une interface moderne et cohérente.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Shell                        │
│  ┌──────────────────────┐  ┌──────────────────────────┐ │
│  │   Main Process       │  │   Renderer Process        │ │
│  │                      │  │                          │ │
│  │  ┌────────────────┐  │  │  ┌────────────────────┐  │ │
│  │  │  DMX Engine     │◄─┼──┤  React + Zustand    │  │ │
│  │  │  • USB/ArtNet   │  │  │  • 3 modes UI        │  │ │
│  │  │  • sACN         │  │  │  • Virtual Console   │  │ │
│  │  │  • Merging      │  │  │  • Scene/Chaser ed.  │  │ │
│  │  └────────────────┘  │  │  └────────────────────┘  │ │
│  │                      │  │                          │ │
│  │  ┌────────────────┐  │  │  ┌────────────────────┐  │ │
│  │  │  Fixture Lib   │  │  │  │  Web Audio API      │  │ │
│  │  │  • QLC+ compat  │  │  │  │  • FFT analysis     │  │ │
│  │  │  • 1500+ fixtures│  │  │  │  • Stem detection   │  │ │
│  │  └────────────────┘  │  │  │  • Beat tracking     │  │ │
│  │                      │  │  └────────────────────┘  │ │
│  │  ┌────────────────┐  │  │                          │ │
│  │  │  Scene Engine   │  │  │  ┌────────────────────┐  │ │
│  │  │  • Chasers      │  │  │  │  Zustand Stores     │  │ │
│  │  │  • Cue Lists    │  │  │  │  • DMX State         │  │ │
│  │  │  • RGB Matrix   │  │  │  │  • Show State        │  │ │
│  │  │  • EFX          │  │  │  │  • Fixture State     │  │ │
│  │  └────────────────┘  │  │  │  • Audio State        │  │ │
│  │                      │  │  └────────────────────┘  │ │
│  │  ┌────────────────┐  │  │                          │ │
│  │  │  AutoScript     │  │  │                          │ │
│  │  │  • Beat sync    │  │  │                          │ │
│  │  │  • Section det. │  │  │                          │ │
│  │  │  • 8 effects     │  │  │                          │ │
│  │  └────────────────┘  │  │                          │ │
│  └──────────────────────┘  └──────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## Ce qui vient de QLC+

| Composant | Description | Fichier |
|-----------|-------------|---------|
| **DMX Engine** | Sortie DMX multi-univers (USB, ArtNet, sACN), merge HTP/LTP, blackout, grand master | `electron/dmx/engine.ts` |
| **Fixture System** | Bibliothèque 1500+ fixtures compatible QLC+, import QXF, éditeur de canaux | `electron/fixtures/library.ts` |
| **Scene/Chaser/Cue** | Scènes, chasers (loop, pingpong, random), cue lists théâtre-style, tap tempo | `electron/show/engine.ts` |
| **RGB Matrix** | Effets matriciels (line, circle, diamond, square, triangle, audio-reactive) | Dans `electron/show/engine.ts` |
| **EFX Engine** | Effets paramétriques pour têtes mobiles (cercle, ligne, huit, carré, triangle) | Dans `electron/show/engine.ts` |
| **Virtual Console** | Surface de contrôle customisable (boutons, sliders, XY pad, speed dials) | `src/views/PerformanceView.tsx` |
| **MIDI Mapping** | Mapping MIDI → DMX/Virtual Console, MIDI Learn, feedback LED | `electron/midi/manager.ts` |

## Ce qui vient de SoundSwitch

| Composant | Description | Fichier |
|-----------|-------------|---------|
| **AutoScript Engine** | Génération auto de lightshows à partir de l'audio | `electron/show/autoscript.ts` |
| **Beat Detection** | Detection de beats via onset detection + BPM estimation adaptative | `electron/audio/analyzer.ts` |
| **Stem Analysis** | Séparation drums/vocals/harmonics dans le domaine fréquentiel | `electron/audio/analyzer.ts` |
| **Section Detection** | Détection intro/verse/chorus/drop/outro | `electron/audio/analyzer.ts` |
| **Audio-Reactive Effects** | 8 effets intégrés réactifs à l'audio (Color Wave, Strobe, Chase, etc.) | `electron/show/autoscript.ts` |
| **3 Modes UI** | Quick Show (DJ) / Design (Technicien) / Perform (Live) | `src/App.tsx` |
| **Color Palettes** | Palettes audio-réactives + préréglages warm/cool/party | `src/views/QuickShowView.tsx` |

---

## Les 3 Modes

### 🎧 Quick Show (SoundSwitch-like)
- Interface minimale pour DJs
- AutoScript engine : les lumières suivent la musique
- Contrôles : intensité, palette, mouvement, beat division
- Section detection automatique
- Safety : limite de strobe, blackout rapide

### 🔧 Design (QLC+ Editor)
- Éditeur complet de scènes, chasers, cue lists
- RGB Matrix avec preview en temps réel
- EFX paramétrique pour têtes mobiles
- Bibliothèque de fixtures QLC+ compatible
- Import QXF directement

### 🎭 Perform (Virtual Console)
- Virtual Console personnalisable par drag & drop
- Widgets : boutons, sliders, XY pad, speed dials
- Cue list style théâtre avec GO/BACK
- MIDI mapping avec learn mode
- Feedback LED sur contrôleurs MIDI

---

## Format de fichier Show (.lmshow)

Format JSON ouvert et lisible :

```json
{
  "id": "uuid",
  "name": "Mon Show",
  "version": "1.0.0",
  "universes": [{ "id": "u1", "type": "artnet", "artnetUniverse": 0 }],
  "fixtures": [{ "definitionId": "chauvet-slimpar56", "startAddress": 1 }],
  "scenes": [{ "id": "scene1", "channels": { "0.1": 255, "0.2": 0 } }],
  "chasers": [{ "steps": [{ "sceneId": "scene1", "duration": 1000 }] }],
  "cueLists": [{ "cues": [{ "sceneId": "scene1", "trigger": "manual" }] }],
  "virtualConsole": [{ "name": "Main", "widgets": [...] }],
  "autoscriptConfig": { "enabled": true, "colorScheme": "auto" }
}
```

---

## Stack technique

| Layer | Technologie |
|-------|-------------|
| Runtime | Electron 30+ |
| UI | React 18 + TypeScript |
| State | Zustand (persist) |
| Styling | Tailwind CSS + custom theme |
| Icons | Lucide React |
| DMX | artnet, dmxnet, sacn, enttec-open-dmx-usb |
| Audio | Web Audio API (renderer) + node-audio-analyzer (main) |
| MIDI | midi (node-midi bindings) |
| Storage | JSON files + SQLite (indexing) |
| Fixtures | QLC+ QXF XML format compatible |

---

## Installation & Développement

```bash
cd light-maestro
npm install
npm run dev        # Démarre Vite + Electron en dev
npm run build      # Build production
npm run dist       # Package installateur
```

---

## Roadmap

### v1.0 — Core
- [x] DMX Engine multi-univers
- [x] Fixture library QLC+ compatible
- [x] AutoScript engine (8 effets)
- [x] Beat/Stem/Section detection
- [x] Scene/Chaser/Cue editor
- [x] RGB Matrix preview
- [x] Virtual Console basique
- [x] MIDI mapping & learn

### v1.1 — Integrations
- [ ] Serato DJ / VirtualDJ integration
- [ ] Ableton Link sync
- [ ] Philips HUE support
- [ ] OSC control

### v1.2 — Advanced
- [ ] 3D Stage Preview (WebGL)
- [ ] Timeline-based show editor
- [ ] Fixture editor (create/edit QXF)
- [ ] ArtNet input (merge external consoles)
- [ ] Web remote control (QLC+ style)

### v2.0 — Pro
- [ ] Video mapping / pixel mapping
- [ ] LUA/Python scripting engine
- [ ] Multi-user networked shows
- [ ] Cloud fixture library sync
