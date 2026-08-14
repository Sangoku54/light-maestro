import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Grid, Sliders, Crosshair, Music, Zap, ChevronRight, Settings,
  Plus, MousePointer2, ToggleLeft, GripHorizontal, Columns, Trash2,
  Copy, Maximize2, Minimize2, Square, Keyboard, Eye, EyeOff,
  ChevronUp, ChevronDown, Hash, Download, Upload, RotateCcw, Loader, Wifi
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { useShowStore, type SavedCueList, type CueListCue, type SongPreset } from '../stores/showStore';
import { computeDmxCues, loadFixtureDefinitions, type CueInput, type DmxCue } from '../hooks/dmx-cues';
import { computeDmxForCue } from '../hooks/dmx-playback';
import { SongPresetPlayer } from '../components/SongPresetPlayer';
import { analyzeAudioBuffer, type TrackAnalysis } from '../hooks/audio-analysis';
import { sendChannelsToHardware, sendToUniverse } from '../utils/dmx-helpers';
import { dmxBridge } from '../utils/dmx-bridge';
import { Stage3D } from './stage3d';
import {
  usePerformStore,
  ConsoleWidget,
  ConsoleWidgetConfig,
  WidgetType
} from '../stores/performStore';

/**
 * Performance View — Virtual Console + Live Controls
 */

export const PerformanceView: React.FC = () => {
  const activeTab = useAppStore((s) => s.performSidebarTab);

  // #17 — Remote LAN : le type PerformSidebarTab (appStore) n'inclut pas
  // encore 'remote' (lot serveur en parallèle) ; comparaison élargie pour
  // enregistrer le panneau dans le même conteneur que MIDIMappingPanel.
  if ((activeTab as string) === 'remote') return <RemotePanel />;

  switch (activeTab) {
    case 'vconsole': return <VirtualConsolePanel />;
    case 'midi': return <MIDIMappingPanel />;
    case 'simpledesk': return <SimpleDeskPanel />;
    case 'cuelist': return <CueListViewPanel />;
    case 'settings': return <PerformSettingsPanel />;
    default: return <VirtualConsolePanel />;
  }
};

/**
 * Zero every patched universe through the VC arbiter source (LTP).
 * Replaces the duplicated inline blackout blocks: each universe is written
 * exactly once instead of once per patched fixture.
 */
function vcZeroAllUniverses() {
  try {
    const s = useShowStore.getState();
    const uniIds = s.universes.map((u: any) => String(u.id));
    const z: Record<number, number> = {};
    for (let i = 1; i <= 512; i++) z[i] = 0;
    const seen = new Set<number>();
    for (const pf of s.patchedFixtures) {
      const uniNum = uniIds.indexOf(pf.universeId) >= 0 ? uniIds.indexOf(pf.universeId) : 0;
      if (seen.has(uniNum)) continue;
      seen.add(uniNum);
      // Transient: the zeros flush the hardware, then the source is released
      // after 2 s so the playback engine regains control. A persistent LTP
      // zero block would keep the show dark forever after a routine stop.
      try { dmxBridge.writeTransient('vc', uniNum, z); } catch {}
    }
  } catch {}
}

// ═══════════════════════════════════════════════════════════
// VIRTUAL CONSOLE PANEL
// ═══════════════════════════════════════════════════════════

const GRID_SIZE = 20;

