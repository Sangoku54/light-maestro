/**
 * Licence — tests du client HTTP (electron/license/server.ts).
 *
 * Ces tests verrouillent le contrat d'erreur entre l'app et l'API PHP :
 * c'est exactement la zone qui avait produit le bug « inscription
 * impossible » — un HTTP 400 du serveur (validation email / mot de passe)
 * était transformé en code `server`, et la modale affichait le mot
 * « server » au lieu du message réel.
 *
 * Ils verrouillent aussi le choix de la pile réseau : `net.fetch`
 * (Chromium) et non le `fetch` Node/undici, qui ne voit pas les
 * proxys / inspections HTTPS du système.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const { netFetch, globalFetch } = vi.hoisted(() => ({
  netFetch: vi.fn(),
  globalFetch: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    isReady: () => true,
    once: () => {},
  },
  net: {
    fetch: netFetch,
  },
}));

import {
  registerWithLicense,
  loginWithLicense,
  startCheckout,
  LICENSE_API_URL,
  LicenseError,
} from '@electron/license/server';
import { limitsForEdition } from '@electron/license/types';

/** Fausse réponse HTTP sufficientemente fidèle pour le client. */
function fakeResponse(status: number, body: unknown, asJson = true): any {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (!asJson) throw new SyntaxError('Unexpected token <');
      return body;
    },
    text: async () => (asJson ? JSON.stringify(body) : '<html>erreur</html>'),
  };
}

async function expectLicenseError(promise: Promise<unknown>, code: string): Promise<LicenseError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(LicenseError);
    expect((e as LicenseError).code).toBe(code);
    return e as LicenseError;
  }
  throw new Error(`Aucune exception levée (code attendu : ${code})`);
}

const originalGlobalFetch = globalThis.fetch;

describe('client HTTP de licence', () => {
  beforeEach(() => {
    netFetch.mockReset();
    globalFetch.mockReset();
    // Le repli du module utilise le `fetch` global : on le redirige.
    globalThis.fetch = globalFetch as unknown as typeof fetch;
  });

  afterAll(() => {
    globalThis.fetch = originalGlobalFetch;
  });

  it('cible la bonne URL et utilise la pile réseau Chromium (net.fetch)', async () => {
    netFetch.mockResolvedValue(
      fakeResponse(200, { token: 'tok', edition: 'free', email: 'a@b.fr', displayName: null }),
    );

    const res = await registerWithLicense('a@b.fr', 'secret123');

    expect(res.token).toBe('tok');
    expect(res.edition).toBe('free');
    expect(netFetch).toHaveBeenCalledTimes(1);
    expect(globalFetch).not.toHaveBeenCalled();
    const [url, init] = netFetch.mock.calls[0] as [string, any];
    expect(url).toBe(`${LICENSE_API_URL}/auth/register.php`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ email: 'a@b.fr', password: 'secret123', displayName: undefined });
  });

  it('replie sur le fetch global si net.fetch est indisponible', async () => {
    const electron = await import('electron');
    const saved = (electron.net as any).fetch;
    (electron.net as any).fetch = undefined;
    globalFetch.mockResolvedValue(
      fakeResponse(200, { token: 'tok', edition: 'standard', email: 'a@b.fr' }),
    );

    try {
      const res = await loginWithLicense('a@b.fr', 'secret123');
      expect(res.edition).toBe('standard');
      expect(globalFetch).toHaveBeenCalledTimes(1);
    } finally {
      (electron.net as any).fetch = saved;
    }
  });

  it('HTTP 400 → code invalid_input avec le message du serveur', async () => {
    netFetch.mockResolvedValue(
      fakeResponse(400, {
        error: 'invalid_input',
        message: 'Email invalide ou mot de passe trop court (min 6)',
      }),
    );

    const err = await expectLicenseError(
      registerWithLicense('a@b.fr', '12345'),
      'invalid_input',
    );
    expect(err.message).toContain('6');
  });

  it('HTTP 401 → code invalid_credentials', async () => {
    netFetch.mockResolvedValue(fakeResponse(401, { error: 'invalid_credentials' }));

    await expectLicenseError(loginWithLicense('a@b.fr', 'mauvais'), 'invalid_credentials');
  });

  it('HTTP 409 (email déjà pris) → code email_taken', async () => {
    netFetch.mockResolvedValue(
      fakeResponse(409, { error: 'email_taken', message: 'Un compte existe déjà avec cet email' }),
    );

    await expectLicenseError(registerWithLicense('a@b.fr', 'secret123'), 'email_taken');
  });

  it('HTTP 500 → code server avec le message du serveur', async () => {
    netFetch.mockResolvedValue(
      fakeResponse(500, { error: 'server', message: 'Erreur serveur — table users absente' }),
    );

    const err = await expectLicenseError(registerWithLicense('a@b.fr', 'secret123'), 'server');
    expect(err.message).toContain('table users absente');
  });

  it('réponse non JSON (page d\'erreur de l\'hébergeur) → code server', async () => {
    netFetch.mockResolvedValue(fakeResponse(502, '<html>Bad Gateway</html>', false));

    const err = await expectLicenseError(registerWithLicense('a@b.fr', 'secret123'), 'server');
    expect(err.message).toContain('502');
  });

  it('panne réseau → code network', async () => {
    netFetch.mockRejectedValue(new TypeError('fetch failed'));

    await expectLicenseError(registerWithLicense('a@b.fr', 'secret123'), 'network');
  });

  it('checkout : 409 use_upgrade → bascule sur upgrade.php', async () => {
    netFetch
      .mockResolvedValueOnce(
        fakeResponse(409, { error: 'use_upgrade', upgrade_url: '/api/stripe/upgrade.php' }),
      )
      .mockResolvedValueOnce(fakeResponse(200, { url: 'https://checkout.stripe.com/upgrade' }));

    const url = await startCheckout('tok', 'full');

    expect(url).toBe('https://checkout.stripe.com/upgrade');
    expect(netFetch).toHaveBeenCalledTimes(2);
    expect((netFetch.mock.calls[1] as [string])[0]).toBe(`${LICENSE_API_URL}/stripe/upgrade.php`);
  });

  it('HTTP 429 → code rate_limited avec le message du serveur', async () => {
    netFetch.mockResolvedValue(
      fakeResponse(429, {
        error: 'rate_limited',
        message: 'Trop de tentatives. Réessayez dans quelques minutes.',
      }),
    );

    const err = await expectLicenseError(loginWithLicense('a@b.fr', 'mauvais'), 'rate_limited');
    expect(err.message).toContain('tentatives');
  });
});

