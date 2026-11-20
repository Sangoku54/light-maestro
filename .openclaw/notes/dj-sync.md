# Synchronisation avec un logiciel DJ (Lot 1 — MIDI Clock)

Objectif : allowir à un logiciel DJ tiers (Traktor, rekordbox, VirtualDJ,
Mixxx, Serato/Engine DJ, Ableton Live…) dePiloter le tempo **et la phase**
du rig Light Maestro, pour que les lumières tombent sur le beat.

## Ce qui est livré (Lot 1 — commit `232d6a1`)

| Brique | Fichier | Rôle |
|---|---|---|
| Parse MIDI Clock + **phase** | `electron/midi/manager.ts` | 24 pulses `0xF8` = 1 noire → phase 0..1 dans la noire ; reset sur START/CONTINUE/STOP |
| Forward IPC | `electron/main.ts`, `electron/preload.ts` | `midi:clock` = `{ bpm, running, phase }` |
| Horloge maître | `src/stores/clockStore.ts` | compteur CONTINU de temps (`totalBeats`) + recalage de phase + multiplicateur ½/×1/×2 |
| Branchement renderer | `src/hooks/midi-trigger.ts` | `clockFromMidiClock(bpm, running, phase)` |
| Chaser **verrouillé** | `src/engine/midi-actions.ts` | steps quantifiés en temps, démarrage sur une frontière de temps |
| Autoloop ancré | `src/hooks/use-autoloop-engine.ts` | bars/beats sur l'horloge maître (temps mural en repli si l'horloge est en pause) |
| UI | `src/components/MasterClockBar.tsx` | source réelle, tempo effectif, ½/×1/×2, LED de temps, badge « verrouillé / pause DJ » |

## Modèle de phase (le cœur du Lot 1)

1. Le **main** compte les pulses `0xF8` depuis le dernier START/CONTINUE.
   Pulse n°1 = phase 0, pulse n°24 = phase 23/24. Émission throttlée à 4 Hz.
2. Le **renderer** aligne son compteur continu `totalBeats` sur la phase
   reçue, avec une correction **minimale** (± 1/2 temps) : le comptage des
   temps et des mesures ne saute jamais.
3. Le chaser **verrouillé** (uniquement quand `source ∈ {midi, link}` ET
   `externalRunning`) quantifie chaque step en temps :
   une durée authoring de 2000 ms (= 4 temps à 120 BPM) devient 4 temps
   au tempo reçu (1875 ms à 128 BPM), et le step démarre sur la prochaine
   frontière de temps.
4. **Sans horloge externe**, le moteur historique (timers par chaser) est
   strictement inchangé : aucun comportement existant n'est modifié.

## Deux bugs corrigés au passage

- **Le bouton Link tuait la sync MIDI.** `clockFromMidiClock` faisait
  `if (s.linkEnabled) return;` alors qu'aucun moteur Link n'existe
  (`window.lightMaestro.link` absent du preload) → cliquer « Link »
  silencieusement le MIDI Clock. Corrigé : `linkActive` (un moteur Link qui
  tourne réellement) est le seul cas qui prend la priorité, et le bouton
  Link est désactivé + explicite (« indisponible »).
- **La pause du DJ figeait le show.** `clockFromMidiClock` forçait
  `isPlaying = running` → `STOP` MIDI arrêtait l'horloge interne et les
  lumières restaient figées au milieu d'un fondu. Corrigé : le transport
  externe (`externalRunning`) est séparé de l'horloge interne (`isPlaying`).

## Multiplicateur de tempo

`tempo effectif = base × multiplicateur` (½ / ×1 / ×2), comme le partage de
tempo de DMXDesktop. Le tempo **base** reste borné à 20..300, le tempo
**effectif** à 10..600 : sinon ×2 sur 174 BPM serait tronqué à 300 et le rig
ne tournerait pas au double du tempo du DJ.

## Compatibilité (état vérifié)

| Logiciel | MIDI Clock | Sync possible |
|---|---|---|
| Traktor | oui (instable/jittery) | oui |
| VirtualDJ | oui | oui |
| Mixxx | oui | oui |
| Ableton Live / FL / Bitwig | oui | oui |
| rekordbox | **non** (ni MIDI Clock ni OSC documenté) | **non — Lot 2 requis** |
| Serato / Engine DJ | **non** | **non — Lot 2 requis** |

→ Pour rekordbox et Serato, la voie prévue est la **capture audio live**
(Lot 2 : tracking de beat sur le flux capturé) ou une intégration OSC dédiée.

## Tests

`src/__tests__/master-clock-sync.test.ts` (23 tests) : phase externe,
correction minimale (pas de saut de mesure), multiplicateur (dont ×2 non
tronqué), régression du bouton Link, phase du `MidiManager` (0xF8 × 24),
quantification des steps, bascule libre → verrouillé (pas de double moteur),
ancrage de l'autoloop.

Commande : `npm run check` (tsc ×3 + vitest).
