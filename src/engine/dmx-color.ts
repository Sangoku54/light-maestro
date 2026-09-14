// ─── DMX Color Utilities ──────────────────────────────────
// Extracted from dmx-playback.ts - pure color math functions
// No React/hook dependencies.

export interface RgbSegment {
  r: number; g: number;
  /** Bleu — null pour les lasers RG (Rouge+Vert sans bleu) : le canal n'existe pas. */
  b: number | null;
  w: number | null;
  /** Amber (RGBA / RGBAW) - offset DMX, null si absent. */
  a?: number | null;
  /** UV (RGBAUUV) - offset DMX, null si absent. */
  uv?: number | null;
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)];
}

/** Hue shift: rotate color on HSL wheel. Preserves brightness. */
export function applyHueShift([r,g,b]: [number,number,number], deg: number): [number,number,number] {
  if (deg === 0) return [r,g,b];
  const nr=r/255,ng=g/255,nb=b/255;
  const mx=Math.max(nr,ng,nb),mn=Math.min(nr,ng,nb);
  const l=(mx+mn)/2;
  if (mx===mn) return [r,g,b];
  const d=mx-mn;
  const s=l>0.5?d/(2-mx-mn):d/(mx+mn);
  let h:number;
  if (mx===nr) h=((ng-nb)/d+(ng<nb?6:0))*60;
  else if (mx===ng) h=((nb-nr)/d+2)*60;
  else h=((nr-ng)/d+4)*60;
  h=(h+deg)%360;if(h<0) h+=360;
  const c=(1-Math.abs(2*l-1))*s;
  const x=c*(1-Math.abs((h/60)%2-1));
  const m=l-c/2;
  let r2,g2,b2:number;
  if(h<60){r2=c;g2=x;b2=0;}else if(h<120){r2=x;g2=c;b2=0;}
  else if(h<180){r2=0;g2=c;b2=x;}else if(h<240){r2=0;g2=x;b2=c;}
  else if(h<300){r2=x;g2=0;b2=c;}else{r2=c;g2=0;b2=x;}
  return [Math.round((r2+m)*255),Math.round((g2+m)*255),Math.round((b2+m)*255)];
}

export const TIER_HUE = { primary: 0, secondary: 120, tertiary: 240, other: 0 } as const;

export function colorDistance(hex1: string, hex2: string): number {
  const [r1,g1,b1]=hexToRgb(hex1); const [r2,g2,b2]=hexToRgb(hex2);
  return Math.sqrt(2*(r1-r2)**2 + 4*(g1-g2)**2 + 3*(b1-b2)**2);
}

export function classifyColor(r: number, g: number, b: number): string {
  if(r>200&&g>200&&b>200)return'white'; if(r<50&&g<50&&b<50)return'black';
  const max=Math.max(r,g,b);
  if(max===r){if(g>b*1.5)return'yellow';if(b>g*1.5)return'magenta';if(r>g*2&&r>b*2)return'red';return'orange';}
  if(max===g){if(r>b*1.5)return'yellow';return'green';}
  if(max===b){if(r>g*1.5)return'magenta';if(r>g*.6)return'purple';return'blue';}
  return'white';
}

export function matchCapToCategory(capName: string, category: string): number {
  if(!capName)return 0; const n=capName.trim();
  const kw: Record<string,string[]>={red:['Red','Rouge','Dark Red','Light Red','Deep Red','Red (1)','Red (2)'],blue:['Blue','Bleu','Cyan','Dark Blue','Light Blue','Sky Blue','Blue (1)','Blue (2)'],green:['Green','Vert','Lime','Dark Green','Light Green','Green (1)','Green (2)'],yellow:['Yellow','Jaune','Amber','Ambre','Gold','Yellow (1)','Yellow (2)'],white:['White','Blanc','Open','Warm White','Cold White','Neutral White','Bright','White (1)','White (2)'],magenta:['Magenta','Pink','Rose','Fuchsia','Magenta (1)','Magenta (2)','Pink (1)','Pink (2)'],cyan:['Cyan','Turquoise','Teal','Aqua','Cyan (1)','Cyan (2)'],orange:['Orange','Orange (1)','Orange (2)'],purple:['Purple','Violet','Pourpre','UV','Lavender','Mauve','Indigo','Purple (1)','Purple (2)','UV (1)'],pink:['Pink','Rose','Salmon','Pink (1)','Pink (2)'],amber:['Amber','Ambre','Gold','Amber (1)','Amber (2)']};
  const k=kw[category]||[category]; const low=n.toLowerCase();
  for(const kk of k){const kl=kk.toLowerCase();if(low===kl)return 10;if(low.startsWith(kl+' '))return 9;if(low.startsWith(kl+'('))return 9;if(low.includes(kl))return 5;}
  return 0;
}

