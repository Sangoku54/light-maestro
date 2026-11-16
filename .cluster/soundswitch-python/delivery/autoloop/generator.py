# -*- coding: utf-8 -*-
"""
Module 2 — Moteur « Autoscript » : générateur procédural de timeline DMX.

Clone de la fonction « Autoloop » de SoundSwitch 2.9 : à partir d'un jeu de
cues (positions + attributs) et d'une catégorie de fixtures, on produit une
:class:`AutoloopTimeline` — une timeline continue alignée sur les bars, remplie
de keyframes DMX (:class:`ChannelKey`) triés par beat.

Le contrat exact des types est celui de :mod:`models` (module 1) ; on les
importe, on ne les redéfinit jamais.

--------------------------------------------------------------------------------
ALGORITHME — vue d'ensemble
--------------------------------------------------------------------------------
On construit d'abord un « plan » par beat (liste de slots temporels), puis on
applique les contraintes (greedy avec lookahead sur les couleurs), puis on
linéarise le plan en :class:`ChannelKey`.

    1. Normalisation      : fusion des règles, filtrage des fixtures par
                            catégorie ciblée.
    2. Planification      : placement des cues sur la grille `target_bars * 4`
                            beats (grille = 1 beat).
       a. Couleurs        : un nouveau cue couleur au début de chaque bloc de
                            `color_change_every_bars` bars, choisi par greedy
                            LRU (pas de même couleur à moins de
                            `min_color_repeat_bars` bars).
       b. Attributs       : les cues non-couleur (gobo/focus/zoom/…) sont posés
                            à des beats discrets espacés d'au moins 2 bars.
    3. Linéarisation      : chaque cue → ChannelKey DMX ABSOLUES, une par
                            (fixture, canal logique). Rampe → 2 clés
                            (ancre + cible) ; snap → 1 clé.
    4. Position           : chaque PositionCue est échantillonné par beat, pour
                            chaque fixture de la catégorie, en pan/tilt
                            (interpolation linéaire entre beats).
    5. Tri stable par beat.

--------------------------------------------------------------------------------
RÈGLES IMPLÉMENTÉES (le cœur du cahier des charges)
--------------------------------------------------------------------------------
1. Répartition des AttributeCue sur la grille `target_bars * 4` beats.
2. Jamais la même couleur sur 2 mesures consécutives : un même id de cue
   `attribute == "color"` ne peut pas réapparaître à moins de
   `min_color_repeat_bars` bars (défaut 2) d'écart.
3. Changement de couleur toutes les `color_change_every_bars` bars (défaut 4) :
   un nouveau cue couleur au début de chaque bloc de 4 bars.
4. Assignation des PositionCue par catégorie : on produit les ChannelKey
   pan/tilt (via `PositionCue.pan(beat)` / `.tilt(beat)`) échantillonnés par
   beat, pour CHAQUE fixture de la catégorie, mappés vers
   `channel_map["pan"]` / `channel_map["tilt"]`.
5. AttributeCue non-couleur posés à des beats discrets (≥ 2 bars d'écart), en
   respectant `ramp_beats`.
6. `ramp_beats > 0` (et `interpolate=True`) → deux ChannelKey (début + fin de
   rampe) pour l'interpolation côté moteur ; sinon un seul ChannelKey (snap).

--------------------------------------------------------------------------------
CHOIX D'IMPLÉMENTATION (pourquoi)
--------------------------------------------------------------------------------
- **Greedy + lookahead LRU pour les couleurs.** Le nombre de couleurs est
  petit (une poignée par banque). Une recherche exhaustive/backtracking serait
  exponentielle pour un gain nul : il suffit, à chaque bloc, de choisir une
  couleur qui n'est ni la précédente ni « trop récente ». Le lookahead est une
  heuristique LRU (Least Recently Used) : parmi les candidates légales on prend
  la plus anciennement utilisée, ce qui maximise la marge avant sa prochaine
  réutilisation et réduit les impasses. Dégradation en deux paliers si aucune
  candidate légale n'existe : (a) on n'exige plus que « différente de la
  précédente », (b) en dernier recours (une seule couleur) on réutilise.
- **Interdiction de répéter une couleur sur 2 mesures consécutives.** C'est la
  règle visuelle centrale d'un Autoloop : un aller-retour de couleur trop
  rapide (barre i puis barre i+1) produit un effet de « clignotement » perçu
  comme un bug de fixture, et casse la respiration musicale. En espaçant de
  `min_color_repeat_bars` on garantit un changement lisible.
- **`ChannelKey.channel` = adresse DMX absolue (en chaîne).** Le contrat du
  module 2 impose des adresses ABSOLUES (`fixture.address +
  fixture.channel_map[canal]`). Or `ChannelKey.channel` est un `str`, et la
  timeline ne transporte AUCUNE table de fixtures (uniquement la catégorie) :
  le moteur de playback (module 3) ne pourrait pas remapper un nom logique
  (« pan ») vers une adresse. On encode donc l'adresse absolue en chaîne
  (`str(address)`), ce qui rend chaque clé auto-suffisante pour l'émission DMX.
- **Position échantillonnée par beat, `ramp_beats = 1.0` entre beats.** Le
  mouvement est matérialisé en keyframes (pas via `position_cue`, laissé à
  `None` pour éviter une double application par le moteur). Chaque sample porte
  `ramp_beats = 1.0` (sauf beat 0, ancre) : le moteur interpole linéairement
  d'un beat au suivant, approchant la trajectoire trigonométrique continue sans
  effet « escalier ».

--------------------------------------------------------------------------------
COMPLEXITÉ (visée O(bars × fixtures × canaux))
--------------------------------------------------------------------------------
- Échantillonnage position  : O(bars × fixtures × 2) — terme dominant.
- Planification couleurs    : O(blocs × couleurs).
- Planification attributs   : O(nb_attributs).
- Linéarisation attributs   : O(cues × fixtures × canaux_par_cue).
- Tri final (stable)        : O(K log K) avec K = nombre de clés émises ; c'est
  le seul pas super-linéaire, négligeable devant l'échantillonnage.
"""

