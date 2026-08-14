// ─── DMX Channel Analysis ────────────────────────────────
// Extracted from dmx-playback.ts — fixture channel capability analysis

import type { PatchedFixture } from '../stores/showStore';
import type { DmxFixtureDefinition, DmxFixtureCapability } from './dmx-cues';
import { RgbSegment, startsWithRgb, hasColorWord, isRed, isGreen, isBlue, isWhite, isPresetMode, buildRgbSegments } from './dmx-color';

export interface ChannelAnalysis {
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
  presetOverrideOffsets: number[];
}

const _logged = new Set<string>();

export function analyzeChannels(pf: PatchedFixture, def: DmxFixtureDefinition|undefined): ChannelAnalysis {
  const channels=def?.modes[pf.modeIndex]?.channels??[];
  const fa: ChannelAnalysis={fixture:pf,intensityOffset:null,shutterOffset:null,rgbSegments:[],wheelOffset:null,wheelCaps:[],panOffsets:[],tiltOffsets:[],channelCount:channels.length,universeIndex:0,goboOffset:null,goboCaps:[],prismOffset:null,zoomOffset:null,frostOffset:null,irisOffset:null,focusOffset:null,presetOverrideOffsets:[]};
  const colourChannels: Array<{offset:number;name:string;caps?:DmxFixtureCapability[]}>=[];
  for(let i=0;i<channels.length;i++){const ch=channels[i];const off=ch.offset??i;const chName=(ch.name?.trim()??'');
    if(isPresetMode.test(chName)){fa.presetOverrideOffsets.push(off);continue;}
    const isShutterDimmer = /\bdimmer\b/i.test(chName) && ch.type === 'Shutter';
    if(isShutterDimmer && fa.intensityOffset === null){fa.intensityOffset = off;}
    const hasColorCaps=ch.capabilities?.some(cap=>cap.color);
    if(startsWithRgb.test(chName)||ch.type==='Colour'||(ch.type==='Beam'&&hasColorWord.test(chName))||hasColorCaps){colourChannels.push({offset:off,name:chName,caps:ch.capabilities});continue;}
    switch(ch.type){case'Intensity':if(fa.intensityOffset===null)fa.intensityOffset=off;break;case'Shutter':case'Effect':if(fa.shutterOffset===null)fa.shutterOffset=off;break;case'Pan':fa.panOffsets.push(off);break;case'Tilt':fa.tiltOffsets.push(off);break;case'Gobo':if(fa.goboOffset===null){fa.goboOffset=off;fa.goboCaps=ch.capabilities??[];}break;case'Prism':if(fa.prismOffset===null)fa.prismOffset=off;break;case'Zoom':if(fa.zoomOffset===null)fa.zoomOffset=off;break;case'Frost':case'Focus':if(fa.frostOffset===null)fa.frostOffset=off;break;case'Iris':if(fa.irisOffset===null)fa.irisOffset=off;break;}}
  if(colourChannels.length>0){const hasRgbStart=colourChannels.some(c=>startsWithRgb.test(c.name));
    const hasRgbWords=colourChannels.some(c=>isRed.test(c.name))&&colourChannels.some(c=>isGreen.test(c.name))&&colourChannels.some(c=>isBlue.test(c.name));
    const hasRgbNames=(hasRgbStart||hasRgbWords)&&colourChannels.length>=3;
    const hasColorCaps=colourChannels.some(c=>c.caps?.some(cap=>cap.color));
    if(hasRgbNames){fa.rgbSegments=buildRgbSegments(colourChannels);}
    else if(hasColorCaps){const wheel=colourChannels.find(c=>c.caps?.some(cap=>cap.color));if(wheel){fa.wheelOffset=wheel.offset;fa.wheelCaps=wheel.caps??[];}}
    else if(colourChannels.length>=3){fa.rgbSegments=buildRgbSegments(colourChannels);if(fa.rgbSegments.length===0){fa.rgbSegments=[{r:colourChannels[0].offset,g:colourChannels[1].offset,b:colourChannels[2].offset,w:null}];}}
    else{fa.wheelOffset=colourChannels[0].offset;const ch=channels.find(c=>(c.offset??channels.indexOf(c))===colourChannels[0].offset);if(ch?.capabilities&&ch.capabilities.length>0)fa.wheelCaps=ch.capabilities;}
  }
  if(fa.wheelOffset!==null&&fa.wheelCaps.length===0){const ch=channels.find(c=>(c.offset??channels.indexOf(c))===fa.wheelOffset);if(ch?.capabilities&&ch.capabilities.length>0)fa.wheelCaps=ch.capabilities;}
  if (!_logged.has(pf.id)) {
    _logged.add(pf.id);
    console.log(`[analyzeChannels] ${pf.name} (${pf.fixtureType}, tier=${pf.tier}, addr=${pf.startAddress})`,
      `| colourChannels: ${colourChannels.length} [${colourChannels.map(c=>`${c.name}@${c.offset}`).join(', ')}]`,
      `| rgbSegments: ${fa.rgbSegments.length>0?fa.rgbSegments.map(s=>`R${s.r}G${s.g}B${s.b}`).join('; '):'∅'}`,
      `| wheelOffset: ${fa.wheelOffset} (caps:${fa.wheelCaps.length})`,
      `| intensityOffset: ${fa.intensityOffset} shutterOffset: ${fa.shutterOffset}`,
      `| panOffsets: [${fa.panOffsets.join(',')}] tiltOffsets: [${fa.tiltOffsets.join(',')}]`);
  }
  return fa;
}
