/**
 * Construit le projet démo embarqué à partir de `LM/Yolo.lmproj` +
 * `LM/Yolo.lmpreset` (audio) :
 *  - retire les 2 lasers (TONIO LASER RGB ALIEN, TONIO LASER 4W) + les 3
 *    scènes laser + les canaux DMX de leurs plages d'adressage ;
 *  - preset vitrine "Yolo" : données musicales du .lmproj (ids stables pour
 *    les tuiles) + audio embarqué depuis le .lmpreset (seule source portable) ;
 *  - page console « Démo » : bouton YOLO + 6 scènes + chaser + blackout ;
 *  - customFixtures sérialisées en vrai tableau (import compatible).
 *
 * Sortie : `resources/demo/Light-Maestro-Demo.lmproj` (embarqué dans l'exe,
 * bouton « Projet démo » de la TopBar).
 *
 * Usage : `node scripts/build-demo.mjs` (relancé à chaque refresh démo).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { unpackProject, packProject } from '../dist/electron/project-envelope.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const SRC = path.join(root, 'LM', 'Yolo.lmproj');
const PRESET_FILE = path.join(root, 'LM', 'Yolo.lmpreset');
const DEST = path.join(root, 'resources', 'demo', 'Light-Maestro-Demo.lmproj');

const LASER_DEF_IDS = new Set(['custom-tonio-laser-rgb-alien', 'custom-tonio-laser-4w']);
const KEEP_PRESET = 'Yolo';

/** Clé blob stable = même règle que `audioKeyOf` (src/utils/project-audio.ts). */
function audioKeyOfRaw(b64) {
  const clean = b64.includes(',') ? b64.slice(b64.indexOf(',') + 1) : b64;
  return 'audio-' + crypto.createHash('sha256').update(Buffer.from(clean, 'base64')).digest('hex').slice(0, 16);
}

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

// 4) Preset vitrine : données du .lmproj (ids stables) + audio du .lmpreset.
//    Le preset embarqué dans Yolo.lmproj n'a pas d'audio portable (référence
//    userData) ; le .lmpreset, lui, embarque le MP3 (13 Mo).
const keptPresets = (ss.songPresets ?? []).filter((p) => p.name === KEEP_PRESET);
if (keptPresets.length !== 1) throw new Error(`preset "${KEEP_PRESET}" introuvable`);
const preset = keptPresets[0];
const presetFileRaw = fs.readFileSync(PRESET_FILE, 'utf-8');
const presetFile = JSON.parse(presetFileRaw);
const presetFileData = Array.isArray(presetFile) ? (presetFile[0]?.data ?? presetFile[0]) : presetFile;
const fileAudio = presetFileData.audioDataBase64 || presetFileData.audioFileBase64 || '';
if (!fileAudio || fileAudio.length < 1000) throw new Error(`audio absent de ${PRESET_FILE}`);
const audioKey = audioKeyOfRaw(fileAudio);
preset.audioRef = audioKey;
delete preset.audioFileBase64;
preset.audioFileName = presetFileData.audioFileName || preset.audioFileName || 'Yolo.mp3';
ss.songPresets = keptPresets;
const keptBlobs = [{ key: audioKey, audioFileBase64: fileAudio }];
console.log(`- preset ${KEEP_PRESET} + audio ${(fileAudio.length / 1048576).toFixed(1)} Mo b64 (${audioKey})`);

// 5) Page console « Démo » : bouton YOLO + 6 scènes + chaser + blackout.
//    (Le .lmproj d'origine n'a que des tuiles playSong ; une vitrine avec une
//    seule tuile ne montre rien du pilotage manuel.)
const demoWidgets = [];
const sceneOrder = ['Wash 1 strobe', 'Wash 2 strobe', 'Wash 3 strobe', '6 arm strobe', '2 gobos Strobes', 'Thierry'];
const btn = (id, x, y, w, config) => ({
  id, type: 'button', x, y, width: w, height: 48, pageIndex: 0, config,
});
demoWidgets.push(btn('demo-play-yolo', 20, 20, 220, {
  actionType: 'playSong', color: '#ec4899', flashMode: 'toggle', label: 'YOLO',
  songId: preset.id, songName: preset.name, title: 'button',
}));
sceneOrder.forEach((name, i) => {
  const sc = (ss.scenes ?? []).find((s) => s.name === name);
  if (!sc) throw new Error(`scène démo manquante : ${name}`);
  demoWidgets.push(btn(`demo-scene-${i}`, 20 + (i % 3) * 120, 80 + Math.floor(i / 3) * 60, 100, {
    actionType: 'scene', color: '#a855f7', flashMode: 'toggle', sceneId: sc.id, label: name, title: 'button',
  }));
});
const chaser = (ss.chasers ?? [])[0];
if (!chaser) throw new Error('chaser démo manquant');
demoWidgets.push(btn('demo-chaser', 20, 200, 220, {
  actionType: 'chaser', color: '#22c55e', flashMode: 'toggle', chaserId: chaser.id, label: chaser.name, title: 'button',
}));
demoWidgets.push(btn('demo-blackout', 260, 200, 100, {
  actionType: 'blackout', color: '#ef4444', flashMode: 'toggle', label: 'Blackout', title: 'button',
}));
data.vcWidgets = demoWidgets;
data.vcPages = [{ name: 'Démo' }];
data.vcActivePage = 0;
console.log(`- tuiles démo : ${demoWidgets.length} (1 preset + 6 scènes + chaser + blackout)`);

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
