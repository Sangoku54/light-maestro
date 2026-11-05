# Beat Tracking Research: Algorithmes, Comparatifs et Recommandations

## Contexte du Bug

**Symptôme** : Light Maestro détecte 147 BPM au lieu de 120 BPM pour un fichier audio avec un kick puissant à 120 BPM.

**Cause racine identifiée** :
1. Résolution temporelle insuffisante (analysisRate = 10 Hz → lag = 100 ms)
2. Prior log-Gaussian trop serré (σ = 0.35)
3. Absence de pre-filtering bass-band sur l'ODF
4. Absence de harmonic sum sur l'autocorrélation

---

## 1. Algorithmes de Référence

### 1.1 librosa.beat.beat_track

**Pipeline en 3 étapes** (Ellis 2007, implémenté dans librosa) :

#### Étape 1 : Onset Strength Envelope (OSE)

```python
# Paramètres par défaut librosa 0.11
sr = 22050          # sample rate par défaut (resampling interne)
hop_length = 512    # ≈ 23 ms à 22050 Hz → analysisRate ≈ 43 Hz
n_fft = 2048
```

librosa calcule l'envelope d'onset strength via `librosa.onset.onset_strength()` :
- Calcul du spectrogramme (magnitude) avec fenêtre Hann, FFT 2048, hop 512
- Différence spectrale positive (spectral flux) : `max(0, mag[i] - mag[i-1])` par bin
- Agrégation par somme (ou médiane) sur toutes les fréquences
- Lissage par filtre maximum filter (pre_max=1, post_max=1) puis mean filter (pre_avg=1, post_avg=1)
- Normalisation optionnelle

**Points clés** :
- **hop_length = 512 à sr=22050** → analysisRate ≈ **43 Hz** (pas 10 Hz !)
- Résolution temporelle : 23 ms par frame
- À 120 BPM (lag = 0.5 s) : 21.5 frames par beat → **très haute résolution**
- À 147 BPM (lag = 0.408 s) : 17.5 frames → distinction claire

#### Étape 2 : Tempo Estimation

librosa utilise `librosa.feature.tempo()` (anciennement `librosa.beat.tempo_estimation`) :

```python
# Paramètres par défaut
ac_size = 8.0       # fenêtre d'autocorrélation en secondes
max_tempo = 320.0   # BPM maximum
aggregate = np.median  # agrégation temporelle (médiane globale)
```

