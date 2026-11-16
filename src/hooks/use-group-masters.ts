/**
 * useGroupMasters — matérialise les plafonds de dimmer par groupe dans
 * l'arbitre (source LTP 'group-masters', priorité 58).
 *
 * Algorithme (pass ~250 ms + immédiat sur changement) :
 *   1. release('group-masters') → le buffer arbitré retombe sur le contenu
 *      (moteur/preset/matrix) — c'est la VRAIE valeur à plafonner ;
 *   2. lecture du buffer fraîchement recomputé ;
 *   3. pour chaque fixture d'un groupe dont le master < 255 : écrire
 *      min(valeur_courante, plafond) sur intensityOffset + ledIntensityOffsets
 *      (remap mapIntensityVal pour les canaux hybrides Dimmer/Strobe).
 *
 * Les canaux où le contenu est SOUS le plafond ne sont PAS écrits → ils
 * restent la propriété du contenu (pulses/fades dynamiques préservés).
 * À 255 (100 %) partout → source relâchée, neutre total.
 * Vue 3D : lit le buffer arbitré → plafond visible sans code spécifique.
 */
import { useEffect, useRef } from 'react';
import { useGroupMastersStore } from '../stores/groupMastersStore';
import { useShowStore } from '../stores/showStore';
import { dmxBridge } from '../utils/dmx-bridge';
import { loadFixtureDefinitions } from './dmx-cues';
import { analyzeFixtureChannels, mapIntensityVal } from '../engine/fixture-analyzer';

try { dmxBridge.registerSource('group-masters', 'ltp', 58); } catch {}

const RECOMPUTE_MS = 250;

export function useGroupMasters(): void {
  const defCacheRef = useRef<Map<string, any>>(new Map());
  const recomputeRef = useRef<() => void>(() => {});

  useEffect(() => {
    let cancelled = false;

    const recompute = (): void => {
      if (cancelled) return;
      const st = useGroupMastersStore.getState();
      const capped = Object.entries(st.values).filter(([, v]) => v < 255);
      if (capped.length === 0) {
        dmxBridge.release('group-masters');
        return;
      }

      const show = useShowStore.getState();
      const uniIdxOf = (uid: string): number =>
        show.universes.findIndex((u) => String(u.id) === String(uid));
      const byId = new Map(show.patchedFixtures.map((f) => [f.id, f]));
      const needDefs = new Set<string>();
      const perUni = new Map<number, { addr: number; cap: number }[]>();

      for (const [gid, cap] of capped) {
        const grp = show.fixtureGroups.find((g) => g.id === gid);
        if (!grp) continue;
        for (const fid of grp.fixtureIds) {
          const pf = byId.get(fid);
          if (!pf) continue;
          const def = defCacheRef.current.get(pf.fixtureDefId);
          if (!def) { needDefs.add(pf.fixtureDefId); continue; }
          const fa = analyzeFixtureChannels(pf, def);
          const uni = uniIdxOf(pf.universeId);
          if (uni < 0) continue;
          const addrs = [fa.intensityOffset, ...fa.ledIntensityOffsets]
            .filter((o): o is number => o !== null && o !== undefined);
          if (addrs.length === 0) continue;
          let list = perUni.get(uni);
          if (!list) { list = []; perUni.set(uni, list); }
          for (const off of addrs) {
            const cappedVal = fa.intensityCapRange ? mapIntensityVal(cap, fa) : cap;
            list.push({ addr: pf.startAddress + off, cap: cappedVal });
          }
        }
      }

      // Défs manquantes : chargement en fond → recompute au tick suivant.
      if (needDefs.size > 0) {
        loadFixtureDefinitions([...needDefs])
          .then((m) => { defCacheRef.current = new Map(m); })
          .catch(() => {});
      }

      if (perUni.size === 0) {
        dmxBridge.release('group-masters');
        return;
      }

      // 1) Release → le buffer retombe sur le contenu réel à plafonner.
      dmxBridge.release('group-masters');
      // 2) Lecture + 3) écriture du plafond (uniquement où contenu > plafond).
      for (const [uni, caps] of perUni) {
        const cur = dmxBridge.getChannels(uni);
        const vals: Record<number, number> = {};
        for (const { addr, cap } of caps) {
          const curVal = typeof cur?.[addr] === 'number' ? (cur as Record<number, number>)[addr] : 0;
          if (curVal > cap) vals[addr] = cap;
        }
        if (Object.keys(vals).length > 0) dmxBridge.writeMerge('group-masters', uni, vals);
      }
    };

    recomputeRef.current = recompute;

    // Immédiat sur changement de valeurs de masters.
    const unsub = useGroupMastersStore.subscribe(() => recompute());
    // Cadence : suit les dynamiques du contenu (plafond refresh).
    const timer = setInterval(recompute, RECOMPUTE_MS);
    recompute();

    return () => {
      cancelled = true;
      unsub();
      if (timer) clearInterval(timer);
      try { dmxBridge.release('group-masters'); } catch {}
    };
  }, []);
}
