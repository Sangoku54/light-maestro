# Autoloop SoundSwitch 2.9 — Clone Python

Clone de la fonction **Autoloop** du logiciel SoundSwitch 2.9 : un moteur
d'exécution complet, en Python (orienté objet + asynchrone temps réel), structuré
autour de 4 modules fondamentaux + une sortie DMX/Art-Net.

```
DELIVERY/
├── autoloop/
│   ├── __init__.py     # re-exports du contrat public
│   ├── models.py       # MODULE 1 — modèle de données des Cues
│   ├── generator.py    # MODULE 2 — moteur « Autoscript » (génération procédurale)
│   ├── playback.py     # MODULE 3 — moteur de lecture temps réel (Beatgrid/Timecode)
│   ├── output.py       #         sortie Art-Net DMX512 (UDP)
│   └── banks.py        # MODULE 4 — banques 4×32 et modes de performance
├── demo.py             # démo exécutable (pipeline complet, sans réseau)
└── README.md           # ce fichier
```

Zéro dépendance externe : uniquement la bibliothèque standard (`math`, `socket`,
`asyncio`, `bisect`, `enum`, `dataclasses`). Python 3.11+.

---

## 1. Architecture

```
                     ┌──────────────┐
   BeatGrid hôte DJ  │  BeatClock   │  (BPM + position bar/beat)
   ─────────────────▶│ PlaybackEngine│◀── AutoloopTimeline (modules 1+2)
                     └──────┬───────┘
                            │ dict[adresse DMX → valeur]
                     ┌──────▼───────┐
                     │  DmxOutput   │──▶ ArtNetOutput (UDP ArtDmx) ──▶ node Art-Net
                     └──────────────┘
```

**Flux de données**

1. `models.py` définit les types purs (cues + timeline + formules trigonométriques).
2. `generator.py` produit une `AutoloopTimeline` remplie de `ChannelKey`
   (keyframes DMX) à partir des cues et d'une catégorie de fixtures.
3. `playback.py` lit la timeline, quantise les déclenchements sur le barline,
   interpole les keyframes et émet une frame DMX par position.
4. `output.py` encapsule la frame en paquet Art-Net `ArtDmx` et l'envoie en UDP.
5. `banks.py` stocke/navigue les 128 Autoloops (matrice 4×32) et gère la répétition.

**Machine à états du moteur de lecture** (`PlaybackEngine`)

```
IDLE ──trigger()──▶ (quantise au barline) ──▶ SCRIPT ──override_with(loop)──▶ OVERRIDE_LOOP
 ▲                                             │                                │
 └─────────────────stop()──────────────────────┴───── fin de loop.bars bars ───┘
                                                      (reprise du script à bar+loop.bars)
```

---

## 2. Formules mathématiques

### 2.1 Mouvement paramétrique (`PositionCue`)

Le pan/tilt d'un moving head décrit une trajectoire dans le plan DMX (0..255).
On l'exprime en fonction du **beat** `t` (temps musical), avec `ω` = `speed`
(rad/beat) et `φ` = `phase` (rad).

**Cercle**

```
pan(t)  = center_pan  + radius · cos(ω·t + φ)
tilt(t) = center_tilt + radius · sin(ω·t + φ)
```

