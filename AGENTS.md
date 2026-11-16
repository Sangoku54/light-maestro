# Consignes projet (light-maestro)

## PRIORITÉ ABSOLUE — exploitation maximale des fixtures

Quand on **patche une fixture**, ou qu'on **ouvre un nouveau projet / preset** :

1. **Première chose à faire** : analyser TOUTES les fixtures patchées (et celles à venir) pour vérifier qu'elles sont exploitées **à leur maximum** — chaque canal utile (intensity, pan/tilt, RGB, shutter/strobe, wheel/gobo, macro, laser...) doit être correctement détecté et piloté par le moteur.
2. Un défaut dans une def (`DMXFixtureCapability`) qui empêche d'exprimer une couleur/rotation est **inacceptable** : détecter le cas (roue dégénérée, caps toutes même couleur, canal muet...) et le corriger dans le moteur ou la def.
3. Valider systématiquement en virtuel (pas de DMX réel depuis ce PC) : résolution de chaque def → `analyzeChannels` → `computeDmxForCue` → vérifier qu'aucune fixture n'est « muette », qu'aucune valeur n'est hors plage, et que chaque fixture réagit (couleur ≠ figée, mouvement, intensité).
4. Les tests de référence pour cette validation sont dans `src/__tests__/yolo-fixture-probe.test.ts` (analyse moteur + sweep timeline complet). Les étendre quand de nouvelles fixtures arrivent.
5. Ne jamais committer un patch de fixture sans avoir rejoué cette validation et `npm run check` (tsc + tsc electron + vitest).

## Contexte technique
- OS : Windows / PowerShell 5.1. Pas de DMX réel sur ce PC — validation virtuelle uniquement (les tests réels se font sur le PC live).
- Projet de référence : `LM/Yolo.lmproj` (13 fixtures patchées, universes COM3) + `LM/Yolo.lmpreset` (17 sections, bpm=120, ~294s).
- Les fixtures custom peuvent exister uniquement dans le projet (`customFixtures` de `*.lmproj`) SANS fichier dans `resources/fixtures/custom/` (ex. `custom-tonio-mini-moving-head`).
- Le fix watchdog fail-safe (blackout auto-restore) est committé : `f90926a`. La persistance de projet (`project-envelope`) est un chantier séparé, non committé.

## Tester immédiatement une modification (UI / moteur)

L'utilisateur veut **tester chaque modif sur-le-champ** via `launch.vbs` (à la racine du workspace — PAS `launcher.vbs`). Après toute modification de code :

1. Lancer `launch.vbs` (double-clic, ou `wscript launch.vbs`) : git pull → rebuild tsc electron → `vite build` → lance Electron. Toujours utiliser ce launcher, il rebuild systématiquement.
2. Vérifier visuellement la modif dans l'app lancée, puis `npm run check` (tsc + tsc electron + vitest) après les tests manuels.

## Vue 3D — règle d'orientation des faisceaux (placement par défaut)

Dans la vue 3D, le faisceau d'une fixture doit par défaut viser le public, en fonction de son placement sur la scène (convention « vue audience ») :

1. **Arrière de scène (`rear`)** : fixture fixée virtuellement à l'arrière → faisceau vers **l'avant (front)**, parallèle au sol.
2. **Sol, à droite de la scène** (vue audience) : faisceau vers le **centre** par défaut.
3. **Sol, à gauche de la scène** (vue audience) : faisceau vers le **centre** par défaut (symétrique).
4. **Sol, devant** (bord avant de la scène) : faisceau vers **l'arrière (back)**.

Point d'implémentation repéré : `initFixturePosition` (`src/stores/showStore.ts:629`) pour les défauts de placement, et `fitMountRotation` / `createFixtureGeometry` dans (`src/scene/Stage3D.tsx`) pour l'orientation réelle du faisceau. À appliquer dès qu'on touche au placement 3D des fixtures.