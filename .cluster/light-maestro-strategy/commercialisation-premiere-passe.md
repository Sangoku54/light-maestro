# Commercialisation — première passe

**Date** : 17 août 2026 · **Projet** : light-maestro
**Base** : `diagnostic-strategique-light-maestro.md` (14 août 2026, 6 sous-agents + revue adversarial). Ce document n'est pas une nouvelle recherche : c'est la **synthèse orientée « comment on gagne de l'argent et comment on est trouvé »**, à partir du corpus stratégique existant.

> Statut : **première passe, à itérer**. Les prix/concurrents viennent du diagnostic (vérifiés août 2026). Les choix de split free/paid et de licence sont des **propositions**, pas des décisions gravées.

---

## 1) Pitch commercial (1 phrase)

> **« Ton show lumière pro, sans technicien et sans abonnement — ça marche avec ta musique en 30 secondes. »**

Trois promesses qui répondent aux trois peurs du segment : *« je n'y connais rien »* (auto-réactivité + 3D), *« ça va planter en live »* (fiabilité + fail-safe), *« on va encore me ponctionner »* (gratuit + one-shot, jamais d'abonnement).

---

## 2) Modèle économique (reprend la décision du diagnostic)

| Étape | Modèle | Déclencheur |
|---|---|---|
| **Maintenant → ~1 000 actifs** | **Gratuit total + donations** (Ko-fi/PayPal) | Aucun revenu visé ; l'objectif est l'adoption et le bouche-à-oreille |
| **Après ~1 000 actifs** | **Open core, one-shot 49–99 €** | Une base d'utilisateurs prouve la demande ; les donations montrent une disposition à payer |
| **Jamais** | Abonnement | C'est le cri de ralliement anti-SoundSwitch (7,99 $/mois) |

