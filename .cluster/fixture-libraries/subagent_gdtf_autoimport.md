# GDTF : import auto vs manuel — verdict de conception

**Date** : 2026-08-23 · **Auteur** : subagent relecture technique
**Question** : importer les `.gdtf` automatiquement au lancement (scan `userData/fixtures/gdtf/`) ou via bouton manuel ?

## Verdict : **LES DEUX** (auto-scan tolérant aux erreurs + bouton manuel)

Auto-scan d'un dossier utilisateur au démarrage **par défaut**, avec try/catch par fichier
(skip + log des invalides), ET un bouton « Importer un fichier… » pour les `.gdtf` hors dossier.
L'auto-scan seul est fragile ; le manuel seul est pénible pour un flux « je dépose mes fixtures ».

---

## 1. Convention industrie (recherche vérifiée)

| Outil | Comportement | Détail |
|---|---|---|
| **QLC+** | **Auto-scan d'un dossier user au démarrage** | Custom fixtures déposées dans `~/.qlcplus/fixtures` (Linux) / `C:\Users\<user>\QLC+\fixtures` (Win) sont chargées au lancement. Les users demandent même un bouton « rescan ». C'est LA référence pertinente : Light Maestro est compatible QLC+ et vise le même segment. |
| **grandMA2/3** | Manuel | `Patch → Fixture Types → Import`, choix du `.gdtf` (USB/dossier). Pas de scan au boot. |
| **ChamSys MagicQ** | Manuel | File manager → sélection du `.gdtf` (1er constructeur à importer GDTF nativement, mais manuel). |
| **Onyx (Obsidian)** | Manuel / pas de GDTF user direct | Pas d'import GDTF utilisateur à ce jour ; GDTF sert à *collecter* la lib interne. Librairie user = dossier `C:\Users\Public\Documents\Obsidian\Onyx\Fixture Library`, mise à jour via menu « Update Fixture Library » (téléchargement + import manuels). |
| **Capture** | Manuel + bibliothèque embarquée | GDTF majoritairement intégré en usine ; import/échange via CITP, pas de scan dossier au boot. |
| **Vectorworks Vision** | Manuel + commande batch | GDTF importé manuellement ; VW2025 ajoute « GDTF File Mapping » = mise à jour en masse des profils *déjà assignés* (commande déclenchée manuellement, pas un scan au lancement). |
| **Lightkey** | Manuel | Énorme bibliothèque intégrée ; profils customs via wizard/import manuel. |

**Lecture** : les grosses consoles (MA, MagicQ, Onyx, Vision) sont en **import manuel**.
Le seul acteur en **auto-scan dossier au démarrage** est QLC+ — précisément le modèle de
Light Maestro (compat QLC+, cible budget/home). → l'auto-scan est cohérent avec le positionnement,
à condition d'être blindé contre les fichiers pourris (axe 2).

---

## 2. Risques concrets de l'auto-import au lancement (et parades)

1. **`.gdtf` corrompu / `description.xml` malformé qui plante le démarrage.**
   *Parade* : try/catch **par fichier** (déjà présent dans `loadGdtfDirectory`), le parser
   `parseGdtfXml` renvoie déjà `null` + `console.warn` au lieu de throw. Ne jamais laisser une
   exception remonter au `load()` global. Un fichier KO = skip + log, jamais crash.

2. **Latence de démarrage (parsing de N fichiers ZIP + XML).**
   *Parade* : le parsing est synchrone (`fs.readFileSync` + `zlib.inflateRawSync`). Avec N petit
   (< 50 fichiers) c'est négligeable, mais l'auto-scan doit : (a) ne lire que `description.xml`
   (déjà fait — on ignore `wheels/`, `models/`), (b) garder un budget : logger le temps total,
   et si N devient grand, déplacer le scan en async différé après le 1er render (voir axe 4).

3. **Doublons : même fixture re-importée (même manufacturer+model sous un autre id).**
   *Parade* : `hasFixture(manufacturer, model)` utilise une clé normalisée `manufacturer-model`
   (déjà en place). L'auto-scan doit **skip** les doublons (comportement actuel), et le manuel
   doit **écraser** explicitement. Attention au piège : deux fabricants de fichiers peuvent donner
   des ids différents (`RoboSpot` vs `Robo-Spot`) → s'appuyer sur la clé normalisée, pas sur `def.id`.

4. **Mise à jour d'un fichier déjà importé (nouvelle version du .gdtf).**
   *Parade* : en auto-scan, décider d'une politique claire — par défaut **skip si déjà présent**
   (pas d'écrasement silencieux, sinon l'utilisateur perd ses éditions). Offrir l'écrasement via le
   bouton manuel (ré-import = overwrite). Option avancée : comparer `Revisions/Revision/@Date` ou un
   hash du fichier pour proposer une mise à jour.

5. **Fichier `.gdtf` valide ZIP mais `description.xml` absent / nommé différemment / Zip64.**
   *Parade* : `readZipEntry` gère déjà stored+deflate et rejette Zip64 explicitement. Ajouter un
   log clair « GDTF ignoré : description.xml introuvable » pour que l'utilisateur comprenne
   pourquoi sa fixture n'apparaît pas (sinon bug invisible).

