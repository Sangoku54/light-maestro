# GDTF — Référence du schéma `description.xml` (pour parser → fixture DMX générique)

> Document de référence produit le 2026-08-23. Objectif : écrire un parser qui convertit
> un fichier `.gdtf` en définition de fixture DMX générique (modes, canaux, plages de
> valeurs, presets/capacités, fabricant/modèle).
>
> **Sources consultées (vérifiées ligne par ligne) :**
> - Spec officielle : `https://github.com/mvrdevelopment/spec` → fichier `gdtf-spec.md`
>   (raw téléchargé : `https://raw.githubusercontent.com/mvrdevelopment/spec/main/gdtf-spec.md`,
>   révision `main`, taille 316 245 octets). Tous les noms d'éléments/attributs ci-dessous en
>   sont extraits.
> - `https://gdtf-share.com/help/` (help builder DMX, corroboration uniquement).
> - Exemple XML réel : *Listing 1* de la spec (mode DMX avec relations), reproduit §5.
>
> **Avertissement de rigueur** : tout ce qui est affirmé ici est tiré de la spec `gdtf-spec.md`
> (tables 1 à 65 + Annexes A/B). Les hypothèses de départ de la mission qui se sont révélées
> **fausses** sont corrigées explicitement (§7 « Pièges ») et ne doivent pas être codées.

---

## 1. Conteneur : le fichier `.gdtf` est un ZIP

Le fichier `.gdtf` est une **archive ZIP** (extension `*.gdtf`). Nom de l'archive :
`<ManufacturerName>@<FixtureTypeName>@<OptionalComment>` (ex. `generic@led@comment`).

Structure interne attendue :

```
./description.xml            ← obligatoire, UTF-8
./thumbnail.png              ← optionnel (racine du zip)
./thumbnail.svg
./wheels/gobo1.png           ← optionnel (images de gobos / roues)
./wheels/gobo2.png
./models/gltf/base.glb       ← optionnel (3D glTF/glb)
./models/gltf/yoke.glb
./models/3ds/base.3ds        ← optionnel (3DS)
./models/svg/base.svg        ← optionnel (symboles 2D)
```

Le parser ne lit que `description.xml`. Les dossiers `wheels/` et `models/` ne servent
qu'aux ressources visuelles (rendu 3D, thumbnails de gobos) et **ne sont pas nécessaires**
pour extraire les modes/canaux/capacités.

---

## 2. Racine XML et nœud `FixtureType`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<GDTF DataVersion="1.2">
  <FixtureType Name="..." ShortName="..." LongName="..." Manufacturer="..." FixtureTypeID="..." ...>
    ...
  </FixtureType>
