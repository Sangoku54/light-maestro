# Runbook — Release Windows + auto-update LWS

**Dernière release : 1.0.45 (2026-11-20).** Ce document encode les pièges
rencontrés sur cette release. À relire AVANT chaque build de release.

---

## 0. Ne jamais donner d'instructions d'upload "au large"

**Piège rencontré (1.0.45) :** j'ai dit "copie tout le dossier `site/`" alors
que seuls 2 fichiers avaient changé depuis le dernier upload. L'utilisateur a
uploadé ~10 Mo et des dizaines de fichiers pour rien.

**Règle :** avant de lister quoi uploader, **mesurer** :

```powershell
git diff --stat <commit-du-dernier-upload> HEAD -- site/
```

Le résultat EST la liste d'upload. Ne jamais élargir à la main.

De même pour `release/` : lister **exactement** les fichiers dont le nom ou le
contenu a changé, et dire explicitement lesquels **supprimer** sur le serveur.

---

## 1. Configuration auto-update (package.json → `build`)

### Provider generic en PREMIER

```jsonc
"publish": [
  { "provider": "generic", "url": "https://light-maestro.com/download/", "channel": "latest" },
  { "provider": "github", "releaseType": "release" }
]
```

**Pourquoi l'ordre est critique :** `getAppUpdatePublishConfiguration()`
(app-builder-lib) prend `publishConfigs[0]` pour écrire
`release/win-unpacked/resources/app-update.yml`. Si `github` est en 1ᵉʳ,
l'exe embarqué pointe sur GitHub → l'app ne cherche **jamais** les MAJ sur LWS.

Conséquence : avec 2 providers, electron-builder écrit aussi
`release/<provider>/latest.yml` pour le 2ᵉ provider. **Seul le `latest.yml` à
la racine correspond au 1ᵉʳ provider (= generic = LWS).**

### Noms d'artefacts SANS espaces

```jsonc
"nsis":     { "artifactName": "Light-Maestro-Setup-${version}.${ext}" },
"portable": { "artifactName": "Light-Maestro-${version}.${ext}" }
```

**Pourquoi :** `computeSafeArtifactNameIfNeeded()` remplace les espaces par des
tirets pour GitHub. `latest.yml` se met alors à référencer un nom de fichier
qui **n'existe pas sur le disque** → l'auto-update télécharge en 404.

Avec des noms sans espaces, `safeArtifactName` = nom réel → `latest.yml`
référence toujours le fichier réellement produit.

---

## 1 bis. Auto-update : le canal d'une version DÉJÀ INSTALLÉE est figé dans son binaire

**Piège majeur (1.0.45) :** l'utilisateur était en **1.0.44** et l'app ne lui a
proposé aucune mise à jour. Diagnostic :

1. `app-update.yml` est écrit **au moment du build** dans l'exe. La 1.0.44 a
   été compilée quand `build.publish` ne contenait **que** `github` → son canal
   est GitHub, **pour toujours**. Elle ne regardera jamais LWS.
2. Or aucune **release** GitHub `v1.0.45` n'existait (seulement `v1.0.43` et
   `v1.0.44`) : l'updater lit `/releases/latest` → `v1.0.44` → « à jour ».
3. Et LWS était **vide** : `/download/latest.yml` et `/download/*.exe` en 404
   (les boutons de téléchargement du site étaient donc cassés aussi).

### Règles

- **Chaque release doit être publiée sur GitHub ET déposée sur LWS.**
  - GitHub = le canal que connaissent les versions déjà installées (1.0.43,
    1.0.44) et le repli automatique des versions ≥ 1.0.46.
  - LWS = le canal principal des versions ≥ 1.0.45 (provider `generic`).
- Le repli GitHub automatique est dans `electron/main.ts`
  (`fallbackToGithubFeed`) : si le canal principal échoue (404 / LWS down /
  manifest absent), l'app bascule sur la release GitHub **sans attendre**.
- La release GitHub doit contenir **exactement** :
  `latest.yml` (celui de la RACINE de `release/`), `Light-Maestro-Setup-<v>.exe`,
  `Light-Maestro-Setup-<v>.exe.blockmap`, `Light-Maestro-<v>.exe` (portable).
  Le `latest.yml` doit pointer vers le setup (`path:` / `files[].url`).

### Piège : le dépôt a été RENOMMÉ (`light-maestro` → `1.0.45`)

- L'ancien nom **redirige** (téléchargements, atom feed, API GET) → les
  anciennes versions installées continuent de fonctionner.
- Mais **écrire** via l'API sur l'ancien nom échoue : le POST reçoit un **301**
  et **PowerShell 5.1 transforme le POST en GET** → il renvoie l'objet *dépôt*
  au lieu de créer la release (échec SILENCIEUX : `tag_name` vide).
  → Toujours résoudre `full_name` (`GET /repos/Sangoku54/light-maestro` →
  `full_name`) et écrire dessus.
- Et l'URL doit contenir `/releases` : un POST sur `/repos/<owner>/<repo>`
  ne crée rien.

### Piège : `target_commitish` invalide

Un SHA court (`161f527`) est refusé par GitHub (422 `invalid`). Si le tag
existe déjà (poussé sur `origin`), **ne pas envoyer** `target_commitish`.