from __future__ import annotations

from itertools import count

# ---------------------------------------------------------------------------
# Import des types du module 1 (contrat figé, ne pas redéfinir).
# Fallback sur l'import absolu pour permettre l'exécution directe
# (`python generator.py`) hors contexte de paquet.
# ---------------------------------------------------------------------------
try:
    from .models import (
        AttributeCue,
        AutoloopTimeline,
        ChannelKey,
        Fixture,
        FixtureCategory,
        MovementShape,
        PositionCue,
    )
except ImportError:  # pragma: no cover — exécution directe hors paquet
    from models import (
        AttributeCue,
        AutoloopTimeline,
        ChannelKey,
        Fixture,
        FixtureCategory,
        MovementShape,
        PositionCue,
    )

# ---------------------------------------------------------------------------
# Constantes publiques
# ---------------------------------------------------------------------------

#: Nombre de beats par mesure (signature 4/4, hypothèse de l'Autoloop SoundSwitch).
BEATS_PER_BAR: int = 4

#: Espacement minimal entre deux cues d'attribut non-couleur, en bars.
MIN_ATTRIBUTE_SPACING_BARS: int = 2

#: Règles par défaut du générateur (fusionnées avec `rules` si fourni).
DEFAULT_RULES: dict[str, int] = {
    "min_color_repeat_bars": 2,
    "color_change_every_bars": 4,
}

# Compteur monotone d'identifiants de timelines (unicité intra-processus).
_id_counter = count(1)


# ---------------------------------------------------------------------------
# Helpers privés
# ---------------------------------------------------------------------------

