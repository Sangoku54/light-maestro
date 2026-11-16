# Debug « couleurs timeline ≠ couleurs jouées » (récidive)

## Contexte
- App Electron/React « Light Maestro » (DMX light show). Working dir : `C:\Users\vitte\.openclaw-autoclaw\agents\mon-codeur\workspace\light-maestro`.
- Bug récurrent signalé par l'utilisateur : en lecture de la timeline (autoscript), les couleurs jouées ne correspondent pas aux couleurs des blocs ; « toujours la même [couleur] tourne ».
- L'utilisateur demande aussi de vérifier si les commits récents ont cassé la lecture des cues de l'autoscript.

## Faits déjà établis (S1)
- Le calcul de couleur est COHÉRENT : la timeline affiche `hueShiftHex(cue.color, tierDeg)` (TrackTimeline.tsx:2195, fn ligne 29) et le playback `computeDmxForCue` fait `applyHueShift(hexToRgb(cue.color), TIER_HUE[pf.tier])` (dmx-playback.ts:1200-1215). `hueShiftHex` et `applyHueShift` sont le MÊME algorithme HSL ; `TIER_HUE_DEG` == `TIER_HUE` == {primary:0, secondary:120, tertiary:240, other:0}.
- `genCues` (QuickShowView.tsx:442) assigne `color: prevColor` (une couleur de palette par cue) et `colors: sectionPal`.
- `computeDmxForCue` (dmx-playback.ts:1128) lit `cue.forcedColor || cue.color || cue.colors?.[0]` — correct.
- `computeDmxCues` (dmx-cues.ts:543) n'est appelé QUE par le nouveau panneau AutoLoopsPanel + le test theme-loop. PAS dans le chemin autoscript.
- Sources DMX (output-arbiter.ts) : `simple-desk` LTP 100, `fixture-test` LTP 90, `vc` LTP 80, `design-efx` 70, `design-test` 60, `fixture-onoff` 60, `default` 50, `song-preset` HTP 45, `quickshow` HTP 40, `show-manager` 35, `rgb-matrix` 30. MIDI/OSC/MTC sources LTP 70-75.
- Le playback autoscript (useDmxPlayback, dmx-playback.ts:377) utilise `arbSource = arbiterSource ?? 'quickshow'` (HTP 40).

## Hypothèses à tester (par sous-agent, indépendantes)
1. **Avancement/lecture des cues** : `ct` (temps courant) n'avance pas, ou le cue actif est mal sélectionné → couleur figée.
2. **Conflit de sources LTP** : une source de contrôle (simple-desk/fixture-test/vc/MIDI/OSC/MTC) garde les canaux RGB à une valeur fixe et écrase `quickshow` (HTP 40). C'est le bug « même show » (simple-desk jamais relâchée) réintroduit par le rollback.
3. **Régression de mes commits** : `3367499`, `3518cf8`, `f7e7261` ont-ils cassé quelque chose ?
4. **Miroir 3D / bout en bout** : la couleur jouée est-elle correcte sur le hardware mais figée dans la vue 3D (Stage3D lit un cache non miroité) ?

## Sous-agents (round 1, parallèle)
- A : tracer le moteur de lecture (useDmxPlayback + vue qui le pilote) — avancement `ct`, sélection du cue actif, couleur effectivement émise.
- B : tracer le conflit de sources DMX — qui écrit/relâche simple-desk, fixture-test, vc, MIDI/OSC/MTC pendant une lecture timeline.
- C : revue de régression des 3 commits récents vs parent.
- D : tracer le chemin 3D + bout-en-bout (arbitre → Stage3D → hardware).

## Sorties
- `subagent_A_playback.md`, `subagent_B_sources.md`, `subagent_C_regression.md`, `subagent_D_3d.md` (dans ce dossier).
- Synthèse finale dans `DELIVERY/` après correction.
