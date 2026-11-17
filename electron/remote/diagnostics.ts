/**
 * Diagnostic réseau du Remote LAN — pare-feu Windows, réseau Wi-Fi, auto-test.
 *
 * POURQUOI CE MODULE EXISTE
 * -------------------------
 * Le symptôme « le scan du QR code ouvre une page web VIDE » n'est pas un bug
 * de la page HTML : le HTML est statique (header + boutons) et s'affiche même
 * si le JavaScript plante. Une page 100 % blanche signifie donc que le HTML
 * n'ARRIVE PAS → blocage réseau. Deux causes réelles, vérifiées sur le poste :
 *
 *   1. Windows Firewall bloque l'exécutable. Windows crée une règle "Block"
 *      (nom du type « light maestro.exe », profil Public, TCP+UDP, Any) quand
 *      l'utilisateur refuse l'invite « Autoriser l'application ». Les règles
 *      "Block" l'emportent sur les règles "Allow" → le téléphone se connecte
 *      au PC et obtient une page vide/erreur. Constaté : règle Block active
 *      sur `release\win-unpacked\light maestro.exe`.
 *   2. Le téléphone n'est pas sur le même réseau que le PC (ou le réseau a
 *      l'isolation client activée) → rien n'arrive non plus.
 *
 * CE QUE FAIT CE MODULE
 * ---------------------
 *   - `getFirewallStatus()` : LIT les règles entrantes qui concernent
 *     l'exécutable RÉELLEMENT filtré par le pare-feu (`process.execPath`).
 *     Attention : pour le build portable, l'exe est extrait dans un dossier
 *     `%TEMP%\xxxx\` qui CHANGE à chaque lancement → les règles Windows
 *     "orphelines" s'accumulent (42regs constatées sur le poste).
 *   - `ensureFirewallRule()` : RÉPARE — supprime les règles "Block" et
 *     garantit une règle "Allow" entrante TCP sur le port du serveur. L'app
 *     n'a pas besoin d'être élevée : la commande passe par
 *     `Start-Process -Verb RunAs` → invite UAC (l'utilisateur clique Oui).
 *   - `getNetworkInfo()` : donne le SSID du Wi-Fi du PC + ses IP locales pour
 *     que l'utilisateur compare avec le réseau de son téléphone.
 *   - `probeLan()` : auto-test depuis le PC (sans CORS) : prouve que le
 *     serveur répond bien sur l'IP affichée dans le QR code.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

/** Règle entrante du pare-feu Windows concernant l'exécutable de l'app. */
export interface RemoteFirewallRule {
  /** Identifiant interne de la règle (GUID). */
  name: string;
  /** Nom affiché de la règle. */
  displayName: string;
  /** 'Allow' | 'Block'. */
  action: string;
  /** Profils concernés ('Any', 'Public'…). */
  profile: string;
  enabled: boolean;
  /** 'TCP' | 'UDP' | 'Any'. */
  protocol: string;
  /** Port local ('8080', 'Any'…). */
  localPort: string;
  /** Chemin du programme filtré. */
  program: string;
}

/** État du pare-feu vis-à-vis de l'exécutable de l'app. */
export interface RemoteFirewallStatus {
  /** Plateforme hôte. */
  platform: NodeJS.Platform;
  /** Exécutable réellement filtré (`process.execPath`). */
  program: string;
  /** Une règle "Block" entrante concerne le programme → le téléphone est coupé. */
  blocked: boolean;
  /** Une règle "Allow" entrante TCP couvre le programme ET le port. */
  allowed: boolean;
  /** Toutes les règles entrantes trouvées pour ce programme. */
  rules: RemoteFirewallRule[];
  /** L'exécutable tourne depuis un dossier temporaire (build portable). */
  portable: boolean;
  /** Message lisible (FR) si un blocage est détecté, sinon null. */
  message: string | null;
}

/** Informations réseau du PC (pour comparer avec le téléphone). */
export interface RemoteNetworkInfo {
  /** SSID du Wi-Fi (null si Ethernet / Wi-Fi éteint / réseau masqué). */
  ssid: string | null;
  /** Nom de l'interface réseau principale. */
  interfaceName: string | null;
  /** Adresses IPv4 locales (hors loopback / lien-local). */
  ipv4: string[];
  /** Nom de la machine. */
  hostname: string;
}

/** Résultat de l'auto-test HTTP sur l'IP affichée dans le QR code. */
export interface RemoteLanProbe {
  /** URL testée (null si aucune URL disponible). */
  url: string | null;
  /** Le serveur a bien répondu. */
  ok: boolean;
  /** Code HTTP reçu (null si aucune réponse). */
  status: number | null;
  /** Latence aller-retour en ms. */
  latencyMs: number | null;
  /** Message d'erreur réseau (le cas échéant). */
  error: string | null;
}

