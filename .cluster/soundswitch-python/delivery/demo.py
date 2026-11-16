# -*- coding: utf-8 -*-
"""
Démo exécutable du clone de l'Autoloop SoundSwitch 2.9.

Pipeline complet, sans réseau (aucun nœud Art-Net requis) :

    1. Définit des fixtures, des cues de position (cercle / huit) et des
       couleurs.
    2. Génère une timeline procédurale via `generate_autoscript` (module 2).
    3. Stocke et navigue dans la matrice 4×32 via `BankManager` (module 4).
    4. Joue la timeline via `PlaybackEngine` (module 3) avec une sortie DMX
       factice qui collecte les frames.
    5. Déclenche un override puis vérifie la reprise du script.

Usage : `python demo.py` depuis le dossier `DELIVERY/`.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

# Rend le script auto-localisant : ajoute son dossier à sys.path pour pouvoir
# importer le paquet `autoloop` voisin, y compris sous Python embarqué (embedded)
# dont le `._pth` n'ajoute pas le répertoire du script.
sys.path.insert(0, str(Path(__file__).resolve().parent))

# Force une sortie UTF-8 (évite UnicodeEncodeError sur les consoles Windows cp1252).
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

from autoloop import (
    ArtNetOutput,
    AttributeCue,
    BankManager,
    Fixture,
    FixtureCategory,
    MovementShape,
    PlaybackEngine,
    PositionCue,
    RepeatMode,
    generate_autoscript,
)

# --------------------------------------------------------------------------- #
# Sortie DMX factice (collecte les frames au lieu d'émettre sur le réseau)
# --------------------------------------------------------------------------- #


class FakeOutput:
    """Implémente le protocole `DmxOutput` en collectant les frames en mémoire."""

    def __init__(self) -> None:
        self.frames: list[dict[int, int]] = []
        self.last: dict[int, int] = {}

    def send(self, channels: dict[int, int]) -> None:
        self.last = dict(channels)
        self.frames.append(dict(channels))


# --------------------------------------------------------------------------- #
# Fixtures et cues d'exemple
# --------------------------------------------------------------------------- #


def build_fixtures() -> list[Fixture]:
    channel_map = {"pan": 0, "tilt": 1, "red": 2, "green": 3, "blue": 4, "dimmer": 5}
    return [
        Fixture("wash-1", FixtureCategory.WASH_PRIMARY, 1, 1, channel_map),
        Fixture("wash-2", FixtureCategory.WASH_PRIMARY, 1, 9, channel_map),
    ]


def build_cues() -> dict:
    # Cercle : omega = pi/2 → un tour complet en 4 beats (1 bar).
    circle = PositionCue(
        id="circle", shape=MovementShape.CIRCLE,
        speed=math.pi / 2, phase=0.0, radius=100,
    )
    # Huit : Lissajous 1:2.
    eight = PositionCue(
        id="eight", shape=MovementShape.FIGURE_EIGHT,
        speed=math.pi / 4, phase=0.0, radius=90,
    )
    colors = [
        AttributeCue("c-red", "color", {"red": 255, "green": 0, "blue": 0}),
        AttributeCue("c-green", "color", {"red": 0, "green": 255, "blue": 0}),
        AttributeCue("c-blue", "color", {"red": 0, "green": 0, "blue": 255}),
        AttributeCue("c-white", "color", {"red": 255, "green": 255, "blue": 255}),
    ]
    return {"position_cues": [circle, eight], "attribute_cues": colors}


def main() -> int:
    print("== Autoloop SoundSwitch 2.9 — clone Python (démo) ==\n")

    fixtures = build_fixtures()
    cues = build_cues()

    # --- 1. Génération procédurale (module 2) ------------------------------- #
    loop = generate_autoscript(
        target_bars=8,
        available_cues={
            "position_cues": cues["position_cues"],
            "attribute_cues": cues["attribute_cues"],
            "fixtures": fixtures,
            "category": FixtureCategory.WASH_PRIMARY,
        },
    )
    assert loop.keys, "la timeline générée ne doit pas être vide"
    assert loop.length_beats() == 32, "8 bars * 4 beats = 32 beats"
    beats = [k.beat for k in loop.keys]
    assert beats == sorted(beats), "les clés doivent être triées par beat"
    print(f"[1] Timeline générée : {loop.id}")
    print(f"    {len(loop.keys)} keyframes DMX, {loop.bars} bars "
          f"({loop.length_beats()} beats)\n")

    # --- 2. Matrice 4×32 + navigation (module 4) ---------------------------- #
    banks = BankManager()
    banks.store(0, 0, loop)
    banks.populate(1, [loop] * 5)          # remplit les 5 premiers slots libres
    assert banks.select(0, 0) is loop
    banks.lock_bank(1)                      # mode exclusif sur la banque 1
    assert banks.select(0, 0) is None, "banque 0 interdite quand la banque 1 est verrouillée"
    assert banks.next() is loop             # premier loop de la banque 1
    banks.unlock_all()                      # « Play All Banks »
    print(f"[2] Banques : 4×32 = {4 * 32} slots. Sélection active : "
          f"({banks.active_bank}, {banks.active_slot})\n")

    # --- 3. Lecture temps réel (module 3) ----------------------------------- #
    out = FakeOutput()
    engine = PlaybackEngine(out, bpm=120.0)
    assert engine.beat_ms() == 500.0, "60000 / 120 = 500 ms"
    assert engine.bars_to_ms(1) == 2000.0, "1 bar = 4 * 500 = 2000 ms"

    engine.load(loop)
    engine.trigger()                        # quantise : démarre au barline

    # Simule l'hôte DJ : bar 0, beats 0→3, puis bar 1 beats 0→3.
    engine.on_bar_beat(0, 0.0)              # barline → bascule en SCRIPT
    for bar in range(0, 2):
        for beat in range(0, 4):
            engine.on_bar_beat(bar, float(beat))
    assert out.last, "le moteur doit émettre des frames DMX"
    pan_addr = 1                            # fixture 1 : address 1 + offset pan 0
    assert pan_addr in out.last, "le pan de la fixture 1 doit être piloté"
    print(f"[3] Lecture : {len(out.frames)} frames émises.")
    print(f"    pan@1={out.last.get(pan_addr)} tilt@2={out.last.get(2)} "
          f"red@3={out.last.get(3)} green@4={out.last.get(4)} blue@5={out.last.get(5)}\n")

    # Quantisation : à (bar 3, beat 2.0), délai = (4 - 2) * 500 = 1000 ms.
    engine.on_bar_beat(3, 2.0)
    assert abs(engine.quantize_delay_ms() - 1000.0) < 1e-9
    print(f"[4] Quantisation : à (bar 3, beat 2) → délai barline "
          f"{engine.quantize_delay_ms():.0f} ms\n")

    # --- 4. Override puis reprise du script (module 3) ---------------------- #
    override = generate_autoscript(
        target_bars=2,
        available_cues={
            "position_cues": [],
            "attribute_cues": [cues["attribute_cues"][0]],
            "fixtures": fixtures,
            "category": FixtureCategory.WASH_PRIMARY,
        },
    )
    engine.override_with(override)
    # Avance de 2 bars (durée de l'override) depuis la position courante (bar 3),
    # puis un peu au-delà pour franchir la fin de l'override.
    for bar in range(3, 7):
        for beat in range(0, 4):
            engine.on_bar_beat(bar, float(beat))
    assert engine.state.value == "script", "le script doit être repris après l'override"
    print(f"[5] Override : loop 2 bars joué puis reprise du script "
          f"(état={engine.state.value})\n")

    # --- 5. Sortie Art-Net (module auxiliaire) ------------------------------ #
    artnet = ArtNetOutput(universe=0, address=("127.0.0.1", 6454))
    artnet.send({1: 255, 2: 128, 3: 0})
    artnet.close()
    print("[6] Sortie Art-Net : trame ArtDmx émise (universe 0, 512 canaux)\n")

    print("== OK : pipeline complet validé ==")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
