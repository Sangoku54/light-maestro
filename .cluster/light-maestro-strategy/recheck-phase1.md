# Re-check Phase 1 — Corrections (re-vérification indépendante)

Date : 2026-08-14 · Relecteur : subagent indépendant (depth 1)
Diff vérifié : `git diff backup-pre-phase1-20260814` (17 fichiers, +686/−203) + 5 nouveaux fichiers non suivis.

---

## VERDICT FINAL : **NON LIVRABLE** (1 nouveau P1 de la classe P0 + 1 P2 + 1 P3)

Les 9 corrections demandées sont **toutes présentes et correctes** dans le code réel (tableau ci-dessous), et la non-régression est verte (tsc ×2 = 0, 44/44 tests, build OK). **Mais** la re-vérification a trouvé **deux chemins de zéros persistants non couverts** (`handleTest` du SceneEditor et `stopPlayback` du ChaserEditor) qui réintroduisent exactement le bug P0 que la Phase 1 devait éliminer, plus un pin de valeurs de scène persistant. Le fix est trivial (2 paramètres `transientMs`), mais tant qu'il n'est pas appliqué, le scénario « éditer une scène en design → jouer le show en performance » laisse des canaux **noirs en permanence**. Détail en [Nouveaux problèmes](#nouveaux-probl%C3%A8mes).

---

## Tableau correction par correction

| # | Correction | Verdict | Preuve (fichier:ligne) |
|---|-----------|---------|------------------------|
| 1 | **P0 — zéros LTP transitoires** | ✅ | `vcZeroAllUniverses` → `dmxBridge.writeTransient('vc', uniNum, z)` : performanceview.tsx:61 ; `sdResetAll` → `writeTransient('simple-desk', …)` : performstore.ts:305 ; blackout design → `sendChannelsToHardwareAndStore(zeros, …, 'design-test', 2000)` : designview.tsx:496 ; bridge : `writeTransient` exposé dmx-bridge.ts:86-98, `release()` re-flush dmx-bridge.ts:127-137 |
| 2 | **P1-1 — latence branchée** | ✅ | `recordOutputTick()` juste avant `flushToHardware` : dmx-bridge.ts:74 ; `recordAudioTick()` au début du tick moteur : dmx-playback.ts:528 ; **0 occurrence restante** de `setChannel(s)` hors bridge (seul dmx-bridge.ts:57, le funnel unique) ; flag `audioTickPending` consommé par `recordOutputTick` (latency-meter.ts:47-53) |
| 3 | **P1-2 — merge sACN × GM** | ✅ | engine.ts:566 : `scaled[i] = Math.round(finalData[i] * gm)` — le GM s'applique sur le buffer fusionné (local + sACN), plus sur `data[i]` |
| 4 | **P1-3 — Simple Desk multi-faders** | ✅ | performstore.ts:268 : `dmxBridge.write('simple-desk', universeNum, uniValues)` — l'état complet (merge fait côté store, `{…(sdChannelValues[sdUniverseId]||{}), [ch]: v}`) |
| 5 | **P1-4 — fixture test** | ✅ | `setDmxChannel` → `writeMerge('fixture-test', universeIndex, {[address]: value})` : usefixturetest.ts:96 ; bridge expose `writeMerge` (dmx-bridge.ts:110-121, spread des valeurs précédentes de la source) ; fin de test : boucle zéros sur **tous** les canaux de la fixture (usefixturetest.ts:170-176) puis `stopTest` → `release('fixture-test')` (ligne 103) → fixture éteinte puis contrôle rendu ✅ ; merge étape-sur-étape = **comportement voulu** (le dimmer reste allumé pendant pan/tilt ; le step reset + la boucle finale remettent tout à 0) |
| 6 | **P1-5 — unmount EFX** | ✅ | designview.tsx:2970 : `dmxBridge.writeTransient('design-efx', uniNum, vals)` — plus de re-pin permanent (release()+write() supprimés) |
| 7 | **P2-1 — filtre d'activité sACN** | ✅ | sacn-receiver.ts `recomputeMerged` : exclusion `now - lastSeenAt > timeoutMs` dans le calcul de `maxPriority` **et** dans la boucle de merge (une source morte n'écrase pas une source vivante) ; `getMergedFrame` → `null` si aucune source active (pas d'injection de données périmées) |
| 8 | **P2-2 — slider VC** | ✅ | performanceview.tsx:1936 : `dmxBridge.writeMerge('vc', 1, {[config.channelAddress]: clamped})` ; univers 1 en dur = bug préexistant, **documenté en commentaire** (ligne 1933-1935), non bloquant |
| 9 | **P2-3 — sendFixtureOff** | ✅ | dmx-helpers.ts:218 : `sendChannelsToHardware(zeros, …, 'fixture-onoff', 2000)` ; signature étendue `transientMs?` sur `sendChannelsToHardware` (l.68-77) et `sendChannelsToHardwareAndStore` (l.170-177) |

### Cohérence interne du bridge (point 2 de la méthode)
- `write()` **annule** le transient en attente de la même source : dmx-bridge.ts:69 (`cancelTransient` dans `write` et `writeTransient` ligne 92) → l'opérateur qui re-déclenche le VC dans la fenêtre de 2 s n'est pas libéré par surprise. ✅
- `release()` re-flush les univers affectés : recompute + push cache/listeners + `recordOutputTick` + `flushToHardware` (dmx-bridge.ts:127-137). ✅
- Pas de fuite de timer : un seul timer par source (Map `transientTimers`), cancel avant re-set, auto-suppression à l'expiration. ✅
- L'arbitre est pur (sans dépendance window/Electron) et couvert par 10 tests unitaires. ✅

### Non-régression (point 3 de la méthode) — résultats réels
- `npx tsc --noEmit` → **0 erreur** ✅
- `npx tsc -p tsconfig.electron.json --noEmit` → **0 erreur** ✅
- `npx vitest run` → **5 fichiers, 44/44 tests verts** ✅ (dont 10 nouveaux output-arbiter + 8 nouveaux latency-meter)
- `npm run build` → **OK** (1478 modules, 5.04 s) ✅

### Effets de bord scrutés (point 4 de la méthode)
- **Blackout design transitoire (2 s)** : trou assumé — le moteur reprend après 2 s. Acceptable par le cahier des charges, mais cf. réserve R1 (2 s, c'est long pour un live).
- **writeMerge fixture-test** : ne re-pinne pas de canaux d'étapes précédentes au changement d'étape — c'est le merge voulu (test séquentiel avec dimmer maintenu). Le reset et la fin de test remettent tout à 0 puis libèrent la source.

---

## Nouveaux problèmes

### NP1 — P1 (haute, même classe que le P0) : zéros persistants via `design-test` hors périmètre
Deux chemins écrivent des zéros **persistants** (LTP) sans `transientMs` ; avant l'arbitrage, la frame suivante du moteur (last-writer-wins) les écrasait ; maintenant le moteur (HTP prio 40) est **bloqué indéfiniment** par `design-test` (LTP prio 60) :

- **designview.tsx:584** — `handleTest` (aperçu de scène 3 s) : à la fin du test, `sendChannelsToHardwareAndStore(zeros, …)` sans sourceId ni transient → pinne des zéros sur tous les canaux de la scène testée.
- **designview.tsx:1398** — `stopPlayback` (ChaserEditor) : `sendChannelsToHardware(zeros, …, 'design-test')` sans transient → pinne des zéros sur les canaux du chaser.

**Impact** : scénario banal « éditer/tester une scène ou un chaser en design → jouer le show en performance » → ces canaux restent **noirs en permanence** (le show continue sur le reste). Récupération non évidente (retour en design, re-sélectionner/désélectionner une scène pour déclencher le transient de la ligne 496).
**Fix minimal** : ajouter `, 'design-test', 2000` sur la ligne 584 (via le paramètre sourceId + transientMs de `sendChannelsToHardwareAndStore`) et `, 2000` sur la ligne 1398 — 2 lignes, même pattern que la correction P0 déjà validée.

### NP2 — P2 (moyenne) : pin persistant des valeurs de scène et de fixture en sortie de design
- **designview.tsx:481 / 543 / 577** — sélection/édition d'une scène → `design-test` pinne les **valeurs** de la scène (pas des zéros) de façon persistante. Les vues restant montées (`display:none` dans app.tsx:368-376), le pin survit au changement de vue : en Performance, le moteur est bloqué sur ces canaux (le show joue mais les canaux éditables restent figés sur la scène).
- Même classe : `sendFixtureOn` (dmx-helpers.ts:197) pinne la fixture allumée tant que l'OFF (transitoire) n'est pas pressé.

C'est un changement de sémantique assumable (« l'éditeur garde la main ») mais **sans release à la sortie du mode design**. À trancher : release des sources `design-test`/`fixture-onoff` au changement de mode (app.tsx `handleModeChange`) ou transient à la sélection. Non bloquant si NP1 est traité, mais à documenter.

### NP3 — P3 (cosmétique) : mojibake dans le NetworkMonitor
25 lignes du bloc NetworkMonitor (designview.tsx:6582-6820) contiennent du texte double-encodé (« RÃ©seau sACN », « Ã‰mission », « dÃ©sactivÃ©e », « â†' »…). Le panneau Réseau sACN affichera des accents corrompus. Les 17 autres fichiers modifiés sont propres (scan binaire UTF-8).

---

## Réserves non bloquantes

- **R1 — Trou de 2 s après stop VC / reset Simple Desk / blackout design** : le moteur ne reprend qu'après 2 s (c'est le design choisi, accepté). Pour un live, 2 s de noir est long : envisager un paramètre par usage (ex. 500 ms pour les stops VC).
- **R2 — Latence meter** : une écriture non-moteur (slider VC, Simple Desk) entre `recordAudioTick` et la frame du moteur du même cycle consomme le tick en attente → l'échantillon est apparié au mauvais cycle. Rare et borné par `MAX_SAMPLE_MS` (1000 ms) ; sans impact fonctionnel.
- **R3 — VC slider univers 1 en dur** : préexistant, documenté dans le commentaire (performanceview.tsx:1933-1935).
- **R4 — ShowManager en HTP (prio 35)** : ses valeurs se fusionnent par max avec le moteur au lieu de les remplacer (comportement antérieur last-writer-wins). Cohérent avec l'arbitrage, mais à valider en conditions réelles (ex. un blackout « show-manager » ligne 138 n'éteint plus rien si le moteur tourne — sémantique HTP assumée).
- **R5 — Arrêt manuel du fixture test en cours de step** : pas de zéro (identique à l'ancien comportement, pas de régression).
- **R6 — Chunk Vite > 500 kB** : warning de build préexistant.

---

## Conclusion

Les 9 corrections sont en place, correctes et vérifiées dans le code réel ; l'arbitrage HTP/LTP est propre, testé, sans fuite de timer ; la non-régression est verte sur les 4 métriques.

**NON LIVRABLE en l'état** car NP1 réintroduit le bug P0 (show bloqué en noir) par deux chemins non couverts, avec un fix trivial. Une fois `transientMs=2000` ajouté sur designview.tsx:584 et 1398, le lot devient livrable avec NP2 (à trancher) et NP3 (cosmétique) en suivi.
