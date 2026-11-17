/**
 * Interfaces réseau utilisables pour le Remote LAN — un QR code par interface.
 *
 * POURQUOI CE MODULE EXISTE
 * -------------------------
 * Le Remote affichait UNE seule URL (la première trouvée) et UN seul QR code.
 * Au concert, le PC est connecté en Wi-Fi (192.168.1.x) ET branché en
 * Ethernet sur la mixette (192.168.0.x) : le QR pointait vers le réseau de
 * la Freebox alors que la tablette était sur le réseau de la mixette →
 * page web VIDE (le HTML n'arrive jamais). Il faut donc proposer un QR par
 * interface, avec un libellé, et prioriser le réseau autonome (mode « sans
 * routeur ») quand il est actif.
 */

import os from 'node:os';

/** Nature du réseau transportant une URL d'accès au Remote. */
export type RemoteNetworkKind = 'standalone' | 'wifi' | 'ethernet' | 'other';

/** Une interface réseau + l'URL d'accès correspondante. */
export interface RemoteLanInterface {
  /** URL complète `http://<ip>:<port>/?token=<token>`. */
  url: string;
  /** Adresse IPv4 de l'interface. */
  address: string;
  /** Nom de l'interface tel que Windows l'affiche (« Wi-Fi », « Ethernet »…). */
  interfaceName: string;
  /** Nature du réseau (Wi-Fi, Ethernet, réseau autonome…). */
  kind: RemoteNetworkKind;
}

/** Interfaces à ignorer (virtuelles : VPN, WSL, Hyper-V, Docker…). */
export const VIRTUAL_IFACE_PATTERNS = [
  /vethernet/i,
  /hyper-?v/i,
  /vmware/i,
  /virtualbox/i,
  /vbox/i,
  /docker/i,
  /\bwsl\b/i,
  /loopback/i,
  /pseudo/i,
  /teredo/i,
  /tap-?tunnel/i,
  /bluetooth/i,
  /npcap/i,
  /isatap/i,
  /software loopback/i,
  /openvpn/i,
  /wireguard/i,
  /tailscale/i,
  /zerotier/i,
];

/**
 * Détecte la nature d'une interface à partir de son nom Windows et de l'IP
 * du partage de connexion (réseau autonome).
 */
export function classifyInterface(
  name: string,
  address: string,
  standaloneAddress: string | null = null,
): RemoteNetworkKind {
  // Le partage de connexion crée un adaptateur virtuel « Microsoft Wi-Fi
  // Direct Virtual Adapter » (affiché « Connexion au réseau local* N » en
  // français) avec l'IP 192.168.137.1.
  if (standaloneAddress && address === standaloneAddress) return 'standalone';
  if (/wi-?fi direct|local area connection|connexion au réseau local/i.test(name)) return 'standalone';
  if (/wi-?fi|wlan\s*\d|wireless/i.test(name)) return 'wifi';
  if (/ethernet|^eth\d|connexion réseau local 4/i.test(name)) return 'ethernet';
  return 'other';
}

/**
 * Collecte les interfaces réseau utilisables + leur URL d'accès Remote.
 *
 * @param port  Port du serveur HTTP embarqué.
 * @param token Token d'accès (présent dans chaque URL).
 * @param standaloneAddress IP du PC sur le réseau autonome (si actif).
 */
export function collectLanInterfaces(
  port: number,
  token: string,
  standaloneAddress: string | null = null,
): RemoteLanInterface[] {
  const entries: { address: string; name: string }[] = [];
  for (const [name, ifaces] of Object.entries(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (VIRTUAL_IFACE_PATTERNS.some((re) => re.test(name))) continue;
      // Lien-local (APIPA 169.254.x.x) : adresse auto-attribuée, souvent
      // inexistante sur le réseau réel → le QR pointerait dans le vide.
      if (iface.address.startsWith('169.254.')) continue;
      entries.push({ address: iface.address, name });
    }
  }
  const interfaces = entries.map((e) => ({
    address: e.address,
    interfaceName: e.name,
    kind: classifyInterface(e.name, e.address, standaloneAddress),
    url: `http://${e.address}:${port}/?token=${encodeURIComponent(token)}`,
  }));
  // Ordre d'affichage : réseau autonome d'abord (c'est le mode « sans
  // routeur »), puis Wi-Fi, puis Ethernet, puis le reste.
  const order: RemoteNetworkKind[] = ['standalone', 'wifi', 'ethernet', 'other'];
  interfaces.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  return interfaces;
}
