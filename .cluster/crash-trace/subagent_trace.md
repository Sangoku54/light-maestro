# Rapport — Crash renderer `undefined.push` (index-evtRuieA.js:4572:406184)

## 1. Point de défaillance exact

**Fichier source** : `src/views/DesignView.tsx`
**Composant** : `SceneEditor` (déclaré ligne 863)
**Lignes 1098-1112** — `useMemo` `fixturesByTier` :

```tsx
// Group fixtures by tier, sorted by name          (ligne 1097)
const fixturesByTier = React.useMemo(() => {        // ligne 1098
  const map: Record<string, typeof patchedFixtures> = {
    primary: [],
    secondary: [],
    tertiary: [],
  };                                                // lignes 1099-1103
  for (const pf of patchedFixtures) {
    const tierGroup = pf.tier || 'primary';
    map[tierGroup].push(pf);                        // ligne 1106  ← CRASH
  }
  for (const tierGroup of Object.keys(map)) {
    map[tierGroup].sort((a, b) => a.name.localeCompare(b.name));
  }
  return map;
}, [patchedFixtures]);
```

**Correspondance minifiée vérifiée dans le bundle** (`release\win-unpacked\resources\app\dist\renderer\assets\index-evtRuieA.js`, ligne 4572, caractère 406182 — la stack trace pointe 406184, à 2 chars du `.push`, c'est bien l'expression fautive) :

```js
Te=na.useMemo(()=>{const se={primary:[],secondary:[],tertiary:[]};for(const Ze of r){const L=Ze.tier||"primary";se[L].push(Ze)}...
```

C'est **le seul site du repo** utilisant le motif `[cléDynamique].push(` (recherche exhaustive `src/**/*.{ts,tsx}` : 1 seul résultat).

## 2. La variable undefined et la raison

- **Variable** : `map['other']` (minifié : `se[L]` où `L === 'other'`).
- **Pourquoi** : le bucket map n'est initialisé qu'avec `primary`, `secondary`, `tertiary`, alors que `'other'` est une valeur de tier **légitime et partout gérée** :
  - `src/stores/showStore.ts:30` : `type FixtureTier = 'primary' | 'secondary' | 'tertiary' | 'other';` (utilisée par `PatchedFixture.tier`).
  - `DesignView.tsx:1114-1121` : `TIER_SECTION_META` contient `other: { icon: '⚙️' }` et `TIER_ORDER = ['primary','secondary','tertiary','other']` — définis 3 lignes **après** le useMemo, donc une section `other` était attendue mais le bucket n'a pas été créé.
  - `DesignView.tsx:1396 / 4637 / 5817` : styles `pf.tier === 'other' ? 'bg-cyan-500/20 text-cyan-400'`.
  - `src/engine/dmx-color.ts:71` : `tier==='primary'||tier==='other'?1.0:...`.
  - `src/views/TrackTimeline.tsx` : `TIER_ORDER[a.tier] ?? 99` (gère `'other'`).
- **Clé du bucket** : `pf.tier || 'primary'` — `undefined` et `null` retombent sur `'primary'` (existant), donc le crash ne peut venir que d'un tier string inconnu du map, c.-à-d. précisément `'other'`.

## 3. Scénario de déclenchement

Une fixture patchée avec `tier === 'other'` + le composant `SceneEditor` monté/re-rendu (vue Scenes de la Design View) → le `useMemo` s'exécute → `map['other'].push(pf)` → `TypeError: Cannot read properties of undefined (reading 'push')` → React démonte le composant (écran blanc, crash renderer).

Une fixture peut obtenir `tier: 'other'` via 3 chemins :
1. **Modale d'ajout de fixtures** : sélecteur de tier (`DesignView.tsx:4746` : `(['primary','secondary','tertiary','other'] as const).map(...)`), state `addTier` typé avec `'other'` (ligne 4146), transmission `tier: addTier` lors du patch (ligne 4411).
2. **Menu contextuel / panneau fixture** : `onSetTier(opt.value)` (lignes 5680, 5905-5919) → `updateFixtureTier(id, tier)` (`showStore.ts:470`).
3. **Chargement d'un show sauvegardé** contenant des fixtures avec `tier: 'other'`.

