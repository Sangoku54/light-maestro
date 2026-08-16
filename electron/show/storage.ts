// ─── Show Storage — Save/Load light shows
//
// QLC+ uses XML (.qxw), SoundSwitch uses proprietary format.
// We use JSON for readability and ease of editing, with SQLite for
// efficient scene/chaser indexing in large shows.

// Current schema version of the written .lmshow format.
// Files without the field are treated as v1 (backward compatible).
const SHOW_SCHEMA_VERSION = 1;

import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

// ─── Show Data Model ───────────────────────────────────────

export interface ShowScene {
  id: string;
  name: string;
  channels: Record<number, number>; // universe:channel → value mapping as "u.c": v
  duration: number;   // ms
  fadeIn: number;     // ms
  fadeOut: number;    // ms
  notes?: string;
  folder?: string;    // optional user classification folder (derived, no entity)
}

export interface ShowChaser {
  id: string;
  name: string;
  steps: ChaserStep[];
  direction: 'forward' | 'backward' | 'bounce' | 'random';
  runOrder: 'loop' | 'single' | 'pingpong';
  fadeIn: number;
  fadeOut: number;
  duration: number;   // per-step duration
  tempo: number;       // BPM for speed dial override
}

export interface ChaserStep {
  sceneId: string;
  duration: number;  // ms, 0 = use chaser default
  fadeIn: number;    // ms, 0 = use chaser default
  fadeOut: number;   // ms, 0 = use chaser default
  note?: string;
}

export interface ShowCue {
  id: string;
  name: string;
  sceneId: string;
  chaserId?: string;
  trigger: 'manual' | 'follow' | 'timecode' | 'beat';
  triggerValue?: number; // timecode in ms or beat count
  duration: number;
  fadeIn: number;
  fadeOut: number;
  preWait: number;
  postWait: number;
  notes?: string;
}

export interface ShowCueList {
  id: string;
  name: string;
  cues: ShowCue[];
  currentCueIndex: number;
  playback: 'manual' | 'auto';
}

export interface ShowRGBMatrix {
  id: string;
  name: string;
  pattern: 'solid' | 'line' | 'diamond' | 'circle' | 'square' | 'triangle' | 'text' | 'image' | 'audio';
  colors: number[][];
  width: number;
  height: number;
  direction: 'left' | 'right' | 'up' | 'down' | 'none';
  speed: number;     // Hz
  blendMode: 'default' | 'add' | 'mask' | 'subtract';
  audioParams?: {
    band: 'low' | 'mid' | 'high' | 'all';
    colorReactive: boolean;
    speedReactive: boolean;
  };
}

export interface ShowEffect {
  id: string;
  name: string;
  type: 'efx' | 'rgbmatrix' | 'script';
  // EFX params (QLC+ style)
  pattern?: 'line' | 'circle' | 'eight' | 'square' | 'triangle';
  width?: number;
  height?: number;
  xOffset?: number;
  yOffset?: number;
  rotation?: number;
  speed?: number;
  fixtures: string[]; // fixture instance IDs
}

export interface VirtualConsoleWidget {
  id: string;
  type: 'button' | 'slider' | 'knob' | 'xypad' | 'speedDial' | 'cueList' | 'frame' | 'label';
  x: number;
  y: number;
  width: number;
  height: number;
  properties: Record<string, any>;
  children?: VirtualConsoleWidget[]; // for frames
}

export interface VirtualConsolePage {
  name: string;
  widgets: VirtualConsoleWidget[];
}

export interface ShowData {
  id: string;
  name: string;
  version: string; // Light Maestro version
  created: string; // ISO date
  modified: string;
  /** Show file schema version — absent = v1 (legacy files are tolerated). */
  schemaVersion?: number;

  // Universe configuration
  universes: any[];

  // Fixtures (patched instances)
  fixtures: Array<{
    id: string;
    definitionId: string;
    modeIndex: number;
    startAddress: number;
    universe: number;
    name: string;
    position?: { x: number; y: number }; // 2D stage position
  }>;

  // Fixture groups
  groups: Array<{
    id: string;
    name: string;
    fixtureIds: string[];
    color?: string;
  }>;

  // Creative content
  scenes: ShowScene[];
  /** Explicit user-created scene folders (entities). Optional — legacy files
   *  without the field fall back to the folders derived from scene.folder. */
  sceneFolders?: string[];
  chasers: ShowChaser[];
  cueLists: ShowCueList[];
  rgbMatrices: ShowRGBMatrix[];
  effects: ShowEffect[];

  // Performance
  virtualConsole: VirtualConsolePage[];
  midiMapping: Record<string, any>;

  // AutoScript config
  autoscriptConfig: any;
}

// ─── Show Storage Manager ──────────────────────────────────