</GDTF>
```

- Premier nœud : `<?xml version="1.0" encoding="UTF-8"?>` (obligatoire).
- Deuxième nœud : `<GDTF DataVersion="Major.Minor">` (ex. `1.2`).
- Enfant unique : `<FixtureType>`.

### Attributs de `FixtureType` (Table 3 de la spec)

| Attribut (casse exacte) | Type   | Description |
|---|---|---|
| `Name`         | Name   | Nom de la fixture (parse-safe). |
| `ShortName`    | String | Nom abrégé / abréviation. |
| `LongName`     | String | Nom complet détaillé. |
| `Manufacturer` | String | **Fabricant** (ce qu'on cherche). |
| `Description`  | String | Texte libre. |
| `FixtureTypeID`| GUID   | UUID unique (RFC 4122). |
| `Thumbnail`    | Resource | Nom de fichier sans extension (racine zip). |
| `RefFT`        | GUID   | Optional. |
| `CanHaveChildren` | Enum | `Yes`/`No`, défaut `Yes`. |

→ **Fabricant + modèle** : `FixtureType/@Manufacturer` et `FixtureType/@Name` (ou
`ShortName` pour un nom court). `LongName` est le libellé complet affichable.

### Enfants de `FixtureType` (Table 4, ordre obligatoire)

| Élément enfant | Obligatoire | Rôle |
|---|---|---|
| `AttributeDefinitions` | **Oui** | Déclare les attributs (fonctions) utilisés. |
| `Wheels`               | Non  | Roues physiques/virtuelles (couleur, gobo, prisme…). |
| `PhysicalDescriptions` | Non  | Photométrie, émetteurs, filtres. |
| `Models`               | Non  | Modèles 3D des pièces. |
| `Geometries`           | **Oui** | Arbre des pièces physiques du device. |
| `DMXModes`             | **Oui** | Modes DMX. |
| `Revisions`, `FTPresets`, `Protocols` | Non | Historique, presets, protocoles. |

L'ordre des sections est **mandaté** par la spec. En pratique, un parser doit tolérer des
sections absentes (sauf les 3 obligatoires) mais ne pas dépendre de l'ordre de lecture.

---

## 3. `AttributeDefinitions` (déclaration des fonctions)

```xml
<AttributeDefinitions>
  <ActivationGroups>                        <!-- optionnel -->
    <ActivationGroup Name="PanTilt"/>
  </ActivationGroups>
  <FeatureGroups>                           <!-- obligatoire -->
    <FeatureGroup Name="Position" Pretty="Position">
      <Feature Name="PanTilt"/>
    </FeatureGroup>
  </FeatureGroups>
  <Attributes>                              <!-- obligatoire -->
    <Attribute Name="Dimmer" Pretty="Dimmer" PhysicalUnit="Percent">
      <SubPhysicalUnit Type="..." PhysicalUnit="..." PhysicalFrom="0" PhysicalTo="1"/>
    </Attribute>
  </Attributes>
</AttributeDefinitions>
```

- `<AttributeDefinitions>` : **aucun attribut XML**.
- `<ActivationGroup>` : attribut `Name` (pas d'enfants).
- `<FeatureGroup>` : attributs `Name`, `Pretty`. Enfants : `<Feature>` (attribut `Name`).
- `<Attribute>` : attributs `Name` (unique, **c'est la clé référencée partout ailleurs**),
  `Pretty`, `ActivationGroup` (lien), `Feature` (lien), `MainAttribute` (lien optionnel),
  `PhysicalUnit` (enum), `Color` (ColorCIE).
- `<SubPhysicalUnit>` : attributs `Type`, `PhysicalUnit`, `PhysicalFrom`, `PhysicalTo`.

**Pour le parser générique**, on ne lit que la liste des `Attribute/@Name` (ensemble des
fonctions possibles). Le mapping vers les presets génériques se fait sur ces noms (§6).

---

## 4. `Geometries` — l'arbre des pièces (référencé **par nom**, pas par index)

```xml
<Geometries>
  <Geometry Name="Base" Model="Base">        <!-- ou Axis, Beam, FilterBeam, ... -->
    <Axis Name="Yoke" Model="Yoke">
      <Beam Name="Head" Model="Head"> ... </Beam>
    </Axis>
  </Geometry>
</Geometries>
```

- `<Geometries>` : **aucun attribut XML**. Enfants = types de géométrie (Table 34) :
  `Geometry`, `Axis`, `FilterBeam`, `FilterColor`, `FilterGobo`, `FilterShaper`, `Beam`,
  `MediaServerLayer`, `MediaServerCamera`, `MediaServerMaster`, `Display`,
  `GeometryReference`, `Laser`, `WiringObject`, `Inventory`, `Structure`, `Support`, `Magnet`.
- Chaque géométrie porte **`Name`** (unique), **`Model`** (lien vers `<Models>`), **`Position`**
  (matrice 4×4). Elle peut contenir des géométries enfants (mêmes types) → arbre.
- `DMXMode/@Geometry` et `DMXChannel/@Geometry` référencent une géométrie **par son `Name`**.
  **Il n'y a pas d'index numérique de géométrie dans le format.** (Correction §7.)

---

## 5. Chaîne DMX complète : `DMXModes → DMXMode → DMXChannels → DMXChannel → LogicalChannel → ChannelFunction → ChannelSet`

### 5.1 `DMXModes` / `DMXMode`

```xml
<DMXModes>
  <DMXMode Name="Default" Description="..." Geometry="Base">
    <DMXChannels> ... </DMXChannels>
    <Relations> ... </Relations>   <!-- optionnel -->
  </DMXMode>
