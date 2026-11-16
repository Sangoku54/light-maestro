// Patch 1.0.20 - Chorégraphie spatiale (lot 1 : wave / circle / expand / contract / alternate)
// 1) dmx-movement.ts : helper spatialPhaseFor + SPATIAL_BY_SECTION + fallbackPosition
// 2) dmx-playback.ts : injection du décalage de phase spatial dans tick + computeDmxForCue
// 3) QuickShowView.tsx : sélecteur spatialPattern + champ sur les cues + câblage fixturePositionsRef
// 4) SongPresetPlayer.tsx : câblage fixturePositionsRef
const fs = require('fs');
const F = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const W = (p, c) => fs.writeFileSync(p, c.replace(/\n/g, '\r\n'), 'utf8');
let edits = 0;
const rep = (p, oldS, newS) => {
  const c = F(p);
  if (!c.includes(oldS)) { console.error('MISS in ' + p + ':\n' + JSON.stringify(oldS.slice(0, 120))); process.exit(1); }
  if (c.split(oldS).length - 1 > 1) { console.error('AMBIGUOUS in ' + p + ' (count=' + (c.split(oldS).length - 1) + '): ' + JSON.stringify(oldS.slice(0, 80))); process.exit(1); }
  W(p, c.split(oldS).join(newS));
  edits++;
  console.log('OK ' + p + ' :: ' + oldS.slice(0, 46).replace(/\n/g, '\\n') + '...');
};

// ---- 1) dmx-movement.ts : append helpers spatiaux ----
const mv = F('src/engine/dmx-movement.ts');
const block = `

// ---- Spatial choreography -------------------------------------------------
// Per-fixture phase offsets derived from real stage positions (x,y normalized 0..1).
// Turns a uniform movement pattern into a wave/circle/expand across the whole rig.

export type SpatialPattern = 'off' | 'wave' | 'circle' | 'expand' | 'contract' | 'alternate';

export const SPATIAL_BY_SECTION: Record<string, SpatialPattern> = {
  intro:   'wave',
  verse:   'wave',
  chorus:  'circle',
  bridge:  'wave',
  drop:    'expand',
  outro:   'contract',
  build:   'alternate',
};

/** Fallback stage position: same grid formula as showStore.initFixturePosition. */
export function fallbackPosition(mobileIdx: number): { x: number; y: number } {
  const col = mobileIdx % 6;
  const row = Math.floor(mobileIdx / 6);
  return { x: 0.1 + col * 0.16, y: 0.1 + row * 0.18 };
}

/**
 * Per-fixture phase offset (radians) for a spatial pattern, added to the movement phase.
 * - wave:      phase ~ -x   -> cascade sweeping left to right (lambda = full stage)
 * - circle:    phase ~ +x   -> rotating ring along the line (Lissajous circle)
 * - expand:    phase ~ -dist to center -> impulse from center to the edges (drop)
 * - contract:  phase ~ +dist to center -> converge toward the center (outro)
 * - alternate: pi on odd mobile index -> alternating pair/impair groups (build)
 * Missing position -> grid fallback by index. Unknown/off -> 0 (current behavior).
 */
export function spatialPhaseFor(
  pos: { x: number; y: number } | undefined,
  pattern: string | undefined,
  mobileIdx: number,
): number {
  if (!pattern || pattern === 'off') return 0;
  if (pattern === 'alternate') return mobileIdx % 2 === 0 ? 0 : Math.PI;
  const p = pos ?? fallbackPosition(Math.max(0, mobileIdx));
  const cx = p.x - 0.5;
  const cy = p.y - 0.5;
  switch (pattern) {
    case 'wave': return -Math.PI * 2 * cx;
    case 'circle': return Math.PI * 2 * cx;
    case 'expand': return -Math.PI * 2 * Math.sqrt(cx * cx + cy * cy);
    case 'contract': return Math.PI * 2 * Math.sqrt(cx * cx + cy * cy);
    default: return 0;
  }
}
`;
W('src/engine/dmx-movement.ts', mv.trimEnd() + block);
edits++;
console.log('OK src/engine/dmx-movement.ts :: append spatial helpers');

// ---- 2) dmx-playback.ts ----
rep('src/hooks/dmx-playback.ts',
  "import { clampPanToStage, clampTiltToStage, SMART_MOVEMENTS, DEFAULT_SMART_MOVEMENTS, getSmartMovement } from '../engine/dmx-movement';",
  "import { clampPanToStage, clampTiltToStage, SMART_MOVEMENTS, DEFAULT_SMART_MOVEMENTS, getSmartMovement, spatialPhaseFor } from '../engine/dmx-movement';");

rep('src/hooks/dmx-playback.ts',
  '  movementSpeed?: number;\n  energy?: number;',
  '  movementSpeed?: number;\n  /** Chorégraphie spatiale par section : wave | circle | expand | contract | alternate | off. */\n  spatialPattern?: string;\n  energy?: number;');

rep('src/hooks/dmx-playback.ts',
  'React.MutableRefObject<Record<string, { x: number; y: number }>>; // For stage-aware pan/tilt',
  'React.MutableRefObject<Record<string, { x: number; y: number; h?: number }>>; // For stage-aware pan/tilt');

rep('src/hooks/dmx-playback.ts',
  '  fixturePositions?: Record<string, { x: number; y: number }>,',
  '  fixturePositions?: Record<string, { x: number; y: number; h?: number }>,');