export class ShowStorage {
  private db: Database.Database | null = null;
  private recentShows: string[] = [];

  constructor() {
    // SQLite is used for indexing large shows, but the primary format is JSON
  }

  // ─── Save ────────────────────────────────────────────────

  save(show: ShowData, filePath?: string): string {
    show.modified = new Date().toISOString();
    show.schemaVersion = SHOW_SCHEMA_VERSION;

    const json = JSON.stringify(show, null, 2);
    const targetPath = filePath || this.getDefaultPath(show.name);

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });

    // Atomic write: temp file + rename, so a crash mid-write never leaves
    // a truncated/corrupted show file (rename is atomic on the same volume).
    const tmpPath = `${targetPath}.tmp`;
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, targetPath);

    this.addToRecent(targetPath);
    this.indexShow(show);

    return targetPath;
  }

  // ─── Load ────────────────────────────────────────────────

  load(filePath: string): ShowData {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Show file not found: ${filePath}`);
    }

    const json = fs.readFileSync(filePath, 'utf-8');
    const show = JSON.parse(json) as ShowData;

    // Schema versioning: files written before schemaVersion existed are v1.
    // Missing field is tolerated; unknown newer versions warn but still load.
    const schemaVersion = (show as any).schemaVersion ?? 1;
    if (schemaVersion > SHOW_SCHEMA_VERSION) {
      console.warn(
        `[ShowStorage] ${filePath}: schemaVersion ${schemaVersion} is newer than supported ${SHOW_SCHEMA_VERSION} — loading may be incomplete`
      );
    }

    this.addToRecent(filePath);

    return show;
  }

  // ─── Recent Shows ────────────────────────────────────────

  listRecent(): string[] {
    return this.recentShows.filter(p => fs.existsSync(p));
  }

  private addToRecent(filePath: string): void {
    this.recentShows = [
      filePath,
      ...this.recentShows.filter(p => p !== filePath),
    ].slice(0, 20);
  }

  // ─── Index (SQLite for fast search in large shows) ───────
  // NOTE: folder/sceneFolders are NOT indexed (classification is a renderer
  // concern, re-derived from scene.folder on load). An exported/imported
  // .lmscene carries each scene's `folder` string (raw JSON round-trip) but
  // never the declared sceneFolders list — imported scenes keep their folder
  // as a derived one, which the UI's declared ∪ derived union still shows.

  private indexShow(show: ShowData): void {
    try {
      if (!this.db) {
        const dbPath = path.join(this.getDataDir(), 'shows.db');
        this.db = new Database(dbPath);
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS scenes (
            id TEXT PRIMARY KEY,
            show_id TEXT,
            name TEXT,
            channel_count INTEGER
          );
          CREATE TABLE IF NOT EXISTS chasers (
            id TEXT PRIMARY KEY,
            show_id TEXT,
            name TEXT,
            step_count INTEGER
          );
          CREATE INDEX IF NOT EXISTS idx_scenes_show ON scenes(show_id);
          CREATE INDEX IF NOT EXISTS idx_chasers_show ON chasers(show_id);
        `);
      }

      const insertScene = this.db.prepare(
        'INSERT OR REPLACE INTO scenes (id, show_id, name, channel_count) VALUES (?, ?, ?, ?)'
      );
      const insertChaser = this.db.prepare(
        'INSERT OR REPLACE INTO chasers (id, show_id, name, step_count) VALUES (?, ?, ?, ?)'
      );

      const tx = this.db.transaction(() => {
        for (const scene of show.scenes || []) {
          insertScene.run(scene.id, show.id, scene.name, Object.keys(scene.channels || {}).length);
        }
        for (const chaser of show.chasers || []) {
          insertChaser.run(chaser.id, show.id, chaser.name, (chaser.steps || []).length);
        }
      });

      tx();
    } catch (e) {
      console.warn('Failed to index show:', e);
    }
  }

  // ─── Helpers ─────────────────────────────────────────────

  private getDefaultPath(name: string): string {
    return path.join(
      this.getDataDir(),
      'shows',
      `${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.lmshow`
    );
  }

  private getDataDir(): string {
    const { app } = require('electron');
    return app.getPath('userData');
  }

  // ─── Export Formats ──────────────────────────────────────

  /**
   * Export a single scene as a standalone file that can be shared.
   * Format: .lmscene (Light Maestro Scene)
   */
  exportScene(scene: ShowScene, filePath: string): void {
    fs.writeFileSync(filePath, JSON.stringify({
      format: 'lightmaestro/scene-v1',
      scene,
    }, null, 2));
  }

  /**
   * Import a scene into an existing show
   */
  importScene(filePath: string): ShowScene {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (data.format !== 'lightmaestro/scene-v1') {
      throw new Error('Invalid scene file format');
    }
    return data.scene;
  }
}