</DMXModes>
```

- `<DMXModes>` : aucun attribut.
- `<DMXMode>` (Table 56) : `Name` (unique), `Description`, `Geometry` (nom de la **géométrie
  racine** du mode).

### 5.2 `DMXChannels` / `DMXChannel`

`<DMXChannels>` : aucun attribut, contient une liste ordonnée de `<DMXChannel>`.

`<DMXChannel>` (Table 58) :

| Attribut (casse exacte) | Type | Description / valeurs |
|---|---|---|
| `DMXBreak`  | Int | N° de « break » (start address séparé). Défaut `1`. Valeur spéciale `Overwrite` (réécrit par un `GeometryReference`). |
| `Offset`    | Array of Int | **Adresses DMX relatives** du canal, du byte le plus significatif au moins significatif, séparées par `,`. Valeur spéciale `None` (aucune adresse = canal virtuel). Défaut `None`. |
| `InitialFunction` | Node | Lien vers la `ChannelFunction` activée par défaut (défaut = 1ʳᵉ function du 1ᵉʳ logical channel). |
| `Highlight` | DMXValue | Valeur highlight (défaut `None`). |
| `Geometry`  | Name | **Nom de la géométrie** contrôlée par ce canal. |
| `Default`   | DMXValue | (vu dans l'exemple Listing 1 ; présent dans les exemples de la spec) |

**Nom du canal** : non libre, imposé = `<Geometry>_<attribut du 1er LogicalChannel>` (séparateur
`_`, ex. `Pixel_Dimmer`). Unique dans le mode.

### 5.3 `LogicalChannel`

Enfants du `DMXChannel` (mutuellement exclusifs : plusieurs LogicalChannels sous le même
DMXChannel décrivent des modes alternatifs du même canal, ex. « sélection gobo » vs
« rotation gobo »).

`<LogicalChannel>` (Table 59) :

| Attribut | Type | Description |
|---|---|---|
| `Attribute` | Node | **Lien vers l'attribut** (valeur = un `Attribute/@Name` d'`AttributeDefinitions`). C'est la **fonction** du canal. |
| `Snap` | Enum | `Yes`/`No`/`On`/`Off` (défaut `No`). |
| `Master` | Enum | `None`/`Grand`/`Group` (défaut `None`). |
| `MibFade` | Float | Fade min en secondes (défaut 0). |
| `DMXChangeTimeLimit` | Float | Fade min imposé (défaut 0). |

**Le nom du LogicalChannel** = nom de l'attribut lié (non libre).

### 5.4 `ChannelFunction`

Enfants du `LogicalChannel` (liste). `Attribute` est assigné à la *ChannelFunction* et définit
la fonction de sa **plage DMX**.

`<ChannelFunction>` (Table 60) — attributs essentiels :

| Attribut | Type | Description |
|---|---|---|
| `Name` | Name | Nom unique (défaut : `<Attribute>.<n°>`). |
| `Attribute` | Node | Lien vers l'attribut (défaut `NoFeature`). |
| `OriginalAttribute` | String | Nom constructeur. |
| `DMXFrom` | DMXValue | **Valeur DMX de début** de la plage. **La fin = `DMXFrom` de la fonction suivante − 1**, sinon max du canal. |
| `Default` | DMXValue | Valeur par défaut. |
| `PhysicalFrom` | Float | Début physique (défaut 0). |
| `PhysicalTo` | Float | Fin physique (défaut 1). |
| `Wheel` | Node | Lien roue (optionnel). |
| `ModeMaster` / `ModeFrom` / `ModeTo` | Node/DMXValue | Dépendance de mode (optionnel). |

### 5.5 `ChannelSet` (les « capacités » / presets)

Enfants du `ChannelFunction` (liste). **Un `ChannelSet` = une plage concrète avec un nom et
éventuellement une valeur physique** — c'est ce qui devient une « capacité » (preset).

`<ChannelSet>` (Table 61) :

| Attribut | Type | Description |
|---|---|---|
| `Name` | Name | Nom de la capacité (ex. `open`, `closed`, `strobe`, `gobo 1`). Défaut vide. |
| `DMXFrom` | DMXValue | **Début DMX** de la plage. Fin = `DMXFrom` du set suivant − 1, sinon fin de la fonction. |
| `PhysicalFrom` | Float | Défaut = celui du parent ChannelFunction. |
| `PhysicalTo` | Float | Défaut = celui du parent ChannelFunction. |
| `WheelSlotIndex` | Int | Index de slot de roue (si `Wheel` lié). |

Il existe aussi `<SubChannelSet>` (Table 62, sous-canaux pour DMX Profiles) — hors périmètre
générique.

### 5.6 Exemple XML réel (Listing 1 de la spec, reproduit verbatim)

```xml
<DMXMode Name="Default" Geometry="Body">
  <DMXChannels>
      <DMXChannel Highlight="255/1" Geometry="Pixel">
          <LogicalChannel Attribute="Dimmer" Master="Grand">
              <ChannelFunction Attribute="Dimmer" DMXFrom="0/1">
                  <ChannelSet Name="closed" DMXFrom="0/1" PhysicalTo="0" />
                  <ChannelSet DMXFrom="1/1" />
                  <ChannelSet Name="open" DMXFrom="255/1" PhysicalFrom="1" />
              </ChannelFunction>
          </LogicalChannel>
      </DMXChannel>
      <DMXChannel DMXBreak="Overwrite" Offset="1" Default="255/1" Highlight="255/1" Geometry="Pixel">
          <LogicalChannel Attribute="ColorAdd_R">
              <ChannelFunction Attribute="ColorAdd_R" DMXFrom="0/1"/>
          </LogicalChannel>
      </DMXChannel>
      <DMXChannel DMXBreak="Overwrite" Offset="2" Default="255/1" Highlight="255/1" Geometry="Pixel">
          <LogicalChannel Attribute="ColorAdd_G">
              <ChannelFunction Attribute="ColorAdd_G" DMXFrom="0/1"/>
          </LogicalChannel>
      </DMXChannel>
      <DMXChannel DMXBreak="Overwrite" Offset="3" Default="255/1" Highlight="255/1" Geometry="Pixel">
          <LogicalChannel Attribute="ColorAdd_B">
              <ChannelFunction Attribute="ColorAdd_B" DMXFrom="0/1"/>
          </LogicalChannel>
      </DMXChannel>
  </DMXChannels>
  <Relations>
      <Relation Name="VirtualDimmer" Master="Pixel_Dimmer" Follower="Pixel_ColorAdd_R.ColorAdd_R.ColorAdd_R 1" Type="Multiply" />
      <Relation Name="VirtualDimmer" Master="Pixel_Dimmer" Follower="Pixel_ColorAdd_G.ColorAdd_G.ColorAdd_G 1" Type="Multiply" />
      <Relation Name="VirtualDimmer" Master="Pixel_Dimmer" Follower="Pixel_ColorAdd_B.ColorAdd_B.ColorAdd_B 1" Type="Multiply" />
  </Relations>
