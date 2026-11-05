// Patch 1.0.19 : transitions de section + FX par section — CRLF-safe
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

// ─────────── QuickShowView.tsx — genCues : fondu d'intensité entre sections ───────────
patchFile('src/views/QuickShowView.tsx', [
  [
    'let cueGlobalIdx = 0; // across all sections, guarantees palette[3] (green) is reached',
    'let cueGlobalIdx = 0; // across all sections, guarantees palette[3] (green) is reached\n' +
    '    // ── Transitions de section : fondu d\'intensité sur les 2 premiers beats ──\n' +
    '    // À un changement de section, le dimmer démarre à l\'intensité de la section\n' +
    '    // précédente et rejoint progressivement la cible (fini les snaps aux frontières).\n' +
    '    const INTENSITY_SCORE: Record<string, number> = { \'very-low\': 0.1, low: 0.25, medium: 0.5, high: 0.8, \'very-high\': 0.95 };\n' +
    '    const scoreToIntensity = (s: number): string =>\n' +
    '      s >= 0.875 ? \'very-high\' : s >= 0.65 ? \'high\' : s >= 0.375 ? \'medium\' : s >= 0.175 ? \'low\' : \'very-low\';\n' +
    '    let prevSectionIntensity: number | null = null;\n' +
    '    let lastSectionType = \'\';',
    'helpers transitions'],
  [
    'prevIntensity = intensity;',
    'prevIntensity = intensity;\n\n' +
    '        // Transition d\'intensité entre sections : fondu sur 2 beats (fade-in)\n' +
    '        // depuis l\'intensité de la fin de la section précédente.\n' +
    '        if (lastSectionType !== section.type) {\n' +
    '          prevSectionIntensity = INTENSITY_SCORE[prevIntensity] ?? 0.5;\n' +
    '          lastSectionType = section.type;\n' +
    '        }\n' +
    '        if (prevSectionIntensity !== null) {\n' +
    '          const fadeT = Math.min(1, (t - section.startTime) / (2 * interval));\n' +
    '          const targetScore = INTENSITY_SCORE[intensity] ?? 0.5;\n' +
    '          prevIntensity = scoreToIntensity(prevSectionIntensity + (targetScore - prevSectionIntensity) * fadeT);\n' +
    '        }',
    'fade intensité'],
]);

// ─────────── dmx-playback.ts — profils FX (gobo/zoom/frost) par section ───────────
const FXPROF = 'const _FXPROF: Record<string, [number, number, number, number]> = {\n' +
  '            intro: [0.4, 0.55, 0.75, 0.6], verse: [0.7, 0.5, 0.8, 0.3],\n' +
  '            chorus: [1.3, 0.35, 0.9, 0.1], bridge: [0.5, 0.6, 0.8, 0.7],\n' +
  '            drop: [2, 0.15, 0.7, 0], build: [1.6, 0.25, 0.85, 0.15],\n' +
  '            outro: [0.3, 0.6, 0.8, 0.5],\n' +
  '          };\n' +
  '          const _fxSec = ((active as any)?.section as string) || \'\';\n' +
  '          const _fxP = _FXPROF[_fxSec] || [1, 0.4, 0.85, 0.2];\n' +
  '          const fxPhase2 = fxPhase * _fxP[0];';

