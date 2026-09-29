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
      const s = await a.getState();
      set({ ...s, loading: false, loginError: null });
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
    if (!a) { set({ loginError: 'unavailable' }); return null; }
    try {
      const r = await a.checkout(edition);
      if (r.ok && r.url) {
        await a.openUrl(r.url).catch(() => {});
        return r.url;
      }
      set({ loginError: (r as any).code || r.message || 'checkoutFailed' });
      return null;
    } catch {
      set({ loginError: 'network' });
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