/** Diagnostic complet renvoyé par l'IPC `remote:diagnostics`. */
export interface RemoteDiagnostics {
  firewall: RemoteFirewallStatus;
  network: RemoteNetworkInfo;
  probe: RemoteLanProbe;
}

/** Résultat de la tentative de réparation du pare-feu. */
export interface RemoteFirewallFix {
  ok: boolean;
  message: string;
  status: RemoteFirewallStatus;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Exécute un script PowerShell et renvoie stdout (vide en cas d'échec). */
function runPowerShell(
  script: string,
  env?: Record<string, string>,
  timeoutMs = 10000,
): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        env: env ? { ...process.env, ...env } : process.env,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
      (err, stdout) => resolve(err ? '' : String(stdout)),
    );
  });
}

/** Échappe une valeur pour un littéral PowerShell entre apostrophes. */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Normalise un chemin pour comparer deux programmes (casse + séparateurs). */
function normalizeProgram(value: string): string {
  return value.trim().toLowerCase().replace(/\//g, '\\');
}

/** Un port donné couvre-t-il le port attendu ? ('Any' couvre tout). */
function portCovers(localPort: string, port: number): boolean {
  const p = localPort.trim().toLowerCase();
  if (p === '' || p === 'any') return true;
  return p.split(',').some((part) => part.trim() === String(port));
}

/** Le protocole de la règle couvre-t-il TCP ? */
function protocolCoversTcp(protocol: string): boolean {
  const p = protocol.trim().toLowerCase();
  return p === '' || p === 'any' || p === 'tcp' || p === '6';
}

/** L'exécutable tourne-t-il depuis un dossier temporaire (build portable) ? */
function isPortablePath(program: string): boolean {
  return /\\temp\\[^\\]+\\[^\\]+\.exe$/i.test(program);
}

// ─── Lecture du pare-feu ──────────────────────────────────────────────────

/**
 * Script PowerShell : liste les règles ENTRANTES dont le programme
 * correspond à l'exécutable de l'app (ou à « Any », qui s'applique à tout).
 *
 * On utilise l'API COM `HNetCfg.FwPolicy2` et NON les cmdlets NetSecurity :
 * `Get-NetFirewallRule | Get-NetFirewallApplicationFilter` fait 1 requête CIM
 * PAR RÈGLE (706 requêtes → 2,7 s sur le poste, et jusqu'à 30 s quand la
 * machine est chargée). Le COM lit les 706 règles en 0,44 s.
 *
 * Codes COM : Action 0=NotConfigured 1=Allow 2=Block ; Direction 1=Inbound ;
 * Enabled 1=True ; Protocol 0=Any 6=TCP 17=UDP.
 */
const READ_RULES_SCRIPT = `
$prog = $env:LM_FW_PROGRAM
$fw = New-Object -ComObject HNetCfg.FwPolicy2
$out = @()
foreach ($r in $fw.Rules) {
  if ([int]$r.Direction -ne 1) { continue }
  $p = [string]$r.ApplicationName
  if (-not $p) { continue }
  if (($p -ine $prog) -and ($p -ine 'Any')) { continue }
  $action = 'NotConfigured'
  if ([int]$r.Action -eq 1) { $action = 'Allow' }
  elseif ([int]$r.Action -eq 2) { $action = 'Block' }
  $proto = 'Any'
  if ([int]$r.Protocol -eq 6) { $proto = 'TCP' }
  elseif ([int]$r.Protocol -eq 17) { $proto = 'UDP' }
  $lp = [string]$r.LocalPorts
  if (-not $lp -or $lp -eq '*') { $lp = 'Any' }
  $profiles = 'Any'
  if ([int]$r.Profiles -ne 2147483647) {
    $bits = @()
    if (([int]$r.Profiles -band 1) -eq 1) { $bits += 'Domain' }
    if (([int]$r.Profiles -band 2) -eq 2) { $bits += 'Private' }
    if (([int]$r.Profiles -band 4) -eq 4) { $bits += 'Public' }
    $profiles = ($bits -join ',')
  }
  $name = [string]$r.Name
  if (-not $name) { $name = [string]$r.DisplayName }
  $out += [PSCustomObject]@{
    name = $name
    displayName = [string]$r.DisplayName
    action = $action
    profile = $profiles
    enabled = ([int]$r.Enabled -eq 1)
    protocol = $proto
    localPort = $lp
    program = $p
  }
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 3
`;

/** Convertit la sortie JSON de PowerShell en liste de règles typée. */
function parseRules(raw: string): RemoteFirewallRule[] {
  const text = raw.trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map((r) => ({
        name: String(r.name ?? ''),
        displayName: String(r.displayName ?? ''),
        action: String(r.action ?? ''),
        profile: String(r.profile ?? ''),
        enabled: r.enabled === true || String(r.enabled).toLowerCase() === 'true',
        protocol: String(r.protocol ?? ''),
        localPort: String(r.localPort ?? ''),
        program: String(r.program ?? ''),
      }));
  } catch {
    return [];
  }
}