Pourquoi : `(cos θ, sin θ)` est la définition paramétrique du cercle unité.
En avançant `t`, le point tourne sur un cercle de rayon `radius` centré sur
`(center_pan, center_tilt)`. Le cosinus est la projection horizontale (pan), le
sinus la projection verticale (tilt) — déphasés de π/2, ce qui garantit un
**cercle** et non une diagonale (si pan et tilt utilisaient la même fonction, le
point ne parcourrait qu'un segment de droite).

Exemple : `ω = π/2` → un tour complet (2π) en 4 beats, soit 1 bar.

**Huit (courbe de Lissajous 1:2)**

```
pan(t)  = center_pan  + radius · sin(ω·t + φ)
tilt(t) = center_tilt + radius · sin(2·ω·t + φ)
```

Le tilt oscille à **fréquence double** du pan. Le rapport de fréquences 1:2
(déphasage nul) trace un huit : pendant un cycle de pan, le tilt fait un
aller-retour complet et recroise le centre à mi-parcours, dessinant les deux
boucles. C'est un cas particulier de courbe de Lissajous.

Dans les deux cas, le résultat est borné `[0, 255]` puis arrondi (`clamp_dmx`) :
on **borne avant d'arrondir** pour qu'un `255.6` ne devienne pas `256`.

### 2.2 Conversion de temps (`PlaybackEngine`)

| Grandeur | Formule | Note |
|---|---|---|
| Durée d'un beat | `beat_ms = 60000 / BPM` | 120 BPM → 500 ms |
| Durée d'une bar | `bar_ms = 4 · beat_ms` | signature 4/4 |
| Durée de `n` bars | `bars_to_ms(n) = n · 4 · beat_ms` | — |

**Quantisation au barline** — un Autoloop se déclenche toujours sur une frontière
de barre (jamais au milieu). Si la position courante est `(bar, beat)` avec
`beat ∈ [0, 4)` :

```
delay_ms = (4 − beat) · beat_ms
```

Exemple : à `beat = 2` et 120 BPM → `(4 − 2) · 500 = 1000 ms`.

### 2.3 Interpolation des keyframes

Entre deux `ChannelKey` successifs — clé précédente `(t₀, v₀)` et clé courante
`(t₁, v₁)` — la valeur d'un canal à la phase `t` vaut :

```
v(t) = v₀ + (v₁ − v₀) · clamp((t − t₀) / ramp_beats, 0, 1)
```

où `ramp_beats` est la durée d'interpolation **de la clé cible** (celle en `t₁`).
Si `ramp_beats ≤ 0` → **snap** : on tient `v₀` jusqu'à `t₁`, puis on saute à `v₁`.
La localisation de la clé courante est faite par recherche dichotomique
(`bisect`), en **O(log n)**.

C'est ce mécanisme qui matérialise les « fades » de SoundSwitch : il n'y a pas de
crossfade natif entre Autoloops, les transitions sont des **rampes écrites dans la
timeline elle-même** (changement de couleur, rampe d'intensité…).

---

## 3. Latence < 20 ms (choix d'implémentation)

Le budget cible est : **rendu d'une frame + envoi réseau < 20 ms**. Pour le tenir :

1. **Horloge monotonic, pas de blocage.** Le moteur est piloté par le callback
   `on_bar_beat(bar, beat)` de l'hôte (Beatgrid) : aucune boucle `time.sleep`
   bloquante dans le chemin de rendu. Le mode autonome (`run()`) utilise
   `time.perf_counter()` + `asyncio.sleep`, jamais d'attente passive.

2. **Buffer Art-Net pré-alloué.** `ArtNetOutput` écrit l'en-tête une seule fois
   dans un `bytearray(530)` réutilisé ; à chaque `send`, seuls l'octet de
   séquence et les canaux fournis sont réécrits avant le `sendto`. Aucune
   allocation ni reconstruction d'en-tête par frame.

3. **UDP non bloquant.** Le socket est non bloquant : `sendto` rend la main
   immédiatement sans attendre que la pile réseau draine le tampon. Si le tampon
   OS est plein (`BlockingIOError`), la frame est sautée plutôt que d'attendre —
   un récepteur lent ne fige jamais le moteur.

4. **Rendu O(log n + k).** Les clés sont pré-triées par beat et groupées par
   canal ; chaque frame fait une dichotomie (`bisect`) + `k` interpolations
   (k = nombre de canaux actifs). Pas de calcul lourd par tick.

Résultat : l'émission d'une frame est de l'ordre de la dizaine de microsecondes
de CPU, très en dessous du budget de 20 ms.

---

## 4. Fidélité SoundSwitch 2.9 (mapping)

| Fonction SoundSwitch | Où dans le clone |
|---|---|
| Autoloop = timeline continue bar-aligned (8/16/32/64/128 bars) | `AutoloopTimeline.bars` + `length_beats() = bars·4` |
| Cues posés sur le BeatGrid | `ChannelKey.beat` (keyframes) |
| 4 banques × 32 Autoloops = 128 | `BANKS`/`PER_BANK` + `BankManager` (matrice 4×32) |
| Pas de crossfade natif (fades = rampes dans le loop) | `ramp_beats` + interpolation §2.3 |
| Autoloop Override (joue sa durée puis rend la main) | `PlaybackEngine.override_with()` (machine à états) |
| Synchronisation sur frontière de barre | `quantize_delay_ms()` + déclenchement quantisé |
| Infinite Repeat / Track Duration Repeat | `RepeatMode.INFINITE` / `RepeatMode.TRACK_DURATION` |
| Mode exclusif / « Play All Banks » | `BankManager.lock_bank()` / `unlock_all()` |

> Note de conception : dans SoundSwitch les cues *Attribute* (gobo/prisme/focus/zoom)
> sont distincts des *Control Tracks* (couleur/intensité/pan-tilt/strobe). Le cahier
> des charges fusionne les deux dans `AttributeCue` — c'est la spécification suivie.

> Note d'implémentation : `ChannelKey.channel` encode l'**adresse DMX absolue en
> chaîne** (ex. `"13"`). La timeline ne transportant pas de table de fixtures, cela
> la rend auto-suffisante pour l'émission ; le moteur accepte aussi un nom logique
> si l'hôte fournit `channel_map`.

---

## 5. Exécution

```bash
cd DELIVERY
python demo.py
```

La démo exécute le pipeline complet sans réseau (sortie DMX factice) :
génération d'une timeline 8 bars, navigation dans la matrice 4×32, lecture
temps réel, quantisation, override + reprise du script, et une trame Art-Net.

## 6. API publique (résumé)

```python
from autoloop import (
    # Modèle (module 1)
    FixtureCategory, Fixture, MovementShape, PositionCue, AttributeCue,
    ChannelKey, AutoloopTimeline, clamp_dmx,
    # Générateur (module 2)
    generate_autoscript, DEFAULT_RULES,
    # Moteur (module 3)
    BeatClock, DmxOutput, PlaybackEngine,
    # Sortie (module auxiliaire)
    ArtNetOutput,
    # Banques (module 4)
    BANKS, PER_BANK, RepeatMode, BankManager,
)
```