patchFile('src/hooks/dmx-playback.ts', [
  [
    'const fxPhase = ct * Math.PI * 2 * (active.movementSpeed ?? 1);',
    'const fxPhase = ct * Math.PI * 2 * (active.movementSpeed ?? 1);\n' +
    '          // FX (gobo/zoom/frost) modulés par section : profil optique propre à\n' +
    '          // chaque type (zoom serré en drop, frost diffus en bridge, gobo rapide\n' +
    '          // en drop/chorus, lent en intro/outro).\n' + FXPROF,
    'tick FXPROF'],
  ['const gi=Math.floor((fxPhase*0.5)%gc);', 'const gi=Math.floor((fxPhase2*0.5)%gc);', 'tick gobo'],
  ['chVals[pAddr]=Math.round(Math.max(0,Math.min(255,64+Math.sin(fxPhase*0.7)*128*fxEnergy)));', 'chVals[pAddr]=Math.round(Math.max(0,Math.min(255,64+Math.sin(fxPhase2*0.7)*128*fxEnergy)));', 'tick prism'],
  ['chVals[zAddr]=Math.round(64+Math.sin(fxPhase*0.4)*96*fxEnergy+64*fxEnergy);', 'chVals[zAddr]=Math.round(Math.max(0,Math.min(255,64+Math.sin(fxPhase2*0.4)*96*(_fxP[1]+(_fxP[2]-_fxP[1])*fxEnergy)+64*fxEnergy)));', 'tick zoom'],
  ['chVals[fAddr]=Math.round(Math.max(0,255-(fxEnergy*255)));', 'chVals[fAddr]=Math.round(Math.max(0,Math.min(255,(255-fxEnergy*255)*(1-_fxP[3])+_fxP[3]*200)));', 'tick frost'],
  ['chVals[iAddr]=Math.round(40+fxEnergy*200+Math.sin(fxPhase*0.5)*15*fxEnergy);', 'chVals[iAddr]=Math.round(40+fxEnergy*200+Math.sin(fxPhase2*0.5)*15*fxEnergy);', 'tick iris'],
  ['chVals[fcAddr]=Math.round(80+fxEnergy*120+Math.sin(fxPhase*0.3)*30);', 'chVals[fcAddr]=Math.round(80+fxEnergy*120+Math.sin(fxPhase2*0.3)*30);', 'tick focus'],
  // ── Bloc computeDmxForCue (même logique, style espacé) ──
  [
    'const fxPhase = cue.time * Math.PI * 2 * ((cue as any).movementSpeed ?? 1);',
    'const fxPhase = cue.time * Math.PI * 2 * ((cue as any).movementSpeed ?? 1);\n' +
    '      const _FXPROF: Record<string, [number, number, number, number]> = {\n' +
    '        intro: [0.4, 0.55, 0.75, 0.6], verse: [0.7, 0.5, 0.8, 0.3],\n' +
    '        chorus: [1.3, 0.35, 0.9, 0.1], bridge: [0.5, 0.6, 0.8, 0.7],\n' +
    '        drop: [2, 0.15, 0.7, 0], build: [1.6, 0.25, 0.85, 0.15],\n' +
    '        outro: [0.3, 0.6, 0.8, 0.5],\n' +
    '      };\n' +
    '      const _fxP = _FXPROF[sec] || [1, 0.4, 0.85, 0.2];\n' +
    '      const fxPhase2 = fxPhase * _fxP[0];',
    'compute FXPROF'],
  ['const goboIdx = Math.floor((fxPhase * 0.5) % goboCount);', 'const goboIdx = Math.floor((fxPhase2 * 0.5) % goboCount);', 'compute gobo'],
  ['chVals[pf.startAddress + fa.prismOffset] = Math.round(Math.max(0, Math.min(255, 64 + Math.sin(fxPhase * 0.7) * 128 * fxEnergy)));', 'chVals[pf.startAddress + fa.prismOffset] = Math.round(Math.max(0, Math.min(255, 64 + Math.sin(fxPhase2 * 0.7) * 128 * fxEnergy)));', 'compute prism'],
  ['chVals[pf.startAddress + fa.zoomOffset] = Math.round(64 + Math.sin(fxPhase * 0.4) * 96 * fxEnergy + 64 * fxEnergy);', 'chVals[pf.startAddress + fa.zoomOffset] = Math.round(Math.max(0, Math.min(255, 64 + Math.sin(fxPhase2 * 0.4) * 96 * (_fxP[1] + (_fxP[2] - _fxP[1]) * fxEnergy) + 64 * fxEnergy)));', 'compute zoom'],
  ['chVals[pf.startAddress + fa.frostOffset] = Math.round(Math.max(0, 255 - (fxEnergy * 255)));', 'chVals[pf.startAddress + fa.frostOffset] = Math.round(Math.max(0, Math.min(255, (255 - fxEnergy * 255) * (1 - _fxP[3]) + _fxP[3] * 200)));', 'compute frost'],
  ['chVals[pf.startAddress + fa.irisOffset] = Math.round(40 + fxEnergy * 200 + Math.sin(fxPhase * 0.5) * 15 * fxEnergy);', 'chVals[pf.startAddress + fa.irisOffset] = Math.round(40 + fxEnergy * 200 + Math.sin(fxPhase2 * 0.5) * 15 * fxEnergy);', 'compute iris'],
  ['chVals[pf.startAddress + fa.focusOffset] = Math.round(80 + fxEnergy * 120 + Math.sin(fxPhase * 0.3) * 30);', 'chVals[pf.startAddress + fa.focusOffset] = Math.round(80 + fxEnergy * 120 + Math.sin(fxPhase2 * 0.3) * 30);', 'compute focus'],
]);