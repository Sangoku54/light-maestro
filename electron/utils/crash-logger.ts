// electron/utils/crash-logger.ts
// Crash logging with file rotation (10 files max). Never throws.
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const LOG_DIR = path.join(app.getPath('userData'), 'logs');
const MAX_LOG_FILES = 10;

export interface CrashLogEntry {
  message: string;
  stack?: string;
  name?: string;
  exitCode?: number;
  reason?: string;
  [key: string]: unknown;
}

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function rotateLogs(): void {
  try {
    const files = fs.readdirSync(LOG_DIR)
      .filter(f => f.startsWith('crash-') && f.endsWith('.log'))
      .map(f => ({
        name: f,
        path: path.join(LOG_DIR, f),
        mtime: fs.statSync(path.join(LOG_DIR, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.mtime - a.mtime);

    for (let i = MAX_LOG_FILES; i < files.length; i++) {
      try { fs.unlinkSync(files[i].path); } catch { /* ignore */ }
    }
  } catch {
    // Rotation non critique
  }
}

export const crashLogger = {
  log(type: string, entry: CrashLogEntry): void {
    try {
      ensureLogDir();
      rotateLogs();

      const filename = `crash-${getTimestamp()}.log`;
      const filepath = path.join(LOG_DIR, filename);
      const timestamp = new Date().toISOString();

      const lines = [
        `========================================`,
        `Timestamp: ${timestamp}`,
        `Type: ${type}`,
        `Message: ${entry.message}`,
      ];

      if (entry.name) lines.push(`Error Name: ${entry.name}`);
      if (entry.stack) lines.push(`Stack:`, entry.stack);
      if (entry.exitCode !== undefined) lines.push(`Exit Code: ${entry.exitCode}`);
      if (entry.reason) lines.push(`Reason: ${entry.reason}`);

      for (const [key, value] of Object.entries(entry)) {
        if (!['type', 'message', 'stack', 'name', 'exitCode', 'reason'].includes(key)) {
          lines.push(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`);
        }
      }

      lines.push(`========================================`, '');

      fs.appendFileSync(filepath, lines.join('\n'), 'utf-8');
    } catch {
      // Le crash-logger ne doit jamais crasher l'app
    }
  },

  listLogs(): Array<{ filename: string; size: number; mtime: number }> {
    try {
      ensureLogDir();
      return fs.readdirSync(LOG_DIR)
        .filter(f => f.startsWith('crash-') && f.endsWith('.log'))
        .map(f => {
          const stat = fs.statSync(path.join(LOG_DIR, f));
          return { filename: f, size: stat.size, mtime: stat.mtime.getTime() };
        })
        .sort((a, b) => b.mtime - a.mtime);
    } catch {
      return [];
    }
  },

  readLog(filename: string): string | null {
    try {
      const filepath = path.join(LOG_DIR, filename);
      if (!filepath.startsWith(LOG_DIR)) return null; // Path traversal guard
      return fs.readFileSync(filepath, 'utf-8');
    } catch {
      return null;
    }
  },

  getLogDir(): string {
    return LOG_DIR;
  },
};