**Algorithme** :
1. Calculer l'autocorrélation de l'OSE sur une fenêtre de `ac_size` secondes
2. Fenêtre glissante avec chevauchement → tempogramme local
3. Restreindre aux lags correspondant à [0, max_tempo] BPM
4. **Harmonic sum** : pour chaque lag τ, additionner l'autocorrélation à τ, τ/2, τ/3, τ/4
   - Cela renforce les pics au tempo fondamental (un signal à 120 BPM a aussi de l'énergie à 60 et 30 BPM)
5. Agrégation par médiane sur toutes les fenêtres temporelles
6. Pas de prior gaussien — l'estimation est purement data-driven

**Pourquoi la harmonic sum est critique** :
- Un kick à 120 BPM produit des pics d'autocorrélation à lag=0.5s (120 BPM) ET à lag=1.0s (60 BPM, octave inférieur)
- Sans harmonic sum, le pic à 60 BPM peut dominer (plus large, plus stable)
- Avec harmonic sum : `score(τ) = acorr[τ] + acorr[τ/2] + acorr[τ/3] + acorr[τ/4]`
  - Pour τ = 0.5s (120 BPM) : `acorr[0.5] + acorr[0.25] + acorr[0.167] + acorr[0.125]` → tous alignés sur les sub-divisions
  - Pour τ = 1.0s (60 BPM) : `acorr[1.0] + acorr[0.5] + acorr[0.333] + acorr[0.25]` → partiellement aligné
- Résultat : le vrai tempo (120) obtient un score harmonic sum plus élevé

#### Étape 3 : Beat Tracking par Dynamic Programming (Ellis 2007)

```python
# Paramètres par défaut librosa beat_track
tightness = 100     # pénalité de déviation du tempo [0.1, 1000]
# tightness élevé = contraint forte sur la régularité
```

**Algorithme DP d'Ellis** :
1. Construire une fonction de coût de transition basée sur le tempo estimé :
   - `C(t2, t1) = -log(onset_strength[t2]) + α * |log((t2-t1)/τ)|`
   - où τ est la période de beat estimée, α contrôle la rigidité
2. Dynamic programming : `score[i] = max(score[j] - C(i,j))` pour tous les j < i
3. Backtrack depuis le meilleur score final
4. Avantage : garantit une séquence de beats régulière, même si l'OSE est bruitée

### 1.2 madmom.features.beats (RNN + DBN)

**Architecture** : état de l'art (Böck et al., ISMIR 2016)

#### Phase 1 : RNN Beat Activation Function

```
Input audio → LogMel spectrogram (80 mels, 100 Hz frame rate)
            → 3 couches BiLSTM (bidirectional Long Short-Term Memory)
            → Beat activation function [0, 1] par frame
```

**Détails** :
- **Frame rate : 100 Hz** (hop = 10 ms à sr=44100) — 10× plus résolu que notre 10 Hz
- **Mel spectrogramme** : 80 bandes mel, fenêtre 1024 échantillons, hop 441
- **3 couches BiLSTM** avec 25 hidden units chacune
- **Ensemble de 4 RNNs** (différentes initialisations) → moyenne des activations
- **Données d'entraînement** : ~20k fichiers annotés (GTZAN, Ballroom, RWC, Beatles, etc.)
- Output : fonction d'activation de beat ∈ [0, 1] à 100 Hz

#### Phase 2 : DBN Beat Tracking

```
Beat activation → Dynamic Bayesian Network (DBN)
              → Beat positions (temps précis en secondes)
```

**Modèle DBN** :
- **State space** : position dans le cycle de beat + tempo
- **Transition model** : 
  - `P(beat_at_t+1 | beat_at_t)` = Gaussienne centrée sur τ (période estimée)
  - Permet des variations de tempo ±10% par beat
- **Observation model** : `P(activation | beat_state)` — mapping activation → probabilité de beat
- **Inference** : Viterbi decoding (forward-backward algorithm)
- Paramètres : `min_bpm=40`, `max_bpm=240`, `num_tempo_states=78`

**Variantes** :
- `RNNBeatProcessor` + `DBNBeatTracker` : beats seulement
- `RNNDownBeatProcessor` + `DBNDownBeatTracker` : beats + downbeats joints (Böck 2016)

**Performances** :
- F-measure sur GTZAN : ~95% (vs ~80% pour librosa)
- F-measure sur Ballroom : ~93% (vs ~75% pour librosa)
- Beat This! (2024) : ~96% F-measure, nouveau SOTA
- Coût : nécessite un modèle pré-entraîné (poids RNN), inference ~1s pour 3min de audio

### 1.3 essentia.standard.PercivalBpmEstimator

**Paper** : Percival & Tzanetakis, IEEE TASLP 2014

**Algorithme** :

```
Input signal
  → Band-pass filtering (5 bandes: 0-50Hz, 50-100Hz, 100-250Hz, 250-500Hz, 500-2000Hz)
  → Envelope extraction par bande (rectify + lowpass)
  → Différence (onset-like) par bande
  → Autocorrélation par bande
  → Cross-correlation entre bandes
  → Pulse train matching
  → Octave correction par features globales
  → BPM final
```

**Détails techniques** :

1. **Multi-band filtering** : 5 filtres passe-bande couvrant sub-bass à mid-range
   - Capture les kicks (0-100 Hz), basses (100-250 Hz), et harmonic content (250-2000 Hz)
   
2. **Envelope per band** : `envelope[n] = max(0, signal[n])` puis lowpass à 10 Hz

3. **Onset per band** : `diff[n] = envelope[n] - envelope[n-1]` (positive part only)

4. **Autocorrélation par bande** : calculée sur 8 secondes de signal

5. **Cross-correlation entre bandes** : renforce les patterns communs à plusieurs bandes
   - `xcorr[i,j] = corr(acorr_band_i, acorr_band_j)`
   - Somme pondérée → score combiné

6. **Pulse train matching** :
   - Pour chaque lag candidat τ, construire un train d'impulsions : `pulse[n] = Σ δ(n - k*τ)`
   - Corréler avec l'envelope d'onset → score de matching
   - Le lag avec le meilleur matching → BPM

7. **Octave error correction** (contribution clé du paper) :
   - Calculer l'"accent" moyen du signal (ratio énergie beat vs inter-beat)
   - Si l'accent est faible au BPM détecté mais fort à BPM/2 → corriger
   - Si l'accent est fort à BPM détecté mais faible à 2×BPM → garder
   - Basé sur l'observation que les octave errors surviennent quand l'algorithme se verrouille sur des sub-divisions au lieu du beat principal

**Paramètres Essentia** :
```python
frameSize = 1024
hopSize = 512
sampleRate = 44100
minBPM = 40
maxBPM = 250
```

---

## 2. Diagnostic du Bug Light Maestro

### 2.1 Analyse du Code Actuel

```typescript
// analysisRate = 10 Hz
// hopSize = sampleRate / 10 = 4410 (à 44100 Hz)
// FFT size = 2048
// → Très faible résolution temporelle pour le beat tracking
```

**Problème #1 : Résolution de l'autocorrélation**

À analysisRate = 10 Hz :
| BPM | Lag idéal (frames) | Lag arrondi | BPM résultant | Erreur |
|-----|-------------------|------------|---------------|--------|
| 120 | 5.00 | 5 | 120.0 | 0% |
| 147 | 4.08 | 4 | 150.0 | +2% |
| 100 | 6.00 | 6 | 100.0 | 0% |
| 130 | 4.62 | 5 | 120.0 | -7.7% |
| 140 | 4.29 | 4 | 150.0 | +7.1% |

**Le lag 4 → 150 BPM, lag 5 → 120 BPM**. Si l'autocorrélation est légèrement biaisée vers le lag 4 (par exemple à cause d'un kick avec des ghosts notes ou un pattern en double-time), le résultat saute à 150 BPM. L'interpolation parabolique tente de corriger, mais avec seulement 2-3 points autour du pic, la précision est limitée.

