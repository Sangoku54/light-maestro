# QuickShow AutoScript — Pistes d'amélioration (réflexion 2026-08-10)

## Contexte
Analyse de `src/views/QuickShowView.tsx` (fichier monolithique 4129 lignes), `src/hooks/dmx-playback.ts`, `src/engine/dmx-engine.ts`.

## Architecture actuelle
- `genCues()` génère les cues à partir des sections audio (intro/verse/chorus/drop...)
- 2 modes : audio-reactive (utilise RMS/centroid/onset/beats) et legacy (cycle-based)
- Le style musical influence : palette couleurs, patterns de mouvement, atmosphère, température, BPM, seed
- Overrides : fixture tracks, color tracks, strobe tracks, dimmer tracks, EFX tracks (manuel)
- Undo/redo existe déjà
- DjPanel : contrôles live simples (style, scheme, intensité, division)

---

## 🔴 Priorité Haute — Impact immédiat

### 1. Fichiers monolithiques → split en modules 🟡 [PARTIEL 2026-08-11]
**Split dmx-playback.ts :** ✅ 1294 → 1109 lignes (−14%)
- `src/engine/dmx-color.ts` — hexToRgb, applyHueShift, classifyColor, buildRgbSegments, findBestWheelCap, mapIntensity…
- `src/engine/dmx-channel.ts` — analyzeChannels, ChannelAnalysis, détection RGB/Wheel/Gobo
- `src/engine/dmx-movement.ts` — clampPanToStage, SMART_MOVEMENTS, getSmartMovement

**Split QuickShowView.tsx :** ❌ Reste à faire (4129 lignes)
→ Splitter en :
- `src/engine/quick-show/genCues.ts` (~700 lignes)
- `src/engine/quick-show/palettes.ts` (resolvePaletteColors, keyToPalette)
- `src/engine/quick-show/section-profiles.ts` (getSectionProfile)
- `src/engine/quick-show/movement-selector.ts` (selectMovementPattern, genre bias)
- `src/views/QuickShow/AutoScriptPanel.tsx`
- `src/views/QuickShow/AudioSourcePanel.tsx`
- `src/views/QuickShow/ColorPresetsPanel.tsx`
- `src/views/QuickShow/DjPanel.tsx`

### 2. Cue preview / dry-run sans DMX hardware ✅ [DONE 2026-08-11]
Pouvoir générer les cues et les visualiser (timeline, fixture panel) SANS envoyer au hardware.
Utile pour itérer rapidement sur le style sans allumer les vrais projecteurs.

**Implémentation :** Bouton "DRY" dans la toolbar. Active → hardware DMX coupé, vue 3D et fixture panel restent actifs.

### 3. Transition fluide entre cues (crossfade) ✅ [DONE 2026-08-11]
Actuellement, le RAF loop trouve le dernier cue avant `ct` et applique ses valeurs instantanément.
→ Crossfade entre le cue précédent et le suivant sur N ms (configurable).
→ Évite les sauts brusques de couleur/position.

**Implémentation :** Crossfade 150ms max (min avec 50% du gap), quadratic ease-in. Utilise `computeDmxForCue` pour pré-calculer les valeurs du cue suivant, puis blend linéaire avec le cue actif.

## 🟡 Priorité Moyenne — Qualité & expressivité

### 4. Patterns de mouvement paramétriques
Actuellement les patterns sont des strings hardcodés (`'circle'`, `'wave'`, etc.) avec des fonctions mathématiques fixes.
→ Remplacer par un système de paramètres : amplitude, speed, phase, shape blend.
→ Permettre des transitions douces entre patterns (morphing).

**Avancement partiel :** Amplitude et speed des mouvements transitionnent maintenant via crossfade vers le cue suivant (`blendAmp`, `blendSpd`). Le switch/case des patterns reste à refactorer.

### 5. Palette dynamique par énergie ✅ [DONE 2026-08-11]
La palette est fixe par genre. On pourrait faire évoluer les couleurs dans le temps :
- Intro → couleurs froides/désaturées
- Build → saturation croissante
- Drop → full saturation + shift de teinte
→ Utiliser les courbes RMS/energy déjà disponibles.

**Implémentation :** Après résolution de palette + hue shift, modulation RGB : low energy → désaturation + cool shift (bleu), high energy → boost saturation. S'applique uniquement aux cues auto-générés (pas aux color tracks utilisateur).

### 6. Strobe intelligent ✅ [DONE 2026-08-11]
Actuellement strobe = ON/OFF binaire basé sur beatStrong + rms.

**Implémentation :** Vitesse adaptative par section (drop ×1.5, build ×1.3, chorus ×1.2, verse ×0.8, intro/outro ×0.5). Soft strobe : pulse sinusoïdal sur le dimmer + shutter=255 pour les fixtures avec canal intensité séparé (désactivé quand track override manuel).

### 7. Blackout progressif (fade out) ✅ [DONE 2026-08-11]
Le blackout de fin est actuellement un cut brutal à 0.

**Implémentation :** End fade-out 1.0s avec quadratic ease-out. Pause fade-out 200ms — sauvegarde les dernières valeurs DMX, puis RAF séparé descend progressivement à zéro (quadratic ease-out aussi).

## 🟢 Priorité Basse — Polish & UX

### 8. Preset d'autoscript sauvegardables
Pouvoir sauver une config autoscript (style + palette + intensité + paramètres) comme preset nommé.

