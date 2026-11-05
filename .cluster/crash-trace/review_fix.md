# Revue adversaire — Correctif crash `undefined.push` (tier `other`)

**Relecteur** : sous-agent « Relecteur correctif » (lecture seule, aucun fichier modifié)
**Date** : 2026-08-24
**Base de revue** : working tree `light-maestro` (HEAD `3aeddcc`) — `src/engine/tier-utils.ts` (nouveau, untracked), `src/views/DesignView.tsx` (modifié), `src/__tests__/tier-utils.test.ts` (nouveau, untracked)
**Vérifications exécutées pendant la revue** : `npx tsc --noEmit` → exit 0 ; `npx vitest run src/__tests__/tier-utils.test.ts` → 5/5 passés ; scans regex systématiques sur `src/views/*.tsx`, `src/components/**/*.tsx`, puis `src/**/*.{ts,tsx}` (hors tests).

---

## Verdict global : VALIDÉ AVEC RÉSERVES

**Justification** : la cause racine est correctement identifiée et le correctif l'élimine réellement.

- L'ancien code (`DesignView.tsx` ~l.1099-1107, confirmé par `git diff` et par la trace minifiée `se={primary:[],secondary:[],tertiary:[]}` du bundle `index-evtRuieA.js:4572:406184`) initialisait 3 buckets alors que `tier: 'other'` est une valeur légitime et atteignable par 3 chemins (modale d'ajout, menu contextuel, shows sauvegardés). `map['other'].push(pf)` → `undefined.push` à chaque rendu de la vue Scenes.
- Le nouveau `groupByTier` pré-initialise les 4 buckets connus **et** crée à la volée via `(map[key] ??= []).push(item)` pour toute valeur inattendue → le crash est impossible pour n'importe quelle valeur de tier, y compris hors-type (JSON legacy/corrompu).
- `tsc --noEmit` exit 0 et le test de régression passe (5/5).
- Les réserves ci-dessous sont mineures/non bloquantes (tests complémentaires, duplication `TIER_ORDER`, homogénéité du commit). Rien ne remet en cause l'élimination du crash.

---

## 1. Le crash est-il vraiment éliminé dans DesignView ?

**Oui.** Inventaire exhaustif des accès à bucket par clé dynamique dans `DesignView.tsx` (scan `.push(`, accès `[clé]` suivis de `.sort/.map/.length/.forEach/…`, index par expression) :

| Site | Code | Verdict |
|---|---|---|
| 1100-1106 | `fixturesByTier` : `groupByTier(patchedFixtures)` + tri par `Object.keys(map)` | ✅ Sûr — buckets garantis par construction, `??=` pour l'inattendu |
| 1103 | `map[tierGroup].sort(...)` | ✅ Sûr — itération sur les clés du même map (chaque clé existe) |
| 1223-1230 | `TIER_ORDER.map(...)` + `fixturesByTier[tierGroup] || []` + `TIER_SECTION_META[tierGroup]?.icon || '⬜'` | ✅ Sûr — double garde (`|| []` et `?.`) |
| 1565-1578 | `analysis.channels[analysis.panIdx/tiltIdx].name/.dmxAddress` | ✅ Sûr (borné) — `panIdx`/`tiltIdx` sont définis comme indices d'une boucle `i < channels.length` (`analyzeFixtureChannels`, l.250-262) ; le rendu est conditionné par `!== undefined`. Hors classe du bug (pas un bucket). |
| 3709, 3730, 4998, 5000 | `points.push / trail.push / row.push / rows.push` | ✅ Sûr — tableaux locaux initialisés `[]` |
| 6868-6889 | `modes[mi].channels[...]` | ✅ Sûr — `mi` borné par boucle sur `modes` |

**Aucun accès `X[cléDynamique].push(...)` ni autre accès non gardé à un bucket ne subsiste dans cette vue.** Le seul `.push` indexé par clé dynamique du repo était la ligne fautive, désormais remplacée (confirmé par scan `.*\[.*\]\.push\(` sur tout `src` hors tests : 0 occurrence).

## 2. Même classe de bug ailleurs ? (scan views + components)

Scan exhaustif sur `src/views/*.tsx` (10 fichiers) et `src/components/**/*.tsx` (5 fichiers), motifs : `X[key].push`, `X[key].sort/.map/.length/.forEach/.filter/.reduce/.flatMap/.shift/.splice`, index par expression `[op]`, `map.get(...).op`, accès chaînés.

