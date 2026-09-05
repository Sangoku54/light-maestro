/**
 * Programmer Store — MA3/EOS inspired live buffer (pur, sans side-effect).
 *
 * Values here are "in the programmer" (violet) : live edits not yet stored.
 * Un hook dédié (`useProgrammerSync`) fait le push vers dmxBridge LTP 85.
 * `Clear` retire, `Store` merge vers scene/cue (Appelant).
 */

import { create } from 'zustand';

type ChannelMap = Record<number, number>; // DMX addr 1..512 → 0..255

interface ProgrammerState {
  channels: ChannelMap; // only touched channels (0 = absent)
  isActive: boolean;
  setChannel: (addr: number, value: number) => void;
  setChannels: (map: ChannelMap) => void;
  clearChannel: (addr: number) => void;
  clear: () => void;
  hasChannel: (addr: number) => boolean;
  count: () => number;
}

export const useProgrammerStore = create<ProgrammerState>((set, get) => ({
  channels: {},
  isActive: false,

  setChannel: (addr, value) => {
    const v = Math.max(0, Math.min(255, Math.round(value)));
    set((s) => {
      const next = { ...s.channels, [addr]: v };
      return { channels: next, isActive: Object.keys(next).length > 0 };
    });
  },

  setChannels: (map) =>
    set(() => {
      const next: ChannelMap = {};
      for (const [k, v] of Object.entries(map)) {
        const a = Number(k);
        const vv = Math.max(0, Math.min(255, Math.round(Number(v))));
        next[a] = vv;
      }
      return { channels: next, isActive: Object.keys(next).length > 0 };
    }),

  clearChannel: (addr) =>
    set((s) => {
      const next = { ...s.channels };
      delete next[addr];
      return { channels: next, isActive: Object.keys(next).length > 0 };
    }),

  clear: () => set({ channels: {}, isActive: false }),

  hasChannel: (addr) => get().channels[addr] !== undefined,

  count: () => Object.keys(get().channels).length,
}));
