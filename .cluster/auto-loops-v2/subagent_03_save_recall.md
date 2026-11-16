# Subagent 03 — Sauvegarde & Rappel (autoscript + widgets Virtual Console)

Projet : `light-maestro` (Electron + React + Zustand).
Mission : cartographier la persistance des shows/autoscripts et le rappel des widgets
de la vue Performance, puis donner le pattern exact pour ajouter un type sauvegardable
« auto loop » + un widget de Performance qui le rappelle **sans audio**.

> Lecture seule — aucun fichier source modifié.

---

## 1. Comment un show / autoscript est SAUVEGARDÉ dans le projet

### 1.1 Les deux niveaux de persistance

Il y a **deux** mécanismes distincts, à ne pas confondre :

| Niveau | Fichier / clé | Contenu |
|---|---|---|
| **Projet complet** `.lmproj` | `electron/main.ts` → `project:save` / `project:open` (L689–714), assembleur côté renderer `src/App.tsx` `saveProject()` / `__lm_open` | TOUT : appStore + showStore (scenes, chasers, effects, cueLists, **shows**, **songPresets**, mtcMarkers…) + `vcWidgets` |
| **Presets de chansons** (autoscript) | `electron/main.ts` → `presets:save` / `presets:load` (L716–724) → `presets.json` dans `userData` | Uniquement les `songPresets` (gros binaires audio base64) |
| **Stockage générique disque** | `electron/main.ts` → `storage:get/set/remove` (L726–742) | `show-store.json`, slot `autosave` (sauvegarde silencieuse) |
| **Export QuickShow** (legacy, hors projet) | `src/views/QuickShowView.tsx` `saveProject()` (L795) → `.lmpreset` ; `saveShow()` (L843) → `.lmshow` | `analysis`, `sections`, `quickShow`, `manualCues`, `efxTracks`, `colorTracks`, `strobeTracks`, `dimmerTracks`, `fixtureTracks`, `audioDataBase64` |

### 1.2 Le store de données : `src/stores/showStore.ts`

`useShowStore` est créé avec `create<ShowState>()` **sans** middleware `persist`.
Seules les `universes` passent par `localStorage` (`UNIVERSE_STORAGE_KEY = 'lightm…s.v1'`,
`loadUniverses()`/`saveUniverses()`, showStore.ts ~L360-372). Tout le reste vit en
mémoire et est persisté **explicitement** par le projet `.lmproj` (App.tsx) et/ou le
disque (`storage:set`).

Types clés dans `ShowState` (interface à `showStore.ts:238`) :

- `shows: ShowData[]` + `createShow` / `updateShow` / `deleteShow` / `setShows` / `getShow` / `getShowCount`
  - déclarés `showStore.ts:328-334`, implémentés `showStore.ts:948-990`.
  - `ShowData` (showStore.ts ~L126) = `{ id, name, duration, tracks: ShowTrack[], audioFileBase64?, audioFileName? }`.
- `songPresets: SongPreset[]` + `addSongPreset` / `removeSongPreset` / `updateSongPreset` / `setSongPresets`
  - déclarés `showStore.ts:337-341`, implémentés `showStore.ts:991-1028`.

### 1.3 Où vivent `dmxCues` / `sections` (l'autoscript)

L'autoscript est stocké **à l'intérieur d'un `SongPreset`** (`showStore.ts:172-186`) :

```ts
export interface SongPreset {
  id: string;
  name: string;
  audioFileBase64: string;
  audioFileName: string;
  dmxCues: DmxCue[];        // ← les cues DMX pré-calculées de l'autoscript
  quickShow: any;
  trackAnalysis: any;
  sections: any[];          // ← les sections audio (TrackSection[]) de l'autoscript
  efxTracks?: any[];
  manualCues?: DmxCue[];
  fixtureTracks?: any[];
  colorTracks?: any[];
  strobeTracks?: any[];
  dimmerTracks?: any[];
  chaserTracks?: any[];
  createdAt: string;
}
```

