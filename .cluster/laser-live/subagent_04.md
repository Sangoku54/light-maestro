# subagent_04 — Inspecteur du rendu 3D (Stage3D) : conditions de visibilité des lasers

TaskId: laser-live · Round 1 · Lecture seule de src/ (aucune modification)
Simulation exécutable : `.cluster/laser-live/subagent_04-sim.ts` (npx tsx)

---

## 1. Moteur 3D et représentation du faisceau

Moteur : `src/views/Stage3D.tsx` (2547 lignes, le « stage3d.ts » n'existe pas). Pas de sous-composant.
Représentation du faisceau : un cône `THREE.CylinderGeometry` (sommet 0.03 m, base `3*tan(beamAngle)` m, hauteur `BEAM_LENGTH = 3.0` m) + un `PointLight` + une traînée `THREE.Line` ; tous accrochés à `lightTarget` (sortie de la lentille) qui suit arm(pan)/head(tilt) — **mais seulement les canaux `panOffset/tiltOffset/panOffsets/tiltOffsets`** (L1601-1635), jamais `scanX/scanY` ni les rotations laser.

Le faisceau est mis à jour dans `updateDmxState()` appelé à chaque frame depuis `useAppStore.getState().dmx.channelData` (L1498-1499) — le même store que la sortie live (voir §5).

## 2. Tableau des conditions de visibilité du faisceau (Stage3D.tsx)

| # | Condition (ligne) | Valeur de déclenchement | Atteignable en lecture ? |
|---|---|---|---|
| C1 | L1525-1526 : `!rawData` (aucune donnée DMX pour l'univers) | → intensity=0, cône opacity=0 | OUI (pause, univers sans fixture) ; en plus l'idle sweep (L1528-1539) anime les têtes APRÈS 3 s sans activité mais **n'allume jamais le beam** |
| C2 | L1549-1556 : `intensity = data[baseAddr+intensityOffset]` sinon `max(r,g,b)` si `rgbOffsets` | Galaxian : `max(R,G)` ; IODA : **aucun des deux → intensity=0 CONSTANT** | IODA : jamais ; Galaxian : oui (vient de R/G) |
| C3 | L1565-1577 : shutter (si `shutterOffset` non null) : valeur ≤ 31 → `intensity=0` ; 64-179/180-254 → strobe | Galaxian & IODA : `shutterOffset=null` (canaux laser capturés en couleur/mode, pas en shutter) → non appliqué | n/a pour Galaxian/IODA ; s'applique à BoomBox Fx2 (shutter@8) |
| C4 | L1580-1583 : blackout → 0 ; fixture disabled → 0 ; `× grandMaster/255` | blackout / disabled / grandMaster | OUI (réglages globaux de l'app) |
| C5 | L1585-1590 : strobe actif → `intensity=0` une frame sur 2 | strobeHz > 0 | non concerné (pas de shutter laser) |
| C6 | **L1705-1709 (cône)** : `visible = showBeams && normIntensity > 0.005` ⇔ valeur DMX d'intensité **> 1.27** ; `opacity = normIntensity × 0.35` | Galaxian : 0 ou 255 (binaire !) ; IODA : jamais | **Seul interrupteur réel du faisceau 3D** (voir §3) |
| C7 | L1699-1701 : `pointLight.intensity = normIntensity × 25` | idem C6 | — |
| C8 | L1650 : trail, seulement si `normIntensity > 0.05` | idem C6 | — |

`floorSpot`/`floorGlow` (spots au sol) sont **forcés à `visible=false`** (L1714) depuis le « Floor spot disabled » — aucun spot au sol pour personne.
`mountMode` (top/ground/rear), `_staticTilt`, `beamAngle` (L2524-2547, L1420-1475) n'affectent que l'orientation/ouverture géométrique du cône — **jamais sa visibilité**. Idem idle sweep (L1528-1539) : bouge les têtes, n'allume rien.

## 3. Simulation — pourquoi « rien, ou une apparition rare, toujours la même »

### Galaxian 3D (American DJ, 5ch : Red Laser@0 / Green Laser@1 typés Shutter)
Les deux chemins de lecture écrivent R/G **en binaire** via `laserGateValue(v) = v > 22 ? 255 : 0` (fixture-analyzer.ts L25 ; appliqué dans dmx-playback.ts L1468 pour le live, dmx-cues.ts L720-722 pour l'AutoScript). La 3D (C2) calcule alors `intensity = max(R,G) ∈ {0, 255}`.

Résultat simulé (subagent_04-sim.ts) :

| energy de la cue | R/G écrits | normIntensity 3D | opacity cône | visible 3D |
|---|---|---|---|---|
| < 0.088 (ex. 0.08) | 0 / 0 | 0 | 0 | **non** |
| ≥ 0.089 (0.09, 0.1, 0.25, 0.5, 0.8, 0.95, 1) | 255 / 255 | 1.0 | 0.35 | **oui — toujours identique** |

- Le seuil de bascule est **energy > 0.0882** (ou composante de palette > 22). En lecture AutoScript, `energy` vient de l'**energyCurve audio réelle** (QuickShowView.tsx L471 : `energy: analysis!.energyCurve?.[fi]`), qui descend souvent sous 0.088 (couplets, intros, musique calme) → « ne fait rien » ;
- dès qu'une crête la dépasse, la gate s'ouvre et le rendu est **STRICTEMENT LE MÊME à chaque fois** : cône jaune `rgb(255,255,0)`, opacity 0.35, longueur 3 m, angle 0.15 rad, immobile (voir §4) → « apparition rare toujours la même ».

⚠️ Variante « fige » : une cue avec `energy` explicite faible (< 0.088) ou une palette sombre (composante ≤ 22) → gate fermée en permanence → l'utilisateur ne voit **jamais** rien, même quand la sortie DMX est allumée via un autre chemin.

### IODA 400 RGY (Cameo, 11ch : Program@0 / Color Presets@1 / Pattern@2 / scan X/Y@6/7)
`intensityOffset=null` **et** `rgbOffsets=null` (laserColorMode='wheel') → **C2 calcule intensity=0 en permanence** → le cône, le pointLight et la trail ne s'allument **JAMAIS**, quelles que soient les valeurs correctes produites par la lecture (Program=232 DMX mode, pattern cyclé, scan animé en cercle — simulé t=0.5..5.5 s : `visible=false` à chaque frame). La roue couleur n'est lue que comme **couleur** (L1596-1600), jamais comme luminosité.

## 4. Bugs 3D suspectés (extraits + lignes)

1. **BUG-3D-1 — Lasers « wheel » invisibles à 100 %** : Stage3D.tsx L1549-1556 ne tire l'intensité que de `intensityOffset` ou `rgbOffsets` ; une fixture laser à roue (IODA 400 RGY, `laserColorMode='wheel'`) n'a ni l'un ni l'autre → `intensity=0` → jamais de faisceau, même quand la sortie DMX produit un vrai beam. Aucun fallback « laser allumé ⇒ intensity=255 » (contrairement au traitement shutter/mode).
2. **BUG-3D-2 — Bascule binaire « tout ou rien »** : `laserGateValue` (fixture-analyzer.ts L25 `v > 22 ? 255 : 0`) + `intensity = max(r,g,b)` (Stage3D L1553-1556) → le faisceau Galaxian saute de 0 à 255 (opacity 0→0.35) sans aucune gradation ; aucune énergie ≪0.089 n'est visible, aucune ≫ n'est différenciée.
3. **BUG-3D-3 — Rendu figé (« toujours la même apparition »)** : updateDmxState ne consomme **pas** `scanXOffset/scanYOffset`, `laserRotationOffsets`, `laserSpeed*`, `patternOffset` (pourtant présents dans `FixtureChannelMap = FixtureChannelAnalysis`, L223-224). Seuls pan/tilt (L1601-1635) bougent le cône — vides pour Galaxian/IODA → cône statique, couleur verrouillée (r=G=1 → jaune), géométrie constante (`BEAM_LENGTH` L80, `beamAngle` L729). L'émulation scan X/Y (cercle/Lissajous dans dmx-playback L1446-1454) est invisible en 3D.
4. **BUG-3D-4 — Zoom DMX non bougé** : `zoomOffset` (IODA@8, écrit par dmx-playback L1412) n'est jamais lu en 3D ; le cône ne suit que `pos.beamAngle` (réglage manuel, L1420-1430 / L1462-1475).
5. **BUG-3D-5 — « Allumer » (fixture on) no-op pour les lasers à 2 gates** : `buildFixtureOnChannelValues` (dmx-helpers.ts) ne traite que ≥3 canaux couleur ou exactement 1 ; la Galaxian (2 canaux R/G) → `out = {}` → `sendFixtureOn` early-return, rien ne s'allume ni en 3D ni au hardware. Pour l'IODA, il écrit la roue (RGY) mais **jamais le canal Program** (0-9 = « Laser off ») → au hardware le laser reste éteint ; en 3D intensity=0 (BUG-3D-1).
6. **BUG-3D-6 — Désynchronisation 3D vs sortie réelle (arbitrage)** : la 3D lit `channelData` (L1498-1499) = valeurs **pré-arbitrage** ; le hardware reçoit le buffer final de l'output-arbiter (dmx-playback L1150, priorités LTP 100…30, output-arbiter.ts L36-47). Une source LTP supérieure (fixture-test 90, vc 80, design-test 60) peut écraser la lecture côté hardware sans que la 3D le montre (sauf si elle-même écrit `setUniverseData`, cf. dmx-helpers L180-200).

## 5. Synchronisation chVals vs sortie (ce que lit la 3D)

- Chemin live QuickShow/AutoScript : `useDmxPlayback` (dmx-playback.ts) → `computeDmxForCue` → à chaque frame `setUniverseData(uniIdx, chVals)` (L1146, throttle 33 ms, meurt par hash de contenu) + `dmxBridge.push` (hardware arbitré). Le `onVirtualDmx` de QuickShowView (L2325-2327) appelle aussi `setUniverseData`.
- **La 3D lit donc les mêmes valeurs que la sortie pour la lecture** (même `chVals`), modulo : (a) l'arbitrage (§4-6) ; (b) les *test overrides* `fixtureTestState` fusionnés en 3D uniquement (Stage3D L1505-1520 : buf = base + testVals — la 3D peut montrer un état que le hardware ne reçoit pas si l'arbitre tranche contre la source test), et (c) le blackout/grandMaster 3D appliqués **dans Stage3D** eux-mêmes (L1580-1583) en plus de l'arbitrage.
- Chemins secondaires (DesignView Test, PerformanceView fit) appellent aussi `computeDmxForCue` (DesignView L1355/1876, QuickShowView L135/2262) puis écrivent `channelData` via `sendChannelsToHardwareAndStore` → la 3D reste synchronisée.

## 6. Verdict

**Oui — l'« apparition rare toujours identique » est une condition 3D qui ne se déclenche que sur un état figé.** Pour la Galaxian 3D, le faisceau n'a qu'un interrupteur : `normIntensity > 0.005` (Stage3D L1709), alimenté par `intensity = max(R,G)` dont les deux seuls états possibles en lecture sont **0** (gate fermée, `energy ≤ 0.088` ou palette sombre) et **255** (gate ouverte, `energy ≥ 0.089`). L'energy étant l'energyCurve audio (QuickShowView L471), la gate ne s'ouvre que sur des crêtes — d'où la rareté — et le rendu est strictement le même à chaque fois (BUG-3D-3 : cône jaune, statique, géométrie constante). Pour l'IODA 400 RGY, c'est pire : aucun canal d'intensité reconnu (BUG-3D-1) → **le faisceau 3D ne peut jamais s'afficher**, même allumé au hardware ; le même bloc explique le « ne fait rien » permanent du bouton « Allumer » (BUG-3D-5).

## 7. Pistes de correctif (propositions — aucune écriture faite)

- 3D : considérer une fixture laser comme « allumée » (intensity=255) dès qu'un canal significatif est hors zone « off/fermée » : pour `wheel` → cap != zone noir (IODA…), pour `rgb` → gate > 0 ; consommer `scanX/scanY` comme pan/tilt du cône ; animer couleur/ouverture depuis pattern/rotations/zoom pour sortir du visuel figé.