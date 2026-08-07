/**
 * DMX Playback Hook — Direct on-the-fly DMX computation and hardware output.
 *
 * Computes DMX values ON EVERY FRAME for the current playback time,
 * then sends them directly to hardware via IPC.
 *
 * Architecture:
 *   Renderer → IPC setChannels → Engine writes SAB → Worker reads SAB
 *   Worker → frameSent → Engine dispatches to USB/ArtNet/sACN outputs
 */

import { useEffect, useRef } from 'react';
import type { PatchedFixture, FixtureGroup, FixtureTier } from '../stores/showStore';
import type { DmxFixtureDefinition, DmxFixtureCapability } from './dmx-cues';
import { resolveTrackTargets, computeEfxOverrides, type EfxTrackRef, type FixtureTrack, type MovementBlock } from './fixture-tracks';

// ─── Color Track ref type (for DMX playback resolution) ──
export interface ColorTrackRef {
  id: string;
  entries: Array<{ id: string; time: number; endTime: number; color: string; endColor?: string }>;
  targetFixtures: {
    type: 'all' | 'group' | 'fixture';
    groupId?: string;
    fixtureIds?: string[];
  };
}

/** Compute per-fixture forced colors from active color track entries at a given time. */
export function computeColorTrackColors(
  colorTracks: ColorTrackRef[],
  currentTime: number,
  patchedFixtures: PatchedFixture[],
  fixtureGroups: FixtureGroup[],
): Map<string, string> {
  const result = new Map<string, string>();
  for (const ctItem of colorTracks) {
    const activeEntry = ctItem.entries.find(e => currentTime >= e.time && currentTime < e.endTime);
    if (!activeEntry || !ctItem.targetFixtures) continue;
    const tf = ctItem.targetFixtures;
    let targets: string[] = [];
    if (tf.type === 'all') {
      targets = patchedFixtures.map(f => f.id);
    } else if (tf.type === 'group' && tf.groupId) {
      const group = fixtureGroups.find(g => g.id === tf.groupId);
      targets = group?.fixtureIds || [];
    } else if (tf.type === 'fixture' && tf.fixtureIds) {
      targets = tf.fixtureIds;
    }
    for (const fid of targets) {
      if (activeEntry.endColor && activeEntry.endColor !== activeEntry.color) {
        const dur = activeEntry.endTime - activeEntry.time;
        const t = dur > 0 ? Math.max(0, Math.min(1, (currentTime - activeEntry.time) / dur)) : 1;
        const [sr, sg, sb] = hexToRgb(activeEntry.color);
        const [er, eg, eb] = hexToRgb(activeEntry.endColor);
        const r = Math.round(sr + (er - sr) * t);
        const g = Math.round(sg + (eg - sg) * t);
        const b = Math.round(sb + (eb - sb) * t);
        result.set(fid, `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`);
      } else {
        result.set(fid, activeEntry.color);
      }
    }
  }
  return result;
}

import type { SavedEffect } from '../stores/showStore';
import { useAppStore } from '../stores/appstore';
import { dmxBridge } from '../utils/dmx-bridge';

let _efxNoOverrideFrame = 0;

/**
 * Dispatch DMX channel values to the correct universe based on fixture address ranges.
 * Maps an address-based channel record to per-universe channel records.
 */
export function dispatchChannelsByFixture(
  channelValues: Record<number, number>,
  patchedFixtures: PatchedFixture[],
  universes: { id: string }[],
): Map<number, Record<number, number>> {
  const uniIds = universes.map(u => String(u.id));
  const dispatched = new Map<number, Record<number, number>>();

  for (const pf of patchedFixtures) {
    const uniIdx = uniIds.indexOf(pf.universeId);
    const uniNum = uniIdx >= 0 ? uniIdx : 0;
    const base = pf.startAddress;
    const endAddr = base + pf.channelCount;

    const uniVals = dispatched.get(uniNum) || {};
    for (const [addrStr, val] of Object.entries(channelValues)) {
      const addr = Number(addrStr);
      if (addr >= base && addr < endAddr) {
        // HTP merge within universe
        const existing = uniVals[addr];
        if (existing === undefined || val > existing) {
          uniVals[addr] = val;
        }
      }
    }
    if (Object.keys(uniVals).length > 0) {
      dispatched.set(uniNum, uniVals);
    }
  }

  return dispatched;
}

// ─── Cue input type (compatible with genCues output) ───

export interface CuePlayback {
  time: number;
  section: string;
  effect: string;
  intensity: string;
  colors: string[];
  color: string;
  strobe: boolean;
  group?: string;
  colorTemp?: 'warm' | 'neutral' | 'cool';
  strobeProbability?: number;
  dimmerPulseOnBeat?: boolean;
  colorShiftSpeed?: number;
  movement?: 'static' | 'sweep' | 'circle' | 'pulse' | 'wave' | 'bounce' | 'figure8' | 'spiral' | 'zigzag' | 'heartbeat' | 'randomWalk' | 'diamond';
  movementAmplitude?: number;
  movementSpeed?: number;
  energy?: number;
  forcedColor?: string;
  forcedStrobe?: boolean;
  forcedDimmerVal?: number;
  strobeSpeed?: number;
}

export interface UniversePlayback {
  id: string;
  name: string;
  type?: string;
  channels?: number;
}

interface RgbSegment { r: number; g: number; b: number; w: number | null; }

interface ChannelAnalysis {
  fixture: PatchedFixture;
  intensityOffset: number | null;
  shutterOffset: number | null;
  rgbSegments: RgbSegment[];
  wheelOffset: number | null;
  wheelCaps: DmxFixtureCapability[];
  panOffsets: number[];
  tiltOffsets: number[];
  channelCount: number;
  universeIndex: number;
  goboOffset: number | null;
  goboCaps: DmxFixtureCapability[];
  prismOffset: number | null;
  zoomOffset: number | null;
  frostOffset: number | null;
  irisOffset: number | null;
  focusOffset: number | null;
  presetOverrideOffsets: number[]; // Color Preset/Macro channels that must be 0 for RGB mode
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.substring(0,2),16), parseInt(h.substring(2,4),16), parseInt(h.substring(4,6),16)];
}

function colorDistance(hex1: string, hex2: string): number {
  const [r1,g1,b1]=hexToRgb(hex1); const [r2,g2,b2]=hexToRgb(hex2);
  return Math.sqrt(2*(r1-r2)**2 + 4*(g1-g2)**2 + 3*(b1-b2)**2);
}

function classifyColor(r: number, g: number, b: number): string {
  if(r>200&&g>200&&b>200)return'white'; if(r<50&&g<50&&b<50)return'black';
  const max=Math.max(r,g,b);
  if(max===r){if(g>b*1.5)return'yellow';if(b>g*1.5)return'magenta';if(r>g*2&&r>b*2)return'red';return'orange';}
  if(max===g){if(r>b*1.5)return'yellow';return'green';}
  if(max===b){if(r>g*1.5)return'magenta';if(r>g*.6)return'purple';return'blue';}
  return'white';
}