`dmxCues` et `sections` sont donc de simples champs JSON sérialisés tels quels dans
`showStore.songPresets` du `.lmproj`. Aucune sérialisation custom : c'est du
`JSON.stringify` du snapshot de store.

Type `DmxCue` — `src/hooks/dmx-cues.ts:72-80` :

```ts
export interface DmxCue {
  time: number;
  section: string;
  universe: number;
  channelValues: Record<number, number>;
  fixtureNames: string[];
  fixtureCount: number;
  effect: string;
  colors: string[];
  manual?: boolean;
}
```

### 1.4 L'assemblage du projet `.lmproj` — `src/App.tsx`

`saveProject(options)` (`App.tsx` ~L63-122) construit le snapshot :

```ts
const data = {
  schemaVersion: 1,
  appStore: persistable,                 // appStore sans isDirty/markDirty/markClean
  showStore: {
    patchedFixtures, stageDims, universes, fixturePositions, fixtureGroups,
    scenes, sceneFolders, chasers, effects, cueLists, shows,
    songPresets,        // App.tsx:100  ← l'autoscript est ici
    mtcMarkers,         // App.tsx:101
  },
  vcWidgets: widgets,   // App.tsx:102  ← widgets Virtual Console
  version: 1,
  timestamp: new Date().toISOString(),
};
```

- `widgets` = `perfState.vcWidgets` mappés pour **stripper `config.showData`** (gros
  binaire) en ne gardant que `showId` + `showName` (App.tsx ~L73-84).
- `options.silent === false` → `window.lightMaestro.project.save(json)` (dialog
  `.lmproj`) ; `silent === true` → `window.lightMaestro.storage.set('autosave', data)`
  (App.tsx ~L105-112).
- `markClean()` après sauvegarde.

Restauration — `__lm_open` (`App.tsx` ~L258-311) :

- `data.showStore.*` → `ss.setPatchedFixtures(...)`, `ss.setScenes(...)`,
  `ss.setChasers(...)`, `ss.setCueLists(...)`, `ss.setShows(...)`,
  `ss.setSongPresets(...)`, `ss.setMtcMarkers(...)`, etc.
- `data.vcWidgets` → `usePerformStore.getState().vcSetWidgets(data.vcWidgets)` (App.tsx ~L296).
- `__lm_new` (`App.tsx` ~L241-256) remet tout à zéro (tous les `setXxx([])` + `vcSetWidgets([])` + `storage.remove('show-store')`).

**Conclusion 1** : ajouter un type sauvegardable = ajouter un champ dans `ShowState`,
l'implémenter (create/update/delete/set), l'ajouter au snapshot `data.showStore` de
`saveProject()` (App.tsx ~L88-102), le restaurer dans `__lm_open` (~L290), et le vider
dans `__lm_new` (~L251).

---

## 2. Comment un widget de Performance rappelle un autoscript

### 2.1 Le type d'action `audioAutoScript`

`ButtonActionType` — `src/stores/performStore.ts:32-44` inclut `'audioAutoScript'`.

### 2.2 Les champs `ConsoleWidgetConfig` concernés

`ConsoleWidgetConfig` — `src/stores/performStore.ts:53-92`. Champs audio/autoscript :

| Champ | Type | Ligne | Rôle |
|---|---|---|---|
| `audioDataUrl` | `string?` | performStore.ts:69 | URL data: du fichier audio (base64) |
| `audioFileName` | `string?` | performStore.ts:70 | nom du fichier |
| `audioAnalysis` | `any?` | performStore.ts:71 | résultat `analyzeAudioBuffer` (sections, bpm, genre, energyCurve…) |
| `audioCues` | `any[]?` | performStore.ts:72 | `DmxCue[]` pré-calculées |
| `audioDuration` | `number?` | performStore.ts:73 | durée audio |
| `autoScriptConfig` | `any?` | performStore.ts:74 | `{ cueCount, bpm, genre }` |

