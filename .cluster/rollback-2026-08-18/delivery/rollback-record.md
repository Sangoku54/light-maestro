# Rollback — retour à hier 21h23 (Paris)

**Date :** 2026-08-18 11:07 (Paris)
**Demande :** « reviens à 21h23 hier soir et rétablis tous les codes qui fonctionnaient à ce moment-là » (bugs introduits : cues autoscript non jouées, couleurs fausses).

## Action
- `git reset --hard a817691` — dernier commit avant 21h23 (le suivant, `309bd1f`, est à 21h31).

## 12 commits annulés
1. `86bbde7` — fix « même show » (miroir 3D + release simple-desk/fixture-test)
2. `a226cd2` — diag preBuf + activeSrcs
3. `e4b5362` — diag nCues/t0/tLast/flags
4. `913b41b` — playLoop async (anti-race)
5. `8932ed5` — fallback universe −1 + diag runtime
6. `8d9f31d` — preserve loop id + rename
7. `b459a19` — cue-block colours
8. `7519d48` — cue colour mismatch + rename/regenerate/save
9. `0a52d52` — stop button zero universes
10. `54c6fb3` — full autoscript timeline
11. `ecd71f1` — ambiance-classified loops
12. `309bd1f` — seed-driven variety

## Préservation
- **Données utilisateur** (`*.lmpreset`, `*.lmproj`, `*.lmshow`) : intactes, hash vérifié (12 fichiers).
- **État avant rollback** : tag `backup/rollback-2026-08-18_86bbde7` — récupérable via `git reset --hard backup/rollback-2026-08-18_86bbde7`.

## Vérification
- `tsc --noEmit` : exit 0 (propre).
- `vitest run` : **158/158** (11 fichiers). Exit 1 = artefact de warnings connu.

## Cause racine du bug signalé (pour référence future)
Les bugs venaient de la refonte « Boucles d'ambiance » v2/v3 + du debug « même show » (tous annulés ici) :
- la 3D lisait `appStore.dmx.channelData` mais les boucles n'écrivaient que `dmxBridge.write('vc')` sans miroiter ;
- `simple-desk` (LTP 100) n'était jamais relâchée et écrasait `vc` (LTP 80).


## Rollback #2 � 16h53 (retour au point 11h24, arret des auto loops)
- Demande utilisateur : revenir au rollback de 11h24 et arreter le dev auto-loops.
- Reset --hard a817691 (6 commits annules : 3367499, 5a98f8d, 3518cf8, f7e7261, 3bba1e7, 7b83d1b).
- theme-loop.ts supprime, AutoLoopsPanel/useFixtureTest revenus a l'etat 11h24.
- Backup : tag backup/pre-rollback-11h24_7b83d1b + donnees utilisateur dans .openclaw/tmp/rollback-backup-11h24/.
- tsc --noEmit exit 0 (etat sain).
