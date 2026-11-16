# Revue adverse — Fix « Tonio 6 arm strobe permanent »

**Date :** 2026-08-27 — **Réviseur :** subagent adverse (revue seule, aucun fichier source modifié)
**Périmètre analysé :** `fixture-analyzer.ts`, `dmx-cues.ts`, `dmx-playback.ts`, `Stage3D.tsx`, `dmx-helpers.ts`, `custom-tonio-6-arm.json`, `tonio-strobe.test.ts`, `laser-exploit.test.ts`, suppression `diag-tonio.test.ts` (confirmée : fichier absent du working tree, non tracké → suppression effective).

> Note de périmètre : le working tree contient **bien plus** que ce fix (auto-loops, lasers, spatial choreo, DesignView, dry-run…). Ce rapport ne juge que le fix strobe et signale les interactions.

---

## VERDICT GLOBAL : APPROUVÉ SOUS RÉSERVES

Le cœur du fix (canal Strobe dédié `strobeOffset`, off ≠ 255, moteur cues + playback + 3D + helper) est **correct, cohérent et testé** sur son périmètre direct (Tonio 6 arm + canaux « Strobe » simples, y compris typés Shutter à l'import). `tsc --noEmit` OK, **306 tests / 26 fichiers passent** (dont 35 sur tonio-strobe + laser-exploit).

**Une régression annexe est introduite** (dmx-helpers « Allumer » sur les composites « Shutter / Strobe », ~106 fixtures de la lib OFL) → à corriger avant merge. **Deux trous réels de la lib restent non couverts** (non régressés, documentés §7). Rien de bloquant pour le cas Tonio lui-même.

---

## 1. Analyseur — `src/engine/fixture-analyzer.ts` ✅

| Point demandé | Vérification |
|---|---|
| Regex nom + exclusions | L25 `STROBE_NAME_RE = /\bstrobe\b/i` ; L26 `STROBE_EXCLUDE_RE = /shutter\|dimmer\|function\|multifunctional\|pattern\|speed\|frequency\|duration\|density\|intensity/i` ; L29-35 `isStrobeNamedChannel` avec garde caps `firstCap.min === 0 && /closed\|dark\|blackout/` → return false. Conforme. |
| Check par nom AVANT le switch | L351-353 : `if (isStrobeNamedChannel(ch) && fa.strobeOffset === null)` → `strobeOffset = off`, `strobeCaps = ch.capabilities`. Avant le switch et avant le routing laser. ✅ |
| Garde-fou switch Shutter/Strobe même helper | L430-431 : `case 'Shutter': case 'Strobe':` → `isStrobeNamedChannel(ch)` → strobeOffset, sinon shutterOffset. MÊME helper → cohérence. ✅ |
| Composite « Shutter / Strobe » jamais strobeOffset | Exclu par « shutter » dans la regex → false → `shutterOffset`. Vérifié par test T2 (L53-57) et mesuré : 106 fixtures composites → shutterOffset. ✅ |

Observation : la branche **couleur est AVANT le check strobe** (L322-337) → un canal nommé « Strobe » typé Colour ou porteur de caps `color` n'est JAMAIS strobeOffset (rare, voir §7). La garde « 0=Closed » ne se déclenche **sur aucune fixture de la lib OFL réelle** (mesuré : 0/619) — c'est un filet pour imports QLC+ (couvert par T2).

## 2. `dmx-cues.ts` (génération de cues) ✅

- **L462-472 `strobeOffValue`** : cap `open|no function|no.?effect|neutral|steady` → capMid ; sinon 1ʳᵉ cap `min===0 && max<64` → capMid ; sinon 0. **Jamais 255** — vérifié par analyse exhaustive des branches. Cas réel DS-1000 (`NoFunction 0-0` en 1ʳᵉ cap) → retombe sur `max<64` → 0. ✅
- **L836-847 bloc strobeOffset** : `(enableStrobe && shouldTierStrobe(pf.tier)) ? strobeRate : strobeOffValue(fa.strobeCaps)`. `strobeRate` (L621) = 160-255 → 255 seulement **quand le strobe est demandé** (drop, prob=1) : comportement voulu. ✅
- **Safety net** : L1042 `if (fa.strobeOffset === c) continue;` → plus de 128 sur le canal strobe. ✅
- **Min-DMX** : L1062-1063 `else if (fa.strobeOffset !== null) … = 0`. ✅
- **Bloc shutter existant INTACT** : le diff ne touche pas le bloc shutter (L848-870 : strobeRate quand strobe, 255 open sinon, mapping intensity→shutter si pas de dimmer). ✅

## 3. `dmx-playback.ts` (tick live + crossfade) ✅

- **Décision strobe factorisée** : L909-934 — `strobeTrackOverride` / `trackStrobe` / `useStrobe` / `strobeSpeed` calculés une fois, partagés par le bloc shutter (L936-958) et le bloc strobeOffset. ✅
- **Bloc strobeOffset live** : L963-968 — `useStrobe ? Math.min(250, Math.max(8, Math.round(8 + strobeSpeed*20))) : 0`. **Jamais 255, valeur constante** (le canal génère le clignotement lui-même ; pas d'oscillation 255/0). ✅
- **Simulate strobe (dimmer) exclu** : L970 `if (fa.shutterOffset === null && fa.strobeOffset === null)` → le dimmer n'oscille plus quand strobeOffset existe. ✅
- **Extinction hors tiers** : L809-818 (`activeTiers`) → 0 sur intensity + shutter + **strobeOffset** + gates laser. ✅
- **computeDmxForCue (crossfade)** : bloc propre L1498-1512 avec variables suffixées (`strobeTrackStrobe2`/`trackStrobe2`/`useStrobe2`/`speed2`/`stAddr2`) → **aucun conflit** avec le bloc shutter de la même fonction (L1478-1495, intact : `16 + speed*11` clampé 131, mapping dimmer, 255). ✅
- Pas de variable dupliquée en conflit (`baseSpeed` supprimé au profit de `strobeSpeed` ; `baseSpeedNS` reste dans la portée du bloc simulate — disjoint). ✅

## 4. `Stage3D.tsx` (3D) ✅

- **L1596-1604** : bloc strobeOffset 3D — 3 branches (180-250 → Hz=(v-180)/3 ; 64-179 → (v-64)/6 ; 8-63 → (v-8)/14), seuils identiques au bloc shutter 3D (L1584-1591). `strobeVal = 0` → aucune branche → `strobeHz` inchangé (0 = off). **Ne touche jamais `shutterClosed`** (L1574/1580) : la lumière n'est jamais fermée par ce bloc. ✅
- Défaut `?? 0` vs shutter `?? 255` : cohérent avec les deux moteurs. ✅
- Mineur : si `computeDmxCues` écrit **exactement 255** sur strobeOffset (drop, prob=1 → `strobeRate`=255), aucune branche 3D ne matche → pas de strobe visuel en 3D (l'intensité reste correcte). Cosmétique, pas de régression.

## 5. `dmx-helpers.ts` (« Allumer ») ⚠️ RÉGRESSION ANNEXE

- **L137-139** : `else if (ch.type === 'Shutter' && !/\bstrobe\b/i.test(chName) && shutterOffset === null)` → un canal nommé « Strobe » pur n'est plus ouvert à 255. Objectif atteint. ✅
- **MAIS la regex est plus large que l'analyseur** : elle exclut par `/\bstrobe\b/` seul, **sans les exclusions de l'analyseur**. Un composite « Shutter / Strobe » (typé Shutter, caps avec 224-255 = Open) est donc exclu du `shutterOffset` → le canal reste à **0** au bouton « Allumer » → **lumière fermée** (0-31 = Closed) alors que l'analyseur (L430-431) le traite comme shutter → le moteur l'ouvre à 255. **Incohérence détecteur/moteur, régression réelle** : mesurée sur la lib OFL, ~**106 fixtures** ont un canal composite « Shutter / Strobe » / « Strobe Functions » typé Shutter qui n'est plus ouvert par « Allumer » (avant le fix : 255).
- Recommandation : réutiliser la logique complète de `isStrobeNamedChannel` (exporter le helper ou dupliquer les exclusions + garde caps) — un canal composite « Shutter / Strobe » DOIT être ouvert, un « Strobe » pur ne DOIT PAS.

## 6. Tests ✅ (avec un manque)

- **tonio-strobe.test.ts** (121 lignes) : T1 (analyse Tonio : strobeOffset=10, shutter/effect null, tilt multi-bras), T2 (classification : composite→shutter, « Strobe Speed »→ni l'un ni l'autre, « Strobe » [Shutter]→strobeOffset, garde Closed→shutter), T3 (cues : verse→0 sur le strobe + dimmer actif ; drop→8..255), T5 (computeDmxForCue : 0 hors strobe, 8-250 en drop, **dimmer non oscillé**). Couvre l'essentiel du fix. **T4 manquant** (numérotation T1→T2→T3→T5) : ni le tick live (`useDmxPlayback`, hook non testé), ni la 3D, ni le helper « Allumer », ni le safety net/min-DMX ne sont testés.
- **laser-exploit.test.ts L101-106 (DS-1000)** : canal « Strobe Effect » [Shutter] caps `[NoFunction 0-0, ShutterStrobe 1-255]` → `strobeOffset=2`, `shutterOffset null`. **Justifié** : le nom + la cap off en 1ʳᵉ position en font un vrai canal de strobe ; le fixer en shutter = 255 = strobe max permanent.
- **Faux positifs potentiels** : `auto-loops.test.ts` « strobe-rgb » (L59-60) utilise un canal **nommé « Shutter »** → shutterOffset → le test ne couvre PAS le cas « canal nommé Strobe » → il passe sans exercer le fix. Aucun test existant ne couvre les fixtures à strobeOffset dans le chemin loops (`auto-loops.ts` / `autoloop-runtime.ts` ne référencent jamais `strobeOffset` — voir §7).
- Suite complète : **306 tests / 26 fichiers verts** ; `tsc --noEmit` sans erreur.

## 7. Risques résiduels (mesurés sur la lib OFL réelle, 619 fixtures, mode le plus long)

| Cas | Mesure | Traitement par le fix |
|---|---|---|
| Canaux « Strobe » simples (tous types) | 271/405 fixtures captées `strobeOffset` | ✅ correct (off = cap off ou 0, jamais 255) |
| Composites « Shutter / Strobe » [Shutter] | 106 fixtures → `shutterOffset` | ✅ 255 = Open dans leurs caps (sections 224-255) ; comportement voulu, testé T2 |
| « Strobe Functions » / « Strobe Multifunctional » [Shutter] | ~7 fixtures Cameo (Auro Spot 100/200/300/400, Q-Spot 40 RGBW, TS 200 FC, ROOT PAR 6) → `shutterOffset` → **255 = strobe max permanent** | ❌ non couvert, **non régressé** (avant : pareil). L'exclusion « function » route vers shutter au lieu de strobe |
| « Strobe Speed » [Shutter] (Audibax Boston 60) | → `shutterOffset` → 255 = vitesse max | ❌ non couvert, non régressé (typage OFL anormal) |
| « Strobe / Speed / Sensitivity » & co [Nothing] (modes réduits de pars) | **28 fixtures** → aucun offset → safety net **128 = strobe permanent** | ❌ non couvert, **non régressé** (avant : pareil). C'est le cas le plus proche du bug Tonio qui reste ouvert |
| « Strobe Frequency » [Shutter] (Chroma-Q Color Force II 12/48/72) | → `shutterOffset` → 255 = fréquence max | ❌ non couvert, non régressé. Idem « Strobe Red/Green/Blue [Colour] » → roue couleur |
| « Strobe 16bit » / « Strobe 16bit fine » [Nothing] (10 canaux) | `\bstrobe\b` matche, « fine » non exclu → **si le Fine précède le coarse**, le Fine prend `strobeOffset` et le coarse n'est pas écrit (0 = off : pas de strobe permanent, mais strobe demandé inopérant) | ⚠️ dépend de l'ordre des canaux ; pas de régression (off=0) |
| Chemins loops (`auto-loops.ts` L249-548 : 10× `shutterOffset → 255` ; `autoloop-runtime.ts` L83) | ne connaissent pas `strobeOffset` | ⚠️ **manque fonctionnel hors périmètre** : le loop « strobe » ne stroboscope pas le Tonio (canal jamais écrit → 0). Pas de régression (le 255 ne s'applique qu'aux vrais shutters) |
| `dmx-channel.ts` (ancien analyseur) | plus importé nulle part | ✅ mort, aucun risque |

## Recommandations (par priorité)

1. **Corriger la régression dmx-helpers** : « Allumer » doit ouvrir les composites « Shutter / Strobe » (exclusions alignées sur l'analyseur) et ne fermer que les « Strobe » purs. → export `isStrobeNamedChannel` ou duplication des exclusions.
2. **Couvrir « Strobe Functions/Multifunctional » [Shutter] et les composites [Nothing]** (28 fixtures) : soit les traiter comme `strobeOffset` (off = cap off), soit au minimum les exempter du safety net 128 (0 au lieu de 128 — neutre sur un canal dont 0 = NoFunction).
3. **Ajouter T4** (numérotation) : test 3D + helper « Allumer » + safety net (pas de 128 sur strobeOffset) + min-DMX.
4. **Hors périmètre à documenter** : `auto-loops.ts` / `autoloop-runtime.ts` ne pilotent pas le strobe des fixtures à `strobeOffset` (le Tonio ne strobe pas en mode loops).

## Traces d'audit

Scripts jetables dans `.openclaw/tmp/` : `strobe-lib-audit.cjs`, `strobe-lib-audit2.cjs`, `strobe-gdtf-audit.cjs`, `strobe-lib-audit.test.ts`, `strobe-lib-audit3.test.ts`, `strobe-lib-audit4.test.ts`, `strobe-lib-audit5(b).test.ts`, `strobe-lib-audit6.test.ts` (résultats cités dans le rapport).

---

## Résolution de la régression + validation finale (main agent)

- **Régression dmx-helpers corrigée** : la revue a trouvé que ma regex simple excluait aussi les composites « Shutter / Strobe » (~106 fixtures) → « Allumer » les laissait fermées. Fix : même logique que l'analyseur (isPureStrobe = nom strobe ET pas d'exclusion composite). Vérifié : tsc 0 renderer + electron, vitest 312/312.
- **Trous documentés (hors périmètre, non régressés)** : ~28 fixtures « Strobe / Speed / Sensitivity » [Nothing] → safety net 128 = pulse (pré-existant) ; ~7 fixtures « Strobe Functions » [Shutter] → 255 (pré-existant). Backlog.
- **Commit** : 7aa3242 (8 fichiers). ⚠ Le working copy de fixture-analyzer/dmx-cues/dmx-playback contenait du travail non commité des turns précédents (laser routing, multi-pan-tilt, presetOverrideOffsets…) — embarqué dans le commit (mélange assumé, à signaler à l'utilisateur).
