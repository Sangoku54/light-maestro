# Bibliothèques de fixtures DMX — recherche documentée

> Note de recherche : faits collectés le 2026-08-23 via recherche web + inspection directe des dépôts GitHub.
> Les URLs sont cliquables. Les comptes sont « approximatifs » (évoluent en continu).

---

## 1. QLC+ (Q Light Controller Plus)

- **Dépôt GitHub :** https://github.com/mcallegari/qlcplus
- **Dossier des fixtures :** `resources/fixtures/` — organisé par dossiers fabricants (ADB, Chauvet, Clay_Paky, Elation, ETC, Martin, Robe, Stairville, etc.)
  - Lien direct : https://github.com/mcallegari/qlcplus/tree/master/resources/fixtures
- **Format :** `.qxf` — fichier XML (`<!DOCTYPE FixtureDefinition>`, namespace `http://www.qlcplus.org/FixtureDefinition`). Un index global `FixturesMap.xml` (~100 Ko) référence toutes les fixtures.
- **Compte approximatif :** **1 812 fichiers `.qxf`** dans le dépôt (vérifié par recherche de code GitHub `extension:qxf repo:mcallegari/qlcplus` → `total_count: 1812`).
- **Licence :** **Apache 2.0** (voir https://github.com/mcallegari/qlcplus/blob/master/COPYING). ⚠️ Changement récent : QLC+ était historiquement sous **GPL v2**, le passage à Apache 2.0 est documenté dans le commit « Switched QLC+ license to Apache 2.0 ».
- **Téléchargement en masse :**
  - `git clone https://github.com/mcallegari/qlcplus.git` (le sous-dossier `resources/fixtures/` contient tout)
  - ZIP complet du dépôt : https://github.com/mcallegari/qlcplus/archive/refs/heads/master.zip
  - Builds officiels : https://www.qlcplus.org/download
- **Ressources supplémentaires :** https://github.com/mcallegari/qlcplus-extras (fixtures additionnelles, gobos, templates, scripts).

---

## 2. Open Fixture Library (OFL)

- **Site web :** https://open-fixture-library.org/
- **Dépôt GitHub :** https://github.com/OpenLightingProject/open-fixture-library
- **Format :** JSON **interne** (spec : https://github.com/OpenLightingProject/open-fixture-library/blob/master/docs/fixture-format.md), exporté automatiquement vers de nombreux formats cibles par des « plugins » d'export : QLC+ 4.12.2, DMXControl 3 (DDF3), e:cue, Millumin, AGLight, ColorSource, D::Light, Dragonframe, OP-Z, Eurolite Color Chief 2.0, et le JSON OFL lui-même.
- **Compte approximatif :** **629 fixtures** (libellé « Download all 629 fixtures » sur la page d'accueil, relevé le 2026-08-23 ; la page liste ~150 fabricants avec leurs comptes respectifs).
- **Licence :** **MIT** (https://github.com/OpenLightingProject/open-fixture-library/blob/master/LICENSE) — très permissif.
- **Téléchargement en masse :**
  - Bundle JSON complet : https://open-fixture-library.org/download.ofl
  - Autres formats massifs : `/download.qlcplus_4.12.2`, `/download.dmxcontrol3`, `/download.ecue`, etc.
  - `git clone https://github.com/OpenLightingProject/open-fixture-library.git` (les fixtures sont des `.json` dans le dossier `fixtures/`)
- **Fréquence de mise à jour :** très active (fixtures créées jusqu'au 2026-08-01 relevé sur la page d'accueil).

---

## 3. GDTF (General Device Type Format)

- **Ce que c'est :** format standard **ouvert** de description d'appareils de l'industrie du spectacle (projecteurs, lyres, structures/trusses…), incluant les modes DMX, la géométrie 3D, les modèles 3D et les roues de gobos/couleurs. Souvent couplé à **MVR** (My Virtual Rig).
- **Porteurs / promoteurs :** le **GDTF Group** — lancé en 2019 par **Vectorworks, MA Lighting et Robe** (https://www.malighting.com/news/article/gdtf-10-launched-by-vectorworks-ma-lighting-and-robe-908/).
- **Site de téléchargement principal :** https://gdtf-share.com/
  - Aide / docs : https://gdtf-share.com/help/
  - MA Lighting (page « Fixture Shares ») : https://www.malighting.com/training-support/fixture-shares/
- **Format :** fichier **`.gdtf` = archive ZIP** contenant notamment :
  - `description.xml` — description du type d'appareil, de tous les modes DMX et de toutes les révisions firmware (spec : https://github.com/mvrdevelopment/spec/blob/main/gdtf-spec.md)
  - données de **géométrie / modèles 3D** (glTF)
  - dossier **`wheels/`** — images des gobos et roues de couleur (gobos en **300×300 px**)
- **Compte approximatif :** **plus de 7 000 fichiers GDTF** (fabricants + utilisateurs) — source : https://www.gdtf.eu/categories/gdtf-share/ (« The total number of manufacturer- and user-generated GDTF files in the GDTF Share has surpassed 7000 »).
- **Licence :** le format/spec GDTF est **ouvert** (standard de l'industrie) ; les fichiers individuels sont fournis par les fabricants/utilisateurs — les conditions de réutilisation varient donc **par fichier** (pas de licence unique de type MIT).
- **Téléchargement en masse :** pas de « zip global » public évident sur gdtf-share.com (téléchargement par fixture depuis le site) ; un **API GDTF Share** existe et est utilisé par les consoles/logiciels pour importer les profils pendant le patch. La spec est versionnée sur GitHub (https://github.com/mvrdevelopment/spec).
- **Builder en ligne (création de fichiers GDTF) :** https://gdtf-share.com/ (GDTF Builder).

---

## 4. Autres sources notables

| Source | URL | Remarque |
|---|---|---|
| **ETC — Fixture Library Hub** | https://fixture-library-hub.etcconnect.com/ | Bibliothèque de profils pour consoles **Eos Family** ; permet aussi de demander des profils. Téléchargement en masse de la librairie complète possible. |
| **Lightkey** | https://lightkeyapp.com/en/fixtures | Console DMX macOS avec bibliothèque de fixtures intégrée (liste consultable en ligne). |
| **Vectorworks Spotlight** | https://www.vectorworks.net/ | Logiciel CAO éclairage ; bibliothèque de fixtures intégrée, membre fondateur du GDTF Group, import/export GDTF + MVR. |
| **Capture (Visualisation)** | https://www.capture.se/ | Visualiseur avec bibliothèque de fixtures propre ; import via **CITP** depuis les consoles (ex. Onyx). |
| **QLC+ extras** | https://github.com/mcallegari/qlcplus-extras | Fixtures additionnelles, gobos, templates, scripts pour QLC+. |
| **fixture-converter (Flo Edelmann)** | https://github.com/FloEdelmann/fixture-converter | Outil de conversion entre formats de fixtures (dont QXF et formats OFL). |
| **CLF (Common Lighting Format)** | (format historique, présent aussi dans QLC+ via dossier `CLF`) | Ancien standard ouvert de profils (initiative ESTA) ; aujourd'hui largement supplanté par GDTF. |
| **Fabricants (téléchargements directs)** | Chauvet Professional : https://chauvetprofessional.com/learn-how-to-find-and-use-gdtf-files/ ; ADJ : https://www.adj.com/ ; Martin : https://www.martin.com/ ; Robe : https://www.robe.cz/ | Les grands fabricants publient leurs propres fichiers GDTF / profils (généralement aussi déposés sur gdtf-share.com). |

> Note : l'item « anyma » cité dans la demande n'a pas pu être vérifié comme bibliothèque de fixtures existante (aucun dépôt/site confirmé trouvé) ; je n'ai pas fabriqué d'URL. Les sources ci-dessus sont celles réellement vérifiées.

---

## Points d'attention

- **Licences :**
  - OFL = **MIT** (réutilisation très libre, y compris commerciale, mention de la licence requise).
  - QLC+ = **Apache 2.0** (⚠️ passage récent depuis GPL v2 — vérifier la version/commit utilisée avant d'intégrer du contenu, car les anciennes fixtures provenaient d'un projet GPL).
  - GDTF = **format ouvert**, mais **licence par fichier** (fournis par les fabricants/utilisateurs) → à vérifier au cas par cas.
  - Fabricants = conditions propres à chaque site (usage interne généralement toléré, redistribution à valider).
- **Taille :**
  - QLC+ : ~1 800 `.qxf` (XML léger) → petit volume.
  - OFL : 629 fixtures en JSON → petit volume.
  - GDTF : 7 000+ fichiers, mais chaque `.gdtf` est un **zip contenant des images (gobos 300×300) et des modèles 3D** → volume et complexité de parsing nettement plus importants.
- **Fréquence / fraîcheur :**
  - OFL : très actif (mises à jour quotidiennes).
  - QLC+ : actif (nombreux contributeurs, release régulières).
  - GDTF Share : actif, mais **qualité hétérogène** (fichiers fabricants + fichiers utilisateurs, certains sans modèle 3D complet).
- **Compatibilité de format :**
  - L'export QLC+ d'OFL cible spécifiquement **QLC+ 4.12.2** (le schéma `.qxf` a pu évoluer depuis).
  - Le `.qxf` QLC+ et le `.gdtf` n'ont **rien de commun** (XML simple vs ZIP multi-ressources) ; chaque format nécessite son propre parseur/importeur.