| Fichier:ligne | Motif | Verdict |
|---|---|---|
| `src/engine/autoloop-engine.ts:385-399` | `groupKeys` : `if (arr) arr.push(key) else grouped[key.channel] = [key]` puis `grouped[channel].sort` sur `Object.keys` | ✅ Sûr — pattern get-or-create correct |
| `src/views/TrackTimeline.tsx:587` | `TIER_ORDER[a.tier] ?? 99` dans le tri de `tieredLayout` | ✅ Sûr — `?? 99` protège toute valeur inconnue. (Copie locale de l'ordre, voir réserve R2) |
| `src/views/TrackTimeline.tsx:590-628` | `seen`/`collapsedTiers` (Sets) + `list.push`, `result.push(...fromMap)` gardé par `fromMap && fromMap.length > 0` | ✅ Sûr — pas de bucket par clé |
| `src/views/TrackTimeline.tsx:1067, 1126, 1201, 1323, 1469, 1498` | `tieredLayout.list[idx]` | ✅ Sûr — tous gardés par `idx >= 0 && idx < list.length` |
| `src/views/QuickShowView.tsx:263` | `cfg.customPalette[section].length` | ✅ Sûr — précédé de `cfg.customPalette?.[section] &&` |
| `src/views/QuickShowView.tsx:149-801, 2356-2385` | push sur tableaux locaux (`out`, `effects`, `newSections`, `merged`, `cues`, `deduped`, `autoSecs`, …) | ✅ Sûr |
| `src/views/PerformanceView.tsx:91-111` | `_activeAudioRegistry.push(ctl)` — registre module, initialisé `[]` ligne 91 | ✅ Sûr |
| `src/views/PerformanceView.tsx:234, 372-374` | `pb.audioSources.push(source)` — tableau local initialisé `[]` (l.234) partagé dans l'objet playback puis nettoyé par `.filter` | ✅ Sûr |
| `src/views/ShowManager.tsx:72, 221-223` | `audioSourcesRef.current.push` — ref initialisée `useRef<...>([])` ligne 72 | ✅ Sûr |
| `src/views/Stage3D.tsx:145, 159, 712, 974, 1149, 1672, 1838, 1872` | `queue.push`, `extraHeads.push`, `refs.push`, … — tableaux locaux/refs | ✅ Sûr |
| `src/views/DesignView.tsx` (restant) | voir tableau §1 | ✅ Sûr |
| `src/components/**` (Sidebar, TopBar, update-notification, SongPresetPlayer, SoundSwitchAutoloop) | aucun motif bucket/clé dynamique, aucun `tier` | ✅ Sûr |

**Conclusion : aucun autre site à risque.** Le motif exact du crash (`bucket[cléDynamique].push`) est éliminé de tout le repo. Le pattern get-or-create correct (`if (arr) ... push ...`) de `autoloop-engine.ts:385-399` est un bon exemple de ce qu'il faut conserver.

## 3. Régression comportementale

1. **`TIER_ORDER = TIER_KEYS` (tuple readonly)** : seule utilisation dans DesignView = `TIER_ORDER.map(...)` ligne 1223 (lecture). Aucune mutation. `Array.prototype.map` est disponible sur les tuples readonly — aucun souci TS ni runtime. L'ordre d'affichage des sections reste `primary, secondary, tertiary, other`, identique à l'ancien littéral.
2. **Tableaux neufs** : `groupByTier` crée `map[key] = []` (frais) puis push les références des items — même sémantique que l'ancien code (aucun clonage des fixtures avant, aucun après). Pas de partage d'état : les buckets ne sont pas des alias de `patchedFixtures`.
3. **Tri par nom identique** : la boucle de tri `Object.keys(map)` + `localeCompare` est **bit à bit identique** avant/après (voir diff). Seul changement : un 4ᵉ bucket toujours vide à trier (sans effet). Le tri en lui-même sort du périmètre de `groupByTier` (il reste dans la vue) — même comportement, cf. réserve R1.
4. **Aucune fixture avec tier** (`undefined`/`null`/`''`) : retombée sur `'primary'` via `item.tier || 'primary'`, identique à l'avant. `groupByTier([])` → 4 buckets vides → aucune section rendue (garde `length === 0` ligne 1225), comme avant.

## 4. Typage et compatibilité build

- `PatchedFixture.tier` : `FixtureTier = 'primary' | 'secondary' | 'tertiary' | 'other'` (`src/stores/showStore.ts:16` et `:30`). **Le correctif couvre donc toutes les valeurs du type** — le bug venait de la divergence entre les buckets en dur (3) et le type (4). La défense `??=` couvre en plus les valeurs hors-type venues de JSON de shows anciens/corrompus (le type n'est pas validé au runtime au chargement).
- Compatibilité de la contrainte générique : `PatchedFixture` (tier requis `FixtureTier`) est bien assignable à `TieredItem` (`tier?: string | null`) — `tsc --noEmit` exit 0 le confirme.
- **`??=`** : opérateur ES2021. Stack : TypeScript ^5.3, `target: ES2022` (tsconfig.json), Vite ^5, Electron ^30 (Chromium 124 / Node 20). **Totalement compatible** — `??=` est natif ES2021, sous la target ES2022, et supporté par Chromium 124. Aucun polyfill nécessaire.
- Note : `strict: false` / `strictNullChecks: false` dans tsconfig — le correctif ne dépend pas de la null-safety du compilateur (il est défensif au runtime), donc robuste indépendamment de la config.

## 5. Tests : suffisants ?

**Suffisants pour prévenir la régression du crash, avec des compléments recommandés (non bloquants).**

- Le test n°1 reproduit le **scénario exact du crash** au niveau unitaire (`tier: 'other'` présent → plus de `undefined.push`). C'est le bon niveau de test **étant donné l'infrastructure existante** : `vitest.config.ts` → `environment: 'node'`, aucun `jsdom` ni `@testing-library` installé → un test de composant React est impossible sans ajouter des dépendances.
- Couverture : buckets pré-initialisés, rangement, défaut `undefined`/`''` → primary, tier inconnu. Le cas `null` n'est pas testé explicitement mais est logiquement identique (`|| 'primary'`).
- **Compléments proposés** (ordre d'importance) :
  1. *Test du scénario vue complet* : extraire le tri dans `tier-utils.ts` (ex. `sortBucketsByName<T extends {name: string}>(map)`) et le tester avec `TIER_KEYS.every(k => Array.isArray(map[k]))` + ordre des sections — couvre le contrat complet du `useMemo` sans dépendance DOM. (R1, optionnel)
  2. *Test de composant* `SceneEditor` avec une fixture `'other'` : nécessite `jsdom` + `@testing-library/react` (nouvelle dépendance) — à faire si une suite de tests composants est créée un jour, pas pour ce correctif.
  3. *Micro-ajout* : cas `tier: null` dans le test 4.

---

## Réserves

| # | Gravité | Fichier:ligne | Constat | Proposition |
|---|---|---|---|---|
| R1 | Faible | `src/views/DesignView.tsx:1103` | Le tri par nom reste dans la vue, non testé par `tier-utils.test.ts` (la seule logique non triviale du useMemo hors portée du module testé). Aujourd'hui identique à l'avant (diff), mais une refactorisation future du tri ne serait pas couverte. | Exporter une fonction `sortBucketsByName` dans `tier-utils.ts`, l'utiliser dans DesignView, ajouter un test (tri par nom + présence des 4 clés après tri). |
| R2 | Faible | `src/views/TrackTimeline.tsx:585` | TrackTimeline garde sa propre copie de l'ordre des tiers (`TIER_ORDER: Record<string, number>` + `?? 99`) pendant que `tier-utils.ts` revendique être « source unique de vérité » (commentaire du module). Aujourd'hui sans danger (aucun crash possible), mais l'ajout d'un 5ᵉ tier mettrait à jour DesignView sans TrackTimeline (tier relégué en fin par `?? 99`, sans en-tête dédié). | Exporter aussi un `TIER_PRIORITY` numérique (ou `tierRank(tier)`) depuis `tier-utils.ts` et l'utiliser dans TrackTimeline. Optionnel, hors scopé du crash. |
| R3 | Faible | working tree (git status) | Le diff contient des changements sans rapport avec le crash (toggle `show3D`, boutons, features auto-loops en cours). `tier-utils.ts`/`tier-utils.test.ts` sont untracked. Le risque de mélange est réel au moment du commit. | Commiter séparément : ① `src/engine/tier-utils.ts` + `src/__tests__/tier-utils.test.ts` + le bloc useMemo/import de `DesignView.tsx` (le correctif proprement dit) ; ② les autres travaux en cours. |
| R4 | Info | `src/views/DesignView.tsx:1565-1578` | `analysis.channels[analysis.panIdx]` est sûr aujourd'hui (indices bornés par construction dans `analyzeFixtureChannels`), mais protégé uniquement par `!== undefined` au rendu ; une analyse future qui calculerait `panIdx` hors bornes crasherait sur `.name`. | Sans objet pour ce correctif ; à garder en tête lors des évolutions de `fixture-analyzer.ts` (hors périmètre). |

---

## Réponses aux 5 questions (synthèse)

1. **Crash éliminé ?** Oui — le useMemo de `DesignView.tsx` (l.1100-1106) est maintenant construit sur `groupByTier` (4 buckets pré-initialisés + `??=`), et **aucun** autre accès non gardé à un bucket par clé dynamique ne subsiste dans la vue (scan exhaustif : voir tableau §1).
2. **Même classe ailleurs ?** Aucun site à risque dans `src/views/*.tsx` et `src/components/**/*.tsx` (voir tableau §2). Le motif exact du crash a disparu de tout `src` (0 occurrence de `X[key].push(` hors tests). Deux sites intrinsèquement protégés mais dupliquant le concept : `TrackTimeline.tsx:585-587` (`?? 99`, sûr) et `autoloop-engine.ts:385-399` (get-or-create, sûr).
3. **Régression comportementale ?** Aucune : `TIER_ORDER`/`TIER_KEYS` en lecture seule (`.map` uniquement), buckets neufs, tri identique (diff), cas « aucune fixture avec tier » identique (retombée primary + sections vides masquées).
4. **Typage ?** `tier: FixtureTier` = union des 4 valeurs (`showStore.ts:16,30`) → couvert ; `??=` défensif pour les hors-type JSON. `??=` est ES2021, target ES2022, TS 5.3, Electron 30/Chromium 124 → compatible, `tsc --noEmit` exit 0.
5. **Tests ?** Suffisants pour la régression du crash (test exact `tier: 'other'` → no-throw, environnement vitest = node, pas de jsdom). Compléments non bloquants proposés en §5 / R1 (tri non couvert, pas de test de composant possible sans nouvelle dépendance).