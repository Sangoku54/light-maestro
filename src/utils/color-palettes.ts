/**
 * Color Palettes — application live + remplacement global.
 *
 * Une palette = { name, hex, groupIds[] }. groupIds vide = TOUTES les fixtures.
 *  - applyPalette : écrit la couleur en LIVE (programmeur + bridge, source
 *    'palette' LTP 58) sur les fixtures du scope — mêmes règles que
 *    applyHexColorToFixture (rgbSegments + roue couleur).
 *  - replaceEverywhere : balaie les scènes du show ; pour chaque fixture du
 *    scope, si les canaux couleur de la scène correspondent à l'ANCIENNE
 *    couleur (RGB exact ou slot roue), ils sont réécrits avec la nouvelle.
 *    Retourne le nombre de scènes modifiées.
 */
import { useShowStore } from '../stores/showStore';
import { useProgrammerStore } from '../stores/programmerStore';
import { dmxBridge } from './dmx-bridge';
import { getFixtureChannelMaps } from './scene-look';
import { hexToRgb, findBestWheelCap } from '../engine/dmx-color';

try { dmxBridge.registerSource('palette', 'ltp', 58); } catch {}

function scopeFixtures(groupIds: string[]) {
  const show = useShowStore.getState();
  if (!groupIds || groupIds.length === 0) return show.patchedFixtures;
  const inScope = new Set<string>();
  for (const gid of groupIds) {
    const grp = show.fixtureGroups.find((g) => g.id === gid);
    if (grp) for (const fid of grp.fixtureIds) inScope.add(fid);
  }
  return show.patchedFixtures.filter((f) => inScope.has(f.id));
}

/** Écrit la couleur sur les fixtures du scope (live : programmeur + bridge). */
export function applyPalette(hex: string, groupIds: string[]): void {
  const setCh = useProgrammerStore.getState().setChannel;
  const maps = getFixtureChannelMaps();
  const [r, g, b] = hexToRgb(hex);
  for (const pf of scopeFixtures(groupIds)) {
    const cm = maps.get(pf.id) as any;
    if (!cm) continue;
    if ((cm.rgbSegments?.length ?? 0) > 0) {
      for (const seg of cm.rgbSegments) {
        setCh(pf.startAddress + seg.r, r);
        setCh(pf.startAddress + seg.g, g);
        if (seg.b !== null && seg.b !== undefined) setCh(pf.startAddress + seg.b, b);
        if (seg.w !== null && seg.w !== undefined) setCh(pf.startAddress + seg.w, g > 200 && r > 200 && b > 200 ? 255 : 0);
      }
    } else if (cm.wheelOffset !== null && cm.wheelOffset !== undefined) {
      const best = findBestWheelCap(cm.wheelCaps ?? [], hex);
      if (best) setCh(pf.startAddress + cm.wheelOffset, Math.round((best.min + best.max) / 2));
    }
  }
}

/**
 * Remplace oldHex par newHex dans TOUTES les scènes du show, pour les
 * fixtures du scope. Match RGB exact (valeurs des canaux R/G/B) ou slot
 * roue (cap la plus proche identique pour les deux couleurs).
 */
export function replaceColorEverywhere(oldHex: string, newHex: string, groupIds: string[]): number {
  const show = useShowStore.getState();
  const maps = getFixtureChannelMaps();
  const [or, og, ob] = hexToRgb(oldHex);
  const [nr, ng, nb] = hexToRgb(newHex);
  const fixtures = scopeFixtures(groupIds);
  let changed = 0;

  for (const scene of show.scenes) {
    const ch = { ...scene.channels };
    let touched = false;
    for (const pf of fixtures) {
      const cm = maps.get(pf.id) as any;
      if (!cm) continue;
      const applyNew = (addr: number, v: number): void => { ch[addr] = v; touched = true; };

      if ((cm.rgbSegments?.length ?? 0) > 0) {
        for (const seg of cm.rgbSegments) {
          const aR = pf.startAddress + seg.r, aG = pf.startAddress + seg.g;
          const aB = seg.b !== null && seg.b !== undefined ? pf.startAddress + seg.b : null;
          if (ch[aR] !== or || ch[aG] !== og || (aB !== null && ch[aB] !== ob)) continue;
          applyNew(aR, nr); applyNew(aG, ng);
          if (aB !== null) applyNew(aB, nb);
        }
      } else if (cm.wheelOffset !== null && cm.wheelOffset !== undefined) {
        const caps = cm.wheelCaps ?? [];
        const oldBest = findBestWheelCap(caps, oldHex);
        const newBest = findBestWheelCap(caps, newHex);
        if (!oldBest || !newBest) continue;
        const oldMid = Math.round((oldBest.min + oldBest.max) / 2);
        const addr = pf.startAddress + cm.wheelOffset;
        if (ch[addr] === oldMid && oldBest.name !== newBest.name) applyNew(addr, Math.round((newBest.min + newBest.max) / 2));
      }
    }
    if (touched) {
      show.updateScene(scene.id, { channels: ch });
      changed++;
    }
  }
  return changed;
}
