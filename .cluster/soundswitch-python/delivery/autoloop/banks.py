"""Module 4 — Gestion des banques et des modes de performance.

Clone Python de la fonction « Autoloop » de SoundSwitch 2.9.

Responsabilités
---------------
Ce module implémente la couche de stockage et de navigation des Autoloops,
ainsi que les deux mécanismes de performance propres à SoundSwitch 2.9 :

* **Matrice 4 × 32** : ``BANKS`` (4) banques contenant chacune ``PER_BANK``
  (32) emplacements, soit **128 Autoloops** au total. Le terme « loop groups »
  n'existe pas dans SoundSwitch 2.9 : on parle de *banques* (banks) et
  d'*emplacements* (slots).

* **Mode exclusif** : verrouiller une banque restreint la sélection à cette
  seule banque (voir :meth:`BankManager.lock_bank`). ``locked_bank = None``
  correspond au mode « Play All Banks » : les 4 banques sont parcourues.

* **Répétition** (:class:`RepeatMode`) :
  * ``INFINITE`` — la timeline rejoue en boucle (retour au début à la fin) ;
  * ``TRACK_DURATION`` — à chaque événement ``Track_Loaded`` de l'hôte, le
    thread de l'Autoloop courant est annulé puis un nouvel Autoloop est généré.

Gestion de thread
-----------------
L'annulation d'un thread est **documentée mais non exécutée**, afin de garder
le module testable en synchrone. Le mécanisme canonique serait un
``threading.Event`` (voir :meth:`BankManager.on_track_loaded`) : chaque Autoloop
lancé possède son propre ``Event`` de fin ; signaler ``event.set()`` demande au
worker d'interrompre sa boucle de rendu, puis ``thread.join(timeout=…)`` attend
l'arrêt propre avant de générer le remplaçant.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from .models import AutoloopTimeline

# Dimensions de la matrice de banques (SoundSwitch 2.9 : 4 × 32 = 128).
BANKS = 4
PER_BANK = 32

# Nombre total d'emplacements, parcourus dans l'ordre « banque puis slot ».
_TOTAL = BANKS * PER_BANK


class RepeatMode(str, Enum):
    """Mode de répétition d'un Autoloop."""

    #: La timeline rejoue en boucle (retour au début à la fin).
    INFINITE = "infinite"

    #: La timeline dure jusqu'au prochain chargement de piste
    #: (événement ``Track_Loaded`` de l'hôte).
    TRACK_DURATION = "track_duration"


