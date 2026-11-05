# Review adversarial — boucle unique (theme-loop) + fix couleur `computeDmxCues`

Date : 2026-08-18 · Relecteur : subagent « Relecture boucle unique » · Lecture seule (aucun fichier modifié).

Commits vérifiés :
- `3367499` fix(dmx) — source couleur unique `cue.color` + hue par tier
- `5a98f8d` feat(theme-loop) — `src/engine/theme-loop.ts` + test
- `3518cf8` feat(ui) — réécriture `src/views/AutoLoopsPanel.tsx`

---

## 1. Verdict global : **OK** (avec réserves)

Les deux changements remplissent leur objectif et sont cohérents entre eux. Les trois points (a), (b), (c) sont confirmés (voir §3). Aucune régression du moteur chaser, aucun cas bloquant (pas de crash, pas de corruption de données, pas de break de build). Deux problèmes « mineur » à corriger avant de ship, dont un **blackout transitoire du hardware au montage de l'onglet** qui mérite une vraie attention.

---

## 2. Problèmes trouvés (classés par gravité)

### Bloquant
Aucun.

### Mineur

**M1 — Blackout transitoire du hardware à l'ouverture de l'onglet / à chaque changement de patch.**
`AutoLoopsPanel.tsx:119-129` : `stop()` appelle **inconditionnellement** `zeroAllUniverses()` (ligne 124), même quand aucun intervalle ne tourne (`intervalRef.current === 0`).
Or l'effet `useEffect(() => { stop(); purgeAutoLoops(...); }, [patchKey, stop])` (`AutoLoopsPanel.tsx:154-158`) exécute `stop()` :
- au premier montage de l'onglet,
- à chaque changement de `patchKey`.

`zeroAllUniverses()` (`AutoLoopsPanel.tsx:39-55`) envoie des zéros via `dmxBridge.writeTransient('vc', …)` sur la source **`vc`** (LTP, priorité 80 — `output-arbiter.ts:38`), ce qui **écrase** toute source HTP en cours (QuickShow = `quickshow` HTP 40) pendant ~2 s avant le `release`. Concrètement : si un show tourne et que l'utilisateur ouvre simplement l'onglet « Boucle unique » (ou patch/dépatche une fixture), le rig **s'éteint ~2 secondes**. L'ancien panneau n'avait pas ce comportement : son `stopAll()` ne faisait que `midiStopChaser()` sur les chasers lancés, no-op au montage (launchedRef vide).
Fix recommandé : ne zéroïser que si une boucle jouait réellement, ex. `if (intervalRef.current) { clearInterval(...); zeroAllUniverses(); }` — ou scinder `stopLoop()` (clear interval seul) et `blackout()` (arrêt utilisateur explicite).

**M2 — Code mort `getTierColorIndex`.**
`dmx-cues.ts:510` : la fonction `getTierColorIndex` n'a plus aucun appel depuis le fix `3367499` (l'unique call site a été supprimé). `noUnusedLocals` n'est pas activé (`tsconfig.json`), donc pas de break de build, mais c'est à nettoyer.

### Suggestion

**S1 — Incohérence latente sur le hex court (3 digits).**
`hexToRgb` local de `dmx-cues.ts` (et celui de `engine/dmx-color.ts`) ne gère pas le format `#abc`, alors que `hexToRgb` de `TrackTimeline.tsx:22-24` le gère (`h.length === 3`). Aucun impact aujourd'hui (les palettes `theme-loop.ts` et `genCuesLocal` produisent du 6 digits), mais si un `cue.color` 3 digits apparaissait, la timeline le rendrait correctement alors que `computeDmxCues` produirait `NaN`. À harmoniser.

**S2 — Libellé UI « la couleur du bloc = la couleur jouée » légèrement trompeur.**
`AutoLoopsPanel.tsx` (bloc de légende ~ligne 225 et footer ~ligne 262). Exact uniquement pour les fixtures **primary** (hue 0). Les fixtures `secondary`/`tertiary` sont décalées de 120°/240° par `TIER_HUE` — comportement voulu et cohérent avec la timeline, mais le message peut induire en erreur. Un mot (« couleur jouée par les fixtures primary = bloc ») clarifierait.

**S3 — Import mort dans `PerformanceView.tsx:12`.**
`computeDmxCues` y est importé mais jamais appelé (seul `computeDmxForCue` l'est, lignes 1286 et 1805). Le fix couleur n'impacte donc pas PerformanceView. Nettoyage d'import.

**S4 — Source `vc` partagée avec la Virtual Console.**
`AutoLoopsPanel.tsx:30/50` écrit sur `vc`, la même source que la VC (`PerformanceView.tsx:1579` et son helper `zeroAll` en `:71`). Les deux vues sont dans des onglets distincts, donc sans chevauchement en pratique, mais c'est un état partagé à garder en tête (deux écrivains sur le même `sourceId` s'écrasent mutuellement).

