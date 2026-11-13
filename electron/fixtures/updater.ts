/**
 * OFL (Open Fixture Library) Updater
 *
 * Checks GitHub for new fixtures at startup and downloads them if available.
 * Runs non-blocking — the app loads with existing fixtures immediately.
 *
 * Design:
 * - Fetches latest commit SHA from GitHub API
 * - Compares with stored SHA in user data
 * - Downloads repo ZIP if newer, extracts only JSON fixtures
 * - Stores in userData/ofl-fixtures/, overrides bundled on next load
 * - Rate-limited to one check per hour
 */

import https from 'https';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { app } from 'electron';

// ─── Source OFL ────────────────────────────────────────────
// Dépôt canonique : OpenLightingProject/open-fixture-library (branche
// master, licence MIT). L'ancien dépôt `open-fixture-library/fixtures`
// n'existe plus (404) — d'où ces URLs absolues vérifiées.
const OFL_REPO = 'OpenLightingProject/open-fixture-library';
const OFL_BRANCH = 'master';
const OFL_ARCHIVE_URL = `https://github.com/${OFL_REPO}/archive/refs/heads/${OFL_BRANCH}.zip`;
const OFL_COMMITS_API = `https://api.github.com/repos/${OFL_REPO}/commits/${OFL_BRANCH}`;
// Racine dans le ZIP : open-fixture-library-master/fixtures/<fabricant>/<fixture>.json
const OFL_EXTRACT_TOP = 'open-fixture-library-master';

// ─── State ─────────────────────────────────────────────────

let updateStatus: {
  checking: boolean;
  lastCheck: number;
  lastSha: string;
  newCount: number;
  error?: string;
} = {
  checking: false,
  lastCheck: 0,
  lastSha: '',
  newCount: 0,
};

// ─── Paths ─────────────────────────────────────────────────

function getShaFilePath(): string {
  return path.join(app.getPath('userData'), 'ofl-last-sha.txt');
}

function getTimestampFilePath(): string {
  return path.join(app.getPath('userData'), 'ofl-last-check.txt');
}

function getOflFixturesDir(): string {
  return path.join(app.getPath('userData'), 'ofl-fixtures');
}

// ─── Public API ────────────────────────────────────────────

export function getUpdateStatus() {
  return { ...updateStatus };
}

/**
 * Check for fixture updates. Non-blocking, fire-and-forget.
 * Notifies the renderer via callback about status changes.
 */
export async function checkForFixtureUpdates(
  onStatusChange?: (status: typeof updateStatus) => void
): Promise<void> {
  if (updateStatus.checking) return; // Already checking

  // Rate limit: check at most once per hour
  const now = Date.now();
  if (now - updateStatus.lastCheck < 60 * 60 * 1000) {
    try {
      const ts = fs.readFileSync(getTimestampFilePath(), 'utf-8').trim();
      const lastCheck = parseInt(ts, 10);
      if (now - lastCheck < 60 * 60 * 1000) {
        return; // Within rate limit
      }
    } catch {
      // No timestamp file — proceed
    }
  }

  updateStatus.checking = true;
  updateStatus.error = undefined;
  notify(onStatusChange);

  try {
    // 1. Fetch latest commit SHA — if unreachable, silently skip (no error badge)
    const latestSha = await fetchLatestSha();
    if (!latestSha) {
      updateStatus.checking = false;
      updateStatus.newCount = 0;
      notify(onStatusChange);
      return;
    }

    // 2. Read stored SHA — first run initialises from bundled SHA
    let storedSha = '';
    try {
      storedSha = fs.readFileSync(getShaFilePath(), 'utf-8').trim();
    } catch {
      // First run: read the bundled SHA so we don't trigger a full download
      try {
        const bundledShaPath = path.join(app.getAppPath(), '..', 'resources', 'fixtures', 'ofl-commit-sha.txt');
        const altBundledPath = path.join(app.getAppPath(), 'resources', 'fixtures', 'ofl-commit-sha.txt');
        for (const p of [altBundledPath, bundledShaPath]) {
          if (fs.existsSync(p)) {
            storedSha = fs.readFileSync(p, 'utf-8').trim();
            break;
          }
        }
      } catch { /* no bundled SHA file */ }
    }

    // 3. Compare — skip if up to date
    if (storedSha === latestSha) {
      updateStatus.checking = false;
      updateStatus.lastCheck = now;
      updateStatus.lastSha = latestSha;
      updateStatus.newCount = 0;
      saveTimestamp(now);
      notify(onStatusChange);
      return;
    }

    // 4. Download the repo ZIP
    const zipPath = path.join(os.tmpdir(), `light-maestro-ofl-${Date.now()}.zip`);
    const extractDir = path.join(os.tmpdir(), `light-maestro-ofl-extract-${Date.now()}`);

    const downloaded = await downloadZip(OFL_ARCHIVE_URL, zipPath);

    if (!downloaded) {
      updateStatus.checking = false;
      updateStatus.error = 'Failed to download fixture update';
      notify(onStatusChange);
      return;
    }

    // 5. Extract ZIP
    const extracted = extractZip(zipPath, extractDir);
    cleanup(zipPath);

    if (!extracted) {
      updateStatus.checking = false;
      updateStatus.error = 'Failed to extract fixture update';
      notify(onStatusChange);
      return;
    }

    // 6. Copy only JSON fixture files to user data
    //    ZIP structure: open-fixture-library-master/fixtures/manufacturer/fixture.json
    const sourceDir = path.join(extractDir, OFL_EXTRACT_TOP, 'fixtures');
    const destDir = getOflFixturesDir();

    let newCount = 0;

    if (fs.existsSync(sourceDir)) {
      // Clear previous user OFL fixtures
      if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true });
      }

      const mfrDirs = fs.readdirSync(sourceDir, { withFileTypes: true })
        .filter(e => e.isDirectory());

      for (const mfrDir of mfrDirs) {
        const mfrSource = path.join(sourceDir, mfrDir.name);
        const files = fs.readdirSync(mfrSource, { withFileTypes: true })
          .filter(e => e.isFile() && e.name.endsWith('.json'));

        if (files.length === 0) continue;

        const mfrDest = path.join(destDir, mfrDir.name);
        fs.mkdirSync(mfrDest, { recursive: true });

        for (const file of files) {
          try {
            const src = path.join(mfrSource, file.name);
            const dest = path.join(mfrDest, file.name);
            fs.copyFileSync(src, dest);
            newCount++;
          } catch (e) {
            console.warn(`Failed to copy OFL fixture ${mfrDir.name}/${file.name}:`, e);
          }
        }
      }
    }

    // 7. Save state
    fs.writeFileSync(getShaFilePath(), latestSha, 'utf-8');
    saveTimestamp(now);

    updateStatus.checking = false;
    updateStatus.lastCheck = now;
    updateStatus.lastSha = latestSha;
    updateStatus.newCount = newCount;
    updateStatus.error = undefined;

    // Clean up extract dir
    cleanup(extractDir);

    notify(onStatusChange);
    console.log(`OFL update: ${newCount} fixtures downloaded (SHA: ${latestSha.slice(0, 7)})`);
  } catch (e: any) {
    updateStatus.checking = false;
    updateStatus.error = e?.message || 'Unknown error during fixture update check';
    notify(onStatusChange);
    console.warn('OFL update check failed:', e);
  }
}

