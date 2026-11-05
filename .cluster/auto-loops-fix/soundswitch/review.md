# Revue critique — Adaptation SoundSwitch Autoloops → Light Maestro (Design A)

**Date** : 2026-08-20 · **Relecteur** : review (subagent critique)
**Documents relus intégralement** :
- `subagent_mechanics.md` (mécanique) — lit 12 articles officiels, liste de sources S1–S12.
- `subagent_timing.md` (timing/BPM) — lit 12 articles officiels, liste de sources 1–12.
- `subagent_adapt.md` (adaptation) — cartographie adopt/adapter/ignorer vers Design A.

---

## 0. Verdict global (à lire en premier)

1. **« mécanique » et « timing » sont cohérents entre eux et sourcés.** Sur les 6 faits clés examinés ci-dessous, ils concordent tous les deux, avec des sources primaires listées.
2. **« adaptation » est le seul rapport incohérent.** Il pose en tête une liste d'« invariants SoundSwitch (confirmés) » **sans aucune source**, et **6 de ces invariants sont faux ou inversés**. La conséquence : plusieurs verdicts sont *justes par accident* (le résultat tombe juste) mais pour de *mauvaises raisons* (la prémisse SoundSwitch est fausse). Il faut **corriger les justifications** avant de livrer quoi que ce soit, sinon un futur dev copiera une fonctionnalité qui n'existe pas.
3. **Aucun changement d'architecture de Design A n'est remis en cause.** Les verdicts finaux (frames complètes, fade par classe, beat-quantize, priorité, composition, fallback idle) restent globalement bons. C'est l'**attribution à SoundSwitch** et la **désignation des concepts** qui sont à reprendre.

---

## 1. Réconciliation des faits

Tableau : fait correct (sourcé par mécanique/timing) vs erreur dans « adaptation ».

| # | Fait correct (sources) | Erreur dans « adaptation » | Rapports fiables |
|---|------------------------|---------------------------|------------------|
| 1 | Un **autoloop = une timeline continue** d'une durée en bars (8/16/32/64/128), remplie via les **Control Tracks** (Master/Fixture/Group) + cues discrets (Position/Attribute). **Aucune notion officielle de « steps » ni de « scenes » interne.** Le terme « scene » est réservé aux **Static Looks** (« function precisely like scenes in traditional DMX software »). | « Un autoloop = une séquence de **scenes complètes** (état total des fixtures) qui boucle. » → **FAUX.** SoundSwitch ne fait pas de scenes dans un autoloop. | mécanique §1, §5 · timing §1, §7 |
| 2 | **« loop groups » n'existe pas** dans la doc officielle. Le concept réel = **4 Autoloop Banks** (2.9+ : 4 × 32 = 128) + banque **exclusive** + « Play All Banks ». **Aucune assignation d'un autoloop à des sections de morceau** (intro/verse/chorus) n'est documentée. | « Loop groups : des loops peuvent être groupés et **assignés à des sections** de morceau (intro/verse/chorus…) — change de loop selon la phrase. » → **FAUX.** Fonctionnalité inexistante chez SoundSwitch. | mécanique §4 |
| 3 | **AUCUN crossfade natif.** « Fade time » comme paramètre nommé est **introuvable**. Les fades sont tracés **à l'intérieur** du loop : rampes d'intensité (« slow intensity fades »), transitions de couleur (Color Transition), espacement des Position Flags. La communauté *demande* « comment fader entre autoloops » → preuve que ça n'existe pas. | « Fade : **crossfade entre scenes sur N beats**. » → **FAUX.** | mécanique §2 · timing §6 |
| 4 | **« Autoloop Override » = les AUTOLOOPS prennent le dessus sur les scripts** (« Override Scripted Tracks », bouton « Autoloop Override » du Control One). Priorité par défaut : static look (manuel) > script > autoloop ; l'override **inverse** script↔autoloop. | « Override : un look manuel ou scripté **prend le dessus sur l'autoloop** (préférence « Autoloop Override »…). » → **INVERSÉ.** Le terme « Autoloop Override » veut dire l'autoloop gagne sur le script, pas le contraire. | mécanique §6 · timing §5 |
| 5 | **Attribute Cues = fonctions spéciales uniquement : gobo, prisme, focus, zoom.** Intensité / couleur / pan-tilt / strobe se pilotent par les **Control Tracks**, **pas** par des Attribute Cues. | « Attribute cues : modulation d'UN attribut (**couleur / position / intensité** / gobo / rotation) superposée à la scene. » → **FAUX sur le périmètre.** Couleur/position/intensité = Control Tracks, pas Attribute Cues. | timing §7 |
| 6 | **Loop Auto Strobe = couche d'effet temps réel** déclenchée par un **Loop/Loop-Roll du hardware DJ < ½ beat** ; la cadence dérive de la **longueur du loop** (plus court = plus rapide), pas du BPM. Ce n'est **pas une étape interne du loop**, ni un « strobe beat-sync » au sens BPM. | « Strobe intégré : « Loop Auto Strobe », **strobe synchro beat inclus dans le loop**. » → **IMPRÉCIS/FAUX.** C'est un effet réactif externe au séquenceur, cadencé par le loop-roll matériel. | mécanique §2 · timing §4 |

