// Densité par section : activeTiers dans genCues + extinction des tiers inactifs
// dans le tick dmx-playback. CRLF-safe, zéro apostrophe dans les chaines.
const fs = require('fs');

// ── 1. QuickShowView : constantes + champ activeTiers ──
{
  const f = 'src/views/QuickShowView.tsx';
  let s = fs.readFileSync(f, 'utf8');
  const crlf = (s.match(/\r\n/g) || []).length;
  const lf = (s.match(/(?<!\r)\n/g) || []).length;
  const nl = crlf >= lf ? '\r\n' : '\n';
  const mk = (l) => l.join(nl);
  let n = 0;
  function rep(oldT, newT, label) {
    if (!s.includes(oldT)) { console.error('INTROUVABLE:', label); process.exit(1); }
    s = s.replace(oldT, newT);
    n++;
    console.log('OK', label);
  }
  rep(
    mk(["    const SECTION_STROBE_PROB: Record<string, number> = { drop: 0.9, chorus: 0.6, build: 0.35 };"]),
    mk([
      "    const SECTION_STROBE_PROB: Record<string, number> = { drop: 0.9, chorus: 0.6, build: 0.35 };",
      "    // Densite par section : les tiers de fixtures actives (couches).",
      "    // Intro = rien que le primary -> le show respire ; drop = tout le monde.",
      "    const ACTIVE_TIERS: Record<string, string[]> = {",
      "      intro: ['primary'],",
      "      verse: ['primary', 'secondary'],",
      "      chorus: ['primary', 'secondary', 'tertiary'],",
      "      bridge: ['primary'],",
      "      build: ['primary', 'secondary'],",
      "      drop: ['primary', 'secondary', 'tertiary'],",
      "      outro: ['primary'],",
      "    };",
    ]),
    'ACTIVE_TIERS',
  );
  rep(
    mk(['          dimmerPulseOnBeat: section.type === \'drop\' || section.type === \'chorus\',']),
    mk([
      "          dimmerPulseOnBeat: section.type === 'drop' || section.type === 'chorus',",
      "          activeTiers: ACTIVE_TIERS[section.type],",
    ]),
    'champ activeTiers cue',
  );
  fs.writeFileSync(f, s, 'utf8');
  console.log('QuickShowView:', n, 'remplacements');
}

// ── 2. dmx-playback : extinction des tiers inactifs (après l'écriture dimmer) ──
{
  const f = 'src/hooks/dmx-playback.ts';
  let s = fs.readFileSync(f, 'utf8');
  const anchor = "if(fa.intensityOffset!==null){const addr=pf.startAddress+fa.intensityOffset;if(_dimmerTrackActive){chVals[addr]=dimmerVal;}else if(!chVals[addr]||dimmerVal>chVals[addr])chVals[addr]=dimmerVal;}";
  if (!s.includes(anchor)) { console.error('INTROUVABLE: anchor dimmer'); process.exit(1); }
  const densite = [
    anchor,
    '',
    '          // Densite par section (activeTiers) : les fixtures hors tiers actifs',
    '          // sont eteintes (dimmer 0 + shutter 0 + gates laser 0). Le show',
    '          // respire entre intro (primary seul) et drop (toutes les couches).',
    "          if (Array.isArray(active.activeTiers) && !active.activeTiers.includes(pf.tier)) {",
    "            if (fa.intensityOffset !== null) chVals[pf.startAddress + fa.intensityOffset] = 0;",
    "            if (fa.shutterOffset !== null) chVals[pf.startAddress + fa.shutterOffset] = 0;",
    "            if (fa.isLaser) {",
    "              if (fa.rgbOffsets) for (const o of fa.rgbOffsets) chVals[pf.startAddress + o] = 0;",
    "              if (fa.laserColorGateOffset !== null) chVals[pf.startAddress + fa.laserColorGateOffset] = 0;",
    "            }",
    "          }",
  ].join(s.includes('\r\n') ? '\r\n' : '\n');
  s = s.replace(anchor, densite);
  fs.writeFileSync(f, s, 'utf8');
  console.log('dmx-playback: densité insérée');
}