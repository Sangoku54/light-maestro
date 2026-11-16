# Plan — Analyse SoundSwitch Autoloops → Proposition viable Light Maestro

**Date** : 2026-08-20 · **Projet** : light-maestro (v1.0.13)
**Demande** : analyse poussée du système d'autoloops de SoundSwitch, adaptation à Light Maestro, puis proposition viable AVANT de coder.
**Lien fourni par l'utilisateur** : ⚠️ ABSENT (perdu à l'envoi) — à réintégrer quand l'utilisateur le recollera.

## Contexte / distinction critique

SoundSwitch a DEUX features distinctes, à ne pas confondre :
- **Autoscript** : analyse audio (beat grid + phrase detection) → génère un script beat-par-beat. *Déjà étudié (subagent_40, orienté MIR/audio).*
- **Autoloops** : système de boucles lumineuses qui « prend le relais » automatiquement quand un morceau n'a pas de script. *C'est L'OBJET de cette analyse.*

## Ce qu'on cherche à comprendre (questions de recherche)

1. **Mécanique** : structure d'un autoloop (nombre d'étapes/scenes, paramètres, fade), loop groups, cycle de vie, différence vs Script vs Static Look.
2. **Timing/BPM** : sync beat/bar, auto BPM (2.9), Loop Auto Strobe, Autoloop Override, attribute cues, comportement au changement de tempo.
3. **Adaptation** : mapping SoundSwitch → Light Maestro (adopter/adapter/ignorer) sur notre Design A (widget Performance + moteur frame-locked + source dédiée `auto-loop`).

## Sous-tâches (1 subagent = 1 fichier)

| # | Subagent | Fichier | Perspective |
|---|----------|---------|-------------|
| 1 | `ss_mechanics` | `subagent_mechanics.md` | Structure + cycle de vie d'un autoloop |
| 2 | `ss_timing` | `subagent_timing.md` | Modèle timing/BPM + features 2.9 |
| 3 | `ss_adapt` | `subagent_adapt.md` | Mapping conceptuel → Light Maestro |
| 4 | `ss_review` | `review.md` (round 2) | Relecture critique / risques / non-transférable |

Round 1 = subagents 1-3 (parallèles). Round 2 = subagent 4 (review, dépend de 1-3). Puis synthèse `DELIVERY/proposition-soundswitch-autoloops.md`.

## Livrable final

`.cluster/auto-loops-fix/DELIVERY/proposition-soundswitch-autoloops.md` — analyse + adaptation + recommandation viable (avant code).
