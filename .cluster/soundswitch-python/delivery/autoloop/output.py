# -*- coding: utf-8 -*-
"""
Sortie DMX Art-Net (stdlib `socket` uniquement, zéro dépendance).

Émet des trames `ArtDmx` (OpCode 0x5000) vers un nœud Art-Net (SoundSwitch, QLC+,
Madrix, ...). Le buffer UDP est **pré-alloué** et réutilisé, et le socket est
**non bloquant** : l'envoi d'une frame est une simple réécriture d'en-tête +
`sendto`, sans allocation ni attente réseau → latence d'envoi < 20 ms.
"""

from __future__ import annotations

import socket

_ARTNET_HEADER = b"Art-Net\x00"
_OPCODE_ARTDMX = 0x5000
_PROTOCOL_VERSION = 14
_PACKET_LENGTH = 530  # 18 octets d'en-tête + 512 octets de données DMX


class ArtNetOutput:
    """
    Sortie DMX Art-Net minimale (ArtDmx, Art-Net 3).

    Le header est écrit **une seule fois** dans un `bytearray(530)` pré-alloué ; à
    chaque `send`, seuls l'octet de séquence et les canaux fournis sont réécrits
    avant le `sendto`. Le socket est UDP et non bloquant.

    Pourquoi latence d'envoi < 20 ms :

    - **Buffer pré-alloué** : aucune allocation mémoire ni reconstruction du header
      par frame (l'en-tête Art-Net est constant, seuls les octets de données et la
      séquence changent). Le coût par frame se réduit à quelques écritures d'octets.
    - **UDP non bloquant** : `sendto` rend la main immédiatement sans attendre que
      la pile réseau draine le tampon (aucun blocage sur un récepteur lent). Si le
      tampon OS est plein (`BlockingIOError`), on saute la frame au lieu d'attendre.

    Résultat : l'émission d'une frame reste de l'ordre de la dizaine de microsecondes
    de CPU, très en dessous du budget de 20 ms par frame DMX.
    """

    def __init__(self, universe: int, address: tuple[str, int] = ("127.0.0.1", 6454)) -> None:
        self._universe = universe & 0x7FFF  # univers 15 bits (0..32767)
        self._address = address
        self._sequence = 0

        self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._sock.setblocking(False)

        # Buffer réutilisé : header écrit une fois, data réécrite à la volée.
        self._buffer = bytearray(_PACKET_LENGTH)
        self._buffer[0:8] = _ARTNET_HEADER
        self._buffer[8] = _OPCODE_ARTDMX & 0xFF          # OpCode 0x5000 little-endian : octet bas
        self._buffer[9] = (_OPCODE_ARTDMX >> 8) & 0xFF   # octet haut (0x50)
        self._buffer[10] = 0x00                          # ProtVerHi
        self._buffer[11] = _PROTOCOL_VERSION             # ProtVerLo = 14
        self._buffer[13] = 0x00                          # Physical = 0
        self._buffer[14] = self._universe & 0xFF         # Universe little-endian : octet bas
        self._buffer[15] = (self._universe >> 8) & 0x7F  # octet haut (15 bits)
        self._buffer[16] = 0x02                          # Length 512 big-endian : octet haut
        self._buffer[17] = 0x00                          # octet bas

    def send(self, channels: dict[int, int]) -> None:
        """
        Émet une frame ArtDmx avec les canaux fournis (adresse DMX 1-based -> 0..255).

        Les canaux non fournis conservent leur dernière valeur (l'univers DMX est
        un état persistant). La séquence est auto-incrémentée modulo 256.
        """
        self._sequence = (self._sequence + 1) & 0xFF
        self._buffer[12] = self._sequence

        for address, value in channels.items():
            idx = address - 1  # adresse DMX 1-based -> offset 0-based dans la trame
            if 0 <= idx < 512:
                self._buffer[18 + idx] = max(0, min(255, value))

        try:
            self._sock.sendto(self._buffer, self._address)
        except BlockingIOError:
            # Socket non bloquant plein : on saute cette frame plutôt que d'attendre.
            pass

    def close(self) -> None:
        """Ferme le socket UDP."""
        self._sock.close()
