# subagent_03.md — Auditeur tests/régressions : fix `strobeOffset`

**Mission** : auditer les tests et les régressions pour le fix à venir — nouveau champ `strobeOffset` dans `src/engine/fixture-analyzer.ts` (canaux nommés `/\bstrobe\b/i` classés `strobeOffset` au lieu de `effectOffset`/`shutterOffset`) + blocs shutter de dmx-cues/dmx-playback/Stage3D écrivant **0** (pas 255) sur `strobeOffset`. Audit uniquement, aucune implémentation.

---

## VERDICT

Le fix est **nécessaire et correct** pour les cas cibles (Tonio 6 arm : canal « Strobe » typé **Effect** ; canaux « Strobe » typés **Shutter** du format QLC+), **mais la détection par nom naïve `/\bstrobe\b/i` sans exclusion est DANGEREUSE** : elle reclassifie des **vrais shutters** en `strobeOffset`.

Mesures sur la bibliothèque OFL réelle (620 fixtures, mode le plus long) :
- **245 canaux** dont le `shutterOffset` actuel vient d'un canal nommé « Strobe » (changerait avec la regex naïve) — dont **84+ composites « Shutter / Strobe »** (vrais shutters, 0 = fermé → écrire 0 = **lumière ÉTEINTE**).
- **4 canaux** dont l'`effectOffset` actuel vient d'un canal nommé « Strobe » (Chroma-Q Color Force II « Strobe Density », Showtec Horizon 8 « Clas Strobe ») — sans danger (0 = pas de strobe).
- 345 canaux nommés « Strobe » non classés (type Nothing/Speed/Colour/Intensity) → inchangés.
- 67 fixtures gardent un `shutterOffset` d'un autre canal → inchangées.

**Recommandation ferme** : la regex doit **exclure les noms contenant `shutter` ou `dimmer`** (variante B mesurée : 152 changements, 0 composite-shutter) — sinon coemar ProSpot 250 LX, futurelight DMH-75.i, robe-robin-300e, la plupart des movers American-DJ, 5Star-Systems Spica-250M… s'éteignent (0 = Closed). Complément recommandé : garde par caps (premier cap à DMX 0 = Open/NoFunction) pour couvrir les 2 cas résiduels « Strobe = shutter fermé » (tomshine 80W 2022, cameo Thunder Wash mode 1-ch) — voir §Risques résiduels R1/R2.

**Impact tests** : 1 seule assertion de test casse (`laser-exploit.test.ts` L101, DS-1000). Tout le reste passe, mais des tests **doivent être ajoutés** pour verrouiller le nouveau comportement (Tonio, écriture 0, simulate strobe) — sinon le fix n'est pas protégé.

---

## 1. Tests audités — verdict par test

### 1.1 `laser-exploit.test.ts` — **1 assertion CASSE, à mettre à jour** ⚠️

Fixture concernée : `laserRot` (DS-1000, inline L43-56) :
```ts
chC('Strobe Effect', 'Shutter', 2, [cap(0, 0, 'NoFunction'), cap(1, 255, 'ShutterStrobe')]),
```
Canal nommé « Strobe Effect » typé **Shutter** → passe AVANT dans `shutterOffset` (switch case 'Shutter'), APRÈS le fix dans `strobeOffset`.

| Test | Ligne | Assertion | Verdict |
|---|---|---|---|
| « DS-1000 : 3 rotations + blanking + strobe » | L101 | `expect(fa.shutterOffset).toBe(2)` | **CASSE** → `expect(fa.strobeOffset).toBe(2)` + `expect(fa.shutterOffset).toBe(null)` |
| idem | L97-103 | rotations `[6,7,8]`, blank 9, scanX/Y 3/4, pattern 1, mode 0 | ✅ inchangé |
| « EL-400 : pattern synthétisé… » | L93 | `fa.effectOffset` null | ✅ (pas de canal strobe) |
| « IODA : Program capté comme MODE » | L396 | `fa.shutterOffset` null | ✅ (« Program » ne matche pas strobe) |
| « Show Mode laser → mode stable » | L409 | `fa.effectOffset` null | ✅ |
| « non-laser : Program garde shutter » | L416 | `fa.shutterOffset` = 1 | ✅ |
| « Galaxian 3D : R+G détectés » | L434 | `fa.shutterOffset` null | ✅ (« Red Laser »/« Green Laser » ne matchent pas strobe) |
| « un loop laser pose sa baseline » | ~L128 | blanking 0, steps non vides | ✅ (laserBaseline n'écrit plus 255 sur le canal strobe → rien d'asserté là-dessus) |
| « écrit mode, scan, rotations et blanking sur une cue » (computeDmxForCue) | ~L365 | ch[4]≠128, ch[7] défini, ch[10]=0 | ✅ (aucune assertion sur addr 3 = canal strobe) |
| Tous les autres (tick laser, gates, loops, Allumer) | — | — | ✅ (aucun canal nommé « Strobe » hors laserRot) |

