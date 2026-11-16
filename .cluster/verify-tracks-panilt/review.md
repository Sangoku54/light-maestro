# review.md — Vérification tracks customs + pan/tilt (post-1.0.20)

## Round 1 — 3 audits (subagent_11/12/13.md)
### SA-A Tracks (subagent_11) : 3 bloquants
1. `movementPhase` aléatoire injecté dans la phase des fixtures sous track (dmx-playback L554 → L1047) → déphasage aléatoire des tracks. Fix : garde `(trackMovement?0:movementPhase)`.
2. `MovementBlock` sans champ `speed` → la cadence d'un track suit la vitesse audio-reactive de l'autoscript. Fix : `speed?`/`endSpeed?` sur MovementBlock + respect dans tick/compute (+ création UI inchangée → fallback auto si absent).
3. Snapshot de crossfade calculé sans tracks ni chaser (L683-688) → le blend ~150 ms mélange pan/tilt track et autoscript. Fix : forcedMovements + chaserTakeover calculés au snapshot.
- Vérifié OK : amplitude/pattern/limites 128, gardes spatiales, chaser takeover (delete+write), EFX bypass, manualCues, disabledFixtures, preview (forcedMovements passés), fallback inaccessible aux tracks.

### SA-B Pan/tilt (subagent_12) : AUCUN bloquant
- Collecte (fixture-analyzer L400-411, fine exclus — validé par exécution : Tonio panOffsets:[0] tiltOffsets:[2..8]), motorCount max(pan,tilt,1) partout avec guardes, cues sur tous les offsets, 3D (tête par tilt, pan master), limites clampées 0-255, asymétriques sans débordement.
- Non-bloquants : fine jamais écrit (8-bit only) + coarse écrit dans le canal fine (incorrect 16-bit, dmx-cues L858-879) ; computeDmxForCue sans panTiltLimitsRef ; cues statiques sans phase par bras ; dmx-channel.ts mort ; extraHeads tilts only ; pas de test multi-bras permanent.

### SA-C Variété (subagent_13) : 3 bloquants
1. **Seed jamais persistée** : `regenSeed` jamais écrit (SongPresetPlayer L100 lit ?? 0) → tous les presets rejouent seed 0 → patterns/amplitudes/vitesses/spatials identiques entre presets du même genre. Fix : `{ ...qs, regenSeed: key }` à l'export/save + `setKey` au load.
2. **Cap d'amplitude 128** : formules 140-250 capées → drop = 128 constant, chorus = 128 dès bass≥0.16. Fix : formules étalées sous 128 (drop 100+bass*28, chorus 90+bass*38, verse 80+rms*48, bridge 60+rms*68, build 60-128/100-128).
3. **Pattern `pulse` mort** : dans le type (dmx-cues L111-125), jamais dans les pools ni les switchs → default. Fix : case 'pulse' dans les 2 switchs + pool build.
- Vérifié OK : variété intra-show (7 pools, 4-5 patterns/section, distributions par seed), motorPhase par moteur, spatial complémentaire.

## Round 2 — Revue adverse
- Revue adverse du patch 1.0.20 (subagent_04, turn précédente) : déjà intégrée/corrigée (garde !trackMovement).
- Les corrections ci-dessus (6 fixes) seront revalidées : tsc + vitest + build.

## Décisions
- 6 fixes appliqués dans le patch (3 tracks + 3 variété). Non-bloquants documentés (fine 16-bit, panTiltLimitsRef crossfade, cues statiques multi-bras, dmx-channel.ts, extraHeads) → lot 2 potentiel, pas de correctif risqué sans retour firmware.
- Livraison : bump 1.0.21 (les fixes touchent moteur + génération) → build NSIS + portable.
