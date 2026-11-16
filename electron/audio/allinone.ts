/**
 * All-In-One structure analysis — main-process bridge (option B, offline).
 *
 * Light Maestro ne fait QUE piloter le script `scripts/allinone_import.py`
 * (qui appelle l'API publique du package open-source `all-in-one-infer`).
 * Aucun code du modèle n'est copié ici : détection du python disponible,
 * exécution du script sur un WAV temporaire, relecture du JSON produit.
 *
 * Coûts assumés et visibles côté UI : premier lancement = téléchargement
 * des poids (Go) + séparation Demucs lente sur CPU (minutes). D'où :
 * check() avant tout, progression relayée, cancel(), timeout long.
 */

import { spawn, execFile, type ChildProcess } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from 'electron';

export interface AllInOneCheckResult {
  ok: boolean;
  python?: string;
  detail: string;
}

export interface AllInOneAnalyzeResult {
  ok: boolean;
  /** Contenu brut du JSON `light-maestro-structure-v1` (parsé côté renderer). */
  json?: string;
  /** Vrai si le résultat vient du cache (instantané, aucun calcul). */
  cached?: boolean;
  error?: string;
}

interface AllInOneCacheEntry {
  hash: string;
  model: string;
  ts: number;
  fileName: string;
  payload: {
    duration?: number;
    bpm?: number;
    beats?: number[];
    beat_positions?: number[];
    downbeats?: number[];
    segments?: { start: number; end: number; label: string }[];
  };
}

const CACHE_MAX_ENTRIES = 100;

function cacheFilePath(): string {
  return path.join(app.getPath('userData'), 'allinone-cache.json');
}

function loadCache(): AllInOneCacheEntry[] {
  try {
    const raw = fs.readFileSync(cacheFilePath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCache(entries: AllInOneCacheEntry[]): void {
  try {
    fs.writeFileSync(cacheFilePath(), JSON.stringify(entries), 'utf-8');
  } catch {}
}

function getCached(hash: string, model: string): AllInOneCacheEntry | null {
  const entries = loadCache();
  return entries.find((e) => e.hash === hash && e.model === model) ?? null;
}

function putCache(entry: AllInOneCacheEntry): void {
  const entries = loadCache().filter((e) => !(e.hash === entry.hash && e.model === entry.model));
  entries.unshift(entry);
  saveCache(entries.slice(0, CACHE_MAX_ENTRIES));
}

const CHECK_TTL_MS = 5 * 60 * 1000;
const ANALYZE_TIMEOUT_MS = 30 * 60 * 1000;

let cachedCheck: { at: number; result: AllInOneCheckResult } | null = null;
let currentChild: ChildProcess | null = null;

/** Candidats python selon la plateforme (`py` d'abord sur Windows). */
function pythonCandidates(): string[] {
  return process.platform === 'win32' ? ['py', 'python'] : ['python3', 'python'];
}

/** Localise scripts/allinone_import.py en dev comme en packaged. */
export function resolveAllInOneScript(): string | null {
  const candidates = [
    path.join(app.getAppPath(), 'scripts', 'allinone_import.py'),
    path.join(process.resourcesPath, 'app', 'scripts', 'allinone_import.py'),
    path.join(process.cwd(), 'scripts', 'allinone_import.py'),
  ];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch {}
  }
  return null;
}

function runProbe(python: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Importer torch prend des secondes : timeout large, pas d'échec silencieux.
    execFile(python, ['-c', 'import allin1_infer; print("ok")'], { timeout: 90000 }, (err, stdout) => {
      resolve(!err && String(stdout).includes('ok'));
    });
  });
}

/** Vérifie python + package (résultat caché 5 min). */
export async function checkAllInOne(): Promise<AllInOneCheckResult> {
  if (cachedCheck && Date.now() - cachedCheck.at < CHECK_TTL_MS) return cachedCheck.result;
  const script = resolveAllInOneScript();
  if (!script) {
    const result: AllInOneCheckResult = { ok: false, detail: 'Script allinone_import.py introuvable dans l\'installation.' };
    cachedCheck = { at: Date.now(), result };
    return result;
  }
  for (const python of pythonCandidates()) {
    try {
      // eslint-disable-next-line no-await-in-loop
      if (await runProbe(python)) {
        const result: AllInOneCheckResult = { ok: true, python, detail: `OK (${python} + all-in-one-infer)` };
        cachedCheck = { at: Date.now(), result };
        return result;
      }
    } catch {}
  }
  const result: AllInOneCheckResult = {
    ok: false,
    detail: 'Python ou package manquant. Installe : Python 3.9+ (PATH coché) puis `pip install all-in-one-infer`.',
  };
  cachedCheck = { at: Date.now(), result };
  return result;
}