**Point méta** : « adaptation » ne liste **aucune source lue** (contrairement aux deux autres), tout en étiquetant ses prémisses « (confirmés) ». C'est la cause racine des 6 erreurs. Règle à retenir : une prémisse d'adaptation doit être **citée** ou marquée « à vérifier », jamais « confirmée » sans source.

---

## 2. Re-vérification des verdicts d'adaptation (une fois les faits corrigés)

| Verdict « adaptation » | Conclusion après correction |
|------------------------|-----------------------------|
| **(a) Loop = scenes complètes → ADOPTER** | **Verdict final : OUI (garder), mais justification à réécrire entièrement.** Le besoin de frames complètes vient de **notre** architecture (source dédiée + merge HTP + miroir 3D n'acceptent que des frames totales), **PAS** de SoundSwitch. L'analogue SoundSwitch correct est la **Master Track** (une piste qui couvre **tous** les fixtures, portable entre venues) + surcharges Fixture/Group Track — un modèle « état complet + surcharges », pas « liste de scenes ». La conséquence pratique (matérialiser chaque step en frame totale, OFF = RGB 0 + shutter 0 + dimmer 0) est **inchangée et correcte**. Renommer le concept : « état complet par step + surcharges », pas « scenes complètes ». |
| **(b) Sync beat/bar → ADAPTER (frame-locked + beat-quantize)** | **Verdict final : VALIDE, aucun changement.** SoundSwitch est bien beat/bar-aligned (beatgrid DJ, ou BPM détecté en repli). Le substitut « frame-locked + beat-quantize optionnel sur downbeats » est la bonne adaptation à l'absence de beat grid importé. Justification correcte en l'état. |
| **(c) Fade → ADAPTER (fade par classe de canal)** | **Verdict final : VALIDE, mais c'est un « heureux accident ».** La prémisse « SoundSwitch crossfade tout » est fausse ; or la **conclusion pratique** (ramper dimmer+couleur, snapper pan/tilt/shutter) est **exactement ce que SoundSwitch fait réellement** (rampes écrites *dans* le loop, positions espacées pour laisser le temps de bouger). Corriger la prémisse : « fades internes au loop », pas « crossfade entre scenes ». L'action `fadeMs` + rampe sur canaux fadeables est à garder. |
| **(d) Loop groups → sections → IGNORER** | **Verdict final : RENFORCÉ, mais pour une raison différente.** Ce n'est pas « hors scope d'une feature qui existe » : la feature **n'existe pas chez SoundSwitch**. Double raison d'ignorer : (1) non-fonctionnalité, (2) exigerait classifieur de sections + UI + switching. Noter toutefois : le vrai concept SoundSwitch des **4 Autoloop Banks** (sets de loops + banque exclusive) est la graine d'un futur « set de loops », hors périmètre « une boucle simple ». |
| **(e) Override/priorité → ADOPTER priorité + ADAPTER mutex** | **Verdict final : VALIDE sur le fond, attribution à corriger.** L'enum `manuel > chaser > auto-loop` correspond au **default** SoundSwitch (manuel > script > autoloop). Mais **ne pas appeler ça « Autoloop Override »** : ce terme signifie l'**inverse** chez SoundSwitch (autoloop gagne sur script). Si un jour on veut « auto-loop > chaser », ce sera un flag séparé — et *là*, ça correspondra au vrai « Autoloop Override ». Le mutex cédant de Design A reste le bon primitif. |
| **(f) Strobe → ADOPTER + beat-sync optionnel** | **Verdict final : ADOPTER gardé, le « beat-sync » est à requalifier.** Le type `strobe` v1 couvre déjà le besoin. La rigueur OFF (dimmer=0, shutter=0, **RGB=0**) est correcte et prioritaire. Mais le « strobe beat-sync » ne vient **pas** de SoundSwitch : son Loop Auto Strobe est cadencé par le **loop-roll matériel**, pas par le BPM. Si on veut un strobe calé BPM, c'est **notre invention** (légitime, à bas coût), à ne pas attribuer à SoundSwitch. |
| **(g) Attribute cues → ADAPTER (composition)** | **Verdict final : VALIDE comme choix de design, justification à corriger.** La « machine à variation » SoundSwitch est bien réelle, mais elle = **coexistence de Control Tracks (couleur/intensité/pan-tilt/strobe) + Position Cues + Attribute Cues (gobo/prism/focus/zoom)** sur une même timeline. « Composer 2 primitives » est donc une transposition légitime de la *coexistence de pistes*, **pas** d'une « modulation d'attribut couleur/position ». Ne pas citer les Attribute Cues comme la couche couleur/position. |
| **(h) Déclenchement auto → ADAPTER (fallback idle)** | **Verdict final : VALIDE, aucun changement.** Le déclencheur natif « morceau sans script » est correctement transposé en « fallback d'inactivité » (mutex libre X s → loop par défaut). C'est l'esprit « filet toujours actif » capté à bas coût. |

**Bilan** : **6 verdicts sur 8 survivent** (b, c, d, e, f, g, h). **2 exigent une réécriture de justification** (a : « scenes complètes » → « état complet + Master Track/surcharges » ; e : retirer l'appellation « Autoloop Override »). **1 est renforcé** (d : feature inexistante, pas seulement hors scope). Aucun verdict n'est à *inverser*.

---

## 3. Risques & anti-patterns (si on copie naïvement SoundSwitch)

### Ce qu'on risquerait

1. **Dépendance au beatgrid DJ qu'on n'a pas.** SoundSwitch s'appuie sur le beatgrid de Serato/VDJ/Engine Prime (source primaire). Si on reproduit « in sync with the Beatgrid », on construit un moteur de beat-grid **sans source à brancher** → over-engineering. Notre BPM/downbeats (`analyzeAudioBuffer`) suffit pour le beat-quantize ; inutile de répliquer la précision beatgrid.
2. **Timeline continue vs nos frames discrètes.** L'autoloop SoundSwitch est une piste temporelle continue. Nos `AutoLoopStep` sont des frames DMX discrètes. Copier le modèle « timeline continue » = **refonte du moteur chaser** (interdit par le scope). Garder les steps discrets + frames complètes + rampes de fade.
3. **Crossfade inexistant → nos steps vont « snapper ».** C'est le risque le plus concret : sans fade, une transition de step = **saut brutal** (snap) de toutes les valeurs. SoundSwitch l'évite en écrivant les rampes **dans** le loop. Donc le fade **par classe de canal** n'est pas un luxe optionnel : c'est **le** mécanisme qui tue le snap. Le faire sur dimmer+couleur uniquement (pas pan/tilt/shutter) évite les balayages mécaniques moches et le conflit avec le miroir 3D.
4. **« Scenes complètes » comme dogme importé.** Si on croit que SoundSwitch valide le modèle « liste de scenes complètes », on passe à côté de la leçon la plus utile : la **Master Track portable** (état couvrant tous les fixtures + surcharges). C'est ce modèle — pas les scenes — qui correspond à notre besoin (frames complètes + merge HTP gère les surcharges).
5. **Loop groups → sections fantômes.** Construire une assignation section→loop en croyant copier SoundSwitch = bâtir un classifieur + UI + switch de loop pour une feature **qui n'existe pas chez le référent**. Scope creep sur du vide.
6. **Sémantique « Override » inversée.** Si un dev future réutilise le terme « Autoloop Override » avec la définition de « adaptation » (script gagne), il câblera la priorité **à l'envers** de ce que le terme veut dire chez SoundSwitch. Risque de régression silencieuse de priorité.
7. **Attribute cues comme couche couleur/position.** Bâtir un « stack générique d'attribute cues » pour moduler couleur/position/intensité = mauvaise abstraction (chez SoundSwitch ces attributs sont des Control Tracks, pas des Attribute Cues). On dupliquerait un mécanisme pour la mauvaise couche.

### Ce qui est transposable SANS risque

1. **Le filet de secours / fallback idle** (« il se passe toujours quelque chose ») — esprit exact du produit, bon marché, opt-in.
2. **Durée en bars/beats + resync sur downbeat** — transposable tel quel avec nos BPM/downbeats.
3. **Fades écrits *dans* le loop** (rampes dimmer/couleur, positions espacées) — c'est la vraie mécanique SoundSwitch, elle correspond à notre « fade par classe de canal ».
4. **Contenu de loop volontairement simple** (couleurs pleines, transitions de couleur, fades d'intensité lents, « matching the beat precisely isn't always the best approach ») — leçon directe pour la qualité du générateur.
5. **Master Track portable + surcharges** — le bon analogue de « frames complètes », déjà couvert par merge HTP + source dédiée.
6. **Deux sources de tempo hiérarchisées** (métadonnée > détection audio) — on a déjà l'analyse audio ; pas de travail neuf.
7. **Seuil de silence → blackout ou pause-gel** (3 s sous seuil) — transposable en « pause du loop quand pas d'audio », avec reprise immédiate.
8. **Cycle entre plusieurs loops (Autoloop Banks)** — transposable, mais hors scope « une boucle simple » ; à noter pour plus tard.

---

## 4. Recommandation consolidée finale (Design A)

Ordonnée par **impact / effort**. Verdict de faisabilité par item.

### Bloc 1 — Qualité du loop (livrer d'abord)

**R1. Frames complètes + OFF total (RGB=0, shutter=0, dimmer=0).** — **Impact : ÉLEVÉ** · **Effort : FAIBLE** · **Faisabilité : HAUTE (déjà ~90 % en étape 1).**
- Action : matérialiser chaque `AutoLoopStep` en **frame totale** (toutes les adresses du loop : dimmer + shutter + couleur + pan/tilt), y compris l'état OFF avec `putRgbSegments(frame, pf, analysis, [0,0,0])` + shutter 0 + dimmer 0. Étendre le fill OFF au strobe et aux movers à roue de couleur.
- Justification **corrigée** : besoin dicté par source dédiée + merge HTP + miroir 3D (pas par les « scenes » SoundSwitch). L'analogue SoundSwitch = Master Track (état couvrant tout + surcharges).

**R2. Fade par classe de canal (`fadeMs`/loop).** — **Impact : ÉLEVÉ (tue le snap)** · **Effort : FAIBLE-MOYEN** · **Faisabilité : HAUTE.**
- Action : à chaque transition de step, ramper la frame sortante vers l'entrante sur la fenêtre de fade, **uniquement** sur les canaux fadeables (dimmer, RGB/RGBW). **Snapper** pan/tilt + shutter.
- Justification **corrigée** : c'est exactement le modèle SoundSwitch réel (rampes *dans* le loop, pas crossfade). Non-optionnel : c'est ce qui évite le saut brutal entre steps discrets.

### Bloc 2 — Musicalité & robustesse (livrer ensuite)

**R3. Beat-quantize optionnel (`beatQuantize`).** — **Impact : ÉLEVÉ (musicalité)** · **Effort : FAIBLE (réutilise `analyzeAudioBuffer`)** · **Faisabilité : HAUTE.**
- Action : flag `beatQuantize` dans la config du loop ; quand BPM/downbeats disponibles, **snapper la transition de step sur le downbeat le plus proche** au lieu de l'horloge frame fixe.

**R4. Priorité de sources + mutex cédant.** — **Impact : MOYEN-ÉLEVÉ (robustesse)** · **Effort : MOYEN** · **Faisabilité : MOYENNE.**
- Action : enum `manuel > chaser > auto-loop` ; l'autoLoop **cède le mutex** (stop/pause, reprise au clear) quand une source de priorité supérieure devient active. Le merge HTP gère la co-présence, la **propriété du mutex** respecte la priorité.
- **Ne pas appeler ce flag « Autoloop Override »** (terme inversé chez SoundSwitch). Un futur flag « auto-loop > chaser » correspondrait au vrai Autoloop Override.

**R5. Fallback idle (`autoStartWhenIdle`).** — **Impact : MOYEN (toujours quelque chose d'actif)** · **Effort : FAIBLE** · **Faisabilité : HAUTE.**
- Action : flag opt-in + délai ; si le mutex est libre depuis X s, démarrer le loop par défaut. Capte l'esprit « backup » de SoundSwitch sans autoscript.

### Bloc 3 — Différé / optionnel

**R6. Composition de 2 primitives (`compose`).** — **Impact : ÉLEVÉ (variation)** · **Effort : MOYEN** · **Faisabilité : MOYENNE.**
- Action : flag `compose` (ex. movement + color-chase) ; fusion des frames partielles de deux types en une frame complète par step (union des adresses, HTP par canal, puis complétion). À livrer après R1–R5 ; c'est la transposition de la *coexistence de pistes* SoundSwitch, pas d'un « stack d'attribute cues ».

**R7. (Futur) Sets de loops / « banques ».** — **Hors périmètre actuel.** Le vrai concept SoundSwitch des 4 Autoloop Banks + banque exclusive est la graine d'un futur « set de loops actif » + « boucle exclusive ». À noter, pas à faire maintenant.

### À ne PAS faire (explicite)

1. **Ne pas implémenter de crossfade entre « scenes » / entre loops.** Ça n'existe pas chez SoundSwitch, ça produirait des balayages pan/tilt moches et se battrait avec le miroir 3D. Le fade doit être **interne au loop**, par classe de canal (R2).
2. **Ne pas copier le modèle « timeline continue » / ne pas refondre le chaser.** Nos frames discrètes suffisent ; la refonte est explicitement hors scope.
3. **Ne pas construire de moteur de beat-grid complet.** Pas de source DJ à brancher ; over-engineering. Le beat-quantize sur downbeats (R3) couvre le besoin.
4. **Ne pas créer d'assignation de loops à des sections de morceau.** Feature inexistante chez SoundSwitch + exige classifieur + UI + switching. Ignorée (d), définitivement pour ce périmètre.
5. **Ne pas bâtir de stack générique d'« attribute cues » pour couleur/position/intensité.** Mauvaise abstraction : ces attributs sont des Control Tracks chez SoundSwitch, pas des Attribute Cues (qui = gobo/prism/focus/zoom).
6. **Ne pas réutiliser le terme « Autoloop Override » pour notre priorité `manuel > chaser > auto-loop`.** Le terme veut dire l'inverse chez SoundSwitch ; risque de régression de priorité.

---

## 5. Livrables demandés en une ligne

- **Réconciliation** : 6 faits corrigés, tous du côté « adaptation » ; « mécanique » et « timing » sont fiables.
- **Verdicts** : 6/8 valides ; 2 à re-justifier (a, e) ; 1 renforcé (d) ; aucun à inverser.
- **Risques** : le plus concret = le **snap** entre steps (R2 est le remède) ; les autres = copies de features inexistantes (loop groups, crossfade, attribute cues couleur, override inversé).
- **Recommandation ordonnée** : R1 → R2 (qualité), R3 → R4 → R5 (musicalité/robustesse), R6 → R7 (différé). Avec une liste « à ne PAS faire » de 6 points.
