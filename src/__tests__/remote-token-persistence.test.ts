/**
 * Persistance du token d'accès Remote (electron/remote/server.ts).
 *
 * Régression : le token était régénéré à chaque démarrage → les URL (QR
 * codes) déjà scannées sur les téléphones devenaient invalides → 401 sur
 * TOUTES les requêtes (« le téléphone ne se connecte plus, aucun bouton ne
 * marche »). Le token doit donc être stable :
 *   - `start(presetToken)` utilise le token fourni ;
 *   - `stop()` puis `start()` conserve le même token en mémoire.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RemoteServer } from '@electron/remote/server';

const PRESET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

// Port dédié (hors des plages des autres tests Remote) + incrément par test.
const PORT_BASE = 21500;
let port = PORT_BASE;
let server: RemoteServer;

async function startServer(preset?: string): Promise<void> {
  server = new RemoteServer();
  server.start(preset);
  // listen() est asynchrone : on attend l'état « running » sinon le port
  // peut rester lié après stop() (fuite de port → tests instables).
  for (let i = 0; i < 150 && !server.getStatus().running; i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
}

beforeEach(() => {
  port += 1;
  process.env.LM_REMOTE_PORT = String(port);
  server = new RemoteServer();
});

afterEach(() => {
  server.stop();
  delete process.env.LM_REMOTE_PORT;
});

describe('token Remote', () => {
  it('start(presetToken) utilise le token fourni', async () => {
    await startServer(PRESET);
    expect(server.getToken()).toBe(PRESET);
  });

  it('start() sans preset génère un token hexadécimal de 32 caractères', async () => {
    await startServer();
    expect(server.getToken()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('un preset invalide est ignoré (token aléatoire à la place)', async () => {
    await startServer('pas-un-token');
    expect(server.getToken()).toMatch(/^[0-9a-f]{32}$/);
    expect(server.getToken()).not.toBe('pas-un-token');
  });

  it('stop() puis start() conserve le même token', async () => {
    await startServer(PRESET);
    const before = server.getToken();
    server.stop();
    await startServer(PRESET);
    expect(server.getToken()).toBe(before);
  });

  it('stop() ne vide pas le token (URL déjà distribuées restent valides)', async () => {
    await startServer(PRESET);
    server.stop();
    expect(server.getToken()).toBe(PRESET);
  });
});
