# SoundSwitch — Analyse mécanique des Autoloops

> Analyse documentaire réalisée le 2026-08-20 à partir des articles officiels du support SoundSwitch
> (support.soundswitch.com) et de recherches web ciblées.
> ⚠️ Objet : la feature **Autoloops** (boucles lumineuses de secours), PAS l'Autoscript (analyse audio).

---

## Méthode & sources réellement consultées

Articles officiels dont le **texte intégral a été récupéré et lu** (via récupération HTTP directe de la page) :

| # | Article | URL |
|---|---------|-----|
| S1 | Autoloops Explained | https://support.soundswitch.com/en/support/solutions/articles/69000847100-soundswitch-autoloops-explained |
| S2 | Introduction to SoundSwitch | https://support.soundswitch.com/en/support/solutions/articles/69000847099-introduction-to-soundswitch |
| S3 | Autoloop Improvements in SoundSwitch 2.9 | https://support.soundswitch.com/en/support/solutions/articles/69000858487-soundswitch-autoloop-improvements-in-soundswitch-2-9 |
| S4 | How to Autoscript Autoloops | https://support.soundswitch.com/en/support/solutions/articles/69000844240-soundswitch-how-to-autoscript-autoloops |
| S5 | Static Looks Explained | https://support.soundswitch.com/en/support/solutions/articles/69000863339-soundswitch-static-looks-explained |
| S6 | Autoloop Override for Scripted Tracks (2.8.4 et antérieur) | https://support.soundswitch.com/en/support/solutions/articles/69000847086-soundswitch-2-8-4-and-earlier-autoloop-override-for-scripted-tracks |
| S7 | Control Tracks in SoundSwitch | https://support.soundswitch.com/en/support/solutions/articles/69000847597-control-tracks-in-soundswitch |
| S8 | BPM Detection Overview | https://support.soundswitch.com/en/support/solutions/articles/69000858486-soundswitch-bpm-detection-overview |
| S9 | Performance Mode Preferences Explained | https://support.soundswitch.com/en/support/solutions/articles/69000847088-soundswitch-performance-mode-preferences-explained |
| S10 | Utilizing the Effects Generator | https://support.soundswitch.com/en/support/solutions/articles/69000847595-soundswitch-utilizing-the-effects-generator |
| S11 | Movement Shape Effects | https://support.soundswitch.com/en/support/solutions/articles/69000847396-soundswitch-movement-shape-effects |
| S12 | What is SoundSwitch? | https://support.soundswitch.com/en/support/solutions/articles/69000847410-soundswitch-what-is-soundswitch- |

Autres sources (snippets de recherche uniquement, non lus en intégralité) :
- Groupe Facebook SoundSwitch User Group (plusieurs fils : BPM manuel, « auto loop group », assignation Control One).
- Bande-annonce Facebook « Getting Started with the Control One » (description des boutons hardware).

---

## 1. C'est quoi exactement un « autoloop » ? Structure / nombre d'étapes

**Définition officielle** : un Autoloop est un **« court clip d'éclairage »** (« short lighting clips ») qui joue **en synchronisation avec le Beatgrid** du logiciel DJ. C'est un **système de secours** (« backup system ») qui prend automatiquement le relais quand on charge dans le logiciel DJ un morceau qui n'a **pas de Script SoundSwitch**. (S1, S2, S12)

**Durées (bar lengths)** : un Autoloop est créé dans une durée fixe de **8, 16, 32, 64 ou 128 mesures (bars)**. (S1, S2) — l'article Autoscript ne propose que **16/32/64/128 bars** (S4). Ces durées sont alignées sur la structure du morceau (« designed to align with the song's structure »).

**Capacité** :
- **SoundSwitch 2.9+** : jusqu'à **128 Autoloops**, organisés en **4 banques (« banks ») de 32** Autoloops chacune. (S1, S3)
- **Avant 2.9** : 4 banques × **8** = **32** Autoloops au total. (S1, S2)
- À la migration 2.8 → 2.9, les 32 Autoloops existants sont répartis automatiquement à raison de 8 par banque. (S3)

