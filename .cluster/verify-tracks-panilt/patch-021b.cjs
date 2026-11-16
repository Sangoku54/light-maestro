// Patch 1.0.21 - suite (edits non appliqués + réparation speedMult compute)
const fs = require('fs');
const F = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const W = (p, c) => fs.writeFileSync(p, c.replace(/\n/g, '\r\n'), 'utf8');
let edits = 0;
const rep = (p, oldS, newS) => {
  const c = F(p);
  if (!c.includes(oldS)) { console.error('MISS in ' + p + ':\n' + JSON.stringify(oldS.slice(0, 140))); process.exit(1); }
  if (c.split(oldS).length - 1 > 1) { console.error('AMBIGUOUS in ' + p + ' (count=' + (c.split(oldS).length - 1) + '): ' + JSON.stringify(oldS.slice(0, 90))); process.exit(1); }
  W(p, c.split(oldS).join(newS));
  edits++;
  console.log('OK ' + p + ' :: ' + oldS.slice(0, 52).replace(/\n/g, '\\n') + '...');
};

// 2b réparé : speedMult après trackMovement (indentation réelle = 8 espaces)
rep('src/hooks/dmx-playback.ts',
  '        const trackMovement = fixtureTrackOverrides?.forcedMovements?.get(pf.id);',
  '        const trackMovement = fixtureTrackOverrides?.forcedMovements?.get(pf.id);\n        const speedMult = trackMovement?.speed ?? (cue as any).movementSpeed ?? 1;');

// 3) snapshot crossfade : forcedMovements + chaserTakeover
rep('src/hooks/dmx-playback.ts',
  '      if(crossfadeT>0&&nextCue){\n        try{\n          nextCueDmx=computeDmxForCue(\n            nextCue,patchedFixturesRef.current,fixtureDefs,universes as any,tierMultipliers,undefined,\n            colorTrackColors,strobeOverridesEarly,undefined,disabledFixturesRef?.current,fixturePositions\n          );',
  '      if(crossfadeT>0&&nextCue){\n        try{\n          // Track takeover in crossfade snapshot: the blend must not mix autoscript\n          // movement into fixtures driven by user tracks (or a chaser).\n          const ftoSnap: { forcedMovements: Map<string, { pattern: string; amplitude: number }> } = { forcedMovements: new Map() };\n          if (fixtureTracksRef?.current && fixtureGroupsRef?.current) {\n            for (const ft of fixtureTracksRef.current) {\n              if (!ft.enabled) continue;\n              const targets = resolveTrackTargets(ft, patchedFixturesRef.current, fixtureGroupsRef.current);\n              if (targets.length === 0) continue;\n              for (const b of ft.movementBlocks) {\n                if (ct >= b.time && ct < b.endTime) {\n                  for (const fid of targets) ftoSnap.forcedMovements.set(fid, { pattern: b.pattern, amplitude: b.amplitude });\n                  break;\n                }\n              }\n            }\n          }\n          const choSnap = computeChaserTrackOverrides(\n            chaserTracksRef.current,\n            chasersRef.current,\n            scenesRef.current,\n            ct,\n            patchedFixturesRef.current,\n            fixtureGroupsRef?.current || [],\n          );\n          nextCueDmx=computeDmxForCue(\n            nextCue,patchedFixturesRef.current,fixtureDefs,universes as any,tierMultipliers,ftoSnap,\n            colorTrackColors,strobeOverridesEarly,undefined,disabledFixturesRef?.current,fixturePositions,choSnap\n          );');

// 6a) pattern pulse : tick
rep('src/hooks/dmx-playback.ts',
  "case'static':px=Math.sin(phase*.05+motorPhase)*.1;py=Math.cos(phase*.05+motorPhase)*.1;break;",
  "case'static':px=Math.sin(phase*.05+motorPhase)*.1;py=Math.cos(phase*.05+motorPhase)*.1;break;case'pulse':px=Math.sin(phase*.9+motorPhase)*.25;py=Math.abs(Math.sin(phase*1.8+motorPhase))*.85;break;");

