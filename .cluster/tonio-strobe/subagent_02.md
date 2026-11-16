# subagent_02.md — Auditeur blocs shutter : intégration de `strobeOffset`

**Mission** : auditer les 3 blocs d'écriture shutter (dmx-cues.ts, dmx-playback.ts, Stage3D.tsx) et proposer l'intégration EXACTE du nouveau champ `strobeOffset`. Aucune implémentation — audit + propositions uniquement.

---

## VERDICT

Le fix `strobeOffset` (détection par nom `/\bstrobe\b/i` + écriture 0 par défaut) est **nécessaire, correct et suffisant** pour les 3 blocs audités, **à condition** que la détection soit faite **par nom et AVANT le switch générique** dans `analyzeFixtureChannels` (fixture-analyzer.ts L377+). Sinon le fix rate le cas de la fixture Tonio custom (canal « Strobe » typé **Effect**, pas Shutter).

**Découverte d'audit importante** : le bug a **3 chemins**, pas 1 (voir §2). Le chemin décrit dans le plan (typé Shutter → 255 permanent) est le pire, mais la fixture custom du repo (`custom-tonio-6-arm.json`, canal 11 « Strobe » type **Effect**) passe par un autre chemin (effectOffset → jamais écrit proprement → safety net). La détection par nom + bloc dédié couvre les deux.

Numéros de ligne réels vérifiés (diffèrent du plan pour dmx-playback : le bloc shutter live est L908-957, pas L930-1010) :

| Bloc | Fichier | Lignes réelles |
|---|---|---|
| 1. Shutter computeDmxCues | `src/hooks/dmx-cues.ts` | L824-839 |
| 2a. Shutter tick live | `src/hooks/dmx-playback.ts` | L908-957 |
| 2b. Simulate strobe (dimmer) | `src/hooks/dmx-playback.ts` | L958-984 |
| 2c. Shutter computeDmxForCue (snapshot/crossfade) | `src/hooks/dmx-playback.ts` | L1465-1483 |
| 3. Shutter 3D | `src/views/Stage3D.tsx` | L1572-1592 |

---

## 1. Contexte vérifié

### 1.1 Analyse — fixture-analyzer.ts (source unique)

`fixture-analyzer.ts` est la **source unique** d'analyse (les 3 consommateurs passent par `analyzeFixtureChannels` ; `dmx-channel.ts` n'est plus importé par personne — simple doublon legacy, lignes restantes = commentaires). Switch L377-449 :

```ts
// L387-390
      case 'Shutter':
      case 'Strobe':
        if (fa.shutterOffset === null) fa.shutterOffset = off;
        break;
// L391-402
      case 'Effect': {
        const hasCaps = (ch.capabilities?.length ?? 0) > 0;
        if (fa.effectOffset === null) {
          fa.effectOffset = off;
          fa.effectCaps = ch.capabilities ?? null;
        } else if ((fa.effectCaps?.length ?? 0) === 0 && hasCaps) {
          fa.effectOffset = off;
          fa.effectCaps = ch.capabilities;
        }
        break;
      }
```

Interface : `shutterOffset` déclaré L51 (section « Shutter / Effect »).

### 1.2 Fixture Tonio custom — canal réel

`resources/fixtures/custom/custom-tonio-6-arm.json` (mode 22ch), vérifié par parse node :

```
10: name="Dimmer" type=Intensity dv=0 caps=0
11: name="Strobe" type=Effect dv=undefined caps=0   ← LE canal incriminé
22: name="Macro fonction" type=Macro dv=0 caps=4
```

Le canal 11 est typé **Effect** (pas Shutter) → aujourd'hui il devient `effectOffset` (fixture-analyzer L391-402), **pas** `shutterOffset`. Une fixture QLC+ importée (`.qxf`) type le même canal en **Shutter** → `shutterOffset`. Les deux variantes existent.

---

## 2. Les 3 chemins du bug (tous couverts par le fix proposé)

