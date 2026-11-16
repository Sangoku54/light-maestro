# Rapport Analyste — Chaîne EFX X/Y Offset (élargissement ±400)

Date : 2026-08-28 · Périmètre : analyse seule, aucun fichier modifié.
État de départ constaté : **les inputs range UI sont DÉJÀ passés à ±400** dans la working copy (modif locale non commitée, confirmée par `git diff HEAD` vs `e1da514`). Tout le reste de la chaîne est inchangé (normalisation /255, facteurs preview 0.3, clamps 0-255).

---

## (a) Chaîne complète tracée (fichiers + lignes)

### A1. Stockage / source de vérité — `src/stores/showStore.ts`
| Élément | Lignes | Détail |
|---|---|---|
| Type `SavedEffect` | L138-150 | `xOffset: number` (L146), `yOffset: number` (L147) — plain number, **aucune borne typée** |
| `createEffect` | L828-846 | défauts `xOffset: 0` (L838), `yOffset: 0` (L839) |
| `seedBuiltinEffects` | L849-881 | seeds `xOffset: 0, yOffset: 0` (L875-876) |
| `updateEffect` | L883-890 | spread `{ ...e, ...updates }` — **aucun clamp** |
| `setEffects` | L903-906 | pass-through brut (imports) |

### A2. Persistance — JSON brut, pass-through intégral
- Export projet `.lmproject` : `DesignView.tsx` L6529 (`effects: state.effects`) → `JSON.stringify` L6531.
- Import : `DesignView.tsx` L6588 (`state.setEffects(project.effects)`, aucune validation) ; `App.tsx` L123 (export) / L348 (import) ; `ShowManager.tsx` L916 / L964 ; `PerformanceView.tsx` L1723.
- **Conclusion : ±400 persiste sans aucune modification** (pas de clamp/normalisation à l'import).

### A3. Éditeur UI — `src/views/DesignView.tsx` (composant `EFXEditor`)
- State local : L3272-3273 (`useState(0)`).
- Chargement d'un effet en édition : L3303-3304.
- Sauvegarde : L3329-3330 (update) et L3341-3342 (create) — passe la valeur brute au store.
- Reset « New » : L3357-3358.
- **Inputs range X : L3844-3852, Y : L3855-3863 — DÉJÀ `min={-400} max={400}`** (seule modif locale existante).
- **Live DMX preview** (écrit réellement sur le hardware via la source `design-efx`) :
  - Conversion offset : L3484-3485 `const ox = (xOffset / 255) * 0.3;`
  - Application après rotation : L3582-3583 (`rx2 = … + ox`).
  - Mapping DMX + clamp : L3586-3587 `128 + rx2 * 127` clampé [0,255].
  - Écriture arbitre : L3600-3603 (pan/tilt/panFine/tiltFine) → L3607 `dmxBridge.write('design-efx', uniNum, vals)`.
  - État « stopped » (centre 128) : L3458-3474 (write L3471) ; cleanup transient : L3613-3635 (L3633) ; deps du rAF : L3636.
- **SVG preview 2D** : conversion L3647-3648 `(xOffset / 255) * 0.3`, points L3727-3729, **viewBox `-1 -1 2 2` (L3957)** → ±400 × 0.3 = ±0.47, **reste dans le cadre** (l'amplitude du pattern `width*0.7` jusqu'à 1.4 peut déjà déborder, comportement inchangé).

### A4. Moteur DMX principal — `src/hooks/fixture-tracks.ts`
- `generateEfxPanTilt` : **L281-346**.
  - Normalisation offset : **L337-338** `const ox = (xOffset || 0) / 255;` (commentaire L336 : « in DMX range [-255, 255] »).
  - Application : **L339-340** `prePan = Math.round(128 + rx * w * 127 + ox * 127)` — l'offset est une **translation ajoutée APRÈS la rotation**.
  - **Clamp final : L343-344** `Math.max(0, Math.min(255, …))`.
- `computeEfxOverrides` : **L352-406** — résout tracks EFX → effet → `{pan, tilt}` par fixture (valeurs déjà clampées par generateEfxPanTilt).

### A5. Consommateurs playback de `computeEfxOverrides`
1. **Moteur principal** `src/hooks/dmx-playback.ts` :
   - Calcul : L738-740 (`efxPtOverrides`, refs `efxTracksRef`/`effectsRef`).
   - Application dans la boucle fixture : **L1011-1014** — écrit `ept.pan/ept.tilt` sur **tous** les offsets pan/tilt (`motorCount`, multi-bras) ; priorité : efxMap (overrideCues) L1007-1010 > efxPtOverrides L1011-1014 > movement blocks L1015+.
2. **QuickShow** `src/views/QuickShowView.tsx` : L133-135 (calcul) puis **L140-148** (bake des valeurs pan/tilt dans les cues DMX) ; ces cues rejouées via `overrideCuesRef`/`efxMap` (dmx-playback L735, L1007-1010). Même moteur de calcul → même sémantique.
3. **SongPresetPlayer** `src/components/SongPresetPlayer.tsx` : L77-88 (refs effects) → L240-241 (injection dans le même moteur dmx-playback). Aucune lecture directe de xOffset.

### A6. Arbitre de sortie — `src/engine/output-arbiter.ts`
- Source `design-efx` : **LTP, priorité 70** (L39).
- **Clamp matériel global : `clampChannel` L54-57** (`Math.max(0, Math.min(255, Math.round(v)))`) appliqué à toute écriture → **dernier rempart, rien à changer**.

### A7. Chemins secondaires — écriture DMX directe (« famille éditeur », facteur 0.3)
1. **ShowManager** `src/views/ShowManager.tsx` (playback d'un show) :
   - Lecture : **L281-282** `((effect.xOffset || 0) / 255) * 0.3` (commentaire L275 : « identical math to EFX Editor live DMX preview »).
   - Application L317-318 après rotation, clamp **L320-321**, écriture hardware `sendChannelsToHardware` source `'show-manager'` (L258 et suite).
2. **PerformanceView** `src/views/PerformanceView.tsx` (playback show `lm-perf-play-show`, bloc L421-508) :
   - Lecture : **L443-444** `((efx.xOffset ?? 128) / 255) * 0.3` — **fallback `?? 128` bugué** (128/255×0.3 = 0.15 → décale de ~19 pas DMX si le champ est undefined ; devrait être `?? 0`).
   - Bug adjacent (même bloc) : L445 `rotation` traité en `(rot/255)*2π` au lieu de degrés → faux pour tout rotation ≠ 0. Hors périmètre strict, signalé.
   - Application L496-497, clamp L498-499, écriture source `'vc'` L507.

### A8. Visualisation — aucun calcul d'offset
- **Stage3D** `src/views/Stage3D.tsx` : lit le **buffer DMX final** (`panVal` L1632-1641, `tiltVal` L1634/1649, têtes extra L1658-1659) → suit automatiquement toute valeur écrite par le moteur. **Aucun changement.**
- **TrackTimeline** `src/views/TrackTimeline.tsx` : dessine les entrées EFX comme régions temporelles (interfaces L76-90, props L192-200) — jamais de xOffset.

⚠️ Ne pas confondre : `scanXOffset/scanYOffset` (lasers, `fixture-analyzer.ts` L129-131, auto-loops/dmx-playback L1296-1303) et `intensityOffset` sont des **offsets de canal DMX (adresses)** — sans rapport avec l'offset géométrique EFX.

---

## (b) Sémantique exacte de l'offset (unité, application DMX)

**Unité** : le xOffset/yOffset est un **nombre en « pas DMX théoriques »** où la normalisation canonique est `offset / 255`, appliquée comme **translation de la trajectoire après rotation** :

- **Moteur B (moteur principal, fixture-tracks.ts L337-344)** :
  `pan = clamp[0,255]( 128 + (pattern_normalisé × width × 127) + (xOffset / 255) × 127 )`
  → ±255 = translation de ±127 pas = **demi-course DMX complète** depuis le centre. Le pattern (amplitude ≤ width×127) se déplace **entièrement hors plage** au-delà, et le **clamp 0-255 sature naturellement** la partie de la trajectoire qui sort.
- **Famille éditeur (DesignView live L3484/3586, ShowManager L281/320, PerformanceView L443/498)** :
  `pan = clamp[0,255]( 128 + (pattern × width × 0.7 + (xOffset/255) × 0.3) × 127 )`
  → ±255 = translation de ±38 pas seulement (amortie ×0.3, choix d'affichage/preview repris tel quel pour le playback des shows).

**Divergence préexistante** : le même effet sauvegardé se joue avec une translation **±127 pas** via les EFX tracks du moteur principal, mais **±38 pas** quand il est placé dans un show ShowManager ou joué en Performance view. C'est un problème de cohérence **antérieur** à la demande, indépendant du ±400.

**Que produirait ±400 aujourd'hui (UI seule modifiée)** : `ox = 400/255 = 1.57` → translation moteur ±199 pas. Exemple (Circle, width 0.5 → amplitude ±63.5) à xOffset=+400 : prePan ∈ [264, 391] → **clampé à 255 sur toute la trajectoire** (saturation franche côté droit). À ±200 : saturation partielle. **Aucun crash, aucun dépassement d'octet : l'arbitre re-clampe tout (L54-57).** C'est exactement la sémantique « décaler la trajectoire, clamp naturel 0-255 » — le ±400 est donc déjà fonctionnel de bout en bout grâce aux clamps existants.

**Codages en dur liés à l'offset** : aucun `255` à modifier. Les `/255` sont des **normalisateurs d'unité** (les changer réinterpréterait tous les effets sauvegardés : un xOffset=100 existant décalerait moins) ; les `clamp 0-255` (fixture-tracks L343-344, DesignView L3586-3587, ShowManager L320-321, PerformanceView L498-499, arbitre L54-57) sont **physiques** (DMX 8 bits) et doivent rester.

---

## (c) Liste exhaustive des points à modifier pour ±400

| # | Fichier:lignes | Quoi | Statut |
|---|---|---|---|
| 1 | `src/views/DesignView.tsx` L3847-3848 (X) et L3858-3859 (Y) | `min/max` des inputs range −255/255 → **−400/400** | ✅ **DÉJÀ FAIT** dans la working copy (non commité) |
| 2 | `src/hooks/fixture-tracks.ts` L336 | Commentaire de contrat « [-255, 255] » → **« [-400, 400] »** | À faire (1 ligne, doc) |
| 3 | `src/views/PerformanceView.tsx` L443-444 | Fallback bugué `?? 128` → **`?? 0`** | Recommandé (bug adjacent sur les lignes exactes du sujet ; sinon un `efx.xOffset` undefined décale de ~19 pas) |
| 4 | Persistance (showStore/export/import) | **Rien à faire** — JSON brut, pas de validation | Vérifié OK |
| 5 | Arbitre (`output-arbiter.ts`) | **Rien à faire** — `clampChannel` gère tout | Vérifié OK |
| 6 | Stage3D, QuickShowView, SongPresetPlayer, ShowManager, dmx-playback | **Rien à faire** — consomment les valeurs clampées du moteur ou recopient la formule éditeur qui clamp déjà | Vérifié OK |
| 7 | `src/__tests__/track-override-priority.test.ts` L78-90 | **Rien à faire** — n'utilise que xOffset:0 et asserte pan/tilt ∈ [0,255] → reste vert | Vérifié OK |
| 8 | (Optionnel) test d'overshoot | Ajouter un cas `xOffset: 400` assertant pan/tilt ∈ [0,255] (saturation) | Optionnel |

**Non requis mais à soumettre à l'utilisateur (décision produit, hors patch minimal)** : harmoniser le facteur ×0.3 des 3 chemins « famille éditeur » (DesignView live L3484-3485, ShowManager L281-282, PerformanceView L443-444) avec le moteur principal (pas de ×0.3 dans generateEfxPanTilt). Sinon, l'éditeur laisse croire à une translation plus faible que le playback EFX-track réel. Changer cela altère le rendu des shows existants → ne pas faire dans ce patch.

---

## (d) Patch minimal proposé (cohérent de bout en bout)

Le ±400 est déjà câblé : la seule vraie modif est faite (UI). Restent 2 fichiers / 3 lignes :

**1. `src/hooks/fixture-tracks.ts` — L336 (contrat documenté)**
```diff
@@ src/hooks/fixture-tracks.ts, fonction generateEfxPanTilt
-  // xOffset/yOffset are in DMX range [-255, 255]; normalize to [-1, 1]
+  // xOffset/yOffset are in offset units [-400, 400]; ±255 = full half-travel
+  // from center (127 steps) after normalization by 255. Overshoot beyond the
+  // DMX range is naturally saturated by the 0-255 clamp below.
   const ox = (xOffset || 0) / 255;
   const oy = (yOffset || 0) / 255;
```

**2. `src/views/PerformanceView.tsx` — L443-444 (fallback correct)**
```diff
@@ src/views/PerformanceView.tsx, bloc EFX du playback show
-      const xOffset = ((efx.xOffset ?? 128) / 255) * 0.3;
-      const yOffset = ((efx.yOffset ?? 128) / 255) * 0.3;
+      const xOffset = ((efx.xOffset ?? 0) / 255) * 0.3;
+      const yOffset = ((efx.yOffset ?? 0) / 255) * 0.3;
```

**3. (déjà en working copy, à conserver/commiter) `src/views/DesignView.tsx` L3847-3848 et L3858-3859**
```diff
-                min={-255}
-                max={255}
+                min={-400}
+                max={400}
```

**Validation attendue après patch** (à faire par l'humain ou un agent avec build) :
- `tsc`/vitest : `npx vitest run src/__tests__/track-override-priority.test.ts` reste vert.
- Comportement : EFX Circle width 0.5, xOffset=+400 → trajectoire plaquée à pan=255 (saturation) ; xOffset=+200 → trajectoire décalée, partie haute clampée à 255 ; preview SVG décale le motif de 0.47 unité (dans le cadre viewBox `-1 -1 2 2`).
- Hardware : l'arbitre (priorité LTP 70) livre des octets toujours ∈ [0,255].

*Rapport généré par l'analyste EFX offset — analyse seule, zéro fichier source modifié.*