@dataclass
class BankManager:
    """Gestionnaire de la matrice 4 × 32 et des modes de performance.

    Attributs
    ---------
    repeat_mode : mode de répétition (``INFINITE`` par défaut).
    banks : matrice ``[banque][emplacement]`` contenant une
        :class:`~models.AutoloopTimeline` ou ``None`` si l'emplacement est vide.
    active_bank / active_slot : position de l'Autoloop sélectionné.
    locked_bank : banque verrouillée en mode exclusif, ou ``None`` pour
        « Play All Banks » (parcours des 4 banques).
    """

    repeat_mode: RepeatMode = RepeatMode.INFINITE
    banks: list[list[AutoloopTimeline | None]] = field(
        default_factory=lambda: [[None] * PER_BANK for _ in range(BANKS)]
    )
    active_bank: int = 0
    active_slot: int = 0
    locked_bank: int | None = None  # None = « Play All Banks ».

    # ------------------------------------------------------------------ #
    # Accès bas niveau à la matrice                                        #
    # ------------------------------------------------------------------ #

    def store(self, bank: int, slot: int, loop: AutoloopTimeline) -> None:
        """Écrit ``loop`` à l'emplacement ``(bank, slot)``.

        Lève :class:`IndexError` si ``bank`` ou ``slot`` est hors matrice.
        """
        if not (0 <= bank < BANKS and 0 <= slot < PER_BANK):
            raise IndexError(f"Emplacement hors matrice : ({bank}, {slot})")
        self.banks[bank][slot] = loop

    def get(self, bank: int, slot: int) -> AutoloopTimeline | None:
        """Retourne le loop à ``(bank, slot)``, ou ``None`` (vide / hors matrice)."""
        if not (0 <= bank < BANKS and 0 <= slot < PER_BANK):
            return None
        return self.banks[bank][slot]

    # ------------------------------------------------------------------ #
    # Mode exclusif (« Play All Banks »)                                   #
    # ------------------------------------------------------------------ #

    def lock_bank(self, bank: int) -> None:
        """Verrouille la sélection sur ``bank`` (mode exclusif).

        Lève :class:`IndexError` si ``bank`` est hors matrice.
        """
        if not (0 <= bank < BANKS):
            raise IndexError(f"Banque hors matrice : {bank}")
        self.locked_bank = bank

    def unlock_all(self) -> None:
        """Rétablit le mode « Play All Banks » (aucune banque verrouillée)."""
        self.locked_bank = None

    def is_slot_allowed(self, bank: int, slot: int) -> bool:
        """Indique si ``(bank, slot)`` est sélectionnable.

        Filtre par banque verrouillée : en mode exclusif, seule la banque
        ``locked_bank`` est autorisée. Retourne ``False`` si l'emplacement est
        hors matrice.
        """
        if not (0 <= bank < BANKS and 0 <= slot < PER_BANK):
            return False
        if self.locked_bank is None:
            return True  # « Play All Banks » : tout est autorisé.
        return bank == self.locked_bank

    # ------------------------------------------------------------------ #
    # Sélection et navigation                                              #
    # ------------------------------------------------------------------ #

    def select(self, bank: int, slot: int) -> AutoloopTimeline | None:
        """Sélectionne l'Autoloop à ``(bank, slot)``.

        Retourne ``None`` (sans modifier la sélection active) si :
          * l'emplacement est hors matrice ;
          * l'emplacement est vide ;
          * une banque est verrouillée et ``bank != locked_bank``.

        Sinon, met à jour ``active_bank`` / ``active_slot`` et retourne le loop.
        """
        if not (0 <= bank < BANKS and 0 <= slot < PER_BANK):
            return None
        if not self.is_slot_allowed(bank, slot):
            return None
        loop = self.banks[bank][slot]
        if loop is None:
            return None
        self.active_bank = bank
        self.active_slot = slot
        return loop

    def next(self) -> AutoloopTimeline | None:
        """Sélectionne l'Autoloop suivant, ordre « banque puis slot ».

        Parcourt la matrice en sautant les emplacements vides et les banques
        non autorisées (mode exclusif), avec retour au début en fin de matrice
        (wrap-around). Retourne ``None`` si aucun Autoloop n'est sélectionnable.
        """
        return self._walk(direction=1)

    def previous(self) -> AutoloopTimeline | None:
        """Sélectionne l'Autoloop précédent, ordre inverse « banque puis slot ».

        Mêmes règles que :meth:`next`, en sens inverse.
        """
        return self._walk(direction=-1)

    def _walk(self, direction: int) -> AutoloopTimeline | None:
        """Parcours circulaire de la matrice dans ``direction`` (+1 / -1).

        Explore les 128 emplacements à partir de la position active, dans
        l'ordre banque→slot (ou inverse), en ignorant les slots vides et les
        banques non autorisées. Met à jour ``active_bank`` / ``active_slot``
        dès qu'un Autoloop est trouvé.
        """
        start = self.active_bank * PER_BANK + self.active_slot
        for step in range(1, _TOTAL + 1):
            index = (start + direction * step) % _TOTAL
            bank, slot = divmod(index, PER_BANK)
            if not self.is_slot_allowed(bank, slot):
                continue
            loop = self.banks[bank][slot]
            if loop is not None:
                self.active_bank = bank
                self.active_slot = slot
                return loop
        return None

    # ------------------------------------------------------------------ #
    # Répétition — mode « Track Duration »                                  #
    # ------------------------------------------------------------------ #

    def on_track_loaded(self, generator: object) -> AutoloopTimeline | None:
        """Réagit à l'événement ``Track_Loaded`` de l'hôte.

        ``generator`` est un appelable (``Callable[[], AutoloopTimeline]``) qui
        produit un nouvel Autoloop à partir du contexte courant.

        * Si ``repeat_mode`` vaut ``INFINITE`` : ne fait rien (le moteur rejoue
          la timeline en boucle) et retourne ``None``.
        * Si ``repeat_mode`` vaut ``TRACK_DURATION`` : « tue » le loop courant
          (l'emplacement actif est remis à vide ; ``active_bank`` /
          ``active_slot`` sont conservés pour désigner l'emplacement régénéré),
          puis appelle ``generator()`` pour produire un nouvel
          :class:`AutoloopTimeline`, le stocke dans le slot courant et le
          retourne.

        Annulation d'un thread (non exécutée ici, module synchrone) : dans une
        version réelle, chaque Autoloop lancé disposerait d'un
        ``threading.Event`` de fin ; sur ``Track_Loaded`` on ferait
        ``event.set()`` pour demander au worker d'interrompre sa boucle, puis
        ``thread.join(timeout=…)`` avant de générer le remplaçant.
        """
        if self.repeat_mode != RepeatMode.TRACK_DURATION:
            return None  # INFINITE : le moteur rejoue la timeline en boucle.

        # « Tue » le loop courant : remise à vide de l'emplacement actif.
        self.banks[self.active_bank][self.active_slot] = None

        # Génère et stocke le remplaçant dans le slot courant.
        new_loop = generator()  # type: ignore[operator]
        self.banks[self.active_bank][self.active_slot] = new_loop
        return new_loop

    # ------------------------------------------------------------------ #
    # Remplissage de banque                                                #
    # ------------------------------------------------------------------ #

    def populate(self, bank: int, loops: list[AutoloopTimeline]) -> None:
        """Remplit les emplacements *libres* de ``bank`` avec ``loops``.

        Les loops sont placés dans l'ordre (emplacements 0 → 31), sans écraser
        les emplacements déjà occupés ; le remplissage s'arrête quand ``loops``
        est épuisé ou la banque pleine. Lève :class:`IndexError` si ``bank``
        est hors matrice.
        """
        if not (0 <= bank < BANKS):
            raise IndexError(f"Banque hors matrice : {bank}")
        row = self.banks[bank]
        iterator = iter(loops)
        for slot in range(PER_BANK):
            if row[slot] is None:
                try:
                    row[slot] = next(iterator)
                except StopIteration:
                    break


__all__ = ["BANKS", "PER_BANK", "BankManager", "RepeatMode"]
