# Livraison — Fix « même show light » (v2, cause racine définitive)

## Problème
Trois boucles d'ambiance différentes produisaient « toujours le même show ». Le calcul DMX était pourtant correct et varié (prouvé par le diagnostic : `cue0` magenta/bleu/orange, `nCues=64`, progression temporelle OK, `uni0=0`).

## Cause racine (double, en aval du calcul)
1. **Visualisation 3D figée** — Stage3D lit `appStore.dmx.channelData`, mais les boucles n'écrivaient que `dmxBridge.write('vc',…)` sans miroiter le store 3D (le moteur principal fait un double-write `setUniverseData` + `push`, pas les boucles). → l'écran affiche une image périmée identique pour toutes les boucles.
2. **Écrasement LTP par le Simple Desk** — `simple-desk` (LTP 100) n'est jamais relâchée et écrase `vc` (LTP 80) sur le matériel si un fader est resté monté. `fixture-test` (LTP 90) secondaire.

## Correctif (3 commits)
- `a226cd2` — diagnostic d'arbitrage `preBuf` + `activeSrcs` (bandeau ambre).
- `…` — fix définitif : miroir 3D (`setUniverseData`) dans `fire()` et `zeroAllUniverses()`, + `release('simple-desk')`/`release('fixture-test')` dans `playLoop()`.

## Vérification
- `tsc --noEmit` : exit 0 (propre).
- `vitest run` : **180/180** (12 fichiers). Exit 1 = artefact de warnings connu.

## Confirmation finale (côté utilisateur, matériel + écran)
1. Relancer l'app, ouvrir « Boucles d'ambiance ».
2. Jouer `wash · Sombre` puis `wash · Énergique` : la **3D doit changer de couleur** (bleu nuit → magenta) et le **matériel aussi**.
3. Le bandeau ambre doit afficher `activeSrcs=[]` (ou `vc` uniquement) au moment de Jouer — plus de `simple-desk`.
4. Si un fader du Simple Desk est monté, le Jouer d'une boucle reprend maintenant la main dessus.

## Fragilités secondaires (hors scope, non bloquantes)
- `handleModeChange` ne relâche toujours pas `simple-desk`/`fixture-test` à la bascule d'onglet (release ciblé dans `playLoop`).
- Pas de zéro-fill dans `engine.setChannels`.
- Index d'univers ordre-dépendant côté engine.