const VirtualConsolePanel: React.FC = () => {
  const { t } = useTranslation();
  const pages = usePerformStore((s) => s.vcPages);
  const activePage = usePerformStore((s) => s.vcActivePage);
  const widgets = usePerformStore((s) => s.vcWidgets);
  const gridSnap = usePerformStore((s) => s.vcGridSnap);
  const addingWidget = usePerformStore((s) => s.addingWidget);
  const vcSetActivePage = usePerformStore((s) => s.vcSetActivePage);
  const vcAddPage = usePerformStore((s) => s.vcAddPage);
  const vcDeletePage = usePerformStore((s) => s.vcDeletePage);
  const vcSetGridSnap = usePerformStore((s) => s.vcSetGridSnap);
  const vcSetAddingWidget = usePerformStore((s) => s.vcSetAddingWidget);

  const [showPalette, setShowPalette] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; widgetId: string } | null>(null);
  const [showWidgetConfig, setShowWidgetConfig] = useState<string | null>(null);
  const paletteRef = useRef<HTMLDivElement>(null);

  // Floating 3D stage view
  const [showFloating3D, setShowFloating3D] = useState(false);
  const [float3DPos, setFloat3DPos] = useState({ x: 200, y: 100 });
  const [float3DSize, setFloat3DSize] = useState({ w: 960, h: 540 });
  const float3DDragRef = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null);
  const float3DResizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  const handleFloat3DDragStart = useCallback((e: React.MouseEvent) => {
    float3DDragRef.current = { startX: e.clientX, startY: e.clientY, startLeft: float3DPos.x, startTop: float3DPos.y };
    const onMove = (ev: MouseEvent) => {
      if (!float3DDragRef.current) return;
      setFloat3DPos({
        x: float3DDragRef.current.startLeft + ev.clientX - float3DDragRef.current.startX,
        y: float3DDragRef.current.startTop + ev.clientY - float3DDragRef.current.startY,
      });
    };
    const onUp = () => { float3DDragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [float3DPos]);

  const handleFloat3DResizeStart = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    float3DResizeRef.current = { startX: e.clientX, startY: e.clientY, startW: float3DSize.w, startH: float3DSize.h };
    const onMove = (ev: MouseEvent) => {
      if (!float3DResizeRef.current) return;
      setFloat3DSize({
        w: Math.max(320, float3DResizeRef.current.startW + ev.clientX - float3DResizeRef.current.startX),
        h: Math.max(200, float3DResizeRef.current.startH + ev.clientY - float3DResizeRef.current.startY),
      });
    };
    const onUp = () => { float3DResizeRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [float3DSize]);

  // Show playback state (for local playback in Performance view)
  const showScenes = useShowStore(s => s.scenes);
  const showChasers = useShowStore(s => s.chasers);
  const showEffects = useShowStore(s => s.effects);
  const showPatchedFixtures = useShowStore(s => s.patchedFixtures);
  const showUniverses = useShowStore(s => s.universes);
  const showPlaybackRef = useRef<{
    rafId: number;
    startTime: number;
    showData: any;
    fixtureDefs: Map<string, any>;
    audioCtx: AudioContext | null;
    audioBuffers: Map<string, AudioBuffer>;
    audioSources: AudioBufferSourceNode[];
    startedAudios: Set<string>;
  } | null>(null);

  const pageWidgets = widgets.filter((w) => w.pageIndex === activePage);

  // Close palette on outside click
  useEffect(() => {
    if (!showPalette) return;
    const handler = (e: MouseEvent) => {
      if (paletteRef.current && !paletteRef.current.contains(e.target as Node)) {
        setShowPalette(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPalette]);

  // Close context menu on click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [contextMenu]);

  // ── Show Playback Engine (local RAF loop) ──
  useEffect(() => {
    const run = (window as any).__lm_perfPlayShow;
    if (!run) return;
    delete (window as any).__lm_perfPlayShow;
    const showData = run;

    // Cleanup any previous playback
    if (showPlaybackRef.current) {
      cancelAnimationFrame(showPlaybackRef.current.rafId);
      for (const src of showPlaybackRef.current.audioSources) { try { src.stop(); } catch {} }
    }

    const fixtureDefs = new Map<string, any>();
    const audioBuffers = new Map<string, AudioBuffer>();
    const audioSources: AudioBufferSourceNode[] = [];
    const startedAudios = new Set<string>();
    const startTime = performance.now();
    let audioCtx: AudioContext | null = null;

    const getAudioCtx = () => {
      if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      return audioCtx;
    };

    const getAudioBuffer = async (b64: string): Promise<AudioBuffer> => {
      if (audioBuffers.has(b64)) return audioBuffers.get(b64)!;
      const ctx = getAudioCtx();
      const resp = await fetch(b64);
      const ab = await resp.arrayBuffer();
      const buffer = await ctx.decodeAudioData(ab);
      audioBuffers.set(b64, buffer);
      return buffer;
    };

    // Preload fixture definitions for EFX tracks (non-blocking, outside RAF)
    const preloadDefs = async () => {
      for (const track of showData.tracks) {
        if (track.type !== 'efx') continue;
        const currentState = useShowStore.getState();
        for (const item of track.items) {
          const efx = currentState.effects.find((e: any) => e.id === item.resourceId);
          if (!efx) continue;
          const ids = efx.fixtureIds || [];
          for (const fid of ids) {
            if (fixtureDefs.has(fid)) continue;
            const pf = currentState.patchedFixtures.find((p: any) => p.id === fid);
            if (pf && !fixtureDefs.has(pf.fixtureDefId)) {
              try {
                const defs = await loadFixtureDefinitions([pf.fixtureDefId]);
                const def = defs?.get?.(pf.fixtureDefId);
                if (def) fixtureDefs.set(pf.fixtureDefId, def);
              } catch {}
            }
          }
        }
      }
    };
    void preloadDefs();

    // Preload audio buffers so fetch() doesn't block the RAF loop
    const preloadAudio = async () => {
      for (const track of showData.tracks) {
        if (track.type !== 'audio') continue;
        for (const item of track.items) {
          if (item.audioFileBase64 && !audioBuffers.has(item.audioFileBase64)) {
            try { await getAudioBuffer(item.audioFileBase64); } catch {}
          }
        }
      }
    };
    void preloadAudio();

    const stopPlayback = () => {
      if (showPlaybackRef.current) {
        cancelAnimationFrame(showPlaybackRef.current.rafId);
        for (const src of showPlaybackRef.current.audioSources) { try { src.stop(); } catch {} }
        try { showPlaybackRef.current.audioCtx?.close(); } catch {}
      }
      showPlaybackRef.current = null;
      delete (window as any).__lm_perfPlayActive;
      vcZeroAllUniverses();
    };

    // Register stop callback
    (window as any).__lm_perfStopPlayback = stopPlayback;
    (window as any).__lm_perfPlayActive = true;

    // DMX engine start
    try {
      const currentState = useShowStore.getState();
      if (currentState.universes.length > 0) {
        window.lightMaestro?.dmx?.start?.();
      }
    } catch {}

    const tick = () => {
      const pb = showPlaybackRef.current;
      if (!pb) return;
      const currentMs = performance.now() - pb.startTime;

      if (currentMs >= (showData.duration ?? 60000)) {
        stopPlayback();
        return;
      }

      const currentState = useShowStore.getState();
      const scenes = currentState.scenes;
      const chasers = currentState.chasers;
      const effects = currentState.effects;
      const patchedFixtures = currentState.patchedFixtures;
      const pi = Math.PI;

      for (const track of showData.tracks) {
        if (track.muted) continue;
        for (const item of track.items) {
          const itemStart = item.startTime;
          const itemEnd = item.startTime + item.duration;
          if (currentMs < itemStart || currentMs > itemEnd) {
            if (track.type === 'audio') pb.startedAudios.delete(item.id);
            continue;
          }

          const elapsed = currentMs - itemStart;
          const fadeInEnd = item.fadeIn || 0;
          const fadeOutStart = item.duration - (item.fadeOut || 0);
          let intensity = 1;
          if (elapsed < fadeInEnd && fadeInEnd > 0) intensity = elapsed / fadeInEnd;
          else if (elapsed > fadeOutStart && item.fadeOut > 0) intensity = 1 - (elapsed - fadeOutStart) / item.fadeOut;

          // Audio
          if (track.type === 'audio' && item.audioFileBase64 && !pb.startedAudios.has(item.id)) {
            pb.startedAudios.add(item.id);
            const audioOffsetSec = Math.max(0, elapsed) / 1000;
            getAudioBuffer(item.audioFileBase64).then((buffer) => {
              if (!showPlaybackRef.current) return;
              const ctx = audioCtx;
              if (!ctx || ctx.state === 'closed') return;
              if (ctx.state === 'suspended') ctx.resume();
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              source.start(0, audioOffsetSec);
              pb.audioSources.push(source);
              source.onended = () => {
                pb.audioSources = pb.audioSources.filter(s => s !== source);
              };
            }).catch(() => {});
          }

          // Scene
          if (track.type === 'scene' && item.resourceId) {
            const scene = scenes.find((s: any) => s.id === item.resourceId);
            if (scene?.channels) {
              const faded: Record<number, number> = {};
              for (const [addr, val] of Object.entries(scene.channels)) faded[Number(addr)] = Math.round(Number(val) * intensity);
              sendChannelsToHardware(faded, currentState.patchedFixtures, currentState.universes, 'vc').catch(() => {})
            }
          }

          // Chaser
          if (track.type === 'chaser' && item.resourceId) {
            const chaser = chasers.find((c: any) => c.id === item.resourceId);
            if (chaser?.steps?.length) {
              const cycleDur = chaser.steps.reduce((sum: number, s: any) => sum + s.fadeIn + s.hold + s.fadeOut, 0);
              if (cycleDur > 0) {
                const cyclePos = elapsed % cycleDur;
                let acc = 0;
                for (const step of chaser.steps) {
                  const stepDur = step.fadeIn + step.hold + step.fadeOut;
                  if (cyclePos >= acc && cyclePos < acc + stepDur) {
                    const stepElapsed = cyclePos - acc;
                    let stepIntensity = 1;
                    if (stepElapsed < step.fadeIn && step.fadeIn > 0) stepIntensity = stepElapsed / step.fadeIn;
                    else if (stepElapsed > step.fadeIn + step.hold && step.fadeOut > 0)
                      stepIntensity = 1 - (stepElapsed - step.fadeIn - step.hold) / step.fadeOut;
                    const sc = scenes.find((s: any) => s.id === step.sceneId);
                    if (sc?.channels) {
                      const faded: Record<number, number> = {};
                      for (const [addr, val] of Object.entries(sc.channels)) faded[Number(addr)] = Math.round(Number(val) * intensity * stepIntensity);
                      sendChannelsToHardware(faded, currentState.patchedFixtures, currentState.universes, 'vc').catch(() => {})
                    }
                    break;
                  }
                  acc += stepDur;
                }
              }
            }
          }

          // EFX
          if (track.type === 'efx' && item.resourceId) {
            const efx = effects.find((e: any) => e.id === item.resourceId);
            if (!efx) continue;
            const ids = efx.fixtureIds || [];
            const tSec = currentMs / 1000;
            for (const fid of ids) {
              const pf = patchedFixtures.find((p: any) => p.id === fid);
              if (!pf) continue;
              const def = fixtureDefs.get(pf.fixtureDefId);
              if (!def) continue;
              const mode = def.modes?.[pf.modeIndex];
              if (!mode) continue;

              const panCh = mode.channels?.find((c: any) => c.type?.toLowerCase?.() === 'pan');
              const tiltCh = mode.channels?.find((c: any) => c.type?.toLowerCase?.() === 'tilt');
              const panFineCh = mode.channels?.find((c: any) => c.type?.toLowerCase?.() === 'pan fine');
              const tiltFineCh = mode.channels?.find((c: any) => c.type?.toLowerCase?.() === 'tilt fine');
              if (!panCh && !tiltCh) continue;

              const hz = efx.speed || 0.5;
              const width = efx.width ?? 0.5;
              const height = efx.height ?? 0.5;
              const xOffset = ((efx.xOffset ?? 128) / 255) * 0.3;
              const yOffset = ((efx.yOffset ?? 128) / 255) * 0.3;
              const rot = ((efx.rotation ?? 0) / 255) * 2 * pi;
              const rx = width * 0.7;
              const ry = height * 0.7;
              let px = 0, py = 0;
              const pct = (tSec * hz) % 1;

              switch (efx.pattern) {
                case 'Circle': {
                  const angle = pct * 2 * pi;
                  px = Math.cos(angle) * rx;
                  py = Math.sin(angle) * ry;
                  break;
                }
                case 'Line': {
                  const v = pct < 0.5 ? pct * 2 : 2 - pct * 2;
                  px = (v - 0.5) * 2 * rx;
                  py = 0;
                  break;
                }
                case 'Eight': {
                  const angle = pct * 2 * pi;
                  const sx = Math.sin(angle);
                  const cx = Math.cos(angle);
                  px = sx * rx;
                  py = sx * cx * ry;
                  break;
                }
                case 'Square': {
                  const seg = pct * 4;
                  const idx = Math.floor(seg) % 4;
                  const frac = seg - Math.floor(seg);
                  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
                  const c1 = corners[idx];
                  const c2 = corners[(idx + 1) % 4];
                  px = (c1[0] + (c2[0] - c1[0]) * frac) * rx;
                  py = (c1[1] + (c2[1] - c1[1]) * frac) * ry;
                  break;
                }
                case 'Triangle': {
                  const seg = pct * 3;
                  const idx = Math.floor(seg) % 3;
                  const frac = seg - Math.floor(seg);
                  const corners: [number, number][] = [[0, -1], [-0.866, 0.5], [0.866, 0.5]];
                  const c1 = corners[idx];
                  const c2 = corners[(idx + 1) % 3];
                  px = (c1[0] + (c2[0] - c1[0]) * frac) * rx;
                  py = (c1[1] + (c2[1] - c1[1]) * frac) * ry;
                  break;
                }
              }

              const rx2 = px * Math.cos(rot) - py * Math.sin(rot) + xOffset;
              const ry2 = px * Math.sin(rot) + py * Math.cos(rot) + yOffset;
              const dmxPan = Math.round(Math.max(0, Math.min(255, 128 + rx2 * 127)));
              const dmxTilt = Math.round(Math.max(0, Math.min(255, 128 + ry2 * 127)));

              const ch: Record<number, number> = {};
              if (panCh && pf.startAddress != null) ch[pf.startAddress + (panCh.offset ?? 0)] = dmxPan;
              if (tiltCh && pf.startAddress != null) ch[pf.startAddress + (tiltCh.offset ?? 0)] = dmxTilt;
              if (panFineCh && pf.startAddress != null) ch[pf.startAddress + panFineCh.offset - 1] = Math.round((dmxPan / 256) * 255) || 0;
              if (tiltFineCh && pf.startAddress != null) ch[pf.startAddress + tiltFineCh.offset - 1] = Math.round((dmxTilt / 256) * 255) || 0;
              if (Object.keys(ch).length > 0) {
                sendChannelsToHardware(ch, currentState.patchedFixtures, currentState.universes, 'vc').catch(() => {})
              }
            }
          }
        }
      }

      pb.rafId = requestAnimationFrame(tick);
    };

    showPlaybackRef.current = {
      rafId: 0,
      startTime,
      showData,
      fixtureDefs,
      audioCtx: null,
      audioBuffers,
      audioSources,
      startedAudios,
    };
    showPlaybackRef.current.rafId = requestAnimationFrame(tick);

    return () => {
      stopPlayback();
    };
  }, []);

  const handleAddWidget = (type: WidgetType) => {
    vcSetAddingWidget(type);
    setShowPalette(false);
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (!addingWidget) return;
    setContextMenu(null);

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;

    if (gridSnap) {
      x = Math.round(x / GRID_SIZE) * GRID_SIZE;
      y = Math.round(y / GRID_SIZE) * GRID_SIZE;
    }

    const defaults: Record<WidgetType, { width: number; height: number; config: ConsoleWidgetConfig }> = {
      button: {
        width: 120,
        height: 60,
        config: { actionType: 'scene', color: '#a855f7', flashMode: 'flash', sceneId: '' },
      },
      slider: {
        width: 40,
        height: 160,
        config: { sliderFunction: 'channel', channelAddress: 1, min: 0, max: 255, step: 1 },
      },
      frame: {
        width: 200,
        height: 150,
        config: { title: 'Group', collapsed: false },
      },
    };

    const d = defaults[addingWidget];
    usePerformStore.getState().vcAddWidget({
      type: addingWidget,
      x, y,
      width: d.width,
      height: d.height,
      config: { ...d.config },
      pageIndex: activePage,
    });
    vcSetAddingWidget(null);
  };

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (!addingWidget) return;
    // Preview cursor
  }, [addingWidget]);

  return (
    <div className="h-full flex flex-col bg-[#0a0a0f]">
      {/* Toolbar */}
      <div className="h-10 px-3 border-b border-gray-800/50 flex items-center gap-2 shrink-0 bg-[#0d0d14]">
        {/* Add Widget */}
        <div className="relative" ref={paletteRef}>
          <button
            onClick={() => { setShowPalette(!showPalette); if (addingWidget) vcSetAddingWidget(null); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              addingWidget || showPalette
                ? 'bg-purple-600/30 text-purple-300'
                : 'bg-gray-800/50 text-gray-400 hover:bg-gray-700/50 hover:text-gray-300'
            }`}
          >
            <Plus size={14} />
            <span className="hidden sm:inline">{t('perform.vc.addWidget')}</span>
          </button>
          {showPalette && (
            <div className="absolute top-full left-0 mt-1 w-44 bg-[#12121a] border border-gray-700 rounded-lg shadow-xl z-50 p-1.5 space-y-0.5">
              <button onClick={() => handleAddWidget('button')} className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-purple-600/20 text-xs text-gray-300">
                <Square size={14} className="text-purple-400" /> {t('perform.vc.button')}
              </button>
              <button onClick={() => handleAddWidget('slider')} className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-purple-600/20 text-xs text-gray-300">
                <Sliders size={14} className="text-amber-400" /> {t('perform.vc.slider')}
              </button>
              <button onClick={() => handleAddWidget('frame')} className="w-full flex items-center gap-2 px-3 py-2 rounded hover:bg-purple-600/20 text-xs text-gray-300">
                <Columns size={14} className="text-blue-400" /> {t('perform.vc.frame')}
              </button>
            </div>
          )}
        </div>

        <div className="w-px h-5 bg-gray-800" />

        {/* Grid snap toggle */}
        <button
          onClick={() => vcSetGridSnap(!gridSnap)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-all ${
            gridSnap ? 'bg-purple-600/20 text-purple-300' : 'text-gray-500 hover:text-gray-300'
          }`}
          title={t('perform.vc.snapToGrid')}
        >
          <Grid size={14} />
        </button>

        {/* Delete page button */}
        <button
          onClick={() => vcDeletePage(activePage)}
          disabled={pages.length <= 1}
          className="p-1.5 rounded-md text-gray-500 hover:text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title={t('perform.vc.deletePage')}
        >
          <Trash2 size={14} />
        </button>

        {addingWidget && (
          <span className="text-[10px] text-amber-400 ml-2">
            {t('perform.vc.clickToPlace', { widget: addingWidget })}
          </span>
        )}
      </div>

      {/* Page Tabs */}
      <div className="px-2 pt-1.5 flex items-center gap-0.5 shrink-0">
        {pages.map((page, i) => (
          <button
            key={i}
            onClick={() => vcSetActivePage(i)}
            className={`px-4 py-1.5 rounded-t-md text-xs font-medium transition-all ${
              activePage === i
                ? 'bg-purple-600/20 text-purple-300 border-t border-x border-purple-500/30'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {page.name}
          </button>
        ))}
        <button
          onClick={() => vcAddPage()}
          className="px-2 py-1.5 text-gray-600 hover:text-gray-400 text-xs"
        >
          {t('perform.vc.addPage')}
        </button>
      </div>

      {/* Canvas */}
      <div
        className="flex-1 overflow-auto relative m-2 rounded-xl border border-gray-800/50"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)
          `,
          backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
          backgroundColor: '#08080c',
          cursor: addingWidget ? 'crosshair' : 'default',
        }}
        onClick={handleCanvasClick}
        onMouseMove={handleCanvasMouseMove}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Render widgets */}
        {pageWidgets.map((widget) => (
          <VCWidgetRenderer
            key={widget.id}
            widget={widget}
            onContextMenu={(x, y) => setContextMenu({ x, y, widgetId: widget.id })}
            onShow3D={() => setShowFloating3D(true)}
          />
        ))}

        {/* Empty state */}
        {pageWidgets.length === 0 && !addingWidget && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <MousePointer2 size={32} className="mx-auto mb-3 text-gray-700" />
              <p className="text-sm text-gray-600">{t('perform.vc.emptyCanvas')}</p>
              <p className="text-[10px] text-gray-700 mt-1">{t('perform.vc.emptyCanvasHint')}</p>
            </div>
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenuPopup
          x={contextMenu.x}
          y={contextMenu.y}
          widgetId={contextMenu.widgetId}
          onClose={() => setContextMenu(null)}
          onConfigure={(id) => { setContextMenu(null); setShowWidgetConfig(id); }}
        />
      )}

      {/* Widget Config Modal (rendered at parent level so it survives contextMenu close) */}
      {showWidgetConfig && (() => {
        const widget = widgets.find(w => w.id === showWidgetConfig);
        if (!widget) { setShowWidgetConfig(null); return null; }
        return <WidgetConfigModal widget={widget} onClose={() => setShowWidgetConfig(null)} />;
      })()}

      {/* Keyboard: Esc to cancel adding */}
      <KeyboardListener onEsc={() => { if (addingWidget) vcSetAddingWidget(null); }} />

      {/* Floating 3D Stage View */}
      {showFloating3D && (
        <div
          className="fixed z-50 bg-black/95 rounded-xl border border-purple-700/40 shadow-2xl flex flex-col"
          style={{ left: float3DPos.x, top: float3DPos.y, width: float3DSize.w, height: float3DSize.h, minWidth: 320, minHeight: 200, overflow: 'hidden' }}
        >
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#0d0d18] border-b border-gray-800 cursor-move shrink-0" onMouseDown={handleFloat3DDragStart}>
            <span className="text-[11px] text-purple-400 font-medium">🎬 Live 3D View</span>
            <button onClick={() => setShowFloating3D(false)} className="text-xs text-gray-500 hover:text-red-400 rounded px-1">✕</button>
          </div>
          <div className="flex-1 min-h-0 relative">
            <Stage3D />
            {/* Resize handle */}
            <div
              className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
              onMouseDown={handleFloat3DResizeStart}
              style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(168,85,247,0.4) 50%)', borderBottomRightRadius: '0.75rem' }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Keyboard Listener ─────────────────────────────────────

const KeyboardListener: React.FC<{ onEsc: () => void }> = ({ onEsc }) => {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onEsc();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onEsc]);
  return null;
};

// ─── Context Menu Popup ────────────────────────────────────

const ContextMenuPopup: React.FC<{
  x: number; y: number; widgetId: string;
  onClose: () => void;
  onConfigure: (id: string) => void;
}> = ({ x, y, widgetId, onClose, onConfigure }) => {
  const widget = usePerformStore((s) => s.vcWidgets.find((w) => w.id === widgetId));
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  if (!widget) return null;

  const handleDelete = () => {
    usePerformStore.getState().vcDeleteWidget(widgetId);
    onClose();
  };

  const handleDuplicate = () => {
    usePerformStore.getState().vcDuplicateWidget(widgetId);
    onClose();
  };

  return (
    <>
      <div
        ref={menuRef}
        className="fixed z-[100] bg-[#12121a] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[140px]"
        style={{ left: Math.min(x, window.innerWidth - 160), top: Math.min(y, window.innerHeight - 180) }}
      >
        <button
          onClick={() => onConfigure(widgetId)}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-purple-600/20"
        >
          <Settings size={12} /> Configure
        </button>
        <button
          onClick={handleDuplicate}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-purple-600/20"
        >
          <Copy size={12} /> Duplicate
        </button>
        <div className="border-t border-gray-800 my-1" />
        <button
          onClick={handleDelete}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-600/20"
        >
          <Trash2 size={12} /> Delete
        </button>
      </div>
    </>
  );
};

// ─── Widget Config Modal ───────────────────────────────────

const WidgetConfigModal: React.FC<{ widget: ConsoleWidget; onClose: () => void }> = ({ widget, onClose }) => {
  const { t } = useTranslation();
  const vcUpdateWidget = usePerformStore((s) => s.vcUpdateWidget);
  const scenes = useShowStore((s) => s.scenes);
  const chasers = useShowStore((s) => s.chasers);
  const songPresets = useShowStore((s) => s.songPresets);

  const [config, setConfig] = useState({ ...widget.config });
  const [title, setTitle] = useState(widget.config.title || widget.type);
  const [width, setWidth] = useState(widget.width);
  const [height, setHeight] = useState(widget.height);

  const handleSave = () => {
    vcUpdateWidget(widget.id, {
      config: { ...config, title },
      width,
      height,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#12121a] border border-gray-700 rounded-xl shadow-2xl w-[380px] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-gray-800/50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">{t('perform.vc.configureWidget')}</h3>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-400">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Size */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('perform.vc.width')}</label>
              <input type="number" value={width} onChange={(e) => setWidth(Number(e.target.value))}
                className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('perform.vc.height')}</label>
              <input type="number" value={height} onChange={(e) => setHeight(Number(e.target.value))}
                className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300" />
            </div>
          </div>

          {/* Button config */}
          {widget.type === 'button' && (
            <>
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('common.label') || 'Label'}</label>
                <input
                  type="text"
                  value={config.label || ''}
                  onChange={(e) => setConfig({ ...config, label: e.target.value })}
                  placeholder="Custom label (optional)"
                  className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300"
                />
              </div>

              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('perform.vc.actionType')}</label>
                <select value={config.actionType || 'scene'} onChange={async (e) => {
                  const newType = e.target.value;
                  if (newType === 'loadShow') {
                    try {
                      const r = await window.lightMaestro?.dialog?.openFile?.([
                        { name: 'Light Maestro Show', extensions: ['lmshow', 'lmproj'] },
                      ]);
                      if (r?.content) {
                        const p = JSON.parse(r.content);
                        setConfig({ ...config, actionType: 'loadShow', showName: p.name || r.filePath?.split(/[\\/]/).pop()?.replace(/\.(lmshow|lmproj)$/,''), showData: p });
                        return;
                      }
                    } catch { /* user cancelled */ }
                  }
                  setConfig({ ...config, actionType: newType as any });
                }}
                  className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300">
                  <option value="scene">{t('perform.vc.scene')}</option>
                  <option value="chaser">{t('perform.vc.chaser')}</option>
                  <option value="blackout">{t('perform.vc.blackoutWidget')}</option>
                  <option value="loadShow">♪ Play Show</option>
                  <option value="playSong">♪ Play Preset</option>
                </select>
              </div>

              {config.actionType === 'scene' && (
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('perform.vc.scene')}</label>
                  <select value={config.sceneId || ''} onChange={(e) => setConfig({ ...config, sceneId: e.target.value })}
                    className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300">
                    <option value="">— Select Scene —</option>
                    {scenes.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {config.actionType === 'loadShow' && (
                <div className="space-y-2">
                  {config.showName ? (
                    <p className="text-[10px] text-emerald-400">?️ {config.showName}</p>
                  ) : (
                    <p className="text-[9px] text-purple-400">Pick a saved .lmproject show file</p>
                  )}
                  <button
                    onClick={async () => {
                      try {
                        const r = await window.lightMaestro?.dialog?.openFile?.([{ name: 'Light Maestro Show', extensions: ['lmshow', 'lmproj'] }]);
                        if (!r?.content) return;
                        const p = JSON.parse(r.content);
                        setConfig({ ...config, showName: p.name || r.filePath?.split(/[\\/]/).pop()?.replace(/\.(lmshow|lmproj)$/,''), showData: p });
                      } catch { /* */ }
                    }}
                    className="px-3 py-1.5 bg-purple-600/30 text-purple-200 rounded text-[10px] font-medium hover:bg-purple-600/50 border border-purple-500/30 transition-colors"
                  >
                    Browse...
                  </button>
                  {config.showData && (
                    <button
                      onClick={() => setConfig({ ...config, showName: undefined as any, showData: undefined as any })}
                      className="text-[9px] text-red-400 hover:text-red-300"
                    >
                      Clear selection
                    </button>
                  )}
                </div>
              )}

              {config.actionType === 'playSong' && (
                <div className="space-y-2">
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">♪ Song Preset</label>
                  <select
                    value={config.songId || ''}
                    onChange={(e) => {
                      const sp = songPresets.find((s) => s.id === e.target.value);
                      setConfig({ ...config, songId: e.target.value, songName: sp?.name });
                    }}
                    className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300"
                  >
                    <option value="">— Select Song Preset —</option>
                    {songPresets.map((sp) => (
                      <option key={sp.id} value={sp.id}>
                        {sp.name}{sp.trackAnalysis?.duration ? ` (${Math.floor(sp.trackAnalysis.duration / 60)}:${Math.floor(sp.trackAnalysis.duration % 60).toString().padStart(2, '0')})` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={async () => {
                      try {
                        const r = await window.lightMaestro?.dialog?.openFile?.([
                          { name: 'Light Maestro Preset', extensions: ['lmpreset'] },
                        ]);
                        if (!r?.content) return;
                        let p = JSON.parse(r.content);
                        // Support both single-object export format and legacy array-of-{name,timestamp,data} format
                        if (Array.isArray(p)) {
                          p = p[0]?.data || p[0] || {};
                        }
                        const store = useShowStore.getState();
                        // Reconstruct full data URL from raw base64 (saved without data: prefix)
                        let audioSrc = p.audioDataBase64 || p.audioFileBase64 || '';
                        if (audioSrc && !audioSrc.startsWith('data:')) {
                          const mime = p.analysis?.mimeType || p.trackAnalysis?.mimeType || 'audio/mpeg';
                          audioSrc = `data:${mime};base64,${audioSrc}`;
                        }
                        const name = p.quickShow?.name || p.name || r.filePath?.split(/[\\/]/).pop()?.replace(/\.lmpreset$/i, '') || 'Imported Preset';
                        const full = {
                          name,
                          audioFileBase64: audioSrc,
                          audioFileName: p.audioFileName || p.analysis?.fileName || p.trackAnalysis?.fileName || '',
                          dmxCues: p.dmxCues || [],
                          quickShow: p.quickShow || {},
                          trackAnalysis: p.analysis || p.trackAnalysis || null,
                          sections: p.sections || [],
                          efxTracks: p.efxTracks || [],
                          manualCues: p.manualCues || [],
                          fixtureTracks: p.fixtureTracks || [],
                          colorTracks: p.colorTracks || [],
                          strobeTracks: p.strobeTracks || [],
                          dimmerTracks: p.dimmerTracks || [],
                          chaserTracks: p.chaserTracks || [],
                        };
                        // Update-in-place by name (keeps a stable id so widget songId refs stay live)
                        const existing = store.songPresets.find((s) => s.name === name);
                        let presetId: string;
                        if (existing) {
                          store.updateSongPreset(existing.id, full);
                          presetId = existing.id;
                        } else {
                          presetId = store.addSongPreset(full);
                        }
                        setConfig({ ...config, songId: presetId, songName: name });
                      } catch { /* user cancelled */ }
                    }}
                    className="px-3 py-1.5 bg-purple-600/30 text-purple-200 rounded text-[10px] font-medium hover:bg-purple-600/50 border border-purple-500/30 transition-colors"
                  >
                    Browse...
                  </button>
                  {songPresets.length === 0 && (
                    <p className="text-[9px] text-amber-400 mt-1">No song presets saved yet. Import a .lmpreset file or save a song in QuickShow first.</p>
                  )}
                </div>
              )}

              {config.actionType === 'audioAutoScript' && (
                <AudioAutoScriptConfig
                  config={config}
                  onConfigChange={(updates) => setConfig({ ...config, ...updates })}
                />
              )}

              {config.actionType === 'chaser' && (
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('perform.vc.chaser')}</label>
                  <select value={config.chaserId || ''} onChange={(e) => setConfig({ ...config, chaserId: e.target.value })}
                    className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300">
                    <option value="">— Select Chaser —</option>
                    {chasers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('perform.vc.flashMode')}</label>
                <div className="flex gap-2 mt-1">
                  <button onClick={() => setConfig({ ...config, flashMode: 'flash' })}
                    className={`flex-1 px-3 py-1.5 rounded text-xs ${config.flashMode === 'flash' ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30' : 'bg-gray-800/50 text-gray-500 border border-gray-700'}`}>
                    {t('perform.vc.flash')}
                  </button>
                  <button onClick={() => setConfig({ ...config, flashMode: 'toggle' })}
                    className={`flex-1 px-3 py-1.5 rounded text-xs ${config.flashMode === 'toggle' ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30' : 'bg-gray-800/50 text-gray-500 border border-gray-700'}`}>
                    {t('perform.vc.toggle')}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('perform.vc.buttonColor')}</label>
                <div className="flex gap-1.5 mt-1">
                  {['#a855f7', '#3b82f6', '#22c55e', '#ef4444', '#f59e0b', '#ec4899'].map((c) => (
                    <button key={c} onClick={() => setConfig({ ...config, color: c })}
                      className="w-6 h-6 rounded-full border-2 transition-all"
                      style={{
                        backgroundColor: c,
                        borderColor: config.color === c ? '#fff' : 'transparent',
                      }} />
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Slider config */}
          {widget.type === 'slider' && (
            <>
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('perform.vc.function')}</label>
                <select value={config.sliderFunction || 'channel'} onChange={(e) => setConfig({ ...config, sliderFunction: e.target.value as any })}
                  className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300">
                  <option value="channel">{t('perform.vc.dmxChannel')}</option>
                  <option value="grandMaster">{t('perform.vc.grandMaster')}</option>
                </select>
              </div>

              {config.sliderFunction === 'channel' && (
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('perform.vc.channelAddress')}</label>
                  <input type="number" min={1} max={512} value={config.channelAddress || 1}
                    onChange={(e) => setConfig({ ...config, channelAddress: Number(e.target.value) })}
                    className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300" />
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('perform.vc.min')}</label>
                  <input type="number" value={config.min ?? 0} onChange={(e) => setConfig({ ...config, min: Number(e.target.value) })}
                    className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('perform.vc.max')}</label>
                  <input type="number" value={config.max ?? 255} onChange={(e) => setConfig({ ...config, max: Number(e.target.value) })}
                    className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">Step</label>
                  <input type="number" value={config.step ?? 1} onChange={(e) => setConfig({ ...config, step: Number(e.target.value) })}
                    className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300" />
                </div>
              </div>
            </>
          )}

          {/* Frame config */}
          {widget.type === 'frame' && (
            <div>
              <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('common.title')}</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="Group Name"
                className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300" />
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-800/50 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-1.5 bg-gray-800/50 text-gray-400 rounded text-xs hover:bg-gray-700/50">
            {t('common.cancel')}
          </button>
          <button onClick={handleSave} className="px-4 py-1.5 bg-purple-600/30 text-purple-300 rounded text-xs font-medium hover:bg-purple-600/50">
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Audio + AutoScript Config ──────────────────────────────

const AudioAutoScriptConfig: React.FC<{
  config: ConsoleWidgetConfig;
  onConfigChange: (updates: Partial<ConsoleWidgetConfig>) => void;
}> = ({ config, onConfigChange }) => {
  const [audioLoaded, setAudioLoaded] = useState(false);
  const [audioFileName, setAudioFileName] = useState(config.audioFileName || '');
  const [statusText, setStatusText] = useState(
    config.audioCues && config.audioCues.length > 0
      ? `Done — ${config.audioCues.length} cues`
      : 'Ready'
  );
  const [generating, setGenerating] = useState(false);
  const generatingRef = useRef(false); // Ref guard against race conditions with React batching
  const [audioDataUrl, setAudioDataUrl] = useState(config.audioDataUrl || '');

  const handleChooseFile = async () => {
    try {
      setStatusText('Choosing file...');
      const result = await (window as any).lightMaestro?.dialog?.openFile?.([{
        name: 'Audio Files',
        extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'aac'],
      }]);
      if (!result?.content || !result?.fileName) {
        setStatusText('Ready');
        return;
      }
      // Build data URL
      const ext = result.fileName.split('.').pop()?.toLowerCase() || 'mp3';
      const mimeMap: Record<string, string> = {
        wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg',
        flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac',
      };
      const mime = mimeMap[ext] || 'audio/mpeg';
      const dataUrl = `data:${mime};base64,${result.content}`;

      setAudioDataUrl(dataUrl);
      setAudioFileName(result.fileName);
      setAudioLoaded(true);
      setStatusText('Ready');

      onConfigChange({
        audioDataUrl: dataUrl,
        audioFileName: result.fileName,
        audioCues: undefined,
        audioAnalysis: undefined,
        audioDuration: undefined,
        autoScriptConfig: undefined,
      });
    } catch (err) {
      console.error('Choose file failed:', err);
      setStatusText('Error choosing file');
    }
  };

  const handleGenerate = async () => {
    if (!audioDataUrl || generating || generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    setStatusText('Analyzing...');

    try {
      // 1. Decode audio
      const resp = await fetch(audioDataUrl);
      const arrayBuffer = await resp.arrayBuffer();
      const audioCtx = new AudioContext();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

      // 2. Analyze
      const analysis = analyzeAudioBuffer(
        audioBuffer,
        audioFileName || 'imported.mp3',
        arrayBuffer.byteLength
      );

      setStatusText('Generating cues...');

      // 3. Generate cues + compute DMX using new engine
      const cueInputs = genCuesLocal(analysis);
      const showState = useShowStore.getState();
      const defs = await loadFixtureDefinitions(
        showState.patchedFixtures.map((f) => f.fixtureDefId)
      );
      const universes = showState.universes;

      // Use new engine's per-cue DMX computation
      const dmxCues: DmxCue[] = [];
      for (const ci of cueInputs) {
        const results = computeDmxForCue(
          ci as any,
          showState.patchedFixtures,
          defs,
          universes,
        );
        for (const r of results) {
          dmxCues.push({
            time: ci.time,
            section: ci.section,
            universe: r.universe,
            channelValues: r.channelValues,
            fixtureNames: [],
            fixtureCount: showState.patchedFixtures.length,
            effect: ci.effect,
            colors: ci.colors,
          });
        }
      }

      const cueCount = dmxCues.length;
      setStatusText(`Done — ${cueCount} cues`);

      onConfigChange({
        audioDataUrl,
        audioFileName: audioFileName || 'imported.mp3',
        audioAnalysis: analysis,
        audioCues: dmxCues,
        audioDuration: analysis.duration,
        autoScriptConfig: { cueCount, bpm: analysis.bpm, genre: analysis.genre },
      });

      audioCtx.close();
    } catch (err) {
      console.error('AutoScript generation failed:', err);
      setStatusText('Error — check console');
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-3 bg-purple-600/5 border border-purple-500/20 rounded-lg p-3">
      <div className="flex items-center gap-2">
        <Music size={14} className="text-purple-400" />
        <span className="text-[10px] text-purple-300 uppercase tracking-wider font-medium">
          Audio + AutoScript
        </span>
      </div>

      <button
        onClick={handleChooseFile}
        disabled={generating}
        className="w-full px-3 py-2 bg-purple-600/20 text-purple-300 rounded text-xs hover:bg-purple-600/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Choose Audio File
      </button>

      {audioFileName && (
        <p className="text-[10px] text-gray-400 truncate">
          📁 {audioFileName}
        </p>
      )}

      {audioLoaded && (
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="w-full px-3 py-2 bg-purple-600/30 text-purple-200 rounded text-xs font-medium hover:bg-purple-600/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
        >
          {generating && <Loader size={12} className="animate-spin" />}
          {generating ? 'Generating...' : 'Generate AutoScript'}
        </button>
      )}

      <div className={`text-[10px] font-mono px-2 py-1 rounded ${
        statusText.startsWith('Done')
          ? 'bg-green-600/10 text-green-400'
          : statusText.startsWith('Error')
          ? 'bg-red-600/10 text-red-400'
          : 'bg-gray-800/50 text-gray-500'
      }`}>
        {statusText}
      </div>

      {config.audioDuration != null && (
        <p className="text-[9px] text-gray-600">
          Duration: {Math.floor(config.audioDuration / 60)}:{Math.floor(config.audioDuration % 60).toString().padStart(2, '0')} ·
          {(() => { try { if (config.audioAnalysis?.genre) { const g = JSON.parse(config.audioAnalysis.genre); return ` ${g.label} (${g.confidence}%)`; } } catch {} return ''; })()}
        </p>
      )}

      <p className="text-[9px] text-gray-600 leading-relaxed">
        Imports audio, analyzes it, and auto-generates DMX light cues.
        Press the button in Virtual Console to play audio + lights.
      </p>
    </div>
  );
};

// ─── Widget Renderer ───────────────────────────────────────

const VCWidgetRenderer: React.FC<{
  widget: ConsoleWidget;
  onContextMenu: (x: number, y: number) => void;
  onShow3D?: () => void;
}> = ({ widget, onContextMenu, onShow3D }) => {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [origPos, setOrigPos] = useState({ x: 0, y: 0 });
  const [origSize, setOrigSize] = useState({ w: 0, h: 0 });
  const vcUpdateWidget = usePerformStore((s) => s.vcUpdateWidget);
  const gridSnap = usePerformStore((s) => s.vcGridSnap);

  const snap = (v: number) => gridSnap ? Math.round(v / GRID_SIZE) * GRID_SIZE : v;

  // Drag
  const handleDragStart = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    setDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setOrigPos({ x: widget.x, y: widget.y });

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - dragStart.x;
      const dy = ev.clientY - dragStart.y;
      vcUpdateWidget(widget.id, {
        x: snap(origPos.x + dx),
        y: snap(origPos.y + dy),
      });
    };

    const onUp = () => {
      setDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Resize
  const handleResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setResizing(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setOrigSize({ w: widget.width, h: widget.height });

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - dragStart.x;
      const dy = ev.clientY - dragStart.y;
      vcUpdateWidget(widget.id, {
        width: Math.max(40, snap(origSize.w + dx)),
        height: Math.max(30, snap(origSize.h + dy)),
      });
    };

    const onUp = () => {
      setResizing(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  switch (widget.type) {
    case 'button':
      return <VCButtonWidget widget={widget} onDragStart={handleDragStart} onResizeStart={handleResizeStart} onContextMenu={onContextMenu} onShow3D={onShow3D} />;
    case 'slider':
      return <VCSliderWidget widget={widget} onDragStart={handleDragStart} onResizeStart={handleResizeStart} onContextMenu={onContextMenu} />;
    case 'frame':
      return <VCFrameWidget widget={widget} onDragStart={handleDragStart} onResizeStart={handleResizeStart} onContextMenu={onContextMenu} />;
    default:
      return null;
  }
};

// ─── Button Widget ─────────────────────────────────────────

const VCButtonWidget: React.FC<{
  widget: ConsoleWidget;
  onDragStart: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent) => void;
  onContextMenu: (x: number, y: number) => void;
  onShow3D?: () => void;
}> = ({ widget, onDragStart, onResizeStart, onContextMenu, onShow3D }) => {
  const { t } = useTranslation();
  const [active, setActive] = useState(false);
  const scenes = useShowStore((s) => s.scenes);
  const chasers = useShowStore((s) => s.chasers);
  const songPresets = useShowStore((s) => s.songPresets);
  const chaserTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chaserRunningRef = useRef(false);
  const sceneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sceneFadeRef = useRef<{ cancel: () => void } | null>(null);
  const autoAudioRef = useRef<HTMLAudioElement | null>(null);
  const autoRafRef = useRef<number>(0);
  const regeneratingRef = useRef(false);
  const playIntentRef = useRef(false);
  const [songPlayer, setSongPlayer] = useState<SongPreset | null>(null);

  const { config } = widget;
  const color = config.color || '#a855f7';
  const isFlash = config.flashMode === 'flash';

  const getChaserLabel = () => {
    if (config.actionType !== 'chaser' || !config.chaserId) return 'Chaser';
    const ch = chasers.find((c) => c.id === config.chaserId);
    return ch?.name || 'Chaser';
  };

  const getSongLabel = () => {
    if (config.actionType !== 'playSong' || !config.songId) return '♪ Song';
    const sp = songPresets.find((p) => p.id === config.songId)
      || (config.songName ? songPresets.find((p) => p.name === config.songName) : undefined);
    return sp ? `♪ ${sp.name}` : (config.songName ? `♪ ${config.songName}` : '♪ Song');
  };

  // ─── audioAutoScript playback helper ──────────────────
  const _startAudioAutoScript = (cues: any[]) => {
    if (!cues || cues.length === 0) {
      console.warn('AudioAutoScript: no cues to play');
      return;
    }
    console.log('AudioAutoScript: starting', config.audioFileName, 'cues:', cues.length);
    const audio = new Audio(config.audioDataUrl);
    autoAudioRef.current = audio;
    let startTime = 0;
    let firstFrameDone = false;
    const firedCues = new Set<string>();
    const fireAutoDmx = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      // Blackout all universes to 0 on first frame
      if (!firstFrameDone) {
        firstFrameDone = true;
        vcZeroAllUniverses();
      }
      for (const cue of cues) {
        const key = `${cue.time.toFixed(2)}-${cue.universe}`;
        if (firedCues.has(key)) continue;
        if (elapsed >= cue.time && Object.keys(cue.channelValues).length > 0) {
          firedCues.add(key);
          try {
            dmxBridge.write('vc', cue.universe, cue.channelValues);
          } catch {}
        }
      }
      if (!audio.paused && !audio.ended) autoRafRef.current = requestAnimationFrame(fireAutoDmx);
    };
    audio.onplay = () => { startTime = performance.now(); fireAutoDmx(); };
    audio.onended = () => {
      cancelAnimationFrame(autoRafRef.current);
      vcZeroAllUniverses();
      autoAudioRef.current = null;
      setActive(false);
    };
    audio.onerror = (e) => console.error('AudioAutoScript error:', e);
    const tryPlay = (retries: number) => {
      audio.play().catch((e) => {
        if (retries > 0) {
          setTimeout(() => tryPlay(retries - 1), 50);
        } else {
          console.error('AudioAutoScript play failed:', e);
        }
      });
    };
    tryPlay(2);
  };

  const activate = () => {
    setActive(true);
    const currentState = useShowStore.getState();

    // DMX engine will be restarted by PlaySong/audioAutoScript handlers when needed

    if (config.actionType === 'loadShow') {
      (async () => {
        try {
          // Toggle: if already playing, stop
          if ((window as any).__lm_perfPlayActive) {
            (window as any).__lm_perfStopPlayback?.();
            return;
          }
          // Use pre-loaded show data or open file picker if not yet loaded
          let p = config.showData;
          if (!p) {
            const r = await window.lightMaestro?.dialog?.openFile?.([{ name: 'Light Maestro Show', extensions: ['lmshow', 'lmproj'] }]);
            if (!r?.content) return;
            p = JSON.parse(r.content);
          }
          const s = useShowStore.getState();
          // Restore from .lmshow format (ShowManager save)
          if (p.scenes) s.setScenes(p.scenes);
          if (p.chasers) s.setChasers(p.chasers);
          if (p.cueLists) s.setCueLists(p.cueLists);
          if (p.effects) s.setEffects(p.effects.map((e: any) => ({ ...e, fixtureIds: e.fixtureIds || e.fixtures || [] })));
          if (p.fixtureGroups || p.groups) s.setFixtureGroups(p.fixtureGroups || p.groups);
          if (p.universes) s.setShowUniverses(p.universes);
          // Restore patched fixtures (handle both formats)
          if (p.patchedFixtures) {
            s.setPatchedFixtures(p.patchedFixtures);
          } else if (p.fixtures && Array.isArray(p.fixtures)) {
            // Convert .lmshow fixture format to PatchedFixture
            const patched = p.fixtures.map((f: any) => ({
              id: f.id,
              fixtureDefId: f.definitionId || f.fixtureDefId,
              manufacturer: f.manufacturer || '',
              model: f.model || '',
              fixtureType: f.fixtureType || '',
              modeIndex: f.modeIndex ?? 0,
              modeName: f.modeName || '',
              universeId: typeof f.universe === 'number' ? `universe-${f.universe + 1}` : (f.universeId || 'universe-1'),
              startAddress: f.startAddress ?? 1,
              channelCount: f.channelCount ?? 1,
              name: f.name || '',
              tier: f.tier || 'primary',
            }));
            s.setPatchedFixtures(patched);
          }
          // Also restore .lmproject format fields (backward compat)
          if (p.fixturePositions) s.setFixturePositions(p.fixturePositions);
          if (p.songPresets) s.setSongPresets(p.songPresets);
          // Restore QuickShow data from .lmproject format
          if (p.quickShow) (window as any).__lm_setQuickShow?.(p.quickShow);
          if (p.audioFileBase64 && p.audioFileName) {
            try {
              const resp = await fetch(p.audioFileBase64);
              const blob = await resp.blob();
              const file = new File([blob], p.audioFileName, { type: 'audio/wav' });
              (window as any).__lm_loadAudioFile?.(file);
            } catch { /* audio not available */ }
          }
          // Navigate to Design tab to show the loaded show
          if (p.tracks || p.format?.startsWith('lightmaestro/show')) {
            // .lmshow format - play locally in Performance view (no tab switch)
            const showData = {
              id: p.id || `loaded-${Date.now()}`,
              name: p.name || config.showName || 'Loaded Show',
              duration: p.duration ?? 60000,
              tracks: p.tracks || [],
              audioFileBase64: p.audioFileBase64,
              audioFileName: p.audioFileName,
            };
            s.setShows([...s.shows.filter((sh: any) => sh.id !== showData.id), showData]);
            // Trigger playback via window signal (picked up by useEffect in this component)
            (window as any).__lm_perfPlayShow = showData;
          } else {
            // .lmproject format - load into QuickShow
            useAppStore.getState().setMode?.('quick');
            (window as any).__lm_triggerPlay?.();
          }
        } catch { /* silent */ }
      })();
      return;
    }

    if (config.actionType === 'playSong' && config.songId) {
      const preset = songPresets.find((p) => p.id === config.songId)
        || (config.songName ? songPresets.find((p) => p.name === config.songName) : undefined);
      if (!preset) {
        console.warn('PlaySong: preset not found', config.songId, 'available:', songPresets.map((p) => `${p.name}#${p.id}`).join(', '));
        return;
      }
      // Playback no longer requires an audio file: SongPresetPlayer uses a
      // virtual clock when the audio is missing or not yet playable.
      // Toggle the full live playback (SongPresetPlayer) on/off
      setSongPlayer((prev) => (prev ? null : preset));
      return;
    }

    if (config.actionType === 'audioAutoScript' && config.audioDataUrl) {
      // Toggle: if already playing this button, stop
      if (autoAudioRef.current) {
        autoAudioRef.current.pause();
        autoAudioRef.current.currentTime = 0;
        cancelAnimationFrame(autoRafRef.current);
        autoAudioRef.current = null;
        vcZeroAllUniverses();
        setActive(false);
        return;
      }
      // Guard against double-click during regeneration
      if (regeneratingRef.current) return;
      regeneratingRef.current = true;
      playIntentRef.current = true;

      // Regenerate cues on every play using new engine + current fixtures
      (async () => {
        try {
          // First, ensure DMX engine is ready
          const api = (window as any).lightMaestro?.dmx;
          if (api) {
            try {
              await api.stop().catch(() => {});
              const universes = useShowStore.getState().universes;
              if (universes.length > 0) {
                await Promise.all(universes.map((u: any) => api.addUniverse({
                  id: u.id, name: u.name, type: u.type, output: true, input: false,
                  channels: u.channels, serialPort: (u as any).serialPort || '',
                  artnetIP: (u as any).artnetIP ?? '', artnetSubnet: (u as any).artnetSubnet ?? 0,
                  artnetUniverse: (u as any).artnetUniverse ?? 0,
                  sacnUniverse: (u as any).sacnUniverse ?? 1, sacnPriority: (u as any).sacnPriority ?? 100,
                }).catch(() => {})));
                await api.start().catch(() => {});
                console.log('[VC] DMX engine ready for playback');
              }
            } catch { /* silent */ }
          }

          let analysis = (config as any).audioAnalysis;
          if (!analysis?.sections?.length) {
            console.log('[VC] play: re-analyzing audio');
            const resp = await fetch(config.audioDataUrl);
            const buf = await resp.arrayBuffer();
            const ctx = new AudioContext();
            const ab = await ctx.decodeAudioData(buf);
            analysis = analyzeAudioBuffer(ab, config.audioFileName || 'audio.mp3', buf.byteLength);
            ctx.close();
            (config as any).audioAnalysis = analysis;
          }
          const fitState = useShowStore.getState();
          if (!fitState.patchedFixtures?.length) {
            console.warn('[VC] play: no patched fixtures');
            _startAudioAutoScript(config.audioCues as any[] ?? []);
            return;
          }
          const defs = await loadFixtureDefinitions(
            fitState.patchedFixtures.map((f: any) => f.fixtureDefId)
          );
          const cueInputs = genCuesLocal(analysis);
          const cues: any[] = [];
          for (const ci of cueInputs) {
            for (const r of computeDmxForCue(ci as any, fitState.patchedFixtures, defs, fitState.universes)) {
              cues.push({ time: ci.time, section: ci.section, universe: r.universe, channelValues: r.channelValues, fixtureNames: [], fixtureCount: fitState.patchedFixtures.length, effect: ci.effect, colors: ci.colors });
            }
          }
          (config as any).audioCues = cues;
          console.log('[VC] play: regenerated', cues.length, 'cues');
          if (playIntentRef.current) _startAudioAutoScript(cues);
        } catch (err) {
          console.error('[VC] play: regeneration failed, falling back', err);
          if (playIntentRef.current) _startAudioAutoScript(config.audioCues as any[] ?? []);
        } finally {
          regeneratingRef.current = false;
        }
      })();
      return;
    }

    if (config.actionType === 'blackout') {
      try { window.lightMaestro?.dmx?.blackout(); } catch { /* */ }
      return;
    }

    if (config.actionType === 'scene' && config.sceneId) {
      const scene = scenes.find((s) => s.id === config.sceneId);
      if (scene) {
        // Track active scene timers so deactivate can cancel
        const fadeIn = scene.fadeIn || 0;
        const fadeOut = scene.fadeOut || 0;
        // Duration = total window INCLUDING fades (0 = hold forever)
        const infinite = !scene.duration || scene.duration <= 0;
        const hold = infinite ? 0 : Math.max(0, scene.duration - fadeIn - fadeOut);

        const channels: Record<number, number> = {};
        for (const [addr, val] of Object.entries(scene.channels)) channels[Number(addr)] = val;

        // Calculate target values
        const targetChannels = { ...channels };

        const applyLevel = (level: number) => {
          const scaled: Record<number, number> = {};
          for (const [addr, val] of Object.entries(targetChannels)) {
            scaled[Number(addr)] = Math.round(Number(val) * level);
          }
          sendChannelsToHardware(scaled, currentState.patchedFixtures, currentState.universes, 'vc').catch(() => {})
        };

        // Clear any existing scene timer
        if (sceneTimerRef.current) { clearTimeout(sceneTimerRef.current); sceneTimerRef.current = null; }
        (sceneFadeRef as any).current?.cancel?.();

        if (fadeIn > 0) {
          // Animate fade in
          const start = performance.now();
          let raf = 0;
          const fadeInAnim = () => {
            const elapsed = performance.now() - start;
            const progress = Math.min(1, elapsed / fadeIn);
            applyLevel(progress);
            if (progress < 1) raf = requestAnimationFrame(fadeInAnim);
            else {
              applyLevel(1);
              if (!infinite) scheduleFadeOut(hold);
            }
          };
          (sceneFadeRef as any).current = { cancel: () => cancelAnimationFrame(raf) };
          raf = requestAnimationFrame(fadeInAnim);
        } else {
          applyLevel(1);
          if (!infinite) scheduleFadeOut(hold);
        }

        function scheduleFadeOut(delay: number) {
          sceneTimerRef.current = setTimeout(() => {
            if (fadeOut > 0) {
              const start = performance.now();
              let raf = 0;
              const fadeOutAnim = () => {
                const elapsed = performance.now() - start;
                const progress = Math.min(1, elapsed / fadeOut);
                applyLevel(1 - progress);
                if (progress < 1) raf = requestAnimationFrame(fadeOutAnim);
                else { applyLevel(0); setActive(false); }
              };
              (sceneFadeRef as any).current = { cancel: () => cancelAnimationFrame(raf) };
              raf = requestAnimationFrame(fadeOutAnim);
            } else {
              applyLevel(0);
              setActive(false);
            }
          }, delay);
        };
      }
      return;
    }

    if (config.actionType === 'chaser' && config.chaserId) {
      const chaser = chasers.find((c) => c.id === config.chaserId);
      if (!chaser || chaser.steps.length === 0) return;
      chaserRunningRef.current = true;
      let stepIndex = 0;
      const runStep = () => {
        if (!chaserRunningRef.current) return;
        const step = chaser.steps[stepIndex];
        if (!step) { chaserRunningRef.current = false; return; }
        const scene = scenes.find((s) => s.id === step.sceneId);
        if (!scene) {
          // Skip missing scene, go to next step
          stepIndex = (stepIndex + 1) % chaser.steps.length;
          chaserTimerRef.current = setTimeout(runStep, 100);
          return;
        }

        // Step has its own timing OR fall back to scene timing (duration = total window incl fades)
        const fadeIn = step.fadeIn ?? scene.fadeIn ?? 0;
        const fadeOut = step.fadeOut ?? scene.fadeOut ?? 0;
        const hold = step.hold ?? (scene.duration > 0 ? Math.max(0, scene.duration - fadeIn - fadeOut) : 500);

        const targetChannels: Record<number, number> = {};
        for (const [addr, val] of Object.entries(scene.channels)) targetChannels[Number(addr)] = Number(val);

        const applyLevel = (level: number) => {
          const scaled: Record<number, number> = {};
          for (const [addr, val] of Object.entries(targetChannels)) scaled[Number(addr)] = Math.round(val * level);
          sendChannelsToHardware(scaled, currentState.patchedFixtures, currentState.universes, 'vc').catch(() => {})
        };

        if (fadeIn > 0) {
          const start = performance.now();
          let raf = 0;
          const anim = () => {
            const p = Math.min(1, (performance.now() - start) / fadeIn);
            applyLevel(p);
            p < 1 ? raf = requestAnimationFrame(anim) : onHold();
          };
          raf = requestAnimationFrame(anim);
        } else {
          applyLevel(1);
          onHold();
        }

        function onHold() {
          chaserTimerRef.current = setTimeout(() => {
            if (fadeOut > 0) {
              const start = performance.now();
              let raf = 0;
              const anim = () => {
                const p = Math.min(1, (performance.now() - start) / fadeOut);
                applyLevel(1 - p);
                p < 1 ? raf = requestAnimationFrame(anim) : nextStep();
              };
              raf = requestAnimationFrame(anim);
            } else {
              applyLevel(0);
              nextStep();
            }
          }, hold);
        }

        function nextStep() {
          stepIndex = (stepIndex + 1) % chaser.steps.length;
          runStep();
        }
      };
      runStep();
      return;
    }
  };

  const deactivate = () => {
    setActive(false);
    playIntentRef.current = false;
    chaserRunningRef.current = false;
    if (chaserTimerRef.current) {
      clearTimeout(chaserTimerRef.current);
      chaserTimerRef.current = null;
    }
    if (sceneTimerRef.current) {
      clearTimeout(sceneTimerRef.current);
      sceneTimerRef.current = null;
    }
    sceneFadeRef.current?.cancel();
    sceneFadeRef.current = null;
    // Stop audioAutoScript playback
    if (autoAudioRef.current) {
      autoAudioRef.current.pause();
      autoAudioRef.current.currentTime = 0;
      cancelAnimationFrame(autoRafRef.current);
      autoAudioRef.current = null;
      vcZeroAllUniverses();
    }
    // Stop playSong playback
    setSongPlayer(null);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isFlash) {
      activate();
    }
  };

  const handleMouseUp = () => {
    if (isFlash) {
      deactivate();
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    if (!isFlash) {
      if (active) {
        deactivate();
      } else {
        activate();
      }
    }
  };

  return (
    <div
      className="absolute group"
      style={{
        left: widget.x,
        top: widget.y,
        width: widget.width,
        height: widget.height,
      }}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e.clientX, e.clientY); }}
    >
      {/* Drag handle (top bar) */}
      <div
        className="absolute top-0 left-0 right-0 h-4 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity z-10 flex items-center justify-center"
        onMouseDown={onDragStart}
      >
        <GripHorizontal size={10} className="text-gray-600" />
      </div>

      {/* Button */}
      <button
        onMouseDown={(e) => { handleMouseDown(e); }}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
        className="w-full h-full rounded-xl border-2 font-medium text-xs flex items-center justify-center transition-all select-none"
        style={{
          backgroundColor: active ? `${color}30` : `${color}10`,
          borderColor: active ? `${color}80` : `${color}30`,
          color: active ? color : '#888',
          boxShadow: active ? `0 0 20px ${color}40, inset 0 0 20px ${color}20` : 'none',
        }}
      >
        <span className="truncate px-2">
          {config.label
            ? config.label
            : config.actionType === 'audioAutoScript' ? (config.audioFileName ? `♪ ${config.audioFileName}` : '♪ Audio Auto') :
           config.actionType === 'loadShow' ? (config.showName || '📂 Load Show') :
           config.actionType === 'playSong' ? getSongLabel() :
           config.actionType === 'blackout' ? t('perform.vc.blackoutLabel') :
           config.actionType === 'chaser' ? getChaserLabel() :
           scenes.find((s) => s.id === config.sceneId)?.name || 'Button'}
        </span>
      </button>

      {/* 3D view shortcut — visible when widget is active */}
      {active && onShow3D && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onShow3D();
          }}
          title="View 3D Stage"
          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-purple-500/80 hover:bg-purple-400 text-white flex items-center justify-center shadow-lg transition-colors z-20"
        >
          <Eye size={12} />
        </button>
      )}

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
        onMouseDown={onResizeStart}
      >
        <div className="w-2 h-2 border-r-2 border-b-2 border-gray-600 absolute bottom-0.5 right-0.5" />
      </div>

      {/* Full live playback of the selected Song Preset */}
      {songPlayer && (
        <SongPresetPlayer
          preset={songPlayer}
          onEnded={() => { setSongPlayer(null); setActive(false); }}
        />
      )}
    </div>
  );
};

// ─── Slider Widget ─────────────────────────────────────────

const VCSliderWidget: React.FC<{
  widget: ConsoleWidget;
  onDragStart: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent) => void;
  onContextMenu: (x: number, y: number) => void;
}> = ({ widget, onDragStart, onResizeStart, onContextMenu }) => {
  const [value, setValue] = useState(128);
  const { config } = widget;
  const min = config.min ?? 0;
  const max = config.max ?? 255;
  const step = config.step ?? 1;
  const ratio = (value - min) / (max - min);

  const handleChange = (newVal: number) => {
    const clamped = Math.max(min, Math.min(max, Math.round(newVal / step) * step));
    setValue(clamped);

    if (config.sliderFunction === 'grandMaster') {
      try { window.lightMaestro?.dmx?.applyGrandMaster(clamped / 255); } catch { /* */ }
    } else if (config.channelAddress) {
      // Merge per channel so two sliders on the same universe don't drop
      // each other (write-replace would keep only the last one).
      // NB: universe is hard-coded to 1 (pre-existing bug, documented — the
      // VC widget config does not store a target universe).
      try { dmxBridge.writeMerge('vc', 1, { [config.channelAddress]: clamped }); } catch { /* */ }
    }
  };

  return (
    <div
      className="absolute flex flex-col items-center group"
      style={{
        left: widget.x,
        top: widget.y,
        width: widget.width,
        height: widget.height,
      }}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e.clientX, e.clientY); }}
    >
      {/* Drag handle */}
      <div
        className="w-full h-3 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-opacity z-10 flex items-center justify-center shrink-0"
        onMouseDown={onDragStart}
      >
        <GripHorizontal size={10} className="text-gray-600" />
      </div>

      {/* Slider track */}
      <div className="flex-1 relative w-8 min-h-[60px] cursor-pointer rounded-full bg-gray-800/50 border border-gray-700/50 overflow-hidden"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const pct = 1 - (e.clientY - rect.top) / rect.height;
          handleChange(min + pct * (max - min));
        }}
        onMouseDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const onMove = (ev: MouseEvent) => {
            const pct = 1 - (ev.clientY - rect.top) / rect.height;
            handleChange(min + pct * (max - min));
          };
          const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
          };
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        }}
      >
        {/* Filled portion */}
        <div
          className="absolute bottom-0 left-0 right-0 rounded-full transition-all"
          style={{
            height: `${ratio * 100}%`,
            backgroundColor: '#a855f7',
            opacity: 0.6,
          }}
        />
        {/* Thumb */}
        <div
          className="absolute left-1/2 -translate-x-1/2 w-5 h-5 rounded-full border-2 border-purple-400 bg-purple-600 shadow-lg transition-all"
          style={{ bottom: `calc(${ratio * 100}% - 10px)` }}
        />
      </div>

      {/* Value label */}
      <span className="text-[10px] text-gray-400 font-mono mt-1 shrink-0">{Math.round(value)}</span>

      {/* Label */}
      <span className="text-[9px] text-gray-600 truncate max-w-full shrink-0">
        {config.sliderFunction === 'grandMaster' ? 'GM' : `CH${config.channelAddress || '?'}`}
      </span>

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
        onMouseDown={onResizeStart}
      >
        <div className="w-2 h-2 border-r-2 border-b-2 border-gray-600 absolute bottom-0.5 right-0.5" />
      </div>
    </div>
  );
};