| Chemin | Condition | Aujourd'hui | Résultat |
|---|---|---|---|
| A | Canal « Strobe » typé **Shutter** (QLC+) | `shutterOffset` → dmx-cues L836 `channelValues[shutterAddr] = SHUTTER_OPEN_SAFE;` (=255, L454) | **Strobe ultra-rapide PERMANENT** |
| B | Canal « Strobe » typé **Effect** sans caps (Tonio custom) | `effectOffset` → bloc 2c dmx-cues L815-818 écrit `8 + (cueIndex%24)*10` (jamais 0) si pas de RGB ; sinon jamais écrit → safety net L1011-1020 écrit **128** (non-laser) | **Strobe PERMANENT** (128 = strobe moyen sur plage 8-255) |
| C | Live tick (dmx-playback) | fixture avec `shutterOffset` → L957 `else{chVals[sAddr]=255;}` | Strobe max permanent en live |

Le plan S1 indique que sur la fixture custom, le canal est « jamais écrit (0 partout) » en cue précalculé — le safety net 128 que je déduis de L1011-1020 est à confirmer par SA-3 (le dump du test lit peut-être le buffer univers après merge à 0). Dans les deux lectures (0 ou 128), le fix écrit explicitement 0 → problème réglé.

---

## 3. Intégration EXACTE proposée

### 3.0 Prérequis — analyse (`src/engine/fixture-analyzer.ts`)

**a) Ajouter le champ** après `shutterOffset` (interface `FixtureChannelAnalysis`, ~L51) :

```ts
  // Shutter / Effect
  shutterOffset: number | null;
  /** Canal « Strobe » dédié (type Shutter OU Effect selon l'OFL/QLC+) :
   *  détecté par NOM. 0 = pas de strobe, valeurs hautes = strobe.
   *  N'est PAS un shutter : ne contrôle pas la luminosité, jamais 255 par défaut. */
  strobeOffset: number | null;
```

Init dans le constructeur (`fa` initial, ~L219) : `strobeOffset: null,`

**b) Détection par nom, AVANT le switch** (insérer entre la fin du routing laser `if (isLaser) { ... }` et `switch (ch.type)` — vers L376) :

```ts
    // ── Strobe (nommé) : intercepté avant le switch — un canal « Strobe »
    // (typé Shutter OU Effect selon l'OFL/QLC+) est un canal de STROBE, pas un
    // shutter. Sinon les blocs shutter écrivent SHUTTER_OPEN_SAFE=255 en
    // permanence (strobe max) et le canal Effect sans caps reçoit 8-238/128.
    if (/\bstrobe\b/i.test(chName) && fa.strobeOffset === null) {
      fa.strobeOffset = off;
      continue;
    }
```

Position : **après** le bloc couleur (`hasColorCaps` / colourChannels) pour ne pas voler un éventuel canal « Strobe » porteur de caps couleur (rarissime, trade-off assumé — cf. cas limites), et **après** le routing laser (un laser n'a pas de canal nommé « strobe » matchant un pattern laser). Le `continue` garantit qu'il n'atterrit **jamais** dans `shutterOffset` ni `effectOffset`, quel que soit le type.

**c) Aligner le switch** (garde-fou si le `continue` ci-dessus n'est pas retenu) — sinon au minimum :

```ts
      case 'Shutter':
      case 'Strobe':
        if (/\bstrobe\b/i.test(chName)) {
          if (fa.strobeOffset === null) fa.strobeOffset = off;
        } else if (fa.shutterOffset === null) fa.shutterOffset = off;
        break;
```

**d) dmx-channel.ts L33** (doublon legacy, plus importé) : même traitement `case'Shutter':case'Effect':` → router les noms `strobe` vers strobeOffset, par cohérence documentaire.

### 3.1 Bloc 1 — `src/hooks/dmx-cues.ts` L824-839 (computeDmxCues)

Contexte : `enableStrobe`/`strobeRate` calculés L604-605 ; `SHUTTER_OPEN_SAFE = 255` L454 ; `shouldTierStrobe` L512. Remplacer le bloc existant par :

