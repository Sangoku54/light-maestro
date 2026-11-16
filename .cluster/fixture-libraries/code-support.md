# Support code des librairies de fixtures — État des lieux

> Vérification croisée en lecture seule du code actuel (aucun fichier modifié).
> Références : `electron/fixtures/library.ts`, `electron/fixtures/updater.ts`,
> `electron/main.ts`, `electron/preload.ts`, `electron/fixtures/generate-fallbacks.cjs`.

## 1. Formats déjà supportés

Le cœur est la classe `FixtureLibrary` (`library.ts`). Elle sait produire des
`FixtureDefinition` (interface déclarée lignes ~40-90) depuis **3 formats** :

| Format | Méthode de parsing | Signature | Ce qu'elle accepte |
|---|---|---|---|
| **QXF** (QLC+ XML) | `parseQLC` (l. 579) | `(xml: string, filePath?: string) => Promise<FixtureDefinition \| null>` | Chaîne XML, parse via `xml2js` (`parseStringPromise`). Structure `<FixtureDefinition>` : `<Manufacturer>`, `<Model>`, `<Creator><Author>`, `<Channel Preset/Group>`, `<Capability>`, `<Mode>`, `<Physical>`, `<Head>`. |
| **OFL** (Open Fixture Library JSON) | `parseOFLFixture` (l. 788) | `(json: string, manufacturerKey: string) => FixtureDefinition \| null` | Chaîne JSON + **clé fabricant** (nom du dossier). Parse `name`, `categories`, `meta.authors`, `availableChannels`, `fineChannelAliases`, `switchingChannelAliases`, `templateChannels`, `matrix` (pixelKeys/pixelGroups), `modes`, `physical`. |
| **JSON custom** (Light Maestro) | pas de parseur dédié — `JSON.parse` direct | via `loadDirectory` (l. 524) | Objet JSON déjà au format `FixtureDefinition` (id, manufacturer, model, type, modes…). |

Points notables du parseur QXF :
- Typage des canaux via `groupToType` (l. ~155) et `presetToType` (l. ~140) avec
  table `PRESET_TYPE_MAP`.
- ID construit `${manufacturer}-${model}` nettoyé (l. ~570) ; stocke aussi
  `qlcplusFile` = basename du fichier source.

Points notables du parseur OFL :
- Mapping type via `OFL_TYPE_MAP` + `oflCapTypeToChannelType` (l. ~260) : gère les
  `WheelSlot`/`WheelRotation` (devine Colour vs Gobo par le nom du canal).
- `normalizeOflDefault` (l. ~280) : valeur par défaut 16-bit → octet haut DMX.
- Gère `fineChannelAliases` et `switchingChannelAliases` (clones typés du parent).
- Gère les templates `$pixelKey` / `$pixelGroup` et les `matrixChannels`
  (résolution de pixels, ordre `perPixel`/`perChannel`).
- Skip explicite des fichiers `redirectTo` (`fixture-redirect.json`), l. ~795.
- Mapping clé fabricant → nom propre via `OFL_MANUFACTURER_MAP` (l. ~290).

## 2. Chemins de chargement

Méthode `load()` (l. 481) orchestre l'ordre exact suivant :

1. **Bundled QXF/JSON** : `resolveBundledFixturesRoot()` (l. 450) résout
   `<appPath>/resources/fixtures` ou `<resourcesPath>/app/resources/fixtures`
   (fallback pour packaging asar). Chargé par `loadDirectory` → récursif via
   `getAllFiles(dir, '.qxf', '.json')` (l. ~430).
2. **Bundled OFL** : `<fixturesDir>/ofl` (l. 499), chargé par `loadOflDirectory`
   **sans** `overwrite`.
3. **OFL userData (override)** : `<userData>/ofl-fixtures` (l. 505), chargé par
   `loadOflDirectory(..., { overwrite: true })` → écrase les fixtures bundled de
   même ID.
4. **Custom userData** : `<userData>/fixtures` (l. 514), chargé par `loadDirectory`
   (QXF + JSON).

**Priorité / dédup** : `add()` (l. 1221) est idempotent (remplace par `def.id`).
La dédup pour OFL utilise `hasFixture(manufacturer, model)` (l. 1215) basé sur une
clé normalisée (`normalizeKey`, l. ~1210). Conséquence : OFL userData écrase
bundled ; custom userData écrase tout ce qui a le même `id`.

Note : `load()` **réinitialise** tout à chaque appel (clear des maps/index,
`budgetCache = null`) — c'est un rechargement complet.

## 3. Mécanismes d'import / MAJ existants

**Handlers IPC** (`main.ts` l. 511-522) :
- `fixtures:loadLibrary` → `load()`
- `fixtures:search` → `search(query)`
- `fixtures:getDefinition` → `get(id)`
- `fixtures:addCustom` → `addCustom(def)`
- `fixtures:importQLC` → `importQLC(filePath)`
- `fixtures:getAll` → `getAll()`
- `fixtures:getBudgetList` → `getBudgetList()`
- `fixtures:reloadLibrary` → `load()` + `{ count }`
- `fixtures:getUpdateStatus` → `getFixtureUpdateStatus()` (updater)

**Preload** (`preload.ts` l. 31-47) expose `window.api.fixtures.{...}` avec les
mêmes méthodes, plus deux abonnements événements :
`onUpdateStatus(cb)` → `fixtures:update-status` et `onUpdateComplete(cb)` →
`fixtures:update-complete`.

**Import QLC manuel** : `importQLC(filePath)` (l. 1196) lit le fichier, parse en
QXF, `add()` puis **persiste** en JSON dans `<userData>/fixtures/<id>.json`.