// Tick : déclaration spatialPattern + mobileIdx, et phase avec offset spatial
rep('src/hooks/dmx-playback.ts',
  '                })();\n              if(amplitude>0){for(let m=0;m<motorCount;m++){const motorPhase=m*(Math.PI*2/motorCount);const speedMult=active.movementSpeed??1;',
  '                })();\n              // Spatial choreography: per-fixture phase offset from real stage position\n              const spatialPattern = (active as any).spatialPattern;\n              let mobileIdx = -1, totalMobile = 0;\n              if (spatialPattern) {\n                for (const ffa of fixtures) {\n                  if (ffa.panOffsets.length > 0 || ffa.tiltOffsets.length > 0) {\n                    if (ffa.fixture.id === pf.id) mobileIdx = totalMobile;\n                    totalMobile++;\n                  }\n                }\n              }\n              if(amplitude>0){for(let m=0;m<motorCount;m++){const motorPhase=m*(Math.PI*2/motorCount);const speedMult=active.movementSpeed??1;');

rep('src/hooks/dmx-playback.ts',
  'const phase=(ct*Math.PI*2*blendSpd)+motorPhase+movementPhase;let px=0,py=0;',
  'const phase=(ct*Math.PI*2*blendSpd)+motorPhase+movementPhase+(spatialPattern?spatialPhaseFor(fixturePositions?.[pf.id],spatialPattern,mobileIdx):0);let px=0,py=0;');

// computeDmxForCue : même offset spatial (cohérence des crossfades < 0.3s)
rep('src/hooks/dmx-playback.ts',
  '          const speedMult = (cue as any).movementSpeed ?? 1;\n          const phase = cue.time * Math.PI * 2 * speedMult;',
  '          const speedMult = (cue as any).movementSpeed ?? 1;\n          // Spatial choreography: keep crossfade snapshots coherent with the live tick\n          const spatialPattern = (cue as any).spatialPattern;\n          let mobileIdx = -1, totalMobile = 0;\n          if (spatialPattern) {\n            for (const a of analyses) {\n              if (a.panOffsets.length > 0 || a.tiltOffsets.length > 0) {\n                if (a.fixture.id === pf.id) mobileIdx = totalMobile;\n                totalMobile++;\n              }\n            }\n          }\n          const phase = cue.time * Math.PI * 2 * speedMult + spatialPhaseFor(fixturePositions?.[pf.id], spatialPattern, mobileIdx);');

// ---- 3) QuickShowView.tsx ----
rep('src/views/QuickShowView.tsx',
  "import { halfDegToDmxOffset } from '../engine/dmx-movement';",
  "import { halfDegToDmxOffset, SPATIAL_BY_SECTION } from '../engine/dmx-movement';");

rep('src/views/QuickShowView.tsx',
  '      return deduped[idx];\n    };',
  '      return deduped[idx];\n    };\n\n    // Spatial choreography selector: per-section stage gesture (wave/circle/expand/...).\n    // The real stage positions turn the chosen movement into a scene-wide pattern\n    // (vague L-R, cercle, expansion depuis le centre, alternance pair/impair).\n    const selectSpatialPattern = (secType: string, featRms: number): string => {\n      if (featRms < 0.2) return \'off\';\n      if (secType === \'verse\' && featRms > 0.55) return \'circle\';\n      if (secType === \'drop\' && detectedGenre === \'house\') return \'circle\';\n      return SPATIAL_BY_SECTION[secType] || \'off\';\n    };');

rep('src/views/QuickShowView.tsx',
  '          movementSpeed,\n          colorTemp,',
  '          movementSpeed,\n          spatialPattern: movement === \'static\' ? \'off\' : selectSpatialPattern(section.type, energy),\n          colorTemp,');

rep('src/views/QuickShowView.tsx',
  '          movement: profile.movement,\n          colorTemp: profile.colorTemp,',
  '          movement: profile.movement,\n          spatialPattern: SPATIAL_BY_SECTION[section.type] ?? \'off\',\n          colorTemp: profile.colorTemp,');

rep('src/views/QuickShowView.tsx',
  '  currentTimeRef.current = audioFile.currentTime; // keep in sync on every render',
  '  currentTimeRef.current = audioFile.currentTime; // keep in sync on every render\n  const fixturePositions = useShowStore(s => s.fixturePositions);\n  const fixturePositionsRef = useRef(fixturePositions);\n  fixturePositionsRef.current = fixturePositions;');

rep('src/views/QuickShowView.tsx',
  '    panTiltLimitsRef,\n    colorFadeMs: qs.colorFadeMs ?? 250,',
  '    panTiltLimitsRef,\n    fixturePositionsRef,\n    colorFadeMs: qs.colorFadeMs ?? 250,');

// ---- 4) SongPresetPlayer.tsx ----
rep('src/components/SongPresetPlayer.tsx',
  '  const patchedFixtures = useShowStore((s) => s.patchedFixtures);',
  '  const patchedFixtures = useShowStore((s) => s.patchedFixtures);\n  const fixturePositions = useShowStore((s) => s.fixturePositions);\n  const fixturePositionsRef = useRef(fixturePositions);\n  fixturePositionsRef.current = fixturePositions;');

rep('src/components/SongPresetPlayer.tsx',
  '    scenesRef,\n  });',
  '    scenesRef,\n    fixturePositionsRef,\n  });');

console.log('TOTAL EDITS: ' + edits);
