// Réparation chirurgicale du routing laser (fixture-analyzer.ts) :
//  - une seule paire de branches rotation (rotat\w*),
//  - gate couleur par caps insérée avant blank,
//  - branche blank restaurée.
const fs = require('fs');
const f = 'src/engine/fixture-analyzer.ts';
const lines = fs.readFileSync(f, 'utf8').split('\n');
// Les lignes 317-346 (index 316-345, 0-based) sont à remplacer.
const block = [
  "      } else if (/rotat\\w*[\\s_-]*(x|y|z)|\\b(x|y|z)[\\s_-]*(axis[\\s_-]*)?(rolling|spin|rotat\\w*)/i.test(chName)) {",
  "        fa.laserRotationOffsets.push(off);",
  "        matched = true;",
  "      } else if (/laser.*(rotat\\w*|rolling|spin)|(red|green|blue|white|amber|yellow|color).*(rotat\\w*|rolling|spin)|(rotat\\w*|rolling|spin).*laser/i.test(chName)) {",
  "        // Rotations à nom composé des lasers (Galaxian 3D : « Red Laser",
  "        // Rotation », Showtec « Rotating Laser ») : axes de rotation",
  "        // graphique, pas des speed génériques.",
  "        fa.laserRotationOffsets.push(off);",
  "        matched = true;",
  "      } else if (fa.laserColorGateOffset === null && hasLaserColorGateCaps(ch)) {",
  "        // Gate couleur mono-canal : caps « Red laser / Green laser / … »",
  "        // (Showtec Dominator ch « Laser ») — sélecteur pilotable, le bloc",
  "        // laser l'ouvre sur la palette.",
  "        fa.laserColorGateOffset = off;",
  "        fa.laserColorGateCaps = ch.capabilities ?? [];",
  "        fa.laserColorMode = 'gate';",
  "        matched = true;",
  "      } else if (/\\bblank/i.test(chName)) {",
  "        if (fa.blankOffset === null) fa.blankOffset = off;",
  "        matched = true;",
  "      } else if (/\\bpattern\\b/i.test(chName)) {",
  "        if (fa.patternOffset === null) { fa.patternOffset = off; fa.patternCaps = ch.capabilities ?? []; }",
  "        matched = true;",
  "      }",
];
const start = 316; // ligne 317 en 1-based
const end = 346;   // ligne 346 en 1-based (excluse)
const before = lines.slice(0, start);
const after = lines.slice(end);
const out = before.concat(block, after);
fs.writeFileSync(f, out.join('\n'), 'utf8');
console.log('OK block', start + 1, '->', end, 'remplacé par', block.length, 'lignes; total', out.length);