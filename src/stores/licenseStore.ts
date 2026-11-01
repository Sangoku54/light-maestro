/**
 * Licence — état côté renderer (miroir du state du process main).
 *
 * Charge l'état via IPC au démarrage et expose les limites + les actions de
 * connexion. `showStore` consulte ce store pour brider l'ajout de fixtures et
 * d'univers.
 *
 * NB : les types sont ré-déclarés ici (et non importés depuis `electron/`) car
 * le renderer et le process main sont compilés par des arbres TypeScript
 * distincts. Le contrat (champs) doit rester identique à celui de
 * `electron/license/types.ts`.
 */

import { create } from 'zustand';

export type LicenseEdition = 'free' | 'standard' | 'full';

export interface LicenseLimits {
  maxFixtures: number;
  maxUniverses: number;
}

export interface LicenseState {
  edition: LicenseEdition;
  email: string | null;
  displayName: string | null;
  licensed: boolean;
  limits: LicenseLimits;
}

interface LoginResponse {
  ok: boolean;
  code?: string;
  message?: string;
  state?: LicenseState;
}

interface CheckoutResponse {
  ok: boolean;
  code?: string;
  message?: string;
  url?: string;
}

interface LicenseApi {
  getState: () => Promise<LicenseState>;
  login: (email: string, password: string) => Promise<LoginResponse>;
  register: (email: string, password: string, displayName?: string) => Promise<LoginResponse>;
  checkout: (edition: 'standard' | 'full') => Promise<CheckoutResponse>;
  refresh: () => Promise<{ ok: boolean; state?: LicenseState }>;
  openUrl: (url: string) => Promise<{ ok: boolean }>;
  logout: () => Promise<{ ok: boolean; state?: LicenseState }>;
}

interface LicenseStoreState extends LicenseState {
  loading: boolean;
  loginError: string | null;
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<boolean>;
  register: (email: string, password: string) => Promise<boolean>;
  checkout: (edition: 'standard' | 'full') => Promise<string | null>;
  logout: () => Promise<void>;
}

function api(): LicenseApi | null {
  return (typeof window !== 'undefined' ? (window as any).lightMaestro?.license : null) as LicenseApi | null;
}

const DEFAULT_STATE: LicenseState = {
  edition: 'free',
  email: null,
  displayName: null,
  licensed: false,
  limits: { maxFixtures: 1, maxUniverses: 1 },
};

export const useLicenseStore = create<LicenseStoreState>((set) => ({
  ...DEFAULT_STATE,
  loading: true,
  loginError: null,

  refresh: async () => {
    const a = api();
    if (!a) { set({ ...DEFAULT_STATE, loading: false }); return; }
    try {
      // Revalidation serveur d'abord (capte un achat Stripe récent),
      // repli sur l'état local persisté si le pont ne l'expose pas encore.
      const r = typeof a.refresh === 'function' ? await a.refresh() : { ok: true, state: await a.getState() };
      const s = (r as any).state;
      if (s) set({ ...(s as LicenseState), loading: false, loginError: null });
      else set({ loading: false });
    } catch {
      set({ ...DEFAULT_STATE, loading: false });
    }
  },

  login: async (email, password) => {
    const a = api();
    if (!a) { set({ loginError: 'unavailable' }); return false; }
    try {
      const r = await a.login(email, password);
      if (r.ok && r.state) {
        set({ ...r.state, loginError: null });
        return true;
      }
      set({ loginError: (r as any).code || r.message || 'loginFailed' });
      return false;
    } catch {
      set({ loginError: 'network' });
      return false;
    }
  },

  register: async (email, password) => {
    const a = api();
    if (!a) { set({ loginError: 'unavailable' }); return false; }
    try {
      const r = await a.register(email, password);
      if (r.ok && r.state) {
        set({ ...r.state, loginError: null });
        return true;
      }
      set({ loginError: (r as any).code || r.message || 'registerFailed' });
      return false;
    } catch {
      set({ loginError: 'network' });
      return false;
    }
  },

  checkout: async (edition) => {
    const a = api();
    if (!a) {
      console.error('[license] API non dispo pour checkout');
      set({ loginError: 'unavailable' });
      return null;
    }
    try {
      console.log('[license] checkout edition=', edition);
      const r = await a.checkout(edition);
      console.log('[license] checkout response', JSON.stringify(r));
      if (!r.ok) {
        const err = (r as any)?.message || (r as any)?.error || 'checkoutFailed';
        console.error('[license] checkout non-ok', err);
        set({ loginError: err });
        return null;
      }
      const url = (r as any).url;
      if (!url) {
        console.error('[license] checkout sans url', r);
        set({ loginError: 'checkoutNoUrl' });
        return null;
      }
      // Convertir les chemins relatifs en URL absolue pour window.open
      const BASE = 'https://light-maestro.com';
      const fullUrl = /^https?:\/\//i.test(url) ? url : `${BASE}${url}`;
      // Essayer openUrl (main process → shell.openExternal)
      let opened = await a.openUrl(fullUrl).catch((e: any) => {
        console.error('[license] openUrl erreur', e);
        return null;
      });
      if (opened?.ok) {
        console.log('[license] openUrl ok', fullUrl);
      } else {
        // Fallback robuste : ouvrir dans le navigateur par défaut
        console.warn('[license] openUrl failed, using default browser');
        window.open(fullUrl, '_blank');
      }
      return fullUrl;
    } catch (e: any) {
      console.error('[license] checkout exception', e);
      const msg = e?.message || String(e);
      set({ loginError: 'network' });
      // Fallback même en cas d'erreur réseau : essayer d'ouvrir quand même
      try { window.open(`https://light-maestro.com/tarifs.html`, '_blank'); } catch {}
      return null;
    }
  },

  logout: async () => {
    const a = api();
    if (a) { await a.logout().catch(() => {}); }
    set({ ...DEFAULT_STATE, loginError: null });
  },
}));

/** Limites courantes (lecture directe, hors hook, pour showStore). */
export function getLicenseLimits(): LicenseLimits {
  return useLicenseStore.getState().limits;
}