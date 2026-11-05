# Livraison — Fix « Boucle unique joue toujours la même chose »

**Commit** : `7b83d1b` (3 fichiers, +18/−6)

## Réponse directe à ta question

> « es-tu sûr d'envoyer la bonne info aux fixtures ? »

**Oui.** La boucle envoie bien des valeurs DMX **différentes** à chaque cue
(RGB changent, pan/tilt bougent 64→192, univers correctement mappé 0-based
jusqu'au port). Le problème n'était **pas** dans l'écriture : c'était les
**couleurs elles-mêmes qui étaient quasi identiques**.

## Cause

Les 4 thèmes étaient des **rampes monochromatiques** :

| Thème | Écart de teinte | Perçu comme |
|-------|-----------------|-------------|
| Forest | 0–3° | « toujours du vert » (pire cas) |
| Violet | 12° (3/4 couleurs) | « violet, violet, violet, blanc » |
| Ocean | < 20° | dégradé de bleu |
| Ember | < 48° | dégradé chaud |

ΔE76 minimum entre deux couleurs d'un même thème : **10 à 36** (sous le seuil
de distinction nette). La boucle cyclait 4 couleurs quasi identiques sur 64
cues → « toujours la même chose » alors que tout le pipeline était correct.

## Correctif

1. **`src/engine/theme-loop.ts`** — 4 nouvelles palettes 100 % saturées, teintes
   bien séparées (ΔE76 min 79–116, soit ~3 à 10× plus de contraste) :
   - **Neon** `#ff0055 #00e5ff #7cff00 #8b00ff` (sweep)
   - **Rave** `#ff1a1a #1aff1a #1a1aff #ffcc00` (wave)
   - **Arctic** `#ff0055 #00ffcc #ffaa00 #4400ff` (pulse)
   - **Magma** `#ff3c00 #ffd400 #00ffcc #9b30ff` (circle)
2. **`src/hooks/useFixtureTest.ts`** — `release('fixture-test')` au démontage
   (fuite LTP 90 qui pouvait figer les RGB si on naviguait pendant l'étape COLOUR).
3. **`src/views/AutoLoopsPanel.tsx`** — fallback par défaut `'Neon'`.

## Vérifications
- `tsc --noEmit` : OK
- `vitest run` : **161/161** (12 fichiers)
- `vite build` : OK (1494 modules)

## Reste (hors périmètre, préexistant)
- `simple-desk` (LTP 100) sans release au démontage du panneau — déjà mitigé par
  `handleModeChange` qui relâche en quittant `perform`.
- Source `vc` partagée entre la boucle et le Virtual Console (risque de conflit à
  priorité 80 si une scène/chaser VC tourne en même temps que la boucle).
- `PerformanceView.tsx:2147` : slider VC univers hardcodé `1`.

## À tester
`launch.bat` → QuickShow → onglet « Boucle unique » → Jouer : les blocs ET les
fixtures doivent maintenant alterner des couleurs franchement distinctes
(magenta / cyan / vert / violet, etc.).
