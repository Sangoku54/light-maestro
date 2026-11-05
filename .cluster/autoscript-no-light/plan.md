# plan.md — autoscript 1.0.31 : sélection OK dans la modale, plus AUCUNE lumière à la lecture audio

## Demande utilisateur
« dans l'autoscript, en sélectionnant les projecteurs, depuis la nouvelle modale, ils fonctionnent. à la lecture de l'audio, plus aucune lumière ne se joue. analyses et corriges » — version 1.0.31, 341 fichiers en WIP non committé (grosse évolution depuis 1.0.25 : modules autoloop-engine/runtime/generator, programmerStore, clockStore, MasterClockBar, ProgrammerBar, audio-cache, SoundSwitchAutoloop…).

## Chaîne identifiée (mainline)
- Vue autoscript = QuickShowView (cues = genCues ; modales tracks L2633-2687 : efx/color/strobe/dimmer/show/chaser avec targetFixtures {type all/group/fixture, fixtureIds, groupId}).
- Sélection fixtures timeline : checkbox canvas TrackTimeline L1264-1283 → handleToggleFixture QuickShowView L1977 → disabledFixtures Set ; tick dmx-playback L932 `if (disabledFixturesRef?.current?.has(pf.id)) continue;`.
- Lecture : audioFile (useAudioFileLoader) → currentTimeRef (sync au render L2525-26) → useDmxPlayback (isPlaying L2531).
- Gates du tick (dmx-playback) : L705 dmxEnabled ; L709 analysis null OU cues vides → return silencieux ; L766 pas de cue active → blackout ; L932 disabledFixtures. RAF sans try/catch global → une exception dans le tick = noir total.
- Precompute analysis L526-578 : null si patchedFixtures vides OU universes vides.

## Hypothèses (classées, à confirmer par les analystes)
1. Filtre de sélection au playback : la modale stocke une sélection (IDs) que le moteur lit à l'envers / format mismatch (id vs fixtureDefId) → exclusion de toutes les fixtures → noir.
2. disabledFixtures rempli à l'envers par la nouvelle modale (sélection = disable).
3. Crash du RAF tick (exception non catchée) après passage par la modale → noir total (console errors).
4. analysis null au play (fixtures/universes vides au moment du precompute) → return silencieux.
5. Programmer/clockStore prend la main et blackout l'autoscript.

## Dispatch (S3)
- SA-1 analyste-modale-autoscript : modale + stockage sélection + consommation au playback → .cluster\autoscript-no-light\subagent_01.md
- SA-2 analyste-lecture-audio : chaîne play → DMX + nouveaux modules qui court-circuitent → .cluster\autoscript-no-light\subagent_02.md

## État
S1/S2 done, S3 running (2 subagents en vol). Fix à écrire après convergence des rapports (S4/S5).