**Structure interne / « étapes »** : ⚠️ **Aucune notion officielle de « steps » ou de « scenes » à l'intérieur d'un Autoloop n'est documentée.** Un Autoloop est un **clip temporel (timeline) d'une longueur en bars**, rempli via les **Control Tracks** (voir §2). Le terme « scene » est réservé par SoundSwitch aux **Static Looks** : « static looks function precisely like scenes in traditional DMX software » (S5). Donc : un Autoloop ≠ une liste de scenes ; c'est une piste temporelle continue.
- **Nombre max de « steps/scenes » par Autoloop : introuvable dans la documentation** (non documenté).
- Le « découpage » en segments se fait par des **blocs/cues** posés sur le BeatGrid des Control Tracks (couleur, strobe, intensité, position, effets), pas par une grille de scenes discrètes.

---

## 2. Paramètres exposés / comment est défini le contenu d'un Autoloop

Un Autoloop se construit en **Edit Mode** dans la **vue Autoloop** (bouton « A » en bas à droite), via les **Control Tracks**. (S1, S7)

**Trois types de Control Tracks** (S7) :
1. **Master Track** : contrôle **tous les fixtures du Venue Tab** depuis une seule piste. Une transition bleu→violet sur la Master Track est reproduite uniformément sur tous les fixtures (LED pars, lyres, panneaux LED). **Standardisée entre tous les venues** (un show Master Track créé pour un morceau rejoue tel quel dans un autre lieu). C'est la piste recommandée pour commencer un Autoloop.
2. **Fixture Tracks** : contrôle **par fixture individuelle**, pour déroger à la Master Track (ex. tel Par Can dans une autre couleur, telle lyre qui tourne différemment).
3. **Group Tracks** : groupe de fixtures (sans partager d'adresse DMX) piloté d'une seule piste ; supporte mute/solo.

**Paramètres/attributs exposés sur ces pistes** (couleur, mouvement, strobe, dimmer…) :
- **Couleur** : blocs couleur sur les tracks ; transitions de couleur (« color transition effects » recommandées). (S1, S7)
- **Intensité (dimmer)** : contrôle d'intensité/luminosité par blocs ; « slow intensity fades » (fades d'intensité lents) recommandés. (S1) — un article dédié existe : « Controlling Intensity with SoundSwitch » (référencé dans les recherches, non lu en intégralité).
- **Mouvement** : via **Position Cues** et les **Movement Shape Effects** — formes prédéfinies : **Circle, Horizontal/Vertical Scan, Horizontal/Vertical Oval, Horizontal/Vertical Figure 8, Horizontal/Vertical Triple 8, Square** ; avec réglage du **temps et de la vitesse** au début/fin de la sélection (effets qui grandissent/rétrécissent ou accélèrent). (S11)
- **Strobe** : bloc « Strobe » posé dans la piste (bouton Strobe de la toolbar ou clic droit → « Strobe »). (recherche : article « Adding Strobe Effects to Your Lighting Show ») + **Loop Auto Strobe** qui applique automatiquement un strobe sur les loops/loop-rolls < ½ beat (S9).
- **Effets génériques (Effects Generator)** : bibliothèque d'effets prédéfinis **glisser-déposer** sur une sélection du BeatGrid d'un Autoloop (ex. **Forward Chase** avec durée par fixture et **pulse intensity de 1/32ᵉ à 1 bar**). (S10)
- **Gobo / Prism / autres attributs** : via **Attribute Cues** (article « Controlling Gobo, Prism & more with Attribute Cues » référencé dans les recherches, non lu en intégralité).

**« Fade time » comme paramètre nommé : ⚠️ introuvable.** Il n'existe pas de champ « fade time » unique documenté ; les fades sont réalisés en traçant des rampes d'intensité/couleur sur la timeline (blocs de transition), et les fades d'intensité lents sont recommandés pour que l'Autoloop s'adapte à des morceaux variés. (S1)

**Autoscript Autoloops (2.7+)** : génération automatique d'un Autoloop : choisir la longueur (16/32/64/128 bars), un **preset Autoscript**, sélectionner les **Position Cues** et **Attribute Cues** à inclure et leur ordre, option d'inclure ou non les **effets de mouvement** (Circle, Figure Eight), couleurs personnalisées, et presets **Random**. (S4)

---

## 3. Synchronisation à la musique & avancement d'un Autoloop à l'autre

**Synchronisation primaire = le Beatgrid du logiciel DJ**, pas un BPM libre :
- En **Performance Mode**, les Autoloops sont « in sync with the Beatgrid », et **cyclent** (« cycling through your created Autoloops as you play »). (S1, S2, S12)
- Beatgrid supportés : **Serato DJ, VDJ 2021 (ou VDJ 8), Engine Prime**. (S1, S2)