```ts
        // Always set the shutter when available: open when not strobing (DMX 8-15 = shutter open),
        // otherwise fixture stays dark even with dimmer > 0 because shutter defaults to 0 (closed).
        // For fixtures lacking a dedicated Intensity channel, use the shutter channel
        // to also control brightness (common on budget moving heads / spiders).
        if (fa.shutterOffset !== null) {
          const shutterAddr = pf.startAddress + fa.shutterOffset;
          if (enableStrobe && shouldTierStrobe(pf.tier)) {
            channelValues[shutterAddr] = strobeRate;
          } else if (fa.intensityOffset === null && computedIntensity > 0) {
            // No dedicated dimmer → map intensity to shutter range (8 = open min, 255 = open max)
            // Linear mapping: intensity 0-255 → shutter 8-255
            const shutterVal = 8 + Math.round((computedIntensity / 255) * 247);
            channelValues[shutterAddr] = Math.max(8, Math.min(255, shutterVal));
          } else {
            // SoundSwitch principle: shutter ALWAYS open, never dark.
            // 32 = safe open on all fixtures (avoids 0-15 ambiguous range).
            channelValues[shutterAddr] = SHUTTER_OPEN_SAFE;
          }
        }

        // Canal Strobe dédié (strobeOffset) : PAS un shutter — il ne contrôle
        // PAS la luminosité (pas de mapping intensity→shutter ici).
        // 0 = pas de strobe (jamais SHUTTER_OPEN_SAFE=255 : sur un canal
        // Strobe, 255 = strobe max PERMANENT).
        if (fa.strobeOffset !== null) {
          const strobeAddr = pf.startAddress + fa.strobeOffset;
          channelValues[strobeAddr] = (enableStrobe && shouldTierStrobe(pf.tier))
            ? strobeRate
            : 0;
        }
```

Points clés :
- **Le bloc shutter reste 100% inchangé** pour les vrais shutters (255 open, mapping intensity→shutter).
- Le bloc strobe écrit **toujours** la clé → le safety net (L1011-1020) et le min-DMX (L1027-1036) ne peuvent plus y mettre 128/255.
- Mapping intensity→shutter **exclu** de strobeOffset (un canal strobe ne contrôle pas la luminosité) — cf. cas limite 4.2.

### 3.2 Bloc 2a — `src/hooks/dmx-playback.ts` L908-957 (tick live)

La décision strobe (track/override/useStrobe/speed) est aujourd'hui calculée **dans** le bloc `if(fa.shutterOffset!==null)` (L909-938). Pour la réutiliser dans le bloc strobeOffset sans duplication, **factoriser la décision avant les deux blocs** (remplacer L908 `if(fa.shutterOffset!==null){const sAddr=...` par) :

```ts
          // Strobe decision (partagée shutter + canal strobe dédié)
          const strobeTrackOverride = strobeOverrides ? (strobeOverrides.get(pf.id) || null) : null;
          const trackStrobe = (() => { /* IIFE inchangé L911-928 */ })();
          const useStrobe = strobeTrackOverride
            ? strobeTrackOverride.active
            : trackStrobe
            ? trackStrobe.active
            : forcedStrobe !== undefined ? forcedStrobe : ((isDrop || isChorus || sec === 'build') && active.strobe && pf.tier === 'primary');
          const strobeSpeed = Math.min(strobeTrackOverride?.speed || trackStrobe?.speed || active.strobeSpeed || 10, strobeLimit);

          // Shutter (inchangé, utilise useStrobe/strobeSpeed ci-dessus)
          if (fa.shutterOffset !== null) {
            const sAddr = pf.startAddress + fa.shutterOffset;
            if (useStrobe) {
              // ... L935-954 inchangé (sectionMult, oscillation 255/0, soft strobe dimmer)
            }
            else if (fa.intensityOffset === null) { chVals[sAddr] = Math.max(8, Math.min(255, 8 + Math.round((dimmerVal / 255) * 247))); }
            else { chVals[sAddr] = 255; }
          }

          // Canal Strobe dédié : 0 = off, sinon valeur de strobe constante
          // (le canal génère le clignotement lui-même — pas d'oscillation 255/0
          // qui produirait un double effet sur un canal Strobe).
          if (fa.strobeOffset !== null) {
            const stAddr = pf.startAddress + fa.strobeOffset;
            chVals[stAddr] = useStrobe
              ? Math.min(250, Math.max(8, Math.round(8 + strobeSpeed * 20)))
              : 0;
          }
```