export function cancelAllInOne(): boolean {
  if (currentChild && !currentChild.killed) {
    try { currentChild.kill(); } catch {}
    currentChild = null;
    return true;
  }
  return false;
}

export async function analyzeAllInOne(
  wavBase64: string,
  fileName: string,
  onProgress: (msg: string) => void,
  opts?: { model?: string; device?: string },
): Promise<AllInOneAnalyzeResult> {
  const check = await checkAllInOne();
  if (!check.ok || !check.python) return { ok: false, error: check.detail };
  const script = resolveAllInOneScript();
  if (!script) return { ok: false, error: 'Script allinone_import.py introuvable.' };

  const model = opts?.model || 'harmonix-all';
  let wavBuffer: Buffer;
  try {
    wavBuffer = Buffer.from(wavBase64, 'base64');
  } catch (e: any) {
    return { ok: false, error: `WAV invalide : ${e?.message || e}` };
  }

  // Cache par empreinte du WAV + modèle : rechargement instantané, même sans preset sauvé.
  const hash = crypto.createHash('sha256').update(wavBuffer).digest('hex');
  const hit = getCached(hash, model);
  if (hit) {
    return {
      ok: true,
      cached: true,
      json: JSON.stringify({
        format: 'light-maestro-structure-v1',
        source: { tool: 'all-in-one-infer', model, cached: true },
        audio: hit.fileName,
        ...hit.payload,
      }),
    };
  }

  const dir = path.join(os.tmpdir(), 'light-maestro-allinone');
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  const safe = (fileName || 'audio.wav').replace(/[^a-zA-Z0-9_\-. ]/g, '_');
  const wavPath = path.join(dir, `in-${Date.now()}-${safe.replace(/\.[^.]+$/, '') || 'audio'}.wav`);
  const outPath = wavPath.replace(/\.wav$/, '.structure.json');
  try {
    fs.writeFileSync(wavPath, wavBuffer);
  } catch (e: any) {
    return { ok: false, error: `Écriture WAV temporaire impossible : ${e?.message || e}` };
  }

  const args = [script, wavPath, '--out', outPath, '--model', model];
  if (opts?.device) args.push('--device', opts.device);

  return new Promise((resolve) => {
    let tail = '';
    let done = false;
    const finish = (r: AllInOneAnalyzeResult) => {
      if (done) return;
      done = true;
      try { fs.unlinkSync(wavPath); } catch {}
      currentChild = null;
      resolve(r);
    };
    let child: ChildProcess;
    try {
      child = spawn(check.python as string, args, { windowsHide: true });
    } catch (e: any) {
      try { fs.unlinkSync(wavPath); } catch {}
      resolve({ ok: false, error: `Lancement python impossible : ${e?.message || e}` });
      return;
    }
    currentChild = child;
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish({ ok: false, error: 'Analyse IA : délai dépassé (30 min). Modèles lourds sur CPU lent ?' });
    }, ANALYZE_TIMEOUT_MS);
    const onData = (chunk: any) => {
      const text = String(chunk);
      tail = (tail + text).slice(-2000);
      const line = text.trim().split(/\r?\n/).filter(Boolean).pop();
      if (line) onProgress(line.slice(0, 200));
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (e) => {
      clearTimeout(timer);
      finish({ ok: false, error: `Python introuvable au lancement : ${(e as any)?.message || e}` });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        finish({ ok: false, error: `Analyse IA échouée (code ${code}). Détail : ${tail.slice(-500) || '—'}` });
        return;
      }
      try {
        const json = fs.readFileSync(outPath, 'utf-8');
        try { fs.unlinkSync(outPath); } catch {}
        try {
          const parsed = JSON.parse(json) as AllInOneCacheEntry['payload'];
          putCache({ hash, model, ts: Date.now(), fileName: fileName || 'audio.wav', payload: parsed });
        } catch {}
        finish({ ok: true, json });
      } catch (e: any) {
        finish({ ok: false, error: `JSON résultat illisible : ${e?.message || e}` });
      }
    });
  });
}