---

## 3. Mécanisme recommandé

**Auto-scan + bouton, avec ces règles :**

- **Dossier par défaut** : `app.getPath('userData')/fixtures/gdtf/` (miroir du dossier QXF/JSON
  user déjà géré `userData/fixtures`). Créer le dossier au premier lancement + un README qui
  explique « dépose tes .gdtf ici, ils sont chargés au démarrage ».
- **Ordre de chargement** (dans `FixtureLibrary.load()`) : bibliothèque embarquée
  (`resources/fixtures/gdtf/`) d'abord, puis **auto-scan user** `userData/fixtures/gdtf/` avec
  écrasement/override des ids identiques (même logique que `loadOflDirectory` user, `overwrite: true`).
- **Tolérance** : un try/catch par fichier, `console.warn` + compteur `skipped`, et un log
  diagnostic dans `userData/logs/fixture-library.log` (infra déjà en place) listant les fichiers
  ignorés et pourquoi.
- **Bouton manuel** : réutiliser `importGDTF(filePath)` existant (dialog fichier) → parse → `add()`
  → persist en `.json` dans `userData/fixtures`. Utile pour les `.gdtf` ailleurs (USB, Downloads).
- **Feedback UI** : exposer le résultat du scan (added / skipped) pour que l'utilisateur voie
  « 3 fixtures GDTF importées, 1 ignorée (corrompue) ».

---

## 4. Pièges Electron / Node

1. **Lecture récursive** : `getAllFiles()` (déjà en place) utilise
   `fs.readdirSync(dir, { withFileTypes: true })` + récursion — correct et portable. Éviter la
   récursion sans garde-fou sur les symlinks/boucles (un dossier pointant sur lui-même → boucle
   infinie). `withFileTypes` ne suit pas les symlinks par défaut (safe). Ne PAS remplacer par
   `fs.readdir` async + promesse imbriquée sans contrôle d'ordre — l'ordre de chargement
   (embarqué < user) doit être déterministe.

2. **`userData`** : `app.getPath('userData')` n'est **pas disponible avant `app.whenReady()`**.
   Le `load()` de la bibliothèque doit être appelé après ready. En mode dev vs packagé, le chemin
   diffère (`%APPDATA%/<app>` vs nom packagé) → ne pas hardcoder. Le dossier doit être créé avec
   `fs.mkdirSync(dir, { recursive: true })` avant le scan (sinon `existsSync` = false → silencieux).

3. **Ordre de chargement vs bibliothèque embarquée** : charger l'embarqué d'abord puis le user en
   override, sinon une fixture user avec un id identique serait silencieusement ignorée (déjà le
   comportement OFL). L'auto-scan GDTF doit suivre la même convention que
   `userOflDir` → `overwrite: true`.

4. **Blocage du main process** : parsing ZIP+XML synchrone au démarrage = gel de la fenêtre si N
   est grand. Pour l'auto-scan, soit garder synchrone avec N borné + budget loggé, soit différer
   le scan après `did-finish-load` et le rendre asynchrone (`await` par fichier). Pas de
   `child_process` nécessaire à ce stade.

5. **Encoding / asar** : les fixtures user sont hors asar (dans `userData`), OK. Les fixtures
   embarquées dans `resources/fixtures/gdtf` doivent être exclues de l'asar ou lues via
   `fs.readFileSync` sur un chemin `resourcesPath` (déjà géré par `resolveBundledFixturesRoot`).
   Vérifier que `loadGdtfDirectory` est bien appelé sur le chemin résolu, pas un chemin en dur.

---

## Recommandations d'implémentation (précises)

1. **Ajouter dans `FixtureLibrary.load()`** (après le bloc GDTF embarqué, avant/avec le user) :
   ```ts
   const userGdtfDir = path.join(app.getPath('userData'), 'fixtures', 'gdtf');
   if (fs.existsSync(userGdtfDir)) {
     const r = await this.loadGdtfDirectory(userGdtfDir, { overwrite: true });
     logFixtureDiagnostic(`user GDTF scan: +${r.added} skip=${r.skipped}`);
   }
   ```
   Étendre `loadGdtfDirectory(dir, options?: { overwrite?: boolean })` pour écraser les ids déjà
   présents quand `overwrite` est vrai (réutiliser la logique de `loadOflDirectory`).

2. **Rendre `loadGdtfDirectory` robuste et instrumenté** : déjà try/catch par fichier + skip doublon.
   Ajouter : (a) log explicite quand `description.xml` introuvable, (b) compteur `skipped` déjà
   présent, (c) mesure du temps de scan total (à logguer, pas à throw).

3. **Bouton manuel = réutiliser `importGDTF()` existant**, en le connectant à un dialog
   `dialog.showOpenDialog({ filters: [{ name: 'GDTF', extensions: ['gdtf'] }] })`, puis re-scan de
   l'UI (ou push de la fixture dans le state) pour feedback immédiat. Le persist en `.json` dans
   `userData/fixtures` assure la survie au restart, même sans re-scan du `.gdtf` d'origine.