(plus les champs communs : `actionType`, `sceneId`, `chaserId`, `showId`, `showName`,
`showData`, `cueListId`, `songId`, `songName`, `dmxUniverse`, `dmxAddress`, `dmxValue`,
`grandMasterValue`, `color`, `label`, `flashMode`, et les champs slider/frame.)

### 2.3 Configuration du widget (UI)

`AudioAutoScriptConfig` — `PerformanceView.tsx:1199-1395` :

1. **Choose Audio File** (`handleChooseFile`, L1214-1248) → lit le fichier via
   `window.lightMaestro.dialog.openFile`, construit la data URL, puis
   `onConfigChange({ audioDataUrl, audioFileName, audioCues: undefined, audioAnalysis: undefined, audioDuration: undefined, autoScriptConfig: undefined })`.
2. **Generate AutoScript** (`handleGenerate`, L1253-1316) → décode l'audio
   (`fetch` + `AudioContext.decodeAudioData`) → `analyzeAudioBuffer(...)` →
   `genCuesLocal(analysis)` → `loadFixtureDefinitions(...)` + `computeDmxForCue(...)`
   pour produire `dmxCues: DmxCue[]` → `onConfigChange({ audioDataUrl, audioFileName, audioAnalysis, audioCues, audioDuration, autoScriptConfig: { cueCount, bpm, genre } })`.

Le bloc est monté conditionnellement : `{config.actionType === 'audioAutoScript' && <AudioAutoScriptConfig …/>}` (`PerformanceView.tsx:1082-1087`).

⚠️ **Point important** : le `<select>` du type d'action (`PerformanceView.tsx:919-943`)
ne propose **que** `scene`, `chaser`, `blackout`, `loadShow`, `playSong`.
Il n'y a **aucun `<option value="audioAutoScript">`**. Le type `audioAutoScript` est
donc aujourd'hui atteignable uniquement par code (un widget créé programmatiquement),
pas via le menu de la Virtual Console.

### 2.4 Exécution au clic — `VCWidgetRenderer.activate()`

`PerformanceView.tsx:1742-1819` (branche `audioAutoScript`) :

1. Toggle : si `autoAudioRef.current` existe → stop (`pause`, `currentTime=0`,
   `cancelAnimationFrame`, `vcZeroAllUniverses()`, `setActive(false)`).
2. Sinon : `regeneratingRef` + `playIntentRef` mis à `true`.
3. Assure le moteur DMX (`api.stop()` puis `api.addUniverse(...)` + `api.start()`).
4. `analysis = config.audioAnalysis` ; si absent → ré-analyse l'audio.
5. Re-génère les cues avec les **fixtures actuelles** : `genCuesLocal(analysis)` +
   `computeDmxForCue(...)` → `(config as any).audioCues = cues`.
6. `if (playIntentRef.current) _startAudioAutoScript(cues)`.

`_startAudioAutoScript(cues)` — `PerformanceView.tsx:1524-1616` :

- S'enregistre dans le mutex audio : `registerAudioPlayback(widget.id, stop)` (L1544).
- Démarre le moteur DMX si besoin (L1550-1560).
- `fireAutoDmx()` (RAF) : premier frame → `vcZeroAllUniverses()` ; puis pour chaque cue
  dont `elapsed >= cue.time`, `dmxBridge.write('vc', cue.universe, cue.channelValues)` (L1562-1576).
- Lecture audio : `decodeAudioUrl(config.audioDataUrl)` + `AudioBufferSourceNode`
  (L1591-1608) ; si l'audio échoue → `beginPlayback()` quand même (horloge virtuelle).
- Arrêt sur `onended` → `cancelAnimationFrame` + `vcZeroAllUniverses()` + `setActive(false)`.

Helpers associés :

