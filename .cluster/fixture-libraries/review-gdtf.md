# Revue adversarial — parser GDTF (`electron/fixtures/gdtf.ts`)

Date : 2026-08-23 · Reviewer : subagent adversarial · Source de vérité : `subagent_gdtf_schema.md` (spec officielle `gdtf-spec.md`).

Le parser **lit correctement** la structure XML (noms d'éléments/attributs conformes, Offset 1-based, « fin = DMXFrom du suivant − 1 », skip des ChannelSets sans nom, fallback `NoFeature`). Le mapping XML de base est bon. Mais il y a **deux bugs bloquants** sur la sémantique DMX réelle (canaux 16 bits et multi-LogicalChannel), plus plusieurs risques d'intégration.

---

## 1. Bugs — sévérité haute

### H1 — Les canaux 16 bits sont écrasés sur un seul slot DMX → adressage faux
- **Fichier/ligne** : `gdtf.ts:335-347` (`raw.push({ slot: offset.slots[0], ... })`) + absence de champ « largeur » dans `FixtureChannel` (`library.ts:31-35`) et `FixtureInstance` (`library.ts` `channelCount`/`getChannelMap`).
- **Description** : `parseOffset` lit bien `Offset="1,2"` comme `slots=[1,2], byteCount=2`, mais le parser n'émet **qu'un seul** `FixtureChannel` (clé de tri = `slots[0]` seulement). Le slot « fine » (`slots[1]`) est **jeté** : il n'apparaît nulle part dans `modes[].channels`.
- **Pourquoi c'est un problème** : `FixtureInstance.channelCount = mode.channels.length` et `getChannelMap()` mappent `startAddress + i`. Un Pan 16 bits en `Offset="1,2"` suivi d'un Tilt en `Offset="3"` donne : Pan → adresse 1, Tilt → adresse 2. Or Tilt doit être à l'adresse **3**, et l'adresse 2 est le fine du Pan qui n'est **jamais piloté**. Toute fixture avec des canaux 16 bits (Pan/Tilt/Dimmer fins — très fréquent chez les têtes mobiles) a un footprint DMX faux et des canaux décalés d'un slot. C'est le bug le plus grave.
- **Correction** : soit (a) ajouter une notion de largeur (ex. `FixtureChannel.width: number`) et faire émettre un canal « fine » dédié (ou un `span`), et corriger `channelCount`/`endAddress`/`getChannelMap` pour tenir compte des slots ; soit (b) au minimum réserver le slot fine dans le mapping d'adresses. Ne pas livrer en l'état.

### H2 — Plusieurs `LogicalChannel` sont concaténés → ranges qui se chevauchent et sémantique fausse
- **Fichier/ligne** : `gdtf.ts:219-263` (`buildCapabilities(lcList, …)` itère **tous** les LC) appelé en `gdtf.ts:333`, et le nom/type n'utilise que `lcList[0]` (`gdtf.ts:324-329`).
- **Description** : la spec (§7.7) dit que des `LogicalChannel` frères sont **mutuellement exclusifs** (sous-modes du même canal, ex. « sélection gobo » vs « rotation gobo »). Le code aplatit : il concatène les `ChannelFunction`/`ChannelSet` de **tous** les LC, chacun redémarrant typiquement à `DMXFrom="0/1"`. Résultat : des capacités dont les plages se recouvrent (deux fois 0-255), avec un nom/type tiré du seul 1ᵉʳ LC.
- **Pourquoi c'est un problème** : les capacités affichées sont incohérentes (mélange des deux sous-modes), et le 2ᵉ sous-mode est invisible comme fonction. Très courant sur les vraies fixtures (roues gobo « select/rotate », prismes).
- **Correction** : ne garder que le 1ᵉʳ `LogicalChannel` comme « mode par défaut » (le plus simple et le plus sûr), ou exposer chaque LC comme un canal/sous-mode séparé. Ne pas concaténer à plat.

---

## 2. Bugs — sévérité moyenne

### M1 — `importGDTF` n'effectue aucune déduplication et écrase
- **Fichier/ligne** : `library.ts:1249-1258`.
- **Description** : contrairement à `loadGdtfDirectory` (`library.ts:1217` qui teste `hasFixture`), `importGDTF` appelle `this.add(def)` sans vérifier l'existence, puis `writeFileSync(userData/fixtures/<id>.json)` sans contrôler la collision disque.
- **Pourquoi c'est un problème** : `Map.set` écrase silencieusement l'entrée en mémoire, et le fichier écrase toute fixture existante de même `id`. Importer un `.gdtf` dont le fabricant+modèle existe déjà (QXF/OFL/custom) détruit la version existante sans avertissement. Comportement incohérent avec `loadGdtfDirectory`.
- **Correction** : aligner sur `loadGdtfDirectory` (`if (this.hasFixture(...)) return def;` + ne pas réécrire), ou renvoyer un statut « déjà présent » au renderer.

### M2 — Collision d'id avec les fixtures QXF/OFL/custom existantes
- **Fichier/ligne** : `gdtf.ts:358` (identique à `library.ts:771` et `:1127`).
- **Description** : `id = "${manufacturer}-${model}"` nettoyé (`\s+`→`-`, puis `[^a-zA-Z0-9_-]` supprimé). Le **même** schéma est utilisé par le parser QXF et OFL. Un `.gdtf` « Martin / Mac Aura » produit le même id que la fixture OFL « Martin / Mac Aura », et l'import persiste dans le **même** dossier `userData/fixtures/`.
- **Pourquoi c'est un problème** : écrasement de fichiers et d'entrées en mémoire (cf. M1) ; impossible de cohabiter. De plus, si `manufacturer` et `model` ne contiennent que des caractères non-ASCII (ex. « ФОНАРЬ », « 舞台灯 »), `id` devient une chaîne vide → `path.join(userDir, ".json")` écrit un fichier nommé `.json` (fichier caché, collision globale).
- **Correction** : préfixer l'id des imports GDTF (ex. `gdtf-${manufacturer}-${model}`) ou namespace-r les fichiers persistés par source ; garantir un fallback non-vide (ex. hash du nom si l'id devient vide).