**Problème #2 : Prior log-Gaussian**

```typescript
const muBpm = 120, sigmaLog = 0.35;
// prior(120) = 1.0
// prior(150) = exp(-0.5 * (log2(150/120)/0.35)²) = exp(-0.5 * (0.322/0.35)²) ≈ 0.69
// prior(100) = exp(-0.5 * (log2(100/120)/0.35)²) = exp(-0.5 * (-0.263/0.35)²) ≈ 0.75
```

Le prior à 150 BPM = 0.69 — pas assez faible pour éliminer un faux pic d'autocorrélation à lag=4. Le prior renforce légèrement 120 mais ne peut pas compenser un signal bruité.

**Problème #3 : ODF non filtré**

L'ODF actuel mélange sub-bass, bass, mid, et high :
```typescript
odf[i] = rmsDiff * 0.4 + flux * 0.6;
// flux = weighted sum of all band deltas (sub, bass, lowMid, mid, high)
```

Les hautes fréquences (hi-hats, cymbales) ajoutent du bruit à l'autocorrélation. Les patterns de hi-hat en double ou quadruple temps créent des pics parasites aux sub-multiples du vrai tempo.

**Problème #4 : Pas de harmonic sum**

Sans harmonic sum, l'autocorrélation à lag=4 (150 BPM) peut être plus forte qu'à lag=5 (120 BPM) si le signal a un pattern rythmique à 150 BPM (par exemple un fill ou un ghost note régulier).

---

## 3. Algorithmes de Correction d'Octave

### 3.1 Harmonic Sum (librosa)

```python
# Pour chaque lag τ candidat :
score(τ) = Σ_{k=1}^{K} acorr[τ/k]   # k=1,2,3,4
```