---

## 3. Confirmation explicite des points a / b / c

### a) `computeDmxCues` — source couleur + hue par tier : **CONFIRMÉ, cohérent**

- Source couleur unique : `const paletteColor = (cue as any).forcedColor || cue.color || cue.colors?.[0] || undefined;` (`dmx-cues.ts:694`). Priorité identique à `dmx-playback.ts` (`computeDmxForCue`, lignes 776/778 et 1206) : `forcedColor || color || colors[0]`. ✓
- Hue par tier : `[r, g, b] = applyHueShift([r, g, b], TIER_HUE[pf.tier]);` (`dmx-cues.ts:699`), appliqué dans la branche RGB uniquement (idem `dmx-playback.ts:1213` qui le fait aussi uniquement en RGB). ✓
- `TIER_HUE` (`engine/dmx-color.ts`) = `{ primary:0, secondary:120, tertiary:240, other:0 }` **identique** à `TIER_HUE_DEG` (`TrackTimeline.tsx:57`). ✓
- La formule HSL de `applyHueShift` (`dmx-color.ts`) et de `hueShiftHex` (`TrackTimeline.tsx:29-50`) est identique (mêmes calculs, même arrondi `Math.round((c+m)*255)`), donc **même couleur rendue** pour un même hex + même tier. ✓
- La branche color-wheel (pas de hue shift) est cohérente avec `computeDmxForCue` (toutes deux utilisent la couleur brute pour matcher la wheel). ✓

> Incohérences relevées : aucune bloquante. Voir S1 (hex court) — seul écart réel avec la timeline, sans effet aujourd'hui.

### b) `AutoLoopsPanel.tsx` — boucle de lecture, nettoyage, fuites, bouton : **CONFIRMÉ, avec la réserve M1**

1. **Écriture bridge + miroir chaque frame** : `writeFrame` (`AutoLoopsPanel.tsx:27-35`) appelle `dmxBridge.write('vc', dc.universe, dc.channelValues)` **et** `useAppStore.getState().setUniverseData(dc.universe, dc.channelValues)`. Le `setInterval` (`:138-143`) écrit chaque frame via `writeFrame(frames[next])`. La source `vc` est pré-enregistrée (`output-arbiter.ts:38`), donc `write` aboutit. `setUniverseData` attend bien `(universe: number, values)` (`appStore.ts:398`), et `dc.universe` est bien un index numérique (convention `universeIndex` documentée dans `dmx-cues.ts`). ✓
2. **Intervalle toujours nettoyé** : `stop()` (`:119-129`) fait `clearInterval` ; il est appelé sur **stop** (bouton), **changement de thème** (`:198`), **changement de patch** (`:154-158`), et **unmount** (cleanup `:162-166`). ✓ — *mais voir M1* : `stop()` fait aussi un blackout inconditionnel.
3. **Pas de fuite mémoire / pas de condition de course** : un seul `intervalRef` ; le chargement async des defs a un flag `cancelled` (`:74-86`) ; le bouton est `disabled` tant que `frames.length === 0`, donc on ne peut pas démarrer avant le chargement des defs ; tout changement de `theme`/`patch` passe d'abord par `stop()` (synchrone) avant le recalcul de `frames`, donc pas d'écriture avec un `frames` obsolète. ✓ (Une frame au plus peut être écrite entre un render de changement de patch et l'exécution de l'effet `[patchKey, stop]` — négligeable, intervalle ≥50 ms.)
4. **Bouton désactivé sans frames** : `disabled={frames.length === 0}` (`:233`) + garde `if (frames.length === 0) return;` dans `play()` (`:131`). ✓

### c) Aucune régression du moteur chaser (`auto-loops.ts`) : **CONFIRMÉ**

Les fonctions `generateLoopLibrary`, `materializeAutoLoops`, `generateAutoLoops` (ainsi que `refreshAutoLoops`, `purgeAutoLoops`, `AUTO_LOOP_FOLDER`) sont **toujours exportées** depuis `src/engine/auto-loops.ts` (lignes 330, 465, 277, 523, 498, 412). Le fichier de test `src/__tests__/auto-loops.test.ts` les importe toutes (ligne 2) et aucune signature n'a changé. `AutoLoopsPanel` n'importe plus que `purgeAutoLoops` (`:13`) pour le nettoyage des anciens chasers. Le commit `3518cf8` n'a touché que `AutoLoopsPanel.tsx` ; `auto-loops.ts` et son test sont intacts. ✓

---

REVIEW_DONE