/**
 * État du pare-feu Windows pour l'exécutable de l'app.
 * Lecture seule : ne demande aucun privilège administrateur.
 */
export async function getFirewallStatus(port: number): Promise<RemoteFirewallStatus> {
  const program = process.execPath;
  const portable = isPortablePath(program);
  if (process.platform !== 'win32') {
    return {
      platform: process.platform,
      program,
      blocked: false,
      allowed: false,
      rules: [],
      portable,
      message: null,
    };
  }

  const raw = await runPowerShell(READ_RULES_SCRIPT, { LM_FW_PROGRAM: program });
  const rules = parseRules(raw);
  const normalized = normalizeProgram(program);

  // Une règle "Block" entrante sur le programme (ou sur "Any") coupe tout.
  const blocked = rules.some(
    (r) => r.enabled && r.action.toLowerCase() === 'block' &&
      (normalizeProgram(r.program) === normalized || normalizeProgram(r.program) === 'any'),
  );
  // Une règle "Allow" entrante TCP couvrant le port suffit.
  const allowed = rules.some(
    (r) => r.enabled && r.action.toLowerCase() === 'allow' &&
      (normalizeProgram(r.program) === normalized || normalizeProgram(r.program) === 'any') &&
      protocolCoversTcp(r.protocol) && portCovers(r.localPort, port),
  );

  let message: string | null = null;
  if (blocked) {
    message = `Windows Firewall bloque les connexions entrantes de Light Maestro (port ${port}). Le téléphone ne peut pas jointe le PC : autorisez l'application.`;
  } else if (!allowed) {
    message = `Aucune règle d'autorisation entrante trouvée pour le port ${port}. Le pare-feu peut bloquer le téléphone : autorisez l'application pour être sûr.`;
  }

  return { platform: process.platform, program, blocked, allowed, rules, portable, message };
}

// ─── Réparation du pare-feu (avec invite UAC) ─────────────────────────────

/**
 * Script PowerShell ÉLEVÉ : supprime les règles "Block" entrantes du
 * programme, garantit une règle "Allow" TCP sur le port, et nettoie les
 * règles "%TEMP%" orphelines (le portable change de dossier à chaque
 * lancement → les règles Windows s'accumulent : 42 regs constatées).
 *
 * Lecture/suppression via l'API COM `HNetCfg.FwPolicy2` (rapide : 0,44 s pour
 * 706 règles, là où les cmdlets NetSecurity font 1 requête CIM par règle).
 * La création de la règle "Allow" passe par `netsh` (une seule commande,
 * valeurs par défaut correctes).
 */
/**
 * Construit le script PowerShell élevé de réparation du pare-feu.
 * Exporté pour permettre un test de non-régression sur son contenu.
 */
