/**
 * Endpoint Remote `POST /api/widget/:id` (electron/remote/server.ts).
 *
 * Contrat testé :
 *   - action par défaut = `press`, émise sur `remote:command` vers le renderer ;
 *   - `press` / `release` / `toggle` valides, `slider` exige `value` ∈ [0, 1] ;
 *   - token obligatoire (401 sans lui) ;
 *   - toute erreur renvoie un JSON d'erreur (jamais de 200 mensonger).
 *
 * Le serveur tourne réellement sur un port libre aléatoire ; la fenêtre cible
 * est un double qui capture `webContents.send`.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import { RemoteServer } from '@electron/remote/server';

const PORT = 18000 + Math.floor(Math.random() * 2000);

interface Emitted {
  channel: string;
  command: { type: string; id?: string; action?: string; value?: number };
}

let server: RemoteServer;
let token = '';
let sent: Emitted[] = [];

function post(
  path: string,
  body?: unknown,
  opts: { token?: string | null } = {},
): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const headers: Record<string, string> = {};
    if (data !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(data));
    }
    if (opts.token !== null) headers['X-Auth-Token'] = opts.token ?? '';
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path, method: 'POST', headers },
      (res) => {
        let raw = '';
        res.on('data', (chunk: Buffer) => (raw += chunk.toString('utf-8')));
        res.on('end', () => {
          let json: any = null;
          try {
            json = JSON.parse(raw);
          } catch {
            /* corps non JSON — on garde status */
          }
          resolve({ status: res.statusCode ?? 0, json });
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
  const sentCommands: Emitted[] = [];
  server.setMainWindow({
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (channel: string, command: Emitted['command']) => {
        sentCommands.push({ channel, command });
      },
    },
  } as any);
  server.start();
  // listen() est asynchrone : on attend l'état running (ou l'erreur explicite).
  for (let i = 0; i < 150 && !server.getStatus().running; i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  if (!server.getStatus().running) {
    throw new Error(`serveur Remote non démarré : ${server.getStatus().lastError ?? 'raison inconnue'}`);
  }
  token = server.getToken();
  // La capture est lue par les tests via l'attribut posé sur l'instance.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).__sentList = sentCommands;
});

afterAll(() => {
  server.stop();
  delete process.env.LM_REMOTE_PORT;
});

beforeEach(() => {
  const list = (server as any).__sentList as Emitted[];
  list.length = 0;
  sent = list;
});

describe('POST /api/widget/:id', () => {
  it('action absente → press, émise sur remote:command', async () => {
    const res = await post('/api/widget/btn-1', {}, { token });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].channel).toBe('remote:command');
    expect(sent[0].command).toEqual({ type: 'widget', id: 'btn-1', action: 'press', value: undefined });
  });

  it('toggle et release transitent tels quels', async () => {
    await post('/api/widget/btn-2', { action: 'toggle' }, { token });
    await post('/api/widget/btn-2', { action: 'release' }, { token });
    expect(sent.map((e) => e.command.action)).toEqual(['toggle', 'release']);
    expect(sent.every((e) => e.command.type === 'widget' && e.command.id === 'btn-2')).toBe(true);
  });

  it('slider : value fraction 0..1 transmise au renderer', async () => {
    const res = await post('/api/widget/fader-1', { action: 'slider', value: 0.5 }, { token });
    expect(res.status).toBe(200);
    expect(sent[0].command).toMatchObject({ type: 'widget', id: 'fader-1', action: 'slider', value: 0.5 });
  });

  it('slider sans value ou hors [0,1] → 400, rien émis', async () => {
    const a = await post('/api/widget/fader-1', { action: 'slider' }, { token });
    const b = await post('/api/widget/fader-1', { action: 'slider', value: 2 }, { token });
    const c = await post('/api/widget/fader-1', { action: 'slider', value: 'x' }, { token });
    expect([a.status, b.status, c.status]).toEqual([400, 400, 400]);
    expect(sent).toHaveLength(0);
  });

  it('action inconnue → 400', async () => {
    const res = await post('/api/widget/btn-3', { action: 'explode' }, { token });
    expect(res.status).toBe(400);
    expect(res.json.ok).toBe(false);
    expect(sent).toHaveLength(0);
  });

  it('sans token → 401, rien émis', async () => {
    const res = await post('/api/widget/btn-4', { action: 'press' }, { token: null });
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it('id URL-encodé décodé tel quel', async () => {
    const res = await post('/api/widget/%C3%A9clairage%2F1', { action: 'press' }, { token });
    expect(res.status).toBe(200);
    expect(sent[0].command.id).toBe('éclairage/1');
  });
});