Notes :
- Si on refuse la factorisation (minimalisme), la variante chirurgicale : dupliquer la décision dans un second bloc `if (fa.strobeOffset !== null)` — acceptable mais plus de code dupliqué ; la factorisation est recommandée car les deux blocs partagent exactement la même sémantique.
- L'oscillation 255/0 (L940-954) **ne s'applique qu'au shutter** — sur un canal Strobe, la valeur constante (`8 + speed*20`, bornée à 250) donne un strobe régulier à la vitesse du track. Jamais 255 (strobe max permanent).
- `Math.min(250, ...)` : garde contre 255.

### 3.3 Bloc 2b — `src/hooks/dmx-playback.ts` L958-984 (simulate strobe)

Une seule ligne à changer — exclure les fixtures à canal strobe dédié (sinon double strobe : dimmer oscillé + canal strobe) :

```ts
          // No dedicated shutter channel: simulate strobe by oscillating dimmer/intensity
          if (fa.shutterOffset === null && fa.strobeOffset === null) {   // ← L959
```

### 3.4 Bloc 2c — `src/hooks/dmx-playback.ts` L1465-1483 (computeDmxForCue, snapshot/crossfade)

**Non listé dans la mission mais obligatoire** : le snapshot crossfade (appelé L706-710 pendant le crossfade live) écrit `chVals[sAddr] = 255` (L1481) sur les fixtures à shutter. Sans traitement, une fixture à `strobeOffset` aurait son canal Strobe à 255 pendant chaque crossfade. Ajouter après le bloc shutter existant :

```ts
      if (fa.strobeOffset !== null) {
        const stAddr = pf.startAddress + fa.strobeOffset;
        const strobeTrackStrobe = strobeTrackOverrides?.get(pf.id);
        const trackStrobe = fixtureTrackOverrides?.forcedStrobes?.get(pf.id);
        const useStrobe = strobeTrackStrobe
          ? strobeTrackStrobe.active
          : trackStrobe
          ? trackStrobe.active
          : (cue as any).forcedStrobe !== undefined ? (cue as any).forcedStrobe : ((isDrop || isChorus) && cue.strobe && pf.tier === 'primary');
        if (useStrobe) {
          const speed = Math.min(strobeTrackStrobe?.speed || trackStrobe?.speed || (cue as any).strobeSpeed || 10, 10);
          chVals[stAddr] = Math.min(250, Math.max(8, Math.round(8 + speed * 20)));
        } else {
          chVals[stAddr] = 0;
        }
      }
```

### 3.5 Bonus — autres écritures shutter à aligner

