# Remote LAN — architecture, pièges et diagnostic « page web vide »

> Référence pour toute intervention sur `electron/remote/*`, le panneau
> Remote (`src/views/PerformanceView.tsx`) ou le partage de connexion Windows.
> Écrit le 2026-11-17 (commits `417fa47` → `ab0f981`).

## 1. Architecture

```
electron/remote/server.ts      serveur HTTP embarqué (0.0.0.0:8080) + page mobile
electron/remote/diagnostics.ts pare-feu (COM HNetCfg.FwPolicy2), réseau, auto-test
electron/remote/standalone.ts   mode autonome : point d'accès Wi-Fi créé par le PC
electron/remote/interfaces.ts  une URL + un libellé par interface réseau
electron/main.ts               IPC remote:* + collecte des interfaces
```

- **Token persistant** : `userData/remote-token.txt` (32 hex). Ne JAMAIS le
  régénérer à chaque démarrage : les QR déjà scannés sur les téléphones
  deviendraient invalides (401 → « plus rien ne marche »).
- **Snapshot** : le renderer pousse l'état (`remote:state`) vers le cache HTTP.
  Le main **ignore les payloads non-objets** (un `pushState(42)` déclenchait
  `'state' in 42` → TypeError → `app.quit()`).

## 2. « La page web est VIDE » → c'est un problème RÉSEAU, jamais la page

La page HTML est **statique** (header + boutons dans le HTML) : si le JS
plante, elle s'affiche quand même. **Page 100 % blanche = le HTML n'arrive
jamais** → blocage réseau. Causes réelles, dans l'ordre de fréquence :

1. **Windows Firewall « Block »** entrante sur l'exécutable. Windows la crée
   quand l'utilisateur **refuse** l'invite « Autoriser l'application » (il
   croit juste avoir cliqué « non »). Une règle **Block l'emporte sur Allow**.
2. **Réseau différent** : la tablette est sur le réseau de la mixette, le PC
   sur celui du routeur → aucun trafic. → **mode autonome** (§4).
3. **Aucun trafic émis** : le navigateur ne tente même pas la connexion
   (permission Android « accès au réseau local », données mobiles prioritaire).

### Tracer la preuve
- Le serveur journalise : `[remote] <ip> <méthode> <url> → <status> (UA)`.
- Le panneau affiche **« Appareils connectés »** (IP + User-Agent + nb de
  requêtes). Si la liste reste vide après un scan → la requête n'arrive pas.
- `netstat -ano | findstr :8080` : une connexion bloquée par le pare-feu ne
  laisse **aucune trace** (le SYN est droppé) → ne pas conclure à tort.

## 3. Pare-feu Windows — règles de lecture

- Lecture via **COM `HNetCfg.FwPolicy2`** : 706 règles en **0,44 s**.
  Les cmdlets NetSecurity font **1 requête CIM par règle** (→ 2,7 s, > 30 s
  en charge) : **interdits** ici.
- Codes COM : Action 0=NotConfigured 1=Allow 2=Block ; Direction 1=Inbound ;
  Enabled 1=True ; Protocol 0=Any 6=TCP 17=UDP.