**Avancement d'un Autoloop à l'autre** : chaque Autoloop joue pendant **sa durée en bars**, puis SoundSwitch **passe au suivant** dans la banque (cycle). Exemple officiel : si on a créé **4 Autoloops de 8 bars**, chacun d'une couleur différente, **les lumières changent de couleur toutes les 8 bars**, parfaitement calées sur le Beatgrid. (S1, S2)
- Donc : **l'unité d'avancement est la mesure (bar)**, alignée beat par beat via le beatgrid ; pas de compte de beats internes documenté.
- L'utilisateur peut aussi **forcer l'avancement** avec les boutons **« Next » / « Previous »** ou **lancer manuellement** un Autoloop (lié à l'option « Repeat Autoloop »). (S1)

**BPM Detection (ajout 2.9)** — source tempo alternative quand le morceau n'est PAS dans un logiciel DJ supporté (groupe live, Spotify, DJs sur logiciels non supportés) :
- Routage audio via **interface USB, micro intégré ou câble audio virtuel** ; SoundSwitch **détecte le BPM** et les Autoloops jouent « in sync with the detected BPM ». (S8)
- **Refresh rate** du tempo : 5 s (environnements dynamiques / open-format) à 10 s (genres stables type house). (S8)
- **Seuil audio** : si le niveau passe sous un seuil pendant **3 s**, option **Blackout** (tout s'éteint) ou **Pause Autoloop** (l'Autoloop gèle et tient son état) ; reprise immédiate dès que l'audio remonte. (S8)

**Relation avec les manipulations DJ** (davantage décrite pour les Scripts, mais contexte de la synchronisation) : ralentir le tempo ralentit les lumières, poser un loop fait boucler les lumières, tirer sur le disque affecte les lumières de la même façon. (S2, S12)

---

## 4. Les « loop groups » / banques d'Autoloops

⚠️ **Le terme « loop groups » n'existe pas dans la documentation officielle.** Les recherches font remonter des utilisateurs qui emploient « auto loop group » comme synonyme familier des **« Autoloop Banks »** (ex. fil Facebook « How to run one auto loop group in SoundSwitch »). Les concepts réels sont :

**Autoloop Banks (banques)** :
- **4 banques**, chacune de **32 Autoloops** (2.9+) → **128 au total** ; avant 2.9 : 4 × 8 = 32. (S1, S3)
- **Sélection de banque** : en Edit Mode (en-tête de banque surligné en bleu = banque active, la « Autoloop Matrix » affiche les 32 Autoloops de la banque) ; en Performance Mode, on **bascule entre les 4 banques**. (S3)
- **Gestion des banques** (2.9) : **réordonner/déplacer** par glisser-déposer (entre banques, à condition qu'un emplacement libre existe), **dupliquer** (clic droit), **auto-remplir les emplacements vides** (« Populate Empty Autoloops »). (S3)

**Exclusive Autoloop Banks (banques exclusives)** — le mécanisme qui s'approche le plus d'un « groupe de boucles isolé » :
- Permet de **restreindre la sélection d'Autoloops à une seule banque** (long-press sur la banque dans le logiciel, ou sur le Control One). La banque pulse/flashe (rouge sur le Control One).
- Désactivation : option **« Play All Banks »** dans le logiciel, ou **« Shift + l'une des 4 banques »** sur le Control One.
- Nuance : si un Autoloop d'une autre banque est en train de jouer, l'exclusivité ne prend effet qu'à la fin de l'Autoloop courant (ou via déclenchement manuel depuis la banque exclusive). (S3)

**Assignation à des sections de morceau / plages : ⚠️ PAS de fonctionnalité documentée.** Les Autoloops ne sont **pas** assignés à des sections spécifiques d'un morceau ni à des plages de durée dans SoundSwitch. Deux modes coexistent seulement : (a) **cycle automatique** en secours des morceaux non scriptés, (b) **déclenchement manuel** (banque/emplacement). Aucune notion d'« assigner tel Autoloop au refrain/à l'intro » n'apparaît dans les articles lus.
- Ne pas confondre avec les **Group Tracks** (S7) qui groupent des **fixtures**, pas des Autoloops.

---

## 5. Autoloop vs Script (scripted track) vs Static Look

| | **Script (scripted track)** | **Autoloop** | **Static Look** |
|---|---|---|---|
| **Nature** | Fichier d'éclairage **lié à un morceau audio précis** de la bibliothèque. | Clip d'éclairage **générique, indépendant du morceau**. | Scène **fixe** (équivalent d'une « scene » des logiciels DMX traditionnels). |
| **Durée/timing** | Cues/strobes/couleurs/mouvements **précisément calés sur la musique**, sur toute la longueur du morceau. | Durée fixe en **bars (8–128)**, boucle synchronisée au Beatgrid. | Pas de timeline : un **état figé** (valeurs par fixture). |
| **Déclenchement** | **Automatique** quand le morceau scripté est chargé. | **Automatique en secours** (morceau sans script), ou **manuel**. | **Manuel** (clic, MIDI) ; se superpose à l'Autoloop/Script en cours. |
| **Réaction au DJ** | Suit le tempo, les loops, le scratch, les faders en temps réel. | Suit le Beatgrid (cycle en bars). | Statique (ne suit pas le beatgrid). |
| **Granularité** | N'importe quel détail par piste. | Même outil d'édition (Control Tracks), mais contenu volontairement **simple** (couleurs pleines, transitions, fades lents). | **Contrôle granulaire par fixture** impossible autrement (ex. fog + lasers + sparklers en un moment précis). |

Sources : S2, S5, S12.

Détails notables :
- **Scripts** : « add a layer of dynamic lighting to your audio tracks » ; réponse temps réel aux manipulations DJ (S2, S12).
- **Autoloops** : « backup system » ; recommandation d'édition : **couleurs pleines, transitions de couleur, fades d'intensité lents** — car un Autoloop doit s'adapter à des morceaux aux rythmes variés, « matching the beat precisely isn't always the best approach ». (S1)
- **Static Looks** : « function precisely like scenes in traditional DMX software » ; les fixtures **non incluses** dans le look continuent de suivre l'Autoloop/Autoscript en cours ; une fixture incluse avec intensité 0 reste éteinte pendant le look. (S5)

---

## 6. Comment un Autoloop « prend le relais » automatiquement

- **Principe de secours** : quand on charge un morceau **sans Script SoundSwitch** dans le logiciel DJ, SoundSwitch **utilise automatiquement les Autoloops** ; ils se synchronisent au Beatgrid et **cyclent** pendant la lecture. (S1, S2, S12)
- **Depuis 2.9**, un Autoloop peut aussi être déclenché **à tout moment, même sur un morceau scripté** : le sélectionner pendant la lecture le lance immédiatement, **joue sa durée, puis revient au script**. (S3, S6)
- **Override Scripted Tracks** (priorité aux Autoloops sur les Scripts) :
  - Option **« Override Scripted Tracks »** dans les **Performance Mode Preferences**, ou bouton **« Autoloop Override »** du Control One. (S3, S6)
  - ⚠️ En 2.8.4 et antérieur, l'override ne s'applique **pas immédiatement** : il prend effet **au chargement du morceau suivant**. (S6)
- **Cas BPM Detection** : si l'audio passe sous le seuil 3 s → **blackout ou pause de l'Autoloop** ; reprise automatique de l'Autoloop dès que l'audio remonte au-dessus du seuil. (S8)

---

## 7. Déclenchement / choix d'un Autoloop (software, hardware, MIDI, auto)

1. **Automatique (secours)** : morceau sans script chargé → Autoloops cyclent seuls. (S1, S2)
2. **Logiciel (Performance Mode)** : sélection d'un Autoloop dans la banque (Matrix), boutons **Next/Previous**, option **« Repeat Autoloop »** (répétition infinie, depuis 2.3). (S1)
   - **Options de répétition (2.9)** : **Infinite Autoloop Repeat** (répète à l'infini) et **Track Duration Repeat** (répète jusqu'à la fin du morceau ; un nouveau morceau désactive la répétition et sélectionne un nouvel Autoloop). Ces préférences sont dans **Settings → Performance Mode**. (S3)
3. **Control One (hardware)** :
   - **Boutons de banque (Bank 1–4)** + **commutateur Autoloop / Static Look**. (source : vidéo « Getting Started with the Control One », snippet)
   - Bouton **« Autoloop Override »** pour passer en priorité Autoloop sur les scripts. (S3, S6)
   - **Long-press banque** = banque exclusive ; **Shift + banque** = désactiver l'exclusivité (« Play All Banks »). (S3)
   - **Feedback LED** (2.9) : l'Autoloop actif **clignote** ; **indicateur blanc** = banque sélectionnée, **bleu pulsé** = banque contenant l'Autoloop actif, **rouge pulsé** = banque exclusive. (S3)
4. **MIDI** :
   - L'option **Autoloop Override est mappable en MIDI** (tutoriel vidéo référencé). (S6)
   - Les **Static Looks** sont mappables en MIDI (« Expanded MIDI Control », bandoulière de déclencheurs d'effets). (S5)
   - ⚠️ Le mapping MIDI **direct d'un Autoloop individuel** n'est pas explicitement documenté dans les articles lus (seul le lancement « manuel » dans le logiciel est décrit).

---

## Synthèse — Ce qui est transposable / intéressant pour un logiciel d'éclairage autonome

1. **Modèle « backup » par défaut** : un système de boucles génériques qui prend le relais **quand il n'y a pas de show dédié** au morceau. C'est exactement le besoin d'un éclairage autonome : toujours quelque chose de musical qui tourne, sans trou noir.
2. **Durée exprimée en bars (8/16/32/64/128), pas en secondes** : aligner la longueur d'une boucle sur la structure musicale (un Autoloop de 8 bars = un cycle de couleur toutes les 8 mesures) rend le résultat « musical » même sans analyse fine. Transposable : stocker la durée d'une boucle en « beats/bars » et la resynchroniser au beatgrid/BPM.
3. **Cycle entre plusieurs boucles au lieu d'une seule** : SoundSwitch **enchaine les Autoloops** d'une banque (4 boucles de 8 bars → couleur change toutes les 8 bars). Un moteur autonome peut gagner en variété avec un simple **séquenceur de boucles** plutôt qu'une seule boucle en repeat.
4. **Hiérarchie Master / Fixture / Group** : une **Master Track « portable »** (valeurs couleur/intensité standardisées, indépendantes du parc matériel) + des surcharges par fixture/groupe. Très pertinent pour un rendu qui survit au changement de configuration matérielle.
5. **Édition volontairement simple pour les boucles** : couleurs pleines, transitions de couleur, fades d'intensité lents — parce qu'une boucle générique doit s'adapter à des tempos variés. Leçon : ne pas chercher à « coller au beat » au sample près dans une boucle générique.
6. **Synchronisation = Beatgrid du logiciel DJ, avec BPM Detection en fallback** : deux sources de tempo hiérarchisées (beatgrid natif > détection BPM audio pour les sources non supportées). Transposable : moteur tempo avec source prioritaire + fallback d'analyse audio.
7. **Gestion des « trous » audio** : seuil audio (3 s sous seuil) → **blackout ou pause-gel de la boucle**, reprise immédiate. C'est le comportement attendu d'un système autonome entre deux morceaux.
8. **Banques + banque « exclusive »** : organiser les boucles en **4 banques** et pouvoir **restreindre la sélection à une banque** (long-press) ou « jouer toutes les banques ». Un mécanisme de « set de boucles actif » simple et efficace pour varier l'ambiance à la volée.
9. **Override / déclenchement à la volée** : pouvoir **déclencher une boucle par-dessus un script en cours** (joue sa durée puis revient), avec une option « override » persistante. Transposable : une « punch » de boucle temporaire + un mode priorité boucles/scripts.
10. **Séparation nette des 3 objets** : **Script** (show calé sur un morceau précis), **Autoloop** (boucle générique calée sur le beat), **Static Look** (scène figée, granulaire, déclenchable par-dessus). Ce triptyque est un modèle d'architecture clair et réutilisable tel quel pour un moteur d'éclairage autonome.

**Points non trouvés / à ne pas inventer** :
- Nombre max de « steps/scenes » internes à un Autoloop (non documenté — l'Autoloop est une timeline, pas une liste de scenes).
- Un paramètre unique « fade time » (les fades se font par rampes sur les pistes).
- Une assignation des Autoloops à des sections de morceau ou des plages (fonctionnalité absente de la doc).
- Le mapping MIDI d'un Autoloop individuel (seuls l'override et les static looks sont explicitement mappables dans les articles lus).
