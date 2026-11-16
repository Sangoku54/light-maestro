# Plan — QuickShow DRY → 3D (suite : « aucun show joué »)

## Contexte nouveau (log utilisateur)
- Log console sans ligne rouge : vite connecté, `fixture-analyzer.ts:292`
  (8 fixtures analysées par Stage3D pour le rendu), warnings shader THREE.
- Aucun log audio / cues / playback.
- Plus de spam `COM6` (cohérent avec l'activation du dry-run + fix moteur).

## Diagnostic mainline
- `isPlaying` vient de `audioFile.isPlaying` (QuickShowView:2300).
- `cues` générés par `genCues` depuis l'analyse audio (AutoScriptPanel).
- Tick loop bails à `if(!analysis||c.length===0)` (dmx-playback:537) — donc
  sans audio uploadé → pas de cues → pas de playback.
- `if(!api)return` (dmx-playback:497) tuait aussi la 3D si l'API DMX manquait,
  même en dry-run.

## Fix appliqués
1. `dmx-playback.ts:497` → `if(!api && !dryRunRef.current)return;` (le dry-run
   n'exige plus l'API hardware) + `console.warn('[DMX-PLAYBACK] lecture démarrée')`
   qui affiche dryRun/dmxOutput/api/cues/analysis/universes/fixtures.
2. (tour préc.) dry-run coupe réellement le moteur hardware.

## Vérifications
- `tsc --noEmit` exit 0 ; vitest 232 passed (17 fichiers).

## En attente
- [ ] Relecteur indépendant (`dry_3d_fix_review`) : vérifier fix1, trigger
      isPlaying/audio, et chasse aux modes de défaillance silencieux.
- [ ] Livraison finale après retour du relecteur.
