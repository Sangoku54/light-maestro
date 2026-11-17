/**
 * Mode autonome du Remote LAN — le PC crée son PROPRE réseau Wi-Fi.
 *
 * POURQUOI CE MODULE EXISTE
 * -------------------------
 * Au concert, le PC est branché en Ethernet sur la mixette et connecté en
 * Wi-Fi au routeur du lieu. La tablette est sur le réseau de la MIXETTE (un
 * réseau distinct, comme la Soundcraft UI16 qui crée son propre point
 * d'accès) : aucun paquet ne circule entre les deux → la page du Remote
 * reste BLANCHE (le HTML n'arrive jamais) et l'utilisateur croit à un bug.
 *
 * La solution, identique à la UI16 : le PC devient un point d'accès Wi-Fi
 * ("Partage de connexion mobile" de Windows / WinRT
 * `NetworkOperatorTetheringManager`). La tablette se connecte au réseau
 * « Light Maestro » et accède au PC via l'IP fixe du partage de connexion
 * (192.168.137.1 par défaut).
 *
 * FAITS VÉRIFIÉS SUR LE POSTE (Intel AX211, Windows 11)
 * -----------------------------------------------------
 *   - `netsh wlan show hostednetwork` → « Réseau hébergé : non » : le SoftAP
 *     legacy est mort sur cette carte, MAIS le tethering WinRT (Wi-Fi Direct)
 *     fonctionne parfaitement.
 *   - `StartTetheringAsync()` → état `On`, adaptateur virtuel « Microsoft
 *     Wi-Fi Direct Virtual Adapter », IP `192.168.137.1`, et le serveur HTTP
 *     du Remote répond 200 sur cette IP.
 *   - `ConfigureAccessPointAsync(config)` applique bien le SSID et le mot de
 *     passe (vérifié dans le journal « WLAN-AutoConfig/Operational », événement
 *     8001 : `SSID: Light Maestro`, `Authentification: WPA2-Personal`).
 *     ⚠ PowerShell 5.1 ne sait PAS relire `CurrentAccessPointConfiguration`
 *     (projection WinRT incomplète → properties vides) : la lecture de l'état
 *     courant passe donc par `TetheringOperationalState` + `ClientCount`, et le
 *     SSID/mot de passe affichés sont ceux que l'app a configurés.
 */

import { execFile } from 'node:child_process';
import os from 'node:os';

/** État opérationnel du point d'accès Wi-Fi créé par le PC. */
export type RemoteHotspotState = 'On' | 'Off' | 'InTransition' | 'Unknown';

/** Statut du mode autonome renvoyé par les IPC `remote:hotspot*`. */
export interface RemoteHotspotStatus {
  /** L'API Windows de partage de connexion est disponible sur ce poste. */
  supported: boolean;
  /** État opérationnel du point d'accès. */
  state: RemoteHotspotState;
  /** SSID du réseau autonome (celui configuré par l'app), null si inconnu. */
  ssid: string | null;
  /** Mot de passe WPA2 du réseau autonome, null si inconnu. */
  passphrase: string | null;
  /** Nombre d'appareils actuellement connectés au point d'accès. */
  clients: number;
  /** IP du PC sur le réseau autonome (192.168.137.1), null si absent. */
  address: string | null;
  /** Message lisible en cas de problème, null sinon. */
  message: string | null;
}

/** Sous-réseau Windows par défaut pour le partage de connexion (ICS). */
const STANDALONE_SUBNET = /^192\.168\.137\./;

/**
 * Script PowerShell pilotant le point d'accès Wi-Fi (WinRT).
 *
 * Les paramètres passent par des VARIABLES D'ENVIRONNEMENT (et non par la
 * ligne de commande) : un SSID ou un mot de passe contenant un espace, une
 * apostrophe ou un accent ne peut alors pas casser le quoting PowerShell.
 *
 * Sortie : lignes `CLE=VALEUR` (`STATE`, `CLIENTS`, `ERROR`).
 */
