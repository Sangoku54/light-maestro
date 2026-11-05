# review.md — Priorité « + track dimmer » sur l'autoscript (QuickShow)

## Demande utilisateur
« vérifies que la '+ track dimmer' dans le quick show prend bien la priorité sur l'autoscript, et sur toutes les fixtures, ce n'est pas le cas en ce moment »

## Verdict
Le mécanisme de priorité existait (les dimmer tracks du preset écrasent l'autoscript sur le canal dimmer principal), MAIS **3 chemins l'écrasaient ou le contournaient** — corrige dans le commit `405f1e5`.

## Cause racine (3 écrasements, tous corrige)

1. 🥇 **Le bloc « densité par section » (`activeTiers`) forçait dimmer + shutter à 0 APRÈS l'écriture de la track dimmer** (dmx-playback.ts, l'override était écrit puis écrasé ~2 lignes plus bas). Pendant intro/verse/bridge/build/outro, les tiers secondaires/tertiaires étaient éteints de force — même quand la track dimmer les ciblait. **C'est la cause exacte de « ça marche sur certaines fixtures, pas sur d'autres »** : selon le tier de la fixture et la section courante du morceau.
2. 🥈 **Le crossfade calculait la cue suivante SANS les overrides dimmer** (paramètre `undefined` dans l'appel de snapshot) → à chaque transition de cue, la valeur de la track dimmer était diluée puis remplacée par celle de l'autoscript pendant le fondu.
3. 🥉 **Les canaux Intensity 2..N des fixtures multi-têtes (`ledIntensityOffsets`) n'étaient jamais écrits par la track** : seule la 1ʳᵉ tête suivait la track, les têtes suivantes restaient pilotées par l'autoscript (ou noires).

## Correctif (commit 405f1e5, src/hooks/dmx-playback.ts)
1. Le bloc `activeTiers` exempt désormais les fixtures sous override dimmer track (`&& !_dimmerTrackActive`) — la track prime sur la densité de section.
2. Le calcul des overrides est remonté **avant** le snapshot de crossfade et passé à `computeDmxForCue` (9ᵉ param) → le fondu respecte la track.
3. L'override se propage à **tous** les canaux `ledIntensityOffsets` (têtes LED 2..N) dans les DEUX chemins du moteur (tick live + `computeDmxForCue`), avec force-write sur le canal principal (la track peut aussi faire DESCENDRE le dimmer sous la valeur de la cue).

## Ce qui était déjà correct (vérifié)
- L'écriture de la track sur le canal dimmer principal était inconditionnelle (priorité intra-frame correcte).
- L'arbitre de sortie n'est PAS en cause en lecture mono-moteur : l'autoscript et les tracks partagent la même source (`song-preset`/`quickshow`), la priorité se joue dans la frame. Les sources LTP concurrentes (`auto-loop` 75, `vc` 80) sont des contrôles opérateur — elles doivent gagner par conception.
- Le takeover des chaser tracks écrase volontairement tout le range de canaux (intention explicite : le chaser prend le contrôle complet) — laissé tel quel.
- Les lasers : gates binaires recalculés chaque frame, la track dimmer n'a pas de sens sur un canal laser sans intensité classique — hors périmètre.

## Validation
- tsc 0 (renderer), vitest **322/322** (34 fichiers), dont 2 nouveaux tests de régression : override forcé sur les 3 canaux d'une fixture multi-têtes (128 sur LED 1/2/3 avec cue « high » active — la track descend ET gagne), et non-régression sans override.
- Processus : 3 agents d'analyse en parallèle (chaîne track dimmer, chaîne autoscript, arbitre de sortie) — les 2 premiers livrés et convergents ; traçage complet avec numéros de lignes dans .cluster/dimmer-priority/.

## Notes
- Commit `405f1e5` propre (2 fichiers, aucun WIP mélangé).
- Le build 1.0.25 (qui emportera ce fix + le fix de sauvegarde `818bc83`) reste à lancer sur accord explicite.