- `genCuesLocal(a: TrackAnalysis)` — `PerformanceView.tsx:2301+` (miroir du `genCues`
  QuickShow : découpe les sections en scenes de 2 mesures, palettes par section, 4 cues
  par scene, mouvement par section).
- `vcZeroAllUniverses()` — `PerformanceView.tsx:65-88` (écrit des zéros transitoires via
  `dmxBridge.writeTransient('vc', …)`).
- `stopAllAudioPlayback()` — `PerformanceView.tsx:91-99` ; `registerAudioPlayback()` — `PerformanceView.tsx:102-110`.
- `decodeAudioUrl` / `preloadAudioUrl` — importées de `src/utils/audio-cache.ts` (L17).

### 2.5 L'action MIDI « autoscript » (à ne pas confondre)

`src/engine/midi-actions.ts` **n'a pas** d'action `audioAutoScript`. Ce qui s'en
rapproche est le target MIDI `autoscript` :

- `MidiTarget` inclut `{ type: 'autoscript'; action: 'toggle' | 'nextEffect' | 'intensity' }` (midi-actions.ts:54).
- `AutoscriptAction = 'toggle' | 'nextEffect' | 'intensity'` (midi-actions.ts:641).
- `registerMidiAutoscriptHandler` / `midiAutoscript` (midi-actions.ts:645-679) togglent
  `app.quickShow.audioActive` / `intensity` (contrôle QuickShow), **pas** le widget VC
  `audioAutoScript` (qui vit dans `PerformanceView.tsx`).

---

## 3. Pattern exact : NOUVEAU type sauvegardable « auto loop » + widget sans audio

### 3.0 Contexte existant (important)

Un moteur « auto loops » existe déjà : `src/engine/auto-loops.ts` (types
`AutoLoop`, `AutoLoopStep`, `AutoLoopKind = 'color-chase'|'movement'|'dimmer-pulse'|'strobe'`,
générateurs `generateAutoLoops`/`generateLoopLibrary`, et matérialisation
`materializeAutoLoops`/`purgeAutoLoops`/`refreshAutoLoops`).

**`materializeAutoLoops(loops, store)` transforme chaque loop en scenes + chaser**
(scene par step, taggée `folder = 'auto-loops'`, puis un chaser qui les référence).
`src/views/AutoLoopsPanel.tsx` utilise déjà ce flux :
`materializeAutoLoops([loop], useShowStore.getState())` puis `midiPlayChaser(chaserId)`.

Conséquence : **les loops sont déjà « sauvegardables » sans nouveau type** — elles sont
matérialisées en `SavedScene[]` + `SavedChaser[]`, qui sont déjà persistés dans le projet.
Un widget Performance « jouer un loop » peut donc être un simple bouton `actionType:
'chaser'` pointant sur le chaser matérialisé.

### 3.1 Approche A (recommandée) : pas de nouveau type de store

1. **Sauvegarde** : rien à ajouter. Les loops matérialisées vivent dans
   `scenes` (folder `auto-loops`) + `chasers`, déjà dans `saveProject`/`__lm_open`.
2. **Widget Performance** : réutiliser `actionType: 'chaser'` avec `chaserId`.
   L'exécution chaser existe déjà (`PerformanceView.tsx:1900+`, branche `chaser`).

### 3.2 Approche B : type dédié `AutoLoop` persisté (si on veut garder le loop
indépendant du chaser matérialisé)

**Étape 1 — étendre le store (`src/stores/showStore.ts`)**

- Ajouter `AutoLoop` au dessus de `ShowState` (importer depuis `engine/auto-loops.ts`
  ou redéclarer). Ajouter dans `ShowState` (miroir du pattern `effects`, showStore.ts:238+) :
  ```ts
  autoLoops: AutoLoop[];
  createAutoLoop: (loop: Omit<AutoLoop,'id'>) => string;
  updateAutoLoop: (id: string, updates: Partial<AutoLoop>) => void;
  deleteAutoLoop: (id: string) => void;
  setAutoLoops: (loops: AutoLoop[]) => void;
  ```