describe('limites d\'édition', () => {
  it('les limites du serveur sont reprises (PHP_INT_MAX → Infinity)', async () => {
    netFetch.mockResolvedValue(
      fakeResponse(200, {
        token: 'tok',
        edition: 'full',
        email: 'a@b.fr',
        limits: { maxFixtures: 9223372036854775807, maxUniverses: 9223372036854775807 },
      }),
    );

    const res = await registerWithLicense('a@b.fr', 'secret123');

    expect(res.limits).toEqual({ maxFixtures: Infinity, maxUniverses: Infinity });
  });

  it('les limites du serveur sont reprises quand elles sont finies', async () => {
    netFetch.mockResolvedValue(
      fakeResponse(200, {
        token: 'tok',
        edition: 'standard',
        email: 'a@b.fr',
        limits: { maxFixtures: 9223372036854775807, maxUniverses: 1 },
      }),
    );

    const res = await loginWithLicense('a@b.fr', 'secret123');

    expect(res.limits).toEqual({ maxFixtures: Infinity, maxUniverses: 1 });
  });

  it('sans limites serveur, le client reste undefined (repli local)', async () => {
    netFetch.mockResolvedValue(
      fakeResponse(200, { token: 'tok', edition: 'free', email: 'a@b.fr' }),
    );

    const res = await registerWithLicense('a@b.fr', 'secret123');

    expect(res.limits).toBeUndefined();
  });

  it('les valeurs locales (miroir du serveur) sont inchangées', () => {
    expect(limitsForEdition('free')).toEqual({ maxFixtures: 1, maxUniverses: 1 });
    expect(limitsForEdition('standard')).toEqual({ maxFixtures: Infinity, maxUniverses: 1 });
    expect(limitsForEdition('full')).toEqual({ maxFixtures: Infinity, maxUniverses: Infinity });
  });
});