| Fichier | Ligne | Code actuel | À faire |
|---|---|---|---|
| dmx-cues.ts | L1016-1017 | safety net : `channelValues[addr] = fa.isLaser ? 0 : 128;` | ajouter `if (fa.strobeOffset === c) continue;` avant (le bloc 3.1 écrit déjà la clé, garde de robustesse) |
| dmx-cues.ts | L1027-1036 | min-DMX : `else if (fa.shutterOffset !== null) → SHUTTER_OPEN_SAFE` | ajouter `else if (fa.strobeOffset !== null) → 0` (cas « aucun canal écrit », quasi impossible avec strobeOffset, par complétude) |
| dmx-playback.ts | L813 | extinction hors tiers : `if (fa.shutterOffset !== null) chVals[...] = 0;` | ajouter `if (fa.strobeOffset !== null) chVals[pf.startAddress + fa.strobeOffset] = 0;` (déjà cohérent : éteint = strobe off) |
| auto-loops.ts | L249, 291, 351, 383, 418, 456, 492, 526, 548 | `if (analysis.shutterOffset !== null) put(frame, absAddr(pf, analysis.shutterOffset), 255);` | après le fix, le canal strobe n'est plus `shutterOffset` → non touché (OK par construction). Pour être propre : ajouter `if (analysis.strobeOffset !== null) put(frame, absAddr(pf, analysis.strobeOffset), 0);` à côté de chaque `put` shutter |
| auto-loops.ts | L820, L1082 | `const shutters = fixtures.filter(f => f.analysis.shutterOffset !== null)` | une fixture strobe-only ne doit plus être classée « shutter » (flash loop) — comportement correct après le fix, à vérifier par SA-3 |

### 3.6 Bloc 3 — `src/views/Stage3D.tsx` L1572-1592

Contexte : `cm = f3d.channelMap` (L1550) = `FixtureChannelAnalysis` (L224, construit via `analyzeFixtureChannels` L1302). Le bloc actuel :

```ts
      // --- Shutter / Strobe ---
      let strobeHz = 0;
      let shutterClosed = false;
      if (cm.shutterOffset !== null && cm.shutterOffset >= 0) {
        const shutterVal = data[baseAddr + cm.shutterOffset] ?? 255;
        // DMX shutter ranges: 0-31=closed, 32-63=open, 64-95=strobe slow, 96-127=strobe fast
        // 128-179=strobe speed legacy, 180-254=DMX strobe speed (180+speed*3), 255=open (not strobe)
        if (shutterVal <= 31) {
          shutterClosed = true;
          intensity = 0;
        } else if (shutterVal >= 180 && shutterVal < 255) {
          strobeHz = Math.max(1, (shutterVal - 180) / 3);
        } else if (shutterVal >= 32 && shutterVal <= 63) {
          // Open — leave intensity as-is
        } else if (shutterVal >= 64 && shutterVal <= 179) {
          strobeHz = Math.max(1, (shutterVal - 64) / 6);
        }
      }
```

Intégration — **bloc séparé**, jamais de `shutterClosed`/blackout sur strobeOffset (0 = off, pas « closed ») :

```ts
      // --- Shutter / Strobe ---
      let strobeHz = 0;
      let shutterClosed = false;
      if (cm.shutterOffset !== null && cm.shutterOffset >= 0) {
        const shutterVal = data[baseAddr + cm.shutterOffset] ?? 255;
        // ... inchangé (L1578-1591) ...
      }

      // Canal Strobe dédié (strobeOffset) : 0 = pas de strobe, valeurs hautes
      // = strobe (mêmes formules DMX que le shutter). Ne ferme JAMAIS la
      // lumière (strobeOff à 0 = off, pas « closed »).
      if (cm.strobeOffset !== null && cm.strobeOffset >= 0) {
        const strobeVal = data[baseAddr + cm.strobeOffset] ?? 0;
        if (strobeVal >= 180 && strobeVal < 255) {
          strobeHz = Math.max(1, (strobeVal - 180) / 3);       // DMX strobe speed
        } else if (strobeVal >= 64 && strobeVal <= 179) {
          strobeHz = Math.max(1, (strobeVal - 64) / 6);        // strobe standard
        } else if (strobeVal >= 8 && strobeVal < 64) {
          strobeHz = Math.max(1, (strobeVal - 8) / 14);        // plage basse (bee-eye : 8+ = strobe)
        }
      }
```

Le blink existant (L1598-1601 `if (strobeHz > 0)`) s'applique ensuite naturellement. Note : `data[...] ?? 0` au lieu de `?? 255` — un canal Strobe non écrit doit être lu comme off.

---

## 4. Vérification demandée : `strobeRate` sur un canal Strobe

