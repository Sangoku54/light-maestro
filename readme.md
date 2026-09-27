# Light Maestro

> Professional DMX control with audio-reactive automation, in one lighting software.

**3 modes. 1 tool. Infinite possibilities.**

- 🎧 **Quick Show** — DJ mode: lights that follow the music automatically
- 🔧 **Design** — Full editor: scenes, chasers, cue lists, RGB matrix, EFX
- 🎭 **Perform** — Virtual Console: custom control surface for live shows

## What it does

Light Maestro combines a professional DMX engine (multi-universe, ArtNet, sACN, fixtures,
Virtual Console, RGB Matrix, EFX) with audio intelligence (AutoScript, beat detection, stem
analysis, track section detection).

**Result:** A lighting software that can handle everything from a simple DJ set to a full theater production.

## Features

### DMX Engine
- Unlimited DMX universes
- USB DMX (Enttec, DMXKing), ArtNet, sACN (E1.31)
- HTP/LTP merging
- Blackout & grand master

### Audio Intelligence (AutoScript)
- Real-time beat detection with adaptive BPM
- Frequency band analysis (low/mid/high)
- Track section detection (intro → verse → chorus → drop → outro)
- 8 built-in audio-reactive effects
- Color Wave, Strobe Blast, Chase Sequence, Dimmer Pulse, Pan Sweep, Build Up, Breakdown, Peak Drop

### Fixture System
- 1500+ fixtures (QLC+ compatible)
- Import .qxf files directly
- Multi-mode fixtures with heads support
- Channel types: Intensity, Pan, Tilt, Colour, Gobo, Shutter, Speed, Prism, etc.

### Show Programming
- Scenes with fade in/out timing
- Chasers (loop, single, pingpong) with tap tempo
- Cue lists (theater-style) with GO/BACK
- RGB Matrix (solid, line, circle, diamond, square, triangle, audio-reactive)
- EFX engine (circle, line, eight, square, triangle patterns)

### Live Performance
- Customizable Virtual Console
- Widgets: buttons, sliders, XY pad, speed dials, cue lists
- MIDI mapping with learn mode
- MIDI feedback (LED) to controllers

## Tech Stack

| Layer | Tech |
|-------|------|
| Desktop | Electron 30 |
| UI | React 18 + TypeScript |
| State | Zustand |
| Styling | Tailwind CSS |
| DMX | artnet, dmxnet, sacn |
| Audio | Web Audio API |
| MIDI | node-midi |
| Fixtures | QLC+ QXF format |

## Quick Start

```bash
git clone <repo>
cd light-maestro
npm install
npm run dev
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design document.

## License

TBD