### Vérifier ce que voit vraiment l'app installée

```powershell
# 1. le dernier tag publie (ce que lit electron-updater)
Invoke-RestMethod "https://api.github.com/repos/Sangoku54/light-maestro/releases/latest" -Headers @{ 'User-Agent'='x' } | Select-Object tag_name
# 2. le manifest telecharge par l'app, via l'ancien nom (redirection)
Invoke-WebRequest "https://github.com/Sangoku54/light-maestro/releases/download/v1.0.45/latest.yml" -UseBasicParsing | Select-Object StatusCode
# 3. le binaire telechargeable (taille == latest.yml `size:`)
Invoke-WebRequest "https://github.com/Sangoku54/light-maestro/releases/download/v1.0.45/Light-Maestro-Setup-1.0.45.exe" -Method Head -UseBasicParsing | Select-Object Headers
```

---

Ne pas livrer un build sans ces 3 vérifications.

### a) `app-update.yml` embarqué pointe sur LWS

```powershell
Get-Content "release\win-unpacked\resources\app-update.yml"
```
→ attendu : `provider: generic` + `url: https://light-maestro.com/download/`

### b) `latest.yml` référence un fichier qui EXISTE

```powershell
node -e "const y=require('js-yaml'),f=require('fs');const i=y.load(f.readFileSync('release/latest.yml','utf8'));const b='https://light-maestro.com/download/';console.log('url:',new URL(i.files[0].url,b).href);console.log('setup existe:',f.existsSync('release/'+i.files[0].url));console.log('blockmap existe:',f.existsSync('release/'+i.files[0].url+'.blockmap'))"
```
→ attendu : les 2 `existe: true`, et l'URL qui correspond au nom sur disque.

### c) Pas de sous-dossier provider parasite

```powershell
Get-ChildItem "release" -Recurse -Filter "*.yml" | Select-Object FullName
```
→ si `release/generic/` ou `release/github/` apparaît, c'est que l'ordre des
providers a changé → `latest.yml` à la racine n'est plus le bon.

---

## 3. Placeholders interdits

**Piège (1.0.45) :** `https://ton-domaine.lws.to/download/` est resté dans
`package.json` pendant 2 builds. L'app aurait cherché les MAJ sur un domaine
inexistant → erreur 404 silencieuse.

Avant chaque build :

```powershell
Select-String -Path package.json,electron\**\*.ts,release\win-unpacked\resources\app-update.yml -Pattern "ton-domaine|example\.com|PLACEHOLDER"
```

Le domaine réel est **https://light-maestro.com/** (le site vitrine et l'API
license utilisent déjà ce domaine).

---

## 4. Cohérence site ↔ release

Le site (`site/telecharger*.html`) doit pointer sur les **mêmes noms de
fichiers** que ceux produits par le build, et afficher le **SHA256 réel** :

```powershell
(Get-FileHash "release\Light-Maestro-Setup-1.0.45.exe" -Algorithm SHA256).Hash
```

Les noms sont construits en JS : `FILE_PORTABLE` / `FILE_SETUP` dans
`site/telecharger.html` et `site/telecharger-en.html`.

---

## 5. Inverser les tooltips i18n = se tromper

**Piège (1.0.45) :** j'ai changé `mountGroundTipText` de « vers le haut » vers
« vers le bas » sur la foi d'une note antérieure, sans vérifier le moteur.
Faux : `clampTiltZone()` impose `ground → élévation [0°, +90°]`, donc une
fixture au sol ne descend **jamais** sous l'horizon → le faisceau part vers le
haut. Le texte d'origine était correct, ma correction l'avait cassé.

**Règle :** tout changement de texte décrivant un comportement doit être
validé contre le **code du moteur**, pas contre une note ou un souvenir.
Chercher la fonction qui implémente le comportement, et lire ses tests.

---

## 6. Checklist finale

- [ ] `npm run check` → tsc (3×) + vitest verts
- [ ] `npm run dist` → NSIS + portable + blockmap
- [ ] Vérif 2a (app-update.yml = generic/LWS)
- [ ] Vérif 2b (latest.yml → fichier + blockmap existants)
- [ ] Vérif 2c (pas de sous-dossier provider)
- [ ] Vérif 3 (zéro placeholder)
- [ ] **Release GitHub publiée** (tag + latest.yml + setup exe + blockmap + portable) → sans quoi les versions déjà installées ne voient JAMAIS la nouvelle version
- [ ] **Upload LWS** (`/download/`) mesuré via `git diff --stat` → sans quoi le canal principal est en 404 et les boutons du site sont cassés
- [ ] `git diff --stat <dernier-upload> HEAD -- site/` → liste d'upload exacte
- [ ] SHA256 du site = SHA256 réel du fichier
- [ ] Lister les fichiers à **supprimer** sur le serveur (obsolètes)
- [ ] Commit + push

## 7. Tests visuels à faire par l'utilisateur (je ne peux pas lancer Electron)

- [ ] Shift+clic dans la liste Fixtures → multi-sélection (ne remplace pas)
- [ ] Preset « High 4m » → hauteur 4 m (pas 5)
- [ ] Badge de groupe sur les tracks EFX / CLR / STR / DIM (timeline)
- [ ] Cible manuelle (Target) : la fixture ne dérive plus après le clic
