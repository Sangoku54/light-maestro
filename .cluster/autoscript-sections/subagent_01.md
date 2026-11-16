# Audit de différentiation des sections — Subagent 01

**Constat utilisateur** : « il n'y a pas assez de différences entre les sections (intro, verse, chorus…), on a l'impression de voir toujours le même show ».

**Verdict de l'audit** : le constat est **prouvé** par l'analyse du code. Deux causes racines :

1. **Chemin principal (QuickShow audio-reactive, `genCues`)** : les 5 leviers les plus visibles à l'écran (couleur du moment, intensité, strobe, colorTemp, vitesse de cycle couleur) sont pilotés **exclusivement par l'audio** (RMS/centroid/onset) — **la section n'est jamais consultée** pour ces leviers. Les seuls vrais différenciateurs par section sont : amplitude de mouvement, multiplieur d'énergie, pool de patterns, dimmerPulseOnBeat (booléen) — et leurs distributions se **chevauchent massivement**.
2. **Chemin Autoscript SoundSwitch (nouveau moteur)** : la section **n'existe pas du tout** dans le pipeline. `generateAutoscript()` ne reçoit aucun paramètre de section ; les 4 banques `DEFAULT_BANK_CONFIGS` sont statiques et identiques pour toute la musique ; `AutoloopPlaybackEngine.onBarBeat()` ignore les sections. Même entrée → même timeline, quelle que soit la section.

---

## 1. PREUVE DE LA SIMILARITÉ

### 1.1 Constantes — leviers fixés sans aucune référence à la section

| Levier | Ligne | Valeur générée | Dépend de… |
|---|---|---|---|
| **Couleur du moment** | `QuickShowView.tsx:665` `paletteIdx = (floor(progress * len * colorCycleSpeed) + floor(rng()*3)) % len` | pioche dans la palette | sectionPal (partagé) + **centroid/rms** + rng |
| **Vitesse de cycle couleur** | `QuickShowView.tsx:663` `colorCycleSpeed = 0.5 + centroid*1.5 + rms*2.0` | 0.5 → 4.0 | **centroid/rms uniquement** — identique pour verse et chorus à RMS égal |
| **Palette** | `QuickShowView.tsx:600` `sectionPal = customPalette?.[section]?.length > 0 ? customPalette[section] : basePal` | `basePal` (6 couleurs, ex. dance) **partagée par TOUTES les sections** si l'utilisateur n'a pas défini de palette par section (cas par défaut) | cfg.colorScheme |
| **Intensité** | `QuickShowView.tsx:611-619` mapping `rms > 0.75 → very-high … rms < 0.10 → very-low` | 5 niveaux | **rms uniquement** (ou cfg.intensity forcé → alors CONSTANT pour toutes les sections) |
| **Strobe (booléen cue)** | `QuickShowView.tsx:628` `strobe = beatStrong && rms > 0.35` | true/false | **beatStrong + rms** — pas la section |
| **StrobeProbability** | `QuickShowView.tsx:722` `dropAnticipation ? 0 : beatStrong ? 0.8 : 0.15` | 0 / 0.8 / 0.15 | beatStrong — pas la section |
| **ColorTemp** | `QuickShowView.tsx:672-674` `centroid < 0.35 ? warm : > 0.65 ? cool : neutral` | 3 valeurs | **centroid uniquement** — pas la section |
| **Vitesse de mouvement** | `QuickShowView.tsx:699-703` `baseSpeed = 0.3 + centroid*0.6` (×1.2 si beatStrong, ×1.5 si anticipation) | 0.3 → 0.9 | centroid — pas la section |
| **Zoom/Frost/Gobo/Prisme audio** | `dmx-playback.ts:1045` `fxPhase = ct * 2π * movementSpeed` | zoom = `64+sin(fxPhase*0.4)*96*energy+64*energy` | temps + movementSpeed — pas la section |
| **Fallback amplitude par tier** | `dmx-playback.ts:969-973` `primary→90, secondary→70, autre→40` | 90/70/40 | **court-circuité** : `genCues` définit TOUJOURS `movementAmplitude` (QuickShowView.tsx:684) → tous les tiers reçoivent la MÊME amplitude |

### 1.2 Distributions qui se chevauchent — les leviers « modulés » le sont trop peu

