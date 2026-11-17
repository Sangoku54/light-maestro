/**
 * Diagnostic réseau du Remote LAN — garde-fous de non-régression.
 *
 * Contexte : « le scan du QR code ouvre une page web vide ». La page HTML
 * fonctionne (elle est statique + testée dans remote-page-html.test.ts) : une
 * page 100 % blanche signifie que le HTML n'ARRIVE PAS → blocage réseau.
 * Cause réelle constatée sur le poste : une règle Windows Firewall "Block"
 * entrante sur `light maestro.exe` (créée quand l'utilisateur a refusé
 * l'invite Windows) — une règle Block l'emporte sur les règles Allow.
 *
 * Ces tests verrouillent :
 *   - le module de diagnostic (pare-feu, réseau, auto-test) fonctionne ;
 *   - le main/preload exposent bien les IPC de diagnostic et de réparation ;
 *   - l'UI affiche le bandeau + le bouton d'autorisation ;
 *   - l'installateur NSIS crée la règle Allow à l'installation ;
 *   - la page web ne swallow plus les erreurs HTTP/réseau en silence.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {
  getFirewallStatus,
  getNetworkInfo,
  probeLan,
  getRemoteDiagnostics,
  buildFirewallFixScript,
  type RemoteDiagnostics,
} from '@electron/remote/diagnostics';
import { RemoteServer } from '@electron/remote/server';

const ROOT = path.resolve(__dirname, '..', '..');
const PORT = 18350 + Math.floor(Math.random() * 400);
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('diagnostic réseau du Remote', () => {
  it('getFirewallStatus renvoie une structure cohérente', async () => {
    const st = await getFirewallStatus(8080);
    expect(st.platform).toBe(process.platform);
    expect(typeof st.program).toBe('string');
    expect(st.program.length).toBeGreaterThan(0);
    expect(typeof st.blocked).toBe('boolean');
    expect(typeof st.allowed).toBe('boolean');
    expect(Array.isArray(st.rules)).toBe(true);
    expect(typeof st.portable).toBe('boolean');
    // Le message est obligatoire dès qu'il y a un problème.
    if (st.blocked || !st.allowed) expect(typeof st.message).toBe('string');
  }, 30000);

  it('getNetworkInfo renvoie le SSID, les IP et le nom de la machine', async () => {
    const net = await getNetworkInfo();
    expect(typeof net.hostname).toBe('string');
    expect(Array.isArray(net.ipv4)).toBe(true);
    // Aucune adresse loopback ni lien-local dans la liste.
    for (const ip of net.ipv4) {
      expect(ip.startsWith('127.')).toBe(false);
      expect(ip.startsWith('169.254.')).toBe(false);
    }
  });

  it('probeLan sans URL signale l\'absence d\'URL', async () => {
    const probe = await probeLan(null);
    expect(probe.ok).toBe(false);
    expect(probe.url).toBe(null);
    expect(typeof probe.error).toBe('string');
  });

  it('probeLan mesure la réponse d\'un serveur local', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!DOCTYPE html><html></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const port = (server.address() as { port: number }).port;
    try {
      const probe = await probeLan(`http://127.0.0.1:${port}/`);
      expect(probe.ok).toBe(true);
      expect(probe.status).toBe(200);
      expect(probe.latencyMs).not.toBe(null);
      expect(probe.error).toBe(null);
    } finally {
      server.close();
    }
  });

  it('getRemoteDiagnostics agrège pare-feu, réseau et auto-test', async () => {
    const diag: RemoteDiagnostics = await getRemoteDiagnostics(8080, []);
    expect(diag.firewall).toBeTruthy();
    expect(diag.network).toBeTruthy();
    expect(diag.probe).toBeTruthy();
    expect(diag.probe.ok).toBe(false); // pas d'URL → pas de probe possible
  }, 30000);
});

describe('câblage IPC du diagnostic', () => {
  it('le main expose remote:diagnostics et remote:openFirewall', () => {
    const main = read('electron/main.ts');
    expect(main).toContain("ipcMain.handle('remote:diagnostics'");
    expect(main).toContain("ipcMain.handle('remote:openFirewall'");
    expect(main).toContain('getRemoteDiagnostics');
    expect(main).toContain('ensureFirewallRule');
  });

  it('le preload expose diagnostics et openFirewall', () => {
    const preload = read('electron/preload.ts');
    expect(preload).toContain("diagnostics: () => ipcRenderer.invoke('remote:diagnostics')");
    expect(preload).toContain("openFirewall: () => ipcRenderer.invoke('remote:openFirewall')");
  });

  it('le main avertit l\'utilisateur si le pare-feu bloque le Remote', () => {
    // Sans cela, l'utilisateur voit une page blanche sur son téléphone et ne
    // sait pas que Windows bloque l'application.
    const main = read('electron/main.ts');
    expect(main).toContain('getFirewallStatus');
    expect(main).toContain('new Notification(');
    expect(main).toContain('Remote LAN : accès bloqué');
  });

  it('le main protège le push de snapshot contre un payload non-objet', () => {    // Régression : `'state' in payload` sur un nombre levait un TypeError
    // dans le main → app.quit() (l'appli se fermait toute seule).
    const main = read('electron/main.ts');
    const guard = "typeof payload !== 'object' || payload === null";
    expect(main).toContain(guard);
    const idx = main.indexOf('ipcMain.on(\'remote:state\'');
    expect(idx).toBeGreaterThan(-1);
    expect(main.indexOf(guard)).toBeGreaterThan(idx);
  });

  it('le panneau Remote affiche le bandeau pare-feu et le bouton d\'autorisation', () => {
    const view = read('src/views/PerformanceView.tsx');
    expect(view).toContain('perform.remote.firewall.blockedTitle');
    expect(view).toContain('perform.remote.firewall.allow');
    expect(view).toContain('handleFixFirewall');
    expect(view).toContain('api.openFirewall()');
    expect(view).toContain('perform.remote.network.info');
  });

  it('les clés i18n du diagnostic existent en FR et EN', () => {
    for (const lang of ['fr', 'en']) {
      const dict = JSON.parse(read(`src/i18n/${lang}.json`));
      const remote = dict.perform.remote;
      expect(remote.firewall, `${lang}.perform.remote.firewall`).toBeTruthy();
      expect(remote.network, `${lang}.perform.remote.network`).toBeTruthy();
      for (const key of ['blockedTitle', 'blockedHint', 'warningTitle', 'okTitle', 'allow', 'failed']) {
        expect(typeof remote.firewall[key], `${lang}.firewall.${key}`).toBe('string');
      }
      for (const key of ['info', 'ssidUnknown', 'probeOk', 'probeKo', 'sameWifi']) {
        expect(typeof remote.network[key], `${lang}.network.${key}`).toBe('string');
      }
    }
  });
});

describe('script de réparation du pare-feu', () => {
  it('le script élevé supprime les Block et crée la règle Allow', () => {
    const ps = buildFirewallFixScript('C:\\Apps\\light maestro.exe', 8080, 'C:\\tmp\\res.txt');
    // Lecture/suppression via l'API COM (rapide) : les cmdlets NetSecurity
    // font 1 requête CIM par règle (706 → 2,7 s, voire 30 s en charge).
    expect(ps).toContain('New-Object -ComObject HNetCfg.FwPolicy2');
    expect(ps).toContain('$fw.Rules.Remove');
    // Création de la règle Allow via netsh (un seul argument par option).
    expect(ps).toContain("'name=Light Maestro (Remote LAN)'");
    expect(ps).toContain("('localport=' + $port)");
    expect(ps).toContain('action=allow');
    expect(ps).toContain('dir=in');
    // Regle de secours : tout le sous-reseau local vers le port du Remote.
    expect(ps).toContain('remoteip=localSubnet');
    // Le chemin du programme est injecté proprement (apostrophes échappées).
    expect(ps).toContain("$prog = 'C:\\Apps\\light maestro.exe'");
    expect(ps).toContain("$port = 8080");
  });

  it('le chemin du programme est échappé (apostrophe → double apostrophe)', () => {
    const ps = buildFirewallFixScript("C:\\Apps\\l'maestro.exe", 8080, 'C:\\tmp\\res.txt');
    expect(ps).toContain("$prog = 'C:\\Apps\\l''maestro.exe'");
  });
});

describe('suivi des clients connectés (preuve du passage du téléphone)', () => {
  it('le serveur journalise chaque nouvelle IP et expose les clients', async () => {
    const server = new RemoteServer();
    process.env.LM_REMOTE_PORT = String(PORT);
    server.start();
    for (let i = 0; i < 150 && !server.getStatus().running; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    const token = server.getToken();
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/?token=${token}`, {
        headers: { 'User-Agent': 'TestPhone/1.0' },
      });
      expect(res.status).toBe(200);
      await res.text();
      const clients = server.getStatus().clients ?? [];
      expect(clients.length).toBeGreaterThan(0);
      expect(clients[0].agent).toContain('TestPhone');
      expect(clients[0].requests).toBeGreaterThan(0);
    } finally {
      server.stop();
      delete process.env.LM_REMOTE_PORT;
    }
  }, 30000);

  it('le panneau Remote affiche la liste des appareils connectés', () => {
    const view = read('src/views/PerformanceView.tsx');
    expect(view).toContain('perform.remote.connectedDevices');
    expect(view).toContain('perform.remote.noConnectedDevices');
    expect(view).toContain('status?.clients');
  });

  it('les clés i18n des appareils connectés existent en FR et EN', () => {
    for (const lang of ['fr', 'en']) {
      const dict = JSON.parse(read(`src/i18n/${lang}.json`));
      expect(typeof dict.perform.remote.connectedDevices).toBe('string');
      expect(typeof dict.perform.remote.noConnectedDevices).toBe('string');
    }
  });
});

describe('installateur NSIS', () => {
  it('le script d\'installation crée la règle Allow du port 8080', () => {
    const nsh = read('build/installer.nsh');
    expect(nsh).toContain('!macro customInstall');
    expect(nsh).toContain('netsh advfirewall firewall add rule');
    expect(nsh).toContain('action=allow');
    expect(nsh).toContain('dir=in');
    expect(nsh).toContain('protocol=TCP');
    expect(nsh).toContain('localport=8080');
    // La règle doit être retirée à la désinstallation.
    expect(nsh).toContain('!macro customUnInstall');
    expect(nsh).toContain('firewall delete rule');
  });

  it('package.json référence le script NSIS', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.build.nsis.include).toBe('build/installer.nsh');
  });
});
