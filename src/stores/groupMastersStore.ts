/**
 * Group Masters — fader de plafonnement du dimmer PAR GROUPE de fixtures.
 *
 * Sémantique submaster : le master ne fait que PLAFONNER —
 *   intensité effective = min(intensité du contenu, valeur du fader).
 * À 255 (100 %) le master est neutre (source relâchée). Les faders VC
 * 'group-master' écrivent ici ; le hook use-group-masters matérialise le
 * plafond dans l'arbitre via la source LTP 'group-masters' (58) — matériel
 * ET vue 3D (qui lit le buffer arbitré) sont servis par le même chemin.
 */
import { create } from 'zustand';

interface GroupMastersState {
  /** groupId → valeur 0..255 (255 = neutre/100 %). */
  values: Record<string, number>;
  setMaster: (groupId: string, value: number) => void;
}

export const useGroupMastersStore = create<GroupMastersState>((set) => ({
  values: {},
  setMaster: (groupId, value) =>
    set((s) => ({
      values: { ...s.values, [groupId]: Math.max(0, Math.min(255, Math.round(value))) },
    })),
}));
