# Fix « couleurs timeline ≠ couleurs jouées » (récidive)

## Verdict
Le calcul de couleur n'était **pas** cassé. La cause racine était un **conflit de sources DMX** : une source de contrôle LTP (priority élevée) gardait les canaux RGB à une valeur fixe et écrasait le playback timeline (`quickshow`, HTP 40). D'où « toujours la même couleur ».

## Diagnostic (4 enquêteurs indépendants, croisés)
- **Moteur de lecture sain** : `ct` avance, cue actif correct, couleur émise = `active.color` + hue-shift par tier (identique à l'affichage). Source d'émission = `quickshow` (HTP 40).
- **Mes commits récents N'ONT PAS cassé l'autoscript** : le chemin timeline passe par `computeDmxForCue` (dmx-playback.ts), intact. `computeDmxCues` (modifié) n'est utilisé que par la boucle auto.
- **Conflit de sources confirmé** :
  - `vc` (LTP 80) : la boucle auto écrit en continu via `setInterval`, et son `stop()` n'était **pas** déclenché au changement d'onglet (les vues restent montées en `display:none`).
  - `simple-desk` (LTP 100) : **jamais** relâché dans tout `src/` — un seul mouvement de fader fige les canaux indéfiniment.
  - `fixture-test` (LTP 90) : relâché seulement dans `stopTest`, absent du cleanup unmount.

## Correctifs (commit `3bba1e7`)
1. **`AutoLoopsPanel.tsx`** : arrêt + `release('vc')` dès que le panneau n'est plus l'onglet visible (`mode !== 'quick'` ou `tab !== 'loops'`), sans blackout (la timeline reprend immédiatement).
2. **`App.tsx` `handleModeChange`** : `release('simple-desk')` + `release('fixture-test')` + `release('vc')` en quittant le mode Perform.

## Vérifications
- `tsc --noEmit` : clean.
- `vitest` : **161/161** (12 fichiers).
- `vite build` : OK (1611 kB).

## Suivi (hors périmètre, préexistants)
- `QuickShowView.tsx:2255` : en crossfade A/B (`showB`), le playback joue `cuesB` pendant que la timeline affiche `cues` A → divergence possible lors d'un fondu entre deux shows.
- `PerformanceView.tsx:2147` : slider VC écrit `writeMerge('vc', 1, …)` avec univers codé en dur `1`.
- `ShowManager`/`DesignView` écrivent au bridge sans miroir store → 3D figée sur ces vues (hardware correct).
- `purgeAutoLoops` peut supprimer du contenu utilisateur (préexistant).