**Énergie** (`QuickShowView.tsx:677` `energy = rms * sectionEnergyMult * 0.85 + 0.15` ; mult. au L646-654) :

| Section | sectionEnergyMult | Plage d'énergie (rms ∈ [0,1]) | Chevauchement |
|---|---|---|---|
| intro | 0.3 → 0.7 | [0.15, 0.745] | ≈ outro [0.15, 0.66] — quasi identique |
| verse | 0.5 → 0.8 | [0.15, 0.83] | ∩ bridge [0.15, 0.745] sur toute la plage |
| chorus | 0.8 → 1.0 | [0.15, 1.0] | ∩ drop [0.15, 1.0] — **indiscernables** (0.8 vs 0.9 de base) |
| bridge | 0.4 → 0.7 | [0.15, 0.745] | = intro |
| drop | 0.9 → 1.0 | [0.15, 1.0] | = chorus |
| outro | 0.3 → 0.6 | [0.15, 0.66] | = intro |

→ À rms ≤ 0.4, **toutes les sections** produisent une énergie dans [0.15, 0.5] : un morceau au mix peu dynamique affiche la même énergie partout.

**Amplitude de mouvement** (`QuickShowView.tsx:684-697`) :

| Section | Formule | Plage DMX | Chevauchement |
|---|---|---|---|
| intro | `50 + rms*80` | [50, 130] | ∩ bridge [60, 140] |
| verse | `80 + rms*100` | [80, 180] | ∩ chorus [110, 220] sur [110, 180] |
| chorus | `110 + bassRatio*110` | [110, 220] | ∩ drop [140, 250] sur [140, 220] |
| bridge | `60 + rms*80` | [60, 140] | ∩ intro [50, 130] |
| drop | `140 + bassRatio*110` | [140, 250] | ∩ chorus |
| outro | `40 + rms*60` | [40, 100] | ∩ intro [50, 100] |

→ Les plages nominales sont distinctes mais les **distributions se recouvrent sur ~50-70 % de leur étendue** ; à bassRatio/rms moyens, verse ≈ chorus ≈ drop.

**Patterns de mouvement** (`QuickShowView.tsx:512-519` pools + choix `L582-586` `deduped[abs(h + floor(rms*7 + centroid*11 + rng()*13)) % len]` — **tirage pseudo-aléatoire**) :

- `wave` ∈ {intro, verse, bridge, outro} ; `figure8` ∈ {verse, chorus, bridge, build} ; `circle` ∈ {chorus, drop, build} ; `sweep` ∈ {verse, chorus, outro, build} ; `static` ∈ {intro, bridge}.
- Les biais genre ajoutent les mêmes patterns partout (ex. techno → `circle`+`spiral` dans TOUTES les sections, QuickShowView.tsx:525).
- **Preuve** : verse et chorus peuvent tous deux tirer `sweep` ou `figure8` → même mouvement à l'écran. Un verse « fort » (rms élevé) et un chorus « faible » (rms bas) convergent vers le même pattern, la même amplitude ([110,180]) et la même énergie.

**Strobe effectif** : gate existant mais binaire — `dmx-playback.ts:893` `(isDrop || isChorus) && active.strobe && pf.tier === 'primary'` → hors drop/chorus le strobe est coupé (bon différenciateur), mais à l'intérieur de drop/chorus il est purement audio.

### 1.3 Le pipeline Autoscript ignore totalement la section

- `autoscript-generator.ts:203` `generateAutoscript(input)` : **aucun paramètre de section**. Couleurs = greedy LRU déterministe (`scheduleColors` L103-137), positions = cues fixes (`defaultPositionCues()`), durée = `targetBars` fixé par banque.
- `autoloop-runtime.ts:214-226` `DEFAULT_BANK_CONFIGS` : 4 banques **statiques** (chase couleur / cercle / huit / cercle+huit+beam) — même contenu pour intro, verse, drop… rien ne varie avec la musique.
- `use-autoloop-engine.ts:129-131` `play()` : charge `b.get(activeBank, activeSlot)` — banque/slot choisis **manuellement** par l'utilisateur (boutons next/prev), jamais par section.
- `autoloop-engine.ts:205` `onBarBeat(bar, beat)` : ne reçoit **aucune info de section** ; `evaluate()` L244 rend la timeline active à la phase modulo — boucle identique à l'infini.

