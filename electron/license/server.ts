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
 *   POST {LICENSE_API_URL}/auth/forgot-password.php
 *     body  : { email }
 *     réponse 200 : { ok: true }  (toujours, même si l'email est inconnu)
 *
 *   POST {LICENSE_API_URL}/auth/reset-password.php
 *     body  : { token, newPassword }
 *     réponse 200 : { ok: true }
 *     réponse 400 : { error: 'token_expired' | 'token_invalid' | 'invalid_input' }
 *
 *   POST {LICENSE_API_URL}/stripe/checkout.php
 *     header : Authorization: Bearer <token>
 *     body   : { edition: 'standard'|'full' }
 *     réponse 200 : { url }   (URL de checkout Stripe)
 *
 *  Tout autre code / erreur réseau => échec, l'app reste sur `free`.
 */

import { app, net } from 'electron';
import type { LicenseEdition, LicenseLimits } from './types';

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
  /** Limites fournies par le serveur (source de vérité) — undefined si absentes. */
  limits?: LicenseLimits;
}

export class LicenseError extends Error {
  readonly code:
    | 'email_taken'
    | 'invalid_credentials'
    | 'invalid_input'
    | 'network'
    | 'rate_limited'
    | 'server'
    /** Code de réinitialisation de mot de passe expiré. */
    | 'token_expired'
    /** Code de réinitialisation de mot de passe invalide / révoqué. */
    | 'token_invalid';
  constructor(code: LicenseError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Codes d'erreur 400 renvoyés par le serveur qui méritent un message
 * dédié (au lieu du « Données invalides » générique).
 */
const SPECIFIC_ERROR_CODES = new Set<LicenseError['code']>(['token_expired', 'token_invalid']);

/**
 * Attend que l'app Electron soit prête.
 * `net.fetch` (pile réseau Chromium) n'est utilisable qu'après le 'ready'.
 */
async function waitAppReady(): Promise<void> {
  try {
    if (app.isReady()) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3000);
      app.once('ready', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  } catch {
    /* contexte non-Electron : on continue */
  }
}

/**
 * Effectue l'appel HTTP avec la pile réseau Chromium (`net.fetch`).
 *
 * Pourquoi pas le `fetch` de Node/undici : celui-ci utilise son propre
 * magasin de certificats CA et ne voit pas les proxys/HTTPS-inspection du
 * système (antivirus, proxy d'entreprise), alors que Chromium s'appuie sur le
 * magasin Windows. Résultat observé : `fetch()` refusait le certificat SSL
 * de l'hébergeur alors que le navigateur (et `net.fetch`) l'acceptait →
 * toutes les appels API échouaient depuis l'exe (cf. commit d8003fa).
 */
async function httpFetch(url: string, init: RequestInit): Promise<Response> {
  await waitAppReady();
  if (typeof net !== 'undefined' && typeof net.fetch === 'function') {
    return net.fetch(url, init as any);
  }
  return fetch(url, init);
}

async function postJson(
  path: string,
  body: Record<string, unknown>,
  token?: string,
): Promise<any> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await httpFetch(`${LICENSE_API_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  let data: any = {};
  let parsed = false;
  try {
    data = await res.json();
    parsed = true;
  } catch {
    data = {};
  }
  if (!res.ok) {
    if (res.status === 400) {
      // Validation serveur (email / mot de passe) : message utile affiché à
      // l'utilisateur. Certains endpoints renvoient un code précis (ex. code
      // de réinitialisation expiré) : on le conserve pour un message dédié.
      const serverCode = typeof data?.error === 'string' ? data.error : '';
      const code = SPECIFIC_ERROR_CODES.has(serverCode as LicenseError['code'])
        ? (serverCode as LicenseError['code'])
        : 'invalid_input';
      throw new LicenseError(code, data?.message || 'Données invalides');
    }
    if (res.status === 429) {
      // Trop de tentatives d'authentification pour cette IP.
      throw new LicenseError('rate_limited', data?.message || 'Trop de tentatives. Réessayez dans quelques minutes.');
    }
    if (res.status === 401) {
      throw new LicenseError('invalid_credentials', data?.error || 'Identifiants invalides');
    }
    if (res.status === 409 && data?.error === 'use_upgrade') {
      // Cas spécial : l'user a déjà Standard et essaie d'acheter Full
      // → on retourne l'objet tel quel pour que le caller gère le redirect
      return data;
    }
    if (res.status === 409) {
      throw new LicenseError('email_taken', data?.message || 'Un compte existe déjà avec cet email');
    }
    throw new LicenseError('server', data?.message || data?.error || `Erreur serveur (${res.status}) sur ${path} token=${!!token ? 'present' : 'absent'}`);
  }
  // HTTP 200 mais corps non-JSON : le serveur a renvoyé une page d'erreur
  // (ex. erreur PHP affichée en HTML, qui renvoie malgré tout un 200).
  // Traiter cela comme un succès ferait croire, par exemple, qu'un email de
  // réinitialisation a été envoyé alors qu'aucun n'est parti.
  if (!parsed) {
    throw new LicenseError('server', `Réponse inattendue du serveur sur ${path} (HTTP ${res.status})`);
  }
  return data;
}

/** Valide une réponse d'auth et en extrait l'édition de façon sûre. */
function parseEdition(raw: unknown): LicenseEdition {
  if (raw === 'standard' || raw === 'full') return raw;
  return 'free';
}

/**
 * Convertit une limite PHP en nombre JS.
 * PHP envoie PHP_INT_MAX pour « illimité » → on le traduit par Infinity.
 */
function parseLimit(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  return raw >= 1e15 ? Infinity : raw;
}

/** Extrait les limites du serveur si elles sont exploitables. */
function parseLimits(raw: unknown): LicenseLimits | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const maxFixtures = parseLimit((raw as any).maxFixtures);
  const maxUniverses = parseLimit((raw as any).maxUniverses);
  if (maxFixtures === undefined || maxUniverses === undefined) return undefined;
  return { maxFixtures, maxUniverses };
}

function toResult(data: any, email: string): LicenseLoginResult {
  return {
    token: typeof data.token === 'string' ? data.token : null,
    edition: parseEdition(data.edition),
    email: data.email || email,
    displayName: typeof data.displayName === 'string' ? data.displayName : null,
    stripeCustomerId: typeof data.stripeCustomerId === 'string' ? data.stripeCustomerId : null,
    limits: parseLimits(data.limits),
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

/**
 * Demande un email de réinitialisation de mot de passe.
 *
 * Le serveur répond TOUJOURS 200 (même si l'adresse n'existe pas) pour ne
 * pas révéler quelles adresses sont enregistrées : le message de succès
 * affiché à l'utilisateur est donc volontairement neutre.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  if (LICENSE_OFFLINE_MODE) return;
  try {
    const data = await postJson('/auth/forgot-password.php', { email });
    // Le serveur répond 200 + { ok: true }. Un { ok: false } malgré le 200
    // signale un refus côté serveur : on ne doit pas annoncer un envoi.
    if (data && data.ok === false) {
      throw new LicenseError('server', data.message || 'Demande de réinitialisation refusée');
    }
  } catch (e) {
    if (e instanceof LicenseError) throw e;
    throw new LicenseError('network', 'Serveur de licence injoignable');
  }
}

/**
 * Applique un nouveau mot de passe à partir d'un code de réinitialisation
 * reçu par email.
 *
 * Le code vient soit du lien (page web de réinitialisation), soit du bloc
 * « code » présent dans l'email, à coller dans l'application.
 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  if (LICENSE_OFFLINE_MODE) return;
  try {
    await postJson('/auth/reset-password.php', { token, newPassword });
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
    // Cas use_upgrade : l'user a Standard, on appelle directement upgrade.php
    // (upgrade_url déjà préfixé par /api → on utilise le chemin /stripe/upgrade.php
    //  pour éviter le double préfixe avec LICENSE_API_URL)
    if (data && typeof data.upgrade_url === 'string') {
      console.log('[license:startCheckout] use_upgrade → appel /stripe/upgrade.php');
      const upgradeData = await postJson('/stripe/upgrade.php', { edition: 'full' }, token);
      console.log('[license:startCheckout] upgrade repondu', JSON.stringify(upgradeData));
      const url = typeof upgradeData?.url === 'string' ? upgradeData.url : null;
      return url;
    }
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
    throw e;
  }
}