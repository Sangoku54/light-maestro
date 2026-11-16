# Revue régression — commits récents vs « lecture des cues de l'autoscript »

Relecteur adversarial (lecture seule). Aucun fichier modifié.

## 1. Verdict global

**NON — les 4 commits récents ne peuvent PAS être la cause du bug « couleurs timeline ≠ couleurs jouées » de l'autoscript.**

La preuve tient en un fait structurel : le chemin de lecture de la timeline (l'autoscript) passe par `computeDmxForCue` (`src/hooks/dmx-playback.ts:1128`), et **aucun des 4 commits ne touche `dmx-playback.ts` ni `QuickShowView.tsx`**. Le seul fichier de calcul DMX modifié (`src/hooks/dmx-cues.ts`, commit `3367499`) contient `computeDmxCues`, qui n'est appelé **que** par le panneau « Boucle unique » et par son test — jamais par la timeline.

## 2. Analyse commit par commit

### Commit `3367499c648442ce51fbbdb265b1248ce6d29fff` — fix(dmx) couleurs jouées = couleurs des blocs
- Ne modifie que `src/hooks/dmx-cues.ts` (7 insertions, 11 suppressions).
- Changement : dans `computeDmxCues` (déf. `dmx-cues.ts:543`), la logique couleur passe d'une rotation de palette « par section » à la source unique :
  - avant : rotation `sectionColorShift` + offset par tier (`getTierColorIndex`).
  - après : `const paletteColor = (cue as any).forcedColor || cue.color || cue.colors?.[0] || undefined;` (`dmx-cues.ts:694`) puis `applyHueShift([r,g,b], TIER_HUE[pf.tier])` (`dmx-cues.ts:699`).
- **Vérification par grep des appelants de `computeDmxCues` :**
  - `src/views/AutoLoopsPanel.tsx:99` → `computeDmxCues({ cues, patchedFixtures, fixtureDefs, universeIds })` (seul appel de production).
  - `src/__tests__/theme-loop.test.ts:70` → test uniquement.
  - `src/views/PerformanceView.tsx:12` → **import seulement, jamais appelé** dans le fichier (grep ne remonte que la ligne d'import).
- **Vérification par grep des appelants de `computeDmxForCue` (timeline) :**
  - Définition : `src/hooks/dmx-playback.ts:1128`.
  - Appels : `src/views/QuickShowView.tsx:134` et `:2215` ; `src/views/PerformanceView.tsx:1286` et `:1805`.
  - `computeDmxForCue` possède déjà la même logique « source unique » : `return (cue as any).forcedColor || cue.color || cue.colors?.[0] || undefined;` (`dmx-playback.ts:1206`) et `applyHueShift(..., TIER_HUE[pf.tier])` (`dmx-playback.ts:1213`) — inchangés.
- **Conclusion partielle** : ce commit a aligné `computeDmxCues` sur le comportement *déjà existant* de la timeline. Il ne touche pas la timeline. Il ne peut donc pas casser l'autoscript. ✔

### Commit `5a98f8dc458f2f44617dd41c91588abda1a9b0d7` — feat(theme-loop)
- Ajoute deux fichiers neufs : `src/engine/theme-loop.ts` (+71) et `src/__tests__/theme-loop.test.ts` (+81).
- `generateThemeLoop` (`theme-loop.ts:47`) produit des `CueInput[]` avec `color` = `palette[beat % palette.length]` (`theme-loop.ts:60`). Fichier purement additif, aucune modification de code existant.
- **Conclusion partielle** : ne peut pas casser l'autoscript (aucun fichier du chemin timeline touché). ✔

### Commit `3518cf8a5a6b740c134bb51a703384bc93589d19` — feat(ui) réécriture AutoLoopsPanel
- Ne modifie que `src/views/AutoLoopsPanel.tsx` (+209 / −132).
- Remplace l'ancienne bibliothèque (matérialisation en chasers + `midiPlayChaser`) par une boucle unique écrite **directement** dans la source DMX `vc` :
  - `writeFrame` → `dmxBridge.write('vc', dc.universe, dc.channelValues)` (`AutoLoopsPanel.tsx:30`).
  - `zeroAllUniverses` → `dmxBridge.writeTransient('vc', uniNum, z)` (`AutoLoopsPanel.tsx:50`).
- **Point (a) — écriture dans `vc` (LTP 80) qui peut écraser le playback timeline « quickshow » (HTP 40) ?** OUI, structurellement : `output-arbiter.ts:38` déclare `'vc': { mode: 'ltp', priority: 80 }` et `output-arbiter.ts:45` déclare `'quickshow': { mode: 'htp', priority: 40 }`. Un canal possédé par un source LTP gagne sur tout source HTP moins prioritaire (`output-arbiter.ts`, `getBuffer`, boucle « LTP prend ses canaux, HTP remplit le reste »). Donc **si et seulement si** la boucle auto est en cours de lecture, ses couleurs `vc` masquent les couleurs `quickshow` de la timeline. Ce n'est pas une régression du code timeline : c'est une contention inter-features, active uniquement pendant que l'utilisateur joue la boucle auto.
- **Point (b) — relâche-t-il correctement `vc` à l'arrêt/démontage ?** OUI. `stop()` (`AutoLoopsPanel.tsx:118-133`) n'appelle `zeroAllUniverses()` que si `intervalRef.current` est vrai (`:120`), et `zeroAllUniverses` utilise `writeTransient('vc', …, 2000)` qui libère automatiquement la source au bout de 2 s (`dmx-bridge.ts` `writeTransient` → `this.release(sourceId)`). Au démontage, l'effet cleanup (`AutoLoopsPanel.tsx:163-168`) appelle `stop()` (donc release différé de `vc`) puis `purgeAutoLoops`. Résidu : la fenêtre transitoire de ~2 s maintient des zéros LTP qui noircissent temporairement la sortie HTP (fade-out attendu).
- **Point (c) — `purgeAutoLoops` peut-il supprimer ce qu'il ne devrait pas ?** Partiellement. `purgeAutoLoops` (`auto-loops.ts:498-508`) supprime les scènes dont `folder === 'auto-loops'` (`AUTO_LOOP_FOLDER`, `auto-loops.ts:441`, test `:500`) puis tout chaser dont un step référence l'une de ces scènes (`:503-505`). Risque théorique : un utilisateur ayant rangé ses propres scènes dans un dossier nommé `auto-loops`, ou ayant construit un chaser perso référençant une scène auto-loop, verrait ces objets supprimés. **Mais** ce comportement n'est pas introduit par les 4 commits : l'ancienne version du panneau appelait déjà `purgeStore()` (= `purgeAutoLoops`) au changement de patch et au démontage (visible dans le diff `3518cf8`). Risque préexistant, non aggravé par la réécriture.
- **Conclusion partielle** : ne touche ni `dmx-playback.ts` ni `QuickShowView.tsx`. Ne peut pas casser la lecture des cues de la timeline. Introduit en revanche le risque de contention `vc` (LTP 80) qui peut *masquer visuellement* la timeline pendant que la boucle tourne. ✔

### Commit `f7e726177c2a1da641aa38ca155f72267109eb1e` — fix(ui) pas de blackout au montage/changement de patch
- Ne modifie que `src/views/AutoLoopsPanel.tsx` (+5 / −2).
- Déplace `zeroAllUniverses()` **à l'intérieur** du `if (intervalRef.current)` dans `stop()` (voir `AutoLoopsPanel.tsx:120-126`), et modifie un libellé UI. Correction ciblée : un montage / changement de patch n'appelle plus `zeroAllUniverses` quand aucune boucle n'est active, donc ne noircit plus le hardware via `vc` (LTP 80) pendant ~2 s.
- **Conclusion partielle** : ce commit *corrige* un vrai bug de blackout, ne touche pas la timeline, ne peut pas casser l'autoscript. ✔

## 3. Réponse explicite — « ai-je cassé l'autoscript ? »

**NON.** Le chemin de lecture des cues de l'autoscript est :

```
QuickShowView.tsx (timeline) ──► computeDmxForCue (dmx-playback.ts:1128) ──► source 'quickshow' (HTP 40)
```

Aucun des 4 commits ne modifie `dmx-playback.ts`, `QuickShowView.tsx`, ni la table de priorités. Le commit `3367499` ne touche que `computeDmxCues` (`dmx-cues.ts`), dont les seuls appelants sont `AutoLoopsPanel.tsx:99` et `theme-loop.test.ts:70` (plus un import inutilisé dans `PerformanceView.tsx:12`). Il s'agissait d'aligner la boucle auto sur le comportement couleur **déjà présent** dans `computeDmxForCue` (`dmx-playback.ts:1206/1213`), pas l'inverse.

En clair : si les couleurs jouées par la timeline diffèrent des blocs, la cause n'est pas dans ces 4 commits — elle est ailleurs (pré-existante dans `computeDmxForCue`, ou dans un override de track/couleur, ou dans une contention `vc` active).

## 4. Risques résiduels introduits par mes commits

1. **Contention `vc` (LTP 80) vs `quickshow` (HTP 40)** — introduit par `3518cf8`. Tant que la « Boucle unique » tourne, `writeFrame` (`AutoLoopsPanel.tsx:30`) fait des écritures *persistantes* `vc` qui écrasent les canaux de la timeline sur les univers patchés. Un utilisateur qui joue l'autoscript **et** la boucle auto en parallèle verra les couleurs de la boucle gagner. À surveiller : la boucle auto ne relâche `vc` qu'à l'arrêt (via `writeTransient`, 2 s). C'est le scénario le plus plausible de « couleurs jouées ≠ blocs » perçu par l'utilisateur, mais il exige que la boucle soit active.

2. **Fenêtre de blackout de ~2 s à l'arrêt** — résiduel après `f7e7261`. `zeroAllUniverses` utilise `writeTransient('vc', zéros, 2000)`, donc après un arrêt de boucle pendant que la timeline tourne, la sortie HTP est noircie ~2 s (fade-out LTP). Limité à l'arrêt d'une boucle réellement active.

3. **`purgeAutoLoops` peut supprimer du contenu utilisateur** — préexistant (déjà appelé par l'ancien panneau), non introduit par ces commits. Détruit toute scène du dossier `auto-loops` et tout chaser y faisant référence (`auto-loops.ts:498-508`). À documenter : un dossier utilisateur nommé `auto-loops` est une zone dangereuse.

Aucun de ces risques ne constitue une régression du chemin de lecture de la timeline lui-même.

C_DONE
