# Subagent B — Traçage du mouvement pan/tilt (section « loop »)

## Verdict

**Le mouvement est-il perceptible ? → OUI.**

Pour la section `loop`, l'amplitude de mouvement est **non nulle** (64), le pan/tilt
**varie réellement** d'un cue au suivant, et le multiplicateur de tier ne descend
**jamais à 0**. Aucun bug de mouvement (amplitude nulle / section non reconnue /
multiplier à 0) n'est présent dans le chemin `generateThemeLoop()` → `computeDmxCues()`.

---

## 1. Ce que produit `generateThemeLoop()`

64 cues (16 mesures × 4 temps), BPM 120 → 1 cue toutes les 0,5 s.
Chaque cue porte :

| Champ | Valeur |
|---|---|
| `time` | 0, 0.5, 1.0, 1.5, … 31.5 s (pas de 0,5 s) |
| `section` | `'loop'` |
| `movement` | `'sweep'` \| `'wave'` \| `'pulse'` \| `'circle'` (selon le thème) |
| `movementAmplitude` | **64** |
| `movementSpeed` | **0.5** |

## 2. `getMovementConfig('loop', <mv>, 64, 0.5)`

Comme `cue.movement` est fourni et présent dans `MOVEMENT_BY_TYPE`, la branche
« type preset » est prise (pas le fallback `SECTION_MOVEMENT` qui n'a pas de clé
`loop`). Résultat effectif :

```js
{ pattern: <mv>, centerX: 128, centerY: 128,
  amplitude: 64,           // ← movAmplitude (64), NON nul
  speed: 0.5,              // ← movSpeed (0.5)
  phaseOffset: selon type (sweep 0.15, wave 0.15, circle 0.1, pulse 0.05) }
```

**Amplitude = 64 → pan/tilt balayent bien 64..192 (centre 128 ± 64).** ✓

## 3. `computeMovement()` — valeurs concrètes (1 fixture, fi=0, totalFixtures=1)

`basePhase = time × 0.5 × 2π = time × π` (période 2 s). Par cue, la phase
avance de π/2 (0,5 s). Valeurs DMX exactes (arrondies) :

| Mouvement | pattern réel | pan min/max | tilt min/max | Séquence 8 premiers cues (pan / tilt) |
|---|---|---|---|---|
| `sweep` | sweep | **64 .. 192** | 128 (constant) | pan 128,192,128,64,128,192,128,64 · tilt 128 |
| `wave` | wave | 128 (constant) | **64 .. 192** | pan 128 · tilt 128,192,128,64,128,192,128,64 |
| `pulse` | bounce (`abs(sin)*2-1`) | **64 .. 192** | 128 (constant) | pan 64,192,64,192,64,192,64,192 · tilt 128 |
| `circle` | circle | **64 .. 192** | **64 .. 192** | pan 128,192,128,64… · tilt 192,128,64,128… |

→ Le pan **et/ou** le tilt change à chaque cue de ±64 (sweep/wave/circle) ou
alterne 64↔192 (pulse). **Le beam bouge, ce n'est pas statique.** Le mouvement
est « par paliers » (1 frame toutes les 500 ms, 4 positions par cycle de 2 s),
donc saccadé, mais clairement visible.

Multi-fixtures : `fixturePhase = fi × phaseOffset × 2π` décale la phase par bras
(vague), mais n'annule jamais le mouvement.

## 4. `getTierMovementMultiplier(pf.tier)`

| Tier | Multiplier | Amplitude effective | plage pan (centre 128) |
|---|---|---|---|
| primary | 1.0 | 64 | 64 .. 192 |
| secondary | 0.8 | 51.2 | ≈ 77 .. 179 |
| tertiary | 0.5 | 32 | 96 .. 160 |
| other | 0.4 | 25.6 | ≈ 102 .. 154 |
| (défaut) | 1.0 | 64 | 64 .. 192 |

**Aucun multiplicateur n'est nul.** Le minimum (0.4 pour `other`) laisse encore
~52 unités DMX de débattement → mouvement toujours perceptible.

## 5. Vérification de la détection des canaux pan/tilt

`fixture-analyzer.ts` (`analyzeFixtureChannels`) remplit correctement pour une
moving head : `panOffset`, `tiltOffset`, `panOffsets[]`, `tiltOffsets[]`,
`panFineOffset`/`tiltFineOffset` (canaux `fine` exclus des tableaux, conservés en
fine). `computeDmxCues()` écrit le pan sur tous les `panOffsets` et le tilt sur
tous les `tiltOffsets`. Multi-pan/tilt exploité. ✓

## 6. Bugs de mouvement trouvés

**Aucun.** Les trois hypothèses de bug sont écartées :

- ❌ Amplitude nulle → **FAUX** : amplitude = 64 (non nulle).
- ❌ Section `loop` non reconnue → **FAUX** : passée par `cue.movement` →
  `MOVEMENT_BY_TYPE`, pas par `SECTION_MOVEMENT` (qui, lui, n'a pas `loop`).
- ❌ Multiplier à 0 → **FAUX** : min = 0.4 (`other`), jamais 0.

## 7. Note (hors périmètre mouvement, à signaler au main agent)

Le symptôme « toujours la même chose / même couleur » n'est **pas** expliqué par
le chemin mouvement. Si les beams paraissent statiques, la cause est ailleurs
(couleur figée, path de lecture, arbiter `vc`/`quickshow`, ou interpolation). Le
mouvement pan/tilt, lui, est produit et varie de 64 à 192 sur tous les thèmes.

B_DONE
