/**
 * Construit le projet démo embarqué à partir de `LM/Yolo.lmproj` :
 *  - retire les 2 lasers (TONIO LASER RGB ALIEN, TONIO LASER 4W) + les 3
 *    scènes laser + les canaux DMX de leurs plages d'adressage ;
 *  - ne garde que le preset "1-Waiting" (seul avec audio embarqué) + son blob ;
 *  - ne garde que la tuile console qui le lance ;
 *  - customFixtures sérialisées en vrai tableau (import compatible).
 *
 * Sortie : `resources/demo/Light-Maestro-Demo.lmproj` (embarqué dans l'exe,
 * bouton « Projet démo » de la TopBar).
 *
 * Usage : `node scripts/build-demo.mjs` (relancé à chaque refresh démo).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { unpackProject, packProject } from '../dist/electron/project-envelope.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const SRC = path.join(root, 'LM', 'Yolo.lmproj');
const DEST = path.join(root, 'resources', 'demo', 'Light-Maestro-Demo.lmproj');

const LASER_DEF_IDS = new Set(['custom-tonio-laser-rgb-alien', 'custom-tonio-laser-4w']);
const KEEP_PRESET = '1-Waiting';

const { content, blobs } = await unpackProject(SRC);
const data = JSON.parse(content);
const ss = data.showStore ?? {};

// 1) Fixtures : repérer les lasers (ids + plages d'adressage à purger)
const removedFixtureIds = new Set();
const removedRanges = [];
for (const f of ss.patchedFixtures ?? []) {
  if (LASER_DEF_IDS.has(f.fixtureDefId)) {
    removedFixtureIds.add(f.id);
    const start = Number(f.startAddress) || 1;
    const count = Number(f.channelCount) || 0;
    removedRanges.push([start, start + count - 1]);
    console.log(`- laser retiré : ${f.name} (${start}-${start + count - 1})`);
  }
}
const inRemovedRange = (addr) => removedRanges.some(([lo, hi]) => addr >= lo && addr <= hi);
ss.patchedFixtures = (ss.patchedFixtures ?? []).filter((f) => !removedFixtureIds.has(f.id));

// 2) Scènes : retire les laser-only + purge les canaux des plages laser
const removedSceneIds = new Set();
ss.scenes = (ss.scenes ?? []).filter((s) => {
  if (/laser/i.test(s.name ?? '')) {
    removedSceneIds.add(s.id);
    console.log(`- scène laser retirée : ${s.name}`);
    return false;
  }
  return true;
});
for (const s of ss.scenes ?? []) {
  if (!s.channels) continue;
  for (const addr of Object.keys(s.channels)) {
    if (inRemovedRange(Number(addr))) delete s.channels[addr];
  }
}

// 3) Références croisées : positions, groupes, effets, chasers, show
if (ss.fixturePositions) {
  for (const id of removedFixtureIds) delete ss.fixturePositions[id];
}
// Purge les positions orphelines (fixtures supprimées antérieurement,
// ex. Yolo contient déjà une position sans fixture).
{
  const keptIds = new Set((ss.patchedFixtures ?? []).map((f) => f.id));
  for (const id of Object.keys(ss.fixturePositions ?? {})) {
    if (!keptIds.has(id)) {
      delete ss.fixturePositions[id];
      console.log(`- position orpheline purgée : ${id}`);
    }
  }
}
for (const g of ss.fixtureGroups ?? []) {
  if (Array.isArray(g.fixtureIds)) g.fixtureIds = g.fixtureIds.filter((id) => !removedFixtureIds.has(id));
  if (Array.isArray(g.fixtures)) g.fixtures = g.fixtures.filter((id) => !removedFixtureIds.has(id));
}
for (const e of ss.effects ?? []) {
  if (Array.isArray(e.fixtureIds)) e.fixtureIds = e.fixtureIds.filter((id) => !removedFixtureIds.has(id));
  if (Array.isArray(e.fixtures)) e.fixtures = e.fixtures.filter((id) => !removedFixtureIds.has(id));
}
for (const c of ss.chasers ?? []) {
  if (Array.isArray(c.steps)) c.steps = c.steps.filter((st) => !removedSceneIds.has(st.sceneId));
}
for (const sh of ss.shows ?? []) {
  for (const t of sh.tracks ?? []) {
    if (Array.isArray(t.items)) t.items = t.items.filter((it) => !removedSceneIds.has(it.resourceId));
  }
}

// 4) Presets : seul 1-Waiting (audio embarqué) ; tuiles : son bouton
const keptPresets = (ss.songPresets ?? []).filter((p) => p.name === KEEP_PRESET);
if (keptPresets.length !== 1) throw new Error(`preset "${KEEP_PRESET}" introuvable`);
ss.songPresets = keptPresets;
const neededAudioRefs = new Set(
  keptPresets.map((p) => p.audioRef).filter((r) => typeof r === 'string' && r.length > 0),
);
const keptBlobs = (blobs ?? []).filter((b) => neededAudioRefs.has(b.key));
if (keptBlobs.length !== neededAudioRefs.size) {
  throw new Error(`blob audio manquant pour ${[...neededAudioRefs].join(',')}`);
}
data.vcWidgets = (data.vcWidgets ?? []).filter(
  (w) => w?.config?.actionType === 'playSong' && w.config?.songName === KEEP_PRESET,
);
console.log(`- tuiles gardées : ${data.vcWidgets.length}`);

// 5) customFixtures : tableau (format attendu par importCustomFixtureDefs),
//    sans les defs laser.
const defs = Object.values(data.customFixtures ?? {});
data.customFixtures = defs.filter((d) => !LASER_DEF_IDS.has(d?.id));
console.log(`- customFixtures : ${defs.length} → ${data.customFixtures.length}`);

data.timestamp = new Date().toISOString();

fs.mkdirSync(path.dirname(DEST), { recursive: true });
await packProject(DEST, JSON.stringify(data, null, 2), keptBlobs);
const size = fs.statSync(DEST).size;
console.log(`OK ${DEST} (${(size / 1048576).toFixed(1)} Mo)`);