- Renforce le tempo fondamental en sommant les harmoniques
- Un vrai tempo à 120 BPM a de l'énergie à 60, 40, 30 BPM (sous-multiples)
- En sommant, le vrai tempo obtient un score plus élevé qu'un sub-multiple isolé
- **K=4** est standard (librosa)

### 3.2 Octave Correction par Accent (Percival)

```python
# Calculer l'accent moyen :
accent = mean(onset_envelope[beat_positions]) / mean(onset_envelope[non_beat_positions])

# Si BPM détecté > seuil et accent_bpm/2 > accent_bpm * threshold :
#   → corriger à BPM/2
```

- Si le signal a un fort pattern à 120 BPM mais que l'algo détecte 240, l'accent à 120 sera élevé et l'accent à 240 sera faible → correction
- Inversement, pour un vrai DnB à 170 BPM, l'accent à 85 est faible → pas de correction

### 3.3 Schreiber & Müller (2014) — Global Feature Octave Correction

- Utilise l'"onset density" moyenne comme feature discriminante
- Les tracks à tempo rapide (>150) ont une onset density différente des tracks lents
- Classifieur simple (threshold ou SVM) sur features globales pour prédire l'octave
- Améliore l'accuracy de ~5-8% sur les datasets avec octave errors

### 3.4 Multi-Candidate Selection (Recommandé)

```typescript
// 1. Trouver les 3 meilleurs candidats BPM sans prior
const candidates = topN_peaks(acorr, minLag, maxLag, n=3);

// 2. Pour chaque candidat, calculer un score combiné :
for (const c of candidates) {
  c.harmonicScore = harmonicSum(acorr, c.lag, K=4);
  c.accentScore = accentRatio(odf, c.lag);
  c.regularityScore = beatRegularity(odf, c.lag);
  c.priorScore = tempoPrior(c.bpm);
  c.combined = c.harmonicScore * 0.4 + c.accentScore * 0.3 
             + c.regularityScore * 0.2 + c.priorScore * 0.1;
}

// 3. Sélectionner le meilleur candidat
bestBpm = argmax(candidates.map(c => c.combined));
```

---

## 4. Recommandations Concrètes pour Light Maestro

### 4.1 Augmenter le taux d'analyse (Critique)

```typescript
// AVANT
const analysisRate = 10;  // hopSize = 4410, 100ms par frame

// APRÈS — Option A : Augmenter analysisRate
const analysisRate = 50;  // hopSize = 882, 20ms par frame
// → lag à 120 BPM = 25 frames (au lieu de 5)
// → lag à 147 BPM = 20.4 frames → distinction claire
// → 1 frame d'erreur = 4% (au lieu de 20%)

// APRÈS — Option B : analysisRate séparé pour beat tracking
const spectralRate = 10;   // pour spectral features (cheap)
const beatRate = 50;       // pour beat tracking (dédié)
// Recalculer un ODF haute résolution juste pour beat tracking
```

**Impact** :
- lag 120 BPM = 25 frames → 1 frame d'erreur = 2.4 BPM (au lieu de 30 BPM !)
- L'interpolation parabolique devient efficace avec 5+ points autour du pic
- Mémoire : +5× frames pour l'ODF, mais l'ODF est un 1D array — negligible

### 4.2 Pre-filtering Bass-Band de l'ODF

```typescript
// AVANT
const odf = computeOnsetFunction(spectralFrames);
// ODF mélange toutes les bandes → bruit des hi-hats

// APRÈS — ODF bass-focused pour BPM
function computeBassODF(frames: SpectralFrame[]): number[] {
  const odf = new Array(frames.length).fill(0);
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1];
    const curr = frames[i];
    // Focus sur sub-bass (20-60 Hz) + bass (60-250 Hz) uniquement
    const subDiff = Math.max(0, curr.rawBands.sub - prev.rawBands.sub);
    const bassDiff = Math.max(0, curr.rawBands.bass - prev.rawBands.bass);
    odf[i] = subDiff * 1.5 + bassDiff * 1.0;  // sub-bass = kick
  }
  return odf;
}

// Pour le beat tracking : utiliser bassODF
// Pour onset detection général : garder l'ODF multi-bande actuel
```

