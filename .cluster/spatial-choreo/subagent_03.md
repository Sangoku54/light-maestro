# Rapport auditeur — Chaîne de génération des cues (branchement « pattern spatial »)

Date : 2026-08-26 — Lecture seule, aucun fichier source modifié.
Chemins relatifs à `light-maestro/`. Toutes les lignes sont vérifiées sur l'état actuel du repo.

> Correction de chemin : `SMART_MOVEMENTS`/`getSmartMovement` ne sont PAS dans `src/hooks/dmx-channel.ts`
> (ce fichier n'existe pas ; `src/engine/dmx-channel.ts` contient seulement `analyzeChannels`).
> Ils vivent dans **`src/engine/dmx-movement.ts`**.

---

## 1. genCues — signature, structure du cue, insertion de `spatialPattern`

**Signature** — `src/views/QuickShowView.tsx:444-455` :
```ts
export function genCues(
  sections: TrackSection[], bpm: number, beatDivision: number,
  cfg: any, manualCues: DmxCue[], regenSeed?: number | string,
  analysis?: TrackAnalysis | null,
): any[] {
```
Retourne `any[]` — **les objets cue ne sont typés nulle part ici** (pas de `CueInput` ni `CuePlayback` dans la signature). Deux chemins de génération dans la même fonction :

**Chemin A — audio-reactive** (si `cfg.audioReactive !== false && !!analysis`, L470+) : push du cue **L765-783** :
```ts
cues.push({
  time: t,
  section: section.type,
  effect: `${section.type} #${i + 1}`,
  intensity: dropAnticipation && !(...) ? 'high' : prevIntensity,
  colors: sectionPal, color: prevColor,
  strobe: dropAnticipation ? false : strobe,
  energy, movement, movementAmplitude, movementSpeed,
  colorTemp, strobeProbability,
  dimmerPulseOnBeat: section.type === 'drop' || section.type === 'chorus',
  activeTiers: ACTIVE_TIERS[section.type],
  musicStyle: genre,
  dropAnticipation: dropAnticipation || undefined,
});
```
Champs complets du cue audio : `time, section, effect, intensity, colors, color, strobe, energy, movement, movementAmplitude, movementSpeed, colorTemp, strobeProbability, dimmerPulseOnBeat, activeTiers, musicStyle, dropAnticipation`. C'est **ici** qu'un champ `spatialPattern` (+ `spatialParams`) se branche naturellement.

**Chemin B — legacy cycle-based** (L791+) : push **L815-830** — champs plus courts : `time, section, effect, intensity, colors, color, strobe, energy, movement, colorTemp, strobeProbability, dimmerPulseOnBeat, musicStyle`. Pas de `movementAmplitude/movementSpeed` → le moteur retombe sur les défauts par tier (voir §4). Si on ajoute `spatialPattern`, il faut le faire sur les DEUX chemins.

**Cues manuels** (L835-851) : `movement: 'static'` fixe + `manual: true` — à ne PAS perturber par un pattern spatial (voir §4).

**selectMovementPattern** — défini **L519-613** (closure locale dans le bloc audioReactive de `genCues`, PAS exportée, PAS dans dmx-channel) ; appelée **L738** :
```ts
const movement = selectMovementPattern(section.type, rms, centroid, bassRatio, beatStrong, dropAnticipation);
```
Signature : `(secType, featRms, featCentroid, featBass, isBeatStrong, isDropAnticipation): string`. Elle construit un pool par section (`intro/verse/chorus/bridge/drop/outro/build`, L521-530), puis applique des biais genre (L532-546), atmosphère (L548-558), style `cfg.movement` smooth/sharp (L560-567), BPM (L569-576) et features audio (L578-587), puis tire un index par hash+RNG (L589-596).

## 2. SMART_MOVEMENTS / getSmartMovement — définition et circulation du nom

**Définition** — `src/engine/dmx-movement.ts:21-43` :
```ts
export const SMART_MOVEMENTS: Record<string, string[]> = {
  intro: ['static','panOnly','tiltOnly','sweep','wave'],
  verse: ['sweep','wave','panOnly','figure8','randomWalk','panOnly'],
  chorus: ['circle','sweep','spiral','diamond','figure8','bounce','wave'],
  bridge: ['figure8','wave','zigzag','randomWalk','spiral','diamond'],
  drop: ['bounce','zigzag','heartbeat','circle','spiral','diamond','randomWalk','wave'],
  outro: ['tiltOnly','panOnly','sweep','static','wave'],
  build: ['spiral','circle','wave','sweep','diamond','zigzag'],
};
export const DEFAULT_SMART_MOVEMENTS = ['sweep','circle','wave','figure8','zigzag'];
export function getSmartMovement(fixtureIndex, totalMobileFixtures, section, timeOffset?): string {
  const patterns = SMART_MOVEMENTS[section] || DEFAULT_SMART_MOVEMENTS;
  if (totalMobileFixtures <= 1) return patterns[0];
  // hash(section) + timeIdx + fixtureIndex → idx % patterns.length
```
→ distribue un pattern **par fixture** selon son index mobile (chorégraphie multi-fixtures), mais **sans aucune notion de position scène**.

**Appels moteur** — `src/hooks/dmx-playback.ts` (import L273) :
- tick live : **L1007** `if (mobileIdx >= 0) return getSmartMovement(mobileIdx, totalMobile, cueMov, ct);` (quand `cue.movement` n'est PAS un pattern explicite) et **L1021** `return getSmartMovement(mobileIdx, totalMobile, sec, ct);` (fallback sans movement).
- `computeDmxForCue` (crossfade) : **L1475** et **L1487** (mêmes rôles).

**Est-ce que le nom du pattern circule du cue au moteur ? OUI, partiellement.** Dans le tick (L996-1015) et dans `computeDmxForCue` (L1466-1485) :
```ts
const cueMov = active.movement;
if (cueMov) {
  const explicitPatterns = new Set(['sweep','circle','bounce','wave','figure8','zigzag','diamond','spiral','heartbeat','randomWalk','panOnly','tiltOnly','static','pulse']);
  if (!explicitPatterns.has(cueMov)) { ... getSmartMovement(...) }  // nom = nom de section → distribution smart
  return cueMov;                                                    // pattern explicite → passe tel quel
}
```
→ Les noms produits par `selectMovementPattern` ('wave', 'circle'…) sont dans le set explicite : **chaque fixture reçoit le même pattern**, seules les phases `motorPhase = m*(2π/motorCount)` (L1025) distinguent les moteurs. `getSmartMovement` n'est utilisé qu'en fallback (movement absent ou = nom de section). Conclusion : **aucune chorégraphie basée sur la position scène n'existe aujourd'hui** ; `movementPhase = Math.random()*1000` (L552) est la seule variation globale.

## 3. selectMovementPattern — localisation, valeurs, connotation spatiale

- **Où** : `QuickShowView.tsx:519-613`, closure interne de `genCues` (chemin audio-reactive). Non exportée, non testée directement (mais `genCues` l'est via `src/__tests__/gencues.test.ts`).
- **Dépendances** : section type (`secType`), genre (`cfg.musicStyle` ou genre détecté, L472-482), atmosphère (`analysis.atmosphere`), `cfg.movement` (smooth/sharp), BPM, features audio (rms/centroid/bass, beat strong, anticipation de drop).
- **Valeurs possibles retournées** (union des pools §1) :
  `static, panOnly, tiltOnly, wave, sweep, figure8, randomWalk, circle, diamond, spiral, bounce, heartbeat, zigzag`.
- **Déjà à connotation spatiale** (mais pas positionnelle — aucun usage de `fixturePositions`) :
  - `wave` (L1040 tick : `py=Math.sin(phase*.35+motorPhase*1.5)` → vague par moteur, pas par position)
  - `circle`, `diamond`, `spiral`, `zigzag`, `bounce`, `heartbeat`, `figure8` — formes, pas de répartition sur la scène.
  - **Pas de `chase`, `alternate`, `cross`, `sweepL2R`…** (à créer).
- Deuxième sélecteur : `SMART_MOVEMENTS` (dmx-movement.ts, clé = nom de section) n'est qu'un fallback moteur, pas un choix de génération.

## 4. Contraintes de branchement — flux cues → moteur

**Flux** : `genCues` → `cues` (useMemo, QuickShowView L2303-2308, deps : sections/bpm/qs/manualCues/key/analysis) → `useDmxPlayback` (L2368, `cues: (showB && cuesB.length > 0 ? cuesB : cues) as any` L2373) → tick : cue actif = dernier `cue.time <= ct` (L625-626), `sec = active?.section?.toLowerCase() ?? 'verse'` (L628), crossfade si `gap>0 && gap<0.3` (L673) → `computeDmxForCue(nextCue, …, fixturePositions)` (L680-684) → bloc mouvement (L973-1057) → chaser takeover (L1113-1148) → lasers (L1099+).

**Typage strict des cues** — 3 interfaces distinctes à connaître :
- `CuePlayback` — `dmx-playback.ts:319-340` : type runtime du moteur ; `movement?` est une **union fermée de 14 noms** (L326-328 : `'static'|'sweep'|'circle'|'pulse'|'wave'|'bounce'|'figure8'|'spiral'|'zigzag'|'heartbeat'|'randomWalk'|'diamond'` — note : **`panOnly`/`tiltOnly` ne sont pas dans l'union** alors qu'ils circulent réellement), plus `movementAmplitude?`, `movementSpeed?`, `energy?`, `activeTiers?`… C'est **ici** qu'il faut ajouter `spatialPattern?` + `spatialParams?` pour un accès typé.
- `CueInput` — `dmx-cues.ts:87-104` : type d'entrée du 2ᵉ chemin de génération (PerformanceView `genCuesLocal` L2393 → `computeDmxCues` L549, utilisé pour presets/VC) ; `movement?: string` (commentaire : « not section type »), `movementAmplitude?`, `movementSpeed?`, `energy?`.
- `DmxCue` — `dmx-cues.ts:73-84` : type de SORTIE pré-calculé (`channelValues` statiques), utilisé pour `manualCues` et songPresets (`buildPresetDmxCues`, QuickShowView L88+, passe par `computeDmxForCue`).

**Champs custom non typés** : le moteur lit déjà via `(cue as any)` pour `movementAmplitude`, `movementSpeed`, `energy`, `forcedColor`, `forcedStrobe`, `strobeSpeed` (L988-989, 1453-1457, 1466-1487, 1527-1532, 1445). Un `spatialPattern` ajouté en `any[]` (genCues) transite donc **sans erreur TS** jusqu'au moteur ; reste à le lire (typé ou `as any`) aux deux points de consommation.

**Modes à ne PAS casser** (vérifiés) :
- **manualCues** : pushés avec `manual: true`, `movement: 'static'` (L837-851) → un `spatialPattern` par défaut `'off'` et un skip si `cue.manual` sont nécessaires.
- **Chaser tracks** : `computeChaserTrackOverrides` (L199-260) + takeover `chaserCtl` (L1113-1148) contrôle les fixtures ciblées ; le pattern spatial doit être ignoré pour ces fixtures (comme le bloc mouvement l'est : cf. `chaserCtl.size > 0` L1132).
- **disabledFixtures** : skip tôt dans tick (L779) et computeDmxForCue (L1362) — aucun travail à faire, le champ n'y sera simplement pas lu.
- **Crossfades < 0,3 s** : `computeDmxForCue` recalcule TOUT le frame du cue suivant (L680) — le pattern spatial doit y être lu aussi (L1450-1532), sinon les fondus rapides repassent en mouvement non-spatial et clignotent.
- **Fixture tracks / EFX / chaser** : priorité d'écriture pan/tilt : EFX map (L964-972) > EFX track overrides (L972-978) > fixture track `movementBlocks` (`trackMovement.pattern`, L973-984 / L1450) > cue. Le spatial doit s'insérer au même niveau que le cue (après les tracks), pas les écraser.
- **panTiltLimits / clampPanToStage** : appliqués après calcul (L1048-1057, L1518-1527) — compatibles, un offset spatial doit passer par le même chemin `raw → clamp → limit`.

## 5. Fallback — fixture sans position

**État actuel** : `fixturePositionsRef` est déclaré (L371) et lu (L599 : `const fixturePositions = fixturePositionsRef?.current;`) mais **n'est branché par AUCUN appelant** : ni QuickShowView L2368 ni SongPresetPlayer L226 ne le passent → `fixturePositions` est `undefined` en lecture live → `const fp = fixturePositions?.[pf.id]` (L1044, L1051, L1515, L1520) → `fp ? clampPanToStage(raw, fp.x) : raw` → **clamp stage inactif aujourd'hui**. Les positions existent dans le store : `showStore.fixturePositions` (L262, type `FixturePos` L161-176, x/y normalisés 0-1), initialisées en grille par `initFixturePosition` (L591-609 : `x: 0.1 + col*0.16, y: 0.1 + row*0.18`, col = index % 6, row = floor(index/6)).

**Fallback recommandé** (chaîne, dans l'ordre) :
1. `fixturePositionsRef.current[pf.id]` (une fois la ref branchée — sinon lire `useShowStore.getState().fixturePositions`).
2. Sinon, position dérivée de l'index (réutiliser la formule d'`initFixturePosition` : `x = 0.1 + (i%6)*0.16`, `y = 0.1 + floor(i/6)*0.18`) sur l'ordre des fixtures mobiles.
3. Sinon (aucune donnée), repli par phase d'index mobile type `getSmartMovement` (phase = `i * 2π / totalMobile`) pour que la chorégraphie ne s'effondre pas en positions identiques.
Le pattern spatial doit de toute façon être appliqué en **offset relatif** au centre 128 (comme `px/py` actuels), donc une position absente = offset 0 = comportement actuel.

---

## Points de branchement recommandés

1. **`src/views/QuickShowView.tsx` L765-783 (+ L815-830 legacy, + L837-851 manuels)** — ajouter `spatialPattern`/`spatialParams` aux cues poussés ; c'est la source. Un sélecteur `selectSpatialPattern(section, genre, energy)` à créer à côté de `selectMovementPattern` (L519-613), et appliquer `'off'`/`undefined` pour les cues manuels.
2. **`src/hooks/dmx-playback.ts` L319-340 (`interface CuePlayback`)** — étendre le type (`spatialPattern?: 'off'|'wave'|'alternate'|'cross'|'split'|…`, `spatialParams?: { direction?, phaseOffset?, groups? }`) pour un accès typé au lieu de `(cue as any)`. Miroir dans `CueInput` (`dmx-cues.ts:87-104`) pour le chemin PerformanceView/presets.
3. **`src/hooks/dmx-playback.ts` L991-1057 (tick, bloc mouvement)** — dans l'IIFE `movPattern`/boucle `motorPhase`, injecter le décalage spatial par fixture (basé sur `fixturePositions`) avant le `switch` : c'est le point où le pattern spatial doit dériver `px/py` en fonction de la position scène, en respectant les garde-fous §4 (skip si `trackMovement`, EFX, chaser takeover, `cue.manual`).
4. **`src/hooks/dmx-playback.ts` L1450-1532 (`computeDmxForCue`)** — miroir exact du point 3 pour les crossfades < 0,3 s (et pour `buildPresetDmxCues`/snapshots VC qui passent par cette fonction).
5. **`src/views/QuickShowView.tsx` L2368 et `src/components/SongPresetPlayer.tsx` L226** — brancher `fixturePositionsRef` (déjà supporté par l'API moteur L371/599) ; sans ce câblage, aucune donnée de position n'atteint le moteur. Alternative : lire `showStore.fixturePositions` directement dans le moteur. Ajouter le helper de fallback §5 dans `src/engine/dmx-movement.ts` (à côté de `getSmartMovement`).