// ─── Helpers ───────────────────────────────────────────────

function saveTimestamp(ts: number): void {
  try {
    fs.writeFileSync(getTimestampFilePath(), String(ts), 'utf-8');
  } catch {
    // Non-critical
  }
}

function notify(onStatusChange?: (status: typeof updateStatus) => void): void {
  if (onStatusChange) {
    onStatusChange({ ...updateStatus });
  }
}

function cleanup(fileOrDir: string): void {
  try {
    if (fs.existsSync(fileOrDir)) {
      fs.rmSync(fileOrDir, { recursive: true, force: true });
    }
  } catch {
    // Best effort
  }
}

// ─── Network ───────────────────────────────────────────────

function fetchLatestSha(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = https.get(
      OFL_COMMITS_API,
      {
        headers: {
          'User-Agent': 'LightMaestro-OFL-Updater/1.0',
          'Accept': 'application/vnd.github.v3+json',
        },
        timeout: 15000,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: string) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.sha || null);
          } catch {
            resolve(null);
          }
        });
      }
    );

    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

function downloadZip(url: string, destPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Chaque redirection RECRÉE le WriteStream : le réutiliser après un
    // close() faisait échouer l'écriture (« write after end ») → le badge
    // « Erreur de mise à jour » alors que GitHub répondait 302.
    const doRequest = (requestUrl: string, attempt: number) => {
      if (attempt > 5) { resolve(false); return; }
      const file = fs.createWriteStream(destPath);
      const cleanup = () => {
        try { file.close(); } catch { /* ok */ }
        try { fs.unlinkSync(destPath); } catch { /* ok */ }
      };
      const req = https.get(
        requestUrl,
        {
          headers: { 'User-Agent': 'LightMaestro-OFL-Updater/1.0' },
        },
        (res) => {
          // Follow redirects
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            const redirectUrl = res.headers.location;
            res.resume(); // vide la réponse pour libérer le socket
            cleanup();
            doRequest(redirectUrl, attempt + 1);
            return;
          }
          if (res.statusCode !== 200) {
            res.resume();
            cleanup();
            resolve(false);
            return;
          }
          res.pipe(file);
          file.on('finish', () => {
            try { file.close(); } catch { /* ok */ }
            resolve(true);
          });
          file.on('error', () => { cleanup(); resolve(false); });
        }
      ).on('error', () => {
        cleanup();
        resolve(false);
      });
      // Le ZIP de la bibliothèque de fixtures fait plusieurs dizaines de Mo :
      // 60 s suffisent sur une connexion normale, au-delà on abandonne.
      req.setTimeout(60000, () => {
        req.destroy();
        cleanup();
        resolve(false);
      });
    };

    doRequest(url, 0);
  });
}

// ─── ZIP Extraction (cross-platform, no extra deps) ────────

function extractZip(zipPath: string, destDir: string): boolean {
  try {
    fs.mkdirSync(destDir, { recursive: true });

    if (process.platform === 'win32') {
      // PowerShell Expand-Archive — single-quoted paths for literal interpretation
      const escapedZip = zipPath.replace(/'/g, "''");
      const escapedDest = destDir.replace(/'/g, "''");
      execSync(
        `powershell.exe -NoProfile -Command "Expand-Archive -LiteralPath '${escapedZip}' -DestinationPath '${escapedDest}' -Force"`,
        { stdio: 'pipe', timeout: 120000 }
      );
    } else {
      // Unix: use built-in unzip
      execSync(`unzip -o "${zipPath}" -d "${destDir}"`, {
        stdio: 'pipe',
        timeout: 120000,
      });
    }
    return true;
  } catch (e) {
    console.warn('ZIP extraction failed:', e);
    return false;
  }
}