function matchCapToCategory(capName: string, category: string): number {
  if(!capName)return 0; const n=capName.trim();
  const kw: Record<string,string[]>={red:['Red','Rouge','Dark Red','Light Red','Deep Red','Red (1)','Red (2)'],blue:['Blue','Bleu','Cyan','Dark Blue','Light Blue','Sky Blue','Blue (1)','Blue (2)'],green:['Green','Vert','Lime','Dark Green','Light Green','Green (1)','Green (2)'],yellow:['Yellow','Jaune','Amber','Ambre','Gold','Yellow (1)','Yellow (2)'],white:['White','Blanc','Open','Warm White','Cold White','Neutral White','Bright','White (1)','White (2)'],magenta:['Magenta','Pink','Rose','Fuchsia','Magenta (1)','Magenta (2)','Pink (1)','Pink (2)'],cyan:['Cyan','Turquoise','Teal','Aqua','Cyan (1)','Cyan (2)'],orange:['Orange','Orange (1)','Orange (2)'],purple:['Purple','Violet','Pourpre','UV','Lavender','Mauve','Indigo','Purple (1)','Purple (2)','UV (1)'],pink:['Pink','Rose','Salmon','Pink (1)','Pink (2)'],amber:['Amber','Ambre','Gold','Amber (1)','Amber (2)']};
  const k=kw[category]||[category]; const low=n.toLowerCase();
  for(const kk of k){const kl=kk.toLowerCase();if(low===kl)return 10;if(low.startsWith(kl+' '))return 9;if(low.startsWith(kl+'('))return 9;if(low.includes(kl))return 5;}
  return 0;
}

function mapIntensity(level: string, energy: number, tier: FixtureTier, tierMults?: { primary: number; secondary: number; tertiary: number }): number {
  const ABSOLUTE_MIN=0; let val: number;
  if(level==='dynamic'){val=Math.round(Math.max(ABSOLUTE_MIN,20+energy*235));}
  else{let lo:number,hi:number;switch(level){case'very-low':lo=40;hi=130;break;case'low':lo=100;hi=200;break;case'medium':lo=140;hi=240;break;case'high':lo=180;hi=255;break;case'very-high':lo=200;hi=255;break;default:lo=120;hi=220;break;}val=Math.round(Math.max(ABSOLUTE_MIN,lo+Math.max(0,Math.min(1,energy))*(hi-lo)));}
  let tierMult=tier==='primary'?1.0:tier==='secondary'?0.7:0.4;
  if(tierMults){if(tier==='primary')tierMult*=(tierMults.primary/100);else if(tier==='secondary')tierMult*=(tierMults.secondary/100);else tierMult*=(tierMults.tertiary/100);}
  return Math.round(val*tierMult);
}

const startsWithRgb=/^(red|green|blue|r|g|b|rouge|vert|bleu|rojo|verde|azul)(\s*\(?\d*\)?)?$/i;
const hasColorWord=/\b(red|green|blue|white|amber|uv|laser|rouge|vert|bleu|blanc|ambre|rojo|verde|azul|blanco)\b/i;
const isRed=/\b(red|r|rouge|rojo)\b/i; const isGreen=/\b(green|g|vert|verde)\b/i; const isBlue=/\b(blue|b|bleu|azul)\b/i; const isWhite=/\b(white|w|blanc|blanco)\b/i;
const isPresetMode=/presets?|macro|auto|sound/i;

function buildRgbSegments(colourChannels: Array<{offset:number;name:string}>): RgbSegment[] {
  const segments: RgbSegment[]=[]; const used=new Set<number>();
  // Order-independent: find Red, Green, Blue regardless of channel order
  // Some fixtures list channels as [Blue, Green, Red] or [Dimmer, Red, Blue, Green]
  for(let i=0;i<colourChannels.length;i++){
    if(used.has(i))continue;
    const ci=colourChannels[i];
    // Find Red anywhere (not just first)
    let ri=-1;for(let j=0;j<colourChannels.length;j++){if(!used.has(j)&&isRed.test(colourChannels[j].name)){ri=j;break;}}
    if(ri<0)continue;
    let gi=-1;for(let j=0;j<colourChannels.length;j++){if(!used.has(j)&&j!==ri&&isGreen.test(colourChannels[j].name)){gi=j;break;}}
    if(gi<0)continue;
    let bi=-1;for(let j=0;j<colourChannels.length;j++){if(!used.has(j)&&j!==ri&&j!==gi&&isBlue.test(colourChannels[j].name)){bi=j;break;}}
    if(bi<0)continue;
    let wi=-1;for(let j=0;j<colourChannels.length;j++){if(!used.has(j)&&j!==ri&&j!==gi&&j!==bi&&isWhite.test(colourChannels[j].name)){wi=j;break;}}
    used.add(ri);used.add(gi);used.add(bi);if(wi>=0)used.add(wi);
    segments.push({r:colourChannels[ri].offset,g:colourChannels[gi].offset,b:colourChannels[bi].offset,w:wi>=0?colourChannels[wi].offset:null});
    // Continue scanning for additional RGB(W) segments (multi-segment fixtures like flower/beam+bee-eye)
  }
  return segments;
}

function analyzeChannels(pf: PatchedFixture, def: DmxFixtureDefinition|undefined): ChannelAnalysis {
  const channels=def?.modes[pf.modeIndex]?.channels??[];
  const fa: ChannelAnalysis={fixture:pf,intensityOffset:null,shutterOffset:null,rgbSegments:[],wheelOffset:null,wheelCaps:[],panOffsets:[],tiltOffsets:[],channelCount:channels.length,universeIndex:0,goboOffset:null,goboCaps:[],prismOffset:null,zoomOffset:null,frostOffset:null,irisOffset:null,focusOffset:null,presetOverrideOffsets:[]};
  const colourChannels: Array<{offset:number;name:string;caps?:DmxFixtureCapability[]}>=[];
  for(let i=0;i<channels.length;i++){const ch=channels[i];const off=ch.offset??i;const chName=(ch.name?.trim()??'');
    // Detect "Color Preset" / "Macro" channels that must be set to 0 for RGB mode
    if(isPresetMode.test(chName)){fa.presetOverrideOffsets.push(off);continue;}
    // Detect Dimmer in Shutter channels (fixtures like "Dimmer / Strobe")
    const isShutterDimmer = /\bdimmer\b/i.test(chName) && ch.type === 'Shutter';
    if(isShutterDimmer && fa.intensityOffset === null){fa.intensityOffset = off;}
    if(startsWithRgb.test(chName)||ch.type==='Colour'||(ch.type==='Beam'&&hasColorWord.test(chName))){colourChannels.push({offset:off,name:chName,caps:ch.capabilities});continue;}
    switch(ch.type){case'Intensity':if(fa.intensityOffset===null)fa.intensityOffset=off;break;case'Shutter':case'Effect':if(fa.shutterOffset===null)fa.shutterOffset=off;break;case'Pan':fa.panOffsets.push(off);break;case'Tilt':fa.tiltOffsets.push(off);break;case'Gobo':if(fa.goboOffset===null){fa.goboOffset=off;fa.goboCaps=ch.capabilities??[];}break;case'Prism':if(fa.prismOffset===null)fa.prismOffset=off;break;case'Zoom':if(fa.zoomOffset===null)fa.zoomOffset=off;break;case'Frost':case'Focus':if(fa.frostOffset===null)fa.frostOffset=off;break;case'Iris':if(fa.irisOffset===null)fa.irisOffset=off;break;}}
  // TRACE: dump channel analysis once per fixture
  const allNames=channels.map(c=>`${c.name||'?'}[${c.type||'?'}]`).join(', ');
  const colourNames=colourChannels.map(c=>c.name).join(', ');
  if(colourChannels.length>0){const hasRgbStart=colourChannels.some(c=>startsWithRgb.test(c.name));
    const hasRgbWords=colourChannels.some(c=>isRed.test(c.name))&&colourChannels.some(c=>isGreen.test(c.name))&&colourChannels.some(c=>isBlue.test(c.name));
    const hasRgbNames=(hasRgbStart||hasRgbWords)&&colourChannels.length>=3;
    const hasColorCaps=colourChannels.some(c=>c.caps?.some(cap=>cap.color));
    if(hasRgbNames){fa.rgbSegments=buildRgbSegments(colourChannels);}
    else if(hasColorCaps){const wheel=colourChannels.find(c=>c.caps?.some(cap=>cap.color));if(wheel){fa.wheelOffset=wheel.offset;fa.wheelCaps=wheel.caps??[];}}
    else if(colourChannels.length>=3){fa.rgbSegments=buildRgbSegments(colourChannels);}
    else{fa.wheelOffset=colourChannels[0].offset;const ch=channels.find(c=>(c.offset??channels.indexOf(c))===colourChannels[0].offset);if(ch?.capabilities&&ch.capabilities.length>0)fa.wheelCaps=ch.capabilities;}
    
  }
  if(fa.wheelOffset!==null&&fa.wheelCaps.length===0){const ch=channels.find(c=>(c.offset??channels.indexOf(c))===fa.wheelOffset);if(ch?.capabilities&&ch.capabilities.length>0)fa.wheelCaps=ch.capabilities;}
  return fa;
}

