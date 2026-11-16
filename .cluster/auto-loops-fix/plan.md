# Plan — Auto loops : solution stable + widget Performance

**Statut : TERMINÉ** — audit 4 axes + proposition livrée (aucun code).
Livrable : `DELIVERY/proposition-auto-loops.md`.

**Demande** : « trouver une solution pour les boucles auto, pour qu'elles fonctionnent
normalement ». Objectif final : jouer les auto loops depuis un **widget de Performance**,
pour se passer d'un contrôleur DMX externe (« tout en 1 »). Ne PAS coder — livrer une
**proposition de solution** (design + plan d'implémentation + risques).

**État actuel (post-rollbacks)** : auto-loops v1 = `engine/auto-loops.ts` (générateur +
matérialisation en scenes/chasers) + `views/AutoLoopsPanel.tsx` (onglet dans QuickShow),
joué via `midiPlayChaser(chaserId)`. Refonte « Boucles d'ambiance » v2/v3 et `theme-loop.ts`
**ANNULÉS** par rollback.

## Axes (4 subagents, tour 1)

| # | Rôle | Fichier de sortie | Question centrale |
|---|------|-------------------|-------------------|
| 1 | Audit chemin de lecture `midiPlayChaser` | `subagent_01_lecture_midi.md` | Pourquoi les loops ne jouent pas « normalement » depuis le panneau ? Root cause du chemin midiPlayChaser → DMX |
| 2 | Audit lecture Performance (widget chaser + RAF + audioAutoScript) | `subagent_02_perf_playback.md` | Mécanisme de lecture chaser existant (speed/hold ?), et point d'insertion propre pour un widget « loop » sans audio |
| 3 | Audit qualité moteur auto-loops | `subagent_03_engine_quality.md` | Bugs/limites génération + matérialisation (sémantique speed/hold, couverture tiers, edge cases) |
| 4 | Historique + design (anti-patterns) | `subagent_04_historique_design.md` | Pourquoi v2/v3 + theme-loop ont échoué (rollbacks) ; principes de design pour un widget loop stable ; référence SoundSwitch |

## Revue (S4)
- Cross-check du root cause (subagent 1) contre le mécanisme retenu (subagent 2).
- Vérifier les points d'insertion exacts (lignes) et la sémantique speed/hold.
- Revue contradictoire du design (subagent 4) — un reviewer dédié.

## Livraison (S5)
- `.cluster/auto-loops-fix/DELIVERY/proposition-auto-loops.md` — la proposition finale
  (problème, root cause, solution recommandée, plan d'implémentation, risques, tests).
