// Patch : disabledFixtures dans le chemin de sauvegarde IPC disque — CRLF-safe
const fs = require('fs');

function patchFile(f, transforms) {
  let s = fs.readFileSync(f, 'utf8');
  let n = 0;
  for (const [oldT, newT, label] of transforms) {
    if (oldT instanceof RegExp) {
      if (!oldT.test(s)) { console.error(f, ': introuvable (regex)', label); process.exit(1); }
      s = s.replace(oldT, newT);
    } else {
      if (!s.includes(oldT)) { console.error(f, ': introuvable', label); process.exit(1); }
      s = s.split(oldT).join(newT);
    }
    n++;
  }
  fs.writeFileSync(f, s, 'utf8');
  console.log(f, 'OK', n, 'edits');
}

patchFile('src/views/QuickShowView.tsx', [
  // songPreset du chemin disque (L2123-2124 : chaserTracks, suivi de createdAt: existing...)
  [/chaserTracks,\r?\n(\s*)createdAt: existing\?\.createdAt/, 'chaserTracks,\n$1disabledFixtures: [...disabledFixtures],\n$1createdAt: existing?.createdAt', 'disque songPreset'],
  // data du chemin disque (L2139-2140 : chaserTracks, suivi de };)
  [/chaserTracks,\r?\n(\s*)\};/, 'chaserTracks,\n$1disabledFixtures: [...disabledFixtures],\n$1};', 'disque data'],
]);