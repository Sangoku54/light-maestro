# Subagent 05 — Sémiotique adverse v4 (3 tailles)

**Date :** 2026-08-17
**Rôle :** avocat du diable. Teste la robustesse du message « lumière » du logo Light Maestro **v4** à 1024 / 28px / 16px.
**Méthode :** 4 passes vision AutoGLM (upload-mix + image-recognition) sur `icon-full-1024.png`, `icon-512.png` (≈28px), `favicon-16.png` (16px), dont 1 passe « critique adverse » par taille + 1 passe « neutre ciblée » à 1024 pour trianguler.
**Baseline v3 :** 3,5/10 — cœur (40 % à 1024) = « app de rencontre », diaphragme (60 % à 28px) = « app photo », faisceau trop discret.

---

## 0. Correctifs v4 testés (rappel)

| v3 (défaut) | Correctif v4 |
|---|---|
| Cœur central → « app de rencontre » | → sunburst blanc 8 rayons (source lumineuse canonique) |
| Faisceau cône 0.28 trop discret | → trait de faisceau blanc **opaque** ajouté |
| Liserés durs = « lames d'obturateur » | → liserés **retirés** |
| Baguette mate | → baguette plus lumineuse |

---

## 1. Réponses aux 4 questions à trancher

### Q1 — « App de rencontre » a-t-il disparu (cœur supprimé) ? → **OUI ✅**

C'est la **victoire nette** de la v4. Les 4 passes convergent :

- **Passe neutre ciblée (1024)** : « *Heart shape? No. No cleft top, pointed bottom, or bilateral symmetry.* » « *Dating app? No. Cool violet tones, mechanical/optical imagery signal photography/AI, not romance.* » Cœur classé **Weak/Negligible** (5ᵉ et dernière lecture).
- **Passe adverse (1024)** : le cœur n'apparaît plus que sous forme forcée (« *cœur mécanique* si l'on force l'œil ») et la lecture « dating » ne tient plus que par « *violet romantique + spark central* » — plus aucune forme cœur réelle.
- **Passe adverse (28px)** : « *Heart / Dating App : NON-EXISTENT. There is no heart shape here.* »

Le « cœur » de la v3 est **mort**. La lecture « app de rencontre » ne subsiste qu'à l'état de trace très faible (association violet → intimité), sans support formel. C'est le seul correctif qui a pleinement fonctionné.

### Q2 — « App photo/diaphragme » a-t-il régressé (liserés retirés) ? → **NON ❌ (inchangé, toujours dominant)**

Le retrait des liserés durs **n'a rien changé**. La lecture « diaphragme/objectif » reste **la lecture n°1, à 1024 comme à 28px** :

- **Passe neutre (1024)** : « *Camera Diaphragm/Lens: Yes, strongly. This is the dominant reading. Iris diaphragm: overlapping curved blades arranged radially.* » — classé **n°1 « Very Strong »**, au-dessus de « Light » (n°2 « Strong »).
- **Passe adverse (1024)** : « *Les formes violettes sont sans ambiguïté les lames d'un diaphragme d'objectif. C'est la lecture dominante, inévitable.* »
- **Passe adverse (28px)** : « *Camera Diaphragm / Aperture : STRONG. The curved blade silhouettes are iconic enough. This is your only robust signal.* »

**Diagnostic sémiotique (cause racine)** : ce n'est **pas** le liseré qui signe « obturateur », c'est la **géométrie iris** : 3 lames courbes en rotation radiale autour d'un axe central, se chevauchant en cercle fermé. Retirer les liserés = retirer la bordure d'une lame, pas la lame. La grammaire « diaphragme » est structurelle (c'est l'exacte anatomie d'un iris d'objectif), pas cosmétique. → **Le correctif « liserés retirés » a visé le mauvais levier.**

### Q3 — Le faisceau (cône + trait central) porte-t-il « lumière » à 1024 et 28px ? → **OUI à 1024, NON à 28px ⚠️**

- **À 1024 :** le couple sunburst + trait blanc opaque **fonctionne**. Passe neutre : « *Light source: white sunburst/spark at center (8 radiating lines). Beam: a solid white ray projecting toward upper-right — a literal beam of light.* » « Light » classé **n°2 « Strong »**, juste derrière le diaphragme. Le trait blanc est lu comme **faisceau**, plus comme rayure. → le faisceau **porte enfin** à taille réelle.
- **À 28px :** le faisceau **s'effondre**. Passe adverse : « *The beam: a random white scratch / a clock hand / a gauge needle / a rendering glitch. It does NOT scream 'faisceau lumineux', it screams 'design element'.* » Le sunburst (8 rayons) **meurt** en « *blurry gray-white pixel cluster* / dirt on the lens ». À 1px, le trait ne guide plus vers « lumière », il guide vers « erreur/cheveu ».

**Verdict Q3** : le faisceau est **réparé à 1024, toujours cassé en dessous de ~40px**. Le correctif « trait opaque » est un gain réel mais ne survit pas à la réduction.

### Q4 — Robustesse « lumière » : **faible à moyenne**. Meilleure que la v3 ? → **Oui, mais insuffisant**