export const HOTSPOT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager, Windows.Networking.NetworkOperators, ContentType=WindowsRuntime] | Out-Null
[Windows.Networking.Connectivity.NetworkInformation, Windows.Networking.Connectivity, ContentType=WindowsRuntime] | Out-Null
[Windows.Networking.NetworkOperators.NetworkOperatorTetheringAccessPointConfiguration, Windows.Networking.NetworkOperators, ContentType=WindowsRuntime] | Out-Null

function Get-Manager {
  $profile = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
  if (-not $profile) {
    foreach ($p in [Windows.Networking.Connectivity.NetworkInformation]::GetConnectionProfiles()) {
      if ($p.GetNetworkConnectivityLevel().ToString() -ne 'None') { $profile = $p; break }
    }
  }
  if (-not $profile) { return $null }
  return [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($profile)
}

$m = Get-Manager
if (-not $m) {
  Write-Output 'STATE=Unsupported'
  Write-Output 'ERROR=NO_PROFILE'
  exit 1
}

$action = $env:LM_HOTSPOT_ACTION

if ($action -eq 'stop') {
  $null = $m.StopTetheringAsync()
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if ($m.TetheringOperationalState.ToString() -eq 'Off') { break }
  }
  Write-Output ('STATE=' + $m.TetheringOperationalState.ToString())
  Write-Output ('CLIENTS=' + $m.ClientCount)
  exit 0
}

if ($action -eq 'start') {
  $config = New-Object Windows.Networking.NetworkOperators.NetworkOperatorTetheringAccessPointConfiguration
  $config.Ssid = $env:LM_HOTSPOT_SSID
  $config.Passphrase = $env:LM_HOTSPOT_PASSPHRASE
  # ConfigureAccessPointAsync est asynchrone : on laisse Windows appliquer le
  # SSID/mot de passe avant de démarrer le point d'accès.
  $null = $m.ConfigureAccessPointAsync($config)
  Start-Sleep -Milliseconds 1500
  $null = $m.StartTetheringAsync()
  $state = ''
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    $state = $m.TetheringOperationalState.ToString()
    if ($state -eq 'On') { break }
    if ($state -eq 'Off') { break }
  }
  Write-Output ('STATE=' + $state)
  Write-Output ('CLIENTS=' + $m.ClientCount)
  exit 0
}

