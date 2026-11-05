# SoundSwitch — Modèle de timing/synchronisation des Autoloops (analyse)

> Analyse factuelle du système d'**Autoloops** (boucles lumineuses) de SoundSwitch.
> ⚠️ On parle des **Autoloops**, PAS de l'Autoscript (analyse audio). L'Autoscript n'est évoqué ici que là où il interagit avec les autoloops (autoscripting d'autoloops, attribute cues).
>
> Méthode : lecture intégrale des articles officiels support.soundswitch.com / support.inmusicstore.com listés en fin de document. Aucune source secondaire (forums, YouTube) n'est utilisée comme fait ; elles ne servent qu'à signaler ce qui n'est PAS documenté.

---

## 1. Comment les autoloops se synchronisent-ils au BPM/beat ?

**Réponse : avancement calé sur la barre, dérivée du Beatgrid (pas un timer libre).**

- Les autoloops sont créés en **durées de barres fixes** : 8, 16, 32, 64 et 128 bars. *(Autoloops Explained)*
- En Performance Mode, les autoloops **« are in sync with the Beatgrid »** et **« cycle through as you play »**. Exemple officiel : « si vous avez fabriqué quatre autoloops de 8 bars, chacun avec une couleur distincte, vos lumières changeront de couleur toutes les 8 barres, parfaitement alignées sur le Beatgrid de votre logiciel DJ. » *(Autoloops Explained)*
- Le Beatgrid provient du **logiciel DJ** supporté (Serato DJ, VirtualDJ 2021, Engine Prime). *(Autoloops Explained)*
- En 2.9, la source d'horloge peut aussi être le **BPM détecté** sur un signal audio (voir Q2). *(BPM Detection Overview)*

**Conclusion sur le modèle :**
- C'est un modèle **beat/bar-aligned (phrase-based)**, pas un timer libre ni un simple métronome. La **frontière d'avancement = la barre**, et le nombre de barres est la durée de l'autoloop.
- En interne, les positions/cues d'un autoloop sont alignées sur le beatgrid (« align them with your Beatgrid »). *(Position Cues)*
- Il n'y a pas de notion documentée de « frame-locked » ni d'interpolation entre étapes pilotée par un fps fixe : le calage est musical (beatgrid/BPM).

---

## 2. Détection « auto BPM » (introduite en 2.9)

**Réponse : analyse temps réel d'un signal audio routé en entrée ; permet les autoloops SANS logiciel DJ supporté.**

Mécanisme (source : *BPM Detection Overview*) :
- **Entrée audio temps réel** : on route n'importe quel audio vers SoundSwitch via **interface USB**, **micro intégré**, ou **câble audio virtuel** entre applications.
- Un **VU-mètre** affiche le niveau ; il faut viser la zone verte. Un **Threshold Control** définit le niveau minimum capté.
- **Tempo Detection Refresh Rate** : contrôle la fréquence à laquelle le BPM est recalculé (voir Q3).
- **BPM Detection Range** : borne la plage de BPM considérée (améliore la précision).
- **Light Show Options** (quand l'audio passe sous le seuil pendant 3 s) : **Blackout** (tout baisse) ou **Pause Autoloop** (l'autoloop en cours se fige et garde son état). Dès que l'audio repasse au-dessus du seuil, les autoloops **reprennent immédiatement**.
- On active via un toggle ; **les autoloops « play in sync with the detected BPM »**.
- Utilisable aussi en **Edit Mode** pendant la création d'autoloops (pour synchroniser la création sur une source audio).

