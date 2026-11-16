# Relecture fix 2 — « aucune ligne rouge, mais aucun show joué en 3D »

Fichier principal : `src/hooks/dmx-playback.ts`
Fichier UI : `src/views/QuickShowView.tsx`
Fichier audio : `src/hooks/useAudioFileLoader.tsx`

---

## A) VÉRIFICATION DU FIX 1 — VERDICT : CORRECT

Ligne 512 : `if(!api && !dryRunRef.current)return;`

- **(i) Comportement d'origine préservé quand dry-run OFF** : quand `dryRunMode=false`, `dryRunRef.current=false` donc `!dryRunRef.current === true`. La condition devient `!api && true` ≡ `!api`. On return bien si `api` est null — identique à l'ancien `if(!api)return;`. ✅
- **(ii) Chemin dry-run passe bien** : quand `dryRunMode=true`, `!dryRunRef.current === false`, la condition est `false`, pas de return → le code continue vers le `console.warn` (L513) puis la boucle RAF (`const tick=()=>{}` L549, `requestAnimationFrame(tick)` L1154). ✅
- **(iii) Variables du `console.warn` (L513-520) réellement en scope** :
  - `dryRunRef` → défini L381
  - `dmxEnabledRef` → défini L380
  - `api` → défini L508 (const locale, juste au-dessus)
  - `cuesRef` → défini L379
  - `analysisRef` → défini L399
  - `universes` → paramètre déstructuré L377 (en scope)
  - `patchedFixtures` → paramètre déstructuré L377 (en scope)
  ✅ Toutes en scope, aucune référence non définie.