def _channel_address(fixture: Fixture, logical: str) -> int | None:
    """
    Adresse DMX absolue (1-based) du canal logique pour une fixture.

    `fixture.address` est l'adresse de base (1-based) ; `channel_map` donne
    l'*offset* (0-based) d'un attribut logique. L'adresse absolue vaut donc
    `address + offset`. Retourne ``None`` si la fixture ne possède pas ce canal.
    """
    offset = fixture.channel_map.get(logical)
    if offset is None:
        return None
    return fixture.address + offset


def _schedule_colors(
    color_cues: list[AttributeCue],
    length_beats: int,
    min_repeat_bars: int,
    change_every_bars: int,
) -> list[tuple[float, AttributeCue]]:
    """
    Planifie les cues couleur sur les frontières de blocs (règles 2 et 3).

    Chaque bloc de `change_every_bars` bars reçoit un cue couleur au début du
    bloc. Le choix est un greedy avec lookahead LRU :

    - candidates « légales » : ≠ couleur du bloc précédent ET non utilisée
      depuis moins de `min_repeat_bars` bars ;
    - parmi elles on prend la plus anciennement utilisée (LRU) pour maximiser
      la marge avant sa prochaine réutilisation ;
    - dégradation : si aucune légale, on exige seulement « ≠ précédente » ;
    - dernier recours (une seule couleur) : réutilisation assumée.

    Returns:
        Liste de paires ``(beat, cue)`` ordonnées chronologiquement.
    """
    if not color_cues:
        return []

    placements: list[tuple[float, AttributeCue]] = []
    # Dernier beat où chaque couleur (par id) a été posée — contrainte de répétition.
    last_used: dict[str, float] = {}

    min_gap_beats = min_repeat_bars * BEATS_PER_BAR
    block_beats = change_every_bars * BEATS_PER_BAR
    previous_id: str | None = None

    def _age(cue: AttributeCue) -> float:
        return last_used.get(cue.id, float("-inf"))

    for block_beat in range(0, length_beats, block_beats):
        # 1) candidates strictes : légales sur les deux contraintes.
        candidates = [
            c for c in color_cues
            if c.id != previous_id
            and block_beat - last_used.get(c.id, float("-inf")) >= min_gap_beats
        ]
        if candidates:
            chosen = min(candidates, key=_age)  # lookahead LRU
        else:
            # 2) relaxe de la contrainte de répétition : juste « ≠ précédente ».
            relaxed = [c for c in color_cues if c.id != previous_id]
            if relaxed:
                chosen = min(relaxed, key=_age)
            else:
                # 3) une seule couleur effective : réutilisation (dégradation).
                chosen = color_cues[0]

        placements.append((float(block_beat), chosen))
        last_used[chosen.id] = float(block_beat)
        previous_id = chosen.id

    return placements


def _schedule_attributes(
    attribute_cues: list[AttributeCue],
    length_beats: int,
    min_spacing_bars: int,
) -> list[tuple[float, AttributeCue]]:
    """
    Planifie les cues d'attribut non-couleur à des beats discrets (règle 5).

    Espacement minimal de `min_spacing_bars` bars entre deux cues. Si l'espace
    le permet, on répartit uniformément sur la boucle ; sinon on conserve
    l'espacement minimal et on reboucle (modulo) pour ne perdre aucun cue.

    Returns:
        Liste de paires ``(beat, cue)``.
    """
    if not attribute_cues:
        return []

    n = len(attribute_cues)
    min_gap = min_spacing_bars * BEATS_PER_BAR

    if n * min_gap <= length_beats:
        # Assez d'espace : répartition uniforme (gap ≥ min_gap).
        spacing = length_beats / n
        beats = [i * spacing for i in range(n)]
    else:
        # Trop de cues : espacement minimal + wraparound (dégradation documentée).
        beats = [(i * min_gap) % length_beats for i in range(n)]

    return [(float(beat), cue) for beat, cue in zip(beats, attribute_cues)]


