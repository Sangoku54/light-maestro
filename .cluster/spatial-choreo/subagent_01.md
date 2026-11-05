# Rapport — Audit moteur spatial (chorégraphie spatiale)

**Auditeur** : subagent_01 (auditeur moteur spatial) — lecture seule, aucun fichier modifié.
**Projet** : light-maestro (Electron/React/TS). Toutes les lignes ont été vérifiées par lecture directe.

---

## 1. Positions des fixtures : comment elles arrivent (ou n'arrivent pas) au moteur

### 1a. Le contrat du moteur : `fixturePositionsRef`

`src/hooks/dmx-playback.ts` L371 (déclaration de l'option) :

```ts
fixturePositionsRef?: React.MutableRefObject<Record<string, { x: number; y: number }>>; // For stage-aware pan/tilt
```

- L379 : destructuring dans `useDmxPlayback`.
- L599 (tick) : `const fixturePositions = fixturePositionsRef?.current;`
- L682 (crossfade) : passé à `computeDmxForCue` en 11ᵉ argument positionnel :

```ts
nextCueDmx=computeDmxForCue(
  nextCue,patchedFixturesRef.current,fixtureDefs,universes as any,tierMultipliers,undefined,
  colorTrackColors,strobeOverridesEarly,undefined,disabledFixturesRef?.current,fixturePositions
);
```

- Usage actuel dans le tick : **uniquement du clamping de débattement** (L1044-1045, L1051-1052) :

```ts
const fp = fixturePositions?.[pf.id];
let pv = fp ? clampPanToStage(raw, fp.x) : raw;   // L1044-1045
let tv = fp ? clampTiltToStage(raw, fp.y) : raw;   // L1051-1052
```

- Usage dans `computeDmxForCue` : idem (L1515-1521), voir §4.

### 1b. ⚠️ Découverte critique : personne ne remplit cette ref

Recherche exhaustive `fixturePositionsRef` dans tout le repo (hors `.openclaw/tmp` = backups) :

| Fichier | Ligne | Rôle |
|---|---|---|
| `src/hooks/dmx-playback.ts` | 371, 379 | déclaration + destructuring |
| `src/hooks/dmx-playback.ts` | 599, 682, 1044, 1051, 1325, 1515, 1520 | lecture |

**Aucun appelant ne passe `fixturePositionsRef`.** Les deux seuls appels à `useDmxPlayback` sont :
- `src/views/QuickShowView.tsx` L2368 (appel complet L2370-2409, **sans** `fixturePositionsRef`)
- `src/components/SongPresetPlayer.tsx` L226 (appel L226-247, **sans** `fixturePositionsRef`)

Grep `fixturePositionsRef:` (avec deux-points) : **0 résultat hors de dmx-playback.ts**. Conséquence : dans le moteur, `fixturePositions` vaut toujours `undefined` aujourd'hui → le clamping stage-aware est du code mort, et aucun pattern spatial ne peut s'appuyer sur la position.

### 1c. La source de vérité : `useShowStore.fixturePositions`

Type `FixturePos` — `src/stores/showStore.ts` L161-173 :

```ts
export interface FixturePos {
  x: number; // normalized 0-1 (stage width)
  y: number; // normalized 0-1 (stage depth)
  h: number; // height multiplier (0-1, maps to 0-5m range)
  heading: number; // rotation in degrees (0-360), 0=front (toward audience)
  tilt?: number; // static tilt in degrees (-90 to +90)
  beamAngle?: number;
  thumbnailScale?: number;
  mountMode?: 'top' | 'ground' | 'rear';
}
```

- Store : `fixturePositions: Record<string, FixturePos>` (L262), initialisé `{}` (L570).
- Écriture : `setFixturePosition` (L572-580, fusion partielle, défaut `{x:0.5,y:0.3,h:0.5,heading:0}`), `setFixturePositions` (L582), `initFixturePosition` (L591-607) :

```ts
initFixturePosition: (id, fixtureType, index) => {
  set((state) => {
    if (state.fixturePositions[id]) return state;
    const col = index % 6;
    const row = Math.floor(index / 6);
    const isOverhead = fixtureType === 'moving_head' || fixtureType === 'scanner';
    return {
      fixturePositions: {
        ...state.fixturePositions,
        [id]: { x: 0.1 + col * 0.16, y: 0.1 + row * 0.18,
                h: isOverhead ? 0.6 : 0.3, heading: 0 },
      },
    };
  });
},
```

→ **Format exact : `Record<fixtureId, {x,y,h,heading}>`, coordonnées normalisées 0..1** (x = largeur, y = profondeur). Clé = `PatchedFixture.id` (ex. `'tonio-6arm-1'`).

- **Z existe** : `h` (hauteur, 0..1 → 0..5 m). Mais le type du moteur (`Record<string,{x,y}>`, dmx-playback L371) **l'écarte** à la frontière. Une chorégraphie verticale (vagues en hauteur) nécessitera d'élargir ce type.
- Persistance : `src/App.tsx` L98 (sauvegarde), L257/L291 (chargement via `setFixturePositions`).
- `electron/show/engine.ts` L56 : `private fixturePositions: Map<string,{x,y}> = new Map();` — **déclaré mais jamais rempli/utilisé** (grep electron/ : 1 seul hit = la déclaration). Chemin Electron séparé, hors périmètre renderer.

### 1d. Qui remplit le store

- `src/views/Stage3D.tsx` L372-374 (subscribe) + L381-387 : init auto des nouvelles fixtures (`initFixturePosition(pf.id, pf.fixtureType, i)`), + éditeur de position (sliders L2287+, drag L1802+, rotation L1907+).
- `src/views/Stage2DEditor.tsx` L20-23 (subscribe), L58-59 (init), L70-146 (alignements/arrangements).

**Synthèse §1** : positions fiables et persistées dans le store, mais **le câblage store → moteur (`fixturePositionsRef`) n'existe pas**. C'est le premier maillon à créer.

---

## 2. `getSmartMovement` : distribution actuelle (aucune position spatiale)

Fichier complet : `src/engine/dmx-movement.ts` (48 lignes).

Clamping stage-aware (L4-10) — seuls consommateurs actuels des positions :

```ts
export function clampPanToStage(panDmx: number, x: number): number {
  const d = panDmx - 128;
  return 128 + Math.max(-Math.round(x * 128), Math.min(Math.round((1 - x) * 128), d));
}
export function clampTiltToStage(tiltDmx: number, y: number): number {
  const d = tiltDmx - 128;
  return 128 + Math.max(-Math.round(Math.max(0.2, y) * 128), Math.min(Math.round(Math.min(1, y + 0.3) * 128), d));
}
```

`halfDegToDmxOffset` (L14-19) : conversion degrés → offset DMX (pan pleine course 270° de chaque côté, tilt 90° — cohérent avec Stage3D, cf. §5).

Structure des patterns (L23-33) :

```ts
export const SMART_MOVEMENTS: Record<string, string[]> = {
  intro:   ['static', 'panOnly', 'tiltOnly', 'sweep', 'wave'],
  verse:   ['sweep', 'wave', 'panOnly', 'figure8', 'randomWalk', 'panOnly'],
  chorus:  ['circle', 'sweep', 'spiral', 'diamond', 'figure8', 'bounce', 'wave'],
  bridge:  ['figure8', 'wave', 'zigzag', 'randomWalk', 'spiral', 'diamond'],
  drop:    ['bounce', 'zigzag', 'heartbeat', 'circle', 'spiral', 'diamond', 'randomWalk', 'wave'],
  outro:   ['tiltOnly', 'panOnly', 'sweep', 'static', 'wave'],
  build:   ['spiral', 'circle', 'wave', 'sweep', 'diamond', 'zigzag'],
};
export const DEFAULT_SMART_MOVEMENTS = ['sweep', 'circle', 'wave', 'figure8', 'zigzag'];
```

La fonction de distribution (L35-47) :

```ts
export function getSmartMovement(
  fixtureIndex: number,
  totalMobileFixtures: number,
  section: string,
  timeOffset?: number,
): string {
  const patterns = SMART_MOVEMENTS[section] || DEFAULT_SMART_MOVEMENTS;
  if (totalMobileFixtures <= 1) return patterns[0];
  let hash = 0;
  for (let i = 0; i < section.length; i++) hash = ((hash << 5) - hash) + section.charCodeAt(i);
  const timeIdx = timeOffset ? Math.floor(timeOffset / 8) : 0;
  const idx = (fixtureIndex + timeIdx + Math.abs(hash % 97)) % patterns.length;
  return patterns[idx];
}
```

**Analyse** :
- La « distribution spatiale » actuelle = **varier le pattern choisi** (pas la phase) selon `fixtureIndex` (index d'ordre de patch parmi les fixtures mobiles), la section (hash) et une fenêtre temporelle de 8 s (`floor(timeOffset/8)`).
- `fixtureIndex` = ordre dans le tableau `fixtures` (par univers), calculé à chaque frame par comptage (voir §3) — **aucune corrélation avec la position réelle**.
- **Aucun paramètre x/y/z** dans la signature. La position n'y est pas utilisée.

Appels (4 sites, tous avec `(mobileIdx, totalMobile, section, time)`):
- Tick : `dmx-playback.ts` L1007 (`cueMov` non-explicite) et L1021 (fallback section).
- `computeDmxForCue` : L1475 et L1487.

---

## 3. Boucle de mouvement par fixture (tick, chemin QuickShow live)

Contexte : boucle par univers L743 `for(const[uniIdx,fixtures]of analysis.byUniverse.entries())`, boucle fixture L746 `for(let fi=0;fi<fixtures.length;fi++)`.

### Bloc PAN/TILT complet (L961-1055)

```ts
// L961
const panCount=fa.panOffsets.length;const tiltCount=fa.tiltOffsets.length;const motorCount=Math.max(panCount,tiltCount,1);
if(panCount>0||tiltCount>0){
  // (1) EFX override (L966-973), (2) EFX track override (L974-978) — bypass auto
  // (3) auto pattern:
  const trackMovement = ... // fixture-track movement blocks (L980-991), bypass clamps
  const tierAmpMult = pf.tier === 'primary' ? 1 : pf.tier === 'secondary' ? 0.72 : 0.42;  // L985
  const amplitude = trackMovement ? trackMovement.amplitude
    : active.movementAmplitude !== undefined
      ? Math.max(4, Math.min(128, Math.round(active.movementAmplitude * tierAmpMult)))
      : pf.tier === 'primary' ? 90 : pf.tier === 'secondary' ? 70 : 40;                    // L986-991
  const movPattern = (() => {
    if (trackMovement) return trackMovement.pattern;
    const cueMov = active.movement;
    if (cueMov) {
      const explicitPatterns = new Set(['sweep','circle','bounce','wave','figure8','zigzag','diamond','spiral','heartbeat','randomWalk','panOnly','tiltOnly','static','pulse']);
      if (!explicitPatterns.has(cueMov)) {
        // Section name → smart distribution (L999-1009)
        let mobileIdx = -1, totalMobile = 0;
        for (const ffa of fixtures) {
          if (ffa.panOffsets.length > 0 || ffa.tiltOffsets.length > 0) {
            if (ffa.fixture.id === pf.id) mobileIdx = totalMobile;
            totalMobile++;
          }
        }
        if (mobileIdx >= 0) return getSmartMovement(mobileIdx, totalMobile, cueMov, ct);
        return cueMov;
      }
      return cueMov; // explicit pattern
    }
    // Fallback: smart distribution based on section (L1013-1022, même comptage)
    if (mobileIdx >= 0) return getSmartMovement(mobileIdx, totalMobile, sec, ct);
    return sec;
  })();
  if(amplitude>0){for(let m=0;m<motorCount;m++){
    const motorPhase=m*(Math.PI*2/motorCount);                                    // L1025
    const speedMult=active.movementSpeed??1;
    const curAmp = amplitude; const curSpd = speedMult;
    const blendAmp = ...; const blendSpd = ...;                                    // crossfade vers next cue (L1029-1033)
    const phase=(ct*Math.PI*2*blendSpd)+motorPhase+movementPhase;let px=0,py=0;   // L1034
    switch(movPattern){ case'intro': ... case'verse': ... case'chorus': ...
      case'sweep':px=Math.sin(phase*.35+motorPhase)*.7;py=Math.cos(phase*.3+motorPhase)*.5;break;
      case'circle':px=Math.sin(phase*.5+motorPhase)*.7;py=Math.cos(phase*.5+motorPhase)*.7;break;
      case'wave':px=Math.sin(phase*.6+motorPhase)*.5;py=Math.sin(phase*.35+motorPhase*1.5)*.5;break;
      ... (L1035-1042, 17 patterns)
      default:px=Math.sin(phase*.35)*.4;py=Math.cos(phase*.3+motorPhase)*.4;}
    const pfl = panTiltLimits.perFixture?.[pf.id];
    const panLimit = trackMovement ? 128 : (pfl?.pan ?? panTiltLimits.pan);        // L1043
    const tiltLimit = trackMovement ? 128 : (pfl?.tilt ?? panTiltLimits.tilt);
    if(m<panCount){
      const raw = Math.max(0,Math.min(255,Math.round(128+px*blendAmp)));
      const fp = fixturePositions?.[pf.id];                                        // L1044
      let pv = fp ? clampPanToStage(raw, fp.x) : raw;                              // L1045
      pv = Math.max(128 - panLimit, Math.min(128 + panLimit, pv));
      chVals[pf.startAddress+fa.panOffsets[m]] = pv;
    }
    if(m<tiltCount){ /* idem avec py, fp.y, L1051-1052 */ }
  }}else{ /* pan/tilt = 128 (L1054) */ }
}
```

### Comment l'offset de phase par fixture est calculé aujourd'hui

- `phase` (L1034) = `ct * 2π * blendSpd` (phase **temporelle globale**, identique pour toutes les fixtures) `+ motorPhase` (offset par **index de moteur** dans la fixture : `m * 2π/motorCount`) `+ movementPhase` (**aléatoire global** par instance d'engine, L552 : `const movementPhase=Math.random()*1000;` — même valeur pour toutes les fixtures).
- `movementPhase` est tiré **une fois par playback** (hors tick), pas par fixture. Seul `ct` avance.
- Différenciation inter-fixtures actuelle : (a) le **pattern** choisi par `getSmartMovement` (basé sur l'index de patch), (b) `motorPhase` (intra-fixture multi-bras). **Aucun décalage de phase par fixture** : deux fixtures identiques avec le même pattern oscillent parfaitement en phase (image figée / mur uni).

### Point d'injection spatiale exact

Dans la boucle `for(let m=0...)` de L1025, `phase` (L1034) est le seul terme qui pilote `px,py`. Un décalage spatial s'injecte soit dans `phase` :

```ts
// proposé : avant la boucle moteur
const pos = fixturePositions?.[pf.id];
const spatialPhase = pos ? (pos.x * Math.PI * 2) + (pos.y * Math.PI * 2) : 0;
// puis L1034 :
const phase=(ct*Math.PI*2*blendSpd)+motorPhase+movementPhase+spatialPhase;
```

Ou au niveau du pattern (vagues gauche→droite : `px` décalé selon `pos.x`). Le `fp` est déjà lu par moteur (L1044/1051) mais **après** le calcul de phase ; il faudrait le hisser avant L1025 pour un seul lookup par fixture/frame.

---

## 4. `computeDmxForCue` (chemin par cue : crossfades + pré-calcul dmxCues)

### Signature (L1309-1333) — oui, elle reçoit déjà les positions

```ts
export function computeDmxForCue(
  cue: CuePlayback & { energy?: number },
  patchedFixtures: PatchedFixture[],
  fixtureDefs: Map<string, DmxFixtureDefinition>,
  universes: { id: string }[],
  tierMultipliers?: { primary: number; secondary: number; tertiary: number },
  fixtureTrackOverrides?: { ... },
  colorTrackColors?: Map<string, string>,
  strobeTrackOverrides?: Map<string, { active: boolean; speed: number }>,
  dimmerTrackOverrides?: Map<string, { active: boolean; value: number }>,
  disabledFixtures?: Set<string>,
  fixturePositions?: Record<string, { x: number; y: number }>,   // ← L1325, 11ᵉ param
  chaserTakeover?: Map<string, Record<number, number>>,
): Array<{ universe: number; channelValues: Record<number, number> }> {
```

### Bloc pan/tilt (L1446-1523)

```ts
const panCount = fa.panOffsets.length;                    // L1446
const tiltCount = fa.tiltOffsets.length;
const motorCount = Math.max(panCount, tiltCount, 1);      // L1448
if (panCount > 0 || tiltCount > 0) {                      // L1449
  const trackMovement = fixtureTrackOverrides?.forcedMovements?.get(pf.id);
  const amplitude = trackMovement ? trackMovement.amplitude
    : (cue as any).movementAmplitude !== undefined ? Math.min(128, Math.max(0, Math.round((cue as any).movementAmplitude)))
    : pf.tier === 'primary' ? 90 : pf.tier === 'secondary' ? 70 : 40;   // L1451-1454
  if (amplitude > 0) {
    const speedMult = (cue as any).movementSpeed ?? 1;    // L1457
    const phase = cue.time * Math.PI * 2 * speedMult;     // L1458  ← STATIQUE (pas de ct !)
    for (let m = 0; m < motorCount; m++) {
      const motorPhase = m * (Math.PI * 2 / motorCount);  // L1460
      const movSec = (() => { /* trackMovement → explicitPatterns → getSmartMovement(mobileIdx,totalMobile,cueMov,cue.time) L1475 / fallback section L1487 */ })();
      let px = 0, py = 0;
      switch (movSec) { /* mêmes 17 patterns que le tick, L1470-1505 */ }
      if (m < panCount) {
        const raw = Math.max(0, Math.min(255, Math.round(128 + px * amplitude)));
        const fp = fixturePositions?.[pf.id];             // L1515
        chVals[pf.startAddress + fa.panOffsets[m]] = fp ? clampPanToStage(raw, fp.x) : raw;   // L1516
      }
      if (m < tiltCount) { /* idem fp.y, L1520-1521 */ }
    }
  } else { /* 128 (L1522-1523) */ }
}
```

**Différences clés vs tick** :
- `phase` = `cue.time * 2π * speedMult` (L1458) : **figée à l'heure de la cue** — pas de `ct` (le moteur n'a pas l'heure courante), pas de `movementPhase`. Utilisée pour pré-calculer un snapshot DMX (crossfades < 0,3 s, L680-687) et les `dmxCues` affichés (QuickShowView L2336-2343).
- Positions : reçues en argument (L1325), utilisées **uniquement** pour le clamping (L1516, L1521). L'insertion d'un décalage spatial se ferait au même endroit qu'au §3 : dériver `spatialPhase` depuis `fixturePositions?.[pf.id]` **avant** L1458 et l'ajouter à `phase`.
- ⚠️ L'appel de QuickShowView (L2336-2343) ne passe que 8 arguments → `fixturePositions` = `undefined` dans ce chemin. Le seul appel qui le passe est le crossfade du tick (L682), lui-même dépendant de la ref jamais câblée (§1b).

---

## 5. Stage3D : positionnement et relation au pattern spatial

### Positionnement des fixtures (store, pas de positions par défaut dans le composant)

- Subscribe + init : L372-374 (`fixturePositions`, `setFixturePosition`, `initFixturePosition` depuis `useShowStore`) ; L381-387 : toute fixture sans position reçoit `initFixturePosition(pf.id, pf.fixtureType, i)` (grille 6 colonnes du store, cf. §1c).
- Conversion normalisé → mètres scène (L416-425, dans `createFixtureGeometry`) :

```ts
const stageX = (pos.x - 0.5) * stageDimsRef.current.width;
const stageZ = (pos.y - 0.5) * stageDimsRef.current.depth;
const stageY = STAGE_HEIGHT + pos.h * 5.0;        // h (0-1) → 0..5 m
group.position.set(stageX, stageY, stageZ);
group.rotation.y = ((pos.heading ?? 0) * Math.PI) / 180;
```

- Mises à jour de position : effet dédié L1446-1478 (`f3d.group.position.set(stageX, stageY, stageZ)` à chaque changement de `fixturePositions`), plus init L1300/L1410.
- Multi-bras : L688-713 — une `extraHead` par canal tilt supplémentaire (`tiltOffsets.slice(1)`), disposées en cercle (rayon 0.34) autour du centre, partageant l'arm (pan). Chaque tête lit son propre canal tilt (L1642 : `data[baseAddr + eh.tiltOffset]`).

### La 3D reflète le DMX, elle ne connaît pas les patterns

- `updateDmxState` (L1491+) : lit chaque frame `useAppStore.getState().dmx.channelData[f3d.universeIndex]` (L1492-1504) — le miroir alimenté par `onVirtualDmx` → `setUniverseData` (QuickShowView L2408-2411).
- Pan/tilt DMX → rotation (L1622-1634) :

```ts
const panTarget = ((panVal / 255) - 0.5) * Math.PI * 3;            // ±270° (1,5π) — cohérent avec halfDegToDmxOffset
const tiltTarget = f3d._mountTilt + ((tiltVal / 255) - 0.5) * Math.PI + (f3d._staticTilt ?? 0);  // ±90°
// interpolation limitée par panTiltMaxSpeed (°/s) → rendu réaliste des moteurs
```

**Conclusion §5** : la 3D est un **miroir DMX pur** (valeurs de canaux → rotation moteurs + cônes). Elle n'a **pas besoin** de connaître la chorégraphie spatiale : si le moteur écrit des pan/tilt spatialement orchestrés (vagues/alternances), la 3D les affichera automatiquement, y compris pour les bras multiples (`extraHeads`). Aucune modification Stage3D nécessaire pour l'implémentation de la chorégraphie ; ses positions (store) sont la bonne source pour alimenter le moteur.

---

## Points d'ancrage recommandés

1. **`src/views/QuickShowView.tsx` L2370-2409** (appel `useDmxPlayback`) — **maillon manquant n°1** : ajouter `fixturePositionsRef` (un `useRef` alimenté par `useShowStore(s => s.fixturePositions)`). Sans cela, tout le reste est du code mort. Même ajout dans `src/components/SongPresetPlayer.tsx` L226-247 (playback preset).

2. **`src/hooks/dmx-playback.ts` L1025-1034** (tick, boucle moteur) — hisser `const pos = fixturePositions?.[pf.id]` avant la boucle (il est déjà lu par moteur en L1044/1051, mais après le calcul de phase) et injecter un décalage spatial dans `phase` : `phase = ct*2π*blendSpd + motorPhase + movementPhase + spatialPhase(pos)`. C'est ici que naissent les vagues/alternances en live.

3. **`src/hooks/dmx-playback.ts` L1458** (`computeDmxForCue`) — même injection spatiale sur `phase` (param `fixturePositions` déjà présent L1325) pour que les snapshots de crossfade (L680-687) et les `dmxCues` pré-calculés restent cohérents avec le live.

4. **`src/engine/dmx-movement.ts` L35-47** (`getSmartMovement`) — étendre la distribution : accepter `(x, y)` optionnels pour distribuer les patterns spatialement (ex. gauche = sweep / droite = circle, alternance par rangée de `y`) au lieu du seul index de patch. Garder la signature actuelle en compatibilité (les 4 call sites passent `(mobileIdx, totalMobile, section, time)`).

5. **`src/hooks/dmx-playback.ts` L371** (type de la ref) — élargir à `Record<string, { x: number; y: number; h?: number }>` (ou carrément `FixturePos`) pour récupérer `h` (hauteur, showStore L163) et permettre des vagues verticales ; le store a déjà tout (`x,y,h,heading`), c'est la frontière du moteur qui jette `h`.
