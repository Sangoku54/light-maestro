# -*- coding: utf-8 -*-
"""
Module 1 — Modèle de données des Cues pour le clone de l'Autoloop de SoundSwitch 2.9.

Un *Autoloop* est une timeline continue, alignée sur les bars (8/16/32/64/128 bars),
remplie de cues posés sur le BeatGrid. Ce n'est **pas** une liste de scenes : chaque
cue décrit un état DMX (position, attribut) à un instant `beat` précis du loop.

Ce module ne contient QUE des structures de données et leurs mathématiques associées.
Aucune dépendance externe : uniquement `enum`, `dataclasses` et `math`.

Contrat de signature : NE PAS modifier les noms de classes, d'attributs ni les
signatures de méthodes. Les modules 2 (génération), 3 (playback) et 4 (export)
s'appuient exactement sur ce contrat.
"""

from __future__ import annotations

import math
from enum import Enum
from dataclasses import dataclass, field


def clamp_dmx(v: float) -> int:
    """
    Borne une valeur DMX dans l'intervalle valide [0, 255] puis l'arrondit.

    Le DMX n'accepte que des entiers 0..255. Toute sortie d'une fonction
    trigonométrique (pan/tilt) peut légèrement déborder de cet intervalle
    (centre + amplitude) ou produire des flottants ; cette fonction garantit un
    octet DMX légal et stable.

    Ordre des opérations : on borne d'abord le flottant dans [0.0, 255.0], puis on
    arrondit au plus proche (`round`), enfin on convertit en `int`. Borner avant
    d'arrondir évite qu'un 255.6 ne devienne 256 après l'arrondi.

    Args:
        v: valeur DMX (flottant) potentiellement hors bornes.

    Returns:
        Entier DMX dans [0, 255].
    """
    return int(round(max(0.0, min(255.0, v))))


class FixtureCategory(str, Enum):
    """
    Catégorie de fixtures ciblée par un Autoloop.

    SoundSwitch regroupe les fixtures en « Washes » (faisceaux larges, fond de
    scène) et « Spots » (faisceaux serrés, mobiles rapides). Un Autoloop ne pilote
    qu'une catégorie à la fois.
    """

    WASH_PRIMARY = "Wash_Primary"      # washes principaux (première rangée)
    WASH_SECONDARY = "Wash_Secondary"  # washes secondaires (deuxième rangée)
    SPOT = "Spot"                      # spots / moving heads


@dataclass
class Fixture:
    """
    Description DMX statique d'une fixture physique.

    Une fixture est identifiée par un `id` unique, appartient à un univers DMX et
    occupe une plage de canaux contiguë à partir de `address` (1-based, convention
    DMX). Le `channel_map` fait correspondre un attribut logique (« pan », « tilt »,
    « red », « dimmer »…) à un *offset* de canal relatif à `address` (0-based).
    """

    id: str
    category: FixtureCategory
    universe: int
    address: int                  # adresse DMX de base (1-based)
    channel_map: dict[str, int]   # attribut -> offset de canal (0-based)


class MovementShape(str, Enum):
    """
    Forme de mouvement disponible pour un cue de position.
    """

    CIRCLE = "circle"            # cercle paramétrique (cos, sin)
    FIGURE_EIGHT = "figure_eight"  # huit via courbe de Lissajous 1:2