**Impact** : Le kick à 120 BPM produit un signal clair dans sub-bass/bass. Les hi-hats à 240+ BPM sont éliminés.

### 4.3 Implémenter la Harmonic Sum

```typescript
function harmonicSum(acorr: number[], lag: number, maxLag: number, K: number = 4): number {
  let sum = 0;
  for (let k = 1; k <= K; k++) {
    const subLag = lag / k;
    if (subLag < 1 || subLag > maxLag) continue;
    // Interpolation linéaire pour les lags non-entiers
    const lo = Math.floor(subLag);
    const hi = Math.ceil(subLag);
    const frac = subLag - lo;
    const val = (hi <= maxLag) 
      ? acorr[lo] * (1 - frac) + acorr[hi] * frac 
      : acorr[lo];
    sum += val / k;  // pondération: les harmoniques supérieures contribuent moins
  }
  return sum;
}

// Utilisation dans trackBeats :
for (let lag = minLag; lag <= maxLag; lag++) {
  const bpm = 60 * rate / lag;
  const norm = acorr[lag] / maxAcorr;
  const hs = harmonicSum(acorr, lag, maxLag, 4);
  const prior = tempoPrior(bpm);
  const score = hs * prior;  // harmonic sum remplace acorr brute
  // ...
}
```

### 4.4 Élargir le Prior

```typescript
// AVANT
const muBpm = 120, sigmaLog = 0.35;
// prior(150) = 0.69 — trop proche de prior(120) = 1.0

// APRÈS
const muBpm = 120, sigmaLog = 0.6;
// prior(150) = exp(-0.5 * (0.322/0.6)²) ≈ 0.86
// prior(100) = exp(-0.5 * (-0.263/0.6)²) ≈ 0.91
// → prior plus plat, laisse les données parler
// → ou: prior encore plus plat (sigmaLog = 1.0) voire pas de prior du tout

// Alternative : prior uniforme + harmonic sum
const prior = 1.0;  // pas de prior
// La harmonic sum + bass filtering suffisent à désambiguïser
```

### 4.5 Multi-Candidate Beat Tracking

```typescript
function trackBeatsV2(odf: number[], rate: number) {
  const minBpm = 50, maxBpm = 240;
  const minLag = Math.floor((60 * rate) / maxBpm);
  const maxLag = Math.floor((60 * rate) / minBpm);
  
  const acorr = autocorrelation(odf, maxLag + 1);
  
  // 1. Trouver tous les pics locaux
  const peaks: { lag: number; acorr: number; bpm: number }[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (lag > minLag && lag < maxLag &&
        acorr[lag] > acorr[lag - 1] && acorr[lag] > acorr[lag + 1]) {
      peaks.push({ lag, acorr: acorr[lag], bpm: 60 * rate / lag });
    }
  }
  
  // 2. Pour chaque pic, calculer un score composite
  const scored = peaks.map(p => {
    const hs = harmonicSum(acorr, p.lag, maxLag, 4);
    const accent = computeAccentRatio(odf, p.lag, rate);
    const regularity = computeBeatRegularity(odf, p.lag, rate);
    return { ...p, hs, accent, regularity, 
             combined: hs * 0.4 + accent * 0.3 + regularity * 0.3 };
  });
  
  // 3. Trier et sélectionner
  scored.sort((a, b) => b.combined - a.combined);
  
  // 4. Octave correction sur le gagnant
  let best = scored[0];
  if (best.bpm > 160) {
    const halfCandidate = scored.find(s => 
      Math.abs(s.bpm - best.bpm / 2) < 5);
    if (halfCandidate && halfCandidate.combined > best.combined * 0.7) {
      best = halfCandidate;  // préférence pour l'octave inférieur
    }
  }
  
  return best.bpm;
}

function computeAccentRatio(odf: number[], lag: number, rate: number): number {
  // Ratio énergie sur-beat vs off-beat
  let onBeat = 0, offBeat = 0, onCount = 0, offCount = 0;
  for (let i = 0; i < odf.length; i++) {
    const phase = i % lag;
    if (phase < 2 || phase > lag - 2) {
      onBeat += odf[i]; onCount++;
    } else {
      offBeat += odf[i]; offCount++;
    }
  }
  return (onBeat / Math.max(1, onCount)) / 
         (offBeat / Math.max(1, offCount) + 1e-10);
}
```

