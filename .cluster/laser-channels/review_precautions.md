# Revue adversaire — Correctifs laser « précautions » (routing mode + couleur 2 canaux)

**Date :** 2026-08-25
**Objet :** `src/engine/fixture-analyzer.ts`, `src/hooks/dmx-playback.ts`, `src/__tests__/laser-exploit.test.ts`
**Méthode :** lecture des fichiers (read-only), scan des 628 fixtures OFL (`resources/fixtures/ofl/**`), exécution vitest ciblée + tests temporaires sur les **vraies** fixtures parsées (`FixtureLibrary.parseOFLFixture`), supprimés après exécution.
**État vérifié :** `tsc --noEmit` exit 0 · `vitest run` 262/262 · `laser-exploit.test.ts` 24/24.

---

## Verdict global : **VALIDÉ AVEC RÉSERVES**

Le correctif tient ses promesses sur l'IODA (canal « Program » capté comme mode, zone 210-255 « DMX mode ») et ne casse rien hors de son périmètre (non-lasers intacts, fixtures à roue intactes, 0 régression sur DS-1000/EL-400/ShowNET/Diamond/CS-1000/Sun-star). **Mais deux réserves réelles, prouvées par exécution sur les fixtures OFL réelles :**

- **R1 (gravité soutenue)** : la nouvelle règle de `pickLaserModeCap` (min≥200 && max===255) + le reroutage « Show Mode »/« Show » changent le comportement live de **3 modèles réels (American DJ)** en sélectionnant un cap « Sound Active Show » / « Random show » — exactement ce que le commentaire du code prétend exclure (« jamais Sound, jamais figé dans un programme interne aléatoire »).
- **R2 (gravité moyenne)** : la branche « 2 canaux couleur » ne s'applique à **aucune fixture réelle** du repo, y compris la Galaxian 3D qu'elle prétend couvrir (canaux réels typés `Shutter`, pas `Colour`). Les tests laser-exploit valident une version idéalisée (types irréalistes pour l'OFL).

Détail point par point ci-dessous, avec preuves `fichier:ligne` et sorties d'exécution.

---

## 1. Non-régression des valeurs de mode (pickLaserModeCap)

**Résultat : les 4 cas cités sont strictement identiques — mais l'effet de la nouvelle règle n'est pas nul globalement (7 modes réels changent).**

Preuve d'exécution (reconstruction de l'ancienne règle vs nouvelle, appliquée aux caps réels de **tous les modes de tous les lasers OFL**) :

```
[exhaustif] lasers=24 modes avec laserModeOffset=19
[exhaustif] diffs old vs new: 7
 DIFF: boom-box-fx2.json/3-channel:  old={"min":140,"max":209,"name":"Show 8"}  new={"min":250,"max":255,"name":"Show 0"}
 DIFF: boom-box-fx2.json/19-channel: old={"min":140,"max":209,"name":"Show 8"}  new={"min":250,"max":255,"name":"Show 0"}
 DIFF: inno-pocket-fusion.json/11-channel:  old={"min":190,"max":215,"name":"Show 8"} new={"min":216,"max":255,"name":"Sound Active Show"}
 DIFF: inno-pocket-fusion.json/6-channel:   old={"min":190,"max":215,"name":"Show 8"} new={"min":216,"max":255,"name":"Sound Active Show"}
 DIFF: inno-pocket-fusion.json/2-channel:   old={"min":190,"max":215,"name":"Show 8"} new={"min":216,"max":255,"name":"Sound Active Show"}
 DIFF: stinger-ii.json/2-channel: old={"min":185,"max":219,"name":"Show 6"} new={"min":220,"max":255,"name":"Random show"}
 DIFF: stinger-ii.json/9-channel: old={"min":185,"max":219,"name":"Show 6"} new={"min":220,"max":255,"name":"Random show"}
```

Analyse cas par cas :

