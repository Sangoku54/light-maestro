# -*- coding: utf-8 -*-
"""
Module 3 — Moteur de lecture temps réel des Autoloops (clone SoundSwitch 2.9).

Transforme une :class:`AutoloopTimeline` (module `models`) en flux DMX continu.

Contrairement à un player séquentiel, ce moteur est une **machine à états**
(IDLE / SCRIPT / OVERRIDE_LOOP) avancée par l'hôte DJ via le callback
`on_bar_beat(bar, beat)` : **aucune boucle bloquante** n'est utilisée. En mode
autonome (test sans hôte), la boucle `asyncio.run()` fait avancer une horloge
monotonic (`time.perf_counter()`) et appelle elle-même `on_bar_beat`.

Dépendances : `asyncio`, `bisect`, `time`, `enum`, `typing` — zéro dépendance externe.
"""

from __future__ import annotations

import asyncio
import bisect
import time
from enum import Enum
from typing import Protocol

try:
    from .models import AutoloopTimeline, ChannelKey
except ImportError:  # exécution en script autonome (python playback.py)
    from models import AutoloopTimeline, ChannelKey


def _clamp(x: float, lo: float, hi: float) -> float:
    """Borne `x` dans l'intervalle [lo, hi]."""
    return max(lo, min(hi, x))


class DmxOutput(Protocol):
    """Interface minimale d'une sortie DMX : envoie un mapping adresse -> valeur."""

    def send(self, channels: dict[int, int]) -> None:
        """Émet un état DMX partiel : adresse DMX (1-based) -> valeur 0..255."""
        ...


class BeatClock:
    """Horloge BPM : source de vérité du tempo pour toutes les conversions temps."""

    def __init__(self, bpm: float = 120.0) -> None:
        self._bpm = bpm

    def update_bpm(self, bpm: float) -> None:
        """Met à jour le tempo courant (en battements par minute)."""
        self._bpm = bpm

    @property
    def bpm(self) -> float:
        """Tempo courant, en BPM."""
        return self._bpm


class _State(str, Enum):
    """États de la machine à états du moteur de lecture."""

    IDLE = "idle"                    # rien ne joue (loop éventuellement chargé)
    SCRIPT = "script"                # le script (loop chargé) est en lecture
    OVERRIDE_LOOP = "override_loop"  # un loop d'override temporaire est en lecture


