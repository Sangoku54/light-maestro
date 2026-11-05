# Diagnostic — Moteur de lecture des cues (useDmxPlayback + vue pilote)

Sous-agent A (lecture seule, aucun fichier modifié hors ce rapport).

## 1. Verdict

**BUG NON TROUVÉ dans le moteur de lecture lui-même.** Le moteur `useDmxPlayback`
(`src/hooks/dmx-playback.ts`) avance correctement le temps `ct`, sélectionne
correctement le cue actif, et émet bien `cue.color` (avec le même hue-shift par tier
que l'affichage). Le symptôme « toujours la même couleur » **n'est pas produit par ce
fichier** : la couleur émise change bien d'un cue à l'autre quand la timeline tourne.

Le « toujours la même couleur » s'explique ailleurs — très probablement par le conflit
de sources LTP décrit par le sous-agent B (une source `vc`/`simple-desk`/`fixture-test`,
priorité LTP 80-100, tient les canaux RGB et écrase `quickshow` HTP 40). Le moteur A
écrit correctement sur `quickshow`, mais l'arbitre (`output-arbiter.ts`) donne la priorité
à toute source LTP, ce qui masque sa sortie.

Point important de cadrage : **`computeDmxForCue` n'est PAS la fonction qui émet la
couleur en lecture temps réel.** Il n'est utilisé que pour (1) le crossfade vers le cue
suivant et (2) l'aperçu statique DMX. La couleur live sort de la **boucle inline** du
`tick()` (lignes ~745-786), qui lit elle aussi `active.color` correctement.

## 2. Flux complet de lecture (numéros de ligne)

### 2.1 Déclenchement (vue pilote : QuickShowView)
- Le bouton play de la barre `AudioFileUpload` appelle `audioFile.play()` /
  `audioFile.pause()` (`useAudioFileLoader.tsx:110-111` met `isPlaying: true` et arme
  la boucle `updateTime`).
- `QuickShowView` (rendu par `App.tsx:414` avec `audioFile={audioFile}` où
  `App.tsx:143` fait `const audioFile = useAudioFileLoader()`) reçoit `isPlaying` et
  `currentTime` à chaque render.

### 2.2 Horloge (`ct`)
- `QuickShowView.tsx:2250-2251` :
  `const currentTimeRef = useRef(audioFile.currentTime); currentTimeRef.current = audioFile.currentTime;`
- `audioFile.currentTime` avance via la boucle `updateTime` de `useAudioFileLoader.play()`
  (`useAudioFileLoader.tsx:104-111`) : `setState({...currentTime: min(pos, buffer.duration)})`
  à chaque `requestAnimationFrame`. Ce `setState` force un re-render de `App` → de
  `QuickShowView` → la ligne 2251 rafraîchit le ref chaque frame.
- Côté hook : `dmx-playback.ts:525` `const ct = currentTimeRef.current;` est relu à
  chaque frame du RAF.

### 2.3 Boucle RAF du moteur
- Effet monté sur `[isPlaying]` (`dmx-playback.ts` ~440-528) ; démarre
  `requestAnimationFrame(tick)`.
- Gardes en tête de tick :
  - `dmx-playback.ts:524` `if(!dmxEnabledRef.current){...; return;}` (si DMX désactivé,
    boucle tourne sans rien pousser).
  - `dmx-playback.ts:528` `if(!analysis||c.length===0){...; return;}` (si pas de fixtures
    analysées ou pas de cues, rien).

### 2.4 Sélection du cue actif
- `dmx-playback.ts:588-589` :
  `let active = null; for(const cue of c){if(cue.time<=ct && (!active || cue.time>active.time)) active=cue;}`
  → cue le plus récent dont `time <= ct`. Correct.
- `nextCue` (pour crossfade) : `dmx-playback.ts:632-636` → premier cue `time > ct`. Correct.

### 2.5 Couleur live (boucle inline, PAS computeDmxForCue)
- `dmx-playback.ts:745-778` : `paletteColor` =
  1. `colorTrackColors.get(pf.id)` si un bloc de piste couleur est actif (priorité max),
  2. sinon bloc couleur de fixture-track,
  3. sinon `active.forcedColor || active.color || active.colors[0]` (ligne 776).
- `dmx-playback.ts:782-786` : `hexToRgb(paletteColor)` puis, si pas couleur de piste,
  `applyHueShift([r,g,b], TIER_HUE[pf.tier])`.
- `dmx-playback.ts:811-813` : écriture RGB par segment, avec lissage EMA (`fadeState`
  créé une fois par session de lecture, `dmx-playback.ts:522`).

### 2.6 Émission DMX
- `dmx-playback.ts:1107` : `dmxBridge.push(uniIdx, chVals, arbSource)`.
- `arbSource` : `dmx-playback.ts:377` `const arbSource = arbiterSource ?? 'quickshow';`
  → `push` (`dmx-bridge.ts:105`) → `write('quickshow', …)` (`dmx-bridge.ts:65-66`).
- `dmxBridge.push` n'utilise PAS `dispatchChannelsByFixture` (fonction morte pour ce
  chemin) : la boucle pousse directement par `uniIdx` issu de `analysis.byUniverse`.

### 2.7 Affichage timeline (même couleur, même hue-shift)
- `TrackTimeline.tsx:2195` : `const sc = hueShiftHex(cue.color, tierDeg);`
  (`hueShiftHex` défini `TrackTimeline.tsx:29`, `TIER_HUE_DEG` `TrackTimeline.tsx:59`).
- Même algorithme HSL et mêmes degrés que `applyHueShift`/`TIER_HUE`
  (`dmx-color.ts:13`, `:36`). → affichage et lecture sont cohérents.