Le crash se produit même sans interaction : il suffit d'ouvrir l'onglet Scenes alors qu'au moins une fixture `'other'` est patchée (le useMemo est exécuté à chaque render, le hook est en tête de composant avant les retours conditionnels).

## 4. Fix proposé (minimal et sûr)

**Option A — ajouter le bucket manquant (fix chirurgical)**, `src/views/DesignView.tsx` lignes 1099-1103 :

```tsx
const map: Record<string, typeof patchedFixtures> = {
  primary: [],
  secondary: [],
  tertiary: [],
  other: [],          // ← clé manquante : FixtureTier inclut 'other'
};
```

**Option B — défensif + source unique de vérité** (recommandé, évite la régression si un nouveau tier s'ajoute) :

```tsx
// TIER_ORDER est déjà défini ligne 1121 → le déplacer au-dessus du useMemo, puis :
const fixturesByTier = React.useMemo(() => {
  const map: Record<string, typeof patchedFixtures> = Object.fromEntries(
    TIER_ORDER.map((tier) => [tier, [] as typeof patchedFixtures]),
  );
  for (const pf of patchedFixtures) {
    const tierGroup = pf.tier || 'primary';
    (map[tierGroup] ??= []).push(pf);   // garde-fou : bucket créé à la demande
  }
  for (const tierGroup of Object.keys(map)) {
    map[tierGroup].sort((a, b) => a.name.localeCompare(b.name));
  }
  return map;
}, [patchedFixtures]);
```

**Impacts** : le panneau Scenes affichera une nouvelle section « ⚙️ » pour les fixtures `other` — comportement prévu par `TIER_SECTION_META` et `TIER_ORDER` déjà en place (lignes 1114-1121) ; aucune régression de tri (tri par `Object.keys(map)` inchangé). Le rendu des sections parcourt déjà `TIER_ORDER` donc `other` s'affichera en dernier, comme dans les autres vues (TrackTimeline). Aucun autre site à corriger : recherche exhaustive concluante (cf. §5).

## 5. Autres candidats examinés et écartés

1. **`src/views/TrackTimeline.tsx` — `tieredLayout` (`useMemo`, ligne ~20662)** : groupe les fixtures par tier avec en-têtes. Écarté : pas de bucket indexé par clé ; tri via `(TIER_ORDER[a.tier] ?? 99)` (retombe en fin pour `'other'`/inconnu) et push dans un tableau `list` local toujours défini. Aucun `undefined.push` possible.

2. **`src/engine/auto-loops.ts` — génération par catégorie (`generateLoopLibrary`/`generateAutoLoops`, kinds `laser-pattern`/`laser-scan`/`laser-color`, `beam-${k}`)** : tous les `.push` (lignes 293-968) sont sur des tableaux locaux initialisés (`steps`, `list`, `kinds`, `loops`, etc.), jamais `bucket[cléDynamique].push`. Par ailleurs `AutoLoopsPanel.tsx` n'existe pas dans ce repo (`src/components/` absent) ; aucune table `KIND_META` à bucket indexé dans le bundle ni le source (`[x].push(` : 0 occurrence). Écarté.

3. **`src/views/QuickShowView.tsx` — `energyBySection` et `movingHeads`** : le premier initialise chaque clé avant écriture (`if (!map[s.type]) map[s.type] = ...`), le second utilise `.filter`, pas de bucket push. Écarté.

4. **`src/hooks/dmx-cues.ts:627` (`fa.fixture.tier === tier`)** : filtre, pas de push par bucket ; `undefined.push` impossible. Écarté.

## 6. Annexe — vérifications effectuées (lecture seule)

- Extraction ligne 4572 du bundle + positions de tous les `.push` : seul celui à 406182 (-2 de la colonne 406184) correspond au motif ; contexte minifié identique au source.
- Recherche exhaustive `[identifiant].push(` sur `src/**/*.{ts,tsx}` : 1 seul hit (`DesignView.tsx:1107`).
- Type `FixtureTier` confirmé dans `showStore.ts:30` ; `addTier` state `DesignView.tsx:4146` ; option `'other'` dans les sélecteurs `DesignView.tsx:4746/5905` ; `updateFixtureTier` `showStore.ts:470`.
- Aucun fichier modifié, aucun build exécuté.