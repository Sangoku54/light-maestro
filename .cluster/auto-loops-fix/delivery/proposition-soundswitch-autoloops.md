# Proposition — Adaptation des Autoloops SoundSwitch → Light Maestro

**Date** : 2026-08-20 · **Objet** : analyse du système d'Autoloops de SoundSwitch et ce qu'on en retient pour le Design A (étape 2 auto-loops). **Aucun code.**
**Processus** : 3 analystes parallèles (mécanique, timing/BPM, adaptation) + 1 relecture critique croisée.
**Sources** : 12+ articles officiels SoundSwitch lus en intégralité (support.soundswitch.com / support.inmusicstore.com) + recherches web ciblées.

---

## 1. Ce que sont réellement les Autoloops SoundSwitch

Distinction de vocabulaire à graver : SoundSwitch a **trois objets**, et ils ne se confondent pas.

| Objet | Nature | Timing | Déclenchement |
|---|---|---|---|
| **Script** (scripted track) | Show d'éclairage **lié à un morceau précis** | Calé sur le morceau, réagit en temps réel au DJ (tempo/loop/scratch) | Auto au chargement du morceau scripté |
| **Autoloop** | **Clip lumineux générique** (indépendant du morceau) | Durée en **bars** (8/16/32/64/128), synchronisé au **Beatgrid** DJ | **Auto en secours** (morceau sans script), ou manuel |
| **Static Look** | **Scène figée** (équivalent des "scenes" DMX) | Aucun (état statique) | Manuel (clic/MIDI), se superpose |

**L'Autoloop est donc un « système de secours »** : quand un morceau chargé n'a pas de Script, les autoloops prennent le relais et **cyclent** en suivant le beatgrid.

### Faits clés (sourcés, vérifiés)