class PlaybackEngine:
    """
    Moteur de lecture d'Autoloops piloté par l'hôte (pas de boucle bloquante).

    Rendu piloté par `on_bar_beat(bar, beat)` : l'hôte DJ fournit la position
    globale (bar, beat) du BeatGrid ; le moteur déduit la phase dans la timeline
    active et émet la frame DMX correspondante.

    Formules de conversion de temps (implémentées littéralement) :

    - ``beat_ms() = 60000.0 / bpm``
    - ``bars_to_ms(bars) = bars * 4 * beat_ms()``   (une bar = 4 * beat_ms)
    - ``quantize_delay_ms()`` : ``(4 - beat) * beat_ms()`` avec ``beat ∈ [0, 4)``

    Interpolation des keyframes : clés triées par ``beat`` ; entre la clé
    précédente (``b0``, ``v0``) et la clé courante (``b1``, ``v1``) :

        ``v = v0 + (v1 - v0) * clamp((beat_pos - b0) / ramp_beats, 0, 1)``

    où ``ramp_beats`` est celui de la clé **cible** (celle en ``b1``). Si
    ``ramp_beats <= 0`` → snap : on tient ``v0`` jusqu'à ``b1`` puis on passe à
    ``v1`` dès que ``beat_pos >= b1``. `bisect` localise la clé en O(log n).
    """

    def __init__(self, output: DmxOutput, bpm: float = 120.0) -> None:
        self.output: DmxOutput = output
        self.clock: BeatClock = BeatClock(bpm)

        self.state: _State = _State.IDLE
        self.loop: AutoloopTimeline | None = None
        # Canal logique ("pan", "tilt", "red", "dimmer", ...) -> adresse DMX (1-based).
        # L'hôte doit renseigner cette correspondance avant le premier rendu.
        self.channel_map: dict[str, int] = {}

        self._keys_by_channel: dict[str, list[ChannelKey]] = {}

        self._current_bar: int = 0
        self._current_beat: float = 0.0
        self._prev_beat: float = 0.0

        self._pending_trigger: bool = False
        self._start_beats: float = 0.0  # position globale (beats) du début de la timeline active
        self._last_dmx: dict[int, int] = {}

        # État sauvegardé lors d'un override (reprise du script après loop.bars bars).
        self._saved_loop: AutoloopTimeline | None = None
        self._saved_start_beats: float = 0.0
        self._saved_bar: int = 0
        self._saved_beat: float = 0.0
        self._saved_dmx: dict[int, int] = {}
        self._override_start_beats: float = 0.0
        self._override_duration_beats: float = 0.0

        self._running: bool = False

    # ------------------------------------------------------------------ #
    # Conversions de temps
    # ------------------------------------------------------------------ #

    def beat_ms(self) -> float:
        """Durée d'un beat en millisecondes : ``60000.0 / bpm``."""
        # beat_ms() = 60000.0 / bpm
        return 60000.0 / self.clock.bpm

    def bars_to_ms(self, bars: int) -> float:
        """Durée de `bars` bars en millisecondes : ``bars * 4 * beat_ms()``."""
        # bar_ms = 4 * beat_ms ; bars_to_ms(bars) = bars * 4 * beat_ms()
        return bars * 4 * self.beat_ms()

    def quantize_delay_ms(self) -> float:
        """
        Délai (ms) avant le prochain barline, selon la position courante.

        Avec ``beat ∈ [0, 4)``, le barline suivant arrive dans ``4 - beat`` beats.
        """
        # (4 - beat) * beat_ms()
        return (4.0 - self._current_beat) * self.beat_ms()

    # ------------------------------------------------------------------ #
    # Cycle de vie
    # ------------------------------------------------------------------ #

    def load(self, loop: AutoloopTimeline) -> None:
        """Charge un loop (script) sans le démarrer : passage à l'état IDLE armé."""
        self.loop = loop
        self._keys_by_channel = self._group_keys(loop.keys)
        self.state = _State.IDLE
        self._pending_trigger = False

    def trigger(self) -> None:
        """
        Démarre le loop au prochain barline (quantisation).

        Arme un drapeau ; le basculement vers SCRIPT s'effectue dans
        `on_bar_beat` à la première frame de barline (beat == 0 ou wrap).
        """
        if self.loop is None:
            return
        self._pending_trigger = True

    def stop(self) -> None:
        """Arrête toute lecture : retour à l'état IDLE."""
        self.state = _State.IDLE
        self._pending_trigger = False
        self._running = False

    def override_with(self, loop: AutoloopTimeline) -> None:
        """
        Joue `loop` temporairement par-dessus le script, puis reprend le script.

        Machine à états SCRIPT → OVERRIDE_LOOP → SCRIPT : on sauvegarde
        ``(bar, beat)`` + l'état DMX courant + la référence du script, on joue
        `loop` pendant ``loop.bars`` bars, puis on reprend le script à
        ``bar + loop.bars`` (même beat).
        """
        # Sauvegarde du script courant (position + état DMX).
        self._saved_loop = self.loop
        self._saved_start_beats = self._start_beats
        self._saved_bar = self._current_bar
        self._saved_beat = self._current_beat
        self._saved_dmx = dict(self._last_dmx)

        # Bascule sur le loop d'override.
        self.loop = loop
        self._keys_by_channel = self._group_keys(loop.keys)
        self._override_start_beats = self._current_bar * 4.0 + self._current_beat
        self._override_duration_beats = loop.length_beats()
        self._start_beats = self._override_start_beats
        self.state = _State.OVERRIDE_LOOP

    # ------------------------------------------------------------------ #
    # Rendu piloté par l'hôte
    # ------------------------------------------------------------------ #

    def on_bar_beat(self, bar: int, beat: float) -> None:
        """
        Callback hôte DJ : position globale ``(bar, beat)`` du BeatGrid.

        Fait avancer la machine à états (déclenchement quantisé, fin d'override)
        puis rend la timeline active en une frame DMX.
        """
        self._current_bar = bar
        self._current_beat = beat

        # Un barline = beat == 0.0, ou bien le beat a rebouclé (wrap).
        is_barline = (beat == 0.0) or (beat < self._prev_beat)

        # Déclenchement quantisé : démarrage du script au barline suivant.
        if self._pending_trigger and is_barline:
            self._pending_trigger = False
            self._start_beats = bar * 4.0 + beat
            self.state = _State.SCRIPT

        # Fin d'un override : reprise du script à bar + loop.bars (même beat).
        if self.state is _State.OVERRIDE_LOOP:
            elapsed = (bar * 4.0 + beat) - self._override_start_beats
            if elapsed >= self._override_duration_beats:
                self._resume_script(bar, beat)

        # Rendu de la timeline active (SCRIPT ou OVERRIDE_LOOP).
        if self.state is _State.SCRIPT or self.state is _State.OVERRIDE_LOOP:
            self._render_frame()

        self._prev_beat = beat

    def _render_frame(self) -> None:
        """Calcule et émet la frame DMX de la timeline active à la position courante."""
        loop = self.loop
        if loop is None:
            return
        global_beats = self._current_bar * 4.0 + self._current_beat
        phase = (global_beats - self._start_beats) % loop.length_beats()
        dmx = self._evaluate(loop, phase)
        self._last_dmx = dmx
        self.output.send(dmx)

    def _evaluate(self, loop: AutoloopTimeline, phase: float) -> dict[int, int]:
        """
        Évalue la timeline à la phase `phase` (en beats) : renvoie un mapping
        adresse DMX -> valeur 0..255.

        Les deux façons de rendre cohabitent :

        1. **Keyframes discrets** (couleur / intensité / pan-tilt ponctuels) via
           l'interpolation par canal des `ChannelKey`.
        2. **Mouvement continu** pan/tilt via `loop.position_cue.pan(phase)` /
           `.tilt(phase)`, qui écrase les canaux pan/tilt s'ils sont présents.
        """
        out: dict[int, int] = {}

        # 1) Keyframes discrets.
        for channel, keys in self._keys_by_channel.items():
            addr = self._resolve_address(channel)
            if addr is None:
                continue
            out[addr] = self._interpolate(keys, phase)

        # 2) Mouvement continu pan/tilt (PositionCue).
        if loop.position_cue is not None:
            pan_addr = self.channel_map.get("pan")
            tilt_addr = self.channel_map.get("tilt")
            if pan_addr is not None:
                out[pan_addr] = loop.position_cue.pan(phase)
            if tilt_addr is not None:
                out[tilt_addr] = loop.position_cue.tilt(phase)

        return out

    def _resolve_address(self, channel: str) -> int | None:
        """
        Résout un identifiant de canal vers une adresse DMX (1-based).

        Deux conventions cohabitent :

        - ``channel`` est un nom logique (« pan », « red », …) : on le remappe
          via ``channel_map`` (à renseigner par l'hôte) ;
        - ``channel`` encode directement l'adresse DMX absolue en chaîne (c'est
          la forme produite par le générateur du module 2, car la timeline ne
          transporte aucune table de fixtures) : on la parse.

        Retourne ``None`` si le canal ne peut être résolu.
        """
        addr = self.channel_map.get(channel)
        if addr is not None:
            return addr
        try:
            return int(channel)
        except (TypeError, ValueError):
            return None

    def _interpolate(self, keys: list[ChannelKey], beat_pos: float) -> int:
        """
        Valeur interpolée d'un canal à la position `beat_pos` (en beats).

        Les clés sont triées par ``beat`` ; `bisect` localise la clé courante en
        O(log n). Entre la clé précédente (``b0``, ``v0``) et la clé courante
        (``b1``, ``v1``) :

            v = v0 + (v1 - v0) * clamp((beat_pos - b0) / ramp_beats, 0, 1)

        ``ramp_beats`` est celui de la clé **cible** (celle en ``b1``). Si
        ``ramp_beats <= 0`` → snap : on tient ``v0`` jusqu'à ``b1``, puis ``v1``
        dès que ``beat_pos >= b1``.
        """
        beats = [k.beat for k in keys]
        idx = bisect.bisect_right(beats, beat_pos)

        if idx <= 0:
            # Avant (ou sur) la première clé : valeur de départ.
            return keys[0].value
        if idx >= len(keys):
            # Après la dernière clé : on tient la dernière valeur.
            return keys[-1].value

        prev = keys[idx - 1]  # clé précédente (b0, v0)
        target = keys[idx]    # clé courante (b1, v1)
        b0, v0 = prev.beat, prev.value
        v1 = target.value
        ramp = target.ramp_beats  # ramp_beats de la clé CIBLE

        if ramp <= 0.0:
            # snap : beat_pos < b1 ici → on tient v0 ; v1 sera atteint au passage de b1.
            return v0

        t = _clamp((beat_pos - b0) / ramp, 0.0, 1.0)
        return int(round(v0 + (v1 - v0) * t))

    def _resume_script(self, bar: int, beat: float) -> None:
        """Reprend le script sauvegardé à ``bar + loop.bars`` (même beat)."""
        saved = self._saved_loop
        if saved is None:
            self.state = _State.IDLE
            return

        # Phase du script au moment de la sauvegarde, avancée de la durée de l'override.
        saved_phase = (self._saved_bar * 4.0 + self._saved_beat) - self._saved_start_beats
        resume_phase = saved_phase + self._override_duration_beats
        now_beats = bar * 4.0 + beat
        self._start_beats = now_beats - resume_phase

        self.loop = saved
        self._keys_by_channel = self._group_keys(saved.keys)
        self.state = _State.SCRIPT

        # Restaure l'état DMX du script pour éviter un trou visuel au raccord.
        self.output.send(self._saved_dmx)
        self._last_dmx = self._saved_dmx

    @staticmethod
    def _group_keys(keys: list[ChannelKey]) -> dict[str, list[ChannelKey]]:
        """Regroupe les clés par canal logique et trie chaque groupe par ``beat``."""
        grouped: dict[str, list[ChannelKey]] = {}
        for key in keys:
            grouped.setdefault(key.channel, []).append(key)
        for channel_keys in grouped.values():
            channel_keys.sort(key=lambda k: k.beat)
        return grouped

    # ------------------------------------------------------------------ #
    # Mode autonome (sans hôte)
    # ------------------------------------------------------------------ #

    async def run(self, *, fps: float = 120.0) -> None:
        """
        Boucle autonome : avance l'horloge via ``time.perf_counter()``.

        Alternative quand aucun beatgrid n'est branché sur `on_bar_beat` (test
        sans hôte). Le tempo est celui de ``self.clock`` ; chaque frame recalcule
        la position ``(bar, beat)`` à partir du temps monotonic écoulé puis appelle
        `on_bar_beat`. La boucle s'arrête sur `stop()`.
        """
        self._running = True
        start = time.perf_counter()
        frame_s = 1.0 / fps
        try:
            while self._running:
                elapsed = time.perf_counter() - start
                beat_s = self.beat_ms() / 1000.0
                total_beats = elapsed / beat_s if beat_s > 0.0 else 0.0
                bar = int(total_beats // 4)
                beat = total_beats - bar * 4.0
                self.on_bar_beat(bar, beat)
                await asyncio.sleep(frame_s)
        finally:
            self._running = False