---

## 2. TABLEAU PAR SECTION — valeurs réellement générées (audio-reactive, config par défaut, sans palettes custom)

| Levier | intro | verse | chorus | bridge | drop | outro |
|---|---|---|---|---|---|---|
| Palette | basePal (6 c.) | basePal | basePal | basePal | basePal | basePal |
| Couleur du moment | index cyclique 0..5, vitesse 0.5-4.0 (audio) | idem | idem | idem | idem | idem |
| Intensité | rms-driven (5 niv.) | idem | idem | idem | idem | idem |
| Strobe | audio (beatStrong) | audio | audio | audio | audio | audio |
| ColorTemp | centroid-driven | idem | idem | idem | idem | idem |
| Énergie | 0.15-0.745 | 0.15-0.83 | 0.15-1.0 | 0.15-0.745 | 0.15-1.0 | 0.15-0.66 |
| Pattern | static/panOnly/tiltOnly/wave (aléa) | sweep/wave/figure8/randomWalk/tiltOnly (aléa) | circle/diamond/spiral/sweep/figure8 (aléa) | static/figure8/wave/randomWalk (aléa) | bounce/heartbeat/zigzag/diamond/circle (aléa) | sweep/wave/randomWalk/panOnly (aléa) |
| Amplitude | 50-130 | 80-180 | 110-220 | 60-140 | 140-250 | 40-100 |
| Vitesse mvmt | 0.3-0.9 (audio) | idem | idem | idem | idem | idem |
| dimmerPulse | non | non | **oui** | non | **oui** | non |
| Zoom/frost/gobo | sin(fxPhase), audio | idem | idem | idem | idem | idem |
| Tiers de fixtures | tous même amplitude/pattern | idem | idem | idem | idem | idem |

**Lecture** : seuls `Énergie`, `Pattern` (pool), `Amplitude`, `dimmerPulse` diffèrent par section — et les trois premiers ont des distributions chevauchantes + tirage aléatoire. C'est mécaniquement « le même show » avec de légères variations de vigueur.

---

## 3. TOP 8 LEVIERS DE DIFFÉRENTIATION INEXPLOITÉS (classés par impact visuel)