</DMXMode>
```

---

## 6. Table de correspondance GDTF → presets génériques

Les noms d'attributs GDTF sont **normalisés** : selon l'Annexe B, « the upper and lower case
of attribute names is not taken into account » → matcher en **case-insensitive**, mais retenir
l'orthographe canonique ci-dessous. `(n)`/`(m)` = énumération démarrant à 1 (ex. `Gobo(n)` →
`Gobo1`, `Gobo2` ; `Prism(n)` → `Prism1`). Les attributs sans wildcard ne sont pas numérotés.

| Attribut GDTF (canonique) | Preset générique suggéré | Notes |
|---|---|---|
| `Dimmer` | `IntensityMasterDimmer` | **Le** canal d'intensité générale. GDTF n'a **pas** d'attribut nommé « Intensity » ; `Intensity` n'existe que dans des composés (`IntensityMSpeed`, `IntensityReset`, `DisplayIntensity`, `VideoKeyIntensity`). |
| `ColorAdd_R` | `IntensityRed` | Additif direct (émetteur rouge). |
| `ColorAdd_G` | `IntensityGreen` | |
| `ColorAdd_B` | `IntensityBlue` | |
| `ColorAdd_C` / `ColorAdd_M` / `ColorAdd_Y` | `IntensityCyan` / `IntensityMagenta` / `IntensityYellow` | Émetteurs CMY. |
| `ColorAdd_W` / `ColorAdd_WW` / `ColorAdd_CW` | `IntensityWhite` / `IntensityWarmWhite` / `IntensityCoolWhite` | |
| `ColorAdd_UV` | `IntensityUV` | |
| `ColorSub_C` / `ColorSub_M` / `ColorSub_Y` | `IntensityCyan` / `IntensityMagenta` / `IntensityYellow` | Soustractif (insertion de drapeaux). |
| `ColorRGB_Red` / `ColorRGB_Green` / `ColorRGB_Blue` | `IntensityRed` / `IntensityGreen` / `IntensityBlue` | RGB indirect. |
| `HSB_Hue` / `HSB_Saturation` / `HSB_Brightness` | `Hue` / `Saturation` / `Brightness` | |
| `CTO` / `CTB` / `CTC` | `ColorTemperature` (variantes) | Correction de température. |
| `Color(n)` → `Color1` | `ColorWheel` | Roue couleur. |
| `Color(n)WheelIndex` / `Color(n)WheelSpin` | `ColorWheelRotation` / `ColorWheelSpin` | |
| `Pan` | `Pan` | |
| `Tilt` | `Tilt` | |
| `PanRotate` / `TiltRotate` | `PanContinuousRotation` / `TiltContinuousRotation` | |
| `Gobo(n)` → `Gobo1`, `Gobo2` | `Gobo` (index n) | Roue gobo. |
| `Gobo(n)Pos` / `Gobo(n)PosRotate` | `GoboRotation` / `GoboRotationContinuous` | |
| `Gobo(n)WheelIndex` / `Gobo(n)WheelSpin` | `GoboWheelRotation` / `GoboWheelSpin` | |
| `Shutter(n)` → `Shutter1` | `Shutter` (strobe) | Obturateur mécanique/électronique. |
| `Shutter(n)Strobe` / `Shutter(n)StrobePulse` | `Strobe` | |
| `StrobeFrequency` / `StrobeDuration` / `StrobeRate` | `StrobeFrequency` / `StrobeDuration` / `StrobeRate` | |
| `StrobeMode*` (Shutter/Pulse/Random…) | `StrobeMode` | |
| `Prism(n)` → `Prism1` | `Prism` | |
| `Prism(n)Pos` / `Prism(n)PosRotate` | `PrismRotation` / `PrismRotationContinuous` | |
| `Focus(n)` → `Focus1` | `Focus` | |
| `Zoom` | `Zoom` | |
| `ZoomModeSpot` / `ZoomModeBeam` / `ZoomMode` | `ZoomMode` | |
| `Frost(n)` → `Frost1` | `Frost` | |
| `Iris` | `Iris` | |
| `BeamShaper` / `Blade(n)A` / `Blade(n)B` | `BeamShaper` / `FramingBlade` | |
| `Effects(n)` → `Effects1` | `EffectMacro` | |
| `Control(n)` → `Control1` | `Control` | |
| `LampControl` | `LampControl` | |
| `NoFeature` | `NoFeature` | **Plage sans fonction** (réservé/inedit). |
| `PanTiltMode` / `PanMode` / `TiltMode` | `PanTiltMode` | |

Règle de repli : tout attribut non listé → preset `Generic` conservant le nom GDTF brut.
Toujours conserver le nom GDTF d'origine en parallèle du preset (pour le round-trip).

---

## 7. Pièges (vérifiés contre la spec — corrections incluses)

### 7.1 Les géométries ne sont PAS indexées, elles sont référencées par `Name`
`DMXMode/@Geometry` et `DMXChannel/@Geometry` contiennent un **nom de géométrie** (type
`Name`), pas un index. Le parser doit construire un dictionnaire `name → geometry` en
parcourant l'arbre `<Geometries>`. *(Hypothèse initiale « référencé par index » : fausse.)*

### 7.2 `Offset` ne pointe PAS sur une LogicalChannel
`DMXChannel/@Offset` est un **tableau d'adresses DMX** (une entrée par byte DMX du canal,
du plus significatif au moins significatif). Ce n'est **pas** un index vers la N-ème
LogicalChannel. Les `LogicalChannel` sont les **enfants en ordre documentaire** du
`DMXChannel`. *(Hypothèse initiale « l'offset pointe sur la N-ème LogicalChannel » : fausse.)*

### 7.3 Unités d'`Offset` : slots DMX, **1-based**, relatifs au début de la fixture — PAS des bytes
- Les valeurs d'`Offset` sont des **numéros de slots DMX** (adresses), **1-based** et
  relatifs à la première adresse de la fixture : `Offset="1"` = premier slot DMX de la fixture.
  Confirmé par l'exemple Listing 1 (`Offset="1"`, `"2"`, `"3"` consécutifs) et par le
  `DMXOffset` du `<Break>` (« Default value: 1 — Means no offset »).
- Pour un canal 16 bits : `Offset="1,2"` = byte haut (coarse) au slot 1, byte bas (fine) au
  slot 2.
- `Size per int: 4 bytes` dans la spec = taille de stockage de l'entier dans le modèle de
  données XML, **pas** un décalage en octets sur le câble DMX.
- `Offset="None"` (défaut) : le canal **n'a pas d'adresse DMX** (canal virtuel, utilisé avec
  `<Relations>` pour les « virtual dimmers »).

### 7.4 Le format `DMXValue` : `valeur/byteCount` avec suffixe optionnel `s`
Les attributs `DMXFrom`, `Default`, `Highlight`, `ModeFrom`, `ModeTo` utilisent le type
`DMXValue` (Table 1) : `Uint/n` (byte mirroring) ou `Uint/ns` (byte shifting), où **n = nombre
de bytes**. Exemples :
- `0/1` → valeur 0 sur 1 byte (8 bits).
- `255/1` → 255 sur 1 byte.
- `65535/2` → 65535 sur 2 bytes (16 bits).
- `255/1s` → byte-shifting : 255 sur 1 byte, interprété en 16 bits = 65280.

### 7.5 Bornes des plages DMX : la fin se calcule, elle n'est pas stockée
Ni `ChannelFunction` ni `ChannelSet` n'ont d'attribut `DMXTo`. La fin d'une plage =
`DMXFrom` du frère suivant **− 1** ; sinon la valeur max du canal. Le **max du canal** dépend
de sa résolution = nombre de bytes = nombre d'entrées dans `Offset` :
`max = 256^byteCount − 1` (255 pour 8 bits, 65535 pour 16 bits). Avec `Offset="None"`, la
plage est définie par les `DMXFrom` seuls (canal virtuel).

### 7.6 Bornes physiques (min/max « réels »)
- `PhysicalFrom` / `PhysicalTo` sur `ChannelFunction` (défauts 0 / 1).
- Surchargés par `PhysicalFrom` / `PhysicalTo` sur chaque `ChannelSet`.
- C'est là qu'on récupère le range physique min/max d'une capacité (ex. pan −270°…+270°,
  dimmer 0…100 %, avec `PhysicalUnit` de l'`Attribute` pour l'unité).

### 7.7 Un `DMXChannel` peut ne pas avoir de `LogicalChannel` (ou avoir `NoFeature`)
La spec dit « As children the DMX channel has a list of logical channels » sans imposer
explicitement un minimum. Cas possibles à gérer par le parser :
1. `DMXChannel` **sans enfant `LogicalChannel`** : canal réservé/spare → le traiter comme
   « sans fonction » (no-feature).
2. `LogicalChannel`/`ChannelFunction` avec `Attribute="NoFeature"` (ou absence d'attribut
   `Attribute`) : **plage inutilisée** explicitement déclarée → ignorer ou marquer vide.
3. Plusieurs `LogicalChannel` sous un même `DMXChannel` : **mutuellement exclusifs**
   (sous-modes du même canal). Chacun porte ses propres `ChannelFunction`/`ChannelSet`.
   Pour un preset générique, on peut soit aplatir (concaténer les capacités), soit garder le
   1ᵉʳ LogicalChannel comme « mode par défaut ».

### 7.8 Liens `Node` : chemins `Name.Name.Name...`
Les attributs de type `Node` (`Attribute=`, `InitialFunction=`, `Master=`, `Follower=`)
sont des **chemins de noms**, pas des index. Exemple (Listing 1) :
`Follower="Pixel_ColorAdd_R.ColorAdd_R.ColorAdd_R 1"` =
`<DMXChannel name="Pixel_ColorAdd_R">.<LogicalChannel Attribute="ColorAdd_R">.<ChannelFunction> 1`.
Pour le parser générique, `LogicalChannel/@Attribute` suffit (c'est un simple nom d'attribut).

### 7.9 `DMXBreak` et `GeometryReference`
- `DMXBreak="Overwrite"` : le numéro de break sera écrasé par le `GeometryReference` parent
  (multi-instances, ex. panneaux de pixels).
- Un `<GeometryReference>` pointe sur une géométrie déjà décrite (`Geometry="@Name"`) et a
  comme enfants des `<Break DMXOffset="..." DMXBreak="..."/>` qui décalent les canaux.
  Hors périmètre d'un parser « mono-fixture » simple, mais à ne pas confondre avec un canal.

### 7.10 Casse et caractères
- **Tous les noms d'éléments et d'attributs XML ci-dessus sont sensibles à la casse.**
- Les *valeurs* de noms d'attributs GDTF sont comparées en **case-insensitive** (Annexe B),
  mais les caractères autorisés pour le type `Name` sont restreints (Annexe C de la spec).

---

## 8. Algorithme d'extraction minimal (résumé)

1. Ouvrir le ZIP, lire `description.xml` (UTF-8).
2. `FixtureType/@Manufacturer` → fabricant ; `@Name` (ou `@ShortName`) → modèle.
3. Construire le dictionnaire `attributes` depuis `AttributeDefinitions/Attributes/Attribute/@Name`
   (+ `PhysicalUnit` si on veut les unités).
4. Construire le dictionnaire `geometries` depuis l'arbre `Geometries` (clé = `@Name`).
5. Pour chaque `DMXModes/DMXMode` :
   - Pour chaque `DMXChannels/DMXChannel` :
     - résolution = nombre d'entrées dans `Offset` (ou 0 si `None`).
     - nom de canal = `@Geometry` + `_` + attribut du 1ᵉʳ LogicalChannel.
     - position DMX = `Offset` (tableau de slots 1-based).
     - pour chaque `LogicalChannel` → `Attribute` (fonction), puis chaque
       `ChannelFunction` → plage DMX (`DMXFrom` → fin calculée) et plage physique
       (`PhysicalFrom`/`PhysicalTo`), puis chaque `ChannelSet` → capacité
       (`Name`, `DMXFrom`, `PhysicalFrom`/`PhysicalTo`).
   - (optionnel) traiter `Relations` si on veut les dimmers virtuels.
6. Mapper chaque `Attribute` GDTF vers le preset générique via la table §6.

---

## 9. URLs exactes consultées

- Spec officielle (source primaire de tout ce document) :
  `https://github.com/mvrdevelopment/spec` — fichier `gdtf-spec.md` (raw :
  `https://raw.githubusercontent.com/mvrdevelopment/spec/main/gdtf-spec.md`).
- Aide builder : `https://gdtf-share.com/help/` (section DMX :
  `https://gdtf-share.com/help/users/gdtf_builder/dmx/index.html`).
- Documentation GDTF (miroir spec) : `https://www.gdtf.eu/gdtf/v1.0/` et
  `https://www.gdtf.eu/gdtf/file-spec/dmx-mode-collect/`.

**Limites / non vérifié** : les valeurs d'énumération exhaustives des `PhysicalUnit` de chaque
attribut standard (Annexe A complète) n'ont pas toutes été re-vérifiées une à une ; seule la
liste des noms d'attributs l'a été. Le comportement exact des consoles sur les
`SubChannelSet`/`DMXProfile` est hors périmètre de ce document.
