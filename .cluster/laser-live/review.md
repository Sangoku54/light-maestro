# review.md — laser-live : synthèse d'examen et correctifs appliqués

## Cause racine (prouvée par trace DMX, subagent_01)
Le tick de lecture principal (`useDmxPlayback`, `dmx-playback.ts`) ne calculait **aucun** canal laser :
le bloc laser n'existait que dans `computeDmxForCue`, appelé uniquement au crossfade (<0,3 s entre cues).
- Lecture normale : IODA → Program@0 jamais écrit = 0 → cap « Laser off » ; Galaxian → 0 canal écrit → ÉTEINT.
- « Apparition rare toujours la même » : le frame laser du crossfade, quasi identique à chaque fois.

## Correctifs livrés
1. **Bloc laser partagé `computeLaserChannels`** (dmx-playback.ts) appelé par le tick live (ct) ET par computeDmxForCue (cue.time) → mode DMX stable, pattern cyclé, scan X/Y cercle/Lissajous, roue ou gates R/G, vitesses/rotations oscillantes, blanking ouvert.
2. **Détection laser par signature** (fixture-analyzer.ts) : canaux/caps contenant « laser » (« Laser off », « Red Laser »…) → les vrais lasers OFL typés « Color Changer » (IODA, EL-400, Twin Effect, Boom Box) sont enfin traités comme lasers. Heuristique pattern+scan+couleur conservée.
3. **Gate binaire 0/255** (`laserGateValue`) sur les canaux couleur laser type Shutter + **fallback R+G** si palette non représentable (bleue/violette) — plus de laser éteint « par palette ».
4. **Rotations Galaxian** (« Red/Green Laser Rotation ») capturées comme rotations laser (plus perdues dans colourChannels) → faisceaux animés.
5. **Scan speed borné 0-127** (zone « With gaps » évitée sur IODA).
6. **Filet de sécurité laser = 0** au lieu de 128 (dmx-cues) : plus de strobe/macro autonome (Galaxian R/G + Macros).
7. **3D (Stage3D)** : laser à roue allumé (intensité issue de la roue/mode), axes scan X/Y pilotent l'orientation du cône → IODA visible et animé en 3D.
8. **« Allumer » (dmx-helpers)** : lasers 2 gates (Galaxian) et mode (IODA « Program » → DMX mode) écrits au bouton Allumer.

## Réserves connues (décisions assumées)
- `pickLaserModeCap` inchangé : les Boom Box FX2 / Stinger II (modes « Show » sans cap DMX) restent sur un show interne (visible mais autonome) — changer la priorité ferait régresser d'autres lasers ; à traiter avec la liste réelle des fixtures de l'utilisateur.
- Double logique dmx-cues (chemin H, sans appelant) reste séparée mais alignée (mêmes règles gates/fallback/borne/net 0).

## Preuves
- tsc 0 · 269/269 tests (laser-exploit 31 tests).
- Real fixtures (Color Changer) : IODA ch1=233 (DMX) + pattern/roue/scan/rotations animés à chaque frame ; Galaxian gates 255/0 ou 255/255 (fallback) + rotations animées (final-evidence.ts).
- Rapports agents : subagent_01..04.md (+ catalogue_ofl.ts, subagent_03-calc).