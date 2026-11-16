# Audit : Externalisation de l'audio hors .lmproj

**Date :** 2026-08-15  
**Auteur :** Subagent « Audit audio hors .lmproj »

---

## 1. État actuel

### 1.1 Où est stocké l'audio

L'audio est stocké **en Base64 (data URL)** à **3 niveaux** différents dans le projet :

| Niveau | Champ | Fichier(s) | Persistance |
|--------|-------|------------|-------------|
| **SongPreset** (showStore) | `audioFileBase64: string` | `src/stores/showstore.ts:157` | Incluse dans `.lmproj` via `songPresets[]` |
| **ShowTrackItem** (showStore) | `audioFileBase64?: string` | `src/stores/showstore.ts:76` | Incluse dans `.lmproj` via `shows[].tracks[].items[]` |
| **ShowData** (showStore) | `audioFileBase64?: string` | `src/stores/showstore.ts:93` | Incluse dans `.lmproj` via `shows[]` |
| **QuickShow export** | `audioDataBase64: string` | `src/views/quickshowview.tsx:781,2027` | Export `.lmpreset` (fichier JSON téléchargé) |
| **PerformanceView config** | `audioDataUrl?: string` | `src/stores/performstore.ts:69` | Config d'action AutoScript (transmise en RAM) |

### 1.2 Format .lmproj

Le fichier `.lmproj` est un JSON sérialisé via `JSON.stringify(data, null, 2)` et sauvegardé via IPC `project:save` (`electron/main.ts:586-601`). Structure :

```json
{
  "schemaVersion": 1,
  "appStore": { ... },
  "showStore": {
    "patchedFixtures": [...],
    "universes": [...],
    "scenes": [...],
    "chasers": [...],
    "songPresets": [
      {
        "id": "qs-...",
        "name": "Mon preset",
        "audioFileBase64": "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQwAA...",
        "audioFileName": "track.mp3",
        "dmxCues": [...],
        "trackAnalysis": { ... },
        "sections": [...],
        ...
      }
    ],
    "shows": [
      {
        "tracks": [
          {
            "type": "audio",
            "items": [
              { "audioFileBase64": "data:audio/mpeg;base64,SUQzBAAAA..." }
            ]
          }
        ]
      }
    ],
    ...
  },
  "vcWidgets": [...],
  "version": 1,
  "timestamp": "2026-08-15T..."
}
```

### 1.3 Flux complet actuel

```
Utilisateur sélectionne un fichier audio (File API)
    ↓
FileReader.readAsDataURL(file)  →  data:audio/mpeg;base64,XXXXX...
    ↓
Stocké dans SongPreset.audioFileBase64 (showStore Zustand)
    ↓
saveProject() sérialise TOUT le showStore (incl. audioFileBase64) en JSON
    ↓
IPC project:save → fs.writeFileSync → fichier .lmproj
    ↓
À l'ouverture : JSON.parse → restoreWithAudio(analysis, dataUrl) → fetch(dataUrl) → decodeAudioData
```

### 1.4 Taille typique

| Source | Taille binaire | Base64 (data URL) | Multiplicateur |
|--------|---------------|-------------------|----------------|
| MP3 3 min @ 128kbps | ~3 MB | ~4 MB | ×1.33 |
| MP3 5 min @ 320kbps | ~12 MB | ~16 MB | ×1.33 |
| FLAC 5 min | ~25 MB | ~33 MB | ×1.33 |
| WAV 5 min (stéréo 44.1kHz) | ~53 MB | ~71 MB | ×1.33 |

Un projet avec **3 song presets** contenant chacun un MP3 de 5 min → **~48 MB** de Base64 dans le .lmproj.

### 1.5 Stockage secondaire : presets.json

Les presets sont aussi persistés dans `userData/presets.json` via IPC `presets:save` (`electron/main.ts:614-620`). Ce fichier contient également `audioFileBase64` pour chaque preset → même problème de taille.

L'autosave silencieux écrit aussi dans `userData/autosave.json` via `storage:set` → même payload complet.

