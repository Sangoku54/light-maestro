# Intégration de librairies de fixtures — état vérifié

> Vérifié le 2026-08-23 (inspection directe du code + clone sparse du dépôt QLC+ + recherche web sourcée).

## 1. Ce que Light Maestro supporte déjà (vérifié dans le code)

| Format | Méthode de parsing | Source | Compte embarqué |
|---|---|---|---|
| QXF (QLC+) | `parseQLC` (lit manufacturer/model depuis le XML, pas le nom de fichier) | `resources/fixtures/**/*.qxf` | **1730** |
| OFL (JSON) | `parseOFLFixture` (+ `OFL_MANUFACTURER_MAP` clé fabricant → nom propre) | `resources/fixtures/ofl/` | **~627** |
| JSON custom | `addCustom` (éditeur de fixture) | `userData/fixtures/` | 2 (Tonio 6 arm, Stage Wash 7x10W) |

- **Loader récursif** : `getAllFiles(dir, '.qxf', '.json')` parcourt les sous-dossiers → compatible avec la **nouvelle structure QLC+ en sous-dossiers par fabricant** (`Chauvet/`, `Martin/`, `Robe/`…).
- **Import manuel** : IPC `fixtures:importQLC` (charger un `.qxf`), `fixtures:addCustom`, `fixtures:reloadLibrary`.
- **Auto-updater OFL** : `electron/fixtures/updater.ts` télécharge la dernière version depuis GitHub au démarrage (rate-limit 1/h), stocke dans `userData/ofl-fixtures/` et écrase la version embarquée.

## 2. État des librairies externes

### QLC+ — déjà quasi à jour
- Dépôt : <https://github.com/mcallegari/qlcplus> (dossier `resources/fixtures/`).
- **1735 `.qxf`** sur `master` (clone sparse mesuré) vs **1730 embarqués** → delta réel ≈ **5 fixtures**.
- La lib n'a pas grossi : elle a été **réorganisée en sous-dossiers par fabricant** (structure déjà gérée par notre loader).
- Licence : **Apache 2.0** (passage récent depuis GPL v2 — voir `COPYING`).
- ⚠️ Corrigé : une recherche par code GitHub donnait « 1812 fichiers » (inclut `qlcplus-extras`/branches) ; le compte réel sur master est **1735**.

### Open Fixture Library (OFL) — déjà couverte + auto-mise à jour
- Site : <https://open-fixture-library.org/> — **629 fixtures**, licence **MIT**, très actif.
- Format JSON interne, exportable vers de nombreux formats cibles (dont QLC+ 4.12.2).
- Déjà embarquée (~627) **et** déjà rafraîchie automatiquement par `updater.ts`.

### GDTF — le seul vrai gisement restant
- **7 000+ fichiers** sur <https://gdtf-share.com/> (source : gdtf.eu, « surpassed 7000 »).
- Standard ouvert promu par **MA Lighting, Robe, Vectorworks** (GDTF Group, 2019).
- Format `.gdtf` = **ZIP** (`description.xml` + modèles 3D glTF + `wheels/` gobos 300×300).
- **Non supporté** actuellement → nécessite un parser dédié. Licence par fichier (fourni par fabricant/utilisateur), à valider au cas par cas.

### Autres sources
- **ETC Fixture Library Hub** : <https://fixture-library-hub.etcconnect.com/> (profils Eos, téléchargement en masse possible).
- **fixture-converter** (Flo Edelmann) : <https://github.com/FloEdelmann/fixture-converter> — conversion entre formats.
- **qlcplus-extras** : <https://github.com/mcallegari/qlcplus-extras> — fixtures additionnelles, gobos, templates.
- **Fabricants** (Chauvet, ADJ, Martin, Robe) : publient leurs GDTF/profils, généralement déposés aussi sur gdtf-share.com.

## 3. Conclusion

Les deux grosses bibliothèques ouvertes — **QLC+ et OFL** — sont **déjà entièrement couvertes** (QLC+ delta ≈ 5 fixtures, OFL auto-mise à jour). Le seul gain significatif restant est le support **GDTF** (7 000+ fichiers, standard pro).

## 4. Plan d'intégration GDTF (scope, pour chantier à venir)

1. **Parser** `electron/fixtures/gdtf.ts` : dézip `.gdtf`, parser `description.xml` → `FixtureDefinition` (réutiliser le mapping de presets existant de `parseQLC`).
2. **Chargement** : nouveau `loadGdtfDirectory(dir)` (ou extension de `loadDirectory` l.524) — `.gdtf` dans un dossier `resources/fixtures/gdtf/` + `userData/gdtf-fixtures/`.
3. **IPC/preload** : handler `fixtures:importGDTF` + exposition dans l'objet `fixtures` du preload.
4. **Tests** : fixtures GDTF d'exemple (petites, sans 3D lourd) → tests unitaires du parser + de l'import.
