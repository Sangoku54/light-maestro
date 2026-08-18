# Subagent 02 — Revue progression temporelle

**VERDICT : temps croissants OK (le show progresse)**

La progression temporelle des cues est saine. Le bug « même show joué sur toutes
les boucles » n'est **pas** causé par des temps de cue statiques, identiques ou
non-croissants. Les temps sont strictement croissants, distincts, et le nombre de
cues est largement suffisant pour un show qui bouge.

---

## 1. Source de `cue.time` (secondes cumulées ?)

Oui — `cue.time` est une position en secondes dans la boucle, produite par une
somme cumulée de battements, dans `buildLoop`
(`src/engine/ambiance-loops.ts`).

Lignes exactes (ambiance-loops.ts) :

```ts
const measureSec = (60 / bpm) * BEATS_PER_MEASURE;   // (60/bpm) * 4
const duration = MEASURES_PER_LOOP * measureSec;     // 16 * measureSec
const interval = (60 / bpm) * (4 / beatDivision);    // beatDivision=4 → 60/bpm (1 battement)
```

Puis la génération des cues :

```ts
let cueIndex = 0;
for (let time = 0; time < duration - interval * 0.5; time += interval) {
  ...
  cues.push({
    time: Math.round(time * 1000) / 1000,   // arrondi au millième de seconde
    ...
  });
  cueIndex++;
}
```

`time` démarre à 0 et augmente de `interval` (1 battement) à chaque itération.
C'est donc bien des **secondes cumulées monotones**.

## 2. Deux cues peuvent-ils partager le même `cue.time` ?

Non, en pratique impossible ici.

- `interval = 60/bpm`. Avec `bpm` borné à `[40, 240]` (`Math.max(40, Math.min(240, ...))`
  dans `generateAmbianceLoops` / `regenerateLoopAtBpm`), l'intervalle minimal est
  `60/240 = 0.25 s` (250 ms).
- L'arrondi `Math.round(time * 1000) / 1000` quantifie à **1 ms**.
- 250 ms ≫ 1 ms ⇒ deux cues consécutifs ne peuvent jamais retomber sur la même
  valeur arrondie. Les `time` sont donc **strictement croissants et tous distincts**.

La clé de dédup côté lecture (`AutoLoopsPanel.tsx:284`) est
`` `${cue.time.toFixed(2)}-${cue.universe}` `` — quantification à 10 ms.
250 ms ≫ 10 ms ⇒ **aucune collision de clé** non plus. Le dedup ne fait sauter
aucun cue.

## 3. Temps croissants sur la durée de la boucle ?

Oui.

- Premier cue : `time = 0`.
- Dernier cue : `time` ≈ `duration - interval` (la boucle s'arrête quand
  `time >= duration - interval*0.5`).
- `duration = 16 * measureSec` = 16 × 4 battements = 64 battements.
- Nombre de cues : **64 cues** par boucle (16 mesures × `beatDivision`=4).
  Dernier `time` ≈ 63 battements < `duration` (64 battements). ✓

La lecture dans `fire()` (`AutoLoopsPanel.tsx:275-291`) boucle
`elapsed` de 0 → `loop.duration`, tire chaque cue quand `elapsed >= cue.time`,
puis reboucle en réinitialisant `fired` et `passStartRef` à `duration`. Les temps
croissants ⇒ les cues se déclenchent bien séquentiellement, sur toute la boucle.

## 4. Nombre de cues générés (assez pour un show qui bouge ?)

Oui, largement.

- `beatDivision` par défaut = 4 ⇒ **64 cues** logiques par boucle.
- Chaque cue logique est éclaté par `computeDmxCues` en **un `DmxCue` par
  universe** (`dmx-cues.ts`, `dmxCues.push({ time: cue.time, ... })` dans la boucle
  `for (const [universe, fixtureList] of fixturesByUniverse)`). En mono-universe :
  64 cues DMX.
- Les valeurs DMX **varient** d'un cue à l'autre : `computeMovement` dépend de
  `cue.time` (`basePhase = time * config.speed * 2 * Math.PI`), le pulse dimmer
  dépend de `cue.time`, le gobo/prism/effect aussi. Même en section « static » le
  mouvement dérive lentement (speed 0.05).

`cue.time` est transmis **tel quel** au cue DMX : `computeDmxCues` fait
`time: cue.time` (`dmx-cues.ts`), donc `DmxCue.time === AmbianceCue.time`, toujours
croissant.

---

## Conclusion

- Temps strictement croissants et distincts : **OUI**.
- Pas de cue partageant le même `cue.time` : **confirmé** (intervalle ≥ 250 ms).
- Pas de collision avec le dedup `toFixed(2)` : **confirmé** (quantif. 10 ms).
- Nombre de cues suffisant (64/boucle, 1+ par universe) : **confirmé**.

Le show **progresse** dans le temps. Le symptôme « même show sur toutes les
boucles » doit donc être cherché ailleurs que dans la progression temporelle
(par ex. : sélection de boucle / clé d'identité des loops, cache de `dmxCues`,
ou comparaison palette/seed — cf. les autres subagents).
