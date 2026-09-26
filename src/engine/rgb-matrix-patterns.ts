// ─── Motifs de matrice RGB — calcul pur partagé ─────────────────────────────
//
// Extrait de `src/hooks/rgb-matrix-playback.ts` pour être réutilisable par le
// moteur Autoloop (banque « Matrice RGB ») sans import React/store.
// Module PUR : zéro import React/Electron/`window`.

/** `#rrggbb` → `[r, g, b]` (0..255). */
export function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

/** HSV (h,s,v ∈ [0,1]) → `[r, g, b]` (0..255). */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r: number, g: number, b: number;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/**
 * Couleur d'une cellule de matrice pour un motif donné.
 *
 * @param pattern motif (`chase`/`wave`/`burst`/`gradient`/`rainbow`/`random`/
 *                `pulse`/`strobe`/`solid`).
 * @param col,row indices de la cellule (0-based).
 * @param cols,rows dimensions de la grille.
 * @param phase   progression du motif (croissante, cycle ≈ 1).
 * @param startRgb,endRgb couleurs bornes du dégradé.
 * @param width   largeur du front en % (1..100) pour chase/wave/burst.
 */
export function getPatternColor(
  pattern: string,
  col: number, row: number,
  cols: number, rows: number,
  phase: number,
  startRgb: [number, number, number],
  endRgb: [number, number, number],
  width: number,
): [number, number, number] {
  const cellCount = cols * rows;
  const cellIndex = row * cols + col;

  let pos: number;
  switch (pattern) {
    case 'chase': {
      const chasePos = ((phase + cellIndex / cellCount) % 1 + 1) % 1;
      const threshold = 1 - width / 100;
      if (chasePos < threshold) return [0, 0, 0];
      pos = (chasePos - threshold) / (1 - threshold);
      break;
    }
    case 'wave': {
      const wavePos = ((phase + row / rows) % 1 + 1) % 1;
      const threshold = 1 - width / 100;
      if (wavePos < threshold) return [0, 0, 0];
      pos = (wavePos - threshold) / (1 - threshold);
      break;
    }
    case 'burst': {
      const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
      const dist = Math.sqrt(Math.pow(col - cx, 2) + Math.pow(row - cy, 2));
      const maxDist = Math.sqrt(cx * cx + cy * cy) || 1;
      const burstPos = ((phase + dist / maxDist) % 1 + 1) % 1;
      const threshold = 1 - width / 100;
      if (burstPos < threshold) return [0, 0, 0];
      pos = (burstPos - threshold) / (1 - threshold);
      break;
    }
    case 'gradient': {
      pos = cellIndex / Math.max(1, cellCount - 1);
      break;
    }
    case 'rainbow': {
      const h = ((phase + cellIndex / cellCount) % 1 + 1) % 1;
      return hsvToRgb(h, 1, 1);
    }
    case 'random': {
      const seed = Math.sin(cellIndex * 127.1 + Math.floor(phase * 10) * 43758.5453) * 43758.5453;
      const r = seed - Math.floor(seed);
      return hsvToRgb(r, 0.8, 1);
    }
    case 'pulse': {
      const pulseVal = 0.3 + 0.7 * Math.abs(Math.sin(phase * Math.PI));
      return [Math.round(startRgb[0] * pulseVal), Math.round(startRgb[1] * pulseVal), Math.round(startRgb[2] * pulseVal)];
    }
    case 'strobe': {
      const strobeVal = Math.sin(phase * Math.PI * 12) > 0 ? 1 : 0;
      return [Math.round(startRgb[0] * strobeVal), Math.round(startRgb[1] * strobeVal), Math.round(startRgb[2] * strobeVal)];
    }
    default:
      return startRgb;
  }

  const r = Math.round(startRgb[0] + (endRgb[0] - startRgb[0]) * pos);
  const g = Math.round(startRgb[1] + (endRgb[1] - startRgb[1]) * pos);
  const b = Math.round(startRgb[2] + (endRgb[2] - startRgb[2]) * pos);
  return [r, g, b];
}

/** `[r,g,b]` → `#rrggbb` (borné 0..255). */
export function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'))
    .join('');
}