Fait vérifié :
- `getStrobeRate` (dmx-cues.ts L310-314) : `DEFAULT_STROBE_RATE = [160, 220]` (L313), chorus `[180, 200]`, drop `[200, 255]` (L309-311), probabilité 0.5 → médiane.
- Plage d'un canal Strobe bee-eye/Tonio : **8-255 = strobe, vitesse croissante** (confirmé par le plan S1 et le commentaire du test diag-tonio).

**Cohérence : OUI.** `strobeRate` 160-220 tombe dans le haut de la plage strobe (rapide mais PAS max). C'est exactement la même valeur déjà écrite sur `shutterOffset` (dmx-cues L827) — donc aucun conflit entre les deux moteurs (cues précalculés + live) sur le même canal.

Recommandations :
1. **Garder `strobeRate` tel quel pour `strobeOffset`** (cohérence avec L827). Pas de nouvelle constante.
2. Optionnel (décision produit, pas bug) : clamp `Math.min(250, strobeRate)` pour ne jamais atteindre 255 sur un drop (strobe max). Si on le fait, l'appliquer **aussi** à L827 pour rester cohérent.
3. En live (dmx-playback), la vitesse track (Hz) est convertie en valeur DMX : `Math.round(8 + speed * 20)` → speed 1-10 → 28-208, bornée 8-250. Plage cohérente avec un canal Strobe.
4. Ne **jamais** utiliser SHUTTER_OPEN_SAFE (255) ni la valeur « open » (32-63) sur `strobeOffset` — sur un canal Strobe ces plages sont du strobe.

---

## 5. Cas limites

### 5.1 Fixture avec shutter ET strobe séparés (moving head moderne)
Les deux blocs s'exécutent sur des adresses différentes : shutter = open 255 / mapping intensity / strobe matériel ; strobe = 0 / rate. Le « soft strobe » live (L944-949 : pulse dimmer + shutter 255) ne touche pas le canal strobe. **Pas de conflit.** Le seul point d'attention : le strobe live sera généré par le canal Strobe (valeur constante) pendant que le shutter reste ouvert — comportement attendu.

### 5.2 Fixture sans dimmer (budget moving head / spider)
Le mapping intensity→shutter (dmx-cues L828-832, playback L956/L1478-1479) continue de s'appliquer au **shutter uniquement**. Le bloc strobeOffset écrit 0/rate **indépendamment** du dimmer — un canal Strobe ne contrôle PAS la luminosité. C'est le point du task confirmé : « ne pas appliquer le mapping intensity→shutter à strobeOffset ». Le code proposé au §3.1 respecte cela (pas de branche `intensityOffset === null` dans le bloc strobe).

### 5.3 Canal « Strobe » typé Effect (Tonio custom, cas réel)
Avec la détection §3.0b : le canal 11 ne tombe plus dans `effectOffset` (case 'Effect' L391) ni dans le bloc 2c (dmx-cues L815-818, qui écrirait 8-238) ni dans le safety net (128). Il reçoit **0** par le bloc §3.1 → **strobe off par défaut**. En drop/chorus avec strobe → `strobeRate`. ✓

### 5.4 Canal « Strobe » typé Shutter (QLC+ importé — chemin A du bug)
Même chose : intercepté par nom avant le switch → plus jamais `shutterOffset` → plus de 255 permanent. **C'est le fix principal du bug utilisateur.** ✓

### 5.5 Lasers avec canal « Strobe »
- `isLaserColorNamed` exclut déjà les noms contenant « strobe » via `COLOUR_AUX_RE` (L16 : `/rotation|rolling|move|movement|speed|scan|strobe|effect|macro/i`) → un canal « Red Strobe » d'un laser ne devient pas une couleur.
- Avec la détection par nom, il devient `strobeOffset` → écrit 0 (off). Mieux que 128 (strobe autonome sur un laser). À valider avec les tests laser-exploit (SA-3).
- Le routing laser (L322-368) est traversé avant la détection ; aucun pattern laser ne matche « strobe » → pas de vol.

