# Analyse — Éditeur de fixtures Light Maestro

**Fichier principal analysé :** `src/views/DesignView.tsx`
**Analyseur de référence :** `src/engine/fixture-analyzer.ts`

Tous les numéros de ligne ci-dessous ont été vérifiés dans les fichiers réels.

---

## 1. État actuel (vérifié)

### Déclarations (DesignView.tsx)
- Ligne **6726-6729** — `CHANNEL_TYPES` : `['Intensity','Pan','Tilt','Colour','Gobo','Shutter','Strobe','Speed','Prism','Effect','Beam','Macro','Nothing','Maintenance']` (14 types).
- Ligne **6731-6735** — `interface EditorChannel` : `{ name; type; defaultValue?; capabilities?: Array<{ min; max; name; color? }> }`.
- Ligne **6852-6857** — `updateChannel(target, mi, ci, updates)`.
- Ligne **6868-6872** — `addCapability` : injecte **toujours** `{ min: 0, max: 255, name: 'New Color', color: '#ff0000' }` (couleur codée en dur, même pour un type non-Colour).
- Ligne **6874-6878** — `removeCapability`.
- Ligne **6880-6883** — `updateCapability`.

### `renderChannel` (DesignView.tsx)
- Ligne **6944** — début de `renderChannel(target, mi, ch, ci, total)`.
- Ligne **6950-6953** — le `<select>` qui liste `CHANNEL_TYPES`.
- **Trois blocs conditionnels quasi identiques :**
  - Ligne **6964-6988** — bloc `ch.type === 'Colour'` (avec `<input type="color">` à la ligne **6983**).
  - Ligne **6990-7012** — bloc `ch.type === 'Gobo'` (sans couleur).
  - Ligne **7014-7037** — bloc `ch.type === 'Macro'` (sans couleur).
- Ligne **7038** — `</div>` de fermeture de la carte de canal.

Les trois blocs diffèrent uniquement par : le libellé (`Colors` / `Gobo Patterns` / `Macros`), le `placeholder` du champ nom (`Color name` / `Gobo name` / `Macro name`), le `title` du bouton de suppression, et la présence du `<input type="color">` (uniquement Colour). Tous les autres types (Intensity, Pan, Tilt, Shutter, Strobe, Speed, Prism, Effect, Beam, Nothing, Maintenance) n'ont **aucun** sous-menu de capacités.

---

## 2. Cohérence `CHANNEL_TYPES` ↔ `analyzeFixtureChannels`

L'analyseur `src/engine/fixture-analyzer.ts` :
- `switch` (lignes **150-208**) traite : `Intensity`, `Shutter`, `Effect`, `Pan`, `Tilt`, `Gobo`, `Prism`, `Zoom`, `Frost`, `Focus`, `Iris`, `Speed`, `Beam`.
- **Avant** le switch : `Colour` est capté par le bloc de détection couleur (lignes **131-136** : `isRgbNamed || startsWithRgb || ch.type === 'Colour' || (ch.type === 'Beam' && hasColorWord) || hasColorCaps`), et `Macro` est exclu du DMX auto (lignes **118-122**).
- Pas de `default:` dans le switch → tout type inconnu **tombe silencieusement sans effet**.

### Incohérences identifiées

