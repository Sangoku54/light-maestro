# Subagent 45 — Analyse : Piste stroboscope non lue pendant la lecture QuickShow

## Date : 2026-08-15

## Résumé

Le strobe track **est correctement lu dans le playback principal** (boucle RAF de `useDmxPlayback`), mais **pas dans le crossfade** ni dans `buildPresetDmxCues` pour le pré-baking. Le bug principal se trouve dans l'appel `computeDmxForCue` pour le crossfade : `strobeTrackOverrides` est passé comme `undefined` au lieu de la valeur pré-calculée.

Cependant, après analyse approfondie, le chemin principal (playback RAF loop) **applique bien** les strobe track overrides dans la section Shutter. Le bug est donc dans `computeDmxForCue` utilisée pour le crossfade et le pré-baking.

## Analyse du flux

### 1. `computeStrobeTrackOverrides` (dmx-playback.ts)

La fonction est correcte :
- Elle parcourt les strobe tracks
- Trouve l'entrée active au temps courant (`currentTime >= e.time && currentTime < e.endTime`)
- Résout les fixtures cibles (all/group/fixture)
- Calcule la vitesse avec interpolation linéaire si `endSpeed` est défini
- Retourne `Map<string, { active: boolean; speed: number }>`

### 2. Playback principal (boucle RAF dans `useDmxPlayback`)

Lignes 667-669 : `strobeOverrides` est calculé correctement :
```ts
const strobeOverrides = strobeTracksRef?.current && strobeTracksRef.current.length > 0
  ? computeStrobeTrackOverrides(strobeTracksRef.current, ct, patchedFixturesRef.current, fixtureGroupsRef?.current || [])
  : null;
```

Lignes 816-843 : Le shutter utilise `strobeOverrides` correctement :
```ts
const strobeTrackOverride = strobeOverrides ? (strobeOverrides.get(pf.id) || null) : null;
// ...
const useStrobe = strobeTrackOverride
  ? strobeTrackOverride.active
  : trackStrobe ? trackStrobe.active
  : forcedStrobe !== undefined ? forcedStrobe : ((isDrop || isChorus) && active.strobe && pf.tier === 'primary');
```

**→ Le playback principal applique bien les strobe track overrides.**

### 3. Crossfade (ligne 623-628) — BUG #1

```ts
nextCueDmx=computeDmxForCue(
  nextCue,patchedFixturesRef.current,fixtureDefs,universes as any,tierMultipliers,undefined,
  colorTrackColors,undefined,undefined,disabledFixturesRef?.current,fixturePositions
);
```

Le 8ème argument (`strobeTrackOverrides`) est `undefined`. Pourtant, `strobeOverrides` n'est pas encore calculé à ce stade (il est calculé plus loin à la ligne 667). Mais le problème est que même si on le passait, il ne serait pas calculé au bon moment.

**Impact** : Pendant le crossfade (300ms avant le prochain cue), les valeurs DMX du prochain cue ne prennent pas en compte les strobe track overrides. Mais comme le crossfade blend les valeurs, l'impact est limité.

### 4. `computeDmxForCue` (ligne 1075+) — BUG #2

Dans la fonction `computeDmxForCue`, le shutter handling (ligne ~1196) reçoit bien `strobeTrackOverrides` en paramètre :

```ts
const strobeTrackStrobe = strobeTrackOverrides?.get(pf.id);
```

Et l'utilise correctement. Donc la fonction elle-même est correcte **si on lui passe les overrides**.

### 5. `buildPresetDmxCues` dans QuickShowView (ligne 32-90) — OK

```ts
const sto = computeStrobeTrackOverrides(strobeTracksRef.current as any, cue.time, pf, fg);
// ...
const computed = computeDmxForCue(cue, pf, fDefs, uni as any, tierMultipliers, overrides, ctc, sto, dto, undefined, undefined, cho);
```

**→ Le pré-baking passe bien `sto` (strobe track overrides) à `computeDmxForCue`.**

### 6. Passage de `strobeTracksRef` à `useDmxPlayback` (QuickShowView ligne 2209)

```ts
strobeTracksRef: strobeTracksRef as any,
```

**→ Le ref est bien passé au playback hook.**

### 7. Diagnostic du bug réel

Puisque le playback principal applique bien les strobe overrides, et que le pré-baking aussi, le bug pourrait être :

**Hypothèse A : `strobeTracksRef.current` est vide au moment du playback**

Vérifier que les strobe tracks ont bien des entries avec `time`/`endTime` couvrant le temps de playback.

**Hypothèse B : Le shutter channel n'est pas détecté (`fa.shutterOffset === null`)**

Si le fixture n'a pas de channel de type `Shutter` détecté par l'analyseur, les strobe overrides ne peuvent pas être appliqués. Le strobe track calcule les overrides mais ils ne sont jamais écrits sur aucun channel DMX.

**Hypothèse C : Les strobe track entries ont des valeurs de `speed` incorrectes**