**Pourquoi l'open core one-shot et pas autre chose :**
- **Abonnement** : rédhibitoire pour le segment (musiciens = revenus irréguliers, méfiance des ponctions).
- **100 % payant** : tue la distribution (la gratuité EST le canal marketing d'une niche sans budget).
- **100 % gratuit + dons** : ne finance pas la maintenance long terme (le cas Freestyler, freeware mort, est l'anti-modèle).
- **Open core one-shot** : la magie reste gratuite (le moteur viral), les « pro » paient une fois pour débloquer le périmètre qui les fait gagner du temps/de l'argent.

---

## 3) Split open core — proposition free vs paid

> Règle directrice : **la crédibilité (attendu minimum 2026) reste gratuite** ; **les différenciants de Phase 2** sont monétisés. On ne paie jamais pour le plancher fonctionnel (sinon on perd la comparaison face à QLC+).

| Fonction | Gratuit (Core) | Payé (Pro one-shot) |
|---|---|---|
| Patch par modèle + scènes + chasers | ✅ | — |
| Audio-réactivité + autoscript | ✅ (la ligne de marque, jamais payante) | — |
| Stage 3D (scène, musiciens, foule, faisceaux) | ✅ | — |
| Sortie USB-DMX + Art-Net/sACN | ✅ **jusqu'à 4 univers** | ✅ **8–16 univers** |
| MIDI + OSC + MTC + remote web | ✅ | — |
| Bibliothèque fixtures (OFL) | ✅ | — |
| **Pixel mapping 2D/3D audio-réactif** | ❌ (teaser/démo) | ✅ |
| **Génération de show assistée avancée** | ✅ de base | ✅ (structure complète, presets pro) |
| **Export vidéo du show 3D** | ❌ | ✅ |
| Presets premium + galerie | ✅ communauté | ✅ packs premium |
| Support | forum | ✅ prioritaire |

**Le levier psychologique** : l'utilisateur gratos a déjà « son show en 30 secondes ». Ce qui lui manque, c'est *plus grand* (univers), *plus spectaculaire* (pixel mapping), *plus partageable* (export vidéo). Ce sont des envies, pas des besoins de base — donc payables sans frustration.

---

## 4) Pricing — points et justifications

| Offre | Prix (proposition) | Justification vs marché |
|---|---|---|
| **Core** | 0 € | Bat QLC+ sur l'UX, bat SoundSwitch sur le prix et la liberté hardware |
| **Pro (one-shot)** | **49 € lancement → 79–99 € mature** | Sous Lightjams (125 $) et Daslight 5 unlimited (139 $) ; au-dessus de « l'achat d'impulsion » mais sous la douleur d'un abonnement annuel |
| **Donation** | 5–25 € | Carburant de la phase gratuite |

**Ancrage psychologique** : « le prix d'un dongle USB-DMX » (~30–50 €) est le repère mental du segment — 49 € one-shot se situe pile dessus. L'argument : *« tu as déjà payé ton matériel, le logiciel coûte une fois et c'est tout »*.

---

## 5) Go-to-market — canaux et séquençage (calé sur les phases)

> Leçon du diagnostic : **la niche achète l'image du show, pas la feature list** (Madrix). Et **la distribution se construit en parallèle du code, pas après** — les communautés mûrissent lentement.

| Quand | Action de distribution | Livrable |
|---|---|---|
| **Fin Phase 1** (crédibilité) | Filmer les **5 moments magiques** (< 60 s chacun, dry-run sans hardware) | Démo officielle 60–90 s |
| **Fin Phase 1** | Ouvrir **page projet + Discord + « pourquoi c'est gratuit »** | Présence minimale |
| **Pendant Phase 2** | **Tutos débutant→pro** (YouTube), posts Reddit (`r/lightingdesign`, `r/stagelighting`, `r/WeAreTheMusicMakers`), groupes Facebook groupes locaux/DJ | Contenu récurrent |
| **Phase 2 fin** | **Partage de presets** + galerie de shows (le `.lmpreset` du groupe A charge chez le groupe B → réseau de prescripteurs) | Mécanisme viral |
| **Phase 3** | Campagne « la réponse par défaut sur les forums » | Devenir LA reco Reddit/Facebook |
| **À ~1 000 actifs** | Lancer l'open core Pro | Premières ventes |

**Séquence vidéo (les 5 moments magiques, filmables chacun < 60 s)** :
1. « Ta musique, ton show, en 30 secondes »
2. « La foule est là » (3D réactive aux drops)
3. « Le premier concert sans technicien » (flux sans jargon)
4. « La sécurité en un clic » (Freeze/Drop Now — la réponse à la peur n°1)
5. « Ton show se partage » (preset A → B en 2 min)

---

## 6) Licence & juridique (à trancher)

| Sujet | Proposition | Pourquoi |
|---|---|---|
| **Licence du code** | **MIT + marque déposée « Light Maestro »** (ou GPL si on veut forcer l'ouverture des forks) | MIT maximise l'adoption ; la marque protège le nom face aux forks commerciaux. À **décider** (le diagnostic l'a laissé ouvert) |
| **Fixtures OFL** | Attribution **CC-BY-SA** obligatoire (page « crédits fixtures ») | Obligation de licence, pas une option |
| **Sécurité public (R1)** | Avertissements photosensibilité + fréquence strobe plafonnée par défaut + disclaimer | Le plus gros angle mort relevé par la revue adversarial |
| **Transparence** | Statut alpha→beta→1.0 affiché, roadmap publique, « pourquoi c'est gratuit » | Lève la méfiance du gratuit |

---

## 7) Métriques & milestones

| Jalon | Métrique | Signal |
|---|---|---|
| Distribution réelle | **1 000 actifs** (mesurés via auto-update/analytics **opt-in**) | Seuil de lancement open core |
| Traction | Recommandations spontanées sur Reddit/Facebook | Preuve produit/marché |
| Prescription | Premiers `.lmpreset` partagés | Boucle virale amorcée |
| Revenus | Donations d'abord ; **1–3 % de conversion** Pro à 49 € | 10–30 ventes = 500–1 500 € (validation, pas un salaire) |

**Réalité honnête** : l'open core ne paiera pas un salaire avant des années. Le but de la phase actuelle n'est **pas le revenu**, c'est **la preuve que des inconnus utilisent, recommandent et partagent** — c'est ça qui débloque tout le reste.

---

## 8) Décisions à prendre maintenant (court terme)

1. **Geler les features, fiabiliser 3 semaines** (save&quit, USB à chaud, tsc 0, watchdog blackout) — toute diffusion avant ça exporterait des bugs destructeurs de confiance.
2. **Trancher la licence** (MIT + marque, ou GPL) et **déposer la marque** « Light Maestro ».
3. **Valider le split free/paid** (tableau §3) — c'est le contrat produit qu'on tiendra pendant des mois.
4. **Écrire la page « pourquoi c'est gratuit » + roadmap publique** (rédactionnable maintenant, ne dépend d'aucun code).
5. **Planifier le tournage des 5 moments magiques** dès la fin de Phase 1 (le dry-run 30 s ne dépend d'aucun hardware).

---

*Synthèse de première passe à partir du diagnostic stratégique (benchmark 13 concurrents, 37+ sources, roadmap 4 phases). À challenger et enrichir — notamment le split exact des univers (4 vs 8) et le prix de lancement.*
