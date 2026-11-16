# Support GDTF — implémentation livrée (parser + intégration)

> 2026-08-23 · Implémentation du support d'import de fixtures **GDTF** dans Light Maestro.

## Ce qui a été construit

### Nouveau module — `electron/fixtures/gdtf.ts`
Parser autonome (aucune dépendance `electron` → testable sous vitest) :

- `parseGdtfXml(xml)` → `FixtureDefinition` : lit `FixtureType/@Manufacturer` + `@Name`/`@ShortName`, l'arbre `Geometries` (référencé par **nom**), et `DMXModes → DMXMode → DMXChannels → DMXChannel → LogicalChannel → ChannelFunction → ChannelSet`.
- `gdtfAttributeToType(attr)` : mapping attribut GDTF → type de canal (Dimmer→Intensity, ColorAdd_R/G/B→Colour, Pan/Tilt, Gobo(n), Shutter(n), Prism(n), Zoom/Frost/Iris→Beam, NoFeature→Nothing, etc.).
- `readZipEntry(zip, entry)` : lecteur ZIP minimal (stored + deflate via `inflateRawSync`), **sans dépendance** — le `.gdtf` est un ZIP dont on ne lit que `description.xml`.
- `readGdtfDescriptionXml(path)` / `parseGdtfFile(path)` : extraction + parsing d'un fichier `.gdtf`.

### Intégration
- `library.ts` : méthode `importGDTF(filePath)` (parse + `add` + persistance `userData/fixtures/<id>.json`), méthode `loadGdtfDirectory(dir)`, et chargement du dossier `resources/fixtures/gdtf/` dans `load()`.
- `main.ts` : handler IPC `fixtures:importGDTF`.
- `preload.ts` : exposition `fixtures.importGDTF(filePath)`.
- `src/types.d.ts` : type `importGDTF`.

### Tests — `src/__tests__/gdtf-parse.test.ts` (10 tests)
Mapping attribut→type, parsing complet (manufacturer/model/type, tri par Offset, capacités depuis ChannelSets, canal virtuel `Offset="None"` ignoré), color wheel (slots → hex), **canaux 16 bits** (émission du canal fine), **multi-LogicalChannel** (seul le 1er est gardé), lecteur ZIP stored + deflate.

## Revue adversarial — corrections appliquées

| # | Sévérité | Problème | Correction |
|---|---|---|---|
| H1 | Haute | Canaux 16 bits (`Offset="1,2"`) écrasés sur 1 slot → footprint DMX faux | Émission d'un canal **fine** (`<nom> fine`) au slot LSB ; footprint `channels.length` correct |
| H2 | Haute | Multi-`LogicalChannel` concaténés (sous-modes exclusifs) → plages qui se chevauchent | Seul le 1er `LogicalChannel` est conservé (mode par défaut) |
| M2 | Moyenne | `id` vide si manufacturer/model non-ASCII | Fallback sur le GUID `FixtureTypeID` |
| M3 | Moyenne | Suffixe `s` de `DMXValue` ignoré (`255/1s` = 65280) | Shift + élargissement (`value << 8*n`, `byteCount+1`) |
| L1 | Basse | Zip64 non détecté → parse faux | Rejet explicite des sentinelles Zip64 |
| L3 | Basse | Pas de check signature local header | Vérification `0x04034b50` |
| L4 | Basse | Scan EOCD sur tout le buffer | Scan limité aux 64 Ko de fin |
| L6 | Basse | Mapping attribut→type incomplet | Ajout PanTiltSpeed, PanTiltMode, EffectSpeed, StrobeMode, ZoomMode, ColorWheel… |

## Limitations documentées (non bloquantes)

- **M1** : `importGDTF` écrase une fixture de même id (convention identique à `importQLC` existant).
- **M4** : noms dupliqués si une géométrie est réutilisée (pixels / `GeometryReference` multi-instances).
- **Relations / virtual dimmers** (`<Relations>` Master/Follower) non représentées — le canal virtuel (`Offset="None"`) est sauté.
- **L5** : le champ `qlcplusFile` porte le nom du fichier `.gdtf` (réutilisation du seul champ « source file » disponible).

## Comment l'utiliser

- **Import d'office au lancement (zéro clic)** : déposer des `.gdtf` dans le dossier utilisateur `<userData>/gdtf-fixtures/` (créé automatiquement) → chargés au démarrage via `loadGdtfDirectory`. Les fichiers embarqués `resources/fixtures/gdtf/` passent par le même mécanisme.
- **API exposée** : `window.lightMaestro.fixtures.importGDTF(cheminFichier.gdtf)` → parse + ajoute + persiste (pour les fichiers hors dossier).

## Import auto vs bouton — décision

Vérification croisée : les consoles pros (grandMA2/3, ChamSys, Onyx, Capture, Vectorworks Vision, Lightkey) importent en manuel ; seul **QLC+** scanne un dossier user au démarrage (`~/.qlcplus/fixtures`). Light Maestro étant compatible QLC+, l'auto-scan est cohérent. Verdict : **les deux** — auto-scan du dossier user (tolérant : try/catch par fichier, dédoublonnage `manufacturer-model`, fichier ignoré loggé) + bouton optionnel pour les fichiers hors dossier.

Décision : l'auto-scan reste en **skip par défaut** (pas d'override). L'option `overwrite: true` (pour qu'un fichier user écrase un GDTF embarqué, sur le modèle de `loadOflDirectory`) est reportée : aucun GDTF n'est encore embarqué, donc rien à écraser à ce stade. À réactiver quand on bundlera des `.gdtf`.

## Étapes suivantes (recommandées)

1. **UI (optionnel)** : bouton « Importer un .gdtf » (`dialog:openFile` + `importGDTF` + `reloadLibrary`) pour les fichiers hors dossier — l'auto-scan couvre déjà le cas principal.
2. **Exe** : recompiler `npm run dist` pour embarquer le parser + l'auto-import dans le `.exe` portable.
3. **Bundler** des `.gdtf` réels (téléchargement depuis gdtf-share.com, licence par fichier à vérifier).
