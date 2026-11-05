# Revue croisée — QuickShow DRY → 3D

## Vérification indépendante (subagent dry_3d_trace) vs analyse mainline

Les deux convergent :

1. **Le bouton DRY ne casse PAS la 3D.** `dryRunMode` n'agit que via
   `dmxBridge.setDryRun()` → flag `_dryRun`, lu uniquement dans
   `flushToHardware` (`dmx-bridge.ts:54`). `setUniverseData`/`onVirtualDmx`
   (`dmx-playback.ts:1113/1118`) restent inconditionnels → `appStore.channelData`
   est toujours mis à jour, et c'est la seule source lue par Stage3D
   (`Stage3D.tsx:1492-1493,1504`).

2. **`dryRunRef` était du code mort** (`dmx-playback.ts:381`) : jamais lu
   après l'assignation. Le commit `0a15075` a migré le skip hardware vers le
   bridge mais a laissé le moteur hardware démarrer quand même en dry-run.

3. **La panne COM6 / le fail-safe blackout hardware n'écrivent PAS dans
   `channelData`** du renderer (`engine.ts` blackoutState est côté main process,
   non propagé au store renderer).

## Gates réels qui bloquent l'animation 3D (liste exhaustive)

- `isPlaying` false (`dmx-playback.ts:446`) → boucle RAF inactive.
- absence API DMX (`:497`) → early return.
- `dmxOutputEnabled` false (bouton Zap) (`:525`).
- `analysis` null : fixtures/universes vides (`:392`) ou fixtureDef manquant (`:397`).
- `cues` vide (`:529`).
- freeze (`:555`), pas de cue active à ct (`:597`), fixtures disabled (`:716`).
- `chVals` vide (`:1103-1105`), `sig` inchangé (`:1109`).
- côté Stage3D : `channelData[universeIndex]` absent (`:1524`), intensité non mappée
  (`:1553`), shutter fermé (`:1570`), blackout (`:1583`), grandMaster (`:1585`).

## Correctif appliqué

`src/hooks/dmx-playback.ts` — le dry-run coupe désormais réellement le hardware :
- arrêt du moteur à l'activation du dry-run (nouvel effet `[dryRunMode]`),
- guard `dryRunRef.current` sur les 3 sites de démarrage/redémarrage du moteur
  (effet de montage, re-tentative au premier tick, re-check ~2s).

## Vérifications

- `tsc --noEmit` : exit 0.
- vitest : 232 passed / 17 fichiers.
