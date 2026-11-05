# Subagent 48 — Bug BPM 125 vs 130 : Analyse & Fix

## Cause racine

### Bug principal : `hsMax` auto-normalise chaque lag par lui-même

Dans `trackBeats` (ligne ~945), la boucle de scoring contient un bug critique :

```javascript
const hs = harmonicSum(acorr, lag, maxLag, 4);
const hsMax = Math.max(1e-10, hs);  // ← BUG : max de hs et 1e-10, pas le max global
const norm = hs / hsMax;             // ← = 1.0 pour tout hs > 0
const score = norm;
```

**`hsMax` est censé être le maximum global de la harmonic sum** pour normaliser tous les scores entre 0 et 1. Mais le code prend `Math.max(1e-10, hs)` — c'est-à-dire le max de la valeur **courante** et 1e-10. Résultat :

| hs | hsMax | norm = hs/hsMax |
|----|-------|-----------------|
| 1.85 | 1.85 | **1.0** |
| 0.42 | 0.42 | **1.0** |
| -0.3 | 1e-10 | -3e9 (très négatif) |
| 0 | 1e-10 | 0 |

**Tout lag avec hs > 0 obtient le score 1.0.** Le premier lag positif gagne (bestLag = minLag).

### Chaîne causale vers 125 BPM

1. `minLag = floor(60*25/240) = 6` → bestLag = 6 (premier lag avec hs > 0)
2. `bestBpm = round(60*25/6) = 250` BPM
3. Octave correction : `250 > 160` → check `halfBpm = 125`, `halfLag = 12`
4. `acorr[12] / maxAcorr > 0.12` → vrai (lag 12 = 125 BPM, proche du vrai 130 BPM)
5. **Résultat : 125 BPM, lag=12** ← au lieu de 130 BPM, lag≈11.54

L'octave correction "sauve" le résultat en le divisant par 2, mais atterrit sur 125 (lag=12) au lieu de 130 (lag≈11.54) parce que 12 est le lag entier le plus proche à 25 Hz.

### Bug secondaire : interpolation parabolique sur acorr brut

L'interpolation parabolique (ligne ~962) utilise `acorr[bestLag-1..bestLag+1]` — l'autocorrélation brute — alors que bestLag a été choisi via la harmonic sum. Le pic de l'acorr brut n'est pas nécessairement au même lag que le pic de la HS. L'interpolation devrait se faire sur la même fonction qui a servi au scoring.

### Bug tertiaire : résolution insuffisante à 25 Hz

À 25 Hz : lag 11 = 136 BPM, lag 12 = 125 BPM → écart de **5 BPM par lag**. Le vrai 130 BPM est à lag 11.54, impossible à distinguer avec des lags entiers.

À 50 Hz : lag 23 = 130.4 BPM, lag 24 = 125 BPM → écart de **2.6 BPM par lag**. Le vrai 130 BPM est à lag 23.08, quasi-confondu avec lag 23.

Le `beatRate` a été réduit à 25 Hz (commit f8ca9c3) pour éviter le watchdog blackout, mais `analyzeAudioBuffer` est maintenant async (commit a7bc132) avec `yieldToEventLoop()`. Le retour à 50 Hz est faisable.

## Solution recommandée : Combinaison A + D (fix hsMax + interpolation sur HS + beatRate 50 Hz)

### Justification

| Fix seul | Résultat attendu pour 130 BPM | Risque |
|----------|-------------------------------|--------|
| Fix hsMax seul (25 Hz) | bestLag = 11 ou 12 selon HS. Si 12 → 125 BPM (toujours). Si 11 → 136 BPM, interpolation acorr pourrait raffiner vers ~130 | Incertain, dépend du signal |
| Fix hsMax + interpolation HS (25 Hz) | bestLag = 11 ou 12, interpolation sur HS affine vers 11.54 → **130 BPM** | Bon, mais résolution limitée |
| Fix hsMax + interpolation HS + beatRate 50 Hz | bestLag = 23 (130.4 BPM), interpolation HS → lag 23.08 → **130 BPM** | Excellent, résolution 2× meilleure |
| beatRate 50 Hz seul (sans fix hsMax) | Toujours 125 BPM (le bug hsMax rend bestLag = minLag = 12, octave → 125) | Aucune amélioration |

**Les trois fixes sont nécessaires et complémentaires :**
1. Fix hsMax → permet au bon lag d'être sélectionné
2. Interpolation sur HS → raffine le lag sub-entier avec la bonne fonction
3. beatRate 50 Hz → double la résolution pour distinguer 130 de 125

### Sécurité beatRate 50 Hz

- `computeBassODFFast` : O(numFrames × windowSize/4). À 50 Hz, numFrames double mais windowSize = hopSize halve → **même coût total**.
- `autocorrelation` : O(n × maxLag). n double, maxLag double → 4×, mais reste ~540K ops pour 3 min de musique. < 5ms.
- `trackBeats` DP : O(n × maxBeatGap). 4× aussi, ~324K ops. < 3ms.
- `yieldToEventLoop()` déjà présent avant l'appel (ligne 1825). Aucun risque de blackout.

## Patches

### Patch 1 : Fix hsMax — normalisation globale (CRITIQUE)

**Fichier :** `src/hooks/audio-analysis.ts`
**Lignes :** ~938-958

