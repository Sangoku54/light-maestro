# Plan d'exécution — Phase 1 « Crédibiliser » (lot réseau + arbitre + latence + audit)

**Date** : 2026-08-14 · **Base** : `backup-pre-phase1-20260814` (commit `7284261`) · zip `.openclaw/backups/light-maestro-src-20260814-pre-phase1.zip` (651 Ko)

## Périmètre du turn (4 items réalistes de la Phase 1)

| # | Tâche | Sous-agent | Fichiers (périmètre strict) | Livrable |
|---|-------|-----------|------------------------------|----------|
| 13 | sACN récepteur + merge de sources + monitoring réseau | sacn_merge_monitoring | `electron/dmx/engine.ts` (zone sACN UNIQUEMENT), `electron/main.ts` (handlers réseau), `electron/preload.ts` (API réseau), composant UI monitoring | subagent_12_sacn.md |
| 18 | Arbitre de priorité HTP/LTP (QuickShow/RGB matrix/VC/Simple Desk) | htp_ltp_arbiter | renderer : `src/hooks/dmx-playback.ts`, stores, composants qui écrivent les canaux ; NE PAS toucher engine.ts sauf nécessité prouvée | subagent_13_htp.md |
| 21 | Latence audio→DMX mesurée et affichée | latence_affichee | `src/hooks/audio-analysis.ts`, `src/utils/dmx-bridge.ts` (timestamp émission), UI (TopBar/statut) ; NE PAS toucher engine.ts | subagent_14_latence.md |
| 14 | Audit MIDI (état réel, prérequis) | audit_midi | lecture seule : `electron/` (module midi), preload, UI MIDI ; AUCUNE modification | subagent_15_midi.md |

## Dépendances
- Aucune entre les 4 (ensembles disjoints). Zonage strict signalé dans chaque brief.
- Round 2 (après retours) : revue adversarial du diff vs `backup-pre-phase1-20260814`.

## Étapes
1. ✅ Sauvegarde (commit + tag + zip)
2. 🔄 Dispatch 4 sous-agents (round 1)
3. ⏳ Round 2 : revue adversarial des diffs
4. ⏳ Vérification finale : tsc 0, vitest 26/26, build, commit
5. ⏳ Livraison : rapport Phase 1 + liens

## Note playbook
`.cluster/expert-playbook.md` absent du workspace — dispatch conforme aux règles du mode cluster appliquées directement (briefs complets, zonage, rapports subagent_NN.md, revue adversarial).
