const fs = require('fs');
const p = 'src/hooks/dmx-playback.ts';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(/\r\n/g, '\n'); // normalise LF pour les ancres
const CRLF = true;

// 1) computeDmxForCue : remplacer le bloc inline par l'appel partagé.
const startCue = '      if (fa.isLaser) {\n        const laserT = cue.time;';
const endCue = '    }\n\n    // Chaser track takeover';
const iCue = s.indexOf(startCue);
const iEnd = s.indexOf(endCue, iCue);
if (iCue === -1 || iEnd === -1) { console.error('ANCHOR CUE NOT FOUND', iCue, iEnd); process.exit(1); }
const replacementCue = '      if (fa.isLaser) {\n        computeLaserChannels(fa, pf, chVals, cue.time, energy, paletteColor, {\n          blankWhenStrobe: (isDrop || isChorus) && !!cue.strobe,\n        });\n      }\n';
s = s.slice(0, iCue) + replacementCue + s.slice(iEnd);

// 2) Tick : remplacer le bloc inline par l'appel partagé.
const startTick = '          if (fa.isLaser) {\n            const laserT = ct;';
const iTick = s.indexOf(startTick);
const endTickMarker = '\n        }\n\n        // Chaser track takeover';
const iTickEnd = s.indexOf(endTickMarker, iTick);
if (iTick === -1 || iTickEnd === -1) { console.error('ANCHOR TICK NOT FOUND', iTick, iTickEnd); process.exit(1); }
const replacementTick = '          if (fa.isLaser) {\n            computeLaserChannels(fa, pf, chVals, ct, effectiveEnergy, paletteColor);\n          }\n';
s = s.slice(0, iTick) + replacementTick + s.slice(iTickEnd + '\n'.length);

fs.writeFileSync(p, s.replace(/\n/g, '\r\n')); // remet en CRLF
console.log('OK: inline laser blocks replaced by computeLaserChannels calls');
console.log('computeLaserChannels calls:', (s.match(/computeLaserChannels\(/g) || []).length);