- Implémenter (mirroir de `createEffect`/`updateEffect`/`deleteEffect`/`setEffects`,
  showStore.ts ~L700-780) avec un `id` genre `auto-${Date.now()}-${rand}` et
  `markDirty()` via `require('../stores/appStore')`.

**Étape 2 — persistance projet (`src/App.tsx`)**

- Dans `saveProject` (App.tsx ~L88-102) : ajouter `autoLoops: showState.autoLoops,`
  dans `data.showStore`.
- Dans `__lm_open` (App.tsx ~L290) : `if (data.showStore.autoLoops) ss.setAutoLoops(data.showStore.autoLoops);`
- Dans `__lm_new` (App.tsx ~L251) : `ss.setAutoLoops([]);`

**Étape 3 — étendre les types widget (`src/stores/performStore.ts`)**

- Ajouter `| 'autoLoop'` à `ButtonActionType` (performStore.ts:32-44).
- Ajouter dans `ConsoleWidgetConfig` (performStore.ts:53-92) :
  ```ts
  autoLoopId?: string;
  autoLoopName?: string;
  autoLoopSteps?: any[];   // AutoLoopStep[] si on veut embarquer les frames
  autoLoopSpeedBpm?: number;
  autoLoopDirection?: 'forward' | 'backward' | 'bounce';
  ```

**Étape 4 — UI de config (`src/views/PerformanceView.tsx`)**

- Ajouter `<option value="autoLoop">` au `<select>` du type d'action
  (`PerformanceView.tsx:933-941`).
- Ajouter un bloc conditionnel `{config.actionType === 'autoLoop' && (…)}` (mirroir du
  bloc `chaser` `PerformanceView.tsx:1089-1100`) : un `<select>` sur `autoLoops` du
  store (`autoLoopId` + `autoLoopName`).
- Ajouter le label par défaut dans le rendu du bouton (`PerformanceView.tsx:2073-2079`).

**Étape 5 — exécution du widget SANS audio (`src/views/PerformanceView.tsx`)**

Créer un helper `_startAutoLoop(loop)` **copié de `_startAudioAutoScript`**
(`PerformanceView.tsx:1524-1616`) **sans** la partie `AudioContext`/`decodeAudioUrl` :

- S'enregistrer dans un mutex d'exclusivité (réutiliser `registerAudioPlayback` ou un
  mutex dédié sans audio).
- Boucle RAF sur horloge virtuelle `performance.now()` :
  - premier frame → `vcZeroAllUniverses()` ;
  - à chaque step : `dmxBridge.write('vc', universe, step.channels)` à
    `t = stepIndex * (60000 / speedBpm)` ms, en gérant `direction` (forward/backward/bounce) ;
  - stop à la fin d'un cycle si non bouclé, ou reboucle.
- Brancher dans `activate()` (à côté de la branche `audioAutoScript`, `PerformanceView.tsx:1742`) :
  ```ts
  if (config.actionType === 'autoLoop' && config.autoLoopId) { … _startAutoLoop(loop); return; }
  ```
- Ajouter le stop dans `deactivate()` (à côté de `PerformanceView.tsx:1987`).

