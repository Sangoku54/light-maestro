# plan.md — Track dimmer vs autoscript (QuickShow)

## Demande utilisateur
« vérifies que la '+ track dimmer' dans le quick show prend bien la priorité sur l'autoscript, et sur toutes les fixtures, ce n'est pas le cas en ce moment »

## Ressources
- Symptôme : preset.dimmerTracks (créées via « + track dimmer » dans QuickShowView) doivent primer sur les cues autoscript (genCues) au playback, sur TOUTES les fixtures.
- Mécanisme existant : computeDimmerTrackOverrides (dmx-playback.ts L86-130) → application runtime L747-806 (force dimmerVal puis écriture forcée sur intensityOffset) + computeDmxForCue L1373-1421 (chemin cue/preview, dto en 9ᵉ param).
- SongPresetPlayer branche dimmerTracksRef (L107, L245) ; arbiter source 'song-preset' HTP 45.

## Findings mainline (avant rapports subagents)
1. **Crossfade dilue l'override (CONFIRMÉ)** : L706-709 appelle computeDmxForCue avec le 9ᵉ param (dimmerTrackOverrides) = **undefined** → nextCueDmx sans override → L1210 mélange override*(1-t) + autoscript*t → pendant le fade le dimmer track est corrompu (fenêtre ≤0,3 s).
2. **Chaser takeover écrase tout le range (by design)** : L1162-1201 delete chVals[a] puis réécrit les canaux du chaser — le dimmer track est perdu sur les fixtures d'une chaser track active.
3. **Écriture limitée à intensityOffset** (1er canal intensité reconnu) : fixtures multi-dimmer (master+fines, multi-heads) partiellement couvertes — à confirmer avec l'analyse fixture-analyzer (SA-1).
4. ComputeDmxForCue reçoit dto correctement dans QuickShowView L136 (aperçu) mais à vérifier PerformanceView L1356/L1877.

## Dispatch (S2)
- SA-1 analyste-dimmer-show : chaîne track dimmer (fixture-tracks, dmx-playback, QuickShowView création) → subagent_01.md
- SA-2 analyste-autoscript : chaîne autoscript (autoscript-generator, SongPresetPlayer, enregistrement arbiter, suspension) → subagent_02.md
- SA-3 analyste-arbiter : output-arbiter + dmx-bridge, toutes sources dimmer, cause racine + arbitrage cible → subagent_03.md

## État
- S1 done, S2 done (3 subagents en vol), S3 running.
- Fix à préconiser (hypothèse) : final-pass dimmer track en fin de boucle par univers (après efx/chaser/crossfade) + passer dimmerTrackOverrides au snapshot crossfade + couverture multi-dimmer selon SA-1.
