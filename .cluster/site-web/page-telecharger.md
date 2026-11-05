# Page « Télécharger » — copywriting intégral

> Complément au document `copywriting-site-web.md` (Étape 5 — pages secondaires).
> Stratégie validée : **version portable mise en avant** (pas d'installation,
> lançable depuis une clé USB, sans droits admin — pensé pour les PC de régie).
> L'installeur reste disponible en option secondaire.
> Ton : direct, régie, zéro jargon. Même palette que la landing.

---

## 1. Hero

**Titre**
> Téléchargez. Branchez. Jouez.

**Sous-titre**
> Pas d'installation, pas de compte, pas de carte bancaire. La version portable
> se lance depuis votre PC ou une clé USB — idéale pour les machines de régie
> verrouillées ou sans internet.

**CTA principal**
> [Télécharger la version portable — Windows 64 bits · ~93 Mo]

**Micro-réassurance sous CTA**
> Windows 10 / 11 64 bits · Gratuit (1 fixture) · Mises à jour incluses dans les licences payantes

---

## 2. Carte version (encadré, sous le hero)

> **Light Maestro 1.0.37** — version actuelle
>
> | | |
> |---|---|
> | **Portable (recommandé)** | `Light Maestro 1.0.37.exe` · ~93 Mo · aucune installation |
> | **Installeur (optionnel)** | `Light Maestro Setup 1.0.37.exe` · ~93 Mo · raccourcis + poste fixe |
>
> Vérifiez l'intégrité après téléchargement : comparez la taille (~93 Mo) et,
> si fournie, l'empreinte SHA-256 publiée avec la release.

---

## 3. Premier lancement en 3 étapes

> 1. **Décompressez / copiez** le fichier où vous voulez (Bureau, Documents, clé USB).
> 2. **Double-cliquez** sur `Light Maestro 1.0.37.exe`. Aucun droit administrateur requis.
> 3. **Branchez** votre interface USB-DMX (FTDI / Enttec) ou configurez Art-Net / sACN, puis ouvrez votre projet.
>
> Astuce live : gardez la version précédente à côté de la nouvelle sur votre
> clé USB. En cas de souci pendant la balance, vous relancez l'ancienne en
> quelques secondes.

---

## 4. Encadré SmartScreen — « Windows a protégé votre PC » (OBLIGATOIRE, sans détour)

> **Pourquoi cet avertissement ?**
> Light Maestro est distribué sans certificat d'éditeur payant pour garder la
> version gratuite vraiment gratuite. Windows signale donc l'application comme
> « éditeur inconnu ». C'est normal, et c'est le même avertissement que pour
> des centaines de logiciels indépendants.
>
> **Pour lancer quand même :**
> 1. Sur l'écran bleu « Windows a protégé votre PC », cliquez **« Informations complémentaires »**.
> 2. Cliquez **« Exécuter quand même »**.
> 3. L'avertissement ne réapparaît plus pour ce fichier.
>
> Variante : clic droit sur le `.exe` → Propriétés → cocher **« Débloquer »** → OK.
>
> Nous signerons officiellement l'application dès que les ventes le financent —
> en attendant, chaque installation rapproche cette étape.

---

## 5. Prérequis (liste courte, honnête)

> - Windows 10 ou 11, 64 bits.
> - ~200 Mo d'espace disque (application + projets).
> - Une interface USB-DMX à puce FTDI ou Enttec — **ou** rien du tout pour découvrir (visualisation 3D intégrée, aucun matériel requis pour tester).
> - Aucun droit administrateur nécessaire (version portable).
> - Internet requis uniquement pour : le téléchargement, les mises à jour, la validation de licence payante. **Le live fonctionne hors ligne.**

---

## 6. Sécurité strobes (rappel, 3 lignes — cohérent avec l'avertissement in-app)

> ⚠️ Les effets stroboscopiques peuvent déclencher des crises d'épilepsie
> photosensible. Prévenez toujours le public avant un show avec strobes.
> Light Maestro plafonne le strobe par défaut — ne l'augmentez que si la salle
> s'y prête. Vous restez responsable de l'usage en public.

---

## 7. Mini-FAQ téléchargement

**Mon antivirus bloque le fichier, que faire ?**
> Les exécutables non signés déclenchent parfois des faux positifs. Vérifiez la
> taille du fichier (~93 Mo) et sa provenance (cette page uniquement), puis
> ajoutez une exception. Si le doute persiste, contactez-nous avant d'exécuter.

**Ça marche sur Mac / Linux ?**
> Non — Windows 10/11 64 bits uniquement pour l'instant.

**Je change de PC, je perds ma licence ?**
> Non. Votre licence est liée à votre compte, pas à la machine : reconnectez-vous
> dans Compte & Licence. Vos projets (`.lmproj`) se transfèrent par simple copie.

**Comment se passent les mises à jour ?**
> L'application vérifie les nouvelles versions au démarrage (connexion requise)
> et vous propose l'installation. En portable : téléchargez le nouvel exe,
> gardez l'ancien à côté le temps de valider.

**La version gratuite expire ?**
> Non. 1 fixture, sans limite de temps, sans carte bancaire.

---

## 8. CTA final

**Titre**
> Votre prochain show commence ici.

**CTA**
> [Télécharger la version portable — gratuit]

---

## Notes d'implémentation (pour l'intégrateur, pas à publier)

- Bouton principal = lien direct vers le binaire portable de la release courante ;
  lien secondaire « Installeur Windows » en dessous, en retrait visuel.
- Publier le SHA-256 à côté de chaque binaire (généré au build : `certutil -hashfile`).
- Quand le certificat de signature arrivera : supprimer la section 4, remplacer
  par « Signé Light Maestro — aucun avertissement », et passer l'installeur en avant.
- SEO : title `Télécharger Light Maestro — version portable Windows 64 bits` ;
  meta `Version portable gratuite, sans installation : pilotez vos interfaces
  USB-DMX (FTDI/Enttec) et Art-Net/sACN. Windows 10/11 64 bits.`