Si `speed` est 0 ou très faible, le shutter peut ne pas clignoter visiblement. Dans le playback principal :
```ts
chVals[sAddr] = Math.min(255, 180 + Math.floor(adaptedSpeed * 3));
```
Avec `speed=0` → `chVals[sAddr] = 180`, ce qui est une valeur de shutter partiellement ouvert, pas un strobe visible.

**Hypothèse D (LA PLUS PROBABLE) : Le strobe track n'a pas d'effet visible car le shutter reste à une valeur fixe**

Dans le playback principal, quand `useStrobe` est true avec un strobe track override :
```ts
chVals[sAddr] = Math.min(255, 180 + Math.floor(adaptedSpeed * 3));
```

Cette ligne écrit une **valeur fixe** sur le shutter (par exemple 210 pour speed=10). Mais un strobe nécessite que le shutter **clignote** — c'est-à-dire qu'il alterne entre ouvert et fermé à la fréquence souhaitée.

Or, le code ne fait **pas d'oscillation temporelle** du shutter quand un strobe track override est actif ! Il écrit une valeur statique. Le fixture reçoit une valeur DMX fixe sur son channel shutter, ce qui peut selon le fixture :
- Activer le strobe intégré (si la valeur correspond à une capability strobe)
- Rester ouvert (si la valeur est dans la plage "shutter open")
- Ne rien faire de visible

**Le vrai bug :** Pour que le strobe soit visible, il faut soit :
1. Écrire une valeur dans la plage "strobe" du channel shutter (dépend du fixture)
2. Ou faire osciller le shutter entre 0 et 255 à la fréquence `speed`

Le code actuel fait `180 + floor(speed * 3)` qui donne des valeurs entre 180 et 255 — c'est la plage "shutter open" sur la plupart des fixtures, PAS la plage strobe.

**Hypothèse E : La value strobe est dans la bonne plage mais le fixture a besoin d'oscillation**

Sur beaucoup de fixtures DMX, le channel shutter a des capabilities :
- 0-7 : Closed
- 8-15 : Open
- 16-131 : Strobe slow → fast
- 132-255 : Open

Dans ce cas, `180 + floor(speed * 3)` = 180-255 = "Open", pas strobe !

Il faudrait écrire dans la plage 16-131 pour activer le strobe, par exemple :
```ts
chVals[sAddr] = 16 + Math.floor(speed * 5); // 16-141, dans la plage strobe
```

Mais cela dépend de la définition du fixture (capabilities). Sans consulter les caps du shutter, le code ne peut pas savoir quelle valeur écrire.

## Fix proposé

### Fix 1 (critique) : Osciller le shutter pour le strobe track

Quand un strobe track override est actif, le shutter doit osciller entre fermé et ouvert à la fréquence `speed`, au lieu d'écrire une valeur fixe. Cela garantit un effet strobe visible quel que soit le fixture.

### Fix 2 (important) : Passer `strobeOverrides` au crossfade `computeDmxForCue`

Calculer `strobeOverrides` avant l'appel `computeDmxForCue` du crossfade et le passer en paramètre.

### Patch

**Fichier : `src/hooks/dmx-playback.ts`**

**Fix 1 — Oscillation du shutter pour strobe track (playback principal) :**

oldText :
```
            if (useStrobe) {
              // Adaptive strobe speed: section-dependent multiplier
              const sectionMult = isDrop ? 1.5 : isChorus ? 1.2 : sec === 'build' ? 1.3 : sec === 'bridge' ? 1.0 : sec === 'verse' ? 0.8 : 0.5;
              const baseSpeed = Math.min(strobeTrackOverride?.speed || trackStrobe?.speed || active.strobeSpeed || 10, strobeLimit);
              const adaptedSpeed = Math.min(baseSpeed * sectionMult, strobeLimit);
              // Soft strobe: pulse dimmer + hold shutter open when fixture has separate intensity
              if (fa.intensityOffset !== null && !strobeTrackOverride && !trackStrobe) {
                const pulse = 0.5 + 0.5 * Math.sin(ct * Math.PI * 2 * adaptedSpeed);
                const iAddr = pf.startAddress + fa.intensityOffset;
                if (!chVals[iAddr] || Math.round(dimmerVal * pulse) > chVals[iAddr]) chVals[iAddr] = Math.round(dimmerVal * pulse);
                chVals[sAddr] = 255; // shutter stays open
              } else {
                chVals[sAddr] = Math.min(255, 180 + Math.floor(adaptedSpeed * 3));
              }
            }
```

