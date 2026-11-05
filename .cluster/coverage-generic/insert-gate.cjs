// Insère le bloc « gate couleur mono-canal » dans computeLaserChannels
// (dmx-playback.ts), après le bloc rgbOffsets, avant « // Vitesses ».
// CRLF-safe : construit les marqueurs avec l'EOL réel du fichier.
const fs = require('fs');
const f = 'src/hooks/dmx-playback.ts';
let s = fs.readFileSync(f, 'utf8');
const crlf = (s.match(/\r\n/g) || []).length;
const lf = (s.match(/(?<!\r)\n/g) || []).length;
const nl = crlf >= lf ? '\r\n' : '\n';
const mk = (lines) => lines.join(nl);

const marker = mk([
  "    if (fa.rgbOffsets[0] !== undefined) chVals[pf.startAddress + fa.rgbOffsets[0]] = rr;",
  "    if (fa.rgbOffsets[1] !== undefined) chVals[pf.startAddress + fa.rgbOffsets[1]] = gg;",
  "    if (fa.rgbOffsets[2] !== undefined) chVals[pf.startAddress + fa.rgbOffsets[2]] = bb;",
  "  }",
  "  // Vitesses + rotations :",
]);
const gate = mk([
  "    if (fa.rgbOffsets[0] !== undefined) chVals[pf.startAddress + fa.rgbOffsets[0]] = rr;",
  "    if (fa.rgbOffsets[1] !== undefined) chVals[pf.startAddress + fa.rgbOffsets[1]] = gg;",
  "    if (fa.rgbOffsets[2] !== undefined) chVals[pf.startAddress + fa.rgbOffsets[2]] = bb;",
  "  }",
  "  // Gate couleur mono-canal (caps « Red laser / Green laser / … », ex.",
  "  // Showtec Dominator) : ouvrir sur la couleur de la palette, sinon première",
  "  // couleur non-blackout. Le bloc n'est appelé que si le laser est ouvert.",
  "  if (fa.laserColorMode === 'gate' && fa.laserColorGateOffset !== null && chVals[pf.startAddress + fa.laserColorGateOffset] === undefined) {",
  "    const colorCaps = fa.laserColorGateCaps.filter((c) =>",
  "      /(red|green|blue|amber|cyan|magenta|yellow|white)/i.test(c.name ?? '') && !/blackout|off|closed|none/i.test(c.name ?? ''),",
  "    );",
  "    let target: DmxFixtureCapability | undefined;",
  "    if (paletteColor) {",
  "      const [rr, gg, bb] = hexToRgb(paletteColor);",
  "      target = colorCaps.find((c) => (rr > 122 && /red/i.test(c.name!)) || (gg > 122 && /green/i.test(c.name!)) || (bb > 122 && /blue/i.test(c.name!))) ?? colorCaps[0];",
  "    } else {",
  "      target = colorCaps[0];",
  "    }",
  "    if (target) chVals[pf.startAddress + fa.laserColorGateOffset] = capMid(target);",
  "  }",
  "  // Vitesses + rotations :",
]);
if (!s.includes(marker)) {
  console.error('MARQUEUR INTROUVABLE — fichier déjà modifié ?');
  process.exit(1);
}
s = s.replace(marker, gate);
fs.writeFileSync(f, s, 'utf8');
console.log('OK gate insérée (EOL=' + (crlf >= lf ? 'CRLF' : 'LF') + ')');