---

## 2. Problèmes identifiés

### 2.1 Critiques

1. **Taille du .lmproj** — Un projet avec 2-3 presets audio atteint 30-50 MB. `JSON.stringify` et `JSON.parse` bloquent le main thread pendant plusieurs secondes.

2. **Risque de corruption** — L'écriture atomique (temp + rename) protège l'écriture, mais un crash pendant `JSON.stringify` (qui n'est pas streamé) peut corrompre la mémoire. La récupération depuis `autosave.json` est aussi un fichier complet → même risque.

3. **localStorage dépassé** — Le code tente déjà d'exclure `audioDataBase64` du localStorage (`quickshowview.tsx:786-787`) car il dépasse le quota (5-10 MB). Preuve que le problème est connu.

4. **Performances** — Chaque `saveProject()` sérialise tout le Base64. L'autosave toutes les 45 s (`app.tsx`) déclenche donc une sérialisation massive à chaque fois, même si l'audio n'a pas changé.

5. **Multiplication** — Le même audio Base64 peut apparaître à plusieurs endroits :
   - `songPresets[].audioFileBase64`
   - `shows[].tracks[].items[].audioFileBase64`
   - `config.audioDataUrl` (performStore)
   
   Un seul fichier MP3 peut être dupliqué 3 fois dans le même .lmproj.

### 2.2 Secondaires

6. **Partage de projet** — Un .lmproj de 50 MB est difficile à envoyer par email ou chat.

7. **Git** — Si le projet est versionné, chaque sauvegarde crée un diff énorme.

8. **Presets dupliqués** — `presets.json` (userData) stocke les mêmes presets que le .lmproj → double stockage.

---

## 3. Proposition d'externalisation

### 3.1 Principe

L'audio est stocké comme **fichier binaire** à côté du .lmproj. Le .lmproj ne contient qu'un **chemin relatif** vers le fichier audio.

### 3.2 Structure proposée

```
mon-projet.lmproj          ← JSON, sans Base64
mon-projet.audio/           ← dossier audio (même nom que le .lmproj)
  ├── track_001.mp3         ← fichier audio binaire
  ├── track_002.flac
  └── track_003.wav
```

Ou, pour les presets autonomes (non liés à un .lmproj) :

```
userData/
  audio/
    ├── a3f8b2c1.mp3        ← nom = hash SHA-1 du contenu
    ├── 7e9d4f2a.flac
    └── ...
  presets.json              ← référence par chemin, plus de Base64
```

### 3.3 Format dans le .lmproj

**Avant (actuel) :**
```json
{
  "songPresets": [{
    "id": "qs-123",
    "audioFileBase64": "data:audio/mpeg;base64,SUQzBAAA...60MB...",
    "audioFileName": "track.mp3",
    ...
  }]
}
```

**Après (proposé) :**
```json
{
  "schemaVersion": 2,
  "songPresets": [{
    "id": "qs-123",
    "audioFileName": "track.mp3",
    "audioRef": {
      "type": "external",
      "path": "mon-projet.audio/track_001.mp3",
      "hash": "a3f8b2c1d4e5f6a7b8c9",
      "size": 5242880
    },
    ...
  }]
}
```

Le champ `audioRef` remplace `audioFileBase64`. Le hash permet :
- Détecter si le fichier a été modifié/corrompu
- Dédupliquer (deux presets utilisant le même audio pointent vers le même fichier)

### 3.4 Rétrocompatibilité (migration)

À l'ouverture d'un `.lmproj` :

1. Détecter `schemaVersion` (absent ou 1 = ancien format).
2. Si `songPresets[].audioFileBase64` existe :
   - Extraire le Base64 → écrire un fichier binaire dans `mon-projet.audio/`
   - Calculer le hash SHA-1
   - Remplacer `audioFileBase64` par `audioRef` dans l'objet en mémoire
   - Marquer le projet comme "dirty" pour que la prochaine sauvegarde écrive le nouveau format
3. Si `schemaVersion >= 2` et `audioRef.type === "external"` :
   - Résoudre le chemin relatif par rapport au dossier du .lmproj
   - Si le fichier n'existe pas → chercher dans `userData/audio/` par hash
   - Si toujours pas → erreur "fichier audio manquant", continuer sans audio (analysis seulement)

---

## 4. Plan d'implémentation

### 4.1 Nouveaux IPC handlers (electron/main.ts)

```typescript
// Audio file storage — write binary to disk
ipcMain.handle('audio:save', async (_, buffer: ArrayBuffer, projectDir: string, suggestedName: string) => {
  const audioDir = path.join(path.dirname(projectDir), `${path.basename(projectDir, '.lmproj')}.audio`);
  fs.mkdirSync(audioDir, { recursive: true });
  const filePath = path.join(audioDir, suggestedName);
  fs.writeFileSync(filePath, Buffer.from(buffer));
  const hash = crypto.createHash('sha1').update(Buffer.from(buffer)).digest('hex');
  return { path: path.relative(path.dirname(projectDir), filePath), hash, size: buffer.byteLength };
});

// Audio file load — read binary from disk
ipcMain.handle('audio:load', async (_, projectPath: string, audioRef: { path: string; hash?: string }) => {
  const fullPath = path.resolve(path.dirname(projectPath), audioRef.path);
  if (!fs.existsSync(fullPath)) return null;
  const buffer = fs.readFileSync(fullPath);
  return buffer.toString('base64'); // Return base64 for Web Audio API decode
});
```

### 4.2 Fichiers à modifier

| # | Fichier | Changement | Effort |
|---|---------|------------|--------|
| 1 | `electron/main.ts` | Ajouter IPC `audio:save` et `audio:load` | Petit |
| 2 | `electron/preload.ts` | Exposer `audio.save()` et `audio.load()` | Petit |
| 3 | `src/stores/showstore.ts` | Ajouter `audioRef` à `SongPreset` et `ShowTrackItem`. Garder `audioFileBase64` optionnel pour migration | Petit |
| 4 | `src/app.tsx` → `saveProject()` | Si `schemaVersion >= 2` : extraire audio Base64 → IPC `audio:save` → remplacer par `audioRef` avant sérialisation | Moyen |
| 5 | `src/app.tsx` → `__lm_open()` | Si `audioFileBase64` détecté → migration auto. Si `audioRef` → IPC `audio:load` | Moyen |
| 6 | `src/hooks/useaudiofileloader.tsx` | `restoreWithAudio()` : accepter soit un data URL Base64, soit un `audioRef` (charger via IPC) | Moyen |
| 7 | `src/views/quickshowview.tsx` | `handleSaveAsPreset()` et `handleExportPreset()` : utiliser IPC `audio:save` au lieu de `FileReader.readAsDataURL` | Moyen |
| 8 | `src/views/quickshowview.tsx` | `loadProject()` / `handleLoadPreset()` : gérer `audioRef` (IPC load) + fallback Base64 | Moyen |
| 9 | `src/views/performanceview.tsx` | `chooseFile()` (l.1119) : utiliser IPC `audio:save` au lieu de garder le Base64 en RAM | Moyen |
| 10 | `src/views/performanceview.tsx` | Import preset (l.930-945) : gérer `audioRef` | Petit |
| 11 | `src/views/showmanager.tsx` | `getAudioBuffer()` (l.150) : gérer `audioRef` au lieu de `audioFileBase64` | Petit |
| 12 | `src/components/songpresetplayer.tsx` | `new Audio(preset.audioFileBase64)` (l.155) : si `audioRef`, charger via IPC d'abord | Petit |
| 13 | `src/stores/performstore.ts` | `audioDataUrl` → ajouter `audioRef` alternatif | Petit |

**Total : 13 fichiers, estimation ~2-3 jours de travail.**

### 4.3 Étapes

#### Phase 1 : Infrastructure (jour 1)
1. Ajouter IPC `audio:save` et `audio:load` dans `electron/main.ts`
2. Exposer dans `electron/preload.ts`
3. Ajouter le type `AudioRef` dans `showstore.ts`
4. Ajouter `schemaVersion = 2` dans `saveProject()`

#### Phase 2 : Migration lecture (jour 2)
5. Dans `__lm_open()` : détecter `audioFileBase64` → extraire vers fichier → remplacer par `audioRef`
6. Dans `useAudioFileLoader.restoreWithAudio()` : accepter `audioRef` en plus du data URL
7. Dans `SongPresetPlayer` : gérer `audioRef` via IPC load
8. Dans `showmanager.tsx` : `getAudioBuffer()` gère `audioRef`

#### Phase 3 : Migration écriture (jour 2-3)
9. Dans `saveProject()` : avant sérialisation, remplacer tout `audioFileBase64` par `audioRef` (via IPC `audio:save`)
10. Dans `quickshowview.tsx` : `handleSaveAsPreset()` et `handleExportPreset()` utilisent IPC
11. Dans `performanceview.tsx` : `chooseFile()` utilise IPC

#### Phase 4 : Cleanup (jour 3)
12. Autosave : ne pas inclure l'audio dans `autosave.json` (utiliser `audioRef`)
13. `presets.json` : ne pas inclure l'audio (utiliser `audioRef`)
14. Tests : vérifier ouverture d'un .lmproj v1 (avec Base64) et v2 (avec audioRef)

### 4.4 Stratégie de migration rétro-compatible

- **Lecture v1 → v2** : automatique à l'ouverture, transparent pour l'utilisateur
- **Écriture** : toujours en v2 après la première sauvegarde
- **Fallback** : si `audioRef.path` pointe vers un fichier manquant, chercher par hash dans `userData/audio/`
- **Export `.lmpreset`** : peut garder le Base64 pour le partage (fichier autonome) OU utiliser un format `.lmpreset.zip` (audio + JSON). À discuter.
- **Anciens .lmproj** : restent valides, jamais modifiés sur disque (la migration se fait en mémoire)

### 4.5 Gains attendus

| Métrique | Avant | Après |
|----------|-------|-------|
| Taille .lmproj (3 presets MP3 5min) | ~48 MB | ~500 KB |
| Temps `JSON.stringify` | 2-5 s | <100 ms |
| Temps `JSON.parse` | 1-3 s | <50 ms |
| Risque de corruption | Élevé (fichier massif) | Faible (petit JSON + fichiers binaires atomiques) |
| Autosave 45 s | Bloque 2-5 s | <100 ms |
| Partage par email | Impossible | Trivial (zip le dossier) |

---

## 5. Notes complémentaires

### 5.1 Déduplication

Deux presets utilisant le même fichier audio (même hash SHA-1) pointent vers le même fichier. Économie de stockage significative si l'utilisateur crée plusieurs variations d'un même preset.

### 5.2 Export .lmpreset autonome

Pour le partage de presets individuels, deux options :
- **Option A** : Garder le Base64 dans le `.lmpreset` (fichier autonome, mais potentiellement gros)
- **Option B** : Format `.lmpreset.zip` contenant `preset.json` + `audio/track.mp3`

Recommandation : **Option A** pour compatibilité, avec un avertissement si >10 MB.

### 5.3 Nettoyage audio orphelin

Au fil du temps, des fichiers audio peuvent devenir orphelins (preset supprimé mais fichier reste). Ajouter un nettoyage périodique :
- Lister tous les `audioRef` dans le .lmproj + presets.json
- Comparer avec les fichiers dans `audio/`
- Supprimer les orphelins (avec confirmation)

### 5.4 Audio dans ShowTrackItem

Les `ShowTrackItem` (showStore.ts:76) ont aussi `audioFileBase64`. Quand un preset est ajouté à une piste de show, le Base64 est copié. Avec l'externalisation, seul `audioRef` serait copié (léger). Le fichier audio n'est pas dupliqué sur disque.