// ─── Frame Widget ──────────────────────────────────────────

const VCFrameWidget: React.FC<{
  widget: ConsoleWidget;
  onDragStart: (e: React.MouseEvent) => void;
  onResizeStart: (e: React.MouseEvent) => void;
  onContextMenu: (x: number, y: number) => void;
}> = ({ widget, onDragStart, onResizeStart, onContextMenu }) => {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(widget.config.collapsed || false);
  const vcUpdateWidget = usePerformStore((s) => s.vcUpdateWidget);
  const widgets = usePerformStore((s) => s.vcWidgets);
  const activePage = usePerformStore((s) => s.vcActivePage);

  const childWidgets = widgets.filter(
    (w) => w.frameId === widget.id && w.pageIndex === activePage
  );

  const toggleCollapse = () => {
    const newState = !collapsed;
    setCollapsed(newState);
    vcUpdateWidget(widget.id, { config: { ...widget.config, collapsed: newState } });
  };

  return (
    <div
      className="absolute bg-[#0d0d14]/90 border border-gray-700/50 rounded-xl backdrop-blur-sm overflow-hidden group"
      style={{
        left: widget.x,
        top: widget.y,
        width: widget.width,
        height: collapsed ? 32 : widget.height,
        transition: 'height 0.2s ease',
      }}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(e.clientX, e.clientY); }}
    >
      {/* Title bar */}
      <div
        className="h-8 px-3 flex items-center gap-2 border-b border-gray-800/50 cursor-grab active:cursor-grabbing select-none"
        onMouseDown={onDragStart}
        onDoubleClick={toggleCollapse}
      >
        <Columns size={12} className="text-gray-600" />
        <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider flex-1 truncate">
          {widget.config.title || t('perform.vc.group')}
        </span>
        <button onClick={toggleCollapse} className="p-0.5 text-gray-600 hover:text-gray-400">
          {collapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </button>
      </div>

      {/* Content area */}
      {!collapsed && (
        <div className="p-2" style={{ height: widget.height - 32 }}>
          {childWidgets.length === 0 && (
            <div className="flex items-center justify-center h-full text-[10px] text-gray-700">
              {t('perform.vc.dragWidgetsHere')}
            </div>
          )}
        </div>
      )}

      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize opacity-0 group-hover:opacity-100 transition-opacity z-10"
        onMouseDown={onResizeStart}
      >
        <div className="w-2 h-2 border-r-2 border-b-2 border-gray-600 absolute bottom-0.5 right-0.5" />
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// Simplified genCues — generates AutoScript cues locally
// (used by VC audioAutoScript, mirrors QuickShow's genCues)
// ═══════════════════════════════════════════════════════════

function genCuesLocal(a: TrackAnalysis): CueInput[] {
  const cues: CueInput[] = [];
  if (!a.sections || a.sections.length === 0) return cues;

  const bpm = a.bpm || 120;
  const beatDuration = 60 / bpm;
  const barDuration = beatDuration * 4; // 4/4 time
  const sceneDuration = barDuration * 2; // 2 bars per scene

  // Color palettes per section type (SoundSwitch-style)
  const PALETTES: Record<string, string[]> = {
    intro:  ['#1a5276', '#2980b9', '#3498db', '#5dade2', '#85c1e9'],
    verse:  ['#6c3483', '#8e44ad', '#a569bd', '#bb8fce', '#d2b4de'],
    chorus: ['#922b21', '#c0392b', '#e74c3c', '#f1948a', '#f5b7b1'],
    bridge: ['#0e6251', '#117a65', '#148f77', '#1abc9c', '#48c9b0'],
    drop:   ['#ffffff', '#f39c12', '#e67e22', '#d35400', '#ff0000'],
    outro:  ['#1b2631', '#2c3e50', '#5d6d7e', '#85929e', '#aeb6bf'],
  };

  // Section-specific movement types (data-driven)
  const MOVEMENTS: Record<string, string> = {
    intro: 'static', verse: 'sweep', chorus: 'circle',
    bridge: 'wave', drop: 'pulse', outro: 'static',
  };

  const sections = a.sections;
  let globalCueIdx = 0;

  for (const section of sections) {
    const sectionStart = section.startTime;
    const sectionEnd = section.endTime;
    const sectionEnergy = section.energy;
    const colors = PALETTES[section.type] || PALETTES.intro;
    const movement = MOVEMENTS[section.type] || 'sweep';

    // Divide section into 2-bar scenes
    let sceneTime = sectionStart;
    let sceneIdx = 0;
    while (sceneTime < sectionEnd) {
      const nextSceneTime = Math.min(sceneTime + sceneDuration, sectionEnd);

      // Compute local energy for this scene from energy curve
      const eCurve = a.energyCurve;
      const eCurveLen = eCurve?.length || 1;
      const energyIdx = Math.min(
        Math.floor((sceneTime / a.duration) * eCurveLen),
        eCurveLen - 1
      );
      const localEnergy = eCurve?.[energyIdx] ?? sectionEnergy;

      const intensity = localEnergy > 0.7 ? 'high' : localEnergy > 0.4 ? 'medium' : 'low';
      const isStrobeSection = section.type === 'drop' ||
        (section.type === 'chorus' && localEnergy > 0.65);
      const colorIndex = (globalCueIdx + sceneIdx) % colors.length;

      // Create 4 cues per scene on beats for smooth transitions
      const cuesPerScene = 4;
      for (let i = 0; i < cuesPerScene; i++) {
        const cueTime = sceneTime + (i / cuesPerScene) * (nextSceneTime - sceneTime);

        // Cycle through palette: each cue gets 2-3 colors
        const cueColors: string[] = [];
        for (let c = 0; c < Math.min(3, colors.length); c++) {
          cueColors.push(colors[(colorIndex + c) % colors.length]);
        }

        cues.push({
          time: cueTime,
          section: section.type,
          effect: section.type === 'drop' ? 'strobe' : 'none',
          intensity,
          energy: localEnergy,
          colors: cueColors,
          color: cueColors[0] || '#ffffff',
          strobe: isStrobeSection && i % 2 === 0,
          movement: movement as CueInput['movement'],
          colorTemp: section.type === 'intro' || section.type === 'outro' ? 'cool'
            : section.type === 'chorus' || section.type === 'drop' ? 'warm'
            : 'neutral',
          strobeProbability: isStrobeSection ? 0.7 : 0,
          dimmerPulseOnBeat: section.type === 'drop',
          colorShiftSpeed: section.type === 'chorus' ? 0.6
            : section.type === 'drop' ? 0.8
            : 0.3,
        });
      }

      sceneTime = nextSceneTime;
      sceneIdx++;
      globalCueIdx++;
    }
  }

  return cues;
}

// ═══════════════════════════════════════════════════════════
// SIMPLE DESK PANEL
// ═══════════════════════════════════════════════════════════

const CHANNELS_PER_ROW = 16;
const TOTAL_CHANNELS = 512;
const ROWS = Math.ceil(TOTAL_CHANNELS / CHANNELS_PER_ROW);

const SimpleDeskPanel: React.FC = () => {
  const { t } = useTranslation();
  const universeId = usePerformStore((s) => s.sdUniverseId);
  const channelValues = usePerformStore((s) => s.sdChannelValues[s.sdUniverseId] || {});
  const selectedChannel = usePerformStore((s) => s.sdSelectedChannel);
  const highlightActive = usePerformStore((s) => s.sdHighlightActive);
  const clipboard = usePerformStore((s) => s.sdClipboard);
  const sdSetChannelValue = usePerformStore((s) => s.sdSetChannelValue);
  const sdSetBulkChannelValues = usePerformStore((s) => s.sdSetBulkChannelValues);
  const sdSetSelectedChannel = usePerformStore((s) => s.sdSetSelectedChannel);
  const sdSetHighlightActive = usePerformStore((s) => s.sdSetHighlightActive);
  const sdResetAll = usePerformStore((s) => s.sdResetAll);
  const sdCopyUniverse = usePerformStore((s) => s.sdCopyUniverse);
  const sdPasteUniverse = usePerformStore((s) => s.sdPasteUniverse);
  const sdSetUniverseId = usePerformStore((s) => s.sdSetUniverseId);

  const universes = useShowStore((s) => s.universes);
  // Keep the selected universe in sync with the real (showStore) universe list
  useEffect(() => {
    if (universes.length === 0) return;
    if (!universes.some((u) => u.id === universeId)) {
      sdSetUniverseId(universes[0].id);
    }
  }, [universes, universeId, sdSetUniverseId]);
  const [jumpInput, setJumpInput] = useState('');
  const gridRef = useRef<HTMLDivElement>(null);
  const [shiftRange, setShiftRange] = useState<{ from: number; to: number } | null>(null);

  const selectedValue = selectedChannel ? (channelValues[selectedChannel] ?? 0) : 0;

  const handleSliderChange = (channel: number, value: number) => {
    if (shiftRange && channel >= shiftRange.from && channel <= shiftRange.to) {
      const oldVal = channelValues[channel] ?? 0;
      const delta = value - oldVal;
      const bulkValues: Record<number, number> = {};
      for (let ch = shiftRange.from; ch <= shiftRange.to; ch++) {
        const currentVal = channelValues[ch] ?? 0;
        bulkValues[ch] = Math.max(0, Math.min(255, currentVal + delta));
      }
      sdSetBulkChannelValues(bulkValues);
    } else {
      sdSetChannelValue(channel, value);
    }
  };

  const handleSliderClick = (channel: number, e: React.MouseEvent) => {
    if (e.shiftKey && selectedChannel) {
      const from = Math.min(selectedChannel, channel);
      const to = Math.max(selectedChannel, channel);
      setShiftRange({ from, to });
      sdSetSelectedChannel(channel);
    } else {
      setShiftRange(null);
      sdSetSelectedChannel(channel);
    }
  };

  const handleJumpKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && jumpInput) {
      const ch = parseInt(jumpInput, 10);
      if (ch >= 1 && ch <= 512) {
        sdSetSelectedChannel(ch);
        const row = Math.floor((ch - 1) / CHANNELS_PER_ROW);
        if (gridRef.current) {
          const scrollTarget = row * 140;
          gridRef.current.scrollTop = Math.max(0, scrollTarget - 200);
        }
      }
      setJumpInput('');
    }
  };

  return (
    <div className="h-full flex flex-col bg-[#0a0a0f]">
      {/* Toolbar */}
      <div className="h-10 px-3 border-b border-gray-800/50 flex items-center gap-2 shrink-0 bg-[#0d0d14]">
        <span className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">{t('perform.simpleDesk.title')}</span>

        <div className="w-px h-5 bg-gray-800" />

        <select
          value={universeId}
          onChange={(e) => sdSetUniverseId(e.target.value)}
          className="px-2 py-1 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300"
        >
          {universes.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>

        <div className="w-px h-5 bg-gray-800" />

        <button
          onClick={() => sdSetHighlightActive(!highlightActive)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-all ${
            highlightActive ? 'bg-purple-600/20 text-purple-300' : 'text-gray-500 hover:text-gray-300'
          }`}
          title={t('perform.simpleDesk.highlightActive')}
        >
          {highlightActive ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>

        <button onClick={sdCopyUniverse} className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800/30" title={t('perform.simpleDesk.copyUniverse')}>
          <Copy size={12} />
        </button>
        <button
          onClick={sdPasteUniverse}
          disabled={!clipboard}
          className="flex items-center gap-1 px-2 py-1.5 rounded-md text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-800/30 disabled:opacity-30 disabled:cursor-not-allowed"
          title={t('perform.simpleDesk.pasteUniverse')}
        >
          <Upload size={12} />
        </button>

        <button
          onClick={sdResetAll}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs text-red-400 hover:bg-red-600/20 transition-all"
          title={t('perform.simpleDesk.allToZero')}
        >
          <RotateCcw size={12} />
          <span className="hidden sm:inline">{t('perform.simpleDesk.allToZero')}</span>
        </button>

        <div className="flex-1" />

        <div className="flex items-center gap-1">
          <Hash size={12} className="text-gray-600" />
          <input
            type="text"
            value={jumpInput}
            onChange={(e) => setJumpInput(e.target.value.replace(/\D/g, '').slice(0, 3))}
            onKeyDown={handleJumpKey}
            placeholder="CH"
            className="w-12 px-1.5 py-1 bg-gray-800/50 border border-gray-700 rounded text-[10px] text-gray-300 text-center font-mono"
          />
          <span className="text-[10px] text-gray-600">{t('perform.simpleDesk.channelJump')}</span>
        </div>
      </div>

      {/* Main area: fader grid + detail panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Fader Grid */}
        <div ref={gridRef} className="flex-1 overflow-auto p-3">
          <div
            className="grid gap-1 mx-auto"
            style={{
              gridTemplateColumns: `repeat(${CHANNELS_PER_ROW}, 1fr)`,
              gridAutoRows: 'minmax(120px, auto)',
              maxWidth: CHANNELS_PER_ROW * 52,
            }}
          >
            {Array.from({ length: TOTAL_CHANNELS }, (_, i) => i + 1).map((channel) => {
              const val = channelValues[channel] ?? 0;
              const isSelected = selectedChannel === channel;
              const isInRange = shiftRange && channel >= shiftRange.from && channel <= shiftRange.to;
              const isActive = val > 0;
              const hidden = highlightActive && !isActive;

              if (hidden) return <div key={channel} className="w-12 h-[120px]" />;

              return (
                <div
                  key={channel}
                  className={`flex flex-col items-center gap-0.5 pt-1 cursor-pointer rounded transition-all ${
                    isSelected ? 'bg-purple-600/10 ring-1 ring-purple-500/30' :
                    isInRange ? 'bg-purple-600/5' : ''
                  }`}
                  onClick={(e) => handleSliderClick(channel, e)}
                >
                  <span className={`text-[9px] font-mono ${
                    isSelected ? 'text-purple-400' : isActive ? 'text-purple-500/70' : 'text-gray-600'
                  }`}>
                    {val > 0 ? val : ''}
                  </span>

                  <div className="relative flex-1 w-3 min-h-[60px] bg-gray-800/30 rounded-full border border-gray-700/30 overflow-hidden cursor-pointer group/slider"
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const pct = 1 - (e.clientY - rect.top) / rect.height;
                      const newVal = Math.round(pct * 255);
                      handleSliderChange(channel, newVal);
                    }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const startVal = channelValues[channel] ?? 0;
                      const onMove = (ev: MouseEvent) => {
                        const pct = 1 - (ev.clientY - rect.top) / rect.height;
                        const newVal = Math.max(0, Math.min(255, Math.round(pct * 255)));
                        handleSliderChange(channel, newVal);
                      };
                      const onUp = () => {
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                      };
                      document.addEventListener('mousemove', onMove);
                      document.addEventListener('mouseup', onUp);
                    }}
                  >
                    <div
                      className="absolute bottom-0 left-0 right-0 rounded-full transition-all"
                      style={{
                        height: `${(val / 255) * 100}%`,
                        backgroundColor: isSelected ? '#c084fc' : val > 0 ? '#a855f7' : '#374151',
                        opacity: val > 0 ? 0.7 : 0.3,
                      }}
                    />
                    <div className="absolute inset-0 opacity-0 group-hover/slider:opacity-100 transition-opacity rounded-full"
                      style={{ boxShadow: 'inset 0 0 6px rgba(168,85,247,0.3)' }}
                    />
                  </div>

                  <span className={`text-[9px] font-mono shrink-0 ${
                    isSelected ? 'text-purple-400 font-bold' : 'text-gray-600'
                  }`}>
                    {channel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Detail Panel */}
        <div className="w-52 bg-[#0d0d14] border-l border-gray-800/50 p-4 flex flex-col shrink-0">
          {selectedChannel ? (
            <>
              <div className="text-center mb-4">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t('perform.simpleDesk.channelDetail')}</div>
                <div className="text-3xl font-bold text-purple-300 font-mono mt-1">{selectedChannel}</div>
              </div>

              <div className="bg-[#12121a] border border-gray-800 rounded-lg p-3 mb-4 text-center">
                <div className="text-[9px] text-gray-600 mb-1">{t('perform.simpleDesk.dmxValue')}</div>
                <input
                  type="number"
                  min={0}
                  max={255}
                  value={selectedValue}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v)) sdSetChannelValue(selectedChannel, v);
                  }}
                  className="w-full bg-transparent text-2xl font-bold text-purple-300 font-mono text-center outline-none"
                />
                <div className="w-full h-1.5 bg-gray-800 rounded-full mt-2 overflow-hidden">
                  <div
                    className="h-full bg-purple-500 rounded-full transition-all"
                    style={{ width: `${(selectedValue / 255) * 100}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => sdSetChannelValue(selectedChannel, selectedValue + 1)}
                  className="px-2 py-1.5 bg-purple-600/20 text-purple-300 rounded text-xs hover:bg-purple-600/30 font-mono">
                  +1
                </button>
                <button onClick={() => sdSetChannelValue(selectedChannel, selectedValue + 10)}
                  className="px-2 py-1.5 bg-purple-600/20 text-purple-300 rounded text-xs hover:bg-purple-600/30 font-mono">
                  +10
                </button>
                <button onClick={() => sdSetChannelValue(selectedChannel, selectedValue - 1)}
                  className="px-2 py-1.5 bg-gray-800/50 text-gray-400 rounded text-xs hover:bg-gray-700/50 font-mono">
                  -1
                </button>
                <button onClick={() => sdSetChannelValue(selectedChannel, selectedValue - 10)}
                  className="px-2 py-1.5 bg-gray-800/50 text-gray-400 rounded text-xs hover:bg-gray-700/50 font-mono">
                  -10
                </button>
              </div>

              <button
                onClick={() => sdSetChannelValue(selectedChannel, 0)}
                className="w-full mt-2 px-3 py-1.5 bg-gray-800/50 text-gray-400 rounded text-xs hover:bg-gray-700/50"
              >
                {t('perform.simpleDesk.snapTo0')}
              </button>

              <div className="mt-4 pt-4 border-t border-gray-800/50">
                <div className="text-[10px] text-gray-600 space-y-1">
                  <div className="flex justify-between">
                    <span>{t('perform.simpleDesk.info.range')}</span>
                    <span className="text-gray-500">1-512</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('perform.simpleDesk.info.universe')}</span>
                    <span className="text-gray-500">{universeId}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('perform.simpleDesk.info.value')}</span>
                    <span className="text-gray-500 font-mono">{selectedValue} / 255</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('perform.simpleDesk.info.percent')}</span>
                    <span className="text-gray-500 font-mono">{Math.round((selectedValue / 255) * 100)}%</span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Sliders size={24} className="mx-auto mb-2 text-gray-700" />
                <p className="text-xs text-gray-600">{t('perform.simpleDesk.selectChannel')}</p>
                <p className="text-[10px] text-gray-700 mt-1">{t('perform.simpleDesk.clickFader')}</p>
                <p className="text-[10px] text-gray-700">{t('perform.simpleDesk.shiftRange')}</p>
                <p className="text-[10px] text-gray-700 mt-3">{t('perform.simpleDesk.typeJump')}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="h-6 px-3 border-t border-gray-800/50 flex items-center text-[10px] text-gray-600 bg-[#0d0d14] shrink-0">
        <span>{t('perform.simpleDesk.status.universe')}: {universeId}</span>
        <span className="mx-2">·</span>
        <span>{t('perform.simpleDesk.status.channels')}</span>
        {shiftRange && (
          <>
            <span className="mx-2">·</span>
            <span className="text-purple-400">{t('perform.simpleDesk.status.range')}: {shiftRange.from}-{shiftRange.to}</span>
          </>
        )}
        <span className="flex-1" />
        <span className="text-gray-700">{t('common.shift_click_range')}</span>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// MIDI MAPPING PANEL
