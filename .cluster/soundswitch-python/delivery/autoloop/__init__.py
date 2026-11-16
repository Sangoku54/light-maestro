"""Clone Python de la fonction « Autoloop » de SoundSwitch 2.9.

Paquet structuré en 4 modules fondamentaux :

- :mod:`models`     — Modèle de données des Cues (PositionCue trigonométrique,
  AttributeCue, FixtureCategory, ChannelKey, AutoloopTimeline).
- :mod:`generator`  — Moteur « Autoscript » (générateur procédural de timeline DMX).
- :mod:`playback`   — Moteur de synchronisation Beatgrid/Timecode (PlaybackEngine,
  quantisation, override) + :mod:`output` (émission Art-Net DMX512).
- :mod:`banks`      — Gestion des banques (matrice 4×32) et modes de performance.

Latence cible : rendu + envoi DMX/Art-Net < 20 ms.
"""

from __future__ import annotations

from .models import (
    AttributeCue,
    AutoloopTimeline,
    ChannelKey,
    Fixture,
    FixtureCategory,
    MovementShape,
    PositionCue,
    clamp_dmx,
)
from .generator import DEFAULT_RULES, generate_autoscript
from .playback import BeatClock, DmxOutput, PlaybackEngine
from .output import ArtNetOutput
from .banks import BANKS, PER_BANK, BankManager, RepeatMode

__all__ = [
    "AttributeCue",
    "AutoloopTimeline",
    "ChannelKey",
    "Fixture",
    "FixtureCategory",
    "MovementShape",
    "PositionCue",
    "clamp_dmx",
    "DEFAULT_RULES",
    "generate_autoscript",
    "BeatClock",
    "DmxOutput",
    "PlaybackEngine",
    "ArtNetOutput",
    "BANKS",
    "PER_BANK",
    "BankManager",
    "RepeatMode",
]

__version__ = "0.1.0"