| Cas (caps réels) | Ancienne règle | Nouvelle règle | Sur la VRAIE fixture |
|---|---|---|---|
| DS-1000 « Mode Select » [Laser Off@0-63, Sound@64-127, Auto(beam)@128-159, Auto(graphics)@160-191, **DMX Mode@192-255**] | 192-255 (byName `dmx`) | 192-255 (byName `dmx`) | **identique** ✓ |
| EL-400 « Mode » […, **Dynamic pattern@200-255**] | 200-255 (byName `dynamic`) | 200-255 (byName `dynamic`) | **identique** ✓ |
| Test synthétique [NoFunction@0-49, Effect@50-99, Effect@200-255] | 200-255 (max≥200 && min>0) | 200-255 (min≥200 && max===255) | **identique** ✓ |
| [Sound@0-63, DMX Mode@64-127] | DMX Mode (byName) | DMX Mode (byName) | **identique** ✓ |
| Inno Pocket Fusion « Show » (3 modes) | Show 8 (190-215) | **Sound Active Show (216-255)** | **CHANGÉ** ✗ |
| Stinger II « Show Mode » (2 modes) | Show 6 (185-219) | **Random show (220-255)** | **CHANGÉ** ✗ |
| Boom Box Fx2 « Show mode » (2 modes) | Show 8 (140-209) | **Show 0 (250-255)** | **CHANGÉ** ✗ |

Explication du mécanisme : le DS-1000/EL-400 réel passent par `byName(dmx|dynamic|manual)` (leurs caps portent des noms OFL complets) → la nouvelle règle est inerte pour eux, **conformément à l'intention**. Mais pour les 3 ADJ, aucun cap n'est nommé dmx/dynamic/manual/auto → la règle numérique min≥200&&max===255 choisit la tranche la plus haute, qui est, sur ces modèles, **le pire choix possible** (« Sound Active Show » = asservi au micro ; « Random show » = programme aléatoire ; « Show 0 » = dernier show). C'est contradictoire avec le commentaire du code (`fixture-analyzer.ts:87-90`) : « Jamais "Sound" ni "Off" (le laser doit rester pilotable en DMX, jamais figé dans un programme interne aléatoire) ».

**Correction proposée (R1)** : dans `pickLaserModeCap` (`src/engine/fixture-analyzer.ts:138`), exclure les caps dont le nom évoque sound/random avant la règle numérique : `caps.find((c) => c.min >= 200 && c.max === 255 && !/sound|random/i.test(c.name ?? ''))`. Alternative plus conservatrice : ne router le canal « Show Mode »/« Show »/« Program » vers `laserModeOffset` (`fixture-analyzer.ts:268`) **que s'il porte une capability nommée dmx/manual/dynamic/auto** — l'IODA (cap « DMX mode ») reste capté, les ADJ (aucune cap DMX) gardent leur comportement antérieur (canal `Nothing`, jamais écrit). Dans les deux cas, adapter les tests synthétiques « Show Mode »/IODA du describe pour refléter les vrais noms OFL.

---

## 2. Impact du reroutage Program / Show Mode / Show

**Fixtures laser réelles concernées (nom exact de canal, scan des 628 JSON OFL) :**

| Fixture | Canal | Type dérivé par le parser | Comportement AVANT | Comportement APRÈS |
|---|---|---|---|---|
| cameo/ioda-400-rgy, ioda-600-rgb, ioda-1000-rgb (modes 4ch/11ch) | « Program » | `Shutter` (première cap `ShutterStrobe`) | `shutterOffset` → valeur 8…255 selon dimmer → **toujours en show auto, jamais en DMX** (bug) | `laserModeOffset` + cap « DMX mode » 210-255 → **stable, pilotable** ✓ **(fix positif)** |
| american-dj/stinger-ii (2ch/9ch) | « Show Mode » | `Nothing` (première cap `NoFunction`) | jamais écrit → 0 = « Laser off », contrôle par canaux directs (Lasers, Laser Strobe, Laser Rotation) | `laserModeOffset` → cap **« Random show » 220-255** → show interne aléatoire ✗ |
| american-dj/inno-pocket-fusion (2ch/6ch/11ch) | « Show » | `Nothing` | jamais écrit → 0 | `laserModeOffset` → cap **« Sound Active Show » 216-255** → asservi au micro ✗ |
| american-dj/boom-box-fx2 (3ch/19ch) | « Show mode » | `Nothing` | jamais écrit → 0 | `laserModeOffset` → cap **« Show 0 » 250-255** ✗ |

Autres lasers avec « Mode »/« Mode Select » (déjà routés avant ces correctifs) : laserworld/ds-1000rgb, el-400rgb-mk2, shownet, cs-1000rgb, lep-laser/diamond-pro-2-8, sun-star/g-2011-nova — aucun changement (voir §1).