export function buildFirewallFixScript(program: string, port: number, resultPath: string): string {
  const prog = psQuote(program);
  const result = psQuote(resultPath);
  const portLit = String(port);
  return `
$ErrorActionPreference = 'Continue'
$prog = ${prog}
$port = ${portLit}
$res = ${result}
$lines = @()
$fw = New-Object -ComObject HNetCfg.FwPolicy2

# 1) Suppression des regles "Block" entrantes (une Block l'emporte sur Allow)
$toRemove = @()
foreach ($r in $fw.Rules) {
  if ([int]$r.Direction -ne 1) { continue }
  if ([int]$r.Action -ne 2) { continue }
  if ([int]$r.Enabled -ne 1) { continue }
  $p = [string]$r.ApplicationName
  if (-not $p) { continue }
  if (($p -ieq $prog) -or ($p -ieq 'Any')) {
    $n = [string]$r.Name
    if (-not $n) { $n = [string]$r.DisplayName }
    if ($n) { $toRemove += $n }
  }
}
$removed = 0
foreach ($n in $toRemove) {
  try { $fw.Rules.Remove($n); $removed++ } catch { }
}
$lines += ('blocked-removed:' + $removed)

# 2) Nettoyage des regles %TEMP% orphelines du build portable
$stale = 0
if ($prog -match '\\\\Temp\\\\[^\\\\]+\\\\') {
  $staleNames = @()
  foreach ($r in $fw.Rules) {
    if ([int]$r.Direction -ne 1) { continue }
    if ([int]$r.Action -ne 1) { continue }
    $p = [string]$r.ApplicationName
    if (-not $p) { continue }
    if (($p -match '\\\\Temp\\\\[^\\\\]+\\\\light maestro\\.exe$') -and ($p -ine $prog)) {
      $n = [string]$r.Name
      if (-not $n) { $n = [string]$r.DisplayName }
      if ($n) { $staleNames += $n }
    }
  }
  foreach ($n in $staleNames) {
    try { $fw.Rules.Remove($n); $stale++ } catch { }
  }
}
$lines += ('stale-removed:' + $stale)

# 3) Garantie d'une regle "Allow" entrante TCP sur le port
$hasAllow = $false
foreach ($r in $fw.Rules) {
  if ([int]$r.Direction -ne 1) { continue }
  if ([int]$r.Action -ne 1) { continue }
  if ([int]$r.Enabled -ne 1) { continue }
  $p = [string]$r.ApplicationName
  if (-not $p) { continue }
  if (($p -ine $prog) -and ($p -ine 'Any')) { continue }
  $proto = [int]$r.Protocol
  if (($proto -ne 0) -and ($proto -ne 6)) { continue }
  $lp = [string]$r.LocalPorts
  if ((-not $lp) -or ($lp -eq '*')) { $hasAllow = $true; break }
  if ($lp -match ('(^|,)' + $port + '(,|$)')) { $hasAllow = $true; break }
}
$created = $false
if (-not $hasAllow) {
  # Arguments netsh entre apostrophes : "name=Light Maestro (Remote LAN)"
  # contient des espaces, il doit passer en UN seul argument.
  $progPath = $prog.Trim("'")
  & netsh advfirewall firewall add rule 'name=Light Maestro (Remote LAN)' 'dir=in' 'action=allow' ('program=' + $progPath) 'protocol=TCP' ('localport=' + $port) 'profile=any' 'enable=yes' | Out-Null
  $created = $true
}
$lines += ('allow-created:' + $created)

# 3b) Regle de secours : TOUT le sous-reseau local vers le port du Remote,
# quel que soit le programme. Couvre le cas ou le chemin de l'executable
# change a chaque lancement (build portable) et le cas ou le filtrage par
# programme ne s'applique pas au processus qui ecoute.
$subnetName = 'Light Maestro (Remote LAN - sous-reseau)'
$hasSubnet = $false
foreach ($r in $fw.Rules) {
  if ([string]$r.Name -eq $subnetName) { $hasSubnet = $true; break }
}
if (-not $hasSubnet) {
  & netsh advfirewall firewall add rule ('name=' + $subnetName) 'dir=in' 'action=allow' 'protocol=TCP' ('localport=' + $port) 'remoteip=localSubnet' 'profile=any' 'enable=yes' | Out-Null
  $lines += 'allow-subnet-created:True'
} else {
  $lines += 'allow-subnet-created:False'
}
$lines += 'done'
($lines -join [Environment]::NewLine) | Set-Content -Path $res -Encoding UTF8
`;
}

/**
 * Répare le pare-feu : supprime les règles "Block" et crée la règle "Allow".
 * Déclenche une invite UAC (l'utilisateur doit cliquer « Oui »).
 */
