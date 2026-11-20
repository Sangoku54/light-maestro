# Consignes projet (light-maestro)

## PRIORITÉ ABSOLUE — exploitation maximale des fixtures

Quand on **patche une fixture**, ou qu'on **ouvre un nouveau projet / preset** :

1. **Première chose à faire** : analyser TOUTES les fixtures patchées (et celles à venir) pour vérifier qu'elles sont exploitées **à leur maximum** — chaque canal utile (intensity, pan/tilt, RGB, shutter/strobe, wheel/gobo, macro, laser...) doit être correctement détecté et piloté par le moteur.
2. Un défaut dans une def (`DMXFixtureCapability`) qui empêche d'exprimer une couleur/rotation est **inacceptable** : détecter le cas (roue dégénérée, caps toutes même couleur, canal muet...) et le corriger dans le moteur ou la def.
3. Valider systématiquement en virtuel (pas de DMX réel depuis ce PC) : résolution de chaque def → `analyzeChannels` → `computeDmxForCue` → vérifier qu'aucune fixture n'est « muette », qu'aucune valeur n'est hors plage, et que chaque fixture réagit (couleur ≠ figée, mouvement, intensité).
4. **Outil d'audit générique** (n'importe quel `.lmproj` des utilisateurs) : `npm run probe -- LM/Yolo.lmproj [preset.lmpreset]`. Le moteur `src/engine/fixture-audit.ts` résout les defs (custom projet → QXF → OFL), rejoue la timeline (`computeDmxForCue`) et compare les **octets réellement écrits** : faisceau 3D (clampés) vs faisceau matériel (mécanique + tares) → écart angulaire, fixtures muettes, canaux parlants jamais écrits, roues dégénérées, defs non résolues. Exit code 1 si anomalie. Variables d'env : `LM_PROBE_PROJECT` / `LM_PROBE_PRESET`.
5. Les tests de référence pour cette validation sont dans `src/__tests__/yolo-fixture-probe.test.ts` (analyse moteur + sweep timeline complet) et `src/__tests__/fixture-project-probe.test.ts` (audit paramétré, Yolo par défaut). `src/__tests__/fixture-audit-negative.test.ts` vérifie que l'audit **détecte** les défauts (canal muet, roue dégénérée, def absente, octet hors zone). Les étendre quand de nouvelles fixtures arrivent.
6. Ne jamais committer un patch de fixture sans avoir rejoué cette validation et `npm run check` (tsc + tsc electron + vitest).

## Release / auto-update LWS — runbook obligatoire

Avant tout build de release, lire `.openclaw/notes/release-runbook.md`. En bref :

1. **Jamais d'instructions d'upload "au large"** — mesurer d'abord : `git diff --stat <commit-du-dernier-upload> HEAD -- site/`. Le résultat EST la liste d'upload.
2. **`build.publish` : provider `generic` (LWS) en PREMIER** — `app-update.yml` embarqué prend `publishConfigs[0]`, sinon l'app cherche les MAJ sur GitHub au lieu de LWS.
3. **Noms d'artefacts SANS espaces** (`nsis.artifactName` / `portable.artifactName`) — sinon `latest.yml` référence un fichier fantôme (espaces → tirets) et l'auto-update fait un 404.
4. **Zéro placeholder** (`ton-domaine`, `example.com`) dans `package.json` / `app-update.yml` — le domaine réel est `https://light-maestro.com/`.
5. Après `npm run dist`, vérifier : `app-update.yml` = generic/LWS · `latest.yml` → fichier + blockmap existants sur disque · pas de sous-dossier `release/generic/`.
6. **Deux canaux, deux publics** — une release doit être publiée sur **GitHub** (release + `latest.yml` + setup + blockmap) ET déposée sur **LWS** (`/download/`) :
   - le canal d'une version **déjà installée** est figé dans son binaire (la 1.0.43/1.0.44 pointe GitHub, elle ne verra jamais LWS) ;
   - sans release GitHub, une version installée ne propose **jamais** la suivante ;
   - sans upload LWS, le canal principal est en 404 (boutons du site cassés) — le repli GitHub automatique (`electron/main.ts` → `fallbackToGithubFeed`) prend le relais pour les versions ≥ 1.0.46.
7. **Le dépôt GitHub a été renommé** (`light-maestro` → `1.0.45`) : l'ancien nom redirige (lecture OK), mais pour **écrire** via l'API il faut résoudre `full_name` (un POST sur l'ancien nom suit le 301 et PowerShell transforme le POST en GET → rien n'est créé, silencieusement). Le tag doit pointer sur le commit du build.
8. **Un texte i18n décrivant un comportement doit être validé contre le code du moteur**, pas contre une note ou un souvenir (piège : `mountGroundTipText` inversé alors que `clampTiltZone` interdit de tirer sous l'horizon).

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

Point d'implémentation repéré : `initFixturePosition` (`src/stores/showStore.ts:899`) pour les défauts de placement, `headingRadForPos` + `mountTiltForMode` (`src/utils/fixture-pose.ts`) pour l'orientation, et la boucle de rendu de `src/views/Stage3D.tsx` (~l.3166-3200) pour le faisceau affiché. À appliquer dès qu'on touche au placement 3D des fixtures.

### Invariant : la vue 3D doit montrer EXACTEMENT le faisceau réel

Trois vues doivent désigner le même faisceau, sinon la 3D ment sur le matériel :

1. **Vue 3D** (`Stage3D.tsx`) : `headingRadForPos` + `clampPanZone` / `clampTiltZone` (bornes ±90° / horizon).
2. **DMX écrit** (`dmx-playback.ts`) : `clampPanZoneDmx` / `clampTiltZoneDmx` — **à appliquer TOUJOURS**, y compris sur une fixture au centre capturé et sur la branche « repos » (amplitude 0). Un bypass = jusqu'à 90° d'écart 3D/réel.
3. **Physique** : mécanique + tare statique (`pos.tilt`) + tare zéro (`pos.zeroPan`/`pos.zeroTilt`) — ces deux tares sont **physiques** (le zéro mécanique du moteur), pas cosmétiques : `clampPanZoneDmx` déduit ses bornes de `zeroPan`, ce qui le prouve.

Exceptions (visées délibérées, prioritaires) : `applyAimTarget` (cible manuelle ou de scène) et le mode Target de la 3D écrivent des bytes **hors zone** → la 3D doit alors ne pas clamper non plus (`hasManualTarget(id) || hasSceneAim(id)`).

Les canaux DMX sont des octets : tout arrondi issu d'un clamp doit être passé par `Math.round` avant écriture (la trame `Uint8Array` tronque les floats).

Sondes de référence : `src/__tests__/fixture-placement-default-probe.test.ts` (grille 6×6 : convention « vue audience ») et `src/__tests__/yolo-fixture-pose-probe.test.ts` (projet réel `LM/Yolo.lmproj` : positions + DMX réels + écart 3D/matériel qui doit rester à 0.00°).