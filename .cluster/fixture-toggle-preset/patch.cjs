// Patch : disabledFixtures persisté dans les presets (SongPreset) — CRLF-safe
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

// ─── showStore.ts : type SongPreset ───
patchFile('src/stores/showStore.ts', [
  [/chaserTracks\?: any\[\];\r?\n(\s*)createdAt: string;/, 'chaserTracks?: any[];\n$1disabledFixtures?: string[];\n$1createdAt: string;', 'SongPreset type'],
]);

// ─── QuickShowView.tsx ───
patchFile('src/views/QuickShowView.tsx', [
  // 1. clearAudio → toutes fixtures réactivées
  ['// Reset audio file + analysis', 'setDisabledFixtures(new Set());\r\n    // Reset audio file + analysis', 'clearAudio reset'],
  // 2. load preset → restaure OU reset (nouveau preset = tout activé)
  ['if (chaserTracksPreset) setChaserTracks(chaserTracksPreset);', 'if (chaserTracksPreset) setChaserTracks(chaserTracksPreset);\r\n    const disabledFixturesData = preset?.data?.disabledFixtures || preset?.disabledFixtures;\r\n    setDisabledFixtures(disabledFixturesData ? new Set(disabledFixturesData) : new Set());', 'load preset'],
  // 3. save preset → persiste
  ['manualCues: manualCuesData || [],', 'manualCues: manualCuesData || [],\r\n      disabledFixtures: [...disabledFixtures],', 'save preset'],
  // 4. export .lmpreset → persiste
  ['dmxCues: dmxCuesArray, audioDataBase64 };', 'dmxCues: dmxCuesArray, disabledFixtures: [...disabledFixtures], audioDataBase64 };', 'export preset'],
  // 5. import .lmpreset → restaure OU reset
  ['if (data.fixtureTracks) setFixtureTracks(data.fixtureTracks);', 'if (data.fixtureTracks) setFixtureTracks(data.fixtureTracks);\r\n          if (data.disabledFixtures) setDisabledFixtures(new Set(data.disabledFixtures)); else setDisabledFixtures(new Set());', 'import preset state'],
  // 6. import .lmpreset → SongPreset créé porte le champ
  ['manualCues: data.manualCues || [],', 'manualCues: data.manualCues || [],\r\n            disabledFixtures: data.disabledFixtures || [],', 'import preset SongPreset'],
  // 7. deps export
  ['chaserTracks, fixtureTracks, audioFile, effectiveBpm, key]);', 'chaserTracks, fixtureTracks, disabledFixtures, audioFile, effectiveBpm, key]);', 'deps export'],
  // 8. deps save
  ['[setQs, setSections, setManualCues, setEfxTracks, setFixtureTracks, audioFile, pushHistory]', '[setQs, setSections, setManualCues, setEfxTracks, setFixtureTracks, disabledFixtures, audioFile, pushHistory]', 'deps save'],
]);