- Wi-Fi ⇒ profil réseau **Public** → les règles Domain/Private ne servent à rien.
- Un **build portable** est extrait dans `%TEMP%\xxxx\` **qui change à chaque
  lancement** → les règles Windows s'accumulent (42 regs constatées) → nettoyer.
- La réparation passe par `Start-Process -Verb RunAs` (invite UAC) : si l'UAC
  est refusée, afficher la commande `netsh` manuelle à coller en admin.
- Règle de secours du sous-réseau : `remoteip=localSubnet` (couvre le cas où
  le chemin de l'exe change).

## 4. Mode autonome (le PC devient routeur) — comme une Soundcraft UI16

`netsh wlan show hostednetwork` → « **Réseau hébergé : non** » sur l'Intel
AX211 : le SoftAP legacy est mort. **Mais** le tethering WinRT (Wi-Fi Direct)
fonctionne :

- `NetworkOperatorTetheringManager.CreateFromConnectionProfile(profile)`
- `ConfigureAccessPointAsync(config)` (Ssid + Passphrase) puis
  `StartTetheringAsync()` ; `StopTetheringAsync()` pour arrêter.
- IP fixe du réseau autonome : **192.168.137.1** (sous-réseau ICS Windows).
- Le PC garde son accès Internet en Wi-Fi **et** diffuse en Wi-Fi Direct
  (adaptateur virtuel « Microsoft Wi-Fi Direct Virtual Adapter », affiché
  « Connexion au réseau local* N » en français).

### Pièges WinRT en PowerShell 5.1 (CONSTATÉS, ne pas refaire)
- Les **classes** WinRT se chargent :
  `[Type, Assembly, ContentType=WindowsRuntime] | Out-Null`.
- Les **interfaces** WinRT **ne se chargent PAS** (« type introuvable ») →
  `INetworkOperatorTetheringManager2` (qui porte
  `CurrentAccessPointConfiguration`) est **inaccessible**.
- Conséquence : `CurrentAccessPointConfiguration.Ssid` renvoie **vide** →
  impossible de relire le SSID appliqué, et **impossible de détecter** que la
  configuration a été appliquée. → l'app **retient en mémoire** le SSID et le
  mot de passe qu'elle a configurés (persistés dans
  `userData/remote-hotspot.json`).
- Ce qui marche en PS 5.1 : `TetheringOperationalState`, `ClientCount`,
  `Start/Stop/ConfigureAccessPointAsync` (effet de bord vérifié).
- `AsTask()` / `GetResults()` : **inutilisables** (marshalling `__ComObject`).
  On n'attend pas : on pollonne `TetheringOperationalState` et on lit l'état.
- Paramètres passés par **variables d'environnement** (`LM_HOTSPOT_SSID`…) :
  un SSID/mot de passe avec espace ou apostrophe ne peut pas casser le quoting.

### Vérifier que le SSID est vraiment appliqué
Le scan `netsh wlan show networks` **ne montre pas** le point d'accès
(il est invisible au scan du PC lui-même). Source de vérité :
**journal `Microsoft-Windows-WLAN-AutoConfig/Operational`, événement 8001** :
`Nom de profil : WFD_GROUP_OWNER_PROFILE`, `SSID : Light Maestro`,
`Authentification : WPA2-Personal`, `Chiffrement : AES-CCMP`.

### Tester l'UI Electron sans navigateur
Lancer l'app avec `--remote-debugging-port=9222`, puis piloter le renderer via
le **protocole DevTools** (HTTP `/json` + WebSocket) : `Runtime.evaluate`
pour cliquer un onglet, `Page.captureScreenshot` pour la capture. Indispensable
pour vérifier un panneau (le `PrintWindow` de Windows renvoie du blanc sur
Chromium, et `SetForegroundWindow` échoue si une autre fenêtre est au-dessus).

**Pièges DevTools** :
- si l'utilisateur a ouvert la fenêtre DevTools, `type === 'page'` renvoie
  **la fenêtre DevTools** au lieu de l'app → filtrer sur l'URL
  `dist/renderer/index.html` ;
- la Console Virtuelle est en mode **placement** après « Ajouter Widget » :
  la tuile n'existe qu'après un clic sur le canvas ;
- le layout de la Console Virtuelle n'est **pas persisté** au redémarrage.

## 5. Un QR code par interface réseau

Le PC a souvent **plusieurs IPv4** (Wi-Fi + Ethernet branché sur la mixette).
L'ancien code n'affichait que `urls[0]` → le QR pointait vers le **mauvais
sous-réseau** → page blanche sur la tablette. Règle : **une carte QR par
interface**, avec libellé, et le **réseau autonome prioritaire**
(`standalone` > `wifi` > `ethernet` > `other`). Interfaces virtuelles exclues
(Hyper-V, WSL, Docker, VPN, Teredo, Bluetooth…) et lien-local `169.254.x.x`
exclu (IP APIPA morte).

## 6. Erreurs à ne pas réintroduire

- Une string de la **page mobile** ne doit contenir **aucune apostrophe**
  (template TS : `\'` devient `'` → SyntaxError). Échapper `\\'`.
- Les erreurs HTTP **400/413/503** et les pannes réseau doivent être
  **affichées** (avant : traitées comme des succès → silence).
- `w.color` injecté dans le HTML : validation hex stricte (`safeColor`).
- Toute nouvelle clé i18n → **FR ET EN** (test de parité).

## 7. Tests de référence

- `src/__tests__/remote-diagnostics.test.ts` — pare-feu, réseau, probe, clients.
- `src/__tests__/remote-page-html.test.ts` — garde de la page web mobile.
- `src/__tests__/remote-standalone.test.ts` — mode autonome + interfaces.
- `src/__tests__/remote-commands.test.ts` — flash différé, group-master.
- `src/__tests__/remote-rate-limit.test.ts` — 429 + `Retry-After`.

## 8. Sémantique des commandes (pièges corrigés le 2026-11-17)

- **Relâchement d'une tuile « canal DMX » = LIBÉRER le canal**, pas écrire 0.
  La source VC est en LTP 80 : écrire 0 figeait le canal et la fixture
  restait éteinte. `outputArbiter.releaseChannels(source, univers, canaux[])`
  (une release globale effacerait les faders voisins de la même source).
- **Flash = release différé** : un tap mobile fait press + release dans la
  même frame → la scène est annulée avant le moindre rendu. Maintien =
  `fadeIn + 150 ms` (borné 200..3000), chaser 1000 ms, autre 250 ms.
- **Le marqueur `group-master` vit sur le widget** (`widget.type`), pas dans
  sa config → `applyWidgetSliderEffect` reçoit le `widgetType`.
- **Rate-limit POST + coalescence client vont ensemble** : un tactile 120 Hz
  déclenche > 100 `input`/s sur un `<input type=range>`. La page mobile
  envoie donc **1 POST / 40 ms** (la dernière valeur est toujours envoyée) ;
  le serveur bride à 120 en rafale / 60 par seconde (429 + `Retry-After`).
  Sans la coalescence, le fader saccade et le téléphone affiche une erreur.

