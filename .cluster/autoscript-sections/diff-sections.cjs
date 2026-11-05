// Différenciation des sections - QuickShowView.tsx (genCues audio-reactive)
// CRLF-safe. ZERO apostrophe dans les chaines.
const fs = require('fs');
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
  mk(['    for (const section of sections) {']),
  mk([
    '    // --- Differenciation par section (palette, cycle, intensite, strobe) ---',
    '    // Identite visuelle propre a chaque type de section : les autres logiciels',
    '    // (SoundSwitch, ShowKontrol...) varient couleurs + energie + densite par',
    '    // section ; ici on fixe des palettes/cycles/boost dedies.',
    '    const DEFAULT_SECTION_PALETTES: Record<string, string[]> = {',
    "      intro:  ['#334155', '#475569', '#64748b', '#1e293b'],",
    "      verse:  ['#1e90ff', '#00ced1', '#4682b4', '#0ea5e9'],",
    "      chorus: ['#ff0064', '#ffc800', '#ff4500', '#ff8c00'],",
    "      bridge: ['#7b68ee', '#8a2be2', '#4b0082', '#a855f7'],",
    "      drop:   ['#ff0000', '#ff6600', '#ffff00', '#ff2d2d'],",
    "      outro:  ['#1e3a5f', '#223a5e', '#1a2744'],",
    "      build:  ['#ff8c00', '#ff4500', '#ff0064', '#ffaa00'],",
    '    };',
    '    const SECTION_CYCLE_MULT: Record<string, number> = { intro: 0.4, verse: 0.7, chorus: 1.4, bridge: 0.5, drop: 1.8, outro: 0.3, build: 1.0 };',
    '    const SECTION_INTENSITY_BOOST: Record<string, number> = { intro: 0.8, verse: 0.9, chorus: 1.1, drop: 1.3, outro: 0.7, bridge: 0.85, build: 1.05 };',
    '    const SECTION_STROBE_PROB: Record<string, number> = { drop: 0.9, chorus: 0.6, build: 0.35 };',
    '',
    '    for (const section of sections) {',
  ]),
  'constantes + ouverture boucle',
);

rep(
  mk(["      const sectionPal = (cfg.customPalette?.[section.type]?.length > 0) ? cfg.customPalette[section.type] : basePal;"]),
  mk([
    "      // Palette : override custom > palette auto par section > base palette.",
    "      // La palette par section ne sapplique que sur colorScheme auto (defaut) ;",
    "      // un schema choisi par l'utilisateur garde son identite sur toutes les sections.",
    "      const sectionPal = (cfg.customPalette?.[section.type]?.length > 0)",
    "        ? cfg.customPalette[section.type]",
    "        : (cfg.colorScheme === 'auto' && DEFAULT_SECTION_PALETTES[section.type])",
    "          ? DEFAULT_SECTION_PALETTES[section.type]",
    '          : basePal;',
  ]),
  'palette par section',
);

rep(
  mk(['        const rms = feat?.rms ?? 0.5;']),
  mk([
    '        const rms = feat?.rms ?? 0.5;',
    '        // Boost nominal par section : a mix egal, un drop atteint very-high',
    '        // bien plus tot qu un intro (seuils RMS decales).',
    '        const rmsInt = Math.min(1, rms * (SECTION_INTENSITY_BOOST[section.type] ?? 1));',
  ]),
  'rmsInt',
);
rep(
  mk([
    "        } else if (rms > 0.75) intensity = 'very-high';",
    "        else if (rms > 0.50) intensity = 'high';",
    "        else if (rms > 0.25) intensity = 'medium';",
    "        else if (rms > 0.10) intensity = 'low';",
  ]),
  mk([
    "        } else if (rmsInt > 0.75) intensity = 'very-high';",
    "        else if (rmsInt > 0.50) intensity = 'high';",
    "        else if (rmsInt > 0.25) intensity = 'medium';",
    "        else if (rmsInt > 0.10) intensity = 'low';",
  ]),
  'seuils intensite rmsInt',
);

rep(
  mk(['        const strobe = beatStrong && rms > 0.35;']),
  mk(["        const strobe = (section.type === 'drop' || section.type === 'chorus' || section.type === 'build') && beatStrong && rms > 0.35;"]),
  'strobe par section',
);

rep(
  mk(['        const colorCycleSpeed = 0.5 + centroid * 1.5 + rms * 2.0; // 0.5-4.0 cycles per section']),
  mk(['        const colorCycleSpeed = (0.5 + centroid * 1.5 + rms * 2.0) * (SECTION_CYCLE_MULT[section.type] ?? 1); // 0.5-4.0 x section']),
  'cycle speed par section',
);

rep(
  mk(['          strobeProbability: dropAnticipation ? 0 : beatStrong ? 0.8 : 0.15,']),
  mk(['          strobeProbability: dropAnticipation ? 0 : (SECTION_STROBE_PROB[section.type] ?? (beatStrong ? 0.8 : 0.15)),']),
  'strobeProbability par section',
);

fs.writeFileSync(f, s, 'utf8');
console.log('FICHIER ECRIT,', n, 'remplacements');