**Non-lasers : aucun impact.** Le bloc est gated `isLaser` (`fixture-analyzer.ts:160-161`) ; le scan des 628 fixtures montre **0 fixture non-laser** matchant la signature laser (pattern + axe scan + couleur) parmi celles ayant un canal Program/Show/Show Mode. Preuve d'exécution sur deux représentants (« Program » sur flat-par-qa12 et mega-bar-50rgb) :

```
[non-laser] flat-par-qa12.json cats=Color Changer isLaser=false laserModeOffset=null shutterOffset=null
[non-laser] mega-bar-50rgb.json cats=Color Changer,Strobe,Effect isLaser=false laserModeOffset=null shutterOffset=null
```

**Perte éventuelle documentée (ADJ)** : ces canaux ne servaient pas de shutter/strobe avant (type `Nothing`, jamais écrits) — il n'y a donc pas de perte fonctionnelle directe, mais un **gain involontaire** : le mode interne prend le dessus sur le contrôle direct des canaux laser pendant tout le playback. C'est le cœur de la réserve R1.

---

## 3. Branche « 2 canaux couleur » (laserColorMode = 'rgb', 2 offsets)

**Résultat : zéro fixture réelle interceptée — ni à tort, ni à raison.**

Preuve d'exécution exhaustive (24 lasers réels, tous modes parsés par `FixtureLibrary`) :

```
[exhaustif] lasers passant par la branche 2 canaux: 0
```

- **Galaxian 3D réelle : NON exploitée par la branche.** Les canaux « Red Laser »/« Green Laser » sont dérivés du template `$pixelKey Laser` (caps `ShutterStrobe`) → type **`Shutter`** (confirmé par le test existant `ofl-parse.test.ts:28-29`), pas `Colour`. Ils n'entrent donc pas dans `colourChannels` et le résultat réel est :

```
[galaxian réelle] rgbOffsets=null rgbSegments=0 wheelOffset=null laserColorMode=none shutterOffset=0 laserModeOffset=null
```

  Le guard `plain()` (`fixture-analyzer.ts:435`, exclusion rotation/rolling/move/speed/scan/strobe/effect/macro) est **du code mort défensif** pour l'OFL actuel : les « Red/Green Laser Rotation » réels sont déjà routés par la regex rotation laser (`fixture-analyzer.ts:247`) et typés `Speed` → jamais dans `colourChannels`.
- **Aucune roue 2 canaux cap-color interceptée à tort** : aucune fixture réelle n'a exactement 2 canaux couleur nominés R/G avec caps `color` (le cas théorique existe — la branche est avant `hasColorCaps`, `fixture-analyzer.ts:430` vs 457 — mais il n'est pas exposé par le catalogue).
- Cas observés mais **inchangés** (préexistant, hors périmètre) : boom-box-fx2 19ch (Red/Green Beam à caps `color` → `hasRgbNames`, pas la branche 2 canaux), gigbar-2 11ch, shownet Professional (3 canaux R/G/B), minuit-une ivl-carre — tous passent par les branches RGB/roue existantes, identiques avant/après.

**Conséquence** : l'objectif déclaré (« Galaxian 3D : R+G détectés et exploités en live ») n'est pas atteint sur la fixture réelle. Soit l'accepter et corriger les commentaires/tests, soit étendre la détection aux canaux « X Laser » typés `Shutter` à caps on/off (à manier avec précaution : on/off ≠ mélange continu de couleur).

---

## 4. dmx-playback — bloc live 2 canaux (`src/hooks/dmx-playback.ts:1464-1471`)

**Résultat : sûr, vérifié par lecture + test.**

- `paletteColor` est défini en amont dans `computeDmxForCue` (`dmx-playback.ts:1244`) et `energy` aussi (`dmx-playback.ts:1206`) — tous deux dans le scope lexical du bloc `if (fa.isLaser)` (ligne 1431). ✓
- Pas d'écrasement d'une couleur déjà écrite : garde `chVals[pf.startAddress + fa.rgbOffsets[0]] === undefined` (ligne 1464). En pratique, dans ce chemin, rien d'autre n'écrit ces offsets (branche `rgbSegments` inopérante car `rgbSegments.length === 0`, branche roue inopérante car `wheelOffset === null`) — la garde est défensive. ✓
- Pas d'écriture hors bornes : guards `!== undefined` sur chaque offset (1466-1468) ; la paire R+G suffit, le bleu n'est jamais écrit. Fallback sans palette `[255*energy, 255*energy, 0]` ∈ [0,255]. ✓
- **Réserves mineures** : (a) pas de tier hue shift ni de dimmer scaling (contrairement à la branche `rgbSegments`, lignes 1252-1275) → un laser R+G à intensité faible sortira à pleine puissance ; (b) sans paletteColor, le fallback force un jaune « énergie » (R=G), cohérent pour un laser RGY mais non harmonisé avec la palette du show. Ni l'un ni l'autre n'est une régression (rien n'était écrit avant), mais à documenter/aligner.