// ═══════════════════════════════════════════════════════════


// ─── MIDI API contract (miroir de electron/midi/manager.ts + preload) ───────
// La surface preload (M1, agent parallèle) n'expose pas encore
// startLearn/stopLearn/addMapping/removeMapping/onMappingChanged dans
// src/types.d.ts : on bridge via un type local (cast) pour compiler dès
// aujourd'hui contre le CONTRAT, et fonctionner dès que le main sera prêt.

type MidiTypeName = 'note' | 'cc' | 'program';

interface MidiDeviceInfo {
  id: string;
  name: string;
  manufacturer?: string;
  input?: boolean;
  output?: boolean;
}

type MidiTargetSpec =
  | { type: 'dmx-channel'; universe: number; channel: number }
  | { type: 'widget'; widgetId: string; property: string }
  | { type: 'scene'; sceneId: string; action: 'play' | 'stop' | 'toggle' }
  | { type: 'chaser'; chaserId: string; action: 'play' | 'stop' | 'next' | 'previous' }
  | { type: 'cueList'; cueListId: string; action: 'go' | 'back' | 'stop' }
  | { type: 'blackout' }
  | { type: 'grandMaster' }
  | { type: 'autoscript'; action: 'toggle' | 'nextEffect' | 'intensity' };

interface MidiMappingEntry {
  id: string;
  midiChannel: number;
  midiType: MidiTypeName;
  midiValue: number;
  midiRange?: [number, number];
  target: MidiTargetSpec;
  feedback?: boolean;
}