### 4.6 Résumé des Changements Prioritaires

| Priorité | Changement | Effort | Impact estimé |
|----------|-----------|--------|---------------|
| P0 | analysisRate = 50 Hz pour beat tracking | Moyen | Élimine 90% du bug (résolution lag) |
| P0 | Pre-filter bass-band ODF | Faible | Réduit le bruit hi-hat → autocorrélation plus propre |
| P1 | Harmonic sum (K=4) | Faible | Renforce le vrai tempo vs sub-divisions |
| P1 | Élargir prior (σ=0.6) ou supprimer | Trivial | Laisse les données parler |
| P2 | Multi-candidate + accent ratio | Moyen | Correction d'octave robuste |
| P2 | Beat tracking DP (Ellis) | Élevé | régularité garantie, mais complexité code |

---

## 5. Implémentations JavaScript/Web Audio

### 5.1 web-audio-beat-detector (chrisguttandin)

- GitHub : https://github.com/chrisguttandin/web-audio-beat-detector
- Algorithme : autocorrélation sur l'amplitude (time-domain), pas de spectral analysis
- Précision : limitée (autocorrélation time-domain sans pre-filtering)
- Usage : détection BPM simple en temps réel, pas adapté pour MIR sérieux

### 5.2 Essentia.js

- Port WebAssembly d'Essentia → disponible en JS
- Inclut `PercivalBpmEstimator` et `BpmHistogram`
- Installation : `npm install essentia.js`
- Usage :
  ```javascript
  import { Essentia } from 'essentia.js';
  const essentia = new Essentia();
  const bpm = essentia.PercivalBpmEstimator(signal, sampleRate);
  ```
- **Recommandation** : C'est l'option la plus robuste pour le browser, mais ajoute ~2 MB de WASM

### 5.3 TarsosDSP (Java, portable)

- Bibliothèque Java avec implémentation de Percival
- Pas directement JS, mais algorithme documenté et portable

### 5.4 Implémentation manuelle recommandée

Pour Light Maestro (Electron, pas de contrainte WASM) :
1. **Ne pas dépendre d'une bibliothèque externe** — le code actuel est presque bon
2. Appliquer les 4 correctifs P0/P1 ci-dessus
3. Si insuffisant, envisager d'embarquer `essentia.js` pour le BPM uniquement

---

## 6. Bibliographie

### 6.1 Papers Fondamentaux

1. **Ellis, D.P.W. (2007)**. "Beat Tracking by Dynamic Programming." *Journal of New Music Research*, 36(1), 51-60. DOI: 10.1080/09298210701653344
   - Algorithme DP utilisé par librosa.beat.beat_track
   - Cité 725 fois — référence pour le beat tracking

2. **Böck, S., et al. (2016)**. "Joint Beat and Downbeat Tracking with Recurrent Neural Networks." *ISMIR 2016*.
   - Architecture RNN + DBN de madmom
   - Cité 244 fois — état de l'art 2016

3. **Percival, G. & Tzanetakis, G. (2014)**. "Streamlined tempo estimation based on autocorrelation and cross-correlation with pulses." *IEEE/ACM Transactions on Audio, Speech, and Language Processing*, 22(12).
   - Algorithme PercivalBpmEstimator d'essentia
   - Cité 60 fois — méthode d'octave correction

4. **Schreiber, H. & Müller, M. (2014)**. "Exploiting global features for tempo octave correction." *IEEE ICASSP 2014*.
   - Octave correction par features globales (onset density)
   - Cité 8 fois

5. **Schreiber, H. & Müller, M. (2018)**. "A Single-Step Approach to Musical Tempo Estimation Using a Convolutional Neural Network." *ISMIR 2018*.
   - Cité 73 fois — CNN pour tempo, simplifie le pipeline