**Custom** : `addCustom(def)` (l. 1235) force `def.id = custom-...`, `add()` puis
persiste en JSON dans `<userData>/fixtures/<id>.json`.

**Updater OFL auto** (`updater.ts`) :
- `checkForFixtureUpdates(onStatusChange)` : démarrage (main.ts l. 868), non
  bloquant, **rate-limit 1 check/heure**.
- Récupère le dernier SHA commit de
  `https://api.github.com/repos/open-fixture-library/fixtures/commits/main`
  (`fetchLatestSha`).
- Compare au SHA stocké dans `<userData>/ofl-last-sha.txt` ; premier run lit le
  SHA bundled depuis `resources/fixtures/ofl-commit-sha.txt`.
- Si différent : télécharge
  `https://github.com/open-fixture-library/fixtures/archive/refs/heads/main.zip`,
  extrait (PowerShell `Expand-Archive` sur Windows, `unzip` sinon), copie
  **uniquement les `.json`** (structure `fixtures-main/fixtures/<mfr>/<fixture>.json`)
  vers `<userData>/ofl-fixtures/` (en vidant l'ancien dossier), met à jour SHA +
  timestamp.
- Statut via `getUpdateStatus()`.

## 4. Ce qui manquerait pour un nouveau format (ex. GDTF)

GDTF est un ZIP contenant `description.xml` + 3D/geometry. Aucun support
aujourd'hui. Pour l'ajouter, il faudrait intervenir à ces endroits précis :

1. **Un nouveau parseur** : à côté de `parseQLC` (l. 579) et `parseOFLFixture`
   (l. 788), ajouter ex. `parseGDTF(bufferOrPath)` retournant un
   `FixtureDefinition`. GDTF nécessite : dézipper (le code a déjà `extractZip`
   dans `updater.ts`, réutilisable), parser `description.xml` (DMX channels,
   channel functions, geometry references), résoudre `wheels`/`gobos` si besoin.
   Le mapping type GDTF → `FixtureChannel['type']` serait à écrire (équivalent
   de `OFL_TYPE_MAP`).
2. **Point d'entrée de chargement** : `loadDirectory` (l. 524) ne cherche que
   `.qxf` et `.json` (`getAllFiles(dir, '.qxf', '.json')`, l. 525). Il faudrait
   étendre les extensions (ex. `.gdtf`) et brancher le parseur dans la boucle
   (l. 526-538).
3. **Import manuel** : ajouter un handler IPC + une méthode `importGDTF` symétrique
   à `importQLC` (l. 1196), et l'exposer dans `preload.ts` (objet `fixtures`,
   l. 32-46).
4. **Persistance custom** : GDTF importé devrait être converti en JSON custom
   dans `<userData>/fixtures/` (même logique que `importQLC`/`addCustom`).
5. **(Optionnel) Updater** : un updater GDTF (ex. gdtf-library / gdtf.eu) serait
   un clone de `updater.ts` mais il n'y a **pas** d'infrastructure générique
   multi-sources aujourd'hui — tout est hardcodé OFL.

## 5. Surprises / capacités faciles à rater

- **`reloadLibrary` ne persiste rien** : il recharge depuis le disque ; les
  imports QLC/custom sont déjà écrits sur disque donc survivent, mais tout ce
  qui serait ajouté en mémoire sans persistance serait perdu.
- **Budget "Budget < 100 €"** : `getBudgetList()` (l. 1291) lit
  `resources/fixtures/ofl/budget.json` — un fichier racine du dossier `ofl/`
  qui est **ignoré** par `loadOflDirectory` (qui n'itère que les sous-dossiers
  fabricants). Le commentaire avertit de ne pas le déplacer dans
  `resources/fixtures/` sinon il serait parsé comme fixture par `loadDirectory`.
  C'est un format de données métier séparé, pas une fixture.
- **`generate-fallbacks.cjs`** : script Node autonome (pas exécuté au runtime)
  qui génère des `FixtureDefinition` JSON "populaires" dans `resources/fixtures/`
  quand le téléchargement QLC+ est indisponible. C'est une source de fixtures
  bundled en JSON custom, pas un nouveau format de parse.
- **`getAllFiles` récursif** : le chargement QXF/JSON est récursif sur les
  sous-dossiers, donc on peut organiser `resources/fixtures/` en arborescence.
- **Updater non-versionné côté manifeste** : l'updater télécharge tout le repo
  OFL à chaque SHA changeant (aucune granularité par fabricant/fixture).
- **Pas d'API de suppression de fixture** : le CRUD (`add`, `addCustom`, `get`,
  `search`, `getAll`, `getByType`, `getByManufacturer`, `getStats`,
  `createInstance`) n'a **pas** de `remove`/`delete` exposé ni persisté.

### Réponse directe à la question

Oui, on peut intégrer d'autres librairies, avec deux niveaux d'effort :
- **Effort faible** : tout format convertible en `FixtureDefinition` JSON peut
  être déposé dans `resources/fixtures/` (ou `<userData>/fixtures/`) et sera
  chargé automatiquement — aucun code à toucher si on fait la conversion en
  amont (c'est déjà ce que fait `generate-fallbacks.cjs`).
- **Effort réel (nouveau format natif comme GDTF)** : ajouter un parseur +
  étendre `loadDirectory` (extensions) + un handler IPC `import*` + exposition
  preload, aux points listés en §4. L'architecture est prête (le `FixtureDefinition`
  est un format pivot), mais rien n'est générique aujourd'hui : OFL est hardcodé
  dans l'updater et QXF/OFL/JSON dans le loader.
