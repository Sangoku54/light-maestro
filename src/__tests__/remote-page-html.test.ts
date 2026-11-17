/**
 * Page web embarquée du Remote (GET /) — garde-fou de non-régression.
 *
 * Un bug passé inaperçu : une parenthèse mal fermée dans le script inline
 * rendait TOUTE la page inerte (aucun bouton ne répondait, le téléphone ne
 * se connectait plus). Ce test verrouille :
 *   - le script inline est syntaxiquement valide (parsing JS réel) ;
 *   - tous les ids DOM utilisés par le script existent dans le HTML ;
 *   - les endpoints appelés par le script existent côté serveur ;
 *   - aucune variable manifestement tronquée (typo type `nex`).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { RemoteServer } from '@electron/remote/server';

const PORT = 18200 + Math.floor(Math.random() * 900);

let server: RemoteServer;
let token = '';
let html = '';
let script = '';

function get(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path, headers: { 'X-Auth-Token': token } },
      (res) => {
        let raw = '';
        res.on('data', (c: Buffer) => (raw += c.toString('utf-8')));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: raw }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  process.env.LM_REMOTE_PORT = String(PORT);
  server = new RemoteServer();
  server.start();
  for (let i = 0; i < 150 && !server.getStatus().running; i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  if (!server.getStatus().running) {
    throw new Error(`serveur Remote non démarré : ${server.getStatus().lastError ?? '?'}`);
  }
  token = server.getToken();
  const res = await get('/');
  expect(res.status).toBe(200);
  html = res.body;
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  expect(m, 'balise <script> introuvable dans la page').toBeTruthy();
  script = m![1];
});

afterAll(() => {
  server.stop();
  delete process.env.LM_REMOTE_PORT;
});

describe('page web Remote', () => {
  it('le script inline est syntaxiquement valide', () => {
    // `new Function` parse réellement le code : une parenthèse mal fermée
    // (bug passé inaperçu) fait échouer ce test.
    expect(() => new Function(script)).not.toThrow();
  });

  it('le script ne contient pas de variable tronquée', () => {
    // Régression ciblée : `{on:nex}` (au lieu de `{on:next}`).
    expect(script).not.toMatch(/\bnex\b/);
  });

  it('le HTML ne se coupe pas au premier </script>', () => {
    expect(script.length).toBeGreaterThan(2000);
    expect(script.trimEnd().endsWith('})();')).toBe(true);
  });

  it('tous les ids DOM utilisés par le script existent dans la page', () => {
    const ids = [
      'blackout',
      'stopAll',
      'gm',
      'gmValue',
      'scenes',
      'chasers',
      'status',
      'error',
    ];
    for (const id of ids) {
      expect(html, `id="${id}" absent du HTML`).toContain(`id="${id}"`);
      expect(script, `getElementById('${id}') absent du script`).toContain(`'${id}'`);
    }
  });

  it('le script appelle uniquement des endpoints existants', () => {
    const called = new Set<string>();
    // post('api/xxx', ...) — endpoints littéraux
    const re = /post\(\s*'(api\/[\w]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(script)) !== null) called.add(m[1]);
    // bindActions('conteneur', 'api/xxx') — endpoints paramétrés (Cue Lists,
    // Presets) : l'ancien regex ne les voyait pas du tout.
    const re2 = /bindActions\(\s*'[a-zA-Z]+'\s*,\s*'(api\/[\w]+)/g;
    while ((m = re2.exec(script)) !== null) called.add(m[1]);
    expect(called.size).toBeGreaterThan(0);
    for (const ep of called) {
      expect(ep).toMatch(/^api\/(blackout|grandmaster|stopall|scene|chaser|widget|cueList|songPreset)$/);
    }
    // Les onglets à contenu dynamique doivent tous être câblés.
    expect(called).toContain('api/cueList');
    expect(called).toContain('api/songPreset');
  });

  it('la page expose les onglets + la console virtuelle', () => {
    // Onglets
    for (const tab of ['scenes', 'chasers', 'cueLists', 'presets', 'console']) {
      expect(html).toContain(`data-tab="${tab}"`);
    }
    // Sections
    for (const id of ['panel-scenes', 'panel-chasers', 'panel-cueLists', 'panel-presets', 'panel-console']) {
      expect(html).toContain(`id="${id}"`);
    }
    // Console : pages + widgets + faders
    expect(html).toContain('id="vcPages"');
    expect(html).toContain('id="vcWidgets"');
    expect(script).toContain('state.widgets');
    expect(script).toContain("'api/widget/'");
    // Le contrôle permanent (blackout / stop all / GM) est HORS des onglets :
    // il doit rester accessible quelle que soit l'onglet affiché.
    const blackoutIdx = html.indexOf('id="blackout"');
    const tabsIdx = html.indexOf('class="tabs"');
    expect(blackoutIdx).toBeGreaterThan(-1);
    expect(tabsIdx).toBeGreaterThan(blackoutIdx);
  });

  it('la couleur des tuiles VC est validée avant injection dans un attribut style', () => {
    // Une couleur corrompue (projet importé/édité à la main) contenant un
    // guillemet cassait l'attribut style="..." → injection HTML dans la page
    // mobile. La couleur doit passer par safeColor().
    expect(script).toContain('function safeColor');
    expect(script).toContain('safeColor(w.color)');
    expect(script).not.toMatch(/var color = w\.color \|\|/);
  });

  it('le script interroge /api/state (synchronisation)', () => {
    expect(script).toContain("api('api/state')");
  });

  it('le token de l\'URL prime sur le sessionStorage (évite les 401)', () => {
    // Ordre critique : si le sessionStorage était lu en premier, un token
    // périmé resterait prioritaire après un redémarrage du PC → 401 partout.
    const urlIdx = script.indexOf("window.location.search).get('token')");
    const storageIdx = script.indexOf("sessionStorage.getItem('lmToken')");
    expect(urlIdx).toBeGreaterThan(-1);
    expect(storageIdx).toBeGreaterThan(-1);
    expect(urlIdx).toBeLessThan(storageIdx);
    expect(script).toContain("var token = urlToken || sessionStorage.getItem('lmToken')");
  });

  it('un 401 purge le token cached et invite à rescanner le QR code', () => {
    expect(script).toContain("sessionStorage.removeItem('lmToken')");
    expect(script).toMatch(/re-?scannez/i);
  });

  it('les erreurs HTTP et réseau sont affichées (plus de silence)', () => {
    // Avant : les réponses 400 / 413 / 503 étaient traitées comme des
    // succès (le .json() renvoyait le message d'erreur et l'UI restait
    // muette) → l'utilisateur croyait que la commande passait. Et une panne
    // réseau (serveur arrêté / pare-feu bloquant) n'affichait rien non plus.
    expect(script).toContain('if (!res.ok)');
    expect(script).toContain('Commande refusée par le PC');
    expect(script).toContain('Connexion au PC impossible');
    // Le rejet réseau est traité via le 2e argument de then() (network fail).
    expect(script).toMatch(/\.then\(function \(res\) \{[\s\S]*?\}, function \(err\) \{/);
  });
});
