/**
 * Test d'intégration end-to-end du parcours .lmproj autonome.
 * Simule le cycle complet : Export → Transport (nouvelle machine) → Import.
 * Exercice les vraies fonctions du renderer (externalizeProjectAudio, resolveProjectAudio)
 * et du main process (packProject, unpackProject).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { packProject, unpackProject } from '../../electron/project-envelope';
import {
  externalizeProjectAudio,
  resolveProjectAudio,
} from '../utils/project-audio';

const USER_DATA = path.join(
  process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
  'light-maestro',
);

// Récupère les vrais blobs audio du projet
function getRealAudioBlobs(): { key: string; raw: string }[] {
  const blobs: { key: string; raw: string }[] = [];
  if (!fs.existsSync(USER_DATA)) return blobs;
  for (const f of fs.readdirSync(USER_DATA)) {
    if (!f.startsWith('audio-') || !f.endsWith('.json')) continue;
    const key = f.replace('.json', '');
    try {
      const data = JSON.parse(fs.readFileSync(path.join(USER_DATA, f), 'utf-8'));
      if (typeof data.audioFileBase64 === 'string') {
        blobs.push({ key, raw: data.audioFileBase64 });
      }
    } catch { /* ignore corrupt files */ }
  }
  return blobs;
}

// Crée un preset "réaliste" avec audioFileBase64 (avant externalisation)
function makePresetWithAudio(audioB64: string) {
  return {
    id: 'preset-test-1',
    name: 'Chanson test',
    audioFileBase64: audioB64,
    color: '#ff0000',
  };
}

// Crée un show "réaliste" avec audio dans show ET tracks
function makeShowWithAudio(showAudioB64: string, trackAudioB64: string) {
  return {
    id: 'show-test-1',
    name: 'Show test',
    audioFileBase64: showAudioB64,
    tracks: [
      {
        id: 'track-1',
        name: 'Piste 1',
        items: [
          {
            id: 'item-1',
            type: 'clip',
            audioFileBase64: trackAudioB64,
          },
        ],
      },
    ],
  };
}

describe('E2E .lmproj autonome — cycle Export → Transport → Import', () => {
  let tmpDir: string;
  let realBlobs: { key: string; raw: string }[];
  let originalPreset: any;
  let originalShow: any;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lm-e2e-'));
    realBlobs = getRealAudioBlobs();
    // Si pas de vrais blobs (CI), on génère des données factices
    if (realBlobs.length === 0) {
      const fakeAudio = 'data:audio/mpeg;base64,' + 'A'.repeat(5000);
      realBlobs = [{ key: 'audio-fake-fake', raw: fakeAudio }];
    }
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('cycle complet : externalize → pack → transport → unpack → resolve — audio identique', async () => {
    // 1. Crée le projet avec audio en clair (format d'avant externalisation)
    const audioB64 = realBlobs[0].raw;
    originalPreset = makePresetWithAudio(audioB64);
    const showAudio = realBlobs.length > 1 ? realBlobs[1].raw : audioB64;
    originalShow = makeShowWithAudio(showAudio, audioB64);

    // 2. Externalise : audioFileBase64 → audioRef + blobs extraits
    const { presets: extPresets, shows: extShows, blobs } = await externalizeProjectAudio(
      [originalPreset],
      [originalShow],
    );
    expect(blobs.length).toBeGreaterThanOrEqual(1);
    expect(extPresets[0].audioRef).toBeTruthy();
    expect(extPresets[0].audioFileBase64).toBeUndefined();

    // 3. Pack : crée le .lmproj binaire (simule la sauvegarde)
    const lmprojPath = path.join(tmpDir, 'projet-test.lmproj');
    const projectContent = JSON.stringify(
      { schemaVersion: 1, presets: extPresets, shows: extShows },
    );
    await packProject(lmprojPath, projectContent, blobs);

    const stat = fs.statSync(lmprojPath);
    expect(stat.size).toBeGreaterThan(100);

    // 4. Transport : simule copie sur "nouvelle machine"
    //    On lit le .lmproj tel quel (pas de userData sur cette machine)
    const unpacked = await unpackProject(lmprojPath);
    expect(unpacked.content).toBe(projectContent);
    expect(unpacked.blobs.length).toBeGreaterThanOrEqual(1);

    // 5. Resolve : résout l'audio UNIQUEMENT depuis les blobs du fichier
    const fileBlobMap = new Map(
      unpacked.blobs.map((b) => [b.key, { audioFileBase64: b.audioFileBase64 }]),
    );
    const getFromFile = async (key: string) => fileBlobMap.get(key) ?? null;

    const resolved = await resolveProjectAudio(
      JSON.parse(unpacked.content).presets,
      JSON.parse(unpacked.content).shows,
      getFromFile,
    );

    // 6. Vérifications finales
    // L'enveloppe décode les data-URLs en base64 brut
    expect(resolved.presets[0].audioFileBase64).toBeTruthy();
    expect(resolved.presets[0].audioFileBase64!.length).toBeGreaterThan(100);

    expect(resolved.shows[0].audioFileBase64).toBeTruthy();
    expect(resolved.shows[0].audioFileBase64!.length).toBeGreaterThan(100);
    expect(resolved.shows[0].tracks[0].items[0].audioFileBase64).toBeTruthy();
    expect(resolved.shows[0].tracks[0].items[0].audioFileBase64!.length).toBeGreaterThan(100);

    // Vérifie que les données audio sont décodables en base64
    const decoded = Buffer.from(resolved.presets[0].audioFileBase64!, 'base64');
    expect(decoded.length).toBeGreaterThan(0);
    // Vérifie l'identité binaire : les octets décodés du fichier correspondent
    // exactement aux octets d'origine du blob (on extrait le base64 brut du data URL)
    const marker = ';base64,';
    const origB64 = audioB64.includes(marker) ? audioB64.slice(audioB64.indexOf(marker) + marker.length) : audioB64;
    const originalDecoded = Buffer.from(origB64, 'base64');
    expect(decoded.equals(originalDecoded)).toBe(true);
  });

  it('fallback storage : si les blobs du fichier sont absents, résout via get() externe', async () => {
    const audioB64 = realBlobs[0].raw;
    const preset = makePresetWithAudio(audioB64);
    const { presets: extPresets, blobs } = await externalizeProjectAudio([preset], []);

    const lmprojPath = path.join(tmpDir, 'fallback-test.lmproj');
    const content = JSON.stringify({ presets: extPresets });
    // Pack SANS les blobs (simule un .lmproj corrompu ou partiel)
    await packProject(lmprojPath, content, []);

    const unpacked = await unpackProject(lmprojPath);
    const fileBlobMap = new Map(
      unpacked.blobs.map((b) => [b.key, { audioFileBase64: b.audioFileBase64 }]),
    );

    // Le get externe fournit les blobs (simule le fallback userData)
    const storageBlobs = new Map(
      blobs.map((b) => [b.key, { audioFileBase64: b.audioFileBase64 }]),
    );
    const getWithFallback = async (key: string) =>
      fileBlobMap.get(key) ?? storageBlobs.get(key) ?? null;

    const resolved = await resolveProjectAudio(
      JSON.parse(unpacked.content).presets,
      [],
      getWithFallback,
    );
    expect(resolved.presets[0].audioFileBase64).toBeTruthy();
    expect(resolved.presets[0].audioFileBase64!.length).toBeGreaterThan(100);
  });
});