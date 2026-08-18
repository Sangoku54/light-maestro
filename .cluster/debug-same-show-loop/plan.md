# Plan — debug « même show light sur toutes les boucles »

## Contexte
- App : Light Maestro (Electron). Bug : « le même show light est joué sur toutes les boucles » (onglet « Boucles d'ambiance »).
- Diagnostic runtime rapporté par l'utilisateur (bandeau ambre) pour une boucle :
  `[auto-loops] wash/energetic 106bpm | uni0=0 | cue0={1:128,...,221:128} | Stage Wash[c5,p,t] 6 arm[c2,p,t] ... Mini Beam RGBW[c4,p,t] x4`
- Interprétation déjà faite (main agent) : le calcul DMX est CORRECT (couleurs magenta R255/G0/B100 et jaune R255/G255/B0 réparties par fixture, dimmer 255/122/160, pan/tilt 128/140/109/166/96/138), l'univers est correct (0), les fixtures sont correctement analysées (c5/c2/c4 + pan + tilt).
- Fixes déjà appliqués : `8932ed5` (fallback universe -1→0 dans computeDmxCues) et `913b41b` (playLoop attend loadFixtureDefinitions).

## Question restante
Le calcul est bon, la boucle de lecture (fire) avance le temps correctement (RAF + elapsed + dedup). Il reste à vérifier par une revue indépendante :
1. Le chemin d'écriture matérielle (`dmxBridge.write('vc', …)` → arbiter → engine → setChannels) — y a-t-il une raison pour que les writes de la boucle soient silencieusement perdus alors que le stop (writeTransient) éteint bien le hardware ?
2. La progression temporelle — les `cue.time` sont-ils strictement croissants, ou le show est-il statique (tous les cues au même temps) ?
3. Le bug est-il déjà corrigé par les 2 commits (revue contradictoire) ?

## Dispatch (S3)
| # | Subagent | Rôle | Fichier output |
|---|----------|------|----------------|
| 1 | write-path | Revue contradictoire du chemin d'écriture DMX | subagent_01_write_path.md |
| 2 | time-progression | Revue de la progression temporelle des cues | subagent_02_time_progression.md |
| 3 | bug-fixed-check | Le bug est-il déjà corrigé ? preuve demandée | subagent_03_bug_fixed_check.md |

## Livrables (S5)
- Conclusion dans la réponse + éventuel fix complémentaire commité.
