/**
 * subagent_04-sim.ts — Simulation du rendu 3D (Stage3D) pour les lasers.
 * Réplique EXACTEMENT (lecture seule, copie de logique) :
 *   1. le bloc laser de computeDmxForCue (dmx-playback.ts L1431-1482)
 *   2. le calcul d'intensité + visibilité du cône dans Stage3D.updateDmxState
 *      (intensity L1549-1556, shutter L1565-1577, blackout/gm, cône L1705-1709)
 * Aucune écriture dans src/ — sortie console.
 */

// ── Réplique de laserGateValue (fixture-analyzer.ts L25) ──
const laserGateValue = (v: number) => (v > 22 ? 255 : 0);

// ── Réplique du bloc RGB 2 canaux de dmx-playback.ts (L1463-1472) ──
function laserRgValues(energy: number, paletteColor?: string): [number, number, number] {
  let rr0: number, gg0: number, bb0: number;
  if (paletteColor) {
    const h = paletteColor.replace('#', '');
    rr0 = parseInt(h.slice(0, 2), 16); gg0 = parseInt(h.slice(2, 4), 16); bb0 = parseInt(h.slice(4, 6), 16);
  } else {
    rr0 = Math.round(255 * energy); gg0 = Math.round(255 * energy); bb0 = 0;
  }
  return [laserGateValue(rr0), laserGateValue(gg0), laserGateValue(bb0)];
}

// ── Réplique de Stage3D.updateDmxState (L1549-1609 + L1705-1709) ──
function stage3dBeam(channelMap: { intensityOffset: number | null; rgbOffsets: number[] | null; shutterOffset: number | null },
                     data: number[], baseAddr: number,
                     showBeams = true, blackout = false, grandMaster = 255): { intensity: number; norm: number; opacity: number; visible: boolean; color: string } {
  // Intensity (L1549-1556)
  let intensity = 0;
  if (channelMap.intensityOffset !== null && channelMap.intensityOffset >= 0) {
    intensity = data[baseAddr + channelMap.intensityOffset] ?? 0;
  } else if (channelMap.rgbOffsets) {
    const r = data[baseAddr + channelMap.rgbOffsets[0]] ?? 0;
    const g = data[baseAddr + channelMap.rgbOffsets[1]] ?? 0;
    const b = data[baseAddr + channelMap.rgbOffsets[2]] ?? 0;
    intensity = Math.max(r, g, b);
  }
  // Shutter (L1565-1577)
  if (channelMap.shutterOffset !== null && channelMap.shutterOffset >= 0) {
    const shutterVal = data[baseAddr + channelMap.shutterOffset] ?? 255;
    if (shutterVal <= 31) intensity = 0;
  }
  // Blackout / grandMaster (L1580-1583)
  if (blackout) intensity = 0;
  intensity = intensity * (grandMaster / 255);
  const normIntensity = intensity / 255;
  // Cône (L1705-1709)
  const opacity = normIntensity * 0.35;
  const visible = showBeams && normIntensity > 0.005;
  // Couleur (L1592-1600, RGB simple)
  let color = '#ffffff';
  if (channelMap.rgbOffsets && channelMap.rgbOffsets.length >= 3 === false && channelMap.rgbOffsets.length >= 2) {
    const r = (data[baseAddr + channelMap.rgbOffsets[0]] ?? 0) / 255;
    const g = (data[baseAddr + channelMap.rgbOffsets[1]] ?? 0) / 255;
    const b = 0;
    if (r > 0 || g > 0) color = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${b})`;
  }
  return { intensity, norm: normIntensity, opacity, visible, color };
}

// ── Configs réelles (probe2.ts) ──
const GALAXIAN = { intensityOffset: null, rgbOffsets: [0, 1], shutterOffset: null };      // American DJ Galaxian 3D (5ch)
const IODA = { intensityOffset: null, rgbOffsets: null, shutterOffset: null };             // Cameo IODA 400 RGY (11ch)

console.log('=== GALAXIAN 3D : energy (cue) → R/G gates → faisceau 3D ===');
console.log('  seuil gate: round(255*energy) > 22  ⇔  energy >', (22.5 / 255).toFixed(4));
for (const e of [0, 0.02, 0.05, 0.08, 0.088, 0.089, 0.09, 0.1, 0.13, 0.25, 0.5, 0.8, 0.95, 1.0]) {
  const [r, g] = laserRgValues(e);
  const dmx = new Array(5).fill(0); dmx[0] = r; dmx[1] = g;
  const s = stage3dBeam(GALAXIAN, dmx, 0);
  console.log(`  energy=${e.toFixed(3)} → R=${r} G=${g} | intensity=${s.intensity} norm=${s.norm.toFixed(3)} opacity=${s.opacity.toFixed(3)} visible=${s.visible} color=${s.color}`);
}
console.log('  → palette #ff0000 (R=255,G=0):', stage3dBeam(GALAXIAN, [255, 0, 0, 0, 0], 0).visible, '| #000000:', stage3dBeam(GALAXIAN, [0, 0, 0, 0, 0], 0).visible);

console.log('\n=== IODA 400 RGY : bloc laser live (mode, pattern, scan, wheel) → luminosité 3D ===');
// Mode écrit par capMid(pickLaserModeCap) → cap 210-255 « DMX mode » → 232 (plan.md)
const mode = 232;
// Roue : idx = floor(t/2) % 11 ; caps réels — le cap 0-9 « Laser off » a capMid=5
const wheelCaps = [
  { min: 0, max: 9 }, { min: 10, max: 59 }, { min: 60, max: 109 }, { min: 110, max: 159 },
  { min: 160, max: 209 }, { min: 210, max: 219 }, { min: 220, max: 229 }, { min: 230, max: 239 },
  { min: 240, max: 249 }, { min: 250, max: 255 },
];
const capMid = (c: { min: number; max: number }) => Math.round((c.min + c.max) / 2);
// Pattern caps : tranches de 2 (128 patterns) — capMid duplicate
for (const t of [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]) {
  const wheelIdx = Math.floor(t / 2) % wheelCaps.length;
  const wheelVal = capMid(wheelCaps[wheelIdx]);
  const patternIdx = Math.floor(t / 2) % 128;
  const patternVal = Math.round(((patternIdx * 2) + (patternIdx * 2 + 1)) / 2); // tranche de 2, capMid
  const dmx = new Array(11).fill(0);
  dmx[0] = mode; dmx[1] = wheelVal; dmx[2] = patternVal;
  dmx[6] = Math.round(128 + 80 * Math.sin(2 * Math.PI * t)); // scanX (startAddress%16 phase=0)
  dmx[7] = Math.round(128 + 80 * Math.cos(2 * Math.PI * t)); // scanY
  const s = stage3dBeam(IODA, dmx, 0);
  console.log(`  t=${t}s mode=${mode} wheel(cap ${wheelIdx})=${wheelVal} pattern=${patternVal} scanX=${dmx[6]} scanY=${dmx[7]} → intensity=${s.intensity} visible=${s.visible} (DMX produit un beam réel, la 3D ne le montre pas)`);
}

console.log('\n=== Conclusion seuils 3D (Stage3D.tsx) ===');
console.log('  cone.visible = showBeams && normIntensity > 0.005  (valeur DMX > 1.27)');
console.log('  Galaxian : intensity = max(R,G) ∈ {0,255} → binaire pur (0 ou 1.0)');
console.log('  IODA : intensity = 0 TOUJOURS (pas de intensityOffset ni rgbOffsets)');