export function mapIntensity(level: string, energy: number, tier: string, tierMults?: { primary: number; secondary: number; tertiary: number }): number {
  const ABSOLUTE_MIN=0; let val: number;
  if(level==='dynamic'){val=Math.round(Math.max(ABSOLUTE_MIN,20+energy*235));}
  else{let lo:number,hi:number;switch(level){case'very-low':lo=40;hi=130;break;case'low':lo=100;hi=200;break;case'medium':lo=140;hi=240;break;case'high':lo=180;hi=255;break;case'very-high':lo=200;hi=255;break;default:lo=120;hi=220;break;}val=Math.round(Math.max(ABSOLUTE_MIN,lo+Math.max(0,Math.min(1,energy))*(hi-lo)));}
  let tierMult: number;
  if (tierMults) {
    // Le Tier Mix utilisateur exprime directement le niveau final : 70% = 0.70.
    // L'ancien code sur-multipliait par la base structurelle (0.7 × 0.7 = 0.49
    // pour le secondaire) — faisceaux invisibles malgré un Tier Mix à 70%.
    if (tier === 'primary' || tier === 'other') tierMult = tierMults.primary / 100;
    else if (tier === 'secondary') tierMult = tierMults.secondary / 100;
    else tierMult = tierMults.tertiary / 100;
  } else {
    tierMult = tier === 'primary' || tier === 'other' ? 1.0 : tier === 'secondary' ? 0.7 : 0.4;
  }
  return Math.round(val*tierMult);
}

// ── Channel name patterns ───────────────────────────

export const startsWithRgb=/^(red|green|blue|r|g|b|rouge|vert|bleu|rojo|verde|azul)(\s*\(?\d*\)?)?$/i;
export const hasColorWord=/\b(red|green|blue|white|amber|uv|laser|rouge|vert|bleu|blanc|ambre|rojo|verde|azul|blanco)\b/i;
export const isRed=/\b(red|r|rouge|rojo)\b/i;
export const isGreen=/\b(green|g|vert|verde)\b/i;
export const isBlue=/\b(blue|b|bleu|azul)\b/i;
export const isWhite=/\b(white|w|blanc|blanco)\b/i;
export const isAmber=/\b(amber|ambre|a|naranja)\b/i;
export const isUv=/\b(uv|ultraviolet|ultra\s*violet)\b/i;
export const isPresetMode=/presets?|macro|auto|sound/i;

// ── RGB segment builder ─────────────────────────────

/** Couleurs nommées → hex (roues de couleur dont les caps n'ont pas de champ color). */
export const NAMED_CAP_COLOR_HEX: Record<string, string> = {
  red: '#ff0000', green: '#00ff00', blue: '#0000ff', white: '#ffffff',
  yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff', orange: '#ff8800',
  purple: '#8800ff', violet: '#8800ff', amber: '#ffbf00', pink: '#ff69b4',
  uv: '#8800ff', lime: '#00ff44',
};

/** Hex d'une couleur si le nom de cap en contient une, sinon null. */
export function capColorFromName(name: string | undefined): string | null {
  if (!name) return null;
  const n = name.toLowerCase();
  for (const key of Object.keys(NAMED_CAP_COLOR_HEX)) {
    if (new RegExp(`\\b${key}\\b`).test(n)) return NAMED_CAP_COLOR_HEX[key];
  }
  return null;
}