6. **Schreiber, H. & Müller, M. (2020)**. "Music Tempo Estimation: Are We Done Yet?" *Transactions of ISMIR*.
   - Cité 31 fois — évaluation systématique des algorithmes de tempo
   - Montre que les octave errors restent le problème #1

### 6.2 Papers Complémentaires

7. **Klapuri, A. (2006)**. "Joint Beat & Tatum Tracking from Music Signals." *ISMIR 2006*.
   - Algorithme multi-niveau (tatum + beat) de Klapuri
   - Gagnant du MIREX 2006 tempo extraction

8. **Gouyon, F. et al. (2006)**. "An Experimental Comparison of Audio Tempo Induction Algorithms." *IEEE TASLP*.
   - Cité 373 fois — comparaison systématique d'algorithmes de tempo

9. **Cemgil, A.T. et al. (2000)**. "Rhythm Quantization for Transcription." *Computer Music Journal*.
   - Modèle probabiliste de beat tracking (Kalman filtering)
   - Base des métriques d'évaluation Cemgil

10. **Davies, M.E.P. & Plumbley, M.D. (2007)**. "Context-Dependent Beat Tracking of Musical Audio." *IEEE TASLP*.
    - Beat tracking par DP avec contexte spectral
    - Évaluation MIREX

11. **Böck, S. & Schedl, M. (2011)**. "Enhanced Beat Tracking with Context-Aware Neural Networks." *ISMIR 2011*.
    - Précurseur du RNN beat tracking (madmom)

12. **Hung, Y. et al. (2024)**. "Beat This! — Accurate Beat Tracking in the Wild." 
    - Nouveau SOTA 2024 pour le beat tracking
    - Surpasse madmom de ~3% F-measure

### 6.3 Ressources en Ligne

- **librosa docs** : https://librosa.org/doc/latest/generated/librosa.beat.beat_track.html
- **librosa source** : https://librosa.org/doc/main/_modules/librosa/feature/rhythm.html
- **madmom docs** : https://madmom.readthedocs.io/en/v0.16/modules/features/beats.html
- **madmom source (HMM)** : https://github.com/CPJKU/madmom/blob/master/madmom/features/beats_hmm.py
- **essentia docs** : https://essentia.upf.edu/reference/std_PercivalBpmEstimator.html
- **FMP notebook (beat tracking)** : https://www.audiolabs-erlangen.de/resources/MIR/FMP/C6/C6S3_BeatTracking.html
- **Comparaison open-source** : https://biff.ai/a-rundown-of-open-source-beat-detection-models/

---

## 7. Conclusion et Plan d'Action

### Diagnostic Final

Le bug 147 BPM au lieu de 120 est causé principalement par **la résolution insuffisante de l'autocorrélation** (analysisRate = 10 Hz → seulement 5 frames par beat à 120 BPM). Un frame d'erreur fait sauter le BPM de 120 à 150. L'interpolation parabolique ne peut pas compenser un manque aussi sévère de points.

### Plan d'Implémentation (par priorité)

1. **Immédiat** : Augmenter analysisRate à 50 Hz pour le beat tracking (P0)
2. **Immédiat** : Filtrer l'ODF sur sub-bass + bass uniquement (P0)
3. **Court terme** : Implémenter la harmonic sum K=4 (P1)
4. **Court terme** : Élargir le prior à σ=0.6 ou supprimer (P1)
5. **Moyen terme** : Multi-candidate beat tracking avec accent ratio (P2)
6. **Long terme** : Si la précision reste insuffisante, embarquer essentia.js (P3)

### Estimation de Complexité

- Changements P0+P1 : ~100 lignes de code, 2-3 heures de travail
- Changements P2 : ~200 lignes supplémentaires, 1 journée
- Changements P3 : intégration WASM, 1-2 jours

### Impact Attendu

Avec les changements P0+P1 seuls :
- Résolution : 25 frames par beat à 120 BPM (au lieu de 5) → 1 frame d'erreur = 2.4 BPM
- Pre-filtering : élimine le bruit hi-hat/cymbale de l'autocorrélation
- Harmonic sum : renforce le vrai tempo contre les sub-divisions
- **Résultat attendu** : détection correcte à ±2 BPM près pour >95% des cas
