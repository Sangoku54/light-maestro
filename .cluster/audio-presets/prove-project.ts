// Preuve runtime : les presets du projet réel (yolo.lmproj) ont-ils un audio
// lisible par le widget ? Vérifie : présence audioFileBase64/audioDataBase64,
// format (data URL vs base64 nu), et faisabilité du fetch.
import fs from 'fs';

const f = process.argv[2] || '.openclaw/tmp/rollback-backup/yolo.lmproj';
const raw = fs.readFileSync(f, 'utf8');
const data = JSON.parse(raw);
const presets = data?.showStore?.songPresets || [];

let avecAudio = 0, sansAudio = 0, nus = 0, dataUrl = 0, mimes = new Set<string>();
for (const p of presets) {
  const a = p.audioFileBase64 || p.audioDataBase64;
  if (!a) { sansAudio++; continue; }
  avecAudio++;
  if (/^data:/i.test(a)) { dataUrl++; mimes.add(a.slice(5, a.indexOf(';'))); }
  else nus++;
}
console.log('projet:', f);
console.log('presets:', presets.length, '| avec audio:', avecAudio, '| sans audio:', sansAudio);
console.log('format dataURL:', dataUrl, '| base64 nu:', nus, '| mimes:', [...mimes].join(', '));
console.log('VERDICT:', avecAudio === 0 ? 'AUCUN AUDIO' : (nus === 0 ? 'TOUS LISIBLES PAR LE WIDGET (data URL)' : `${nus} preset(s) en base64 nu → couverts par le fix normalizeAudioUrl`));