// ─── DMX Color Utilities ──────────────────────────────────
// Extracted from dmx-playback.ts — pure color math functions
// No React/hook dependencies.

export interface RgbSegment { r: number; g: number; b: number; w: number | null; }

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
  let tierMult=tier==='primary'||tier==='other'?1.0:tier==='secondary'?0.7:0.4;
  if(tierMults){if(tier==='primary')tierMult*=(tierMults.primary/100);else if(tier==='secondary')tierMult*=(tierMults.secondary/100);else if(tier==='tertiary')tierMult*=(tierMults.tertiary/100);}
  return Math.round(val*tierMult);
}

// ── Channel name patterns ───────────────────────────

export const startsWithRgb=/^(red|green|blue|r|g|b|rouge|vert|bleu|rojo|verde|azul)(\s*\(?\d*\)?)?$/i;
export const hasColorWord=/\b(red|green|blue|white|amber|uv|laser|rouge|vert|bleu|blanc|ambre|rojo|verde|azul|blanco)\b/i;
export const isRed=/\b(red|r|rouge|rojo)\b/i;
export const isGreen=/\b(green|g|vert|verde)\b/i;
export const isBlue=/\b(blue|b|bleu|azul)\b/i;
export const isWhite=/\b(white|w|blanc|blanco)\b/i;
export const isPresetMode=/presets?|macro|auto|sound/i;

// ── RGB segment builder ─────────────────────────────

export function buildRgbSegments(colourChannels: Array<{offset:number;name:string}>): RgbSegment[] {
  const segments: RgbSegment[]=[]; const used=new Set<number>();
  for(let i=0;i<colourChannels.length;i++){
    if(used.has(i))continue;
    let ri=-1;for(let j=0;j<colourChannels.length;j++){if(!used.has(j)&&isRed.test(colourChannels[j].name)){ri=j;break;}}
    if(ri<0)continue;
    let gi=-1;for(let j=0;j<colourChannels.length;j++){if(!used.has(j)&&j!==ri&&isGreen.test(colourChannels[j].name)){gi=j;break;}}
    if(gi<0)continue;
    let bi=-1;for(let j=0;j<colourChannels.length;j++){if(!used.has(j)&&j!==ri&&j!==gi&&isBlue.test(colourChannels[j].name)){bi=j;break;}}
    if(bi<0)continue;
    let wi=-1;for(let j=0;j<colourChannels.length;j++){if(!used.has(j)&&j!==ri&&j!==gi&&j!==bi&&isWhite.test(colourChannels[j].name)){wi=j;break;}}
    used.add(ri);used.add(gi);used.add(bi);if(wi>=0)used.add(wi);
    segments.push({r:colourChannels[ri].offset,g:colourChannels[gi].offset,b:colourChannels[bi].offset,w:wi>=0?colourChannels[wi].offset:null});
  }
  return segments;
}

import type { DmxFixtureCapability } from '../hooks/dmx-cues';
import type { PatchedFixture } from '../stores/showStore';

export function findBestWheelCap(caps: DmxFixtureCapability[], paletteHex: string): DmxFixtureCapability|null {
  if(caps.length===0)return null;
  const[r,g,b]=hexToRgb(paletteHex);const cat=classifyColor(r,g,b);
  let bestName:{cap:DmxFixtureCapability;score:number}|null=null;
  for(const cap of caps){if(!cap.name)continue;const s=matchCapToCategory(cap.name,cat);if(s>(bestName?.score??0))bestName={cap,score:s};}
  if(bestName&&bestName.score>=5)return bestName.cap;
  let bestCap:DmxFixtureCapability|null=null;let bestDist=Infinity;
  for(const cap of caps){if(cap.color){const d=colorDistance(paletteHex,cap.color);if(d<bestDist){bestDist=d;bestCap=cap;}}}
  if(bestCap&&bestDist<350)return bestCap;
  if(bestName&&bestName.score>0)return bestName.cap;
  const catToWheelPos: Record<string, number> = {red:0.10,orange:0.20,yellow:0.30,green:0.42,cyan:0.55,blue:0.68,magenta:0.78,purple:0.78,white:0.02,black:0.02};
  const wheelPos=catToWheelPos[cat]??0.5;
  return caps[Math.floor(wheelPos*caps.length)%caps.length];
}
