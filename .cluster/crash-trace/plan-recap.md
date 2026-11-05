# Plan — Crash DesignView + Exploitation laser (tour unifié)

## Contexte
1. Crash live utilisateur : `Cannot read properties of undefined (reading 'push')` dans un `useMemo` (bundle `index-evtRuieA.js:4572:406184`).
2. Nouveau retour utilisateur : « l'exploitation des chanels des lasers est nulle, toujours la même qui revient, pas exploitée du tout ».

## S1 — Trace du crash (fait, double preuve)
- **Source** : `src/views/DesignView.tsx:1106` — `useMemo fixturesByTier` :
  `const map = { primary: [], secondary: [], tertiary: [] };` puis `map[pf.tier || 'primary'].push(pf)`.
  Le bucket `other` manque alors que `FixtureTier = 'primary'|'secondary'|'tertiary'|'other'` (`showStore.ts:16,30`) et que l'UI expose le tier `other` (menu contextuel, badge cyan, `TIER_SECTION_META.other`).
  → une fixture tier `other` (patchée via UI ou chargée d'un show) => `map['other']` undefined => `undefined.push` => crash à chaque rendu de la vue.
- **Bundle** : `index-evtRuieA.js:4572` : `Te=na.useMemo(()=>{const se={primary:[],secondary:[],tertiary:[]}; ... se[L].push(Ze) ...}` — char 406182 vs stack 406184. Suivi par le traceur sous-agent (`subagent_trace.md`) : seul site du repo avec ce motif.
- **Scénario** : ouvrir l'onglet Scenes avec ≥1 fixture tier `other`.

## S2 — Correctif (fait, revue VALIDÉE)
- Nouveau `src/engine/tier-utils.ts` : `TIER_KEYS` (4 tiers) + `groupByTier` (buckets pré-initialisés + `(map[key] ??= [])` défense en profondeur).
- `DesignView.tsx` : `fixturesByTier` via `groupByTier` ; `TIER_ORDER = TIER_KEYS` (source unique).
- Test `src/__tests__/tier-utils.test.ts` (5 tests dont le scénario exact).
- Relecteur indépendant : **VALIDÉ** — 0 occurrence restante du motif `X[cléDynamique].push(`, réserves non bloquantes (R1-R4 documentées).

## S3 — Exploitation laser (fait, 6 nouveaux tests)
Audit de la chaîne : `fixture-analyzer.ts` (détection), `auto-loops.ts` (autoloop/library), `dmx-cues.ts` (autoscript beat-sync).
Problèmes trouvés : scan circulaire **parfaitement synchrone** entre lasers, rotations synchrones, vitesses figées à 160, bibliothèque rejouant toujours les mêmes variantes (steps fixe 8, cercle unique).

Correctifs appliqués :
- `buildLaserScanLoop` : déphasage par fixture (bracketing), nouvelle forme **Lissajous** (`variant: 'lissajous'`), vitesse de scan oscillante par step.
- `buildLaserPatternLoop` : rotations déphasées par fixture, vitesse de pattern oscillante.
- `buildLaserColorLoop` : rotations animées + déphasées.
- `generateLoopLibrary` : steps motif 6-12 aléatoires, balayage cercle/Lissajous au hasard.
- Replay recette (`buildLoopFromRecipe`) : conserve la forme lissajous/circle.
- `dmx-cues.ts` (autoscript) : phase par fixture (basée sur startAddress), ~1/3 des lasers en Lissajous, vitesse pattern 128±64 (plus de 160 figé), rotations déphasées.

Tests ajoutés (`laser-exploit.test.ts`) : déphasage scan 2 lasers jumeaux, vitesse scan 128→192, rotations déphasées, vitesse pattern, variantes circle+lissajous en bibliothèque, steps motif variables.

## S4 — Validation
- `tsc --noEmit` exit 0.
- `vitest run` : **252/252** passés (246 avant ; +6 laser, tier-utils 5 comptés dans les 252).
- Revue adversaire du correctif crash : VALIDÉ + scan exhaustif du motif.

## S5 — Build & livraison
- `npm run dist` (nsis + portable). Échec intermédiaire `spawn UNKNOWN` (NSIS, transitoire) → retry après suppression des exe partiels.
- Vérifier : bundle contient le fix (`other:[]` dans le bucket / groupByTier) + laser (lissajous/phase) ; les 2 exe frais ; suite de tests OK.
- Livraison : exe portable + setup, explication du crash + de l'exploitation laser.

## Réserves relecteur (non bloquantes, suivies)
- R1 : tri par nom resté dans DesignView (non testé) — proposer `sortBucketsByName` si on retouche tier-utils.
- R2 : TrackTimeline garde son ordre de tiers local — harmoniser plus tard.
- R3 : arbre git non commité (chantier multi-tours) — commit ciblé différé, non bloquant.
- R4 : `panIdx` sûr par construction — surveillance.