interface MidiStatusEvent { connected: boolean; deviceId?: string }
interface MidiActivityEvent { channel: number; type: MidiTypeName; note: number; value?: number }

interface MidiApiContract {
  listDevices: () => Promise<MidiDeviceInfo[]>;
  connect: (deviceId: string) => Promise<void>;
  disconnect: () => Promise<void>;
  getMapping: () => Promise<MidiMappingEntry[]>;
  setMapping: (mapping: MidiMappingEntry[]) => Promise<void>;
  addMapping: (mapping: MidiMappingEntry) => Promise<void>;
  removeMapping: (id: string) => Promise<void>;
  startLearn: (target: MidiTargetSpec) => Promise<void>;
  stopLearn: () => Promise<void>;
  onStatus: (cb: (status: MidiStatusEvent) => void) => (() => void) | void;
  onActivity: (cb: (activity: MidiActivityEvent) => void) => (() => void) | void;
  onMappingChanged: (cb: (mapping: MidiMappingEntry[]) => void) => (() => void) | void;
  onClock: (cb: (clock: { bpm: number; running: boolean }) => void) => (() => void) | void;
}

function getMidiApi(): MidiApiContract | null {
  const api = window.lightMaestro?.midi;
  return api ? (api as unknown as MidiApiContract) : null;
}

