# SoundSwitch Autoloop — Clone Python (plan + contrat d'architecture)

**Date** : 2026-08-21
**Demande** : coder l'architecture complète et le moteur d'exécution d'un clone de la fonction « Autoloop » de SoundSwitch 2.9, en Python (OOP + async temps réel), 4 modules, code commenté + explications des formules mathématiques.
**Livrable final** : paquet Python `autoloop/` (4 modules + sortie DMX/Art-Net) + `README.md` (formules + latence) + `demo.py` runnable, sous `DELIVERY/`.

## Faits SoundSwitch de référence (déjà sourcés, ne pas réinventer)

- Un Autoloop = **timeline continue bar-aligned** (8/16/32/64/128 bars), remplie via des **cues** posés sur le BeatGrid. PAS une liste de scenes.
- **4 banques × 32 Autoloops** = 128 (v2.9). Terme « loop groups » n'existe pas.
- **Pas de crossfade natif** : les fades sont des rampes écrites *dans* le loop (color transitions, rampes d'intensité, espacement des position flags).
- **Autoloop Override (2.9)** : un autoloop déclenché pendant un script joue **sa durée exacte puis rend la main au script** ; un flag de mode `Override Scripted Tracks` = priorité persistante.
- **Attribute Cues** = gobo/prisme/focus/zoom. Couleur/intensité/pan-tilt/strobe = Control Tracks. (Le user fusionne les deux dans `AttributeCue` : on suit SA spec.)
- **Synchronisation** : Beatgrid du logiciel DJ (source primaire) ou BPM détecté (fallback). Avancement calé sur **la frontière de barre**.
- **Infinite Repeat** (boucle au début de la timeline) vs **Track Duration Repeat** (écoute `Track_Loaded` → tue le thread et en régénère un).

## Contrat partagé (interfaces que les 4 modules doivent respecter)

### Module 1 — `models.py` (fondation, écrit par l'agent M1)

```python
from enum import Enum
from dataclasses import dataclass, field

class FixtureCategory(str, Enum):
    WASH_PRIMARY = "Wash_Primary"
    WASH_SECONDARY = "Wash_Secondary"
    SPOT = "Spot"

@dataclass
class Fixture:
    id: str
    category: FixtureCategory
    universe: int
    address: int                      # adresse DMX de base (1-based)
    channel_map: dict[str, int]       # attribut -> offset de canal (0-based)

class MovementShape(str, Enum):
    CIRCLE = "circle"
    FIGURE_EIGHT = "figure_eight"

@dataclass
class PositionCue:
    id: str
    shape: MovementShape
    speed: float        # rad/beat (omega)
    phase: float        # rad
    radius: int         # amplitude DMX autour du centre (0..128)
    center_pan: int = 128
    center_tilt: int = 128
    def pan(self, beat: float) -> int: ...
    def tilt(self, beat: float) -> int: ...

@dataclass
class AttributeCue:
    id: str
    attribute: str                  # "color", "gobo", "focus", "zoom", ...
    values: dict[str, int]          # canal -> valeur DMX cible
    ramp_beats: float = 0.0         # durée d'interpolation (beats) ; 0 = snap
    interpolate: bool = True

@dataclass
class ChannelKey:
    channel: str        # nom de canal logique ("pan","tilt","red","dimmer",...)
    beat: float         # position dans le loop (beats depuis 0)
    value: int          # DMX 0..255
    ramp_beats: float = 0.0

@dataclass
class AutoloopTimeline:
    id: str
    bars: int                       # 8/16/32/64/128
    category: FixtureCategory       # fixtures ciblées
    keys: list[ChannelKey] = field(default_factory=list)
    position_cue: PositionCue | None = None
    def length_beats(self) -> int: return self.bars * 4
```

Formules du PositionCue (à documenter en commentaire) :
- Cercle : `pan = center + radius*cos(omega*beat + phase)`, `tilt = center + radius*sin(omega*beat + phase)`.
- Huit (Lissajous 1:2) : `pan = center + radius*sin(omega*beat + phase)`, `tilt = center + radius*sin(2*omega*beat + phase)`.
- Clamp DMX [0,255], `round`.

### Module 2 — `generator.py` (écrit par l'agent M2)

```python
def generate_autoscript(target_bars: int, available_cues: dict, rules: dict | None = None) -> AutoloopTimeline
```
- `available_cues` = `{"position_cues": list[PositionCue], "attribute_cues": list[AttributeCue], "fixtures": list[Fixture], "category": FixtureCategory}`.
- `rules` (défauts) = `{"min_color_repeat_bars": 2, "color_change_every_bars": 4}`.
- Contraintes à respecter : **jamais la même couleur sur 2 mesures consécutives** ; **changer de couleur toutes les N barres** (N=4) ; assigner les PositionCues **par catégorie de fixture** ; émettre des `ChannelKey` par fixture (adresse DMX = `fixture.address + channel_map[canal]`).
- Le générateur répartit les AttributeCues sur la grille temporelle (grille = beats, `target_bars * 4` beats).

### Module 3 — `playback.py` (écrit par l'agent M3)

```python
class DmxOutput(Protocol):
    def send(self, channels: dict[int, int]) -> None: ...   # adresse DMX -> valeur

class BeatClock:
    def update_bpm(self, bpm: float) -> None
    def on_beat(self, bar: int, beat: int) -> None   # callback depuis l'hôte DJ

class PlaybackEngine:
    def __init__(self, output: DmxOutput) -> None
    def load(self, loop: AutoloopTimeline) -> None
    def trigger(self) -> None                     # quantize -> démarre à la prochaine barline
    def quantize_delay_ms(self) -> int            # délai ms jusqu'à la prochaine barline
    def bars_to_ms(self, bars: int) -> int        # bar_ms = 4 * 60000 / BPM
    def beat_ms(self) -> float                    # 60000 / BPM
    def override_with(self, loop: AutoloopTimeline) -> None  # pause script (sauve bar/beat), joue loop, reprend
    def _tick(self) -> None                       # rendu de la frame courante (interpolation des ChannelKey)
    def stop(self) -> None
```

Formules (à documenter) :
- `beat_ms = 60000.0 / bpm`
- `bar_ms = 4 * beat_ms`
- Quantisation : si position courante = `(bar, beat)` avec `beat ∈ [0,4)`, `delay_ms = (4 - beat) * beat_ms`.
- Interpolation de clé : entre deux `ChannelKey` consécutifs, valeur linéaire `v = v0 + (v1 - v0) * clamp((beat - b0) / ramp_beats, 0, 1)` ; `ramp_beats == 0` → snap.
- Override : sauvegarder `(bar, beat)` du script + état DMX courant → jouer le loop pendant `loop.bars` bars → reprendre le script à `bar + loop.bars`.

### Module 4 — `banks.py` (écrit par l'agent M4)

```python
BANKS = 4
PER_BANK = 32

class RepeatMode(str, Enum):
    INFINITE = "infinite"
    TRACK_DURATION = "track_duration"

class BankManager:
    def __init__(self) -> None                      # matrice 4x32 (None = vide)
    def store(self, bank: int, slot: int, loop: AutoloopTimeline) -> None
    def get(self, bank: int, slot: int) -> AutoloopTimeline | None
    def lock_bank(self, bank: int) -> None          # mode exclusif
    def unlock_all(self) -> None                    # "Play All Banks"
    def select(self, bank: int, slot: int) -> AutoloopTimeline | None   # filtre par banque verrouillée
    def next(self) -> AutoloopTimeline | None       # cycle dans la banque (exclusive si verrouillée)
    def on_track_loaded(self) -> None               # si TRACK_DURATION : tue le thread loop + régénère
```

### Module 5 (auxiliaire) — `output.py` (écrit par l'agent M3, ou intégré au README)

- Émetteur Art-Net DMX512 minimal en UDP (stdlib `socket`), paquet `ArtDmx` (OpCode 0x5000), pour rendre concret le « latence < 20ms ». Alternatif : callback `DmxOutput` pur (aucune dépendance).

## Stratégie latence < 20ms (à respecter dans le code)

1. **Une boucle temps réel `asyncio`** avec `asyncio.sleep(0)` / horloge monotonic (`time.perf_counter()`) — jamais de `time.sleep` bloquant dans le chemin de rendu.
2. **Pré-calcul des frames** : les `ChannelKey` sont triés par beat ; l'interpolation est O(log n) (bisect) + O(k) par frame, pas de calcul lourd par tick.
3. **Émission UDP non bloquante** : un seul socket Art-Net, buffer réutilisé, `sendto` direct.
4. **Précision** : horloge musicale pilotée par l'hôte (beatgrid) — le moteur ne dérive pas ; il calcule `delay_ms` vers la barline et planifie le démarrage.
5. Budget cible : rendu + envoi < 20 ms, donc aucune allocation Python lourde dans la boucle chaude.

## Table des sous-tâches (S2 → S3)

| # | Sous-tâche | Agent | Fichier de sortie | Perspective | Review axe |
|---|---|---|---|---|---|
| M1 | Data model (PositionCue trig, AttributeCue, FixtureCategory, ChannelKey, AutoloopTimeline) | M1 | `DELIVERY/autoloop/models.py` | Modèle + formules trig | cohérence types + formules |
| M2 | Générateur procédural `generate_autoscript` + règles couleur | M2 | `DELIVERY/autoloop/generator.py` | Algorithme de répartition | respect des règles (pas 2× même couleur, changement 4 bars) |
| M3 | PlaybackEngine + BeatClock + quantisation + override + sortie Art-Net | M3 | `DELIVERY/autoloop/playback.py` (+ `output.py`) | Temps réel / synchro | formules ms, override save/resume, latence |
| M4 | BankManager 4×32 + mode exclusif + Infinite/Track Duration | M4 | `DELIVERY/autoloop/banks.py` | État / mémoire | matrice, exclusivité, threads |
| R | Revue croisée (cohérence inter-modules + formules + fidélité SoundSwitch + latence) | R | `review.md` | Adversarial | — |

Dépendances : M2/M3/M4 dépendent du contrat M1 (signatures figées ci-dessus). M1 peut être écrit en parallèle car son contrat est entièrement spécifié. R dépend des 4 modules.

## S5 — Livrable

- `DELIVERY/autoloop/__init__.py` (re-exports)
- `DELIVERY/README.md` : explications d'architecture + **formules mathématiques** + **choix latence <20ms** + mapping fidélité SoundSwitch.
- `DELIVERY/demo.py` : démo runnable (génère un autoloop, simule un beatgrid, déclenche, override, sortie console).
- Smoke test : `python -m py_compile` sur tous les .py + `python demo.py` (headless, sans Art-Net réseau si non dispo).
