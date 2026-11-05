// dmx-playback.ts : multiplicateur d'amplitude par tier + gate strobe build.
// CRLF-safe, zéro apostrophe dans les chaines.
const fs = require('fs');
const f = 'src/hooks/dmx-playback.ts';
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

// ── Gate strobe : ajoute build (strobe seulement en drop/chorus/build) ──
rep(
  'forcedStrobe !== undefined ? forcedStrobe : ((isDrop || isChorus) && active.strobe && pf.tier === \'primary\')',
  'forcedStrobe !== undefined ? forcedStrobe : ((isDrop || isChorus || sec === \'build\') && active.strobe && pf.tier === \'primary\')',
  'gate strobe + build',
);

// ── Amplitude : multiplicateur par tier (couches visuelles distinctes) ──
rep(
  mk([
    '              const amplitude = trackMovement',
    '                ? trackMovement.amplitude',
    '                : active.movementAmplitude !== undefined',
    '                  ? Math.min(128, Math.max(0, Math.round(active.movementAmplitude)))',
    '                  : pf.tier === \'primary\' ? 90 : pf.tier === \'secondary\' ? 70 : 40;',
  ]),
  mk([
    '              // Amplitude par tier : la cue fixe le nominal (primary = plein),',
    '              // les tiers suivent a 72 %/42 % -> couches visuelles distinctes.',
    '              const tierAmpMult = pf.tier === \'primary\' ? 1 : pf.tier === \'secondary\' ? 0.72 : 0.42;',
    '              const amplitude = trackMovement',
    '                ? trackMovement.amplitude',
    '                : active.movementAmplitude !== undefined',
    '                  ? Math.max(4, Math.min(128, Math.round(active.movementAmplitude * tierAmpMult)))',
    '                  : pf.tier === \'primary\' ? 90 : pf.tier === \'secondary\' ? 70 : 40;',
  ]),
  'amplitude par tier',
);

// ── Blend crossfade : meme multiplicateur sur la prochaine cue ──
rep(
  'nextCue.movementAmplitude!==undefined?Math.min(128,Math.max(0,Math.round(nextCue.movementAmplitude))):curAmp',
  'nextCue.movementAmplitude!==undefined?Math.max(4,Math.min(128,Math.round(nextCue.movementAmplitude*tierAmpMult))):curAmp',
  'blendAmp tier',
);

fs.writeFileSync(f, s, 'utf8');
console.log('FICHIER ECRIT,', n, 'remplacements');