```diff
--- oldText ---
  let bestLag = minLag;
  let bestScore = -Infinity;
  const debugCandidates: { lag: number; bpm: number; acorr: number; hs: number; norm: number; score: number }[] = [];

  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 * rate / lag;
    const hs = harmonicSum(acorr, lag, maxLag, 4);
    const hsMax = Math.max(1e-10, hs);
    const norm = hs / hsMax; // normalize harmonic sum
    const score = norm;

    debugCandidates.push({
      lag, bpm: Math.round(bpm),
      acorr: Number(acorr[lag].toFixed(4)),
      hs: Number(hs.toFixed(4)),
      norm: Number(norm.toFixed(4)),
      score: Number(score.toFixed(4)),
    });

    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
+++ newText ---
  let bestLag = minLag;
  let bestScore = -Infinity;
  const debugCandidates: { lag: number; bpm: number; acorr: number; hs: number; norm: number; score: number }[] = [];

  // First pass: compute HS for all lags and find the global maximum
  const hsValues = new Float64Array(maxLag + 1);
  let globalHsMax = 1e-10;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const hs = harmonicSum(acorr, lag, maxLag, 4);
    hsValues[lag] = hs;
    if (hs > globalHsMax) globalHsMax = hs;
  }

  // Second pass: score using properly normalized HS
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = 60 * rate / lag;
    const hs = hsValues[lag];
    const norm = hs / globalHsMax; // normalize by global maximum
    const score = norm;

    debugCandidates.push({
      lag, bpm: Math.round(bpm),
      acorr: Number(acorr[lag].toFixed(4)),
      hs: Number(hs.toFixed(4)),
      norm: Number(norm.toFixed(4)),
      score: Number(score.toFixed(4)),
    });

    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
```

### Patch 2 : Interpolation parabolique sur HS au lieu de acorr brut

**Fichier :** `src/hooks/audio-analysis.ts`
**Lignes :** ~962-975

```diff
--- oldText ---
  if (bestLag > minLag && bestLag < maxLag) {
    const a0 = acorr[bestLag - 1];
    const a1 = acorr[bestLag];
    const a2 = acorr[bestLag + 1];
    const denom = 2 * (a0 - 2 * a1 + a2);
    if (Math.abs(denom) > 1e-9 && a1 > 0) {
      const offset = (a0 - a2) / denom;
      // Allow up to 0.95 lag offset: the harmonic sum can place bestLag one slot
      // away from the raw acorr peak. E.g., a 105 BPM track has higher raw acorr
      // at lag=6 (100 BPM) than lag=5 (120 BPM), but harmonic sum favors 120.
      // Parabola through [4,5,6] finds the true peak at lag≈5.71 → 105 BPM.
      if (Math.abs(offset) > 0.01 && Math.abs(offset) < 0.95) {
+++ newText ---
  if (bestLag > minLag && bestLag < maxLag) {
    // Interpolate on harmonic sum (same function used for scoring), not raw acorr.
    // The raw acorr peak can be at a different lag than the HS peak.
    const a0 = hsValues[bestLag - 1];
    const a1 = hsValues[bestLag];
    const a2 = hsValues[bestLag + 1];
    const denom = 2 * (a0 - 2 * a1 + a2);
    if (Math.abs(denom) > 1e-9 && a1 > 0) {
      const offset = (a0 - a2) / denom;
      // Allow up to 0.95 lag offset: the harmonic sum can place bestLag one slot
      // away from the raw acorr peak. E.g., a 105 BPM track has higher raw acorr
      // at lag=6 (100 BPM) than lag=5 (120 BPM), but harmonic sum favors 120.
      // Parabola through HS[4,5,6] finds the true peak at lag≈5.71 → 105 BPM.
      if (Math.abs(offset) > 0.01 && Math.abs(offset) < 0.95) {
```

### Patch 3 : Augmenter beatRate à 50 Hz

**Fichier :** `src/hooks/audio-analysis.ts`
**Ligne :** ~1831

```diff
--- oldText ---
  const beatRate = 25;  // 25 Hz: 40ms/frame → lag at 120 BPM = 12.5 frames (was 5 at 10 Hz)
+++ newText ---
  const beatRate = 50;  // 50 Hz: 20ms/frame → lag at 120 BPM = 25 frames, 2.6 BPM resolution
                        // (was 25 Hz / 5 BPM resolution). Safe since analyzeAudioBuffer is async
                        // with yieldToEventLoop (commit a7bc132).
```

## Vérification : trace pour 130 BPM avec les 3 patches

### À 50 Hz (après Patch 3)
- minLag = floor(3000/240) = 12, maxLag = floor(3000/50) = 60
- lag 23 → 130.4 BPM, lag 24 → 125 BPM
- acorr[23] devrait être élevé (proche du vrai tempo)
- hsValues[23] = acorr[23] + acorr[11.5]/2 + acorr[7.67]/3 + acorr[5.75]/4
- hsValues[24] = acorr[24] + acorr[12]/2 + acorr[8]/3 + acorr[6]/4

### Après Patch 1 (hsMax fixé)
- bestLag = argmax(hsValues) → probablement 23 (130.4 BPM) car acorr[23] >> acorr[24]
- bestBpm = round(3000/23) = 130 ✓

### Après Patch 2 (interpolation sur HS)
- hsValues[22], hsValues[23], hsValues[24] → parabole → offset ≈ 0.08
- refinedLag = 23.08 → refinedBpm = round(3000/23.08) = round(129.98) = 130 ✓

### Octave correction
- bestBpm = 130 < 160 → octave correction non déclenchée ✓

## Note sur les options non retenues

- **Option B (résolution fine par interpolation entre lags)** : plus complexe, nécessite une fonction d'autocorrélation continue. L'interpolation parabolique sur HS (Patch 2) offre déjà une résolution sub-lag suffisante.
- **Option C (multi-candidate + accent ratio Ellis 2007)** : excellent pour les cas ambigus, mais surdimensionné pour ce bug. Le fix hsMax + 50 Hz élimine l'ambiguïté dans la plupart des cas. Pourrait être ajouté ultérieurement si d'autres erreurs BPM persistent.