### 5.6 Canal « Strobe » avec capabilities couleur (`color: true`)
Rarissime : il serait avalé par le test couleur (`hasColorCaps`, L314) avant la détection par nom (positionnée après). Trade-off assumé : priorité à la détection RGB/roue. Si on veut le couvrir, placer la détection strobeOffset AVANT le test couleur — mais alors un éventuel « Colour Strobe » porteur de caps couleur perdrait sa couleur. **Recommandation : laisser tel quel** (cas inexistant dans les 672 .qxf vérifiés par S1, à reconfirmer par SA-1).

### 5.7 Fixture sans shutter ni strobe
`fa.shutterOffset === null && fa.strobeOffset === null` → simulate strobe dimmer inchangé (L958-984). ✓

### 5.8 Extinction hors tiers actifs (dmx-playback L808-816)
Le bloc éteint (dimmer 0 + shutter 0). Ajouter strobe 0 (§3.5) : une fixture éteinte ne doit pas strober. ✓

---

## 6. Recommandations finales

1. **Ordre d'implémentation** : fixture-analyzer.ts (§3.0) → dmx-cues.ts (§3.1) → dmx-playback.ts (§3.2/3.3/3.4) → Stage3D.tsx (§3.6) → bonus §3.5 → définition custom (ajouter `defaultValue: 0` au canal Strobe, prévu au plan).
2. **Ne pas toucher au bloc shutter existant** (L824-839 / L908-957) autrement que par l'ajout du bloc strobe séparé et la factorisation de la décision — le comportement des vrais shutters (255 open, mapping intensity, oscillation) est le résultat de réglages validés (« SoundSwitch principle »).
3. **Cohérence cross-moteur** : même plage de valeurs sur `strobeOffset` partout (0 / 8-250). Ne pas mélanger 255 (shutter) et valeurs strobe sur le même canal.
4. **Tests à ajouter** (SA-3) : (a) fixture « Strobe » typée Shutter → strobeOffset détecté, valeur 0 hors strobe ; (b) Tonio custom → ch11=0 hors strobe, strobeRate en drop ; (c) fixture shutter+strobe → les deux canaux écrits indépendamment ; (d) simulate strobe exclu quand strobeOffset présent.
5. **définition custom** : `defaultValue: 0` sur le canal Strobe (sécurité supplémentaire, indépendante du code) — déjà au plan.

---

## 7. Synthèse des lignes à modifier (checklist implémenteur)

| Fichier | Ligne(s) | Action |
|---|---|---|
| src/engine/fixture-analyzer.ts | ~L51, ~L219, ~L376 | champ + init + détection par nom (continue) |
| src/engine/fixture-analyzer.ts | L387-390 | garde-fou case Shutter/Strobe |
| src/engine/dmx-channel.ts | L33 | cohérence documentaire (doublon legacy) |
| src/hooks/dmx-cues.ts | L824-839 | ajouter bloc strobeOffset après le bloc shutter |
| src/hooks/dmx-cues.ts | L1013-1018 | exclure strobeOffset du safety net 128 |
| src/hooks/dmx-cues.ts | L1027-1036 | min-DMX : strobeOffset → 0 |
| src/hooks/dmx-playback.ts | L908-957 | factoriser décision + bloc strobeOffset (0/rate) |
| src/hooks/dmx-playback.ts | L959 | `&& fa.strobeOffset === null` |
| src/hooks/dmx-playback.ts | L1465-1483 | bloc strobeOffset (computeDmxForCue) |
| src/hooks/dmx-playback.ts | L813 | extinction : strobe → 0 |
| src/views/Stage3D.tsx | L1572-1592 | bloc strobeOffset 3D (jamais shutterClosed) |
| src/engine/auto-loops.ts | L249, 291, 351, 383, 418, 456, 492, 526, 548 | strobeOffset → 0 (optionnel, OK par construction) |
| resources/fixtures/custom/custom-tonio-6-arm.json | canal 11 | `defaultValue: 0` (sécurité) |
