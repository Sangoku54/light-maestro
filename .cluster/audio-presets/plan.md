# Plan — vérification lecture audio des presets dans les widgets Performance

TaskId: audio-presets
Objectif : vérifier que les audios attachés aux presets sont bien lus dans les widgets de Performance ; corriger si trou ; livrer avec preuves.

## Sous-tâches
1. **Auditeur indépendant** (subagent_01.md — dispatché, en cours) : chemin complet stockage → widget → lecture, verdict OUI/NON.
2. **Trace mainline** (fait) :
   - Widget « Play Preset » (actionType playSong) → setSongPlayer(preset) → SongPresetPlayer (PerformanceView L2196).
   - Preload au montage du widget : preloadAudioUrl (L1589).
   - SongPresetPlayer : preset.audioFileBase64 || audioDataBase64 → decodeAudioUrl → AudioContext + AudioBufferSourceNode (offset + onended).
   - Cache partagé : audio-cache.ts (decodeAudioUrl/preloadAudioUrl/getAudioBuffer) utilisé par widget, tracks audio du show playback, audioAutoScript.
   - Création/import/save : QuickShowView save preset L2005 (data URL) ; import .lmpreset PerformanceView L1108 (normalise data:) ; saveProject App.tsx L106 (tels quels, déjà data URL) ; __lm_open L301 (tels quels).
3. **Preuve terrain** (fait) : yolo.lmproj → 3 presets, 3/3 avec audioFileBase64 data URL audio/mpeg, 0 base64 nu → lisibles.
4. **Trou défensif trouvé** (corrigé) : base64 NU legacy (audioDataBase64 des vieux .lmpreset, ex. baby.lmpreset = WAV RIFF brut) → fetch() échouait silencieusement → horloge virtuelle sans son. Fix : normalizeAudioUrl() dans audio-cache.ts (préfixe data:audio/mpeg;base64, si ni data:/http:/blob:/file:) + 4 tests.
5. **Suite** : 278/278 ✓, tsc 0 ✓.
6. **Livraison** : rebuild 1.0.16 (bump) avec le fix + verdict + preuves.

## Dépendances
- 6 dépend de 4 (build après fix) et du retour de l'auditeur (croisement S4 avant build).
- Scripts : .cluster/audio-presets/prove-project.ts (preuve runtime).

## Décision si l'auditeur trouve un autre trou
Corriger génériquement puis rebuild une seule fois.