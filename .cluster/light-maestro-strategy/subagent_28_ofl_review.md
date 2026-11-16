# Revue adversarial — Lot #19 : parseur OFL + bibliothèque Budget < 100 €

**Agent** : subagent_28_ofl_review · **Date** : 2026-08-15 · **Portée** : lecture seule + probes vitest dans `tmp-review/` (supprimés), aucun fichier du repo modifié.

## Verdict : CORRECTIONS REQUISES

Le cœur du parseur est sain (626/626 fixtures chargées, 0 canal non résolu, counts exacts vérifiés sur tous les cas limites, gardes fine sans régression, jointure budget 8/8). **Mais** le lot livre un défaut visible en UI (7 fixtures fantômes issues de fichiers `fixture-redirect` OFL) et des tests pass-vacants qui l'ont laissé passer. Corrections priorisées ci-dessous.

### Validation effectuée
- `npx vitest run src/__tests__/ofl-parse.test.ts` → **10/10 verts** (626 added, 0 skipped).
- `npx tsc -p tsconfig.electron.json` / `tsconfig.json` → **exit 0**.
- Probes adversariaux (9 tests supplémentaires) : 626 fixtures, 46 583 canaux, **0 nom vide / 0 canal `$` non résolu / 0 insert inconnu** ; counts exacts (alc4 20, revo-4-ir 256, alien-s 14/26/7, spica-250m 14, galaxian-3d 5, led-tmh-18 48) ; 2001 valeurs repeatFor toutes résolues ; 8 entrées budget ↔ 8 fixtures 1:1 ; getBudgetList OK sur dev + prod unpacked + fallback asar sans crash ; miroir i18n strict 697/697.

---

## Liste des problèmes (priorisée)

### 🔴 MAJEUR

#### P1 — Fixtures fantômes : les fichiers `fixture-redirect` OFL sont chargés comme fixtures à 0 mode
**Fichier** : `electron/fixtures/library.ts` — `parseOFLFixture` (~ligne 400, début de fonction) ; visible dans `src/views/designview.tsx` (browse/search).

**Fait** : 7 fichiers de la bibliothèque sont des redirects OFL (`$schema: fixture-redirect.json`, ex. `{ "name": "ts60", "redirectTo": "cameo/ts-60-rgbw", "reason": "FixtureRenamed" }`) : `cameo/ts60`, `kino-flo/celeb-led-250-dmx`, `kino-flo/celeb-led-450-dmx`, `lixada/mini-beam-rgbw`, `lixada/mini-moving-head-rgbw`, `minuit-une/m-carre`, `stairville/mh-x30`. Le parseur les traite comme des fixtures normales : manufacturer + `name` (l'**ancien** nom) + `modes = []` (pas d'`availableChannels`, pas de modes). `parseOFLFixture` ne filtre que `if (!def) continue` — un def avec 0 modes est accepté.

**Impact** : dans l'UI, l'utilisateur voit 7 fixtures fantômes (doublons de marques populaires : Cameo, Stairville, Kino Flo, Lixada, Minuit Une) avec l'ancien nom, 0 mode, impatchables. La recherche matche les deux noms (ancien + nouveau).

**Pourquoi les tests ne l'ont pas vu** : le test « robustesse » itère `def.modes` mais ne vérifie **jamais** que chaque fixture a `modes.length > 0` → pass-vacant sur ce cas.

