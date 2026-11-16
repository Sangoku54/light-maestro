# Multi Pan/Tilt — Règle d'analyse des fixtures multi-bras

**Validé par l'utilisateur le 2026-08-13 (« c'est parfait bravo »)** — à appliquer à TOUTES les futures fixtures avec plusieurs pans/tilts (Tonio 6 arm, flowers, multi-têtes, etc.).

## La règle

Une fixture multi pan/tilt doit être exploitée **à fond sur les 4 étages** — jamais seulement le 1ᵉʳ canal :

1. **Analyse** — collecter TOUS les offsets :
   - `ChannelAnalysis.panOffsets[]` / `tiltOffsets[]` (dmx-channel.ts + dmx-cues.ts `analyzeFixture` + stage3d `analyzeFixtureChannels`)
   - Les vrais canaux « fine » (nom contenant `fine`) ne sont PAS des bras → exclus des tableaux, gardés comme `panFineOffset`/`tiltFineOffset`
2. **Génération de cues** (genCues) — écrire pan/tilt sur tous les offsets
3. **Moteur playback** — déjà multi-bras (boucle `motorCount = max(panCount, tiltCount)`, phase décalée par bras → effet vague) — vérifier que ça reste le cas
4. **3D (Stage3D)** — une tête par tilt : `extraHeads[]` (headGroup + lightTarget + pointLight + beamCone par bras, tilt moteur limité en vitesse °/s, pan master partagé, zoom + mountMode + idle sweep + modale position appliqués aux bras)

## Cas de référence : Tonio 6 arm (custom-tonio-6-arm.json, 22 canaux)

- 1 pan (X Motor) + 7 tilts (Bee-eyemotor central + Motor 1-6) + dimmer + strobe + 2 segments RGBW + 2 lasers + macro
- Log d'analyse attendu : `panOffsets: [0] tiltOffsets: [2,3,4,5,6,7,8]`
- Build de référence : `index-Csrx95R0.js` (26/26 tests, 121 erreurs tsc pré-existantes, Stage3D 0)

## Pièges connus

- **dmx-cues.ts `analyzeFixture`** : avant le fix, le 2ᵉ tilt était traité comme `tiltFineOffset` et les suivants ignorés → génération incomplète
- **Stage3D** : ne rendait qu'une tête (un seul beam) → les 6 bras invisibles en 3D
- **Logs** : ne plus laisser de `'none'`/`'NONE'` dans les diagnostics (remplacés par `∅`)
- **Modale position 3D** : heading/tilt doit pousser sur TOUS les offsets (boucle), pas seulement le 1ᵉʳ
- **beamAngle (zoom)** : s'applique aussi aux cones des bras
- **fitMountRotation** : compensation mount (sol/plafond) propagée aux têtes extra