| # | Levier | Impact estimé | Fichier:ligne | Valeur proposée |
|---|---|---|---|---|
| 1 | **Palette par défaut par section** (aujourd'hui : basePal partagé) | ★★★★★ (la couleur est le 1er signal visuel) | `QuickShowView.tsx:600` | Ajouter `const DEFAULT_SECTION_PALETTES: Record<string,string[]> = { intro:['#334155','#475569','#64748b'], verse:['#1e90ff','#00ced1','#4682b4'], chorus:['#ff0064','#ffc800','#ff4500'], bridge:['#7b68ee','#8a2be2','#4b0082'], drop:['#ff0000','#ff6600','#ffff00'], outro:['#1e3a5f','#223a5e'] }` puis `sectionPal = customPalette?.[section] ?? DEFAULT_SECTION_PALETTES[section] ?? basePal` |
| 2 | **Vitesse de cycle couleur par section** (aujourd'hui : audio only) | ★★★★☆ | `QuickShowView.tsx:663` | `const cycleMult = { intro:0.4, verse:0.7, chorus:1.4, bridge:0.5, drop:1.8, outro:0.3, build:1.0 }[section.type] ?? 1; colorCycleSpeed = (0.5 + centroid*1.5 + rms*2.0) * cycleMult` |
| 3 | **Intensité nominale par section** (aujourd'hui : seuils RMS bruts) | ★★★★☆ | `QuickShowView.tsx:611-619` | Décaler les seuils : `const iBoost = { intro:0.8, verse:0.9, chorus:1.1, drop:1.3, outro:0.7, bridge:0.85 }[section.type] ?? 1;` puis `rms* = min(1, rms*iBoost)` avant le mapping — un drop atteint very-high à rms 0.57, un intro seulement à rms 0.94 |
| 4 | **Strobe par section** (aujourd'hui : audio + gate binaire drop/chorus dans le playback) | ★★★★☆ | `QuickShowView.tsx:628` | `const strobe = (section.type==='drop'||section.type==='chorus'||section.type==='build') && beatStrong && rms>0.35` (et `strobeProbability` L722 : `drop ? 0.9 : chorus ? 0.6 : build ? 0.35 : 0.05`) |
| 5 | **Différenciation par tier de fixtures** (aujourd'hui : movementAmplitude court-circuite le fallback tier 90/70/40) | ★★★★☆ | `QuickShowView.tsx:684` (ou `dmx-playback.ts:969-973`) | Multiplier l'amplitude par tier : `movementAmplitude * (tier==='primary'?1 : tier==='secondary'?0.7 : 0.4)` — ou ne pas écrire `movementAmplitude` pour les tiers non-primary et laisser le fallback s'appliquer ; idem pour le pattern : tier primary → pattern principal, autres tiers → `panOnly`/`static` |
| 6 | **Patterns distribués par fixture (chorégraphie)** (aujourd'hui : un seul pattern partagé, seule la phase moteur diffère) | ★★★☆☆ | `dmx-playback.ts:1008-1019` | Utiliser le mécanisme existant `getSmartMovement(mobileIdx, totalMobile, sec, ct)` (dmx-movement.ts:36) qui distribue déjà un pattern PAR FIXTURE — l'appeler systématiquement pour les fixtures non-primary, ou assigner un `movement` différent par tier dans genCues |
| 7 | **Couches de fixtures actives par section** (aujourd'hui : toutes les fixtures jouent toutes les sections, aucune référence fixture dans les cues) | ★★★☆☆ | `genCues` QuickShowView.tsx (push cue L708-728) | Ajouter un champ `activeTiers: string[]` par cue (ex. intro:['primary'], verse:['primary','secondary'], chorus:tous, drop:tous, outro:['primary']) et filtrer dans `dmx-playback.ts` (`if (!cue.activeTiers?.includes(pf.tier)) → dimmer 0 / skip`) |
| 8 | **Autoscript : mapping section → timeline** (aujourd'hui : 4 banques statiques, aucune notion de section) | ★★★☆☆ | `autoloop-runtime.ts:214-226` + `use-autoloop-engine.ts:129-131` | Générer des timelines PAR SECTION : `const SECTION_CONFIGS: Record<string, Partial<BankConfig>> = { intro:{targetBars:32, positionCues:[], colorChangeEveryBars:8}, verse:{targetBars:16, positionCues:[sweep], colorChangeEveryBars:6}, chorus:{targetBars:8, positionCues:[circle,eight], colorChangeEveryBars:2, beamCues}, drop:{targetBars:8, positionCues:[bounce], colorChangeEveryBars:1, beamCues}, outro:{targetBars:32, positionCues:[], colorChangeEveryBars:8} }` et déclencher via `onSectionChange(section)` → `engine.load(generateAutoscript(SECTION_CONFIGS[section]))` |

### Leviers bonus (mentionnés dans l'analyse, impact moindre)
- **Zoom/frost/gobo modulés par section** : `dmx-playback.ts:1045-1060` — `fxPhase` ne dépend que du temps ; ajouter un multiplicateur par section (zoom serré en drop, frost en bridge).
- **Gradient par défaut** : le code gère `cfg.customGradients[section]` (QuickShowView.tsx:666-674) mais il est vide par défaut → générer un gradient automatique par section (ex. drop : rouge→orange).
- **colorTemp par section** : actuellement centroid-only (L672-674) ; le legacy `getSectionProfile` a déjà un mapping par section (`baseColorTemp` L261-264) non utilisé en audio-reactive.
- **dimmerPulseOnBeat** : déjà par section mais binaire (L723) — pondérer (chorus 0.5×, drop 1×).

---

## 4. SYNTHÈSE

Le problème n'est pas un bug mais une **architecture audio-centrée** : `genCues` a été conçu pour réagir à la musique (ce qui est bien) en sacrifiant l'identité des sections. La section n'influence que 4 paramètres sur ~14 leviers visibles, avec des plages chevauchantes et un tirage aléatoire qui brouille les frontières. Le nouveau moteur Autoscript, lui, est **structurellement sans sections** (banques fixes, choix manuel). Les correctifs à plus fort rendement visuel sont les #1 (palettes), #2 (vitesse de cycle), #3 (intensité), #5 (tiers) — tous dans `QuickShowView.tsx`, chirurgicaux, sans changer l'architecture.
