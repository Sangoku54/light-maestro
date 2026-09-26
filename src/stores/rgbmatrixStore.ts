import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type RgbMatrixPattern =
  | 'solid' | 'chase' | 'wave' | 'burst' | 'gradient'
  | 'rainbow' | 'random' | 'pulse' | 'strobe';

export type RgbMatrixDirection = 'forward' | 'backward' | 'bounce';

export interface RgbMatrix {
  id: string;
  name: string;
  groupId: string;
  cols: number;
  rows: number;
  pattern: RgbMatrixPattern;
  direction: RgbMatrixDirection;
  speed: number;
  startColor: string;
  endColor: string;
  width: number;
  offset: number;
  enabled: boolean;
}

export interface RgbMatrixStats {
  /** Fixtures du groupe ciblées par la matrice. */
  total: number;
  /** Fixtures effectivement écrites en DMX (RGB résolu). */
  resolved: number;
}

interface RgbMatrixStore {
  matrices: RgbMatrix[];
  activeMatrixId: string | null;
  /** Dernier diagnostic du moteur de lecture (par matrice). */
  stats: Record<string, RgbMatrixStats>;
  setStats: (id: string, stats: RgbMatrixStats) => void;
  createMatrix: (name: string, groupId: string) => void;
  updateMatrix: (id: string, updates: Partial<RgbMatrix>) => void;
  deleteMatrix: (id: string) => void;
  setActiveMatrix: (id: string | null) => void;
  toggleMatrix: (id: string) => void;
}

const DEFAULT_MATRIX: Omit<RgbMatrix, 'id' | 'name' | 'groupId'> = {
  cols: 4, rows: 4, pattern: 'chase', direction: 'forward',
  speed: 0.5, startColor: '#ff0000', endColor: '#0000ff',
  width: 100, offset: 0, enabled: false,
};

export const useRgbMatrixStore = create<RgbMatrixStore>()(
  persist(
    (set) => ({
      matrices: [],
      activeMatrixId: null,
      stats: {},

      setStats: (id, stats) =>
        set(s => {
          const prev = s.stats[id];
          if (prev && prev.total === stats.total && prev.resolved === stats.resolved) return s;
          return { stats: { ...s.stats, [id]: stats } };
        }),

      createMatrix: (name, groupId) => {
        const id = `rgbm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        set(s => ({
          matrices: [...s.matrices, { id, name, groupId, ...DEFAULT_MATRIX }],
          activeMatrixId: id,
        }));
      },

      updateMatrix: (id, updates) =>
        set(s => ({
          matrices: s.matrices.map(m => m.id === id ? { ...m, ...updates } : m),
        })),

      deleteMatrix: (id) =>
        set(s => {
          const stats = { ...s.stats };
          delete stats[id];
          return {
            matrices: s.matrices.filter(m => m.id !== id),
            activeMatrixId: s.activeMatrixId === id ? null : s.activeMatrixId,
            stats,
          };
        }),

      setActiveMatrix: (id) => set({ activeMatrixId: id }),

      toggleMatrix: (id) =>
        set(s => ({
          matrices: s.matrices.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m),
        })),
    }),
    { name: 'light-maestro-rgbmatrix' }
  )
);