export async function ensureFirewallRule(port: number): Promise<RemoteFirewallFix> {
  const program = process.execPath;
  if (process.platform !== 'win32') {
    return {
      ok: false,
      message: "La gestion du pare-feu n'est disponible que sous Windows.",
      status: await getFirewallStatus(port),
    };
  }

  const before = await getFirewallStatus(port);
  if (!before.blocked && before.allowed) {
    return { ok: true, message: 'Le pare-feu autorise déjà les connexions entrantes.', status: before };
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-firewall-'));
  const scriptPath = path.join(dir, 'fix-firewall.ps1');
  const resultPath = path.join(dir, 'result.txt');
  try {
    fs.writeFileSync(scriptPath, buildFirewallFixScript(program, port, resultPath), 'utf-8');

    // Élévation : `Start-Process -Verb RunAs` → invite UAC. Si l'utilisateur
    // refuse, Start-Process lève une erreur → on la remonte proprement.
    const cmd = `Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',${psQuote(scriptPath)}) -Verb RunAs -Wait`;
    const err = await new Promise<string | null>((resolve) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd],
        { timeout: 120000, windowsHide: true },
        (e) => resolve(e ? e.message : null),
      );
    });

    const after = await getFirewallStatus(port);
    if (err) {
      // Invite UAC refusée (ou impossibilité d'élever le processus).
      // On donne la commande exacte à coller dans un PowerShell ADMIN, sinon
      // l'utilisateur n'a aucun recours depuis l'interface.
      const manual = `netsh advfirewall firewall add rule name="Light Maestro (Remote LAN)" dir=in action=allow program="${program}" protocol=TCP localport=${port} profile=any enable=yes`;
      return {
        ok: false,
        message: `Autorisation annulée ou impossible (${err}). Clique sur « Autoriser » et accepte l'invite Windows. Sinon, ouvre un PowerShell en administrateur et colle : ${manual}`,
        status: after,
      };
    }
    if (!after.allowed || after.blocked) {
      return {
        ok: false,
        message: "L'autorisation n'a pas pu être appliquée. Vérifie que Windows a bien validé la règle.",
        status: after,
      };
    }
    return {
      ok: true,
      message: `Pare-feu autorisé : le port ${port} accepte maintenant les connexions entrantes.`,
      status: after,
    };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

// ─── Infos réseau ─────────────────────────────────────────────────────────

/** Lit le SSID du Wi-Fi et l'interface réseau via `netsh wlan show interfaces`. */
export async function getNetworkInfo(): Promise<RemoteNetworkInfo> {
  const ipv4: string[] = [];
  for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (iface.address.startsWith('169.254.')) continue;
      ipv4.push(iface.address);
      void name;
    }
  }

  let ssid: string | null = null;
  let interfaceName: string | null = null;
  if (process.platform === 'win32') {
    const raw = await new Promise<string>((resolve) => {
      execFile('netsh', ['wlan', 'show', 'interfaces'], { timeout: 8000, windowsHide: true }, (err, stdout) =>
        resolve(err ? '' : String(stdout)),
      );
    });
    for (const line of raw.split(/\r?\n/)) {
      const nameMatch = /^\s*(name|nom)\s*:\s*(.+)$/i.exec(line);
      if (nameMatch && !interfaceName) interfaceName = nameMatch[2].trim();
      // "BSSID" ne matche pas (le motif exige « ssid » en début de ligne).
      const ssidMatch = /^\s*ssid\s*:\s*(.+)$/i.exec(line);
      if (ssidMatch && !ssid) ssid = ssidMatch[1].trim() || null;
    }
  }

  return { ssid, interfaceName, ipv4, hostname: os.hostname() };
}

// ─── Auto-test LAN ────────────────────────────────────────────────────────

/**
 * Teste l'URL LAN depuis le PC (le trafic local n'est PAS filtré par le
 * pare-feu Windows → ce test valide l'IP, le port et le token, mais ne dit
 * rien sur le pare-feu : c'est le rôle de `getFirewallStatus`).
 */
export function probeLan(url: string | null): Promise<RemoteLanProbe> {
  if (!url) {
    return Promise.resolve({ url: null, ok: false, status: null, latencyMs: null, error: 'Aucune URL LAN disponible.' });
  }
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    const finish = (result: Omit<RemoteLanProbe, 'url' | 'latencyMs'> & { latencyMs?: number | null }) => {
      if (settled) return;
      settled = true;
      resolve({ url, latencyMs: Date.now() - started, ...result });
    };
    try {
      const req = http.get(url, { timeout: 5000 }, (res) => {
        res.resume();
        res.on('end', () => finish({ ok: (res.statusCode ?? 0) === 200, status: res.statusCode ?? null, error: null }));
      });
      req.on('timeout', () => {
        req.destroy();
        finish({ ok: false, status: null, error: 'Délai dépassé (5 s).' });
      });
      req.on('error', (e) => finish({ ok: false, status: null, error: e.message }));
    } catch (e) {
      finish({ ok: false, status: null, error: e instanceof Error ? e.message : String(e) });
    }
  });
}

// ─── Point d'entrée ───────────────────────────────────────────────────────

/**
 * Diagnostic complet : pare-feu + réseau + auto-test sur la 1re URL LAN.
 * @param port  Port du serveur Remote.
 * @param urls  URLs LAN (la 1re est celle du QR code).
 */
export async function getRemoteDiagnostics(port: number, urls: string[] = []): Promise<RemoteDiagnostics> {
  const [firewall, network] = await Promise.all([getFirewallStatus(port), getNetworkInfo()]);
  const probe = await probeLan(urls[0] ?? null);
  return { firewall, network, probe };
}