@dataclass
class PositionCue:
    """
    Cue de *position* : décrit un mouvement continu pan/tilt dans le loop.

    Contrairement à un état statique, un PositionCue définit une trajectoire
    paramétrique en fonction du temps (exprimé en beats). Le mouvement est porté par
    trois paramètres :

    - `speed` (omega, en rad/beat) : vitesse angulaire. Sur 4 beats (1 bar), un
      omega de pi/2 décrit un tour complet (2*pi rad sur 4 beats).
    - `phase` (rad) : décalage de départ de la trajectoire (où démarre le point).
    - `radius` (0..128) : amplitude DMX autour du centre. 128 est le demi-déflecteur
      max pour rester dans [0,255] avec un centre à 128.

    `center_pan` / `center_tilt` définissent le centre de la figure (128 = centre
    optique par défaut).
    """

    id: str
    shape: MovementShape
    speed: float        # rad/beat (omega)
    phase: float        # rad
    radius: int         # amplitude DMX autour du centre (0..128)
    center_pan: int = 128
    center_tilt: int = 128

    def pan(self, beat: float) -> int:
        """
        Calcule la position pan (canal DMX 0..255) à un instant `beat`.

        Forme CIRCLE :
            pan = center_pan + radius * cos(omega*beat + phase)

        Le cosinus est la projection horizontale du point qui tourne sur le cercle
        unité : en avançant dans le temps, la paire (cos, sin) décrit un cercle dans
        le plan (pan, tilt). C'est exactement la définition paramétrique d'un cercle
        centré sur (center_pan, center_tilt) et de rayon `radius`.

        Forme FIGURE_EIGHT (Lissajous 1:2) :
            pan = center_pan + radius * sin(omega*beat + phase)

        Pour le huit, on utilise une courbe de Lissajous où le pan oscille à la
        fréquence de base et le tilt à la fréquence double (voir `tilt`). La
        combinaison des deux sinusoïdes de fréquences 1 et 2 trace un huit : le
        point repasse par le centre deux fois par cycle complet.

        Le résultat est borné à [0,255] et arrondi via `clamp_dmx`.
        """
        if self.shape is MovementShape.CIRCLE:
            return clamp_dmx(self.center_pan + self.radius * math.cos(self.speed * beat + self.phase))
        # FIGURE_EIGHT
        return clamp_dmx(self.center_pan + self.radius * math.sin(self.speed * beat + self.phase))

    def tilt(self, beat: float) -> int:
        """
        Calcule la position tilt (canal DMX 0..255) à un instant `beat`.

        Forme CIRCLE :
            tilt = center_tilt + radius * sin(omega*beat + phase)

        Le sinus est la projection verticale du point en rotation. Déphasé de 90°
        (pi/2) par rapport au cosinus du pan, il garantit que (pan, tilt) parcourt
        bien un cercle — pas une diagonale. Si pan et tilt utilisaient le même
        cosinus, le point se déplacerait seulement le long d'une droite.

        Forme FIGURE_EIGHT (Lissajous 1:2) :
            tilt = center_tilt + radius * sin(2*omega*beat + phase)

        Le tilt oscille à fréquence DOUBLE de celle du pan. Le rapport de fréquences
        1:2 (avec déphasage nul) produit une figure en forme de huit : pendant un
        cycle de pan, le tilt fait un aller-retour complet, croisant le centre à
        mi-parcours, ce qui dessine les deux boucles du huit.

        Le résultat est borné à [0,255] et arrondi via `clamp_dmx`.
        """
        if self.shape is MovementShape.CIRCLE:
            return clamp_dmx(self.center_tilt + self.radius * math.sin(self.speed * beat + self.phase))
        # FIGURE_EIGHT
        return clamp_dmx(self.center_tilt + self.radius * math.sin(2 * self.speed * beat + self.phase))


@dataclass
class AttributeCue:
    """
    Cue d'*attribut* : décrit un changement d'état non-positionnel d'une fixture.

    Exemples d'attributs : « color », « gobo », « focus », « zoom », « dimmer »…

    - `values` : mapping canal logique -> valeur DMX cible (0..255). Un même
      attribut peut piloter plusieurs canaux (ex. une couleur = red + green + blue).
    - `ramp_beats` : durée d'interpolation (en beats) pour atteindre les valeurs
      cibles ; 0 = application instantanée (snap).
    - `interpolate` : si True, l'interpolation est autorisée ; si False, on applique
      les valeurs en snap même si `ramp_beats` est non nul (par ex. changement de
      gobo qui ne doit pas « balayer » les gobos intermédiaires).
    """

    id: str
    attribute: str                # "color", "gobo", "focus", "zoom", ...
    values: dict[str, int]        # canal -> valeur DMX cible
    ramp_beats: float = 0.0       # durée d'interpolation (beats) ; 0 = snap
    interpolate: bool = True


@dataclass
class ChannelKey:
    """
    Un *keyframe* DMX élémentaire : un canal logique à une valeur donnée, à un
    instant `beat` précis du loop.

    C'est l'unité atomique qui remplit la timeline. Le module 2 (génération) produit
    une liste de ChannelKey à partir des PositionCue / AttributeCue ; le module 3
    (playback) les lit dans l'ordre pour sortir le flux DMX.

    - `channel` : identifiant de canal. Par convention c'est un nom logique
      (« pan », « tilt », « red », « dimmer », …) ; le générateur (module 2)
      encode l'**adresse DMX absolue en chaîne** (ex. ``"13"``) pour rendre la
      timeline auto-suffisante, le moteur (module 3) acceptant les deux formes.
    - `beat` : position dans le loop (en beats depuis le début, 0 = départ).
    - `value` : DMX 0..255.
    - `ramp_beats` : durée d'interpolation depuis le keyframe précédent ; 0 = snap.
    """

    channel: str
    beat: float
    value: int
    ramp_beats: float = 0.0


@dataclass
class AutoloopTimeline:
    """
    La timeline complète d'un Autoloop.

    - `bars` : longueur du loop en bars (8/16/32/64/128). La longueur en beats vaut
      `bars * 4` (4 temps par bar en signature 4/4).
    - `category` : catégorie de fixtures ciblées par ce loop.
    - `keys` : liste ordonnée des keyframes DMX (ChannelKey) remplissant le loop.
    - `position_cue` : un mouvement pan/tilt optionnel appliqué en continu sur toute
      la durée du loop (indépendant des keyframes discrets).
    """

    id: str
    bars: int                       # 8/16/32/64/128
    category: FixtureCategory       # fixtures ciblées
    keys: list[ChannelKey] = field(default_factory=list)
    position_cue: PositionCue | None = None

    def length_beats(self) -> int:
        """
        Longueur totale du loop en beats.

        En signature 4/4 (hypothèse de l'Autoloop SoundSwitch), chaque bar contient
        4 beats. La durée du loop est donc `bars * 4` beats.
        """
        return self.bars * 4
