# Diagnostic — « l'installateur ne fonctionne pas » (SAC) + correctifs

**Date** : 2026-08-18 · **Commits** : `0855f8a` (correctifs), `8cad6f7`/`fb6ef1c` (packaging).

## Cause racine (confirmée)

L'installeur **n'est pas bugué** : il est **bloqué par Windows** — **Smart App Control (SAC)**.

Preuves :
1. Registre : `HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy` → `VerifiedAndReputablePolicyState = 1` (SAC en mode **Appliquer/Enforce**).
2. Journal `Microsoft-Windows-CodeIntegrity/Operational` → politique `VerifiedAndReputableDesktop` active (c'est la politique SAC).
3. Erreur au lancement : `Une stratégie de contrôle d'application a bloqué ce fichier`.
4. `Get-AuthenticodeSignature` → les 3 exe (`win-unpacked\Light Maestro.exe`, `Setup`, `portable`) sont **NotSigned**.

SAC bloque les exécutables **non signés** (et les auto-signés sans réputation). Aucun « package manquant » n'est en cause : l'app packagée **démarre** (fixtures chargées, modules natifs OK, aucune dépendance VC++ — vérifié via `dumpbin`).

## Ce qui a été corrigé (vrais bugs, sans rapport avec SAC)

1. **DevTools auto-ouvert en prod** → désactivé, réservé au mode dev (`electron/main.ts`).
2. **autoUpdater qui 404** (`github.com/vitte/light-maestro/releases.atom`, aucun release) → `setupAutoUpdater` ne s'active que si `app-update.yml` existe ; config `publish` retirée de `package.json` (pas de canal de mise à jour réel).
3. Résultat : `stderr` **propre** (0 ligne) au lancement packagé, plus de bruit DevTools/update.

## La vraie solution pour distribuer via un site web : la signature de code

SAC ne laisse passer que les binaires signés par un **certificat de confiance** (EV, ou OV avec réputation). Options :

| Option | Coût | Délai | Passe SAC |
|---|---|---|---|
| Certificat **OV** (ex. Sectigo/SSL.com) | ~100–200 €/an | 1–3 j (validation entreprise/identité) | ✅ (réputation croissante) |
| Certificat **EV** | ~250–500 €/an | 1–5 j | ✅ immédiat |
| **Azure Trusted Signing** (Microsoft) | ~10 €/mois (basic) | validation identité requise | ✅ |
| **SignPath Foundation** | gratuit (open-source) | intégration build | ✅ |

**Intégration electron-builder** (une fois le certificat obtenu, rien à coder) :
```powershell
# .pfx :
$env:CSC_LINK = "C:\certs\lightmaestro.pfx"
$env:CSC_KEY_PASSWORD = "motdepasse"
npx electron-builder --publish never
```
(ou `win.certificateFile` + `win.certificatePassword` dans `package.json` ; ou `win.azureSignOptions` pour Azure Trusted Signing.)

## Solution immédiate (sans certificat)

- L'installeur **fonctionne sur les machines sans SAC** (Windows 10, Windows 11 avec SAC désactivé — la majorité des postes).
- Sur **cette machine** : Windows Sécurité → Contrôle des applications et du navigateur → Paramètres Smart App Control → **Désactiver**.
  ⚠️ SAC est un interrupteur à sens unique : une fois désactivé, il ne se réactive **pas** sans réinstaller Windows.

## Vérifications

- `tsc` exit 0, `vite build` OK, `electron-builder` exit 0 (NSIS + portable).
- Lancement packagé : process vivant, `[autoUpdater] No update channel — disabled`, `stderr` vide.
- `app-update.yml` absent (plus de 404).