## 3. Hypothèses tranchées

### (a) Production/incrément de `ct` — peut-il rester bloqué ?
**Avance correctement dans le cas nominal, avec un couplage fragile.**
- `ct` = `audioFile.currentTime`, horloge `AudioContext` pilotée par la boucle
  `updateTime` (`useAudioFileLoader.tsx:104-111`) qui fait un `setState` à chaque frame.
- Le ref `currentTimeRef` n'est rafraîchi **que pendant un render React**
  (`QuickShowView.tsx:2251`) ; il avance parce que `useAudioFileLoader` re-render `App`
  à chaque frame. **Couplage fragile** : si un jour `currentTime` était alimenté sans
  re-render (listener natif, etc.), `ct` gèlerait. Mais ce n'est pas le bug actuel.
- Cas limite réel : `useAudioFileLoader.play()` retourne immédiatement si `audioBuffer`
  est null (`useAudioFileLoader.tsx:93` `if (!buffer) return;`), donc `isPlaying` reste
  false et le moteur ne démarre pas du tout (pas de « même couleur », mais pas de sortie).
- `SongPresetPlayer` (autre consommateur du hook) est robuste : horloge murale de repli
  (`SongPresetPlayer.tsx:31-40` + RAF `:206-210`). Non concerné ici.
→ **Verdict : pas de blocage de `ct` dans la lecture QuickShow nominale.**

### (b) Sélection du cue actif — correcte ?
**Correcte.** `dmx-playback.ts:588-589` prend le cue le plus récent `time <= ct`, sans
regroupement par section. Les cues sont triés/dédupliqués par `genCues`
(`QuickShowView.tsx:795-803` : `sort` + dédup à 0.01 s près). Aucun off-by-one
(`<=` inclut l'égalité, ce qui est le bon choix).
→ **Verdict : correct.**

### (c) Source DMX utilisée et sa priorité ?
- Source : `'quickshow'` (`dmx-playback.ts:377`), car `QuickShowView` n'appelle PAS
  `useDmxPlayback` avec `arbiterSource` (l'appel `QuickShowView.tsx:2252-…` omet ce champ).
- Priorité : `output-arbiter.ts:45` `'quickshow': { mode: 'htp', priority: 40 }`.
- Conséquence directe : toute source LTP de priorité > 40 (`simple-desk` 100,
  `fixture-test` 90, `vc` 80, `design-*` 70/60, `default` 50, MIDI/OSC/MTC 70-75)
  écrase `quickshow` sur les canaux qu'elle détient (`output-arbiter.ts` `getBuffer`).
  `song-preset` (HTP 45) peut aussi gagner en HTP (max par canal).
→ **Verdict : priorité HTP 40, structurellement subordonnée aux LTP — c'est le vecteur
  du bug « couleur figée » (voir B), pas une erreur du moteur A.**

### (d) `computeDmxForCue` reçoit-il bien `cue.color` de chaque cue ?
**Oui.** `dmx-playback.ts:1206` :
`return (cue as any).forcedColor || cue.color || cue.colors?.[0] || undefined;`
puis `applyHueShift([r,g,b], TIER_HUE[pf.tier])` (`dmx-playback.ts:1213`), skip du
hue-shift pour les couleurs de piste utilisateur (`:1211-1213`). Identique à la boucle
inline live (`:776`, `:786`). `genCues` fournit bien `color: prevColor` (couleur de
palette distincte par cue) et `colors: sectionPal` (`QuickShowView.tsx:735-741`).
→ **Verdict : correct.** (Rappel : `computeDmxForCue` n'est pas le chemin live ; il sert
  au crossfade `:643` et à l'aperçu `QuickShowView.tsx:2215`.)

## 4. Cause racine + localisation (ce que le moteur A ne peut pas contourner)

Le moteur de lecture est sain. La couleur « toujours la même » provient de l'arbitre de
sortie, pas du calcul de couleur :

- **`output-arbiter.ts:45`** : `quickshow` = HTP 40.
- **`output-arbiter.ts:38,40,41`** : `vc` LTP 80, `fixture-test` LTP 90, `simple-desk` LTP 100.
- **`output-arbiter.ts` `getBuffer`** : les LTP triés par priorité décroissante
  « prennent » leurs canaux en premier ; `quickshow` ne remplit que les canaux restants.
- Sources LTP écrites de façon persistante sans release (cf. rapport B) :
  `AutoLoopsPanel.tsx:30` (`write('vc')`), `performStore.ts:285/301/340`
  (`write('simple-desk')`), `PerformanceView.tsx:2147` (`writeMerge('vc')`), etc.
  → pendant la lecture timeline, leurs valeurs RGB fixes masquent les couleurs des blocs.

### Divergences secondaires repérées dans le chemin A (à noter, non-bloquantes ici)
1. **A/B compare** : `QuickShowView.tsx:2255` passe
   `cues: (showB && cuesB.length > 0 ? cuesB : cues)` au playback, alors que la timeline
   affiche toujours `cues={cues}` (style A) à `QuickShowView.tsx:3286`. Si `showB` est
   actif, la sortie joue les couleurs B pendant que l'écran affiche les blocs A →
   « couleurs jouées ≠ blocs » sans aucun conflit LTP. Cas rare (bouton A/B) mais réel.
2. **Couplage `currentTimeRef` ↔ render React** (`QuickShowView.tsx:2250-2251`) : fragile
   par construction (voir 3a). À sécuriser à terme en alimentant le ref via un RAF dédié
   plutôt que via le render.

A_DONE