**Correction chirurgicale** (< 5 blocs) :
```ts
// electron/fixtures/library.ts, au début de parseOFLFixture, après `const data = JSON.parse(json);`
if (data.redirectTo) {
  console.warn(`OFL redirect ignoré: ${manufacturerKey}/${data.name} → ${data.redirectTo}`);
  return null;
}
```
```ts
// src/__tests__/ofl-parse.test.ts, dans le test « robustesse »
for (const def of defs) {
  expect(def.modes.length, `fixture sans mode: ${def.id}`).toBeGreaterThan(0); // ← ajout
  for (const m of def.modes) { ... }
}
```
(Conséquence : 626 → 619 fixtures ; les seuils `>= 600` des tests restent verts ; aucune entrée budget n'est une redirect — vérifié.)

### 🟡 MINEURS

#### P2 — Test alien-s pass-vacant : assertions trop faibles
**Fichier** : `src/__tests__/ofl-parse.test.ts` (test « pixelGroups all »).

**Fait** : le test se contente de `expect(def).not.toBeNull()` et `channels.length > 0` par mode. Il ne vérifie ni les counts exacts (14-channel d-P3 = 14, 26-channel d-P4 = 26, 7-channel d-P6 = 7) ni les noms résolus ("Red Master"). Un parseur qui tronquerait les inserts passerait. (Probe : le parse actuel est correct — c'est la protection qui manque.)

**Correction** :
```ts
const names = new Map((def?.modes ?? []).map(m => [m.name, m.channels.length]));
expect(names.get('14-channel d-P3')).toBe(14);
expect(names.get('26-channel d-P4')).toBe(26);
expect(names.get('7-channel d-P6')).toBe(7);
expect(def?.modes[0].channels.map(c => c.name)).toEqual(['Red Master', 'Green Master', 'Blue Master']);
```

#### P3 — Clé i18n `budgetCount` morte : la fonctionnalité annoncée n'existe pas
**Fichier** : `src/i18n/fr.json:364`, `en.json:364` ; `src/views/designview.tsx` (aucune référence).

**Fait** : grep — `budgetCount` n'est utilisé nulle part. Le lot annonce « clés budgetOnly/budgetCount » mais seul `budgetOnly` est rendu (ligne 4691). Clé orpheline (le miroir 697/697 est strict, donc pas de déséquilibre, mais la clé est morte).

**Correction** (option A — livrer la feature, 1 bloc) : sous le toggle (designview.tsx ~4693) :
```tsx
{budgetOnly && budgetIds.size > 0 && (
  <span className="text-[10px] text-gray-500">{t('design.addFixtureModal.budgetCount', { count: budgetIds.size })}</span>
)}
```
(option B : supprimer les 2 clés).

#### P4 — Compteur fabricant trompeur quand budgetOnly est ON
**Fichier** : `src/views/designview.tsx` (~ligne 4695-4705, browse).

**Fait** : le filtre fabricants est correct (un fabricant sans fixture budget disparaît ✓ — logique vérifiée), mais `mfg.count` affiché reste le **total** du fabricant, pas le nombre de fixtures budget. Un fabricant avec 10 fixtures dont 1 < 100 € affiche « 10 fixtures » alors que la liste filtrée n'en montre qu'une.

**Correction** (1 bloc) :
```tsx
<div className="text-[10px] text-gray-600">
  {budgetOnly
    ? `${allFixtures.filter(f => f.manufacturer === mfg.name && budgetIds.has(f.id)).length} fixture${...}`
    : `${mfg.count} fixture${mfg.count !== 1 ? 's' : ''}`}
</div>
```

#### P5 — `budgetCache` jamais invalidé
**Fichier** : `electron/fixtures/library.ts` — `getBudgetList` (~ligne 760).

**Fait** : le cache est conservé à vie ; `fixtures:reloadLibrary` (main.ts:306) ne le vide pas. En dev, éditer `budget.json` à chaud ne prend effet qu'au redémarrage. En prod le fichier est dans l'asar (immuable) → impact faible, mais l'incohérence avec `reloadLibrary` est un piège.

**Correction** (2 blocs) : exposer `clearBudgetCache()` sur `FixtureLibrary`, l'appeler dans le handler `fixtures:reloadLibrary` (ou comparer le `mtime` à chaque appel).

#### P6 — Chemin mort dans `getBudgetList` (2ᵉ candidat)
**Fichier** : `electron/fixtures/library.ts` ~ligne 762.

**Fait** : `path.join(app.getAppPath(), '..', 'resources', ...)` est **incorrect** pour le layout NSIS standard (appPath = `<install>/resources/app.asar` → produit `<install>/resources/resources/...`, inexistant). Le 1ᵉʳ candidat (`appPath/resources/...`) couvre dev + asar (avec `asarUnpack: resources/**/*` + `files: resources/**/*` dans package.json build → Electron lit via le patch asar, cohérent avec `load()`). Le 2ᵉ candidat ne sert que le layout « app unpacked dans `<install>/app` ». Inoffensif, mais c'est du code mort qui suggère une fausse couverture prod.

**Correction** : documenter (commentaire « utile uniquement si l'app est unpackée ») ou remplacer par `path.join(path.dirname(app.getAppPath()), '..', 'resources', ...)`. Aucun bloc de logique à changer.

#### P7 — `repeatFor: "eachPixelYXZ"` : l'ordre d'aplatissement ignore la sémantique
**Fichier** : `electron/fixtures/library.ts` — `resolveRefs` (~ligne 560).

**Fait** : seuls `eachPixelGroup` et les listes à virgule sont distingués ; `eachPixelABC/XYZ/YXZ` sont tous aplatis dans l'ordre d'imbrication du JSON. Pour `eachPixelYXZ` l'ordre OFL attendu diffère. Impact actuel **nul** : la seule fixture concernée (`eurolite/led-tmh-18`, pixelCount [3,3,1]) a des pixelKeys implicites 1..9 → ordre identique. Limite théorique pour une future fixture à pixelKeys 3D nominatifs.

**Correction** : soit documenter la limitation, soit réordonner l'aplatissement selon le repeatFor (transposer les dimensions). Option documentaire recommandée.

### ℹ️ Constats hors périmètre (pré-existants, à connaître — pas des régressions du lot #19)

- **`dmx-cues.ts:624-631`** : si un mode liste le fine avant le coarse (ex. QXF `Lixada-Triangle-Spider-Beam` « X Pan Fine | X Pan Coarse », `Eurolite-TMH-11` « … | Pan fine » sans « Pan »), `fa.panOffset` prend le **fine**. Le playback reste fonctionnel (le coarse passe par `panOffsets`), mais la précision 16-bit est perdue pour ces 3 modes. Scan : 0 mode OFL concerné, 3 modes QXF.
- **`dmx-channel.ts`** : `ChannelAnalysis` n'a pas de `panFineOffset`/`tiltFineOffset` → les canaux fine pan/tilt ne sont jamais écrits par le moteur temps réel (`dmx-playback.ts`), qui pilote le pan 8-bit. Le module cues (`dmx-cues.ts`) gère le fine, lui. Incohérence moteur pré-existante, à traiter hors lot.
- **Canaux « Dimmer fine » / « Intensity fine »** (type Intensity, très fréquents en OFL) : aucune garde fine sur `case 'Intensity'` → le moteur écrit la valeur dimmer sur le fine (16-bit mal contrôlé). Pré-existant, hors périmètre.

---

## Réponses aux points à examiner

1. **Parseur / cas limites** : pixelKeys 3D imbriqués ✓ (galaxian-3d, alc4), groupes « all » ✓ (alien-s), réfs de mode ✓, `$pixelKey` début/milieu/fin ✓ (112 templates, 115/20/424), insert perPixel ✓ (720/720, 0 perChannel exercé — chemin non testé par les données), `eachPixelGroup` ✓ (7 inserts vérifiés), reverse-match : **jamais exercé** (0 fixture avec templates sans matrix) → code mort protégé par rien.
2. **normalizeOflDefault** : 50 % → 128 (Math.round(127.5)), 16-bit → `(raw>>8)&0xFF` : 32639 → 127, 32767 → 127 ✓ cohérent ; fine = `raw & 0xFF` → 127 neutre ✓.
3. **Gardes `\bfine\b`** : `/i` + `\b` → couvrent « Pan Fine », « Pan-fine », « Pan (fine control) », « Pan [Fine] », « Fine Pan », « Tilt  Fine Movement ». Aucun faux positif sur les noms réels (definer/refine/confine absents ; « Dimmer fine1 » sans boundary n'est pas matché mais type Intensity → aucune garde concernée). **Aucune régression** : 0 fixture sans canal fine affectée (128 modes coarse-first, 0 fine-first). Effet positif : le fine n'est plus traité comme un 2ᵉ bras pan ni comme canal RGB principal.
4. **UI** : jointure normalisée identique des 2 côtés ✓ (8/8 matchées 1:1) ; toggle `checked={budgetOnly}` cohérent ✓ (mais cliquable même si `budgetIds` vide → liste vide, non désactivé) ; fabricants sans fixture budget disparaissent ✓ ; `budgetCount` **non utilisé** (P3) ; count fabricant non filtré (P4).
5. **getBudgetList** : dev ✓, asar ✓ (via patch asar + asarUnpack), 2ᵉ chemin mort (P6) ; cache non invalidé (P5) ; `budget.json` racine bien ignoré par `loadOflDirectory` (n'itère que les sous-dossiers — confirmé : 626 fixtures, budget.json non compté).
6. **Tests** : 10/10 verts mais trous : pas de fixture-redirect (P1), alien-s pass-vacant (P2), pas de test getBudgetList (chemins/cache), pas de test perChannel/reverse-match/fallback (non exercés par les données), pas d'assertion ≥ 1 mode par fixture.
7. **Régressions git diff** : les 4 analyseurs ne changent le comportement que des canaux dont le nom matche `\bfine\b` → aucun impact sur les fixtures sans canaux fine (vérifié par probes sur les 46 583 canaux).