### M3 — Suffixe `s` de `DMXValue` mal interprété
- **Fichier/ligne** : `gdtf.ts:109-116`.
- **Description** : le regex accepte `"255/1s"` mais ignore le `s`. La spec (§7.4) dit que `s` = *byte shifting* : `255/1s` = valeur interprétée en 16 bits = **65280**, pas 255.
- **Pourquoi c'est un problème** : un `DMXFrom="255/1s"` (ou `Default`) serait lu comme 255, décalant les bornes de plage calculées (`csEnd = suivant − 1`). Rare (utilisé surtout pour les fines), mais c'est une divergence sémantique explicite de la spec.
- **Correction** : si `s` présent, calculer `value << (8*(byteCount_effectif−1))` (ou au minimum documenter + renvoyer `null` plutôt qu'une valeur fausse).

### M4 — Noms de canaux dupliqués quand une géométrie est réutilisée (pixels / multi-instances)
- **Fichier/ligne** : `gdtf.ts:348-352`.
- **Description** : le préfixe `Geo_` n'est appliqué que si `geoInMode.size > 1`. Une fixture pixel/multi-tête réutilise la **même** géométrie via `GeometryReference` + `DMXBreak="Overwrite"` (Listing 1) → `geoInMode.size === 1` mais des dizaines de canaux `Pixel_ColorAdd_R` identiques. Par ailleurs la spec impose `nom = <Geometry>_<attribut>` **toujours**, pas seulement en multi-géométrie.
- **Pourquoi c'est un problème** : `getChannelMap()`/`getChannelOffset()` indexent par nom → collisions, un canal écrase l'autre. Même en mono-géométrie, deux canaux de même attribut (pixels) deviennent indistinguables.
- **Correction** : toujours préfixer par la géométrie (et désambiguïser par le slot DMX si doublon : `Pixel_ColorAdd_R@3`).

---

## 3. Bugs — sévérité basse

### L1 — ZIP : pas de support Zip64
- **Fichier/ligne** : `gdtf.ts:394-395`.
- **Description** : si l'archive est Zip64, `entryCount`/`cdOffset` valent `0xFFFFFFFF`/`0xFFFFFFFFFFFFFFFF` et le parser lit n'importe quoi. La signature du *Zip64 EOCD locator* (`0x07064b50`) n'est jamais détectée.
- **Impact** : faible en pratique (`.gdtf` < 4 Go quasi toujours), mais aucune détection → parse silencieusement faux ou `null`. **Correction** : détecter le locator Zip64 et lire le vrai EOCD, ou retourner une erreur explicite « Zip64 non supporté ».

### L2 — ZIP : la recherche d'EOCD peut matcher des octets du commentaire
- **Fichier/ligne** : `gdtf.ts:385-392`.
- **Description** : scan arrière naïf de la signature `0x06054b50` sur tout le buffer. Si le commentaire de fin contient ces 4 octets (rare mais possible), `eocd` pointe au mauvais endroit.
- **Correction** : valider la cohérence (`eocd + 22 + commentLen === zip.length`), sinon continuer le scan.

### L3 — ZIP : pas de vérification de signature du local header
- **Fichier/ligne** : `gdtf.ts:408-411`.
- **Description** : `lhNameLen`/`lhExtraLen` sont lus à `localOffset+26/28` sans vérifier `0x04034b50`. Un `localOffset` corrompu produit des octets invalides (rattrapé par `try/catch` → `null`). Robuste mais masque l'erreur.
- **Correction** : vérifier la signature avant de lire.

### L4 — Perf : scan EOCD sur tout le buffer + lecture intégrale du zip
- **Fichier/ligne** : `gdtf.ts:386-391` et `gdtf.ts:429` (`fs.readFileSync` entier).
- **Description** : le scan arrière itère **chaque octet** du zip (les `models/*.glb` peuvent faire plusieurs Mo), et le fichier entier est chargé en RAM. Sur un dossier `resources/fixtures/gdtf/` avec beaucoup de fixtures, ça s'additionne au démarrage.
- **Correction** : limiter le scan aux ~64 Ko de fin (taille max d'un commentaire ZIP), et ne charger que la portion nécessaire.

### L5 — Champ `qlcplusFile` mal nommé
- **Fichier/ligne** : `gdtf.ts:361` → `qlcplusFile: opts?.sourceName`.
- **Description** : stocke le nom du fichier **GDTF** dans un champ nommé `qlcplusFile`. Un consommateur peut croire à un chemin QXF. Aucun impact fonctionnel, mais trompeur.

### L6 — Mapping attribut→type incomplet
- **Fichier/ligne** : `gdtf.ts:86-104`.
- **Description** : attributs fréquents absents → `'Nothing'` : `PanTiltSpeed`, `PanTiltMode`, `PanMode`, `TiltMode`, `EffectSpeed`, `EffectDuration`, `Gobo(n)WheelSpin`, `ZoomMode*`, `StrobeMode*`, `ColorWheel*`. Les rotations (`Gobo(n)Pos`, `Prism(n)Pos`, `PanRotate`) sont typées `Gobo`/`Prism`/`Pan` plutôt que `Speed` (cosmétique). La spec §6 liste ces attributs ; leur absence dégrade l'utilité des canaux (pas de crash).
- **Correction** : compléter la table depuis §6 (notamment `PanTiltSpeed`→`Speed`, `PanTiltMode`→`Effect`).

---

## 4. Cas limites non gérés qui casseraient sur de vrais fichiers

1. **Canaux 16 bits** (fine bytes) — bloquant, cf. H1. Omniprésent.
2. **Multi-LogicalChannel** (gobo select/rotate, prism) — sémantique fausse, cf. H2. Très courant.
3. **Zip64** — non détecté, parse faux, cf. L1.
4. **`DMXValue` avec suffixe `s`** — valeur fausse, cf. M3.
5. **`Offset="None"` / canaux virtuels** : correctement **sautés**, mais les `<Relations>` (virtual dimmers, `Master`/`Follower`) ne sont pas représentées → une fixture utilisant des virtual dimmers perd cette logique. Acceptable pour un preset générique, à documenter.
6. **`GeometryReference` / multi-instances pixel** : géométries réutilisées → noms dupliqués, cf. M4.
7. **Manufacturer/modèle non-ASCII** → `id` vide ou dégénéré, cf. M2.
8. **ChannelSet sans `DMXFrom`** : repli sur `cfStart` (correct), mais si deux sets consécutifs ont le même `DMXFrom`, `max < min` (plage inversée) — non filtré (rare).

## 5. Points corrects (pour lever le doute)

- Lecture XML : `FixtureType/@Manufacturer`, `@Name`, `@ShortName`, `@LongName` ; `DMXModes/DMXMode/DMXChannels/DMXChannel/LogicalChannel/ChannelFunction/ChannelSet` — noms d'éléments et d'attributs conformes à la spec (tables 3, 56-61).
- `Offset` 1-based utilisé tel quel pour le tri (`slots[0]`), pas de `−1` erroné. `Offset="None"` → canal virtuel sauté. Correct.
- Fin de plage = `DMXFrom` du suivant `−1`, sinon `256^byteCount − 1` (`channelMax`) — conforme §7.5.
- `toCoarse` (réduction 16→8 bits, octet coarse) : `floor(value / 256^(n−1))` — correct.
- `Attribute="NoFeature"` et `DMXChannel` sans `LogicalChannel` → canal `'Nothing'` conservé avec son slot (bon pour l'adressage).
- Skip des ChannelSets sans nom (les « gaps » du Listing 1) — correct, reproduit fidèlement l'exemple officiel.
- `readZipEntry` : store (0) et deflate (8) via `inflateRawSync`, offsets du central directory et du local header corrects ; le cas *data descriptor* (flag bit 3) est **accidentellement** bien géré car les tailles sont lues depuis le central directory (toujours justes). `name.endsWith('/'+entry)` gère les sous-dossiers.
- Câblage IPC : `fixtures:importGDTF` (main.ts), `importGDTF` (preload.ts), type `importGDTF` (types.d.ts) — cohérents entre eux.
- `load()` charge bien les `.gdtf` de `resources/fixtures/gdtf/` via `loadGdtfDirectory` (récursif, `getAllFiles(dir,'.gdtf')`), et `.gdtf` n'est pas re-parsé par `loadDirectory` (qui ne prend que `.qxf`/`.json`).

---

## 6. Verdict

**Le parser n'est pas correct pour un usage réel d'import de `.gdtf` fabricants en l'état.**

- **Bloquants avant mise en prod** :
  1. **H1 (canaux 16 bits)** — footprint DMX faux et slots « fine » jamais pilotés. Doit être résolu (ajout d'une largeur de canal + mapping d'adresses) avant tout déploiement, sinon les têtes mobiles sont mal adressées.
  2. **H2 (multi-LogicalChannel)** — capacité à ne garder que le 1ᵉʳ LogicalChannel (ou à exposer des sous-modes).
- **À corriger rapidement** : M1 (dédup `importGDTF`), M2 (collision d'id + id vide), M3 (suffixe `s`).
- **Non bloquants mais à traiter** : L1-L6 (Zip64, robustesse EOCD, perf, complétude du mapping attributs).

Une fois H1 et H2 corrigés, le parser sera correct pour la majorité des fixtures à canaux 8 bits et à LogicalChannel unique ; les cas Zip64/`s`/pixels resteront des limitations documentées.