**Résumé du pattern (les 4 points d'extension pour tout NOUVEAU type)** :

1. `src/stores/showStore.ts` : type + champ + 4 fonctions (create/update/delete/set).
2. `src/App.tsx` : 3 lignes (snapshot save + restore open + clear new).
3. `src/stores/performStore.ts` : `ButtonActionType` + champs `ConsoleWidgetConfig`.
4. `src/views/PerformanceView.tsx` : `<option>` + bloc config + branche `activate()` +
   branche `deactivate()` + label.

---

## 4. Types `ButtonActionType` et `ConsoleWidgetConfig` (liste exacte)

Fichier : `src/stores/performStore.ts`.

### 4.1 `WidgetType` (L30)
`'button' | 'slider' | 'frame'`

### 4.2 `ButtonActionType` (L32-44) — 12 valeurs
```ts
'scene'
| 'chaser'
| 'showSequence'
| 'blackout'
| 'grandMaster'
| 'flashScene'
| 'go'
| 'audioPlayPause'
| 'dmxChannel'
| 'loadShow'
| 'playSong'
| 'audioAutoScript'
```

### 4.3 `SliderFunctionType` (L46-51) — 5 valeurs
```ts
'channel' | 'grandMaster' | 'chaseSpeed' | 'sceneFadeTime' | 'audioVolume'
```

### 4.4 `ConsoleWidgetConfig` (L53-92) — tous les champs

```ts
export interface ConsoleWidgetConfig {
  // Button
  actionType?: ButtonActionType;
  sceneId?: string;
  chaserId?: string;
  showId?: string;
  showName?: string;
  showData?: any;
  cueListId?: string;
  songId?: string;
  songName?: string;
  dmxUniverse?: number;
  dmxAddress?: number;
  dmxValue?: number;
  grandMasterValue?: number;
  // Audio + AutoScript
  audioDataUrl?: string;
  audioFileName?: string;
  audioAnalysis?: any;
  audioCues?: any[];
  audioDuration?: number;
  autoScriptConfig?: any;
  // Style
  color?: string;
  label?: string;
  flashMode?: 'flash' | 'toggle';
  // Slider
  channelAddress?: number;
  sliderUniverse?: number;
  sliderFunction?: SliderFunctionType;
  min?: number;
  max?: number;
  step?: number;
  // Frame
  title?: string;
  collapsed?: boolean;
  soloMode?: boolean;
  radioGroup?: boolean;
}
```

### 4.5 `ConsoleWidget` (L93-102)
```ts
{ id: string; type: WidgetType; x: number; y: number; width: number; height: number;
  config: ConsoleWidgetConfig; frameId?: string; pageIndex: number; }
```

### 4.6 Persistance du store perform

`usePerformStore` utilise `persist` (zustand) **mais** `partialize` ne persiste que
`vcPages`, `vcActivePage`, `vcGridSnap` (performStore.ts ~L258-263) — **pas** `vcWidgets`
(commentaire L262 : « vcWidgets are persisted inside the project file, not
localStorage »). `onRehydrateStorage` vide `vcWidgets` (L264-268). Les widgets sont donc
exclusivement dans le `.lmproj` (via `saveProject` App.tsx).

---

## Synthèse opérationnelle

- **Sauvegarder un autoscript** = l'encapsuler dans un `SongPreset` (`dmxCues` +
  `sections` + `quickShow` + `trackAnalysis` + tracks), stocké dans
  `showStore.songPresets`, sérialisé dans `showStore` du `.lmproj` (App.tsx `saveProject`)
  et/ou dans `presets.json` (main.ts `presets:save`).
- **Rappeler un autoscript** = bouton `actionType: 'audioAutoScript'` dont le `config`
  porte `audioDataUrl` / `audioAnalysis` / `audioCues` / `autoScriptConfig` ; l'exécution
  (`activate()` → `_startAudioAutoScript`) re-génère les cues avec les fixtures courantes
  et les joue via `dmxBridge.write('vc', …)` sur RAF + audio décode.
- **Ajouter un type sauvegardable** = 4 points : type + 4 fonctions dans `showStore.ts`,
  3 lignes dans `App.tsx` (save/open/new), extension `ButtonActionType` +
  `ConsoleWidgetConfig` dans `performStore.ts`, et 5 points d'UI/exécution dans
  `PerformanceView.tsx`.
- **Widget « auto loop » sans audio** : réutiliser `_startAudioAutoScript` **sans**
  `AudioContext`/`decodeAudioUrl` (horloge virtuelle seule), ou — plus simple — matérialiser
  le loop en chaser (`materializeAutoLoops`) et utiliser le `actionType: 'chaser'` existant.
