# Revue adversariale — correctif « Stage Wash 7x10W » (normalisation d'id de fixture)

Date : 2026-08-23
Reviewer : subagent indépendant (Wash fix reviewer)
Portée : `light-maestro/electron/fixtures/library.ts` + chemins de résolution par id.

## 1. Le correctif est-il présent et syntaxiquement correct ?

OUI. Dans `electron/fixtures/library.ts` :

- L.481 — champ déclaré : `private normalizedIdMap: Map<string, string> = new Map();`
- L.488 — `load()` fait bien `this.normalizedIdMap.clear();` (reset au rechargement complet).
- L.1285-1287 — helper :
  ```ts
  private normalizeId(id: string): string {
    return id.replace(/^custom-/i, '').toLowerCase();
  }
  ```
- L.1299 — `add(def)` alimente la map : `this.normalizedIdMap.set(this.normalizeId(def.id), def.id);`
- L.1326-1332 — `get(id)` :
  ```ts
  get(id: string): FixtureDefinition | undefined {
    const exact = this.fixtures.get(id);
    if (exact) return exact;
    // Fallback : résout un id GDTF original vers la def ré-écrite « custom-… ».
    const actualId = this.normalizedIdMap.get(this.normalizeId(id));
    return actualId ? this.fixtures.get(actualId) : undefined;
  }
  ```

Le fallback est correct : exact-match d'abord, puis résolution normalisée. Syntaxe TypeScript valide, types cohérents (`Map<string,string>`), pas de référence à une clé non définie.

Vérification du scénario exact du bug :
- Show référence `stage-right-Stage-Wash-7x10W-LED-Moving-Head`.
- La def est stockée sous `custom-stage-right-stage-wash-7x10w-led-moving-head` (persistée dans `%APPDATA%\light-maestro\fixtures\...`).
- `get(original)`: exact échoue → `normalizeId(original)` = `stage-right-stage-wash-7x10w-led-moving-head` → map → `custom-stage-right-stage-wash-7x10w-led-moving-head` → `fixtures.get` → def trouvée. ✓

Le correctif comporte en outre une **deuxième ligne de défense** dans `addCustom` (L.1310-1319) : il ne ré-écrit plus `def.id` quand celui-ci est déjà non vide (round-trip embed→re-import préservé). Les deux mécanismes se complètent.

## 2. Autres résolutions de def par id (accès direct sensible à la casse)

### 2a. `getDefinition` IPC — `electron/main.ts` L.513
`ipcMain.handle('fixtures:getDefinition', async (_, id) => fixtureLibrary.get(id));`
→ passe par `get()` → **corrigé**. C'est la voie unique de résolution pour tout le renderer.

### 2b. `loadFixtureDefinitions` — `src/hooks/dmx-cues.ts` L.981-1015
Résout via `api.fixtures.getDefinition(id)` (L.1014-1015) → IPC → `get()`. Le cache `_defCache` est indexé par l'id **demandé** (`map.set(id, def)`), et tous les consommateurs relisent avec le même `pf.fixtureDefId`. → **aucun problème**, cohérent avec le correctif.

### 2c. `fixture-analyzer.ts`
`analyzeFixtureChannels(pf, def)` reçoit `def` **en paramètre** ; il ne fait aucune résolution par id. L'analyseur ne peut pas rater une def : c'est l'appelant (toujours via `loadFixtureDefinitions`) qui résout. → **aucun problème**.

### 2d. `createInstance` — `library.ts` L.1394-1395 ⚠️ (mineur)
```ts
createInstance(defId: string, modeIndex: number = 0, startAddress: number = 1) {
  const def = this.fixtures.get(defId);   // accès direct, PAS via get()
```
C'est le **seul** accès direct au Map qui ne passe pas par `get()` (avec `search()` L.1342 qui, lui, utilise l'id exact issu de l'index interne, donc sans risque).

**MAIS** : recherche exhaustive (`createInstance` dans `src/` et `electron/`) → **aucun appelant**. C'est du code mort (ou réservé à un usage futur non câblé). Donc pas de bug actif aujourd'hui, mais incohérence latente : si un jour `createInstance` est appelé avec un id GDTF original transformé (`custom-` + minuscules), il échouera. **Recommandation (non bloquante)** : remplacer par `this.get(defId)`.

### 2e. `getAll()` / `search()` / `getByType()` / `getByManufacturer()`
Aucun ne résout une def de show par id ; `getAll` alimente uniquement les onglets « parcourir/éditer » de la bibliothèque. Les usages renderer (`DesignView` L.4249, 6792, 6949 ; `ShowManager` L.323) reconstruisent des listes locales ou passent par `loadFixtureDefinitions` → `getDefinition` → `get()`. → **aucun problème**.

## 3. Risque de collision du fallback normalisé

`normalizeId` = strip `custom-` + `toLowerCase()`. Deux defs distinctes ne peuvent collisionner que si leurs ids ne diffèrent **que** par la casse et/ou le préfixe `custom-` (les ids sont déjà assainis en `manufacturer-model` par les parseurs QLC/OFL/GDTF).

- La dédup `hasFixture` (`normalizeKey` = manufacturer+model en minuscules, L.1293-1295) empêche d'ajouter deux fixtures **différentes** portant le même couple manufacturer+model via les chemins dédupliqués (`loadOflDirectory`, `loadGdtfDirectory`).
- La seule co-collision possible est « même fixture physique » : def embarquée GDTF `stage-right-Stage-Wash-7x10W-LED-Moving-Head` **et** sa version custom `custom-stage-right-stage-wash-7x10w-led-moving-head` (userData). Les deux normalisent vers la même clé. C'est **bénin et même souhaité** (override utilisateur) : `add()` fait du last-write-wins, et les fixtures userData sont chargées **en dernier** dans `load()`, donc la version custom gagne. Comme c'est la même fixture, pas de mauvaise attribution.
- Le `get()` privilégie toujours l'exact-match, donc aucune ambiguïté pour les ids exacts.

**Verdict collision : risque réel non plausible** (nécessiterait deux fixtures différentes avec manufacturer+model identiques à la casse/prefixe près, ce que `hasFixture` bloque déjà).

## 4. Régression sur la résolution exacte ?

Aucune. `get()` teste `this.fixtures.get(id)` **avant** le fallback. Toute def stockée sous son id exact (bundled, OFL, GDTF, custom) continue de se résoudre exactement comme avant. Le fallback ne s'active que lorsque l'exact-match échoue (comportement strictement élargi, jamais rétréci). `normalizedIdMap` est correctement vidée dans `load()` et ré-alimentée dans `add()` (tous les points d'entrée — `loadDirectory`, `loadOflDirectory`, `loadGdtfDirectory`, `importQLC`, `importGDTF`, `addCustom` — passent par `add()`).

## Conclusion

Correctif présent, syntaxiquement valide, appliqué au bon endroit, sans régression, et le seul accès direct restant (`createInstance`) est du code mort sans appelant. Aucun problème bloquant.

- Fichier : `electron/fixtures/library.ts` L.481, 488, 1285, 1299, 1326-1332.
- Point mineur (recommandation, non bloquant) : `createInstance` L.1395 utilise `this.fixtures.get(defId)` au lieu de `this.get(defId)`.

VERDICT: CORRECT
