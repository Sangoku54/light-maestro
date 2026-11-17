/**
 * Mode autonome du Remote LAN + QR code par interface réseau.
 *
 * CONTEXTE
 * ---------
 * « Le scan du QR code ouvre une page web vide » ET « comment faire sans
 * routeur ? » (à la manière de la Soundcraft UI16).
 *
 * Deux bugs réels sont verrouillés par ces tests :
 *   1. Le Remote n'affichait qu'UNE URL et UN seul QR code. Au concert, le PC
 *      a le Wi-Fi ET un Ethernet branché sur la mixette : le QR pointait vers
 *      le mauvais sous-réseau → page blanche sur la tablette.
 *   2. Il n'existait aucun moyen de piloter le PC sans routeur : le mode
 *      autonome crée un point d'accès Wi-Fi sur le PC (partage de connexion
 *      Windows / WinRT `NetworkOperatorTetheringManager`), comme la UI16.
 *
 * Ces tests vérifient :
 *   - le script PowerShell du point d'accès utilise bien les API WinRT
 *     (configure + start + stop + lecture d'état) ;
 *   - le statut du point d'accès est cohérent et les erreurs sont remontées ;
 *   - la classification des interfaces (autonome / Wi-Fi / Ethernet) et
 *     l'ordre d'affichage (autonome en premier) ;
 *   - les IPC main → preload → types → UI existent ;
 *   - la parité i18n FR/EN des nouveaux libellés.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  HOTSPOT_SCRIPT,
  getHotspotStatus,
  startHotspot,
  findStandaloneAddress,
} from '@electron/remote/standalone';
import {
  classifyInterface,
  collectLanInterfaces,
} from '@electron/remote/interfaces';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('script du point d\'accès autonome (mode sans routeur)', () => {
  it('pilote les API WinRT de partage de connexion', () => {
    // Configuration du SSID / mot de passe (c'est elle qui rend le réseau
    // exploitable par la tablette).
    expect(HOTSPOT_SCRIPT).toContain('ConfigureAccessPointAsync');
    expect(HOTSPOT_SCRIPT).toContain('NetworkOperatorTetheringAccessPointConfiguration');
    expect(HOTSPOT_SCRIPT).toContain('StartTetheringAsync');
    expect(HOTSPOT_SCRIPT).toContain('StopTetheringAsync');
    // Lecture d'état (property synchrones, les seules projetables en PS 5.1).
    expect(HOTSPOT_SCRIPT).toContain('TetheringOperationalState');
    expect(HOTSPOT_SCRIPT).toContain('ClientCount');
  });

  it('reçoit ses paramètres par variables d\'environnement (pas de quoting cassé)', () => {
    expect(HOTSPOT_SCRIPT).toContain('LM_HOTSPOT_ACTION');
    expect(HOTSPOT_SCRIPT).toContain('LM_HOTSPOT_SSID');
    expect(HOTSPOT_SCRIPT).toContain('LM_HOTSPOT_PASSPHRASE');
  });
});

describe('statut du point d\'accès autonome', () => {
  it('renvoie une structure cohérente', async () => {
    const st = await getHotspotStatus();
    expect(typeof st.supported).toBe('boolean');
    expect(['On', 'Off', 'InTransition', 'Unknown']).toContain(st.state);
    expect(typeof st.clients).toBe('number');
    expect(st.clients).toBeGreaterThanOrEqual(0);
    expect(st.address === null || typeof st.address === 'string').toBe(true);
  }, 60000);

  it('refuse un mot de passe trop court sans démarrer le point d\'accès', async () => {
    const st = await startHotspot('Light Maestro', 'court');
    expect(st.message).toBeTruthy();
    expect(st.message).toContain('8');
    // Le réseau n'a pas été démarré avec un mot de passe invalide.
    expect(st.state).not.toBe('On');
  }, 60000);

  it('détecte l\'IP du réseau autonome (sous-réseau ICS)', () => {
    const addr = findStandaloneAddress();
    if (addr !== null) {
      expect(addr).toMatch(/^192\.168\.137\.\d+$/);
    }
  });
});

describe('classification des interfaces réseau', () => {
  it('identifie le réseau autonome, le Wi-Fi, l\'Ethernet et les autres', () => {
    expect(classifyInterface('Connexion au réseau local* 2', '192.168.137.1', '192.168.137.1')).toBe('standalone');
    expect(classifyInterface('Microsoft Wi-Fi Direct Virtual Adapter #4', '192.168.137.1')).toBe('standalone');
    expect(classifyInterface('Wi-Fi', '192.168.1.36')).toBe('wifi');
    expect(classifyInterface('WLAN 3', '10.0.0.5')).toBe('wifi');
    expect(classifyInterface('Ethernet', '192.168.0.24')).toBe('ethernet');
    expect(classifyInterface('eth0', '192.168.0.24')).toBe('ethernet');
    expect(classifyInterface('Pont réseau', '172.20.0.3')).toBe('other');
  });

  it('expose une URL par interface, avec le token et sans lien-local', () => {
    const interfaces = collectLanInterfaces(8080, 'abc123');
    for (const i of interfaces) {
      expect(i.url).toContain(`:${8080}/?token=abc123`);
      expect(i.address.startsWith('169.254.')).toBe(false);
      expect(i.address.startsWith('127.')).toBe(false);
      expect(['standalone', 'wifi', 'ethernet', 'other']).toContain(i.kind);
    }
  });

  it('met le réseau autonome en premier (QR prioritaire)', () => {
    const interfaces = collectLanInterfaces(8080, 'abc123', '192.168.137.1');
    const standalone = interfaces.find((i) => i.kind === 'standalone');
    if (standalone) {
      expect(interfaces[0].kind).toBe('standalone');
    }
    // Sans réseau autonome, l'ordre reste stable (Wi-Fi avant Ethernet).
    const order = interfaces.map((i) => i.kind);
    if (order.includes('wifi') && order.includes('ethernet')) {
      expect(order.indexOf('wifi')).toBeLessThan(order.indexOf('ethernet'));
    }
  });
});

describe('intégration du mode autonome', () => {
  it('le main expose les IPC du point d\'accès', () => {
    const main = read('electron/main.ts');
    expect(main).toContain("ipcMain.handle('remote:hotspotStatus'");
    expect(main).toContain("ipcMain.handle('remote:startHotspot'");
    expect(main).toContain("ipcMain.handle('remote:stopHotspot'");
    // Le statut du serveur expose une entrée par interface (QR par réseau).
    expect(main).toContain('interfaces');
    expect(main).toContain('collectRemoteLanInterfaces');
  });

  it('le preload expose les mêmes IPC', () => {
    const preload = read('electron/preload.ts');
    expect(preload).toContain('hotspotStatus:');
    expect(preload).toContain('startHotspot:');
    expect(preload).toContain('stopHotspot:');
  });

  it('les types partagés déclarent le mode autonome et les interfaces', () => {
    const types = read('src/types.d.ts');
    expect(types).toContain('RemoteHotspotStatus');
    expect(types).toContain('RemoteLanInterface');
    expect(types).toContain('hotspotStatus:');
    expect(types).toContain('startHotspot:');
    expect(types).toContain('stopHotspot:');
  });

  it('le panneau Remote affiche un QR par interface et le mode autonome', () => {
    const view = read('src/views/PerformanceView.tsx');
    expect(view).toContain('status.interfaces');
    expect(view).toContain('perform.remote.qrTitle');
    expect(view).toContain('perform.remote.qrPrimary');
    expect(view).toContain('perform.remote.standalone.title');
    expect(view).toContain('handleToggleHotspot');
    // Un QR code par interface (la boucle sur les interfaces).
    expect(view).toContain('status.interfaces.map');
  });

  it('les libellés existent en FR et EN (parité)', () => {
    const fr = JSON.parse(read('src/i18n/fr.json'));
    const en = JSON.parse(read('src/i18n/en.json'));
    for (const lang of [fr, en]) {
      const remote = lang.perform.remote;
      expect(typeof remote.qrTitle).toBe('string');
      expect(typeof remote.qrHint).toBe('string');
      expect(typeof remote.qrPrimary).toBe('string');
      expect(typeof remote.networkLabels).toBe('object');
      for (const kind of ['standalone', 'wifi', 'ethernet', 'other']) {
        expect(typeof remote.networkLabels[kind]).toBe('string');
      }
      expect(typeof remote.standalone).toBe('object');
      for (const key of [
        'title', 'subtitle', 'activate', 'deactivate', 'stateOn',
        'ssid', 'passphrase', 'address', 'clients', 'hint', 'unsupported',
      ]) {
        expect(typeof remote.standalone[key], `standalone.${key}`).toBe('string');
      }
      expect(typeof remote.standalone.errors.toggle).toBe('string');
    }
    // Mêmes clés dans les deux langues.
    const frKeys = Object.keys(fr.perform.remote).sort();
    const enKeys = Object.keys(en.perform.remote).sort();
    expect(frKeys).toEqual(enKeys);
    expect(Object.keys(fr.perform.remote.standalone).sort())
      .toEqual(Object.keys(en.perform.remote.standalone).sort());
    expect(Object.keys(fr.perform.remote.networkLabels).sort())
      .toEqual(Object.keys(en.perform.remote.networkLabels).sort());
  });
});