---

## 5. Tests ajoutés (`laser-exploit.test.ts:301-370`)

**Résultat : ils passent (24/24, suite 262/262) mais ne reflètent pas toujours la réalité OFL.**

- **Test IODA (`:302-318`)** : résultat correct (`mode.min === 210`) **mais** le commentaire « caps sans noms dans l'OFL » est **inexact** : dans l'OFL réel (`cameo/ioda-400-rgy.json`), le cap 210-255 a `comment: "DMX mode"` → le parser (`electron/fixtures/library.ts:875`, `name = cap.comment || cap.effectName || cap.type`) produit `name: "DMX mode"` → **c'est `byName(dmx)` qui gagne sur la vraie fixture, pas la nouvelle règle**. Le test synthétique (caps nommés `'x'`) teste donc la nouvelle règle sur un artefact absent du catalogue, avec la bonne valeur de sortie. (Ironiquement : la vraie IODA prouve que la nouvelle règle est quasi inutile pour elle — d'où l'importance de la réserve R1.)
- **Test Galaxian (`:335-352`)** : type `'Colour'` **irréaliste** — les canaux réels sont `Shutter` (voir §3) ; le test valide le code de la branche 2 canaux mais pas la fixture qu'il prétend couvrir. Il vérifie bien l'essentiel du chemin 2 canaux (offsets [0,1], roue null, `computeDmxForCue` écrit R=255/G=0 pour une palette rouge) ✓, mais **pas** le guard `plain()` ni le fallback énergie.
- **Tests non-laser « Program » (`:325-333`)** : corrects et utiles.
- **Manque** : aucun test sur les vraies fixtures parsées (un `parseOFLFixture('galaxian-3d')` dans le test révélerait le gap R2 ; un `parseOFLFixture('stinger-ii')` révélerait R1).

---

## Réserves (synthèse)

| # | Gravité | Fichier:ligne | Constat | Correction proposée |
|---|---|---|---|---|
| R1 | **Soutenue** | `fixture-analyzer.ts:138` (+ reroutage `:268`) | 7 modes réels (3 modèles ADJ) changent de cap : « Sound Active Show », « Random show », « Show 0 » — contraire au commentaire du code (« jamais Sound, jamais programme aléatoire ») | Exclure les caps nommés `/sound\|random/` de la règle min≥200&&max===255, ou ne router « Show Mode »/« Show »/« Program » que si une capability est nommée dmx/manual/dynamic/auto ; aligner les tests |
| R2 | Moyenne | `fixture-analyzer.ts:430-450` + tests `laser-exploit.test.ts:335-352` | La branche 2 canaux ne touche **aucune** fixture réelle ; la Galaxian 3D réelle (canaux `Shutter`) n'est pas exploitée — objectif déclaré non atteint | Assumer et corriger commentaires/tests, ou étendre la détection aux canaux « X Laser » à caps on/off |
| R3 | Mineure | `laser-exploit.test.ts:303-307` (commentaire) | « caps sans noms dans l'OFL » est faux : le cap 210-255 s'appelle « DMX mode » et gagne via `byName(dmx)` | Corriger le commentaire ; ajouter un test sur `ioda-400-rgy.json` parsé |
| R4 | Mineure | `dmx-playback.ts:1464-1471` | Pas de tier hue shift ni de dimmer scaling sur la couleur 2 canaux ; fallback jaune sans palette | Documenter ; appliquer le même post-traitement que la branche `rgbSegments` si souhaité |

**En l'état, le correctif améliore nettement l'IODA (le cas motivant) sans rien casser d'autre en analyse ; les réserves R1/R2 sont des correctifs de comportement live (ADJ) et d'écart objectif↔tests (Galaxian) à trancher avant de considérer la passe « précautions » comme terminée.**