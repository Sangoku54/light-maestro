# plan.md — Tonio 6 arm : stroboscope permanent

## Demande utilisateur
« j'ai une fixture tonio 6 arm qui est toujours avec un stromboscope, peux tu rectifier ça »

## Contexte technique (diagnostic mainline S1 — faits vérifiés)
- Définition : `resources/fixtures/custom/custom-tonio-6-arm.json` (mode 22ch). Canal 11 « Strobe », type **Effect**, SANS `defaultValue`, SANS `capabilities`.
- Analyse (vérifiée par test vitest) : `effectOffset=10`, `shutterOffset=null`, `rgbOffsets=[11,12,13]`, `intensityOffset=9`, `panOffsets=[0]`, `tiltOffsets=[2..8]` (7 tilt), `laserColorGateOffset=19`, `presetOverrideOffsets=[]`.
- Le canal Strobe n'est JAMAIS écrit (0 partout) : computeDmxCues (test : ch11=0 sur verse/build/drop/chorus/outro), computeDmxForCue (aucun usage d'effectOffset), auto-loops (exige effectCaps>0), engine electron (merge partiel), Stage3D (shutterOffset null).
- **Piège de classification** : si le canal Strobe est typé `Shutter` (format QLC+ standard), `shutterOffset` est détecté et les blocs shutter écrivent **SHUTTER_OPEN_SAFE = 255** en permanence (dmx-cues L836/L1033, dmx-playback L1006 « shutter ALWAYS open ») → sur un canal Strobe (plage 8-255 = strobe), **255 = strobe ultra-rapide PERMANENT**. 672 .qxf de la bibliothèque ont un canal « Strobe » → bug général.
- Le simulate strobe (dmx-playback, « No dedicated shutter channel ») oscille le DIMMER de la Tonio en drop/chorus (design, mais aggrave la perception).

## Décisions d'audit intégrées (SA-1 + SA-2 reçus, SA-3 en cours)
- **Regex variante C** (SA-1, mesurée : 138 fixtures corrigées, 0 régression) : `STROBE_NAME_RE = /\bstrobe\b/i` + exclusion `STROBE_EXCLUDE_RE = /shutter|dimmer|function|multifunctional|pattern|speed|frequency|duration|density|intensity/i` (préserve les ~97 composites « Shutter / Strobe » = vrais shutters de movers).
- Insertion dans la boucle : entre L313 (collecte couleur) et L320 (routing laser) — après la couleur (0 régression RGB), avant le switch (jamais shutter/effect).
- **Consumer « strobe-safe » obligatoire** (SA-1 R2) : le safety net écrit 128 (= pulse/strobe sur les canaux Strobe QLC+) → écrire la cap `shutterEffect: "Open"` (capMid) si présente, sinon 0. La Tonio (isLaser=true via canaux Red/Green laser) → safety net 0 → OK si 0 = off.
- **dmx-helpers.ts L123-141 (« Allumer »)** à corriger (analyse par type → 255) — échappe à la classification seule.
- **laser-exploit.test.ts L101** à mettre à jour (DS-1000 « Strobe Effect » : shutterOffset null / strobeOffset 2 — c'est une correction : 255 = strobe permanent latent).
- SA-2 : blocs à modifier — dmx-cues L824-839 (+ safety net L1013-1018, min-DMX L1027-1036), dmx-playback L908-957 (factoriser décision) + L959 (simulate exclu) + L1465-1483 (crossfade computeDmxForCue, obligatoire) + L813 (extinction), Stage3D L1572-1592, auto-loops (baselines strobeOffset→0, optionnel car OK par construction), définition custom defaultValue:0.
- Valeurs : strobeRate 160-220 OK pour strobeOffset ; live `8 + speed*20` borné 8-250 ; JAMAIS 255 ; JAMAIS mapping intensity→shutter sur strobeOffset.

## Hypothèse de fix (à valider par les subagents)
1. **fixture-analyzer.ts** : nouveau champ `strobeOffset` — classifier les canaux dont le nom matche `/\bstrobe\b/i` (quel que soit le type Effect/Shutter) → `strobeOffset` (prioritaire sur shutterOffset/effectOffset par nom, comme les autres checks par nom).
2. **dmx-cues.ts / dmx-playback.ts** : blocs shutter — si `strobeOffset` : écrire 0 quand PAS de strobe (pas 255 !), écrire la valeur de strobe quand strobe demandé. Exclure les fixtures avec `strobeOffset` du simulate strobe (dimmer) pour éviter le double strobe.
3. **Stage3D.tsx** : même logique shutter pour la 3D (strobeOffset → 0 par défaut).
4. **Définition custom** : ajouter `defaultValue: 0` au canal Strobe (sécurité).

## Axes subagents (S3)
- SA-1 (vérificateur analyseur) : auditer la classification par nom dans fixture-analyzer.ts — ordre des checks, conflits possibles (COLOUR_AUX_RE contient `strobe` ! laser color gate, blank, pattern), impact sur les fixtures laser (tests laser-exploit), cas fixtures avec shutter ET strobe séparés. Sortie : subagent_01.md.
- SA-2 (auditeur blocs shutter) : auditer les 3 blocs d'écriture shutter (dmx-cues L824-840, dmx-playback L930-1010, Stage3D L1572-1600) — intégration de strobeOffset sans casser les vrais shutters (255=open), le strobe matériel (strobeRate), le mapping intensity→shutter, le simulate strobe. Sortie : subagent_02.md.
- SA-3 (auditeur tests/régressions) : lister les tests susceptibles de casser (laser-exploit, auto-loops, scene-fixtures, app-store), les fixtures OFL concernées, les cas limites (canal nommé « Strobe » dans COLOUR_AUX_RE, fixtures RGB avec Strobe). Sortie : subagent_03.md.

## Dépendances
SA-1 → SA-2 → fix mainline → revue adverse (SA-4) → tsc+vitest → livraison (pas de build exe : pas d'accord).

## Livrables
- Fix code (fixture-analyzer.ts, dmx-cues.ts, dmx-playback.ts, Stage3D.tsx, custom-tonio-6-arm.json)
- Test de régression (diag-tonio transformé en test stable : strobeOffset détecté, valeur 0 par défaut)
- review.md + livraison DELIVERY/tonio-strobe/