**Note sémantique** : pour le DS-1000, `strobeOffset` + écriture 0 est **correct** (0 = NoFunction sur ce canal) — le test doit verrouiller ce nouveau comportement.

### 1.2 `diag-tonio.test.ts` — **PASSE mais à transformer en vrai test** ⚠️

- Charge `resources/fixtures/custom/custom-tonio-6-arm.json` (canal 11 « Strobe », type **Effect**, offset 10).
- Assertions actuelles : `expect(fa).toBeTruthy()` et `expect(out.length).toBeGreaterThan(0)` → **ne cassent pas**.
- MAIS le dump change : `effectOffset: 10 → null`, `shutterOffset: null → null`, nouveau `strobeOffset: 10` ; `ch11_strobe` passe de 0 (safety net, isLaser) à **0 hors strobe / strobeRate (160-255) en strobe**.
- Recommandation : convertir en test stable (voir §3, T1) — c'est le cas utilisateur réel du bug.

### 1.3 `auto-loops.test.ts` — **PASSE, inchangé** ✅

- Fixture `strobeRgb` (L60-66) : canal nommé **« Shutter »** typé Shutter → ne matche PAS `/\bstrobe\b/i` → reste `shutterOffset` → le loop 'strobe' et le test « white fill » (L385-396, assertions sur R/G/B/intensity uniquement) passent.
- Aucune autre fixture des tests auto-loops n'a de canal nommé « Strobe » (wheelHead, goboHead, fxHead, prismHead, beamHead… non).
- Note : le fix retire des `shutters` les fixtures strobe-only → le loop kind 'strobe' n'est plus généré pour elles. Aucun test ne le couvre → rien ne casse, mais comportement à documenter (cf. R4).

### 1.4 `library-coverage.test.ts` (couverture OFL 600+) — **PASSE (filet de sécurité)** ✅

- I1 (analyse sans exception) : le fix ne jette pas → OK.
- I2 (computeLaserChannels, valeurs entières [0,255]) : `computeLaserChannels` n'écrit **ni** shutter **ni** strobe (bloc laser pur : mode/pattern/scan/roue/gates/vitesses/rotations/blanking) → OK.
- I3 (laser exploitable) : ne référence pas shutter/strobe → OK.
- Rôle : filet générique — à relancer après le fix.

### 1.5 Autres tests — **PASSE, non concernés** ✅

`gencues.test.ts` (« effect: 'strobe' » = string de cue, pas un canal fixture), `scene-fixtures.test.ts` (« strobe » = nom de dossier), `track-override-priority.test.ts` (computeStrobeTrackOverrides = tracks, pas de layout), `spatial-choreo.test.ts`, `chaser-track.test.ts`, `autoloop-engine.test.ts` (channelMap à la main), `autoloop-runtime.test.ts` (mover-rgb/wash-rgb sans strobe), `dmx-movement.test.ts`, `gdtf-parse.test.ts` / `gdtf-vendor.test.ts` / `ofl-parse.test.ts` (niveau parsing : `ShutterStrobe → 'Shutter'`, `^strobe → 'Shutter'` — inchangé), `autoscript-sections.test.ts` (strobeProbability cue-level), `scene-3d-config.test.ts`, `output-arbiter`, `playback-clock`, `tier-utils`, `mtc-decode`, `osc-decode`, `audio-cache`, `app-store-dirty`, `clamp-rect`, `latency-meter` — aucun lien avec l'analyse de canaux.

### 1.6 `.tmp-strobe-audit.test.ts` (présent dans `__tests__/`) — **À SUPPRIMER avant commit** ⚠️

