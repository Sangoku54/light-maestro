# plan.md — 3 tracks strobe simultanées = « tout bug »

## Demande utilisateur
« je crée un track strobe sur un wash, qui fonctionne. une 2ème qui fonctionne, une 3ème qui fonctionne. toutes individuellement fonctionnent. mais quand je lance la lecture des 3 en même temps dans mon show, tout bug... »

## Système identifié (S1)
- Les tracks strobe du show = FixtureTrack avec strobeBlocks (fixture-tracks.ts : StrobeBlock {id,time,endTime,speed Hz,endSpeed}), éditées dans TrackTimeline.tsx (L890, L1165, L1230, L3586), target format fixture:/group:/tier:.
- Playback : SongPresetPlayer → useDmxPlayback(fixtureTracksRef) → tick dmx-playback.ts.

## Findings mainline
- Bloc strobe runtime (dmx-playback L914-1002) : trackStrobe = IIFE sur fixtureTrackMap.get(pf.id) → **premier match dans l'ordre du tableau gagne** (si 2 tracks matchent la même fixture, la 2ᵉ est ignorée).
- computeStrobeTrackOverrides (L51-84) : Map.set par fixture → **dernière track écrase** si cibles chevauchantes.
- strobePhase = Math.sin(ct*2π*speed) : phase GLOBALE (ct partagé) → 3 washs strobent en phase si même speed (visuel, pas un bug).
- adaptedSpeed = strobeSpeed × sectionMult (verse 0.8, drop 1.5…) : la vitesse des tracks est MODULÉE par la section — à documenter.
- FixtureTrack type : tous les blocks non optionnels — mais les données viennent du JSON stocké : si une track d'ancien fichier n'a pas strobeBlocks/dimmerBlocks → TypeError dans le tick (à vérifier dans les rapports).
- Crossfade : le snapshot ftoSnap (L690-705) ne contient QUE forcedMovements → forcedStrobes absent du snapshot → pendant les fondus (≤0,15 s) les strobeBlocks sont ignorés.
- Symptôme ambigu (« tout bug ») : valeurs erratiques ? gel ? strobe erratique ? — à préciser par le tracage des agents.

## Dispatch (S2)
- SA-1 analyste-strobe-runtime : bloc strobe du tick multi-tracks (écrasements, phase, shutter) → subagent_01.md
- SA-2 analyste-tracks-strobe : création TrackTimeline + résolution cibles + points de conflit → subagent_02.md

## État
S1/S2 done, S3 running (2 subagents en vol).