| # | Type | Constat | Recommandation |
|---|------|---------|----------------|
| 1 | `Strobe` (éditeur) | Présent dans `CHANNEL_TYPES` mais **absent** de l'analyseur. Seul `Shutter` est reconnu. Un canal `Strobe` ne produit **aucun** `shutterOffset` → pas de contrôle strobe/shutter en playback. L'éditeur propose **à la fois** `Shutter` et `Strobe`, ce qui est redondant et source de confusion. | **Additif sans risque** : ajouter `case 'Strobe':` dans le switch de l'analyseur, traité exactement comme `Shutter`. Ne casse rien (pas de comportement existant modifié). Alternative : retirer `Strobe` de `CHANNEL_TYPES`, mais moins bon UX (les utilisateurs pensent « Strobe »). |
| 2 | `Nothing` / `Maintenance` (éditeur) | Absents de l'analyseur, **pas de case** dans le switch. Ils tombent silencieusement (pas de `default:`), donc **aucun offset** produit. Comportement **sûr** (no-op), pas un bug. `Nothing` = slot volontairement inutilisé ; `Maintenance` = canal reset/lamp. | **Aucune action requise.** L'analyseur les ignore déjà proprement. (Optionnel : ajouter un `maintenanceOffset` si un jour on veut piloter les canaux maintenance.) |
| 3 | `Zoom`, `Frost`, `Focus`, `Iris` (analyseur) | Reconnus par l'analyseur (cases dédiées lignes 177-189) mais **absents de `CHANNEL_TYPES`** → impossibles à créer dans l'éditeur. Un utilisateur ne peut pas fabriquer une fixture custom exploitant ces canaux alors que le moteur les supporte. | **Additif sans risque** : ajouter `'Zoom', 'Frost', 'Focus', 'Iris'` à `CHANNEL_TYPES`. L'analyseur les gère déjà ; aucune migration nécessaire. |
| 4 | `Colour` | Présent des deux côtés. ✔ Cohérent. | — |
| 5 | `Macro` | Présent des deux côtés (analyseur : exclusion DMX auto). ✔ Cohérent. | — |

### Bénéfice annexe du refactor (à noter)
L'analyseur consomme aussi les `capabilities` des canaux **`Effect`** (`fa.effectCaps`, ligne **162-165**) et **`Gobo`** (`fa.goboCaps`, ligne **170-173**). Or l'UI actuelle ne permet de saisir des capacités que pour Colour/Gobo/Macro. **Généraliser le sous-menu à tous les types débloque aussi l'édition des capacités `Effect`**, qui est réellement exploitée par le moteur mais impossible à renseigner aujourd'hui.

---

## 3. Refactor minimal proposé (1 bloc unifié)

### 3.a. Nouvelle constante (module scope, à placer juste après `CHANNEL_TYPES`, ~ligne 6730)

```tsx
const CAPABILITY_LABELS: Record<string, string> = {
  Colour: 'Colors',
  Gobo: 'Gobo Patterns',
  Macro: 'Macros',
};
```

### 3.b. `addCapability` rendu type-aware (remplace lignes 6868-6872)

```tsx
const addCapability = (target: 'create' | 'edit', mi: number, ci: number) => {
  const [modes] = target === 'create' ? [createModes] as const : [editModes] as const;
  const ch = modes[mi].channels[ci];
  const cap: { min: number; max: number; name: string; color?: string } = { min: 0, max: 255, name: 'New Capability' };
  if (ch.type === 'Colour') cap.color = '#ff0000';
  updateChannel(target, mi, ci, { capabilities: [...(ch.capabilities || []), cap] });
};
```

