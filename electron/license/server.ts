/**
 * Licence — client d'activation en ligne (connexion compte email/mot de passe).
 *
 * Contrat HTTP du serveur (implémenté dans `site/api/`) :
 *
 *   POST {LICENSE_API_URL}/auth/register.php
 *     body  : { email, password, displayName? }
 *     réponse 200 : { token, edition, email, displayName }
 *     réponse 409 : { error: 'email_taken' }
 *
 *   POST {LICENSE_API_URL}/auth/login.php
 *     body  : { email, password }
 *     réponse 200 : { token, edition, email, displayName, stripeCustomerId? }
 *     réponse 401 : { error: 'invalid_credentials' }
 *
 *   POST {LICENSE_API_URL}/auth/me.php
 *     header : Authorization: Bearer <token>
 *     réponse 200 : { edition, email, displayName, stripeCustomerId? }
 *
 *   POST {LICENSE_API_URL}/stripe/checkout.php
 *     header : Authorization: Bearer <token>
 *     body   : { edition: 'standard'|'full' }
 *     réponse 200 : { url }   (URL de checkout Stripe)
 *
 *  Tout autre code / erreur réseau => échec, l'app reste sur `free`.
 */

import type { LicenseEdition } from './types';
import { net } from 'electron';

/** URL du serveur de licence (backend PHP hébergé sur LWS). */
export const LICENSE_API_URL = 'https://light-maestro.com/api';

/** Mode de secours hors-ligne (démo/tests sans serveur). */
export const LICENSE_OFFLINE_MODE = false;

/** Édition simulée en mode hors-ligne (voir LICENSE_OFFLINE_MODE). */
const OFFLINE_EDITION: LicenseEdition = 'full';

/** Timeout des appels API (10 s) — sans ça, un firewall qui drop les paquets fait hanguer l'app indéfiniment. */
const FETCH_TIMEOUT_MS = 10_000;

export interface LicenseLoginResult {
  token: string | null;
  edition: LicenseEdition;
  email: string;
  displayName: string | null;
  stripeCustomerId?: string | null;
}

export class LicenseError extends Error {
  readonly code: 'email_taken' | 'invalid_credentials' | 'network' | 'server';
  constructor(code: LicenseError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

async function postJson(
  path: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  // net.fetch = pile réseau Chromium (même gestion SSL que le navigateur)
  // au lieu de fetch() Node.js/undici qui peut rejeter le certificat SSL
  // de l'hébergeur alors qu'un navigateur l'accepte.
  const res = await net.fetch(`${LICENSE_API_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      throw new LicenseError('invalid_credentials', data?.error || 'Identifiants invalides');
    }
    if (res.status === 409) {
      throw new LicenseError('email_taken', data?.message || 'Un compte existe déjà avec cet email');
    }
    throw new LicenseError('server', data?.message || data?.error || `Erreur serveur (${res.status})`);
  }
  return data;
}

/** Valide une réponse d'auth et en extrait l'édition de façon sûre. */
function parseEdition(raw: unknown): LicenseEdition {
  if (raw === 'standard' || raw === 'full') return raw;
  return 'free';
}

function toResult(data: any, email: string): LicenseLoginResult {
  return {
    token: typeof data.token === 'string' ? data.token : null,
    edition: parseEdition(data.edition),
    email: data.email || email,
    displayName: typeof data.displayName === 'string' ? data.displayName : null,
    stripeCustomerId: typeof data.stripeCustomerId === 'string' ? data.stripeCustomerId : null,
  };
}

/** Inscrit un nouveau compte (édition free), retourne la licence. */
export async function registerWithLicense(
  email: string,
  password: string,
  displayName?: string,
): Promise<LicenseLoginResult> {
  if (LICENSE_OFFLINE_MODE) {
    return {
      token: 'offline-demo-token',
      edition: OFFLINE_EDITION,
      email,
      displayName: displayName || email.replace(/@.*$/, ''),
      stripeCustomerId: null,
    };
  }
  try {
    const data = await postJson('/auth/register.php', { email, password, displayName });
    return toResult(data, email);
  } catch (e) {
    if (e instanceof LicenseError) throw e;
    throw new LicenseError('network', 'Serveur de licence injoignable');
  }
}

/**
 * Connecte le compte et retourne la licence validée.
 * En mode hors-ligne (démo), simule une connexion réussie vers `OFFLINE_EDITION`.
 */
export async function loginWithLicense(
  email: string,
  password: string,
): Promise<LicenseLoginResult> {
  if (LICENSE_OFFLINE_MODE) {
    if (!email || !password) throw new LicenseError('invalid_credentials', 'Champ requis');
    return {
      token: 'offline-demo-token',
      edition: OFFLINE_EDITION,
      email,
      displayName: email.replace(/@.*$/, ''),
      stripeCustomerId: null,
    };
  }

  try {
    const data = await postJson('/auth/login.php', { email, password });
    return toResult(data, email);
  } catch (e) {
    if (e instanceof LicenseError) throw e;
    throw new LicenseError('network', 'Serveur de licence injoignable');
  }
}

/** Rafraîchit l'état depuis un jeton existant (optionnel). */
export async function refreshLicense(token: string): Promise<LicenseLoginResult | null> {
  if (LICENSE_OFFLINE_MODE) return null;
  try {
    const data = await postJson('/auth/me.php', {}, token);
    return {
      ...toResult(data, ''),
      token,
    };
  } catch {
    return null;
  }
}

/**
 * Démarre un checkout Stripe pour une édition payante, retourne l'URL de
 * redirection (null si le mode hors-ligne ou si l'appel échoue).
 */
export async function startCheckout(
  token: string,
  edition: 'standard' | 'full',
): Promise<string | null> {
  if (LICENSE_OFFLINE_MODE) return null;
  try {
    console.log('[license:startCheckout] appel /stripe/checkout.php edition=', edition);
    const data = await postJson('/stripe/checkout.php', { edition }, token);
    console.log('[license:startCheckout] repondu', JSON.stringify(data));
    const url = typeof data.url === 'string' ? data.url : null;
    if (!url) {
      console.warn('[license:startCheckout] pas d\'URL dans la reponse', data);
    }
    return url;
  } catch (e: any) {
    // logger l'erreur complète pour debug
    console.error('[license:startCheckout] ERREUR détaillée:', {
      message: e?.message,
      code: e?.code,
      stack: e?.stack,
    });
    return null;
  }
}