/**
 * Remplit cap.color depuis le nom quand absent (roues nommées « Yellow »,
 * « Deep Blue »… sans champ color dans le fichier fixture) — sans cela, une
 * roue nommée non colorisée tombait sur un fallback arbitraire (jaune).
 */
export function enrichWheelCaps(caps: DmxFixtureCapability[] | null | undefined): DmxFixtureCapability[] {
  if (!caps || caps.length === 0) return [];
  let changed = false;
  const out = caps.map((cap) => {
    if (cap.color) return cap;
    const hex = capColorFromName(cap.name);
    if (!hex) return cap;
    changed = true;
    return { ...cap, color: hex };
  });
  return changed ? out : caps;
}

/**
 * v2 : regroupe les canaux couleur par FAMILLE de nom (le nom sans son mot
 * couleur) pour ne jamais mélanger deux jeux (ex : « Bee eye red » avec
 * « Beam green »), puis tolère les lasers RG sans bleu (b: null).
 */
export function buildRgbSegments(colourChannels: Array<{offset:number;name:string}>): RgbSegment[] {
  const used = new Set<number>();
  const segments: RgbSegment[] = [];
  const FAMILY_STRIP = /\b(red|green|blue|white|amber|uv|rouge|vert|bleu|blanc|ambre|rojo|verde|azul|blanco|fine)(?=\d|\b)/gi;
  const familyOf = (name: string): string =>
    name.toLowerCase().replace(FAMILY_STRIP, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const families = new Map<string, number[]>();
  for (let j = 0; j < colourChannels.length; j++) {
    const fam = familyOf(colourChannels[j].name);
    const list = families.get(fam) ?? [];
    list.push(j);
    families.set(fam, list);
  }
  // Fix: canaux numérotés type Red1/Green1/Blue1 — /\b(red)\b/ ne matche pas "Red1" (chiffre = \w, pas de frontière)
  const stripDigits = (s: string) => s.toLowerCase().replace(/\d+/g, ' ').replace(/\s+/g,' ').trim();
  const matches = (name: string, re: RegExp): boolean => re.test(name) || re.test(stripDigits(name));
  const pickIn = (fam: number[], re: RegExp): number =>
    fam.find((j) => !used.has(j) && matches(colourChannels[j].name, re)) ?? -1;
  for (const fam of families.values()) {
    const ri = pickIn(fam, isRed);
    if (ri < 0) continue;
    const gi = pickIn(fam, isGreen);
    if (gi < 0) continue;
    const bi = pickIn(fam, isBlue); // -1 possible : laser RG -> b null
    const wi = bi >= 0 ? pickIn(fam, isWhite) : -1;
    const ai = bi >= 0 ? pickIn(fam, isAmber) : -1;
    const uvi = bi >= 0 ? pickIn(fam, isUv) : -1;
    if (bi < 0 && wi >= 0) continue; // R+G+W sans B : ambigu, on ignore
    used.add(ri); used.add(gi);
    if (bi >= 0) used.add(bi);
    if (wi >= 0) used.add(wi);
    if (ai >= 0) used.add(ai);
    if (uvi >= 0) used.add(uvi);
    segments.push({
      r: colourChannels[ri].offset,
      g: colourChannels[gi].offset,
      b: bi >= 0 ? colourChannels[bi].offset : null,
      w: wi >= 0 ? colourChannels[wi].offset : null,
      a: ai >= 0 ? colourChannels[ai].offset : null,
      uv: uvi >= 0 ? colourChannels[uvi].offset : null,
    });
  }
  return segments;
}

import type { DmxFixtureCapability } from '../hooks/dmx-cues';
import type { PatchedFixture } from '../stores/showStore';

/** Roue dégénérée = toutes ses caps partagent une couleur imposée par le défaut
 *  (ex: « CHOISE COLOR 0-139 #ff0000 » sur une vraie roue arc-en-ciel). Aucune
 *  couleur n'est exprimable via le matching → on DOIT piloter la roue par
 *  POSITION pour que la fixture change réellement de couleur sur la piste. */
export function wheelIsDegenerateForFixture(caps: DmxFixtureCapability[], fa: { isLaser?: boolean }): boolean {
  if (fa.isLaser) return false;
  if (!caps || caps.length === 0) return false;
  const distinct = new Set(caps.map((c) => c.color ?? '').filter(Boolean));
  return distinct.size <= 1;
}

/** Écrit une couleur de roue par POSITION sur la plage manuelle de la roue
 *  (catégorie ≈ teinte de la palette). Retourne la position ou null si cette
 *  roue n'est pas dégénérée (→ laisser le matching par slot s'appliquer). */
export function wheelDegeneratePosition(
  caps: DmxFixtureCapability[],
  fa: { isLaser?: boolean },
  paletteHex: string,
  timeSeconds: number,
): number | null {
  if (!wheelIsDegenerateForFixture(caps, fa)) return null;
  const manual = caps.filter((c) => !/(auto|change|rotat|scroll|jump|dance|soun|spee|dither)/i.test(c.name ?? ''));
  const range = manual.length > 0 ? manual : caps;
  const lo = Math.min(...range.map((c) => c.min));
  const hi = Math.max(...range.map((c) => c.max));
  if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return hi;
  const [r, g, b] = hexToRgb(paletteHex);
  const cat = classifyColor(r, g, b);
  const catToWheelPos: Record<string, number> = { red: 0.10, orange: 0.20, yellow: 0.30, green: 0.42, cyan: 0.55, blue: 0.68, magenta: 0.78, purple: 0.78, white: 0.02, black: 0.02 };
  const wPos = catToWheelPos[cat] ?? 0.5;
  const sweep = 0.08 * Math.sin(timeSeconds * 1.4); // léger vivaneau temporel
  return Math.round(lo + Math.max(0, Math.min(1, wPos + sweep)) * (hi - lo));
}

export function findBestWheelCap(caps: DmxFixtureCapability[], paletteHex: string): DmxFixtureCapability|null {
  if(caps.length===0)return null;
  const[r,g,b]=hexToRgb(paletteHex);const cat=classifyColor(r,g,b);
  let bestName:{cap:DmxFixtureCapability;score:number}|null=null;
  for(const cap of caps){
    if(!cap.name)continue;
    const s=matchCapToCategory(cap.name,cat);
    if(s>(bestName?.score??0)){
      bestName={cap,score:s};
    } else if(s>0&&bestName&&s===bestName.score){
      // Égalité de score de nom (ex. « CYAN » et « BLUE » matchent tous les
      // deux la catégorie bleu) : départager par distance de couleur réelle
      // pour ne pas retomber sur le premier tour de roue.
      const bestDist=bestName.cap.color?colorDistance(paletteHex,bestName.cap.color):Infinity;
      const curDist=cap.color?colorDistance(paletteHex,cap.color):Infinity;
      if(curDist<bestDist) bestName={cap,score:s};
    }
  }
  if(bestName&&bestName.score>=5)return bestName.cap;
  let bestCap:DmxFixtureCapability|null=null;let bestDist=Infinity;
  for(const cap of caps){if(cap.color){const d=colorDistance(paletteHex,cap.color);if(d<bestDist){bestDist=d;bestCap=cap;}}}
  if(bestCap&&bestDist<350)return bestCap;
  if(bestName&&bestName.score>0)return bestName.cap;
  const catToWheelPos: Record<string, number> = {red:0.10,orange:0.20,yellow:0.30,green:0.42,cyan:0.55,blue:0.68,magenta:0.78,purple:0.78,white:0.02,black:0.02};
  const wheelPos=catToWheelPos[cat]??0.5;
  return caps[Math.floor(wheelPos*caps.length)%caps.length];
}