1. **Un autoloop n'est PAS une liste de scènes.** C'est une **timeline continue** d'une durée en bars, remplie via des **Control Tracks** (Master / Fixture / Group) + des cues discrets (Position Cues = pan/tilt, Attribute Cues = gobo/prisme/focus/zoom).
2. **Capacité (2.9)** : **4 banques × 32 = 128 autoloops** (avant 2.9 : 4 × 8 = 32). Le terme « loop groups » **n'existe pas** officiellement ; les concepts réels sont les **Autoloop Banks** + la **banque exclusive**.
3. **Pas de crossfade natif** entre deux autoloops ni autoloop↔static look. Les fades sont **écrits à l'intérieur du loop** : rampes d'intensité (« slow intensity fades »), transitions de couleur, espacement des position flags.
4. **Synchronisation** = **bar-aligned**, dérivée du **Beatgrid du logiciel DJ** (Serato / VDJ / Engine Prime) ; en **2.9**, une **détection BPM temps réel** (audio routé via USB/micro/câble virtuel) sert de source de repli — et permet les autoloops **sans logiciel DJ** (groupe live, Spotify, DJ sur logiciel non supporté).
5. **Contenu volontairement simple** : couleurs pleines, transitions de couleur, fades d'intensité lents. Doctrine officielle : « *matching the beat precisely isn't always the best approach* » — car une boucle générique doit s'adapter à des tempos variés.
6. **« Autoloop Override »** = les **autoloops prennent le dessus sur les scripts** (pas l'inverse). Priorité par défaut : **manuel (static look) > script > autoloop**.
7. **Loop Auto Strobe** = effet **réactif** déclenché par un Loop/Loop-Roll hardware < ½ beat ; la cadence dérive de la **longueur du loop matériel**, pas du BPM. Ce n'est pas une étape interne du loop.
8. **Gestion des trous audio** : audio sous le seuil pendant 3 s → **Blackout** ou **Pause Autoloop** (gel de l'état) ; reprise immédiate au retour du signal.

---

## 2. Correction des prémisses (relecture critique)

Le rapport « adaptation » posait des « invariants SoundSwitch » sans source ; **6 étaient faux ou inversés**. Tableau de réconciliation (fait correct vs erreur) :

| # | Fait correct (sources primaires) | Erreur corrigée |
|---|---|---|
| 1 | Autoloop = **timeline continue** (Control Tracks), pas des scènes | « séquence de scenes complètes » → FAUX |
| 2 | « loop groups » **n'existe pas** ; 4 Autoloop Banks, sans assignation à des sections | « loop groups assignés intro/verse/chorus » → FAUX |
| 3 | **Aucun crossfade natif** ; fades = rampes internes | « crossfade entre scenes sur N beats » → FAUX |
| 4 | **Autoloop Override = autoloop gagne sur script** | « script prend le dessus sur l'autoloop » → INVERSÉ |
| 5 | Attribute Cues = **gobo/prisme/focus/zoom uniquement** (couleur/position/intensité = Control Tracks) | « modulation couleur/position/intensité » → FAUX sur le périmètre |
| 6 | Loop Auto Strobe = effet **réactif** cadencé par le loop-roll matériel | « strobe beat-sync inclus dans le loop » → FAUX |

**Conséquence** : les verdicts d'adaptation restent globalement bons (6/8 valides, 2 à re-justifier, 1 renforcé, **aucun à inverser**), mais les **justifications** doivent être corrigées pour ne pas faire copier des features inexistantes à un futur dev.

---

## 3. Recommandation consolidée (impact / effort)

### Bloc 1 — Qualité du loop (livrer d'abord)

- **R1. Frames complètes + OFF total (`RGB=0`, `shutter=0`, `dimmer=0`).** Impact ÉLEVÉ · Effort FAIBLE · Faisabilité HAUTE (~90 % fait en étape 1).
  - Matérialiser chaque `AutoLoopStep` en **frame totale** (toutes les adresses du loop), y compris OFF via `putRgbSegments(…, [0,0,0])`. Étendre le fill OFF au strobe et aux movers à roue de couleur.
  - Justification corrigée : exigé par **notre** architecture (source dédiée + merge HTP + miroir 3D), pas par les « scenes » SoundSwitch. L'analogue correct = la **Master Track** (état couvrant tout + surcharges), déjà couvert par notre merge HTP.

- **R2. Fade par classe de canal (`fadeMs`/loop).** Impact ÉLEVÉ (tue le snap) · Effort FAIBLE-MOYEN · Faisabilité HAUTE.
  - À chaque transition de step : **ramper** dimmer + couleur, **snapper** pan/tilt + shutter. C'est exactement le modèle SoundSwitch réel (rampes *dans* le loop, pas crossfade), et c'est **non-optionnel** : sans lui, nos steps discrets font des sauts brutaux.

### Bloc 2 — Musicalité & robustesse

- **R3. Beat-quantize optionnel (`beatQuantize`).** Impact ÉLEVÉ · Effort FAIBLE (réutilise `analyzeAudioBuffer`).
  - Flag : quand BPM/downbeats sont disponibles, **snapper la transition de step sur le downbeat le plus proche** au lieu de l'horloge frame fixe.

- **R4. Priorité de sources + mutex cédant.** Impact MOYEN-ÉLEVÉ · Effort MOYEN.
  - Enum `manuel > chaser > auto-loop` (le **default** SoundSwitch) ; l'autoLoop **cède le mutex** quand une source supérieure devient active.
  - **Ne pas appeler ce flag « Autoloop Override »** (terme inversé chez SoundSwitch). Un futur flag « auto-loop > chaser » correspondrait au vrai Autoloop Override.

- **R5. Fallback idle (`autoStartWhenIdle`).** Impact MOYEN · Effort FAIBLE.
  - Flag opt-in + délai : mutex libre depuis X s → démarrer le loop par défaut. Capte l'esprit « filet toujours actif » sans autoscript.

### Bloc 3 — Différé / optionnel

- **R6. Composition de 2 primitives (`compose`).** Impact ÉLEVÉ · Effort MOYEN · après R1–R5. Transposition de la *coexistence de pistes* SoundSwitch (pas d'un stack d'attribute cues).
- **R7 (futur). Sets de loops / « banques ».** Le vrai concept des 4 Autoloop Banks + banque exclusive → graine d'un futur « set de loops actif ». Hors périmètre.

### À ne PAS faire (explicite)

1. **Pas de crossfade entre « scenes »/loops** — inexistant chez SoundSwitch, balayages pan/tilt moches, conflit miroir 3D. Le fade est **interne** (R2).
2. **Pas de copie du modèle « timeline continue » / pas de refonte chaser** — frames discrètes suffisent.
3. **Pas de moteur de beat-grid complet** — aucune source DJ à brancher ; over-engineering. R3 suffit.
4. **Pas d'assignation de loops à des sections de morceau** — feature inexistante + exige classifieur + UI + switching.
5. **Pas de stack générique d'« attribute cues » pour couleur/position/intensité** — ces attributs sont des Control Tracks chez SoundSwitch.
6. **Pas de réutilisation du terme « Autoloop Override » pour notre priorité** — sens inversé, risque de régression.

---

## 4. Impact concret sur le Design A (étape 2)

Le **Design A reste intact** (widget `actionType:'autoLoop'` + moteur frame-locked + source dédiée `auto-loop` + frames complètes + miroir 3D + mutex). La recherche SoundSwitch **valide** l'architecture et **précise** le contenu :

- **Le socle étape 2 doit produire des frames complètes avec OFF total (R1)** — c'est le prérequis non négociable.
- **R2 (fade par classe) est le premier « vrai » gain visuel** après R1 : sans lui, la boucle fait du stroboscope de valeurs.
- **R3, R4, R5** sont des flags **opt-in** bon marché à ajouter progressivement — pas de refonte, juste des garde-fous.
- **R6, R7** sont différés et hors périmètre « une boucle simple ».

---

## 5. Suite

1. **Lien utilisateur intégré** : [SoundSwitch — Autoloops Explained](https://support.soundswitch.com/en/support/solutions/articles/69000847100-soundswitch-autoloops-explained) (réf. 69000847100). C'est la **source primaire S1** déjà lue en intégralité par l'analyste « mécanique » et citée dans `subagent_mechanics.md`. Son extrait clé (« Autoloops serve as a backup system… ») correspond mot pour mot au contenu intégré. **Aucune information nouvelle** — la proposition reste inchangée.
2. **GO + 2 décisions en attente** (déjà exposées) : (1) persistance de la config loop (dans le widget vs globale) ; (2) onglet QuickShow « Loops auto » laissé tel quel vs migré.
3. Dès GO : implémenter l'étape 2 en commençant par **R1** (frames complètes) puis **R2** (fade par classe), tests, build 1.0.14.

---

## Fichiers sources

- `soundswitch/plan.md` — plan de recherche initial.
- `soundswitch/subagent_mechanics.md` — mécanique/structure/cycle de vie (12 articles lus).
- `soundswitch/subagent_timing.md` — timing/BPM/strobe/override/attribute cues (12 articles lus).
- `soundswitch/subagent_adapt.md` — cartographie adopt/adapter/ignorer (⚠️ prémisses à corriger).
- `soundswitch/review.md` — relecture critique : réconciliation des faits + recommandation consolidée.