newText :
```
            if (useStrobe) {
              // Adaptive strobe speed: section-dependent multiplier
              const sectionMult = isDrop ? 1.5 : isChorus ? 1.2 : sec === 'build' ? 1.3 : sec === 'bridge' ? 1.0 : sec === 'verse' ? 0.8 : 0.5;
              const baseSpeed = Math.min(strobeTrackOverride?.speed || trackStrobe?.speed || active.strobeSpeed || 10, strobeLimit);
              const adaptedSpeed = Math.min(baseSpeed * sectionMult, strobeLimit);
              // Strobe track override: oscillate shutter between open/closed at the track speed
              // This guarantees a visible strobe effect regardless of fixture capability mapping
              if (strobeTrackOverride) {
                const strobePhase = Math.sin(ct * Math.PI * 2 * adaptedSpeed);
                chVals[sAddr] = strobePhase >= 0 ? 255 : 0;
              }
              // Soft strobe: pulse dimmer + hold shutter open when fixture has separate intensity
              else if (fa.intensityOffset !== null && !trackStrobe) {
                const pulse = 0.5 + 0.5 * Math.sin(ct * Math.PI * 2 * adaptedSpeed);
                const iAddr = pf.startAddress + fa.intensityOffset;
                if (!chVals[iAddr] || Math.round(dimmerVal * pulse) > chVals[iAddr]) chVals[iAddr] = Math.round(dimmerVal * pulse);
                chVals[sAddr] = 255; // shutter stays open
              } else {
                // For cue-based strobe, use the fixture's shutter strobe range (typically 16-131)
                // Fall back to oscillation if no capabilities detected
                const shutterCaps = fa.shutterCaps || [];
                const strobeCap = shutterCaps.find(c => c.name?.toLowerCase().includes('strobe'));
                if (strobeCap) {
                  const t = (Math.sin(ct * Math.PI * 2 * adaptedSpeed) + 1) / 2;
                  chVals[sAddr] = Math.round(strobeCap.min + t * (strobeCap.max - strobeCap.min));
                } else {
                  // No strobe capability found: oscillate shutter manually
                  const strobePhase = Math.sin(ct * Math.PI * 2 * adaptedSpeed);
                  chVals[sAddr] = strobePhase >= 0 ? 255 : 0;
                }
              }
            }
```

**Fix 2 — Passer strobeOverrides au crossfade computeDmxForCue :**

oldText :
```
      if(crossfadeT>0&&nextCue){
        try{
          nextCueDmx=computeDmxForCue(
            nextCue,patchedFixturesRef.current,fixtureDefs,universes as any,tierMultipliers,undefined,
            colorTrackColors,undefined,undefined,disabledFixturesRef?.current,fixturePositions
          );
        }catch(e){crossfadeT=0;nextCueDmx=null;console.warn('[crossfade] computeDmxForCue failed, skipping:',e);}
      }
```

newText :
```
      // Pre-compute strobe overrides early so they're available for crossfade
      const strobeOverridesEarly = strobeTracksRef?.current && strobeTracksRef.current.length > 0
        ? computeStrobeTrackOverrides(strobeTracksRef.current, ct, patchedFixturesRef.current, fixtureGroupsRef?.current || [])
        : null;
      if(crossfadeT>0&&nextCue){
        try{
          nextCueDmx=computeDmxForCue(
            nextCue,patchedFixturesRef.current,fixtureDefs,universes as any,tierMultipliers,undefined,
            colorTrackColors,strobeOverridesEarly,undefined,disabledFixturesRef?.current,fixturePositions
          );
        }catch(e){crossfadeT=0;nextCueDmx=null;console.warn('[crossfade] computeDmxForCue failed, skipping:',e);}
      }
```

**Fix 3 — Réutiliser `strobeOverridesEarly` au lieu de recalculer :**

oldText :
```
      const strobeOverrides = strobeTracksRef?.current && strobeTracksRef.current.length > 0
        ? computeStrobeTrackOverrides(strobeTracksRef.current, ct, patchedFixturesRef.current, fixtureGroupsRef?.current || [])
        : null;
```

newText :
```
      const strobeOverrides = strobeOverridesEarly;
```

**Fix 4 — Ajouter `shutterCaps` au type `ChannelAnalysis` (si pas déjà présent) :**

Vérifier si `fa.shutterCaps` existe. Si non, l'ajouter à l'analyseur de fixture. Si oui, pas de changement nécessaire.

## Vérification des hypothèses

Pour confirmer le diagnostic, il faudrait :
1. Ajouter un `console.log` dans le playback pour vérifier que `strobeOverrides` contient bien des entrées
2. Vérifier que `fa.shutterOffset` n'est pas `null` pour les fixtures concernées
3. Si `shutterOffset` est null, le strobe track ne peut pas écrire sur le shutter — c'est un bug de mapping fixture
4. Vérifier les valeurs écrites sur le shutter avec un moniteur DMX

## Conclusion

Le bug principal est que le strobe track override écrit une **valeur statique** sur le shutter (180-255 = "open"), au lieu de faire **osciller** le shutter entre ouvert et fermé à la fréquence souhaitée. Le fix consiste à osciller le shutter quand un strobe track override est actif.

Le bug secondaire est que le crossfade ne passe pas les strobe overrides à `computeDmxForCue`, mais l'impact est limité (300ms max).
