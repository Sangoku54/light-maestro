// Réinsère les branches scan X/Y dans le routing laser (fixture-analyzer.ts).
// Lignes actuelles 330..353 (1-based) remplacées par la chaîne complète :
// rotation axis → rotation composite → scan x/y axis → horizontal → vertical → gate → blank → pattern.
const fs = require('fs');
const f = 'src/engine/fixture-analyzer.ts';
const lines = fs.readFileSync(f, 'utf8').split('\n');
const q = String.fromCharCode(39); // '
const block = [
  '      } else if (/rotat\\w*[\\s_-]*(x|y|z)|\\b(x|y|z)[\\s_-]*(axis[\\s_-]*)?(rolling|spin|rotat\\w*)/i.test(chName)) {',
  '        fa.laserRotationOffsets.push(off);',
  '        matched = true;',
  '      } else if (/laser.*(rotat\\w*|rolling|spin)|(red|green|blue|white|amber|yellow|color).*(rotat\\w*|rolling|spin)|(rotat\\w*|rolling|spin).*laser/i.test(chName)) {',
  '        // Rotations à nom composé des lasers (Galaxian 3D : « Red Laser',
  '        // Rotation », Showtec « Rotating Laser ») : axes de rotation',
  '        // graphique, pas des speed génériques.',
  '        fa.laserRotationOffsets.push(off);',
  '        matched = true;',
  '      } else if (/^(x|y)[\\s_-]*(axis[\\s_-]*)?(moving|movement|position|angle)/i.test(chName)) {',
  '        // Axes à deux lettres des lasers OFL (IODA 400/600/1000, Twin Effect…) :',
  '        // « X/Y Axis Moving » sont des axes de balayage, pas des rotations.',
  '        if (chName[0].toLowerCase() === ' + q + 'x' + q + ' && fa.scanXOffset === null) fa.scanXOffset = off;',
  '        else if (chName[0].toLowerCase() === ' + q + 'y' + q + ' && fa.scanYOffset === null) fa.scanYOffset = off;',
  '        matched = true;',
  '      } else if (/horizontal.*(angle|movement|position)/i.test(chName)) {',
  '        if (fa.scanXOffset === null) fa.scanXOffset = off;',
  '        matched = true;',
  '      } else if (/vertical.*(angle|movement|position)/i.test(chName)) {',
  '        if (fa.scanYOffset === null) fa.scanYOffset = off;',
  '        matched = true;',
  '      } else if (fa.laserColorGateOffset === null && hasLaserColorGateCaps(ch)) {',
  '        // Gate couleur mono-canal : caps « Red laser / Green laser / … »',
  '        // (Showtec Dominator ch « Laser ») — sélecteur pilotable, le bloc',
  '        // laser l\'ouvre sur la palette.',
  '        fa.laserColorGateOffset = off;',
  '        fa.laserColorGateCaps = ch.capabilities ?? [];',
  '        fa.laserColorMode = ' + q + 'gate' + q + ';',
  '        matched = true;',
  '      } else if (/\\bblank/i.test(chName)) {',
  '        if (fa.blankOffset === null) fa.blankOffset = off;',
  '        matched = true;',
  '      } else if (/\\bpattern\\b/i.test(chName)) {',
  '        if (fa.patternOffset === null) { fa.patternOffset = off; fa.patternCaps = ch.capabilities ?? []; }',
  '        matched = true;',
  '      }',
];
// Vérification de la borne actuelle (doit être la branche rotation axis)
if (!lines[329].includes('rotat\\w*')) {
  console.error('BORNE 330 INATTENDUE:', lines[329]);
  process.exit(1);
}
const out = lines.slice(0, 329).concat(block, lines.slice(353));
fs.writeFileSync(f, out.join('\n'), 'utf8');
console.log('OK lignes 330..353 remplacées par', block.length, 'lignes');