> Important : ne **plus** injecter `color` pour les types non-Colour, sinon les capacités non-couleur porteraient un `color` parasite (et l'analyseur utilise `cap.color` comme signal de wheel couleur, lignes 131-136).

### 3.c. Bloc unifié remplaçant les 3 blocs (lignes 6964-7037)

```tsx
      <div className="ml-7 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-gray-500 uppercase tracking-wider">{CAPABILITY_LABELS[ch.type] ?? 'Capabilities'}</span>
          <button onClick={() => addCapability(target, mi, ci)}
            className="text-[9px] text-purple-400 hover:text-purple-300 flex items-center gap-1">
            <Plus size={10} /> Add
          </button>
        </div>
        {(ch.capabilities || []).map((cap, cci) => (
          <div key={cci} className="flex items-center gap-1.5">
            <span className="text-[9px] text-gray-600 w-5 shrink-0">{cci + 1}</span>
            <input type="number" value={cap.min} onChange={(e) => updateCapability(target, mi, ci, cci, { min: Math.max(0, Math.min(255, parseInt(e.target.value) || 0)) })}
              className="w-12 bg-gray-800/50 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-300 font-mono outline-none" placeholder="0" />
            <span className="text-[9px] text-gray-600">–</span>
            <input type="number" value={cap.max} onChange={(e) => updateCapability(target, mi, ci, cci, { max: Math.max(0, Math.min(255, parseInt(e.target.value) || 0)) })}
              className="w-12 bg-gray-800/50 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-300 font-mono outline-none" placeholder="255" />
            <input type="text" value={cap.name} onChange={(e) => updateCapability(target, mi, ci, cci, { name: e.target.value })}
              className="flex-1 min-w-0 bg-gray-800/50 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-300 outline-none" placeholder="Name" />
            {ch.type === 'Colour' && (
              <input type="color" value={cap.color || '#ff0000'} onChange={(e) => updateCapability(target, mi, ci, cci, { color: e.target.value })}
                className="w-6 h-5 rounded cursor-pointer border-0 p-0 bg-transparent shrink-0" />
            )}
            <button onClick={() => removeCapability(target, mi, ci, cci)} className="text-gray-500 hover:text-red-400 shrink-0" title="Remove"><X size={10} /></button>
          </div>
        ))}
      </div>
```

**Points clés du bloc :**
- Un **seul** bloc, rendu pour **tous** les types (plus aucun `&& ch.type === …`).
- Libellé dynamique : `CAPABILITY_LABELS[ch.type] ?? 'Capabilities'`.
- Le `<input type="color">` n'apparaît que si `ch.type === 'Colour'`.
- `min`/`max`/`name` inchangés (mêmes handlers `updateCapability`, mêmes clamps 0-255).

---

## 4. Observations annexes (hors périmètre, à confirmer)

1. **Bug de mapping au préchargement** (create tab, lignes **6747-6750**) : le mapping de `preloadedFixture` utilise les clés `defaultVal` et `caps`, alors que `EditorChannel` attend `defaultValue` et `capabilities`. Conséquence : en édition d'une fixture préchargée, `defaultValue` et `capabilities` sont **perdus** dans l'onglet Create. À corriger indépendamment (renommer les clés dans ce mapping).

2. Le sous-menu de capacités apparaîtra désormais aussi pour `Nothing` et `Maintenance`. C'est **sans danger** (l'analyseur ignore ces types), mais visuellement un peu inutile. Le besoin utilisateur étant explicite (« TOUTES les options »), on ne filtre pas ; si souhaité, on pourrait exclure `Nothing` uniquement.

---

## Résumé

L'éditeur de fixtures (`DesignView.tsx`) définit 14 types de canaux (`CHANNEL_TYPES`, ligne 6726) mais `renderChannel` (ligne 6944) n'affiche le sous-menu de capacités (min/max/nom, + couleur pour Colour) que pour **Colour** (l.6964), **Gobo** (l.6990) et **Macro** (l.7014) via trois blocs quasi identiques. Le refactor minimal consiste à remplacer ces trois blocs (l.6964-7037) par **un seul bloc** rendu pour tous les types : libellé via une constante `CAPABILITY_LABELS` (fallback « Capabilities »), `<input type="color">` conditionné à `ch.type === 'Colour'`. Il faut aussi rendre `addCapability` (l.6868) type-aware pour ne plus injecter `color:'#ff0000'` sur les types non-couleur. Côté cohérence éditeur/analyseur : `Strobe` n'est pas reconnu par l'analyseur (seul `Shutter` l'est) — ajouter `case 'Strobe':` de façon additive ; `Zoom`/`Frost`/`Focus`/`Iris` sont reconnus mais absents de l'éditeur — les ajouter à `CHANNEL_TYPES` ; `Nothing`/`Maintenance` sont ignorés silencieusement par l'analyseur (sûr, aucune action). Bonus : généraliser le sous-menu débloque aussi l'édition des capacités `Effect` déjà consommées par le moteur. Un bug annexe (préchargement create-tab avec clés `defaultVal`/`caps`) mérite correction séparée.