La v4 a **gagné un étage** : la lumière est désormais **lisible et crédible à 1024** (sunburst + faisceau + baguette), et le cœur parasite a disparu. Mais :
1. La lecture **dominante** à toute taille reste « diaphragme/app photo », pas « lumière ».
2. La « lumière » **ne survit pas aux petites tailles** (28px et 16px), là où un logo d'app est justement le plus souvent vu.

---

## 2. Contre-lectures restantes (par risque)

| Risque | Contre-lecture | Taille(s) où elle domine | Sévérité |
|---|---|---|---|
| 🔴 **CRITIQUE** | **Diaphragme / objectif d'appareil photo** | 1024 **et** 28px (lecture n°1 partout) | Tue « lumière » : le réflexe « app photo » précède toujours « console lumière » |
| 🟠 Moyen | **Fleur / botanique** (pétales + pistil central) | 1024 (n°3 « Moderate ») | Banalise vers « fleuriste orchidée violette » |
| 🟠 Moyen | **Hélice / ventilateur / turbine** (symétrie rotationnelle) | 1024 | Lecture « industrie/aéro » parasite |
| 🟡 Faible | **Étoile/clip-art sparkle** au lieu d'étincelle (le sunburst manque d'irrégularité/explosion) | 1024 | Dégonfle le « source lumineuse » en « emoji scintillement » |
| 🟡 Faible | **Audio/waveform, spinner, pinwheel** | 1024 | Bruit de fond |
| 🟢 Résiduel | **« App de rencontre » (violet romantique)** | 1024 uniquement, sans forme cœur | Réduit à une nuance de couleur, négligeable |
| ⚪ 28px | **« Rayure / cheveu / aiguille d'horloge »** pour le trait blanc | 28px | Le faisceau ne porte plus |
| ⚪ 16px | **« J » / virgule / tache violette avec lens flare** (ni têtard franc, ni cœur) | 16px | Aucune lecture fiable |

---

## 3. Notes par taille

| Taille | Note | Lecture dominante | Lecture « lumière » | Verbatim clé |
|---|---|---|---|---|
| **1024** | **5,5/10** | Diaphragme (n°1) | Lisible et crédible (n°2, « literal beam of light ») | « *Anchored in optics/aperture + light* » — la lumière est là, mais seconde |
| **28px** | **3/10** | Diaphragme (« app photo ») | **Perdue** (trait = rayure, sunburst = pixel cluster) | « *Purple camera shutter with a weird white hair on it* » |
| **16px** | **2/10** | Aucune (blob abstrait) | **Perdue** | « *A purple comma / paint splatter with a lens flare* » — pur marqueur de couleur |

## Verdict global : **4,5/10** (v3 : 3,5/10)

**Le logo dit-il « lumière » ?** — **Partiellement.** À 1024, oui (sunburst + faisceau + baguette = source lumineuse canonique). Aux tailles d'app (28px, 16px), non : il redevient « app photo » puis « tache violette ».

**Robustesse « lumière » : faible** (tient sur 1 taille sur 3, jamais en lecture dominante).

**Progrès vs v3 : réel mais incomplet.** +1 pt net : cœur tué (✅), lumière crédible à 1024 (✅). Mais le diaphragme reste LE signal n°1 (❌), et la petite taille reste illisible (❌). On a déplacé le problème, pas réglé la cause.

---

## 4. Recommandations résiduelles (critiques)

1. **🔴 Tuer la grammaire « diaphragme » à la racine — c'est LE chantier.** Le réflexe « objectif photo » vient des **3 lames courbes en rotation radiale chevauchées autour d'un axe central** (anatomie exacte d'un iris). Retirer les liserés n'a servi à rien car la lame, pas sa bordure, est le signifiant. Deux pistes, par ordre de faisabilité :
   - **(a) Désymétriser / dé-spiraliser** : redresser les 3 éléments violets en **rayons effilés qui émanent du sunburst** (faisceaux lumineux en éventail, non chevauchés en cercle fermé), au lieu de lames spiralées. C'est le même nombre de formes, mais on passe d'« iris » à « émanation ».
   - **(b) Si les lames sont conservées** (elles portent le « moving-head/iris gobo » cher aux pros AV) : casser la fermeture circulaire — faire déborder au moins une lame hors du disque, ou laisser un vide angulaire net — pour que l'œil ne puisse plus boucler en « diaphragme ».
2. **🟠 Rendre le faisceau volumétrique et l'ancrer** : le trait blanc 1px est lu « faisceau » à 1024 mais « rayure » dès qu'on réduit. Lui donner **épaisseur minimale (2–3px), dégradé de chute (falloff) et un ancrage net** (partir DU sunburst, dépasser le bord du disque). Le faisceau doit se lire seul à 28px.
3. **🟠 Simplifier le sunburst pour la survie en petit** : 8 rayons = « pixel cluster » à 28px. Préférer **un noyau blanc plein + 4 rayons larges** (ou un seul glint fort) qui restent lisibles réduits, plutôt qu'un éventail fin qui se brouille.
4. **⚪ Livrer un glyphe 16px dédié** (pas un downscale) : soleil/étoile blanche épaisse sur disque violet + faisceau épais — pour que le favicon ne soit plus une « virgule violette ».
