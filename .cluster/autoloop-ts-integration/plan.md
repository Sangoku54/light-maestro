# Intégration Autoloop SoundSwitch 2.9 → Light Maestro (TypeScript)

## Hypothèse retenue (à défaut d'ambiguïté)

L'utilisateur a confirmé (« oui c'est ça ») vouloir **porter la sémantique de
l'Autoloop SoundSwitch 2.9 dans le moteur TypeScript de Light Maestro**, en
s'appuyant sur `src/engine/auto-loops.ts` existant.

Light Maestro a déjà une feature autoLoop (`generateAutoLoops` /
`auto-loop-player.ts`), mais il lui manque la sémantique SoundSwitch :
- matrice **4 banques × 32 = 128** autoloops ;
- modes de répétition **Infinite** / **Track Duration** ;
- **Autoloop Override** (joue sa durée puis rend la main au script) ;
- **quantisation sur barline** ;
- générateur **Autoscript** procédural (keyframes alignés sur les bars).

## Découpage en modules (fichiers livrés dans `src/engine/`)

| Module | Fichier TS | Auteur | Porte depuis (Python) |
|---|---|---|---|
| 1 — Types + maths | `autoloop-types.ts` | Mainline (contrat figé) | `models.py` |
| 2 — Générateur Autoscript | `autoscript-generator.ts` | Sub-agent | `generator.py` |
| 3 — Moteur de lecture | `autoloop-engine.ts` | Sub-agent | `playback.py` (+ `DmxOutput`) |
| 4 — Banques 4×32 | `autoloop-banks.ts` | Sub-agent | `banks.py` |
| 5 — Re-exports + adaptateur | `autoloop-index.ts` | Mainline (après) | — |
| 6 — Tests | `src/__tests__/autoloop-engine.test.ts` | Mainline (après) | `demo.py` |

Les modules 2/3/4 sont **purs** (aucun import React/Electron/`window`) et
importent leurs types depuis `./autoloop-types`. Testables en isolation (vitest,
environnement node). L'adaptateur (`autoloop-index.ts`) fait le pont vers
`dmxBridge` (source `'auto-loop'`, déjà enregistrée LTP 75 par
`auto-loop-player.ts`).

## Contrat figé (repris tel quel par les sub-agents)

Voir `src/engine/autoloop-types.ts` sur disque (la source de vérité). Résumé des
signatures :

- `clampDmx(v): number` = `Math.round(max(0, min(255, v)))`.
- `timelineLengthBeats(t)` = `t.bars * 4`.
- `computePan(cue, beat)` / `computeTilt(cue, beat)` : cercle = cos/sin ;
  figure_eight = Lissajous 1:2 (tilt à fréquence double).
- `generateAutoscript(input)` → `AutoloopTimeline` (clés = adresses DMX absolues
  en chaîne, triées par `beat`).
- `class BankManager` : `store/get/select/next/previous/lockBank/unlockAll/
  isSlotAllowed/onTrackLoaded/populate`, constantes `BANKS=4`, `PER_BANK=32`.
- `class AutoloopPlaybackEngine` : `load/trigger/stop/overrideWith/onBarBeat(bar,
  beat)`, `beatMs()/barsToMs()/quantizeDelayMs()`, état
  `idle|script|override_loop`, sortie via `DmxOutput.send(channels)`.

## Formules à commenter en français dans le code

1. Cercle paramétrique : `pan = center + r·cos(ωt+φ)`, `tilt = center + r·sin(ωt+φ)`.
2. Huit (Lissajous 1:2) : `tilt = center + r·sin(2ωt+φ)`.
3. `beatMs = 60000/BPM`, `barsToMs(n) = n·4·beatMs`, `quantizeDelayMs = (4−beat)·beatMs`.
4. Interpolation keyframes : `v = v0 + (v1−v0)·clamp((beat−b0)/rampBeats, 0, 1)` ;
   `rampBeats ≤ 0` → snap (on tient v0 jusqu'à b1).
5. Override/reprise : phase sauvée + durée override, reprise à `now − (savedPhase
   + overrideDuration)` (phase « comme si le script avait continué »).

## Dispatch (tour 1 — 4 sub-agents en parallèle)

1. **Générateur Autoscript** → écrit `src/engine/autoscript-generator.ts`.
2. **Banques 4×32** → écrit `src/engine/autoloop-banks.ts`.
3. **Moteur de lecture** → écrit `src/engine/autoloop-engine.ts`.
4. **Vérification contrat** → relit `autoloop-types.ts` + les 3 prototypes Python
   et vérifie la fidélité sémantique + cohérence de types ; écrit
   `subagent_04.md`.

## Revue (tour 2)

Après retour des modules + intégration mainline (index/adaptateur/tests), un
sub-agent de revue vérifie : cohérence des types entre modules, fidélité aux
formules Python, cas limites (matrice vide, override sans script, snap vs rampe).
Conclusions dans `review.md`.

## Validation finale (mainline)

- `npx vitest run src/__tests__/autoloop-engine.test.ts` (ou `npm test`).
- `npx tsc --noEmit -p tsconfig.json` sur l'ensemble.
