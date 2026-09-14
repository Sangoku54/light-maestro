/**
 * Licence — persistance et état courant (process main).
 *
 * Persiste la licence validée dans un fichier JSON sous le répertoire
 * `userData` de l'app (même convention que ShowStorage), pour garder
 * l'utilisateur connecté entre les sessions. Sans licence, on tombe sur `free`.
 *
 * Écriture atomique (fichier temporaire + rename) pour ne jamais corrompre la
 * licence en cas de crash.
 */

import fs from 'fs';
import path from 'path';
import type { LicenseEdition, LicenseState, LicenseLimits } from './types';
import { limitsForEdition } from './types';

interface PersistedLicense {
  edition: LicenseEdition;
  email: string | null;
  displayName: string | null;
  token: string | null;
  validAt: number | null;
}

const DEFAULTS: PersistedLicense = {
  edition: 'free',
  email: null,
  displayName: null,
  token: null,
  validAt: null,
};

function getUserDataDir(): string {
  // require() local : évite de dépendre de l'import statique d'electron au
  // chargement du module et reste compatible CommonJS (tsconfig.electron).
  const { app } = require('electron');
  return app.getPath('userData');
}

export class LicenseStore {
  private filePath: string;

  constructor() {
    this.filePath = path.join(getUserDataDir(), 'license.json');
  }

  private read(): PersistedLicense {
    try {
      if (!fs.existsSync(this.filePath)) return { ...DEFAULTS };
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      return { ...DEFAULTS, ...parsed };
    } catch {
      return { ...DEFAULTS };
    }
  }

  private write(data: PersistedLicense): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmp, this.filePath);
    } catch (e) {
      console.warn('[license] écriture impossible', e);
    }
  }

  /** Applique une licence validée (édition + identité du compte). */
  setLicense(input: {
    edition: LicenseEdition;
    email: string | null;
    displayName?: string | null;
    token?: string | null;
  }): void {
    const current = this.read();
    this.write({
      edition: input.edition,
      email: input.email,
      displayName: input.displayName ?? null,
      token: input.token ?? current.token,
      validAt: Date.now(),
    });
  }

  /** Réinitialise vers l'édition gratuite (déconnexion / licence invalide). */
  clear(): void {
    this.write({ ...DEFAULTS });
  }

  getEdition(): LicenseEdition {
    const e = this.read().edition;
    return e === 'standard' || e === 'full' ? e : 'free';
  }

  getToken(): string | null {
    return this.read().token ?? null;
  }

  getLimits(): LicenseLimits {
    return limitsForEdition(this.getEdition());
  }

  getState(): LicenseState {
    const edition = this.getEdition();
    const data = this.read();
    return {
      edition,
      email: data.email ?? null,
      displayName: data.displayName ?? null,
      licensed: edition !== 'free',
      limits: limitsForEdition(edition),
    };
  }
}