**Coupe matérielle en dry-run (tour précédent) — cohérente** :
- L383 : `dmxBridge.setDryRun(dryRunMode)` (sync du flag bridge)
- L384-392 : effet qui appelle `api.stop()` (L391) quand dry-run s'active
- 3 sites de démarrage guardés : L432 (`if(dryRunRef.current)return` dans l'effet de start au mount), L527 (`if(!engineStartedRef.current && !dryRunRef.current)`), L561 (`if(dryRunRef.current)return` dans le watchdog `_engineRecheck`)

---

## B) TRIGGER DE LECTURE — VERDICT : CAUSE LA PLUS PROBABLE CONFIRMÉE

Il existe bien un **vrai bouton PLAY** et un **upload audio** dans l'UI, pas seulement les helpers debug :
- `useAudioFileLoader.tsx` L248-250 : `<button onClick={isPlaying ? pause : play}>` (icône Play/Pause), plus SkipBack/SkipForward et barre de seek.
- Upload : input file + drag&drop (`handleFile`/`handleDrop`), et handler espace (L200-210).
- Helpers debug `__lm_loadAudioFile`/`__lm_triggerPlay` (QuickShowView L1717-1718) existent mais sont un chemin secondaire programmatique.

**Chaîne qui rend `isPlaying` vrai** :
1. `play()` (useAudioFileLoader.tsx L89-117) commence par `const buffer = state.audioBuffer; if (!buffer) return;` (L92-93) → **no-op sans buffer**.
2. `audioBuffer` n'est rempli que par `loadFile` → `decodeAudioData` (L47).
3. `loadFile` lance aussi `analyzeAudioBuffer` qui produit `analysis`.

**Deux verrous successifs dans `useDmxPlayback`** :
- **Verrou 1** — L458 : `if(!isPlaying){...return;}` → sans isPlaying, l'effet retourne **avant même de lancer la boucle RAF**. C'est le verrou dominant.
- **Verrou 2** — L554 : `if(!analysis||c.length===0){...return;}` → bail si cues vide.

**Et `cues` dépend de `sections`** :
- L2236-2238 : `const cues = useMemo(() => { if (sections.length === 0) return []; return genCues(...); })`.
- `sections` est un état local `useState([])` (L1595) qui n'est peuplé **qu'à partir de l'analyse audio** : L2342-2343 `if (resolvedAnalysis?.sections && sections.length === 0) setSections(mergeAdjacentSections(resolvedAnalysis.sections));` (ou auto-génération L2344-2394).

**Conclusion B** : sans upload audio → pas de `analysis` → pas de `sections` → `cues=[]` **ET** `isPlaying=false`. Le tick ne tourne même pas (verrou L458). C'est exactement cohérent avec le log collé par l'utilisateur : il n'y a **aucun** `[DMX-PLAYBACK] lecture démarrée` (émis L513 dès que `isPlaying` passe true), donc `isPlaying` n'est jamais devenu true.

→ **« pas d'audio → isPlaying=false → l'effet return avant la boucle RAF » est confirmé comme cause la plus probable.** Le bail `c.length===0` (L554, pas 537) est un second verrou qui intervient uniquement si `isPlaying` est déjà true mais que les sections/cues sont absents (ex. preset sans sections).

---

## C) MODES DE DÉFAILLANCE RÉSIDUELS (tick qui tourne sans jamais écrire `setUniverseData`/`onVirtualDmx`)

Écriture effective : L1129-1146 (`hasVals` → `sig` → `setUniverseData` L1139 + `dmxBridge.push` L1143 + `onVirtualDmx` L1144).

- **C1. `dmxOutputEnabled=false`** — L550 : `if(!dmxEnabledRef.current){...return;}`. Le tick tourne à vide, aucun write, donc **la 3D aussi meurt** (le miroir `onVirtualDmx` est en aval de ce guard). Toggle existant L3011 (icône Zap/ZapOff), défaut `true` (L1622). Si l'utilisateur a désactivé « DMX output », projecteurs présents mais noirs.
- **C2. Freeze activé avec `lastChannelsRef` vide** — L576-589 : si `frozenRef.current` est true (toggle L3028, état L1624) et qu'aucune frame n'a encore été calculée (`lastChannels.size===0`), la branche freeze ne pousse **rien**. De plus le chemin freeze ne passe **jamais** par `setUniverseData` direct (seulement `dmxBridge.push` + `onVirtualDmx`).
- **C3. Toutes les fixtures `disabled`** — L742 : `if (disabledFixturesRef?.current?.has(pf.id)) continue;`. Si les 8 fixtures sont désactivées, `chVals` reste vide → `hasVals=false` (L1129-1131) → aucun write. Silencieux.
- **C4. Pas de cue active à `currentTime`** — L616 (`let active=null`), L623-636 (`if(!active)` → écrit des zéros), L638-652 (`ct > dernière cue + 1s` → blackout). Si `ct < cues[0].time` (seek avant le début) ou après la fin, on écrit du noir — pas « aucun show » mais noir complet.
- **C5. Exception non interceptée dans le corps du tick** — seuls le crossfade (L681 `try/catch`) et le chaser takeover (L1092-1107 `try/catch`) sont protégés. Le cœur du loop (boucle fixtures L742-1080, switch de mouvement, `hexToRgb`, `computeColorTrackColors` L599, `computeEfxOverrides`) n'est pas wrappé : un throw tue le RAF loop (L1151 jamais atteint) → gel silencieux. Non détecté ici car l'utilisateur ne rapporte aucune ligne d'erreur.
- **C6. Mismatch d'index d'univers** — le `uniIdx` écrit (clé de `analysis.byUniverse`, = `uniIds.indexOf(pf.universeId)` sinon 0, L403-404) doit correspondre à ce que lit la scène 3D. Si la Stage3D lit un autre index que celui du moteur, les valeurs sont écrites dans le mauvais univers → 3D vide malgré un show calculé. (Candidat à vérifier côté lecture Stage3D.)
- **C7. Stabilité de `sig`** — L1133-1136 : `if(sig!==lastSig){...}`. Pour un cue purement statique, `sig` se stabilise après la 1ʳᵉ frame → les writes s'arrêtent (mais la frame statique reste affichée, donc pas un « no show »). Note mineure : `lastSig` est partagé entre univers (déclaré une fois L522) mais seedé par `uniIdx` donc pas de collision. Autre note : le throttle 30 fps (L1137-1139) ne gate que le `setUniverseData` direct ; `onVirtualDmx` (L1144) est appelé à chaque changement → le throttle est contourné pour la 3D (sans conséquence fonctionnelle).

---

## VERDICT GLOBAL :

Le fix 1 est **correct** (garde d'origine préservée hors dry-run, chemin dry-run débloqué, variables du diagnostic toutes en scope) ; le symptôme s'explique à plus de 90 % par **l'absence d'audio/play** (`isPlaying=false` → return L458 avant la boucle RAF, cohérent avec l'absence du warn `[DMX-PLAYBACK] lecture démarrée` dans le log), et il reste 7 modes de défaillance résiduels à surveiller (C1 DMX output coupé, C2 freeze précoce, C3 fixtures toutes disabled, C4 hors-plage temporelle, C5 exception non wrappée, C6 mismatch d'univers, C7 sig statique).