function findBestWheelCap(caps: DmxFixtureCapability[], paletteHex: string): DmxFixtureCapability|null {
  if(caps.length===0)return null;
  const[r,g,b]=hexToRgb(paletteHex);const cat=classifyColor(r,g,b);
  // Step 1: Name-based matching (most reliable)
  let bestName:{cap:DmxFixtureCapability;score:number}|null=null;
  for(const cap of caps){if(!cap.name)continue;const s=matchCapToCategory(cap.name,cat);if(s>(bestName?.score??0))bestName={cap,score:s};}
  if(bestName&&bestName.score>=5)return bestName.cap;
  // Step 2: Color distance
  let bestCap:DmxFixtureCapability|null=null;let bestDist=Infinity;
  for(const cap of caps){if(cap.color){const d=colorDistance(paletteHex,cap.color);if(d<bestDist){bestDist=d;bestCap=cap;}}}
  if(bestCap&&bestDist<350)return bestCap;
  // Step 3: Name with any score (better than hue guess)
  if(bestName&&bestName.score>0)return bestName.cap;
  // Step 4: Category-based wheel position (DMX standard wheel order)
  // Standard DMX wheel: White(0%), Red(10%), Orange(20%), Yellow(30%), Green(42%), Cyan(55%), Blue(68%), Magenta(78%), UV(90%)
  const catToWheelPos: Record<string, number> = {red:0.10,orange:0.20,yellow:0.30,green:0.42,cyan:0.55,blue:0.68,magenta:0.78,purple:0.78,white:0.02,black:0.02};
  const wheelPos=catToWheelPos[cat]??0.5;
  return caps[Math.floor(wheelPos*caps.length)%caps.length];
}

// Mapping: section → best suited movement patterns per fixture (ordered by energy)
const SMART_MOVEMENTS: Record<string, string[]> = {
  intro:   ['static', 'panOnly', 'tiltOnly', 'sweep', 'wave'],
  verse:   ['sweep', 'wave', 'panOnly', 'figure8', 'randomWalk', 'panOnly'],
  chorus:  ['circle', 'sweep', 'spiral', 'diamond', 'figure8', 'bounce', 'wave'],
  bridge:  ['figure8', 'wave', 'zigzag', 'randomWalk', 'spiral', 'diamond'],
  drop:    ['bounce', 'zigzag', 'heartbeat', 'circle', 'spiral', 'diamond', 'randomWalk', 'wave'],
  outro:   ['tiltOnly', 'panOnly', 'sweep', 'static', 'wave'],
  build:   ['spiral', 'circle', 'wave', 'sweep', 'diamond', 'zigzag'],
};
const DEFAULT_SMART_MOVEMENTS = ['sweep', 'circle', 'wave', 'figure8', 'zigzag'];

function getSmartMovement(fixtureIndex: number, totalMobileFixtures: number, section: string, timeOffset?: number): string {
  const patterns = SMART_MOVEMENTS[section] || DEFAULT_SMART_MOVEMENTS;
  if (totalMobileFixtures <= 1) return patterns[0];
  let hash = 0;
  for (let i = 0; i < section.length; i++) hash = ((hash << 5) - hash) + section.charCodeAt(i);
  // Time-based rotation: same fixture gets different pattern at different times
  const timeIdx = timeOffset ? Math.floor(timeOffset / 8) : 0; // rotate every ~8 seconds
  const idx = (fixtureIndex + timeIdx + Math.abs(hash % 97)) % patterns.length;
  return patterns[idx];
}

// ─── Main Hook ──────────────────────────────────────────────

