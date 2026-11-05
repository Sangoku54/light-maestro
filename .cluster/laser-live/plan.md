# Plan — « lecture de fixture laser : rien ou une apparition rare, toujours la même »

TaskId: laser-live
Symptôme utilisateur : les lasers ne font rien la plupart du temps ; rarement un faisceau apparaît, toujours identique.

## Contexte déjà établi (mainline, preuve)
- IODA-400-RGY (11ch) : Program@0 = 0-9 Laser off / 10-59 Auto Cartoon / 60-109 Auto Beam / 110-159 Sound Beam / 160-209 Sound Cartoon / 210-255 DMX mode. Pas de shutter, pas d'intensité. Pattern@2 = 128 motifs (tranches de 2). Mode écrit 232 (DMX) par le bloc laser de dmx-playback.ts (L1438-1439).
- Galaxian-3D (5ch) : Red Laser@0 / Green Laser@1 (type Shutter !), Rotations@2/3, Macros@4. rgbOffsets=[0,1] (fix du tour précédent). Aucun shutter/pattern/scan détecté → le bloc laser n'écrit que R/G (si sous 32 → fermé).
- Boom Box Fx2 : mode@16 (11 caps), shutter@8, intensity@9, rgbOffsets [1,2,6].
- Fichiers probe réutilisables : .cluster/laser-live/probe2.ts, dump-fixtures.ts, .cluster/laser-channels/verify-real.ts.
- Dossier du crash-fix ; bundle actuel : dist/renderer/assets/index-*.js (vite build). Exe : release/Light Maestro 1.0.14.exe + Setup.

## Sous-tâches (round 1, 4 agents parallèles — AUCUNE écriture dans src/, lecture seule + scripts tsx dans .cluster/)

1. **Traceur des chemins DMX live** → subagent_01.md
   - Rôle : cartographier TOUTES les sorties DMX/lecture (QuickShow live, lecture AutoScript, AutoLoop/SoundSwitch, aperçu DesignView, sortie ArtNet/sACN réelle) et la fonction appelée par chacune (computeDmxForCue de src/hooks/dmx-playback.ts ? autoloop-runtime ? dmx-cues ? autre ?).
   - Livrable : pour IODA-400-RGY et Galaxian-3D, les frames DMX exactes t=0..10 s pour chaque chemin (script tsx répliquant la logique OU instrumentation), et verdict par chemin : « visible » (mode DMX, shutter ≥32 ou absent, motif valide) ou « éteint/statique ».
   - Question pivot : y a-t-il un chemin de sortie réel qui n'appelle PAS le bloc laser de computeDmxForCue ?

2. **Catalogue des lasers OFL** → subagent_02.md
   - Rôle : scan exhaustif resources/fixtures/ofl/* (toutes marques) des fixtures laser (fixtureType laser OU noms Red/Green Laser…) ; pour chacune : canaux shutter/blank/on-off/mode/intensité, zones caps « off/fermé/blackout », et valeurs d'allumage.
   - Livrable : liste des fixtures où l'analyseur laisse shutterOffset null alors qu'un canal a une zone « fermé » (risque « ne fait rien ») ; liste des fixtures dont une zone de motif = off entre le bloc laser et la sortie.

3. **Auditeur des valeurs laser** → subagent_03.md
   - Rôle : lecture complète du bloc laser (src/hooks/dmx-playback.ts vers L1425-1530), de dmx-cues.ts (genCues/analyse laser), autoloop-runtime.ts (defaultLaserBeamCues) et auto-loops.ts ; calculer les valeurs écrites pour Galaxian (R/G sur Shutter : <32 fermé ?) et IODA à énergie faible/moyenne/forte.
   - Livrable : la/les valeur(s) exacte(s) écrite(s) sur les canaux R/G de la Galaxian, la probabilité de retomber sous 32, et tout autre chemin menant à un laser éteint pendant la lecture (mode non-DMX, pattern dans zone off, intensité 0, zoom auto, macros jamais écrites…).

4. **Inspecteur du rendu 3D** → subagent_04.md
   - Rôle : Stage3D (src/engine/stage3d.ts ou équivalent) : conditions de visibilité du faisceau laser (mountMode, zoom, idle sweep, valeurs d'intensité/shutter, énergie, pattern), et pourquoi l'utilisateur verrait « une apparition rare, toujours la même » dans la vue 3D.
   - Livrable : la condition exacte de rendu du faisceau, les valeurs qui la déclenchent, et si elle ne dépend que d'un seul état fixe.

## Dépendances
- Round 2 (après retour des 4) : correctif principal mainline (choix : forcer les canaux Shutter/off à « ouvert », mode DMX stable, intensité >0, macros/zoom sûrs) → relecture adversaire par 1 agent (round 3) → tests vitest + tsc → rebuild exe + vérif bundle → livraison.

## Règles
- Aucun agent ne modifie src/ ; scripts tsx uniquement dans .cluster/laser-live/.
- Retour : écrire subagent_NN.md + 10 lignes max de résumé console.
- Langue des livrables : français.