/**
 * Limite de débit des commandes Remote (`electron/remote/server.ts`).
 *
 * Un client defectueux (boucle infinie) ou malveillant ne doit pas pouvoir
 * noyer le renderer sous des milliers de commandes/seconde. Le serveur
 * répond alors 429 avec un `Retry-After`.
 *
 * Serveur réel sur un port libre aléatoire (aucun accès au réseau externe).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { RemoteServer } from '@electron/remote/server';

const PORT = 20500 + Math.floor(Math.random() * 2000);

let server: RemoteServer;
let token = '';

function post(path: string, body?: unknown): Promise<{ status: number; headers: http.IncomingHttpHeaders; json: any }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = { 'X-Auth-Token': token };
    if (data !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(data));
    }
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path, method: 'POST', headers },
      (res) => {
        let raw = '';
        res.on('data', (chunk: Buffer) => (raw += chunk.toString('utf-8')));
        res.on('end', () => {
          let json: any = null;
          try { json = JSON.parse(raw); } catch { /* corps non JSON */ }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, json });
        });
      },
    );
    req.on('error', reject);
    if (data !== undefined) req.write(data);
    req.end();
  });
}

beforeAll(async () => {
  process.env.LM_REMOTE_PORT = String(PORT);
  server = new RemoteServer();
  server.setMainWindow({
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: () => {},
    },
  } as any);
  server.start();
  for (let i = 0; i < 150 && !server.getStatus().running; i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  if (!server.getStatus().running) {
    throw new Error(`serveur Remote non démarré : ${server.getStatus().lastError ?? 'raison inconnue'}`);
  }
  token = server.getToken();
});

afterAll(() => {
  server.stop();
  delete process.env.LM_REMOTE_PORT;
});

describe('Remote — limite de débit des commandes (POST)', () => {
  it('une rafale excessive est bridée par 429 + Retry-After, sans crash', async () => {
    const statuses: number[] = [];
    // 200 commandes en rafale : le réservoir (120 jetons, 60/s) doit saturer.
    for (let i = 0; i < 200; i++) {
      const res = await post('/api/widget/w-1', { action: 'toggle' });
      statuses.push(res.status);
      if (res.status === 429) {
        expect(res.json.ok).toBe(false);
        expect(res.headers['retry-after']).toBeDefined();
        break;
      }
    }
    expect(statuses).toContain(429);
  });

  it('le serveur reste opérationnel après la saturation (GET /api/state)', async () => {
    const res = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: PORT, path: '/api/state', method: 'GET', headers: { 'X-Auth-Token': token } },
        (r) => {
          r.resume();
          r.on('end', () => resolve(r.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(res).toBe(200);
  });
});