export function useDmxPlayback(options: {
  isPlaying: boolean; currentTimeRef: React.MutableRefObject<number>;
  cues: CuePlayback[]; patchedFixtures: PatchedFixture[];
  fixtureDefs: Map<string, DmxFixtureDefinition>; universes: UniversePlayback[];
  dmxOutputEnabled: boolean;
  tierMultipliers?: { primary: number; secondary: number; tertiary: number };
  strobeLimit?: number;
  colorFadeMs?: number;
  overrideCuesRef?: React.MutableRefObject<any[]>; // EFX + manual cues that override auto DMX
  fixtureTracksRef?: React.MutableRefObject<FixtureTrack[]>; // Fixture track overrides
  efxTracksRef?: React.MutableRefObject<EfxTrackRef[]>; // EFX track pan/tilt overrides
  effectsRef?: React.MutableRefObject<SavedEffect[]>; // Saved effect definitions
  fixtureGroupsRef?: React.MutableRefObject<{ id: string; fixtureIds: string[] }[]>;
  colorTracksRef?: React.MutableRefObject<ColorTrackRef[]>; // Color track overrides
  onVirtualDmx?: (universe: number, channelValues: Record<number, number>) => void; // Mirror for 3D view
}): void {
  const {isPlaying,currentTimeRef,cues,patchedFixtures,fixtureDefs,universes,dmxOutputEnabled,tierMultipliers,strobeLimit=10,colorFadeMs=250,overrideCuesRef,fixtureTracksRef,efxTracksRef,effectsRef,fixtureGroupsRef,colorTracksRef,onVirtualDmx}=options;
  const cuesRef=useRef(cues);cuesRef.current=cues;
  const dmxEnabledRef=useRef(dmxOutputEnabled);dmxEnabledRef.current=dmxOutputEnabled;

  // Pre-compute fixture channel analysis (re-computed when fixtures change)
  const analysisRef=useRef<{byUniverse:Map<number,ChannelAnalysis[]>;uniIds:string[]}|null>(null);
  useEffect(()=>{
    if(patchedFixtures.length===0||universes.length===0){analysisRef.current=null;return;}
    const uniIds=universes.map(u=>String(u.id));
    const analyses:ChannelAnalysis[]=[];
    for(const pf of patchedFixtures){
      const def=fixtureDefs.get(pf.fixtureDefId);
      if(!def){analysisRef.current=null;return;}
      const fa=analyzeChannels(pf,def);
      fa.universeIndex=uniIds.indexOf(pf.universeId);
      if(fa.universeIndex<0)fa.universeIndex=0;
      analyses.push(fa);
    }
    const byUniverse=new Map<number,ChannelAnalysis[]>();
    for(const fa of analyses){
      const list=byUniverse.get(fa.universeIndex)??[];
      list.push(fa);byUniverse.set(fa.universeIndex,list);
    }
    // Only update if data actually changed to avoid RAF loop re-mounts
    const prev=analysisRef.current;
    const newKey=JSON.stringify({uniIds,counts:analyses.map(a=>a.fixture.id)});
    if(prev?._key!==newKey){
      analysisRef.current={byUniverse,uniIds,_key:newKey};
    }
  },[patchedFixtures,fixtureDefs,universes]);

  // Ensure DMX engine is started
  const engineStartedRef=useRef(false);
  useEffect(()=>{
    const api=(typeof window!=='undefined'?(window as any).lightMaestro?.dmx:null);
    if(!api||universes.length===0)return;
    let cancelled=false;
    (async()=>{
      try{
        if(await api.isRunning().catch(()=>false)){engineStartedRef.current=true;return;}
        await Promise.all(universes.map((u:any)=>api.addUniverse({
          id:u.id,name:u.name,type:u.type||'usb-dmx',output:true,input:false,
          channels:u.channels||512,serialPort:u.serialPort||'',
          artnetIP:u.artnetIP||'',artnetSubnet:u.artnetSubnet??0,artnetUniverse:u.artnetUniverse??0,
          sacnUniverse:u.sacnUniverse??1,sacnPriority:u.sacnPriority??100,
        }).catch(()=>{})));
        if(cancelled)return;
        await api.start().catch(()=>{});
        engineStartedRef.current=true;
      }catch{/* engine start is best-effort */}
    })();
    return()=>{cancelled=true;};
    // Only run on mount / when universes change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  // Main playback RAF loop
  const rafRef=useRef<number>(0);
  const hasPlayedRef=useRef(false);

  useEffect(()=>{
    if(!isPlaying){
      if(hasPlayedRef.current&&dmxEnabledRef.current){
        hasPlayedRef.current=false;
        const api=(typeof window!=='undefined'?(window as any).lightMaestro?.dmx:null);
        if(api){
          for(let uniIdx=0;uniIdx<universes.length;uniIdx++){
            const black:Record<number,number>={};for(let ch=1;ch<=512;ch++)black[ch]=0;
            api.setChannels(uniIdx,black).catch(()=>{});
          }
        }
      }
      return;
    }

    hasPlayedRef.current=true;
    const api=(typeof window!=='undefined'?(window as any).lightMaestro?.dmx:null);
    if(!api)return;

    // Ensure engine is started (re-attempt on first play tick if needed)
    if(!engineStartedRef.current){
      engineStartedRef.current=true;
      (async()=>{
        try{
          if(await api.isRunning().catch(()=>false))return;
          await Promise.all(universes.map((u:any)=>api.addUniverse({
            id:u.id,name:u.name,type:u.type||'usb-dmx',output:true,input:false,
            channels:u.channels||512,serialPort:u.serialPort||'',
            artnetIP:u.artnetIP||'',artnetSubnet:u.artnetSubnet??0,artnetUniverse:u.artnetUniverse??0,
            sacnUniverse:u.sacnUniverse??1,sacnPriority:u.sacnPriority??100,
          }).catch(()=>{})));
          await api.start().catch(()=>{});
        }catch{/* best effort */}
      })();
    }

    const movementPhase=Math.random()*1000;
    let lastSig='';

    // Color fade: EMA smoothing between palette changes (~250ms at 60fps)
    const fadeState=new Map();const FADE_ALPHA=Math.min(0.98,colorFadeMs>0?1-Math.exp(Math.log(0.1)/(colorFadeMs/16.67)):0.98);
        const tick=()=>{
      if(!dmxEnabledRef.current){rafRef.current=requestAnimationFrame(tick);return;}
      const ct=currentTimeRef.current;
      const c=cuesRef.current;
      const analysis=analysisRef.current;
      if(!analysis||c.length===0){rafRef.current=requestAnimationFrame(tick);return;}

      // ── Color track forced colors (compute early, used later in palette resolution) ──
      const colorTrackColors = computeColorTrackColors(
        colorTracksRef?.current || [],
        ct,
        patchedFixtures,
        fixtureGroupsRef?.current || [],
      );

      // Find active cue: direct latest-before-ct, NO section grouping
      let active:CuePlayback|null=null;
      for(const cue of c){if(cue.time<=ct&&(!active||cue.time>active.time))active=cue;}
      if(!active){if(c.length>0)active=c[0];else{rafRef.current=requestAnimationFrame(tick);return;}}


    const energy=active.energy??(active.intensity==='very-high'?0.95:active.intensity==='high'?0.8:active.intensity==='medium'?0.5:active.intensity==='low'?0.25:0.1);
      const sec=active.section.toLowerCase();
      const isDrop=sec==='drop';const isChorus=sec==='chorus';

      // Pre-compute active EFX/manual override for this frame
      let efxActive:Record<number,number>|null=null;let efxTime=0;
      if(overrideCuesRef?.current){for(const oc of overrideCuesRef.current){if(oc.time<=ct&&oc.time>=efxTime){efxTime=oc.time;efxActive=oc.channelValues;}}}

      // Pre-compute EFX track pan/tilt overrides for this frame
      const efxPtOverrides = efxTracksRef?.current && effectsRef?.current && efxTracksRef.current.length > 0
        ? computeEfxOverrides(efxTracksRef.current, ct, effectsRef.current, patchedFixtures, fixtureGroupsRef?.current || [])
        : null;

      // Debug: log if EFX tracks exist but no overrides computed
      if (!efxPtOverrides || efxPtOverrides.size === 0) {
        if (efxTracksRef?.current && efxTracksRef.current.length > 0 && effectsRef?.current && effectsRef.current.length > 0) {
          const hasEntries = efxTracksRef.current.some(t => t.entries.length > 0);
          if (hasEntries && _efxNoOverrideFrame++ % 60 === 0) console.log('EFX no-override frame', _efxNoOverrideFrame, 'ct', ct.toFixed(2), 'tracks', efxTracksRef.current.length, 'effects', effectsRef.current.length, 'anyEntries', hasEntries);
        }
      }
      const efxMap=efxActive||{};

      for(const[uniIdx,fixtures]of analysis.byUniverse.entries()){
        const uid=analysis.uniIds[uniIdx];if(!uid)continue;
        const chVals:Record<number,number>={};

        for(let fi=0;fi<fixtures.length;fi++){
          const fa=fixtures[fi];const pf=fa.fixture;

          const dimmerVal = (() => {
            // Fixture track override check
            if (fixtureTracksRef?.current && fixtureGroupsRef?.current) {
              for (const ft of fixtureTracksRef.current) {
                if (!ft.enabled) continue;
                const targets = resolveTrackTargets(ft, patchedFixtures, fixtureGroupsRef.current);
                if (!targets.includes(pf.id)) continue;
                const activeBlock = ft.dimmerBlocks.find(b => ct >= b.time && ct < b.endTime);
                if (activeBlock) {
                  let val = activeBlock.value;
                  if (activeBlock.endValue !== undefined && activeBlock.endValue !== activeBlock.value) {
                    const dur = activeBlock.endTime - activeBlock.time;
                    const t = dur > 0 ? (ct - activeBlock.time) / dur : 0;
                    val = Math.round(activeBlock.value + (activeBlock.endValue - activeBlock.value) * t);
                  }
                  return val;
                }
              }
            }
            return active.forcedDimmerVal !== undefined ? active.forcedDimmerVal : mapIntensity(active.intensity, energy, pf.tier, tierMultipliers);
          })();
          if(fa.intensityOffset!==null){const addr=pf.startAddress+fa.intensityOffset;if(!chVals[addr]||dimmerVal>chVals[addr])chVals[addr]=dimmerVal;}

          const tierColorIdx=pf.tier==='secondary'?1:pf.tier==='tertiary'?2:0;
          let paletteColor = (() => {
            // Color track override (highest priority)
            if (colorTrackColors.has(pf.id)) {
              return colorTrackColors.get(pf.id)!;
            }
            // Fixture track override check
            if (fixtureTracksRef?.current && fixtureGroupsRef?.current) {
              for (const ft of fixtureTracksRef.current) {
                if (!ft.enabled) continue;
                const targets = resolveTrackTargets(ft, patchedFixtures, fixtureGroupsRef.current);
                if (!targets.includes(pf.id)) continue;
                const activeBlock = ft.colorBlocks.find(b => ct >= b.time && ct < b.endTime);
                if (activeBlock) {
                  if (activeBlock.endColor && activeBlock.endColor !== activeBlock.color) {
                    const dur = activeBlock.endTime - activeBlock.time;
                    const t = dur > 0 ? (ct - activeBlock.time) / dur : 0;
                    const sr = parseInt(activeBlock.color.slice(1,3),16);
                    const sg = parseInt(activeBlock.color.slice(3,5),16);
                    const sb = parseInt(activeBlock.color.slice(5,7),16);
                    const er = parseInt(activeBlock.endColor.slice(1,3),16);
                    const eg = parseInt(activeBlock.endColor.slice(3,5),16);
                    const eb = parseInt(activeBlock.endColor.slice(5,7),16);
                    const rr = Math.round(sr + (er - sr) * t);
                    const rg = Math.round(sg + (eg - sg) * t);
                    const rb = Math.round(sb + (eb - sb) * t);
                    return '#' + [rr, rg, rb].map(v => v.toString(16).padStart(2,'0')).join('');
                  }
                  return activeBlock.color;
                }
              }
            }
            // Use the exact cue color so fixtures match what the UI shows
            if (active.colors.length > 0) {
              return active.forcedColor || active.color || active.colors[0] || undefined;
            }
            return active.forcedColor || active.color || undefined;
          })();

          if(fa.rgbSegments.length>0&&paletteColor){
            let[r,g,b]=hexToRgb(paletteColor);
            for(const po of fa.presetOverrideOffsets){chVals[pf.startAddress+po]=0;}
            // If intensityOffset was detected (including Dimmer/Shutter), set it
            if(fa.intensityOffset!==null){const addr=pf.startAddress+fa.intensityOffset;if(!chVals[addr]||dimmerVal>chVals[addr])chVals[addr]=dimmerVal;}
            for(const seg of fa.rgbSegments){const key=pf.id+'_'+seg.r;let cur=fadeState.get(key);if(!cur){cur={r:r,g:g,b:b};fadeState.set(key,cur);}else{cur.r=Math.round(cur.r+(r-cur.r)*FADE_ALPHA);cur.g=Math.round(cur.g+(g-cur.g)*FADE_ALPHA);cur.b=Math.round(cur.b+(b-cur.b)*FADE_ALPHA);}chVals[pf.startAddress+seg.r]=cur.r;chVals[pf.startAddress+seg.g]=cur.g;chVals[pf.startAddress+seg.b]=cur.b;if(seg.w!==null)chVals[pf.startAddress+seg.w]=0;}

          }else if(fa.wheelOffset!==null&&paletteColor){
            const caps=fa.wheelCaps;
            let wheelVal:number;
            if(caps.length>0){const bestCap=findBestWheelCap(caps,paletteColor);wheelVal=bestCap?Math.round((bestCap.min+bestCap.max)/2):(()=>{const[r,g,b]=hexToRgb(paletteColor);const cat2=classifyColor(r,g,b);const catMap:Record<string,number>={red:0.10,orange:0.20,yellow:0.30,green:0.42,cyan:0.55,blue:0.68,magenta:0.78,purple:0.78,white:0.02};const wPos=catMap[cat2]??0.5;const capIdx=Math.floor(wPos*caps.length)%caps.length;return Math.round((caps[capIdx].min+caps[capIdx].max)/2);})();}
            else{const[r,g,b]=hexToRgb(paletteColor);const cat2=classifyColor(r,g,b);const catMap:Record<string,number>={red:0.10,orange:0.20,yellow:0.30,green:0.42,cyan:0.55,blue:0.68,magenta:0.78,purple:0.78,white:0.02};const wPos=catMap[cat2]??0.5;wheelVal=Math.round(wPos*255);}
            chVals[pf.startAddress+fa.wheelOffset]=wheelVal;
          }

          // Shutter
          if(fa.shutterOffset!==null){const sAddr=pf.startAddress+fa.shutterOffset;
            const trackStrobe = (() => {
              if (fixtureTracksRef?.current && fixtureGroupsRef?.current) {
                for (const ft of fixtureTracksRef.current) {
                  if (!ft.enabled) continue;
                  const targets = resolveTrackTargets(ft, patchedFixtures, fixtureGroupsRef.current);
                  if (!targets.includes(pf.id)) continue;
                  const activeBlock = ft.strobeBlocks.find(b => ct >= b.time && ct < b.endTime);
                  if (activeBlock) {
                    let speed = activeBlock.speed;
                    if (activeBlock.endSpeed && activeBlock.endSpeed !== activeBlock.speed) {
                      const dur = activeBlock.endTime - activeBlock.time;
                      const t = dur > 0 ? (ct - activeBlock.time) / dur : 0;
                      speed = activeBlock.speed + (activeBlock.endSpeed - activeBlock.speed) * t;
                    }
                    return { active: true, speed };
                  }
                }
              }
              return null;
            })();
            const useStrobe = trackStrobe
              ? trackStrobe.active
              : active.forcedStrobe !== undefined ? active.forcedStrobe : ((isDrop || isChorus) && active.strobe && pf.tier === 'primary');
            if (useStrobe) {const speed = Math.min(trackStrobe?.speed || active.strobeSpeed || 10, strobeLimit); chVals[sAddr] = Math.min(255, 180 + Math.floor(speed * 3));}
            else if(fa.intensityOffset===null){chVals[sAddr]=Math.max(8,Math.min(255,8+Math.round((dimmerVal/255)*247)));}
            else{chVals[sAddr]=255;}}

          // PAN/TILT — check EFX override first, fall back to auto pattern
          const panCount=fa.panOffsets.length;const tiltCount=fa.tiltOffsets.length;const motorCount=Math.max(panCount,tiltCount,1);
          if(panCount>0||tiltCount>0){
            let efxPan=NaN,efxTilt=NaN;
            if(panCount>0){const pa=pf.startAddress+fa.panOffsets[0];if(efxMap[pa]!==undefined)efxPan=efxMap[pa];}
            if(tiltCount>0){const ta=pf.startAddress+fa.tiltOffsets[0];if(efxMap[ta]!==undefined)efxTilt=efxMap[ta];}
            if(!isNaN(efxPan)||!isNaN(efxTilt)){
              for(let m=0;m<motorCount;m++){if(m<panCount)chVals[pf.startAddress+fa.panOffsets[m]]=isNaN(efxPan)?128:efxPan;if(m<tiltCount)chVals[pf.startAddress+fa.tiltOffsets[m]]=isNaN(efxTilt)?128:efxTilt;}
            }else if(efxPtOverrides?.has(pf.id)){
              // EFX track pan/tilt override (from saved effects on timeline)
              const ept = efxPtOverrides.get(pf.id)!;
              if (pf.id === patchedFixtures[0]?.id) console.log('EFX pt', ct.toFixed(2), 'pan', ept.pan, 'tilt', ept.tilt);
              for(let m=0;m<motorCount;m++){if(m<panCount)chVals[pf.startAddress+fa.panOffsets[m]]=ept.pan;if(m<tiltCount)chVals[pf.startAddress+fa.tiltOffsets[m]]=ept.tilt;}
            }else{
              const trackMovement = (() => {
                if (fixtureTracksRef?.current && fixtureGroupsRef?.current) {
                  for (const ft of fixtureTracksRef.current) {
                    if (!ft.enabled) continue;
                    const targets = resolveTrackTargets(ft, patchedFixtures, fixtureGroupsRef.current);
                    if (!targets.includes(pf.id)) continue;
                    const activeBlock = ft.movementBlocks.find(b => ct >= b.time && ct < b.endTime);
                    if (activeBlock) return activeBlock;
                  }
                }
                return null;
              })();
              const amplitude = trackMovement
                ? trackMovement.amplitude
                : active.movementAmplitude !== undefined
                  ? Math.round(active.movementAmplitude * 128)
                  : pf.tier === 'primary' ? 90 : pf.tier === 'secondary' ? 70 : 40;
                const movPattern = (() => {
                  if (trackMovement) return trackMovement.pattern;
                  // Section name → getSmartMovement distributes per-fixture (multi-fixture choreography)
                  // Explicit pattern names pass through directly
                  const cueMov = active.movement;
                  if (cueMov) {
                    const explicitPatterns = new Set(['sweep','circle','bounce','wave','figure8','zigzag','diamond','spiral','heartbeat','randomWalk','panOnly','tiltOnly','static','pulse']);
                    if (!explicitPatterns.has(cueMov)) {
                      // Section name → smart distribution
                      let mobileIdx = -1, totalMobile = 0;
                      for (const ffa of fixtures) {
                        if (ffa.panOffsets.length > 0 || ffa.tiltOffsets.length > 0) {
                          if (ffa.fixture.id === pf.id) mobileIdx = totalMobile;
                          totalMobile++;
                        }
                      }
                      if (mobileIdx >= 0) return getSmartMovement(mobileIdx, totalMobile, cueMov, ct);
                      return cueMov;
                    }
                    return cueMov; // explicit pattern
                  }
                  // Fallback: smart distribution based on section
                  let mobileIdx = -1, totalMobile = 0;
                  for (const ffa of fixtures) {
                    if (ffa.panOffsets.length > 0 || ffa.tiltOffsets.length > 0) {
                      if (ffa.fixture.id === pf.id) mobileIdx = totalMobile;
                      totalMobile++;
                    }
                  }
                  if (mobileIdx >= 0) {
                    return getSmartMovement(mobileIdx, totalMobile, sec, ct);
                  }
                  return sec;
                })();
              if(amplitude>0){for(let m=0;m<motorCount;m++){const motorPhase=m*(Math.PI*2/motorCount);const speedMult=active.movementSpeed??1;const phase=(ct*Math.PI*2*speedMult)+motorPhase+movementPhase;let px=0,py=0;
                switch(movPattern){case'intro':px=Math.sin(phase*.1)*.3;py=Math.cos(phase*.08+motorPhase)*.3;break;case'verse':px=Math.sin(phase*.25)*.5;py=Math.cos(phase*.2+motorPhase)*.4;break;case'chorus':px=Math.sin(phase*.5)*.7;py=Math.cos(phase*.5+motorPhase)*.7;break;case'bridge':px=Math.sin(phase*.3)*.5;py=Math.sin(phase*.6+motorPhase)*.5;break;case'drop':px=Math.sin(phase*.8)*.9;py=Math.cos(phase*1.2+motorPhase)*.6;break;case'outro':px=Math.sin(phase*.15)*.2;py=Math.cos(phase*.12+motorPhase)*.2;break;case'sweep':px=Math.sin(phase*.35+motorPhase)*.7;py=Math.cos(phase*.3+motorPhase)*.5;break;case'circle':px=Math.sin(phase*.5+motorPhase)*.7;py=Math.cos(phase*.5+motorPhase)*.7;break;case'bounce':px=Math.sin(phase*.4+motorPhase)*.5;py=Math.abs(Math.sin(phase*.8+motorPhase))*.8;break;case'wave':px=Math.sin(phase*.6+motorPhase)*.5;py=Math.sin(phase*.35+motorPhase*1.5)*.5;break;case'figure8':px=Math.sin(phase*.4+motorPhase)*.6;py=Math.sin(phase*.8+motorPhase)*.5;break;case'static':px=Math.sin(phase*.05+motorPhase)*.1;py=Math.cos(phase*.05+motorPhase)*.1;break;
                case'zigzag':{const saw=((phase/Math.PI)%2)-1;px=saw*.8;py=Math.sin(phase)>0?.5:-.5;}break;case'diamond':{px=(((phase/Math.PI)%2)-1)*.8;py=((((phase+Math.PI/2)/Math.PI)%2)-1)*.8;}break;case'spiral':{const r=.3+.7*Math.abs(Math.sin(phase*.3));px=Math.sin(phase*2)*r;py=Math.cos(phase*2)*r;}break;case'heartbeat':{const hp=((phase/(Math.PI*2))%1);const hb=hp<.15?1:hp<.3?.6:0;px=hb*Math.sin(phase*3);py=hb*Math.cos(phase*3);}break;case'randomWalk':px=Math.sin(phase*.7)*.5+Math.sin(phase*1.3)*.3+Math.cos(phase*2.1)*.2;py=Math.cos(phase*.6)*.5+Math.sin(phase*1.7)*.3+Math.sin(phase*2.3)*.2;break;case'panOnly':px=Math.sin(phase);py=0;break;case'tiltOnly':px=0;py=Math.sin(phase);break;
      // Fallback: sine wave with reduced amplitude for smoother motion
      px=Math.sin(phase*.35)*.4;py=Math.cos(phase*.3+motorPhase)*.4;}
                if(m<panCount)chVals[pf.startAddress+fa.panOffsets[m]]=Math.max(0,Math.min(255,Math.round(128+px*amplitude)));
                if(m<tiltCount)chVals[pf.startAddress+fa.tiltOffsets[m]]=Math.max(0,Math.min(255,Math.round(128+py*amplitude)));}
              }else{for(const po of fa.panOffsets)chVals[pf.startAddress+po]=128;for(const to of fa.tiltOffsets)chVals[pf.startAddress+to]=128;}
            }
          }

          // GOBO / PRISM / ZOOM / FROST / IRIS / FOCUS — audio-reactive
          const fxEnergy = (active.energy ?? 0.5);
          const fxPhase = ct * Math.PI * 2 * (active.movementSpeed ?? 1);

          if(fa.goboOffset!==null){const gAddr=pf.startAddress+fa.goboOffset;
            if(fa.goboCaps.length>0){
              const gc=Math.max(1,fa.goboCaps.length);
              const gi=Math.floor((fxPhase*0.5)%gc);
              chVals[gAddr]=Math.round((fa.goboCaps[gi].min+fa.goboCaps[gi].max)/2);
            }else{
              chVals[gAddr]=Math.round(fxEnergy*255);
            }
          }
          if(fa.prismOffset!==null){const pAddr=pf.startAddress+fa.prismOffset;
            chVals[pAddr]=Math.round(Math.max(0,Math.min(255,64+Math.sin(fxPhase*0.7)*128*fxEnergy)));
          }
          if(fa.zoomOffset!==null){const zAddr=pf.startAddress+fa.zoomOffset;
            chVals[zAddr]=Math.round(64+Math.sin(fxPhase*0.4)*96*fxEnergy+64*fxEnergy);
          }
          if(fa.frostOffset!==null){const fAddr=pf.startAddress+fa.frostOffset;
            chVals[fAddr]=Math.round(Math.max(0,255-(fxEnergy*255)));
          }
          if(fa.irisOffset!==null){const iAddr=pf.startAddress+fa.irisOffset;
            chVals[iAddr]=Math.round(40+fxEnergy*200+Math.sin(fxPhase*0.5)*15*fxEnergy);
          }
          if(fa.focusOffset!==null){const fcAddr=pf.startAddress+fa.focusOffset;
            chVals[fcAddr]=Math.round(80+fxEnergy*120+Math.sin(fxPhase*0.3)*30);
          }
        }

        if(Object.keys(chVals).length>0){
          const sig=String(uniIdx)+':'+Object.entries(chVals).sort((a,b)=>Number(a[0])-Number(b[0])).map(([k,v])=>`${k}=${v}`).join(',');
          if(sig!==lastSig){lastSig=sig;
            // Mirror DMX to React store for 3D Stage view
            useAppStore.getState().setUniverseData(uniIdx, chVals);
            // Direct bridge to Stage3D — bypasses store for guaranteed delivery
            dmxBridge.push(uniIdx, chVals);
            if (onVirtualDmx) onVirtualDmx(uniIdx, chVals);
            api.setChannels(uniIdx,chVals).catch(()=>{});}
        }
      }
      rafRef.current=requestAnimationFrame(tick);
    };

    rafRef.current=requestAnimationFrame(tick);
    return()=>{cancelAnimationFrame(rafRef.current);};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[isPlaying]);
}

// ═══════════════════════════════════════════════════════════
// Standalone DMX computation (for VC AudioAutoScript, etc.)
// ═══════════════════════════════════════════════════════════

export function computeDmxForCue(
  cue: CuePlayback & { energy?: number },
  patchedFixtures: PatchedFixture[],
  fixtureDefs: Map<string, DmxFixtureDefinition>,
  universes: { id: string }[],
  tierMultipliers?: { primary: number; secondary: number; tertiary: number },
  fixtureTrackOverrides?: {
    forcedColors?: Map<string, string>;
    forcedDimmers?: Map<string, number>;
    forcedStrobes?: Map<string, { active: boolean; speed: number }>;
    forcedMovements?: Map<string, { pattern: string; amplitude: number }>;
  },
  colorTrackColors?: Map<string, string>,
): Array<{ universe: number; channelValues: Record<number, number> }> {
  const uniIds = universes.map(u => String(u.id));
  const analyses: ChannelAnalysis[] = [];
  for (const pf of patchedFixtures) {
    const def = fixtureDefs.get(pf.fixtureDefId);
    const fa = analyzeChannels(pf, def);
    fa.universeIndex = uniIds.indexOf(pf.universeId);
    if (fa.universeIndex < 0) fa.universeIndex = 0;
    analyses.push(fa);
  }
  const byUniverse = new Map<number, ChannelAnalysis[]>();
  for (const fa of analyses) {
    const list = byUniverse.get(fa.universeIndex) ?? [];
    list.push(fa);
    byUniverse.set(fa.universeIndex, list);
  }

  const energy = cue.energy ?? (
    cue.intensity === 'very-high' ? 0.95 :
    cue.intensity === 'high' ? 0.8 :
    cue.intensity === 'medium' ? 0.5 :
    cue.intensity === 'low' ? 0.25 : 0.1
  );
  const isDrop = cue.section.toLowerCase() === 'drop';
  const isChorus = cue.section.toLowerCase() === 'chorus';
  const sec = cue.section.toLowerCase();

  const results: Array<{ universe: number; channelValues: Record<number, number> }> = [];

  for (const [uniIdx, fixtures] of byUniverse.entries()) {
    const chVals: Record<number, number> = {};

    for (let fi = 0; fi < fixtures.length; fi++) {
      const fa = fixtures[fi];
      const pf = fa.fixture;

      const dimmerVal = (fixtureTrackOverrides?.forcedDimmers?.has(pf.id))
        ? fixtureTrackOverrides.forcedDimmers.get(pf.id)!
        : mapIntensity(cue.intensity, energy, pf.tier, tierMultipliers);
      if (fa.intensityOffset !== null) {
        const addr = pf.startAddress + fa.intensityOffset;
        if (!chVals[addr] || dimmerVal > chVals[addr]) chVals[addr] = dimmerVal;
      }

      const tierColorIdx = pf.tier === 'secondary' ? 1 : pf.tier === 'tertiary' ? 2 : 0;
      // Color track > fixture track > cue color
      let paletteColor = (colorTrackColors?.has(pf.id))
        ? colorTrackColors.get(pf.id)!
        : (fixtureTrackOverrides?.forcedColors?.has(pf.id))
        ? fixtureTrackOverrides.forcedColors.get(pf.id)!
        : (() => {
          return (cue as any).forcedColor || cue.color || cue.colors?.[0] || undefined;
        })();

      if (fa.rgbSegments.length > 0 && paletteColor) {
        let [r, g, b] = hexToRgb(paletteColor);
        // Force Color Preset/Macro channels to 255 (RGB/DMX mode) for raw RGB control
        for (const po of fa.presetOverrideOffsets) { chVals[pf.startAddress + po] = 0; }
        for (const seg of fa.rgbSegments) {
          chVals[pf.startAddress + seg.r] = r;
          chVals[pf.startAddress + seg.g] = g;
          chVals[pf.startAddress + seg.b] = b;
          if (seg.w !== null) chVals[pf.startAddress + seg.w] = 0;
        }
      } else if (fa.wheelOffset !== null && paletteColor) {
        const caps = fa.wheelCaps;
        let wheelVal: number;
        if (caps.length > 0) {
          const bestCap = findBestWheelCap(caps, paletteColor);
          wheelVal = bestCap ? Math.round((bestCap.min + bestCap.max) / 2) : (() => {const[r,g,b]=hexToRgb(paletteColor);const cat2=classifyColor(r,g,b);const catMap:Record<string,number>={red:0.10,orange:0.20,yellow:0.30,green:0.42,cyan:0.55,blue:0.68,magenta:0.78,purple:0.78,white:0.02};const wPos=catMap[cat2]??0.5;const capIdx=Math.floor(wPos*caps.length)%caps.length;return Math.round((caps[capIdx].min+caps[capIdx].max)/2);})();
        } else {
          const[r,g,b]=hexToRgb(paletteColor);const cat2=classifyColor(r,g,b);const catMap:Record<string,number>={red:0.10,orange:0.20,yellow:0.30,green:0.42,cyan:0.55,blue:0.68,magenta:0.78,purple:0.78,white:0.02};const wPos=catMap[cat2]??0.5;wheelVal=Math.round(wPos*255);
        }
        chVals[pf.startAddress + fa.wheelOffset] = wheelVal;
      }

      if (fa.shutterOffset !== null) {
        const sAddr = pf.startAddress + fa.shutterOffset;
        const trackStrobe = fixtureTrackOverrides?.forcedStrobes?.get(pf.id);
        const useStrobe = trackStrobe 
          ? trackStrobe.active
          : (cue as any).forcedStrobe !== undefined ? (cue as any).forcedStrobe : ((isDrop || isChorus) && cue.strobe && pf.tier === 'primary');
        if (useStrobe) {
          const speed = Math.min(trackStrobe?.speed || (cue as any).strobeSpeed || 10, 10);
          chVals[sAddr] = Math.min(255, 180 + Math.floor(speed * 3));
        } else if (fa.intensityOffset === null) {
          chVals[sAddr] = Math.max(8, Math.min(255, 8 + Math.round((dimmerVal / 255) * 247)));
        } else {
          chVals[sAddr] = 255;
        }
      }

      const panCount = fa.panOffsets.length;
      const tiltCount = fa.tiltOffsets.length;
      const motorCount = Math.max(panCount, tiltCount, 1);
      if (panCount > 0 || tiltCount > 0) {
        const trackMovement = fixtureTrackOverrides?.forcedMovements?.get(pf.id);
        const amplitude = trackMovement
          ? trackMovement.amplitude
          : (cue as any).movementAmplitude !== undefined
            ? Math.round((cue as any).movementAmplitude * 128)
            : pf.tier === 'primary' ? 90 : pf.tier === 'secondary' ? 70 : 40;
        if (amplitude > 0) {
          const speedMult = (cue as any).movementSpeed ?? 1;
          const phase = cue.time * Math.PI * 2 * speedMult;
          for (let m = 0; m < motorCount; m++) {
            const motorPhase = m * (Math.PI * 2 / motorCount);
            const movSec = (() => {
              if (trackMovement) return trackMovement.pattern;
              // Section name → getSmartMovement distributes per-fixture (multi-fixture choreography)
              const cueMov = (cue as any).movement;
              if (cueMov) {
                const explicitPatterns = new Set(['sweep','circle','bounce','wave','figure8','zigzag','diamond','spiral','heartbeat','randomWalk','panOnly','tiltOnly','static','pulse']);
                if (!explicitPatterns.has(cueMov)) {
                  let mobileIdx = -1, totalMobile = 0;
                  for (const a of analyses) {
                    if (a.panOffsets.length > 0 || a.tiltOffsets.length > 0) {
                      if (a.fixture.id === pf.id) mobileIdx = totalMobile;
                      totalMobile++;
                    }
                  }
                  if (mobileIdx >= 0) return getSmartMovement(mobileIdx, totalMobile, cueMov, cue.time);
                  return cueMov;
                }
                return cueMov;
              }
              let mobileIdx = -1, totalMobile = 0;
              for (const a of analyses) {
                if (a.panOffsets.length > 0 || a.tiltOffsets.length > 0) {
                  if (a.fixture.id === pf.id) mobileIdx = totalMobile;
                  totalMobile++;
                }
              }
              if (mobileIdx >= 0) return getSmartMovement(mobileIdx, totalMobile, sec, cue.time);
              return sec;
            })();
            let px = 0, py = 0;
            switch (movSec) {
              case 'intro': px = Math.sin(phase * .1) * .3; py = Math.cos(phase * .08 + motorPhase) * .3; break;
              case 'verse': px = Math.sin(phase * .25) * .5; py = Math.cos(phase * .2 + motorPhase) * .4; break;
              case 'chorus': px = Math.sin(phase * .5) * .7; py = Math.cos(phase * .5 + motorPhase) * .7; break;
              case 'bridge': px = Math.sin(phase * .3) * .5; py = Math.sin(phase * .6 + motorPhase) * .5; break;
              case 'drop': px = Math.sin(phase * .8) * .9; py = Math.cos(phase * 1.2 + motorPhase) * .6; break;
              case 'outro': px = Math.sin(phase * .15) * .2; py = Math.cos(phase * .12 + motorPhase) * .2; break;
              case 'sweep': px = Math.sin(phase * .35 + motorPhase) * .7; py = Math.cos(phase * .3 + motorPhase) * .5; break;
              case 'circle': px = Math.sin(phase * .5 + motorPhase) * .7; py = Math.cos(phase * .5 + motorPhase) * .7; break;
              case 'bounce': px = Math.sin(phase * .4 + motorPhase) * .5; py = Math.abs(Math.sin(phase * .8 + motorPhase)) * .8; break;
              case 'wave': px = Math.sin(phase * .6 + motorPhase) * .5; py = Math.sin(phase * .35 + motorPhase * 1.5) * .5; break;
              case 'figure8': px = Math.sin(phase * .4 + motorPhase) * .6; py = Math.sin(phase * .8 + motorPhase) * .5; break;
              case 'static': px = Math.sin(phase * .05 + motorPhase) * .1; py = Math.cos(phase * .05 + motorPhase) * .1; break;
              case 'zigzag': { const saw = ((phase / Math.PI) % 2) - 1; px = saw * .8; py = Math.sin(phase) > 0 ? .5 : -.5; } break;
              case 'diamond': { px = (((phase / Math.PI) % 2) - 1) * .8; py = ((((phase + Math.PI / 2) / Math.PI) % 2) - 1) * .8; } break;
              case 'spiral': { const r = .3 + .7 * Math.abs(Math.sin(phase * .3)); px = Math.sin(phase * 2) * r; py = Math.cos(phase * 2) * r; } break;
              case 'heartbeat': { const hp = ((phase / (Math.PI * 2)) % 1); const hb = hp < .15 ? 1 : hp < .3 ? .6 : 0; px = hb * Math.sin(phase * 3); py = hb * Math.cos(phase * 3); } break;
              case 'randomWalk': px = Math.sin(phase * .7) * .5 + Math.sin(phase * 1.3) * .3 + Math.cos(phase * 2.1) * .2; py = Math.cos(phase * .6) * .5 + Math.sin(phase * 1.7) * .3 + Math.sin(phase * 2.3) * .2; break;
              case 'panOnly': px = Math.sin(phase); py = 0; break;
              case 'tiltOnly': px = 0; py = Math.sin(phase); break;
              default: px = Math.sin(phase * .35) * .5; py = Math.cos(phase * .3 + motorPhase) * .5;
            }
            if (m < panCount) chVals[pf.startAddress + fa.panOffsets[m]] = Math.max(0, Math.min(255, Math.round(128 + px * amplitude)));
            if (m < tiltCount) chVals[pf.startAddress + fa.tiltOffsets[m]] = Math.max(0, Math.min(255, Math.round(128 + py * amplitude)));
          }
        } else {
          for (const po of fa.panOffsets) chVals[pf.startAddress + po] = 128;
          for (const to of fa.tiltOffsets) chVals[pf.startAddress + to] = 128;
        }
      }

      // GOBO / PRISM / ZOOM / FROST / IRIS / FOCUS — audio-reactive
      const fxEnergy = (cue as any).energy ?? 0.5;
      const fxPhase = cue.time * Math.PI * 2 * ((cue as any).movementSpeed ?? 1);

      if (fa.goboOffset !== null) {
        const gAddr = pf.startAddress + fa.goboOffset;
        if (fa.goboCaps.length > 0) {
          const goboCount = Math.max(1, fa.goboCaps.length);
          const goboIdx = Math.floor((fxPhase * 0.5) % goboCount);
          chVals[gAddr] = Math.round((fa.goboCaps[goboIdx].min + fa.goboCaps[goboIdx].max) / 2);
        } else {
          chVals[gAddr] = Math.round(fxEnergy * 255);
        }
      }

      if (fa.prismOffset !== null) {
        chVals[pf.startAddress + fa.prismOffset] = Math.round(Math.max(0, Math.min(255, 64 + Math.sin(fxPhase * 0.7) * 128 * fxEnergy)));
      }

      if (fa.zoomOffset !== null) {
        chVals[pf.startAddress + fa.zoomOffset] = Math.round(64 + Math.sin(fxPhase * 0.4) * 96 * fxEnergy + 64 * fxEnergy);
      }

      if (fa.frostOffset !== null) {
        chVals[pf.startAddress + fa.frostOffset] = Math.round(Math.max(0, 255 - (fxEnergy * 255)));
      }

      if (fa.irisOffset !== null) {
        chVals[pf.startAddress + fa.irisOffset] = Math.round(40 + fxEnergy * 200 + Math.sin(fxPhase * 0.5) * 15 * fxEnergy);
      }

      if (fa.focusOffset !== null) {
        chVals[pf.startAddress + fa.focusOffset] = Math.round(80 + fxEnergy * 120 + Math.sin(fxPhase * 0.3) * 30);
      }
    }

    results.push({ universe: uniIdx, channelValues: chVals });
  }

  return results.filter(r => Object.keys(r.channelValues).length > 0);
}