Fichier de mesure temporaire (d'un subagent précédent), `expect(true).toBe(true)`. Contient des mesures précieuses (utilisées ici) mais ne doit pas être committé. → supprimer (ou convertir en test permanent de non-régression, cf. §3 T2).

---

## 2. Fixtures avec canaux « Strobe » — inventaire

### 2.1 Dans les tests (JSON inline ou fichiers)
| Fixture | Canal | Type | Classification AVANT | APRÈS fix | Impact test |
|---|---|---|---|---|---|
| laserRot (DS-1000, inline laser-exploit) | « Strobe Effect » | Shutter | shutterOffset=2 | strobeOffset=2 | L101 casse |
| custom-tonio-6-arm.json (diag-tonio) | « Strobe » (canal 11) | **Effect** | effectOffset=10 | strobeOffset=10 | dump change, assertions non |

### 2.2 Dans la bibliothèque réelle (OFL + custom app) — par type de caps à DMX 0
| Groupe | Exemples | 0 = … | Écriture 0 après fix |
|---|---|---|---|
| « Strobe » pur (0 = Open/NoFunction) | eurolite LED Theatre COB, event-lighting Par12x12/Par5x12, litecraft WashX.21, showtec LED Light Bar, briteq BT-STAGEPAR « Strobe », cameo Auro Beam/Flash Matrix/Thunder Wash (modes ≥2ch), chauvet-slimpar-56 (custom, 0-15 No function), DS-1000 | pas de strobe | ✅ CORRECT |
| « Shutter / Strobe » & variantes (0 = **Closed**) | coemar ProSpot 250 LX, futurelight DMH-75.i, robe-robin-300e (custom), 5Star-Systems Spica-250M, American-DJ (12P Hex, 18P Hex, COB Cannon, Crazy Pocket, Illusion Dotz, Inno Pocket, Mega Hex, Saber Spot, Stinger Spot, Vizi…), AFX-LMH460Z | **fermé → ÉTEINT** | ❌ RÉGRESSION si pas d'exclusion |
| « Dimmer / Strobe » (0 = fermé) | custom-stage-right-stage-wash-7x10w-led-moving-head (custom, caps 0-7 Closed/8-134 Intensity/135-255 Strobe), + 5 occurrences OFL | **fermé** + capturé intensityOffset | ❌ RÉGRESSION si pas d'exclusion « dimmer » |
| « Strobe » = shutter ouvert/fermé (0 = **Closed**) | **tomshine 80W Mini Gobo Moving Head (2022)**, **cameo Thunder Wash 100/600 (mode 1-channel)** | **fermé → ÉTEINT** | ❌ RÉGRESSION (cas rare demandé : liste ci-dessus) |
| Paramètres strobe | Chroma-Q Color Force II (« Strobe Density/Frequency/Duration »), Showtec Horizon 8 (« Clas Strobe »), « Strobe Speed », « Strobe 16bit (fine) », « Zone N … Strobe Rate/Duration » | paramètre 0 | ⚠️ acceptable (0 = neutre), sémantique de valeur approximative si strobe demandé |

**Types réels mesurés (OFL)** : 322 canaux nommés « Strobe » typés **Shutter**, 243 **Nothing**, 5 **Speed**, 18 **Colour**, 5 **Effect**, 1 **Intensity**. Variantes de noms : « Strobe » (229), « Shutter / Strobe » (82), « Strobe N » (1-32, pixels), « Strobe 16bit (fine) » (20), « Zone N C Strobe Rate/Duration » (48), « Strobe / Speed / Sound Sensitivity » (9), « Extended Strobe », « Strobe Simple », « Strobe Functions », « Strobe Multifunctional », « Laser Strobe », « Beam Strobe », « LED Strobe », « Random Strobe », « FX Strobe », « Linear Strobe », « Dimmer / Strobe » (5), etc.

---

## 3. Helpers de test & typage

- Les tests construisent les fixtures via `pf(partial)` + `def(id, channels)` **inline** (laser-exploit, auto-loops, autoloop-runtime) ou chargent un JSON (diag-tonio). **Aucun test ne construit d'objet `FixtureChannelAnalysis` à la main** → l'ajout de `strobeOffset: number | null` à l'interface **ne casse aucun typage de test**.
- L'unique littéral à mettre à jour est le constructeur dans `fixture-analyzer.ts` (~L215-252, `const fa: FixtureChannelAnalysis = {...}`) → ajouter `strobeOffset: null`.
- Consommateurs typés : `auto-loops.ts` (`ChannelAnalysis` = alias de `FixtureChannelAnalysis` via fixture-analyzer L122), `dmx-playback.ts` (L271-272), `dmx-cues.ts` (L19), `Stage3D.tsx` (L23, `type FixtureChannelMap = FixtureChannelAnalysis`). Tous passent par l'analyseur → pas d'objets à la main.
- `dmx-channel.ts` (L8-41) : doublon legacy avec sa **propre** interface `ChannelAnalysis` (plus étroite), **plus importé par personne** (vérifié : tous les imports viennent de `./fixture-analyzer`). Pas d'obligation de le modifier ; si on le touche pour cohérence documentaire (subagent_02 §3.0d), ajouter `strobeOffset` à son interface + littéral L33, sinon le laisser tel quel (dead code, aucun risque TS).

---

## 4. Consommateurs `shutterOffset` / `effectOffset` (grep src/)

| Fichier | Usage | Effet du fix (strobeOffset) |
|---|---|---|
| `auto-loops.ts` L249/291/351/383/418/456/492/526/548 | `put(..., shutterOffset, 255)` (baselines) | Canal « Strobe » non écrit → **0 par défaut** → OK pour un vrai strobe ; ❌ pour « Shutter / Strobe »/tomshine (0 = fermé) si pas d'exclusion. Loop kind 'strobe' (L820/1082, filtre `shutterOffset !== null`) n'est **plus généré** pour les fixtures strobe-only → changement de contenu auto (cf. R4) |
| `auto-loops.ts` L734 | filtre effects (`effectOffset !== null && effectCaps.length > 0`) | Tonio/« Strobe » typé Effect n'y était pas (pas de caps) → inchangé |
| `autoloop-runtime.ts` L83-84 | `channelMap['shutter'/'effect']` | Canal « Strobe » ne mappe plus ni l'un ni l'autre → moteur SoundSwitch l'ignore → 0 → OK pour un vrai strobe ; ❌ pour les composites si pas d'exclusion |
| `dmx-cues.ts` L815-818 | fallback effect 2c (8 + idx*10) | Ne s'applique plus à « Strobe » typé Effect (plus `effectOffset`) → **c'est le fix du bug Tonio** |
| `dmx-cues.ts` L824-839 | bloc shutter (255 open / mapping intensity / strobeRate) | + bloc strobe séparé (0 / strobeRate) — cf. subagent_02 §3.1 ; ⚠️ exclure l'exclusion shutter/dimmer dans l'analyseur, sinon ce bloc ne touche plus les « Shutter / Strobe » |
| `dmx-cues.ts` L1016-1017, L1032-1033 | safety net 128/0, min-DMX 255 | Le bloc strobe écrit la clé explicitement → le safety net ne met plus 128/255 sur le canal strobe (garde de robustesse : `continue` sur strobeOffset dans le safety net) |
| `dmx-playback.ts` L813 | extinction hors tiers (shutter → 0) | Ajouter strobe → 0 (sinon une fixture éteinte garde un strobe résiduel) |
| `dmx-playback.ts` L908-957 | bloc shutter live (255/0 oscillation, soft strobe) | Factoriser la décision + bloc strobe (0 / 8+speed*20) — subagent_02 §3.2 |
| `dmx-playback.ts` L959 | **simulate strobe : `if (fa.shutterOffset===null)`** | **DOIT devenir `if (fa.shutterOffset===null && fa.strobeOffset===null)`** sinon double strobe (dimmer oscillé + canal strobe) — cas test T5 exigé par la mission |
| `dmx-playback.ts` L1465-1483 | bloc shutter computeDmxForCue (snapshot/crossfade) | + bloc strobe (0 / 8+speed*20) — sinon le canal strobe reçoit 255 pendant chaque crossfade |
| `Stage3D.tsx` L1575-1591 | lecture shutter (0-31 = closed → intensity=0) | Bloc strobe **séparé** : 0 = off (PAS closed), valeurs 8-255 → strobeHz ; sinon fixture strobe-only affichée **éteinte** en 3D (cf. R5) |
| `dmx-helpers.ts` L137-141 | `buildFixtureOnChannelValues` (bouton Allumer) : 255 sur 1er canal typé Shutter | Non affecté (basé type, pas analyseur) — pour un canal « Strobe » typé Shutter, Allumer = 255 = strobe max (quirk préexistant, hors scope du fix, à noter) |
| `dmx-channel.ts` | dead code | rien |

---

## 5. Tests à mettre à jour

1. **`laser-exploit.test.ts`** (1 changement obligatoire) :
   - « DS-1000 : 3 rotations + blanking + strobe » L101 : `expect(fa.shutterOffset).toBe(2)` → `expect(fa.strobeOffset).toBe(2); expect(fa.shutterOffset).toBe(null);`
   - (recommandé) dans « écrit mode, scan, rotations et blanking sur une cue » : ajouter `expect(ch[3]).toBe(0)` (canal strobe DS-1000 = 0 hors strobe) pour verrouiller l'écriture 0.
2. **`diag-tonio.test.ts`** : convertir le 2ᵉ test (actuellement dump console) en assertions stables — voir T1 ci-dessous. Renommer le fichier/test (le préfixe « temporary diagnostic » n'a plus lieu d'être).
3. **`auto-loops.test.ts`** : aucun changement requis ; (recommandé) ajouter un test pour une fixture strobe-only (cf. T6).
4. **`.tmp-strobe-audit.test.ts`** : supprimer avant commit (ou transformer en test « aucune fixture "Shutter / Strobe"/"Dimmer / Strobe" classée strobeOffset » — cf. T2).

---

## 6. Nouveaux tests à proposer

- **T1 — fixture-analyzer : Tonio 6 arm réel** (charge `resources/fixtures/custom/custom-tonio-6-arm.json`) : `fa.strobeOffset === 10`, `fa.shutterOffset === null`, `fa.effectOffset === null`, `fa.intensityOffset === 9`. *(exigence mission)*
- **T2 — fixture-analyzer : classification par nom** :
  - « Strobe » typé **Shutter** (synthetique DS-1000-like) → `strobeOffset`, `shutterOffset` null ;
  - « Strobe » typé **Effect** sans caps (Tonio-like) → `strobeOffset`, `effectOffset` null ;
  - « Shutter » typé Shutter → `shutterOffset` (inchangé) ;
  - **« Shutter / Strobe » et « Dimmer / Strobe » → PAS `strobeOffset`** (règle d'exclusion) — non-régression des vrais shutters ;
  - « Strobe Speed » typé Speed → pas `strobeOffset` (si la règle d'exclusion « paramètres » est retenue).
- **T3 — dmx-cues (computeDmxCues) : fixture strobeOffset + dimmer** : cue `strobe: false` (outro) → canal strobe = **0**, dimmer > 0 ; cue `strobe: true` (drop/chorus) → canal strobe = **strobeRate** (160-255), dimmer inchangé. *(exigence mission : « canal strobe écrit 0 quand pas de strobe et valeur strobe quand strobe demandé »)*
- **T4 — dmx-cues : fixture avec shutter ET strobe séparés** : shutter = 255 (open) ET strobe = 0/rate — les deux canaux écrits indépendamment, jamais 255 sur le strobe.
- **T5 — dmx-playback (computeDmxForCue) : pas de simulate dimmer quand strobeOffset existe** : fixture strobeOffset (sans shutterOffset) + cue strobe:true → le DIMMER ne pulse pas (valeur pleine stable), le canal strobe porte la valeur strobe ; cue strobe:false → strobe 0. *(exigence mission)*
- **T6 — auto-loops : fixture strobe-only** : plus de loop kind 'strobe' généré (elle n'est plus classée shutter), et la baseline n'écrit pas 255 sur son canal (0 par défaut) — documente le changement de comportement R4.
- **T7 — Stage3D (optionnel, hors vitest si trop lourd) : fixture strobeOffset seule** → en 3D, canal strobe à 0 = lumière allumée (PAS `shutterClosed`), valeur 64-179 → blink.

---

## 7. Risques résiduels

- **R1 (BLOQUANT) — Regex naïve → vrais shutters éteints.** Les ~84-91 canaux « Shutter / Strobe » (coemar ProSpot 250 LX, futurelight DMH-75.i, robe-robin-300e, movers American-DJ, Spica-250M…) et « Dimmer / Strobe » (custom-stage-right, 5 OFL) seraient reclassifiés `strobeOffset` → écrits **0 = Closed → lumière éteinte**. Exclusion obligatoire : `/\bstrobe\b/i.test(nom) && !/\bshutter\b/i.test(nom) && !/\bdimmer\b/i.test(nom)` (et préserver la priorité du check `isShutterDimmer`). Mesuré : variante B = 152 changements dont **0 composite-shutter** (vs 245 dont 84 avec A).
- **R2 — Cas rares « Strobe = shutter ouvert/fermé » (0 = Closed) trouvés** : **tomshine 80W Mini Gobo Moving Head (modes 9-ch/11-ch 2022, 0-7 Closed)** et **cameo Thunder Wash 100/600 RGB/RGBW/W (mode 1-channel, 0-10 Closed)**. Après variante B, ils passent encore en `strobeOffset` → 0 = éteint (aujourd'hui 255 = open/strobe). Guard recommandé : ne classer en `strobeOffset` que si le premier cap à DMX 0 est Open/NoFunction (ou caps absentes). Ces 2 fixtures sont exactement le cas « Strobe signifie Shutter » demandé par la mission.
- **R3 — Paramètres strobe reclassifiés** : « Strobe Speed/Frequency/Duration/Density » (Chroma-Q Color Force II, Showtec Horizon 8 « Clas Strobe »), « Strobe 16bit (fine) », « Zone N … Rate/Duration » (48) deviennent `strobeOffset` → écrits 0 (neutre, acceptable) mais un strobe demandé écrirait un « rate » sur un canal de durée/densité → sémantique approximative. Acceptable si documenté ; variante D (exact ^Strobe$) l'éviterait au prix de rater « Strobe Effect » (DS-1000) et « Extended Strobe ».
- **R4 — auto-loops / autoloop-runtime hors scope du fix** : les fixtures strobe-only perdent leur loop kind 'strobe' (plus classées `shutterOffset`) et le canal n'est plus écrit 255 → 0. Correct pour un vrai strobe, mais **contenu auto réduit** (changement de comportement, pas de test existant pour le détecter). Si on veut préserver les loops strobe : filtrer `shutterOffset !== null || strobeOffset !== null` et écrire 0 sur strobeOffset dans buildStrobeLoop.
- **R5 — Stage3D** : si `strobeOffset` est lu avec la sémantique shutter (0-31 = closed → intensity=0), toute fixture strobe-only apparaît **éteinte en 3D** alors que le DMX réel est allumé. Le bloc doit être séparé (0 = off, jamais `shutterClosed`), cf. subagent_02 §3.6.
- **R6 — dmx-playback simulate strobe** : oublier `&& fa.strobeOffset === null` (L959) = double strobe (dimmer oscillé + canal strobe) sur les fixtures à canal strobe dédié — couvert par T5.
- **R7 — dmx-cues safety net / min-DMX** : si le bloc strobe n'écrit pas la clé explicitement, le safety net met 128 (ou 0 si laser) sur le canal → strobe fantôme. Le bloc strobe doit écrire 0/rate à chaque cue (et `continue` dans le safety net).
- **R8 — dmx-helpers (bouton Allumer)** : écrit 255 sur tout canal typé Shutter → sur un « Strobe » typé Shutter (DS-1000, chauvet), Allumer = strobe max. Préexistant, non couvert par le fix — à décider (peut-être aligner via l'analyseur plus tard).
- **R9 — Fichier temporaire** `.tmp-strobe-audit.test.ts` dans `__tests__/` à supprimer avant commit.

---

## 8. Synthèse

| Fichier test | Verdict | Action |
|---|---|---|
| laser-exploit.test.ts | ⚠️ 1 assertion casse | L101 → `strobeOffset` + assert null shutter |
| diag-tonio.test.ts | ✅ passe, dump change | transformer en test stable T1 |
| auto-loops.test.ts | ✅ passe | (+ T6 recommandé) |
| library-coverage.test.ts | ✅ passe (filet) | relancer après fix |
| 20 autres fichiers de tests | ✅ non concernés | rien |
| .tmp-strobe-audit.test.ts | ⚠️ temp | supprimer avant commit |
| **Nouveaux tests** | — | T1..T7 (§6), minimum T1 (Tonio → strobeOffset=10), T3 (dmx-cues 0/rate), T5 (pas de simulate dimmer) |

**Point d'attention principal pour l'implémenteur** : la détection par nom doit être **variante B** (exclusion `shutter|dimmer`) + garde caps si possible, sinon le fix « Tonio » éteint des dizaines de fixtures réelles (R1/R2). Les mesures (245/84/152/4/345/67) proviennent de `.tmp-strobe-audit.test.ts`, reproductibles.