type MidiTargetKind = 'blackout' | 'grandMaster' | 'scene' | 'chaser' | 'cueList' | 'dmx' | 'widget';

const MIDIMappingPanel: React.FC = () => {
  const { t } = useTranslation();
  const scenes = useShowStore((s) => s.scenes);
  const chasers = useShowStore((s) => s.chasers);
  const cueLists = useShowStore((s) => s.cueLists);
  const universes = useShowStore((s) => s.universes);
  const widgets = usePerformStore((s) => s.vcWidgets);

  const [devices, setDevices] = useState<MidiDeviceInfo[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(true);
  const [connectedId, setConnectedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [mappings, setMappings] = useState<MidiMappingEntry[]>([]);
  const [mappingsLoading, setMappingsLoading] = useState(true);
  const [learning, setLearning] = useState(false);
  const [activityOn, setActivityOn] = useState(false);
  const [clockInfo, setClockInfo] = useState<{ bpm: number; running: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [targetKind, setTargetKind] = useState<MidiTargetKind>('blackout');
  const [targetSceneId, setTargetSceneId] = useState('');
  const [targetChaserId, setTargetChaserId] = useState('');
  const [targetCueListId, setTargetCueListId] = useState('');
  const [targetUniverseIdx, setTargetUniverseIdx] = useState(0);
  const [targetChannel, setTargetChannel] = useState(1);
  const [targetWidgetId, setTargetWidgetId] = useState('');

  const activityTimer = useRef<number | null>(null);

  // Garde l'univers sélectionné dans les bornes quand la liste change
  useEffect(() => {
    if (universes.length > 0 && targetUniverseIdx >= universes.length) {
      setTargetUniverseIdx(universes.length - 1);
    }
  }, [universes, targetUniverseIdx]);

  // Mount : liste des devices + mapping, abonnements status/activity/mappingChanged
  useEffect(() => {
    const api = getMidiApi();
    let cancelled = false;
    const unsubs: Array<(() => void) | undefined> = [];
    if (!api) {
      setDevicesLoading(false);
      setMappingsLoading(false);
      return;
    }

    api.listDevices()
      .then((devs) => { if (!cancelled) { setDevices(devs || []); setDevicesLoading(false); } })
      .catch(() => { if (!cancelled) setDevicesLoading(false); });

    api.getMapping()
      .then((m) => { if (!cancelled) { setMappings(m || []); setMappingsLoading(false); } })
      .catch(() => { if (!cancelled) setMappingsLoading(false); });

    const s = api.onStatus((st) => {
      if (cancelled) return;
      setConnectedId(st.connected ? (st.deviceId ?? null) : null);
    });
    if (typeof s === 'function') unsubs.push(s);

    const a = api.onActivity(() => {
      if (cancelled) return;
      setActivityOn(true);
      if (activityTimer.current) window.clearTimeout(activityTimer.current);
      activityTimer.current = window.setTimeout(() => setActivityOn(false), 220);
    });
    if (typeof a === 'function') unsubs.push(a);

    const m = api.onMappingChanged((list) => {
      if (cancelled) return;
      setMappings(list || []);
      // Le learn s'arrête tout seul côté main une fois le mapping créé
      setLearning(false);
    });
    if (typeof m === 'function') unsubs.push(m);

    // M5 — MIDI clock : BPM affiché en direct (le hook midi-trigger scale
    // aussi le tempo des chasers actifs depuis ce même canal).
    const clk = api.onClock((clock) => {
      if (cancelled) return;
      setClockInfo(clock && clock.bpm > 0 ? clock : null);
    });
    if (typeof clk === 'function') unsubs.push(clk);

    return () => {
      cancelled = true;
      unsubs.forEach((fn) => { if (fn) fn(); });
      if (activityTimer.current) window.clearTimeout(activityTimer.current);
      try { api.stopLearn(); } catch { /* le main peut ne pas être branché (tests/aperçu) */ }
    };
  }, []);

  const buildTarget = (): MidiTargetSpec | null => {
    switch (targetKind) {
      case 'blackout': return { type: 'blackout' };
      case 'grandMaster': return { type: 'grandMaster' };
      case 'scene': return targetSceneId ? { type: 'scene', sceneId: targetSceneId, action: 'toggle' } : null;
      case 'chaser': return targetChaserId ? { type: 'chaser', chaserId: targetChaserId, action: 'play' } : null;
      case 'cueList': return targetCueListId ? { type: 'cueList', cueListId: targetCueListId, action: 'go' } : null;
      case 'dmx': return { type: 'dmx-channel', universe: targetUniverseIdx, channel: targetChannel };
      case 'widget': return targetWidgetId ? { type: 'widget', widgetId: targetWidgetId, property: 'flash' } : null;
      default: return null;
    }
  };

  const handleStartLearn = async () => {
    const api = getMidiApi();
    if (!api) return;
    const target = buildTarget();
    if (!target) { setError(t('perform.midi.errors.noTarget')); return; }
    setError(null);
    setLearning(true);
    try { await api.startLearn(target); }
    catch { setLearning(false); setError(t('perform.midi.errors.learn')); }
  };

  const handleStopLearn = async () => {
    const api = getMidiApi();
    if (!api) return;
    setLearning(false);
    try { await api.stopLearn(); } catch { /* silencieux */ }
  };

  const handleConnect = async (deviceId: string) => {
    const api = getMidiApi();
    if (!api) return;
    setBusyId(deviceId);
    setError(null);
    try { await api.connect(deviceId); }
    catch { setError(t('perform.midi.errors.connect')); }
    finally { setBusyId(null); }
  };

  const handleDisconnect = async () => {
    const api = getMidiApi();
    if (!api) return;
    setBusyId(connectedId);
    setError(null);
    try { await api.disconnect(); }
    catch { setError(t('perform.midi.errors.disconnect')); }
    finally { setBusyId(null); }
  };

  const handleRemoveMapping = async (id: string) => {
    const api = getMidiApi();
    if (!api) return;
    setError(null);
    try { await api.removeMapping(id); }
    catch { setError(t('perform.midi.errors.remove')); }
  };

  const midiTypeLabel = (type: MidiTypeName): string => {
    if (type === 'cc') return t('perform.midi.midiTypes.cc');
    if (type === 'program') return t('perform.midi.midiTypes.program');
    return t('perform.midi.midiTypes.note');
  };

  const actionLabel = (action: string): string => {
    const v = t(`perform.midi.actions.${action}`);
    return v !== `perform.midi.actions.${action}` ? v : action;
  };

  const targetLabel = (target: MidiTargetSpec): string => {
    switch (target.type) {
      case 'blackout': return t('perform.midi.targets.blackout');
      case 'grandMaster': return t('perform.midi.targets.grandMaster');
      case 'scene': {
        const sc = scenes.find((x) => x.id === target.sceneId);
        return `${t('perform.midi.targets.scene')} : ${sc ? sc.name : target.sceneId}`;
      }
      case 'chaser': {
        const ch = chasers.find((x) => x.id === target.chaserId);
        return `${t('perform.midi.targets.chaser')} : ${ch ? ch.name : target.chaserId}`;
      }
      case 'cueList': {
        const cl = cueLists.find((x) => x.id === target.cueListId);
        return `${t('perform.midi.targets.cueList')} : ${cl ? cl.name : target.cueListId}`;
      }
      case 'dmx-channel': {
        const u = universes[target.universe];
        return `DMX ${target.universe + 1}${u ? ` · ${u.name}` : ''} · ${t('perform.midi.columns.channel')} ${target.channel}`;
      }
      case 'widget': {
        const w = widgets.find((x) => x.id === target.widgetId);
        const label = w && w.config && w.config.label ? w.config.label : w ? w.type : target.widgetId;
        return `${t('perform.midi.targets.widget')} : ${label} (${actionLabel(target.property)})`;
      }
      case 'autoscript': return `${t('perform.midi.targets.autoScript')} (${actionLabel(target.action)})`;
      default: return 'MIDI';
    }
  };

  return (
    <div className="h-full p-8 overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Sliders size={20} className="text-purple-400" /> {t('perform.midi.title')}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">{t('perform.midi.subtitle')}</p>
        </div>
        {/* Voyant d'activité : flash à chaque message MIDI reçu */}
        <div className="flex items-center gap-2 bg-[#0d0d14] border border-gray-800/50 rounded-lg px-3 py-1.5">
          {clockInfo && clockInfo.running && (
            <span className="flex items-center gap-1.5 text-[10px] text-purple-300 font-mono mr-1">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
              {Math.round(clockInfo.bpm)} BPM
            </span>
          )}
          <Zap size={14} className={activityOn ? 'text-green-400' : 'text-gray-600'} />
          <span
            className={`w-2 h-2 rounded-full transition-colors duration-150 ${activityOn ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.9)]' : 'bg-gray-700'}`}
          />
          <span className="text-[10px] text-gray-500">{t('perform.midi.activity')}</span>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
          {error}
        </div>
      )}

      {/* ── Périphériques MIDI ── */}
      <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl overflow-hidden mb-5">
        <div className="px-4 py-2.5 border-b border-gray-800/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-300">{t('perform.midi.devices')}</span>
            <span className={`w-2 h-2 rounded-full ${connectedId ? 'bg-green-400' : 'bg-red-500/70'}`} />
          </div>
          <span className="text-[10px] text-gray-600">
            {connectedId
              ? t('perform.midi.connectedTo', { name: (devices.find((d) => d.id === connectedId) || {}).name || connectedId })
              : t('perform.midi.notConnected')}
          </span>
        </div>
        {devicesLoading ? (
          <div className="px-4 py-6 text-xs text-gray-600 flex items-center gap-2">
            <Loader size={14} className="animate-spin text-gray-500" /> {t('perform.midi.loadingDevices')}
          </div>
        ) : devices.length === 0 ? (
          <div className="px-4 py-6 text-xs text-gray-600">{t('perform.midi.noDevices')}</div>
        ) : (
          <div className="divide-y divide-gray-800/30">
            {devices.map((d) => {
              const isConnected = d.id === connectedId;
              return (
                <div key={d.id} className="px-4 py-2.5 flex items-center gap-3">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isConnected ? 'bg-green-400' : 'bg-gray-700'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-gray-300 truncate">{d.name}</div>
                    <div className="text-[10px] text-gray-600 truncate">
                      {d.manufacturer || '—'} ·{' '}
                      {d.input && d.output
                        ? t('perform.midi.inout')
                        : d.input
                        ? t('perform.midi.input')
                        : t('perform.midi.output')}
                    </div>
                  </div>
                  {isConnected ? (
                    <button
                      onClick={handleDisconnect}
                      disabled={busyId !== null}
                      className="px-2.5 py-1 text-[10px] rounded-lg border border-red-500/30 text-red-400 hover:bg-red-500/10 disabled:opacity-50 shrink-0"
                    >
                      {busyId === d.id ? <Loader size={11} className="animate-spin" /> : t('perform.midi.disconnect')}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleConnect(d.id)}
                      disabled={busyId !== null}
                      className="px-2.5 py-1 text-[10px] rounded-lg bg-purple-600/20 text-purple-300 hover:bg-purple-600/30 disabled:opacity-50 shrink-0"
                    >
                      {busyId === d.id ? <Loader size={11} className="animate-spin" /> : t('perform.midi.connect')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── MIDI Learn ── */}
      <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl p-4 mb-5">
        <div className="text-xs font-medium text-gray-300 mb-3">{t('perform.midi.learn.title')}</div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-gray-600">{t('perform.midi.learn.kind')}</span>
            <select
              value={targetKind}
              onChange={(e) => setTargetKind(e.target.value as MidiTargetKind)}
              className="bg-[#0a0a0f] border border-gray-800/60 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-purple-500/50"
            >
              <option value="blackout">{t('perform.midi.targets.blackout')}</option>
              <option value="grandMaster">{t('perform.midi.targets.grandMaster')}</option>
              <option value="scene">{t('perform.midi.targets.scene')}</option>
              <option value="chaser">{t('perform.midi.targets.chaser')}</option>
              <option value="cueList">{t('perform.midi.targets.cueList')}</option>
              <option value="dmx">{t('perform.midi.targets.dmxChannel')}</option>
              <option value="widget">{t('perform.midi.targets.widget')}</option>
            </select>
          </div>

          {targetKind === 'scene' && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-600">{t('perform.midi.learn.target')}</span>
              <select
                value={targetSceneId}
                onChange={(e) => setTargetSceneId(e.target.value)}
                className="bg-[#0a0a0f] border border-gray-800/60 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-purple-500/50 min-w-[160px]"
              >
                <option value="">{t('perform.midi.learn.selectPlaceholder')}</option>
                {scenes.length === 0 && <option value="" disabled>{t('perform.midi.learn.noScenes')}</option>}
                {scenes.map((sc) => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
              </select>
            </div>
          )}

          {targetKind === 'chaser' && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-600">{t('perform.midi.learn.target')}</span>
              <select
                value={targetChaserId}
                onChange={(e) => setTargetChaserId(e.target.value)}
                className="bg-[#0a0a0f] border border-gray-800/60 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-purple-500/50 min-w-[160px]"
              >
                <option value="">{t('perform.midi.learn.selectPlaceholder')}</option>
                {chasers.length === 0 && <option value="" disabled>{t('perform.midi.learn.noChasers')}</option>}
                {chasers.map((ch) => <option key={ch.id} value={ch.id}>{ch.name}</option>)}
              </select>
            </div>
          )}

          {targetKind === 'cueList' && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-600">{t('perform.midi.learn.target')}</span>
              <select
                value={targetCueListId}
                onChange={(e) => setTargetCueListId(e.target.value)}
                className="bg-[#0a0a0f] border border-gray-800/60 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-purple-500/50 min-w-[160px]"
              >
                <option value="">{t('perform.midi.learn.selectPlaceholder')}</option>
                {cueLists.length === 0 && <option value="" disabled>{t('perform.midi.learn.noCueLists')}</option>}
                {cueLists.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}
              </select>
            </div>
          )}

          {targetKind === 'widget' && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-600">{t('perform.midi.learn.target')}</span>
              <select
                value={targetWidgetId}
                onChange={(e) => setTargetWidgetId(e.target.value)}
                className="bg-[#0a0a0f] border border-gray-800/60 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-purple-500/50 min-w-[160px]"
              >
                <option value="">{t('perform.midi.learn.selectPlaceholder')}</option>
                {widgets.length === 0 && <option value="" disabled>{t('perform.midi.learn.noWidgets')}</option>}
                {widgets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.config && w.config.label ? w.config.label : w.type}
                  </option>
                ))}
              </select>
            </div>
          )}

          {targetKind === 'dmx' && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-gray-600">{t('perform.midi.targets.universe')}</span>
                <select
                  value={targetUniverseIdx}
                  onChange={(e) => setTargetUniverseIdx(Number(e.target.value))}
                  className="bg-[#0a0a0f] border border-gray-800/60 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-purple-500/50"
                >
                  {universes.length === 0
                    ? <option value={0}>1</option>
                    : universes.map((u, i) => (
                        <option key={u.id} value={i}>{i + 1}{u.name ? ` · ${u.name}` : ''}</option>
                      ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] text-gray-600">{t('perform.midi.columns.channel')}</span>
                <input
                  type="number"
                  min={1}
                  max={512}
                  value={targetChannel}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setTargetChannel(Number.isFinite(v) ? Math.min(512, Math.max(1, v)) : 1);
                  }}
                  className="w-20 bg-[#0a0a0f] border border-gray-800/60 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-purple-500/50"
                />
              </div>
            </>
          )}

          <div className="flex-1" />

          {learning ? (
            <div className="flex items-center gap-3 px-3 py-2 bg-purple-600/10 border border-purple-500/30 rounded-lg">
              <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
              <span className="text-xs text-purple-300">{t('perform.midi.learn.waiting')}</span>
              <button
                onClick={handleStopLearn}
                className="px-2.5 py-1 text-[10px] rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"
              >
                {t('perform.midi.learn.cancel')}
              </button>
            </div>
          ) : (
            <button
              onClick={handleStartLearn}
              className="px-3 py-1.5 bg-purple-600/20 text-purple-300 rounded-lg text-xs font-medium hover:bg-purple-600/30"
            >
              {t('perform.midi.midiLearn')}
            </button>
          )}
        </div>
        <p className="text-[10px] text-gray-600 mt-2">{t('perform.midi.learn.hint')}</p>
      </div>

      {/* ── Table de mapping ── */}
      <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-800/50 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-300">{t('perform.midi.mappings')}</span>
          <span className="text-[10px] text-gray-600">{mappings.length}</span>
        </div>
        <div className="grid grid-cols-12 gap-2 px-4 py-2 border-b border-gray-800/50 text-[10px] font-medium text-gray-500 uppercase tracking-wider">
          <span className="col-span-3">{t('perform.midi.columns.midi')}</span>
          <span className="col-span-2">{t('perform.midi.columns.channel')}</span>
          <span className="col-span-5">{t('perform.midi.columns.target')}</span>
          <span className="col-span-2 text-right">{t('perform.midi.columns.actions')}</span>
        </div>
        {mappingsLoading ? (
          <div className="px-4 py-6 text-xs text-gray-600 flex items-center gap-2">
            <Loader size={14} className="animate-spin text-gray-500" /> {t('perform.midi.loadingMappings')}
          </div>
        ) : mappings.length === 0 ? (
          <div className="px-4 py-6 text-xs text-gray-600">{t('perform.midi.noMappings')}</div>
        ) : (
          mappings.map((m) => {
            const label = targetLabel(m.target);
            return (
              <div key={m.id} className="grid grid-cols-12 gap-2 px-4 py-2 text-xs hover:bg-gray-800/20 border-b border-gray-800/20 last:border-0 items-center">
                <span className="col-span-3 text-gray-300 font-mono">
                  {midiTypeLabel(m.midiType)} {m.midiValue}
                </span>
                <span className="col-span-2 text-gray-400">CH {m.midiChannel}</span>
                <span className="col-span-5 text-gray-300 truncate" title={label}>{label}</span>
                <span className="col-span-2 text-right">
                  <button
                    onClick={() => handleRemoveMapping(m.id)}
                    title={t('perform.midi.deleteMapping')}
                    className="text-gray-600 hover:text-red-400"
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// REMOTE PANEL — Contrôle LAN (#17)
// ═══════════════════════════════════════════════════════════

/**
 * État du serveur Remote — miroir du contrat réel (électron/remote/server.ts +
 * src/types.d.ts, posés par le lot serveur). Le token n'est PAS un champ du
 * statut : il est embarqué dans chaque URL (`http://<ip>:<port>/?token=<token>`)
 * et extrait localement pour l'affichage dédié. Note : `remote:getStatus`
 * renvoie les urls remplies côté main ; `remote:start`/`remote:stop` renvoient
 * un statut à urls vides → relecture via getStatus() après start/stop.
 */
interface RemoteStatus {
  running: boolean;
  /** Vrai pendant la fenêtre asynchrone listen() (avant l'event listening/error). */
  starting?: boolean;
  port: number;
  startedAt: number | null;
  urls: string[];
  lastError?: string | null;
}

interface RemoteApiContract {
  getStatus: () => Promise<RemoteStatus>;
  start: () => Promise<RemoteStatus>;
  stop: () => Promise<RemoteStatus>;
}

/**
 * #17 — Accès typé à `window.lightMaestro.remote`. Le lot serveur a ajouté
 * remote à src/types.d.ts en parallèle ; le cast local (même pattern que
 * getMidiApi()) garde ce panneau indépendant du timing de cet ajout et
 * d'un éventuel revert/rebase du typage partagé.
 */
function getRemoteApi(): RemoteApiContract | null {
  const api = (window.lightMaestro as unknown as { remote?: RemoteApiContract }).remote;
  return api ?? null;
}

/** Copie dans le presse-papiers, avec repli execCommand (contextes non sécurisés). */
async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* on retente via le repli */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

const RemotePanel: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<RemoteStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const copyTimer = useRef<number | null>(null);
  const lastStatus = useRef<RemoteStatus | null>(null);

  // Polling : état au montage puis toutes les 3 s (pas de push côté main).
  useEffect(() => {
    const api = getRemoteApi();
    let cancelled = false;

    const refresh = async () => {
      if (!api) {
        if (!cancelled) setLoading(false);
        return;
      }
      try {
        const st = await api.getStatus();
        if (cancelled) return;
        lastStatus.current = st;
        setStatus(st);
        // P2-1 (résiduel) : ne pas effacer une erreur de démarrage (ex.
        // EADDRINUSE) tant qu'elle est encore exposée par le serveur.
        setError(st.lastError ?? null);
      } catch {
        // Échec de polling : signalé seulement si l'état n'a jamais été lu
        // (évite de flasher une erreur en boucle pendant un redémarrage).
        if (!cancelled && lastStatus.current === null) {
          setError(t('perform.remote.errors.status'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    refresh();
    const id = window.setInterval(refresh, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    };
  }, [t]);

  const handleStart = async () => {
    const api = getRemoteApi();
    if (!api || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.start();
      // `remote:start` renvoie un statut à urls vides (remplies uniquement par
      // `remote:getStatus`) → relecture immédiate pour afficher les URLs LAN.
      const st = await api.getStatus();
      lastStatus.current = st;
      setStatus(st);
      // P2-1 : si le démarrage a échoué (ex. EADDRINUSE), le serveur expose
      // lastError dans le statut - on le remonte à l'UI au lieu de rester muet.
      if (st.lastError) setError(st.lastError);
    } catch {
      setError(t('perform.remote.errors.start'));
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    const api = getRemoteApi();
    if (!api || busy) return;
    setBusy(true);
    setError(null);
    try {
      const st = await api.stop();
      lastStatus.current = st;
      setStatus(st);
    } catch {
      setError(t('perform.remote.errors.stop'));
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async (text: string, kind: 'url' | 'token', urlId?: string) => {
    const ok = await copyTextToClipboard(text);
    if (!ok) return;
    if (kind === 'url') setCopiedUrl(urlId ?? null);
    else setCopiedToken(true);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => {
      setCopiedUrl(null);
      setCopiedToken(false);
    }, 1800);
  };

  const apiAvailable = getRemoteApi() !== null;
  const running = !!status?.running;
  const starting = !!status?.starting;
  // Badge d'état : « Démarrage… » pendant la fenêtre asynchrone listen(),
  // avant que l'event `listening` (running=true) ou `error` (lastError) arrive.
  const badge = loading
    ? t('perform.remote.loading')
    : starting
      ? t('perform.remote.statusStarting')
      : running
        ? t('perform.remote.statusActive')
        : t('perform.remote.statusStopped');
  // Le token n'est pas un champ du statut : il est embarqué dans les URLs
  // (`?token=`) — extraction depuis la première URL pour l'affichage dédié.
  const tokenFromUrls: string | null = (() => {
    const first = status && status.urls.length > 0 ? status.urls[0] : null;
    if (!first) return null;
    try { return new URL(first).searchParams.get('token'); } catch { return null; }
  })();

  return (
    <div className="h-full p-8 overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Wifi size={20} className="text-purple-400" /> {t('perform.remote.title')}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">{t('perform.remote.subtitle')}</p>
        </div>
        <div className={`flex items-center gap-2 bg-[#0d0d14] border rounded-lg px-3 py-1.5 ${running || starting ? 'border-green-500/30' : 'border-gray-800/50'}`}>
          <span className={`w-2 h-2 rounded-full ${running ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.9)]' : starting ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)]' : 'bg-gray-700'}`} />
          <span className={`text-[10px] font-medium ${running ? 'text-green-400' : starting ? 'text-amber-300' : 'text-gray-500'}`}>
            {badge}
          </span>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-lg text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl overflow-hidden mb-5">
        <div className="px-4 py-2.5 border-b border-gray-800/50 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-300">{t('perform.remote.server')}</span>
          <span className="text-[10px] font-mono text-gray-600">
            {running && status && status.port > 0 ? `:${status.port}` : t('perform.remote.offline')}
          </span>
        </div>

        {loading ? (
          <div className="px-4 py-6 text-xs text-gray-600 flex items-center gap-2">
            <Loader size={14} className="animate-spin text-gray-500" /> {t('perform.remote.loading')}
          </div>
        ) : !apiAvailable ? (
          <div className="px-4 py-6 text-xs text-gray-600">{t('perform.remote.unavailable')}</div>
        ) : running ? (
          <div className="p-4 space-y-4">
            <div>
              <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-2">{t('perform.remote.controlUrls')}</div>
              <div className="space-y-1.5">
                {status && status.urls.length === 0 ? (
                  <div className="text-xs text-gray-600">{t('perform.remote.noUrls')}</div>
                ) : (
                  status?.urls.map((url) => (
                    <div key={url} className="flex items-center gap-2 bg-[#0a0a0f] border border-gray-800/60 rounded-lg px-3 py-2">
                      <span className="flex-1 min-w-0 text-xs font-mono text-purple-300 truncate" title={url}>{url}</span>
                      <button
                        onClick={() => handleCopy(url, 'url', url)}
                        className="shrink-0 px-2 py-1 text-[10px] rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"
                      >
                        {copiedUrl === url ? t('perform.remote.copied') : t('perform.remote.copy')}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {tokenFromUrls && (
              <div>
                <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-2">{t('perform.remote.token')}</div>
                <div className="flex items-center gap-2 bg-[#0a0a0f] border border-gray-800/60 rounded-lg px-3 py-2">
                  <span className="flex-1 min-w-0 text-xs font-mono text-gray-300 truncate" title={tokenFromUrls}>{tokenFromUrls}</span>
                  <button
                    onClick={() => handleCopy(tokenFromUrls, 'token')}
                    className="shrink-0 px-2 py-1 text-[10px] rounded-lg border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"
                  >
                    {copiedToken ? t('perform.remote.copied') : t('perform.remote.copy')}
                  </button>
                </div>
              </div>
            )}

            <p className="text-[10px] text-gray-600">{t('perform.remote.connectHint')}</p>
          </div>
        ) : (
          <div className="px-4 py-6 text-xs text-gray-600">{t('perform.remote.stoppedHint')}</div>
        )}

        <div className="px-4 py-3 border-t border-gray-800/50 flex items-center justify-end">
          <button
            onClick={running ? handleStop : handleStart}
            disabled={busy || loading}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 flex items-center gap-2 ${
              running
                ? 'border border-red-500/30 text-red-400 hover:bg-red-500/10'
                : 'bg-purple-600/20 text-purple-300 hover:bg-purple-600/30'
            }`}
          >
            {busy && <Loader size={13} className="animate-spin" />}
            {busy ? t('perform.remote.working') : running ? t('perform.remote.stop') : t('perform.remote.start')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
const CueListViewPanel: React.FC = () => {
  const { t } = useTranslation();
  const cueLists = useShowStore((s) => s.cueLists);
  const scenes = useShowStore((s) => s.scenes);
  const updateCueList = useShowStore((s) => s.updateCueList);
  const createCueList = useShowStore((s) => s.createCueList);
  const deleteCueList = useShowStore((s) => s.deleteCueList);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showAddCue, setShowAddCue] = useState(false);
  const addCueRef = useRef<HTMLDivElement>(null);

  // Auto-select first cue list if available
  useEffect(() => {
    if (!selectedId && cueLists.length > 0) {
      setSelectedId(cueLists[0].id);
    }
  }, [cueLists, selectedId]);

  const cueList = cueLists.find((cl) => cl.id === selectedId) || null;

  const handleGo = () => {
    if (!cueList || cueList.cues.length === 0) return;
    const nextIdx = cueList.currentCueIndex + 1;
    if (nextIdx >= cueList.cues.length) {
      // Wrap back to start
      updateCueList(cueList.id, { currentCueIndex: 0 });
    } else {
      updateCueList(cueList.id, { currentCueIndex: nextIdx });
    }
    // Fire the current cue to DMX
    const cue = cueList.cues[nextIdx >= cueList.cues.length ? 0 : nextIdx];
    if (cue) {
      const scene = scenes.find((s) => s.id === cue.sceneId);
      if (scene) {
        try {
          const st = useShowStore.getState();
          sendChannelsToHardware(scene.channels, st.patchedFixtures, st.universes, 'vc');
        } catch { /* */ }
      }
    }
  };

  const handleBack = () => {
    if (!cueList || cueList.cues.length === 0) return;
    const prevIdx = cueList.currentCueIndex - 1;
    if (prevIdx < 0) {
      updateCueList(cueList.id, { currentCueIndex: cueList.cues.length - 1 });
    } else {
      updateCueList(cueList.id, { currentCueIndex: prevIdx });
    }
  };

  const handleStop = () => {
    if (!cueList) return;
    updateCueList(cueList.id, { currentCueIndex: -1 });
    vcZeroAllUniverses();
  };

  const handleAddCue = (sceneId: string) => {
    if (!cueList) return;
    const newCue = {
      id: `cue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sceneId,
      fadeIn: 1000,
      hold: 3000,
      fadeOut: 1000,
    };
    updateCueList(cueList.id, { cues: [...cueList.cues, newCue] });
    setShowAddCue(false);
  };

  const handleRemoveCue = (cueId: string) => {
    if (!cueList) return;
    updateCueList(cueList.id, { cues: cueList.cues.filter((c) => c.id !== cueId) });
  };

  const handleCreateList = () => {
    const id = createCueList('New Cue List');
    setSelectedId(id);
  };

  // Close add-cue popover on outside click
  useEffect(() => {
    if (!showAddCue) return;
    const handler = (e: MouseEvent) => {
      if (addCueRef.current && !addCueRef.current.contains(e.target as Node)) {
        setShowAddCue(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAddCue]);

  return (
    <div className="h-full p-8 overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Music size={20} className="text-purple-400" /> {t('perform.cueList.title')}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Theater-style sequential playback — press Go to advance manually through each cue.
            Unlike Chasers (which auto-loop), Cue Lists give you frame-by-frame control.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleGo}
            disabled={!cueList || cueList.cues.length === 0}
            className="px-4 py-2 bg-green-600/20 text-green-400 rounded-lg text-sm font-bold hover:bg-green-600/30 active:scale-95 transition-transform disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {t('perform.cueList.go')}
          </button>
          <button
            onClick={handleBack}
            disabled={!cueList || cueList.cues.length === 0}
            className="px-3 py-2 bg-gray-800/50 text-gray-400 rounded-lg text-sm hover:bg-gray-700/50 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {t('perform.cueList.back')}
          </button>
          <button
            onClick={handleStop}
            disabled={!cueList}
            className="px-3 py-2 bg-red-600/20 text-red-400 rounded-lg text-sm hover:bg-red-600/30 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {t('perform.cueList.stop')}
          </button>
        </div>
      </div>

      {/* Cue List selector */}
      {cueLists.length === 0 ? (
        <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl p-8 text-center">
          <div className="text-3xl mb-2 opacity-30">📋</div>
          <div className="text-sm text-gray-400 mb-2">No cue lists yet</div>
          <div className="text-xs text-gray-600 mb-4">Create cue lists in the Design tab first, or create one here:</div>
          <button
            onClick={handleCreateList}
            className="px-4 py-2 bg-purple-600/20 text-purple-300 rounded-lg text-xs hover:bg-purple-600/30"
          >
            <Plus size={14} className="inline mr-1" /> Create Cue List
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-[10px] text-gray-500 uppercase">Cue List:</span>
            <select
              value={selectedId || ''}
              onChange={(e) => setSelectedId(e.target.value)}
              className="bg-gray-800/50 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300"
            >
              {cueLists.map((cl) => (
                <option key={cl.id} value={cl.id}>{cl.name} ({cl.cues.length} cues)</option>
              ))}
            </select>
            <button
              onClick={handleCreateList}
              className="text-[10px] text-purple-400 hover:text-purple-300 ml-2"
            >
              <Plus size={12} className="inline" /> New
            </button>
          </div>

          <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl overflow-hidden">
            {/* Toolbar */}
            <div className="px-4 py-2 border-b border-gray-800/50 flex items-center justify-between">
              <span className="text-xs font-medium text-gray-400">
                {cueList?.name || 'Cue List'} — {cueList?.cues.length || 0} cue{(cueList?.cues.length || 0) !== 1 ? 's' : ''}
              </span>
              <div className="relative">
                <button
                  onClick={() => setShowAddCue(!showAddCue)}
                  className="text-xs text-purple-400 hover:text-purple-300 flex items-center gap-1"
                >
                  <Plus size={12} /> Add Cue
                </button>
                {showAddCue && (
                  <div
                    ref={addCueRef}
                    className="absolute right-0 top-full mt-1 z-50 bg-[#1a1a28] border border-gray-700 rounded-lg shadow-xl w-56 max-h-48 overflow-y-auto"
                  >
                    {scenes.length === 0 ? (
                      <div className="text-xs text-gray-600 text-center py-4">No scenes available. Create scenes in the Design tab first.</div>
                    ) : (
                      scenes.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => handleAddCue(s.id)}
                          className="w-full text-left px-3 py-2 hover:bg-gray-800/30 text-xs flex items-center justify-between text-gray-300"
                        >
                          <span className="truncate flex-1">{s.name}</span>
                          <span className="text-[10px] text-gray-600 ml-2">{Object.values(s.channels).filter((v) => v > 0).length}ch</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Cue rows */}
            {cueList?.cues.length === 0 ? (
              <div className="p-8 text-center text-xs text-gray-600">
                No cues in this list. Click "Add Cue" to add scenes as cues.
              </div>
            ) : (
              cueList?.cues.map((cue, idx) => {
                const scene = scenes.find((s) => s.id === cue.sceneId);
                const isCurrent = cueList.currentCueIndex === idx;
                const isPast = cueList.currentCueIndex > idx && cueList.currentCueIndex >= 0;
                return (
                  <div
                    key={cue.id}
                    className={`flex items-center gap-4 px-4 py-2.5 border-b border-gray-800/20 last:border-0 transition-colors ${
                      isCurrent
                        ? 'bg-purple-600/15 border-l-2 border-l-purple-500'
                        : isPast
                        ? 'opacity-50'
                        : ''
                    }`}
                  >
                    <span
                      className={`font-mono text-xs w-8 shrink-0 ${
                        isCurrent ? 'text-purple-300 font-bold' : 'text-gray-600'
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <span
                      className={`flex-1 text-sm truncate ${
                        isCurrent ? 'text-purple-300 font-medium' : 'text-gray-400'
                      }`}
                    >
                      {scene?.name || cue.sceneId}
                    </span>
                    <span className="text-xs text-gray-600 w-16 shrink-0">
                      Fade: {(cue.fadeIn / 1000).toFixed(1)}s
                    </span>
                    <span className="text-xs text-gray-600 w-16 shrink-0">
                      Hold: {(cue.hold / 1000).toFixed(1)}s
                    </span>
                    <span
                      className={`text-[10px] font-medium w-16 text-right shrink-0 ${
                        isCurrent
                          ? 'text-purple-400'
                          : isPast
                          ? 'text-green-600'
                          : 'text-gray-600'
                      }`}
                    >
                      {isCurrent
                        ? t('perform.cueList.now')
                        : isPast
                        ? t('perform.cueList.done')
                        : t('perform.cueList.next')}
                    </span>
                    <button
                      onClick={() => handleRemoveCue(cue.id)}
                      className="text-gray-600 hover:text-red-400 shrink-0"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// SETTINGS PANEL
// ═══════════════════════════════════════════════════════════

const PerformSettingsPanel: React.FC = () => { const { t } = useTranslation(); return (
  <div className="h-full p-8 overflow-y-auto">
    <h2 className="text-xl font-bold text-white flex items-center gap-2 mb-6">
      <Settings size={20} className="text-purple-400" /> {t('perform.performanceSettings')}
    </h2>
    <div className="grid grid-cols-2 gap-4 max-w-lg">
      {[
        { label: t('perform.settings.midiFeedback'), desc: t('perform.settings.midiFeedbackDesc'), on: true, backlog: true },
        { label: t('perform.settings.midiThru'), desc: t('perform.settings.midiThruDesc'), on: false, backlog: true },
        { label: t('perform.settings.touchOsc'), desc: t('perform.settings.touchOscDesc'), on: true, backlog: false },
        { label: t('perform.settings.grandMasterFade'), desc: t('perform.settings.grandMasterFadeDesc'), on: true, backlog: false },
        { label: t('perform.settings.vcLock'), desc: t('perform.settings.vcLockDesc'), on: false, backlog: false },
      ].map((s, i) => (
        <div key={i} className="bg-[#0d0d14] border border-gray-800/50 rounded-xl p-4 flex items-center justify-between">
          <div>
            <div className="text-sm text-gray-300">{s.label}</div>
            <div className="text-[10px] text-gray-600">{s.desc}</div>
            {s.backlog && (
              <div className="text-[9px] text-gray-700 mt-0.5">{t('perform.settings.backlogNote')}</div>
            )}
          </div>
          <label className="relative w-9 h-5 cursor-pointer">
            <input type="checkbox" defaultChecked={s.on} className="sr-only peer" />
            <div className="w-full h-full bg-gray-700 rounded-full peer-checked:bg-purple-600 transition-colors" />
            <div className="absolute w-3.5 h-3.5 bg-white rounded-full top-0.5 left-0.5 peer-checked:left-5 transition-all" />
          </label>
        </div>
      ))}
    </div>
  </div>
); };
