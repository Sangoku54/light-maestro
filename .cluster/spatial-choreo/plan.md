# plan.md — Chorégraphie spatiale (1.0.20)

## Tâche
Implémenter la chorégraphie spatiale dans la génération automatique de show light :
vagues gauche→droite, alternances/checkerboard, croisements, expansion, rotation —
basées sur les positions 3D réelles des fixtures (fixturePositionsRef).

## Contexte connu (ne pas re-vérifier)
- dmx-playback.ts : fixturePositionsRef?: Record<string,{x,y}> (L371), passé à computeDmxForCue (L682) ;
  getSmartMovement distribué par fixture (L1007/1021) ; motorCount = max(panCount, tiltCount) (L961) ;
  tick FX modulé par section (_FXPROF 1.0.19).
- QuickShowView.tsx : genCues (L444+) ; cues ont section/intensity/colors/movement/movementAmplitude/movementSpeed/activeTiers.
- Version courante : 1.0.19. Suite 290/290. Conventions : patch CRLF-safe node, tsc, vitest, build electron-builder.

## Dépendances
Round 1 (parallèle) → subagent_01, subagent_02, subagent_03
Round 2 (après round 1) → implémentation mainline (patches + tests)
Round 3 → subagent_04 (review adverse du patch) → corrections → build 1.0.20 → DELIVERY

## Subtâches (1 subagent = 1 fichier)
| # | Rôle | Perspective | Output | Review item |
|---|------|-------------|--------|-------------|
| 1 | Auditeur moteur spatial | lecture dmx-playback.ts + Stage3D + dmx-channel.ts : où sont les positions, format exact, comment getSmartMovement les consomme, points d'ancrage précis (lignes/extraits) | subagent_01.md | précision des ancrages |
| 2 | Benchmark patterns | web : SoundSwitch/Madrix/Lightjams/Resolume, effets spatiaux auto ; 4-6 patterns avec formules (phase=f(pos), direction, vitesse) | subagent_02.md | faisabilité formules |
| 3 | Audit chaîne génération | QuickShowView genCues + selectMovementPattern + SMART_MOVEMENTS : où brancher un champ spatialPattern, contraintes (manualCues/chaser/disabledFixtures) | subagent_03.md | points de branchement |
| 4 | Review adverse (round 3) | relecture du patch réel : perfs 60fps, overflow DMX, fixtures sans position, régressions | subagent_04.md | risques bloquants |