Usage « sans logiciel DJ » (sources : *What's New 2.9*, *Configuring BPM Detection for a Live Band*, *Virtual Audio Routing*) :
- **Groupes (live band)** : source audio = grosse caisse du batteur de préférence, ou **click track** (meilleure source possible car « SoundSwitch et le groupe suivent exactement le même pulse »). À défaut, le musicien le plus rythmiquement régulier (ex. bassiste en swing).
- **DJ sur logiciel non supporté** (Rekordbox, djay Pro…) : via câble virtuel.
- **Streaming** (Spotify, Apple Music) : via câble virtuel.
- **Clubs / salles** : via sortie audio de la table.

→ Le point clé pour notre transposition : **l'autoloop n'a pas besoin du metadata BPM d'un fichier** ; il peut être cadencé par une **détection BPM temps réel** sur un flux audio quelconque.

---

## 3. Que se passe-t-il quand le tempo change en cours de loop ?

**Réponse : deux cas distincts. Le comportement précis de recalage/glissement mid-loop n'est PAS documenté explicitement.**

**Cas A — source = logiciel DJ (Beatgrid).** Le beatgrid est l'horloge ; l'autoloop suit le beatgrid. Aucune doc ne décrit de comportement particulier de « reset » au changement de tempo : le calage est continu sur le beatgrid.

**Cas B — source = BPM Detection (2.9).** Le paramètre central est le **Tempo Detection Refresh Rate** :
- « This setting controls how often BPM Detection recalculates the BPM. »
- Environnements dynamiques (groupes, DJ open-format) → **refresh le plus bas (5 s)** « to adapt to frequent BPM changes ».
- Genres stables (house) → refresh plus long (ex. 10 s), plus précis.
- Le guide live band le confirme : « If your arrangements do feature varying tempos and quick changes, you'll want to shorten the Refresh Rate such that **the BPM is updated in quick response to changes in tempo**. » → donc le BPM est **réestimé périodiquement** et les autoloops se recalent sur le nouveau BPM au rythme du refresh.

**Non documenté / à signaler explicitement :**
- Le mécanisme exact de transition au moment du changement (snap immédiat de phase vs glissement progressif vs reset de l'autoloop) **n'est décrit dans aucun des articles consultés**.
- Le seul comportement documenté de « gel » est le **Pause Autoloop / Blackout** déclenché quand l'audio passe **sous le seuil pendant 3 secondes** (et non sur un changement de tempo).

---

## 4. « Loop Auto Strobe »

**Réponse : effet strobe temps réel déclenché par un Loop/Loop Roll du hardware DJ, cadencé par la longueur du loop (pas une étape d'autoloop).**

Source : *Utilizing Loop Auto Strobe* (feature introduite en **v1.7**) :
- « adds dynamic strobe effects to your lights **when you launch a Loop or Loop Roll effect on your DJ hardware that's shorter than 1/2 a beat**. »
- **Relation à la durée du loop** : « As the length of the loop decreases, the **Strobe Rate increases** » → le strobe se synchronise en temps réel sur la longueur du loop hardware (plus le loop est court, plus le strobe clignote vite).
- Activation/désactivation : onglet **Performance Mode** des préférences.

**Pour notre transposition :** c'est une **couche d'effet temps réel indépendante du séquenceur d'autoloop**, mappée sur une variable externe (longueur de loop roll du hardware → taux de strobe). Ce n'est pas une « étape strobe » dans la timeline de l'autoloop.

---

## 5. « Autoloop Override » (remplacement des infos d'un script)

**Réponse : un flag de mode + un bouton hardware ; comportement en deux temps (pré-2.9 vs 2.9+).**

Source principale : *Autoloop Override for Scripted Tracks* (titre officiel « 2.8.4 and earlier ») + *Autoloop Improvements 2.9*.

**Historique (v1.7 → 2.8.4) :**
- Feature « Autoloop Override » introduite en **1.7**.
- On active l'option **« Override Scripted Tracks »** dans les **Performance Mode Preferences**.
- ⚠️ Comportement pré-2.9 : **pas d'effet immédiat** — « this change won't take effect immediately. It will kick in **when the next track is loaded** in your player. »
- On peut aussi **mapper l'option en MIDI**.

**2.9+ :**
- On peut **déclencher un autoloop à tout moment, même par-dessus un scripted track** : « Simply select an Autoloop during playback, and it will immediately begin, **playing for its duration before returning to the scripted track**. »
- Pour un remplacement **permanent/prioritaire** : option **« Override Scripted Tracks »** OU bouton **« Autoloop Override »** sur le **Control One**.

**Pour notre transposition :** deux sémantiques distinctes :
1. **Override ponctuel** (2.9) : un autoloop s'insère, joue sa durée, puis rend la main au script.
2. **Override de mode** : un flag prioritaire (scripté↔autoloop) dont la prise d'effet peut être différée (au prochain chargement de track, en pré-2.9).

---

## 6. Y a-t-il un fade entre deux autoloops, ou autoloop ↔ static look ?

**Réponse : AUCUN crossfade automatique documenté. Les fades se font À L'INTÉRIEUR de l'autoloop, via les Control Tracks.**

- La doc officielle recommande de construire les fades **dans** l'autoloop : « Solid color loops, **color transition effects**, and **slow intensity fades** tend to work well with Autoloops. » *(Autoloops Explained)*
- Les **Color Transitions** se créent **dans une sélection d'un Control Track** (bouton « Color Transition » : couleur de départ → couleur d'arrivée), donc **sur la timeline de l'autoloop**, pas entre deux autoloops. *(Utilizing Color Transitions)*
- Les transitions entre **Position Cues** sont aussi internes à la timeline (« space your Position Flags apart adequately to allow fixtures sufficient time to transition between Positions »). *(Position Cues)*
- Aucun article officiel consulté ne décrit un **crossfade entre deux autoloops successifs** ni entre un **autoloop et un static look**. À l'inverse, la communauté demande explicitement « comment fader entre autoloops / static looks » (titre d'un post du groupe Facebook SoundSwitch), ce qui confirme que ce n'est pas une feature native documentée.

**Pour notre transposition :** le fade est une **propriété écrite dans la timeline du loop** (rampe d'intensité / transition de couleur / interpolation de position), **pas** un fondu de transition entre états. Un « crossfade entre looks » n'existe pas nativement dans le modèle SoundSwitch.

---

## 7. « Attribute Cues » : définition et modulation d'un autoloop

**Réponse : cues qui pilotent les fonctions spéciales d'un fixture (gobo, prisme, focus, zoom), placés sur la timeline d'un autoloop/script.**

Source : *Controlling Gobo, Prism & more with Attribute Cues* + *Pan and Tilt Control with Position Cues* + *How to Autoscript Autoloops*.

- **Ce que c'est** : les Attribute Cues contrôlent les **fonctions spéciales** (GOBO, Prism, Focus, Zoom…).
- **Frontière importante** : les attributs de base (**Intensity, Color, Pan/Tilt, Strobe**) se pilotent par les **Control Tracks** sur la timeline, **PAS** par des Attribute Cues.
- **Comment ça module un autoloop** :
  - On crée l'Attribute Cue (menu Attribute Cue → choix de l'attribut → valeur).
  - On l'insère dans la timeline de l'autoloop (ou du script) ; au moment voulu du loop, la valeur (ex. gobo n°3, prisme activé, focus) est appliquée.
  - L'**Autoscript** peut **inclure automatiquement** ces cues : dans le dialogue d'autoscript, on « select which of your Position Cues and Attribute Cues will be included » et on définit leur ordre. *(How to Autoscript Autoloops)*
  - **Édition centralisée** : « editing Attribute Cues … will automatically update all scripted tracks **or autoloops** containing these Attributes » (utile pour des réglages « venue-specific » comme le focus d'une lyre). *(Attribute Cues)*
- **Position Cues** (pan/tilt) : se placent dans le **Master Track** (flag dans le Movement Track), **alignés au beatgrid** ; « space your Position Flags apart adequately » pour laisser le temps de transition. Possibilité d'**override par fixture** (Position Override). *(Position Cues)*

**Pour notre transposition :** dans le modèle SoundSwitch, un autoloop = une timeline barre-aligned sur laquelle on dépose **deux types d'objets** :
1. **Control Tracks** (intensité, couleur, pan/tilt, strobe) — valeurs continues/rampes.
2. **Cues discrets** (Position Cues = pan/tilt, Attribute Cues = gobo/prisme/focus/zoom) — des « événements » ponctuels qui changent un paramètre à un moment donné du loop, avec temps de transition à respecter entre deux flags.

---

## Synthèse — Modèle de timing idéal à transposer

**1. Horloge = musicale, bar-aligned (pas frame-locked, pas timer libre).**
- L'unité de découpe d'un autoloop est la **barre** (8/16/32/64/128). L'avancement des étapes est calé sur **les frontières de barre**, elles-mêmes dérivées d'une horloge musicale : **Beatgrid du logiciel DJ** (source primaire) ou **BPM détecté en temps réel** (source de repli 2.9).
- Conséquence d'architecture : le moteur doit raisonner en **position musicale (bar.beat.tick)** et non en ms/frames, et convertir vers le temps seulement au moment du rendu.

**2. Deux sources d'horloge, une seule abstraction.**
- Source A (métadonnée/beatgrid) : BPM stable, phase connue → calage exact.
- Source B (détection temps réel) : BPM **réestimé périodiquement** (refresh rate configurable, 5 s min pour environnements dynamiques) ; les autoloops **se recalent sur le nouveau BPM**. Comportement de transition mid-loop non spécifié chez SoundSwitch → à définir nous-mêmes (snap vs glide vs resync au prochain downbeat).

**3. Gestion du tempo :**
- BPM stable → pas de souci.
- Changement de tempo → ré-estimation au rythme du refresh + recalage. SoundSwitch ne documente pas le glissement précis ; une implémentation propre = **recalage au prochain downbeat** (jamais de saut au milieu d'une barre) + **pas de reset de l'état lumineux** (l'état est conservé, seule la cadence change).
- Silence > seuil (3 s) → deux options : **blackout** ou **freeze de l'état courant** (« Pause Autoloop » = l'autoloop gèle et garde son look). Reprise immédiate au retour du signal. C'est le seul « gel » documenté.

**4. Fade : pas de crossfade entre looks.** Les transitions douces (intensité, couleur, position) sont **écrites dans la timeline du loop** (rampes d'intensité, color transitions, espacement des position flags pour laisser le temps de bouger). Un « fondu entre deux autoloops » n'existe pas nativement → si on le veut, il faut l'ajouter nous-mêmes comme un **overlap/crossfade entre deux états**, distinct du modèle SoundSwitch.

**5. Effets temps réel séparés du séquenceur.** Le strobe (Loop Auto Strobe) est une **couche réactive** mappée sur une variable externe (longueur de loop hardware → taux de strobe), indépendante de la timeline. À traiter comme un modulateur temps réel, pas comme une étape.

**6. Override = mode, pas une donnée de loop.** Deux sémantiques : insertion ponctuelle (un autoloop joue sa durée puis rend la main au script) et flag de priorité (scripté↔autoloop). À modéliser comme un **état de priorité** au niveau du moteur de lecture.

---

## Sources réellement consultées (lues intégralement)

1. Autoloop Improvements in SoundSwitch 2.9 — https://support.soundswitch.com/en/support/solutions/articles/69000858487-soundswitch-autoloop-improvements-in-soundswitch-2-9
2. BPM Detection Overview — https://support.soundswitch.com/en/support/solutions/articles/69000858486-soundswitch-bpm-detection-overview
3. Utilizing Loop Auto Strobe — https://support.soundswitch.com/en/support/solutions/articles/69000847399-soundswitch-utilizing-loop-auto-strobe
4. Autoloop Override for Scripted Tracks (2.8.4 and earlier) — https://support.soundswitch.com/en/support/solutions/articles/69000847086-soundswitch-2-8-4-and-earlier-autoloop-override-for-scripted-tracks
5. Autoloops Explained — https://support.soundswitch.com/en/support/solutions/articles/69000847100-soundswitch-autoloops-explained
6. What's New in SoundSwitch 2.9 — https://support.soundswitch.com/en/support/solutions/articles/69000858481-soundswitch-what-s-new-in-soundswitch-2-9-
7. Configuring BPM Detection for a Live Band — https://support.inmusicstore.com/en/support/solutions/articles/69000859725-soundswitch-configuring-bpm-detection-for-a-live-band
8. Utilizing BPM Detection with Virtual Audio Routing — https://support.soundswitch.com/en/support/solutions/articles/69000858622-soundswitch-utilizing-bpm-detection-with-virtual-audio-routing
9. Controlling Gobo, Prism & more with Attribute Cues — https://support.soundswitch.com/en/support/solutions/articles/69000828942-soundswitch-controlling-gobo-prism-more-with-attribute-cues
10. How to Autoscript Autoloops — https://support.soundswitch.com/en/support/solutions/articles/69000844240-soundswitch-how-to-autoscript-autoloops
11. Utilizing Color Transitions — https://support.soundswitch.com/en/support/solutions/articles/69000847584-soundswitch-utilizing-color-transitions
12. Pan and Tilt Control with Position Cues — https://support.soundswitch.com/en/support/solutions/articles/69000847598-soundswitch-pan-and-tilt-control-with-position-cues-

### Faits non trouvés / non documentés (à confirmer ailleurs si besoin)
- Comportement exact de **transition mid-loop lors d'un changement de tempo** (snap/glide/reset) : non documenté dans les articles consultés.
- **Crossfade natif entre autoloops / entre autoloop et static look** : non documenté (les fades sont internes aux loops).
- Latence/precision de la détection BPM (offset de phase audio↔lumière) : non chiffrée dans les articles consultés.
