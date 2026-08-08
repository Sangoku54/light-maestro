import { useEffect, useRef } from 'react';
import { useRgbMatrixStore } from '../stores/rgbmatrixStore';
import { useShowStore } from '../stores/showStore';

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
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

function getPatternColor(
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

export function useRgbMatrixPlayback() {
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const lastFrameRef = useRef<number>(0);

  useEffect(() => {
    const dmx = (window as any).lightMaestro?.dmx;
    if (!dmx) return;

    startTimeRef.current = performance.now();
    lastFrameRef.current = 0;

    const tick = () => {
      const now = performance.now();
      // ~30 fps throttle
      if (now - lastFrameRef.current < 30) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      lastFrameRef.current = now;

      const matrices = useRgbMatrixStore.getState().matrices.filter(m => m.enabled);
      if (matrices.length === 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const elapsed = (now - startTimeRef.current) / 1000;
      const fixtures = useShowStore.getState().patchedFixtures;
      const groups = useShowStore.getState().fixtureGroups;
      const universes = useShowStore.getState().universes;

      for (const matrix of matrices) {
        const group = groups.find(g => g.id === matrix.groupId);
        if (!group) continue;

        const groupFixtures = fixtures.filter(f => group.fixtureIds.includes(f.id));
        if (groupFixtures.length === 0) continue;

        const { cols, rows } = matrix;
        const cellCount = cols * rows;
        const phase = elapsed * matrix.speed;
        const startRgb = hexToRgb(matrix.startColor);
        const endRgb = hexToRgb(matrix.endColor);

        for (let i = 0; i < Math.min(groupFixtures.length, cellCount); i++) {
          const fixture = groupFixtures[i];
          const col = i % cols;
          const row = Math.floor(i / cols);

          const [r, g, b] = getPatternColor(
            matrix.pattern, col, row, cols, rows,
            phase, startRgb, endRgb, matrix.width,
          );

          const defChannels = (fixture as any).channels || (fixture as any).definition?.channels;
          if (!defChannels || !Array.isArray(defChannels)) continue;

          let rCh = -1, gCh = -1, bCh = -1;
          for (let ci = 0; ci < defChannels.length; ci++) {
            const ch = defChannels[ci];
            const chName = (ch.name || ch.channel || '').toLowerCase();
            if ((chName === 'red' || chName.includes('red')) && rCh === -1) rCh = ci;
            else if ((chName === 'green' || chName.includes('green')) && gCh === -1) gCh = ci;
            else if ((chName === 'blue' || chName.includes('blue')) && bCh === -1) bCh = ci;
          }

          if (rCh >= 0 && gCh >= 0 && bCh >= 0) {
            const uniIdx = universes.findIndex(u => u.id === fixture.universeId);
            if (uniIdx >= 0) {
              const addr = fixture.startAddress;
              dmx.setChannel(uniIdx, addr + rCh, r);
              dmx.setChannel(uniIdx, addr + gCh, g);
              dmx.setChannel(uniIdx, addr + bCh, b);
            }
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    tick();
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);
}