def _emit_attribute_keys(
    placements: list[tuple[float, AttributeCue]],
    fixtures: list[Fixture],
) -> list[ChannelKey]:
    """
    Linéarise les placements d'attribut en ChannelKey DMX absolues (règle 6).

    - Rampe effective = `ramp_beats` si `ramp_beats > 0` et `interpolate` ;
      sinon 0 (snap). Un gobo en `interpolate=False` ne « balaye » pas les
      gobos intermédiaires.
    - Rampe : deux clés — une ancre au début (valeur précédente, snap) + une
      cible en fin (valeur cible, `ramp_beats` = durée). Snap : une seule clé.
    - La « valeur précédente » est suivie par canal absolu (`current`) ; pour
      la première occurrence d'un canal on fait un snap (rien à interpoler).

    Note (limite connue) : si une rampe chevauche un cue antérieur du même
    canal, l'ancre reprend la dernière valeur connue (approximation).

    Args:
        placements: paires ``(beat, cue)``, traitées dans l'ordre chronologique.
        fixtures: fixtures cibles (déjà filtrées par catégorie).

    Returns:
        Liste de ChannelKey (non triée ici).
    """
    keys: list[ChannelKey] = []
    current: dict[str, int] = {}  # adresse DMX (str) → dernière valeur posée

    for beat, cue in sorted(placements, key=lambda p: p[0]):
        ramp = cue.ramp_beats if (cue.ramp_beats > 0 and cue.interpolate) else 0.0

        for fixture in fixtures:
            for logical, value in cue.values.items():
                address = _channel_address(fixture, logical)
                if address is None:
                    continue  # fixture sans ce canal : on saute
                ch = str(address)

                if ramp > 0 and ch in current:
                    # Début de rampe : ancre la valeur précédente.
                    anchor_beat = max(0.0, beat - ramp)
                    if anchor_beat < beat:
                        keys.append(ChannelKey(
                            channel=ch,
                            beat=anchor_beat,
                            value=current[ch],
                            ramp_beats=0.0,
                        ))
                    # Fin de rampe : valeur cible, interpolation sur `ramp`.
                    keys.append(ChannelKey(
                        channel=ch,
                        beat=beat,
                        value=value,
                        ramp_beats=ramp,
                    ))
                else:
                    # Snap (rampe nulle ou première occurrence du canal).
                    keys.append(ChannelKey(
                        channel=ch,
                        beat=beat,
                        value=value,
                        ramp_beats=0.0,
                    ))

                current[ch] = value

    return keys


def _emit_position_keys(
    position_cues: list[PositionCue],
    fixtures: list[Fixture],
    length_beats: int,
) -> list[ChannelKey]:
    """
    Échantillonne les PositionCue par beat en pan/tilt (règle 4).

    Pour chaque PositionCue et chaque fixture de la catégorie, on émet un
    keyframe pan et un keyframe tilt par beat, mappés vers
    `channel_map["pan"]` / `channel_map["tilt"]`. `ramp_beats = 1.0` entre
    beats (interpolation linéaire lisse) ; beat 0 sert d'ancre (`ramp_beats
    = 0.0`). Plusieurs PositionCue sont échantillonnés dans l'ordre : à beat
    égal, le dernier écrit gagne côté moteur.

    Args:
        position_cues: liste des mouvements à matérialiser.
        fixtures: fixtures cibles (déjà filtrées par catégorie).
        length_beats: durée totale du loop en beats.

    Returns:
        Liste de ChannelKey (non triée ici).
    """
    keys: list[ChannelKey] = []

    for cue in position_cues:
        for fixture in fixtures:
            pan_addr = _channel_address(fixture, "pan")
            tilt_addr = _channel_address(fixture, "tilt")
            for beat in range(length_beats):
                ramp = 0.0 if beat == 0 else 1.0
                if pan_addr is not None:
                    keys.append(ChannelKey(
                        channel=str(pan_addr),
                        beat=float(beat),
                        value=cue.pan(float(beat)),
                        ramp_beats=ramp,
                    ))
                if tilt_addr is not None:
                    keys.append(ChannelKey(
                        channel=str(tilt_addr),
                        beat=float(beat),
                        value=cue.tilt(float(beat)),
                        ramp_beats=ramp,
                    ))

    return keys