Write-Output ('STATE=' + $m.TetheringOperationalState.ToString())
Write-Output ('CLIENTS=' + $m.ClientCount)
`;

/** SSID/mot de passe connus (configurés par l'app) — la projection WinRT ne
 *  permet pas de les relire depuis Windows. */
let knownSsid: string | null = null;
let knownPassphrase: string | null = null;

/** Mémorise le SSID/mot de passe configurés (affichés par l'UI). */
export function setKnownHotspotCredentials(ssid: string | null, passphrase: string | null): void {
  knownSsid = ssid;
  knownPassphrase = passphrase;
}

/** SSID/mot de passe actuellement connus. */
export function getKnownHotspotCredentials(): { ssid: string | null; passphrase: string | null } {
  return { ssid: knownSsid, passphrase: knownPassphrase };
}

/** Résultat brut de l'exécution du script PowerShell. */
interface ScriptResult {
  ok: boolean;
  values: Record<string, string>;
  error: string | null;
}

/** Exécute le script du point d'accès et parse ses lignes `CLE=VALEUR`. */
function runHotspotScript(
  action: 'status' | 'start' | 'stop',
  extraEnv: Record<string, string> = {},
  timeoutMs = 60000,
): Promise<ScriptResult> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', HOTSPOT_SCRIPT],
      {
        env: { ...process.env, LM_HOTSPOT_ACTION: action, ...extraEnv },
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
      (err, stdout, stderr) => {
        const values: Record<string, string> = {};
        for (const line of String(stdout ?? '').split(/\r?\n/)) {
          const idx = line.indexOf('=');
          if (idx <= 0) continue;
          values[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
        const errorText = String(stderr ?? '').trim();
        if (err) {
          resolve({
            ok: false,
            values,
            error: errorText || err.message,
          });
          return;
        }
        resolve({ ok: true, values, error: null });
      },
    );
  });
}

/** IP du PC sur le réseau autonome (sous-réseau ICS 192.168.137.0/24). */
export function findStandaloneAddress(): string | null {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (STANDALONE_SUBNET.test(iface.address)) return iface.address;
    }
  }
  return null;
}

/** Convertit l'état WinRT en état typé. */
function parseState(raw: string | undefined): RemoteHotspotState {
  switch ((raw ?? '').toLowerCase()) {
    case 'on': return 'On';
    case 'off': return 'Off';
    case 'intransition': return 'InTransition';
    default: return 'Unknown';
  }
}

/** Construit un statut à partir du résultat brut du script. */
function toStatus(result: ScriptResult, message: string | null): RemoteHotspotStatus {
  const state = parseState(result.values.STATE);
  const supported = state !== 'Unknown' && result.values.STATE !== 'Unsupported';
  return {
    supported,
    state,
    ssid: knownSsid,
    passphrase: knownPassphrase,
    clients: Number.parseInt(result.values.CLIENTS ?? '0', 10) || 0,
    address: findStandaloneAddress(),
    message,
  };
}

/** Statut du point d'accès autonome. */
export async function getHotspotStatus(): Promise<RemoteHotspotStatus> {
  if (process.platform !== 'win32') {
    return {
      supported: false,
      state: 'Unknown',
      ssid: knownSsid,
      passphrase: knownPassphrase,
      clients: 0,
      address: null,
      message: 'Le mode autonome est disponible uniquement sur Windows.',
    };
  }
  const result = await runHotspotScript('status', {}, 20000);
  if (!result.ok && !result.values.STATE) {
    return toStatus(result, `Point d'accès indisponible : ${result.error ?? 'erreur inconnue'}`);
  }
  return toStatus(result, result.values.ERROR === 'NO_PROFILE'
    ? 'Aucun profil réseau actif : le PC doit être connecté à Internet (Wi-Fi ou Ethernet) pour créer son point d\'accès.'
    : null);
}

/**
 * Démarre le point d'accès autonome avec le SSID et le mot de passe fournis.
 * Le SSID est limited à 32 caractères, le mot de passe WPA2 à 8..63.
 */
export async function startHotspot(ssid: string, passphrase: string): Promise<RemoteHotspotStatus> {
  if (process.platform !== 'win32') {
    return getHotspotStatus();
  }
  const cleanSsid = ssid.trim().slice(0, 32) || 'Light Maestro';
  const cleanPass = passphrase.trim().slice(0, 63);
  if (cleanPass.length < 8) {
    const status = await getHotspotStatus();
    return { ...status, message: 'Le mot de passe du réseau autonome doit faire au moins 8 caractères.' };
  }
  setKnownHotspotCredentials(cleanSsid, cleanPass);
  const result = await runHotspotScript('start', {
    LM_HOTSPOT_SSID: cleanSsid,
    LM_HOTSPOT_PASSPHRASE: cleanPass,
  }, 60000);
  if (!result.ok) {
    return toStatus(result, `Démarrage du point d'accès impossible : ${result.error ?? 'erreur inconnue'}`);
  }
  const status = toStatus(result, null);
  if (status.state !== 'On') {
    return { ...status, message: "Windows n'a pas pu démarrer le point d'accès Wi-Fi sur ce poste." };
  }
  return status;
}

/** Arrête le point d'accès autonome. */
export async function stopHotspot(): Promise<RemoteHotspotStatus> {
  if (process.platform !== 'win32') {
    return getHotspotStatus();
  }
  const result = await runHotspotScript('stop', {}, 30000);
  if (!result.ok) {
    return toStatus(result, `Arrêt du point d'accès impossible : ${result.error ?? 'erreur inconnue'}`);
  }
  return toStatus(result, null);
}