// 6b) pattern pulse : compute
rep('src/hooks/dmx-playback.ts',
  "              case 'static': px = Math.sin(phase * .05 + motorPhase) * .1; py = Math.cos(phase * .05 + motorPhase) * .1; break;",
  "              case 'static': px = Math.sin(phase * .05 + motorPhase) * .1; py = Math.cos(phase * .05 + motorPhase) * .1; break;\n              case 'pulse': px = Math.sin(phase * .9 + motorPhase) * .25; py = Math.abs(Math.sin(phase * 1.8 + motorPhase)) * .85; break;");

// 2c) MovementBlock.speed
rep('src/hooks/fixture-tracks.ts',
  '  amplitude: number; // 0-255\n  endPattern?: string; // end pattern for gradient transition',
  '  amplitude: number; // 0-255\n  /** Vitesse du pattern (Hz). Absente = vitesse audio-reactive de l\'autoscript. */\n  speed?: number;\n  endSpeed?: number; // end speed for gradient ramp\n  endPattern?: string; // end pattern for gradient transition');

// 5) amplitude étalée sous 128 (QuickShowView)
rep('src/views/QuickShowView.tsx', "case 'intro': return 50 + rms * 80;", "case 'intro': return 50 + rms * 78;");
rep('src/views/QuickShowView.tsx', "case 'verse': return 80 + rms * 100;", "case 'verse': return 80 + rms * 48;");
rep('src/views/QuickShowView.tsx', "case 'chorus': return 110 + bassRatio * 110;", "case 'chorus': return 90 + bassRatio * 38;");
rep('src/views/QuickShowView.tsx', "case 'drop': return 140 + bassRatio * 110;", "case 'drop': return 100 + bassRatio * 28;");
rep('src/views/QuickShowView.tsx', "case 'bridge': return 60 + rms * 80;", "case 'bridge': return 60 + rms * 68;");
rep('src/views/QuickShowView.tsx', '? 160 + (1 - beatsUntilDrop / 2) * 80', '? 100 + (1 - beatsUntilDrop / 2) * 28');
rep('src/views/QuickShowView.tsx', ': 70 + sectionProgress * 160;', ': 60 + sectionProgress * 68;');

// 6c) pool build + pulse
rep('src/views/QuickShowView.tsx', "build:  ['sweep', 'figure8', 'spiral', 'circle'],", "build:  ['sweep', 'figure8', 'spiral', 'circle', 'pulse'],");

// 4) seed persistée : 3 points de sauvegarde + 2 points de chargement
rep('src/views/QuickShowView.tsx',
  '          dmxCues: dmxCuesArray,\n          quickShow: qs,',
  '          dmxCues: dmxCuesArray,\n          quickShow: { ...qs, regenSeed: key },');
rep('src/views/QuickShowView.tsx',
  '          analysis: resolvedAnalysis,\n          sections,\n          quickShow: qs,',
  '          analysis: resolvedAnalysis,\n          sections,\n          quickShow: { ...qs, regenSeed: key },');
rep('src/views/QuickShowView.tsx',
  'createdAt: new Date().toISOString(), quickShow: qs,',
  'createdAt: new Date().toISOString(), quickShow: { ...qs, regenSeed: key },');
rep('src/views/QuickShowView.tsx',
  '            createdAt: new Date().toISOString(),\n          }]);',
  '            createdAt: new Date().toISOString(),\n          }]);\n          setKey(Number(data.quickShow?.regenSeed) || 0);');
rep('src/views/QuickShowView.tsx',
  '    store.setSongPresets([...store.songPresets.filter(p => p.name !== presetName), newPreset]);\n    setPresetsDropdown(false);',
  '    store.setSongPresets([...store.songPresets.filter(p => p.name !== presetName), newPreset]);\n    setKey(Number(qsData?.regenSeed) || 0);\n    setPresetsDropdown(false);');

console.log('TOTAL EDITS: ' + edits);