# ---------------------------------------------------------------------------
# API publique
# ---------------------------------------------------------------------------

def generate_autoscript(
    target_bars: int,
    available_cues: dict,
    rules: dict | None = None,
) -> AutoloopTimeline:
    """
    Génère la timeline DMX procédurale d'un Autoloop.

    Args:
        target_bars: durée cible du loop en bars (8/16/32/64/128 chez
            SoundSwitch ; tout entier ≥ 1 est accepté).
        available_cues: dictionnaire de cues disponibles, au contrat exact
            ``{"position_cues": list[PositionCue],
              "attribute_cues": list[AttributeCue],
              "fixtures": list[Fixture],
              "category": FixtureCategory}``.
        rules: surcharges de règles (fusionnées avec :data:`DEFAULT_RULES`) ;
            clés reconnues : ``"min_color_repeat_bars"`` et
            ``"color_change_every_bars"``.

    Returns:
        Une :class:`AutoloopTimeline` dont ``keys`` est la liste des
        :class:`ChannelKey` (adresses DMX absolues, triés par ``beat``).
    """
    # --- 1. Règles : fusion des défauts avec les éventuelles surcharges. ---
    merged: dict[str, int] = dict(DEFAULT_RULES)
    if rules:
        merged.update(rules)
    min_repeat_bars = max(1, int(merged["min_color_repeat_bars"]))
    change_every_bars = max(1, int(merged["color_change_every_bars"]))
    target_bars = max(1, int(target_bars))

    # --- 2. Extraction + filtrage des fixtures par catégorie cible. ---
    category = available_cues.get("category")
    if category is None:
        raise ValueError(
            "available_cues doit contenir une clé 'category' (FixtureCategory)."
        )

    fixtures = [
        f for f in available_cues.get("fixtures", [])
        if f.category == category
    ]
    position_cues: list[PositionCue] = available_cues.get("position_cues", [])
    attribute_cues: list[AttributeCue] = available_cues.get("attribute_cues", [])

    length_beats = target_bars * BEATS_PER_BAR

    color_cues = [c for c in attribute_cues if c.attribute == "color"]
    other_cues = [c for c in attribute_cues if c.attribute != "color"]

    # --- 3. Plan par beat (slots temporels). ---
    color_placements = _schedule_colors(
        color_cues, length_beats, min_repeat_bars, change_every_bars
    )
    attr_placements = _schedule_attributes(
        other_cues, length_beats, MIN_ATTRIBUTE_SPACING_BARS
    )

    # --- 4. Linéarisation en ChannelKey. ---
    keys: list[ChannelKey] = []
    keys.extend(_emit_attribute_keys(color_placements + attr_placements, fixtures))
    keys.extend(_emit_position_keys(position_cues, fixtures, length_beats))

    # --- 5. Tri stable par beat (exigence du contrat). ---
    keys.sort(key=lambda k: k.beat)

    # Identifiant unique (compteur monotone, sans état global partagé).
    loop_id = f"autoscript-{category.value}-{target_bars}b-{next(_id_counter)}"

    # `position_cue` reste None : le mouvement est intégralement matérialisé en
    # keyframes pan/tilt ci-dessus, pour éviter une double application par le
    # moteur de playback.
    return AutoloopTimeline(
        id=loop_id,
        bars=target_bars,
        category=category,
        keys=keys,
        position_cue=None,
    )


__all__ = [
    "DEFAULT_RULES",
    "BEATS_PER_BAR",
    "MIN_ATTRIBUTE_SPACING_BARS",
    "generate_autoscript",
]