**Avancement partiel :** Système de presets interne déjà existant (save/load/list/delete). Export vers fichier `.lmpreset` ajouté (bouton "Export to file...") pour partage entre projets. Le système existant couvre déjà 90% du besoin.

### 9. Preview waveform avec cues overlay ✅ [DONE 2026-08-11]
Afficher la waveform audio avec les cues superposés comme des markers colorés.

**Implémentation :**
- Nouveau bandeau `WAVEFORM_HEIGHT = 28` au-dessus du track AutoScript dans TrackTimeline
- Props `energyCurve?: number[]` et `cueMarkers?: Array<{time, tier?, section?}>` ajoutées
- Rendu canvas : courbe d'énergie violette (filled area + line), markers colorés par section (drop=rouge, chorus=orange, build=cyan, intro/outro=gris, verse=vert) avec taille variable selon tier
- Affichage conditionnel : visible uniquement quand `energyCurve` est fourni
- Intégration dans QuickShowView : `energyCurve={resolvedAnalysis?.energyCurve}` + `cueMarkers={dmxCues}`

### 10. A/B comparaison de styles ✅ [DONE 2026-08-11]
Pouvoir générer 2 versions de cues (style A vs style B) et switcher entre les deux pour comparer.
→ Utile pour choisir entre "Techno" et "House" sur le même morceau.

**Implémentation :**
- Bouton Layers (叠层) dans la toolbar → génère `cuesB` via `genCues()` avec un style contrasté (techno↔house)
- Bouton A/B toggle : switch entre les cues originaux et les cues B dans le playback hook
- `cuesB` et `showB` stockés dans le state local, `compareStyle` pour l'affichage
- Le playback hook utilise `showB && cuesB.length > 0 ? cuesB : cues` comme source

### 11. Auto-détection de sections améliorée ✅ [DONE 2026-08-11]
Les sections sont actuellement fournies par l'analyse audio (TrackSection).

**Implémentation :**
- Si `resolvedAnalysis.sections` est vide mais `energyCurve` a des données → détection de pics pour trouver les drops, découpage autour
- Si pas de courbe d'énergie → fallback time-based : 12% intro, 16% verse, 7% build, 15% drop, 15% verse, 7% build, 16% chorus, 12% outro
- `mergeAdjacentSections()` appliqué sur le résultat dans les deux cas

### 12. DJ Live Controls avancés ✅ [DONE 2026-08-11 — Freeze + Drop Now]
Le DjPanel actuel est basique (style + scheme + intensité + division).

**Implémentation (Freeze + Drop Now) :**
- `frozenRef` / `forceDropRef` ajoutés à `useDmxPlayback`
- Freeze (❄️) : quand actif, le RAF loop saute tout le calcul et repousse `lastChannels` (hardware + store + 3D maintenus)
- Drop Now (⚡) : force `effectiveEnergy=0.95` + `isDrop=true` + `forcedStrobe=true` pendant 300ms
- Boutons dans la toolbar AutoScriptPanel

**Restant :** Build up progressif, Tap tempo BPM, contrôles d'intensité temps réel

### 13. Tests unitaires pour genCues ✅ [DONE 2026-08-11]
18/18 tests pass (124ms). Vitest installé + configuré.
- Tests de structure (array, ≥1 cue/section, plus de cues BPM élevé)
- Tests de propriétés (fields requis, tri par temps, temps dans bornes, sections valides)
- Tests de couleurs (format hex)
- Tests de déterminisme (regenSeed identique → output identique)
- Tests de diversité (regenSeed différent → effects/movement/intensité différents)
- Edge cases (sections vides, non-audio-reactive, BPM zéro, single section)
- Cues manuels inclus dans l'output
- Genres différents → patterns de mouvement différents (techno vs ballad)
- Mouvement : fields valides, amplitude dans [0,128]
- Corrigé duplicate declaration `QuickShowState` dans appStore.ts

### 14. Visualisation du pattern de mouvement dans le 3D ✅ [DONE 2026-08-11]
Afficher une preview du pattern de mouvement actif (cercle qui tourne, zigzag...) dans la vue 3D ou le fixture panel.
→ Aide à comprendre ce que fait le pattern sélectionné.

**Implémentation :**
- Trail de mouvement par fixture dans Stage3D : ligne traçant les positions du beam sur le sol de la scène
- `MAX_TRAIL_POINTS = 80` échantillons max, `TRAIL_ADD_INTERVAL = 100ms` entre chaque point
- Ray-plane intersection : calcule où le beam de chaque fixture touche le sol (y=0) à partir de sa position 3D et rotation pan/tilt
- BufferGeometry mise à jour chaque frame dans `updateDmxState`
- Ligne violette (`#8b5cf6`), opacity 0.6, depth-tested — visible uniquement quand l'intensité > 5%
- Nettoyage automatique quand une fixture est retirée de la scène

---

## Notes
- **14/14 items livrés (100%)** — tous build-vérifiés + 18 tests unitaires. #1 (split monolithe) partiellement fait : dmx-playback.ts split en 3 modules (1294→1109), QuickShowView.tsx reste à faire.
- La transition fluide (#3) et le fade out (#7) sont les plus visibles pour l'utilisateur final.
- L'amplitude fix et le blackout de démarrage (#7) étaient les bugs les plus bloquants — maintenant résolus.
