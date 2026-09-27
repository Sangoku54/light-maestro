import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { clampRect } from '../components/clampedpopup';
import { useTranslation } from 'react-i18next';
import {
  Grid, Sliders, Crosshair, Music, Zap, ChevronRight, Settings,
  Plus, MousePointer2, ToggleLeft, GripHorizontal, Columns, Trash2,
  Copy, Maximize2, Minimize2, Square, Keyboard, Eye, EyeOff,
  ChevronUp, ChevronDown, Hash, Download, Upload, RotateCcw, Loader, Wifi,
  Timer as TimerIcon, Radio, Pencil
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { useShowStore, type SavedCueList, type CueListCue, type SongPreset, findBestSongPreset, presetHasAudio } from '../stores/showStore';
import { computeDmxCues, loadFixtureDefinitions, type CueInput, type DmxCue } from '../hooks/dmx-cues';
import { computeDmxForCue } from '../hooks/dmx-playback';
import { SongPresetPlayer } from '../components/SongPresetPlayer';
import { analyzeAudioBuffer, type TrackAnalysis } from '../hooks/audio-analysis';
import { sendChannelsToHardware, sendToUniverse } from '../utils/dmx-helpers';
import { dmxBridge } from '../utils/dmx-bridge';
import { startAutoLoop, stopAutoLoop, isAutoLoopActive, stopAllAutoLoops } from '../engine/auto-loop-player';
import { generateLoopLibrary, loopToRecipe, LOOP_KIND_LABEL, LOOP_KIND_ORDER, type AutoLoop, type LoopRecipe } from '../engine/auto-loops';
import { preloadAudioUrl, decodeAudioUrl } from '../utils/audio-cache';
import { generateEfxPanTilt } from '../hooks/fixture-tracks';
import { resolveAudioUrl } from '../utils/project-audio';
import { importCustomFixtureDefs } from '../utils/custom-fixtures';
import { timecodeToMs, msToTimecode, isValidTimecode } from '../engine/mtc-markers';
import { registerMidiWidgetHandler, unregisterMidiWidgetHandler } from '../engine/midi-actions';
import { vcButtonPress, vcDeactivate, vcOnRunChange } from '../engine/virtual-console-runtime';
import { Stage3D } from './Stage3D';
import {
  usePerformStore,
  applyWidgetSliderEffect,
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
  if ((activeTab as string) === 'osc') return <OscPanel />;

  switch (activeTab) {
    case 'vconsole': return <VirtualConsolePanel />;
    case 'midi': return <MIDIMappingPanel />;
    case 'mtc': return <MTCPanel />;
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
// Virtual Console — Audio Mutual Exclusion Registry
// ═══════════════════════════════════════════════════════════
// Ensures only ONE audio source plays at a time across all widgets.
// Any widget that plays audio must register here and call stopAll()
// before starting its own playback.

type AudioPlaybackController = {
  stop: () => void;
  widgetId: string;
};

const _activeAudioRegistry: AudioPlaybackController[] = [];

/** Stop and deregister ALL active audio playback. Called before any new audio starts. */
function stopAllAudioPlayback() {
  for (const ctl of _activeAudioRegistry.splice(0)) {
    try { ctl.stop(); } catch {}
  }
  // Also stop the global show playback (loadShow)
  if ((window as any).__lm_perfPlayActive) {
    try { (window as any).__lm_perfStopPlayback?.(); } catch {}
  }
}

/** Register a new audio playback. Stops all others first. */
function registerAudioPlayback(widgetId: string, stop: () => void): () => void {
  stopAllAudioPlayback();
  const ctl: AudioPlaybackController = { stop, widgetId };
  _activeAudioRegistry.push(ctl);
  return () => {
    const idx = _activeAudioRegistry.indexOf(ctl);
    if (idx >= 0) _activeAudioRegistry.splice(idx, 1);
  };
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
  const vcRenamePage = usePerformStore((s) => s.vcRenamePage);
  const vcSetGridSnap = usePerformStore((s) => s.vcSetGridSnap);
  const vcSetAddingWidget = usePerformStore((s) => s.vcSetAddingWidget);
  const vcAddAkaiSurfacePage = usePerformStore((s) => s.vcAddAkaiSurfacePage);

  const [showPalette, setShowPalette] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; widgetId: string } | null>(null);
  const [pageMenu, setPageMenu] = useState<{ x: number; y: number; index: number } | null>(null);
  const [renamingPage, setRenamingPage] = useState<{ index: number; value: string } | null>(null);
  const [showWidgetConfig, setShowWidgetConfig] = useState<string | null>(null);
  const paletteRef = useRef<HTMLDivElement>(null);

  /** Clic droit sur un onglet de page → renommage en ligne (ou menu). */
  const startPageRename = useCallback((index: number) => {
    setPageMenu(null);
    setRenamingPage({ index, value: pages[index]?.name ?? '' });
  }, [pages]);

  const commitPageRename = useCallback(() => {
    setRenamingPage((cur) => {
      if (cur) {
        const value = cur.value.trim();
        if (value && value !== pages[cur.index]?.name) vcRenamePage(cur.index, value);
      }
      return null;
    });
  }, [pages, vcRenamePage]);

  // Cleanup: stop all audio when leaving Virtual Console (e.g. switching tabs)
  useEffect(() => {
    return () => { stopAllAudioPlayback(); };
  }, []);

  /**
   * Crée une page « surface Akai » pré-programmée : 8 pads scènes, 8 pads
   * chasers, Blackout + boucles auto, 8 faders (GM + canaux DMX).
   * Les boucles auto dépendent du patch → génération asynchrone du catalogue.
   */
  const handleAddAkaiSurface = async () => {
    const showState = useShowStore.getState();
    let loops: LoopRecipe[] = [];
    try {
      const pfs = showState.patchedFixtures;
      if (pfs.length) {
        const ids = [...new Set(pfs.map((f) => f.fixtureDefId))];
        const defs = await loadFixtureDefinitions(ids);
        loops = generateLoopLibrary(pfs, defs, {
          count: 36,
          seed: 0,
          positions: showState.fixturePositions,
        }).map(loopToRecipe);
      }
    } catch { /* catalogue indisponible → touches libres */ }

    vcAddAkaiSurfacePage({
      scenes: showState.scenes.map((s) => ({ id: s.id, name: s.name })),
      chasers: showState.chasers.map((c) => ({ id: c.id, name: c.name })),
      loops,
    });
  };

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
        x: Math.max(0, Math.min(float3DDragRef.current.startLeft + ev.clientX - float3DDragRef.current.startX, window.innerWidth - 120)),
        y: Math.max(0, Math.min(float3DDragRef.current.startTop + ev.clientY - float3DDragRef.current.startY, window.innerHeight - 40)),
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
  // Listens for show-play requests via custom event (from widget activate())
  useEffect(() => {
    let cleanup: (() => void) | null = null;

    const startShowPlayback = (showData: any) => {
      // Cleanup any previous playback
      if (showPlaybackRef.current) {
        cancelAnimationFrame(showPlaybackRef.current.rafId);
        for (const src of showPlaybackRef.current.audioSources) { try { src.stop(); } catch {} }
        try { showPlaybackRef.current.audioCtx?.close(); } catch {}
      }

    const fixtureDefs = new Map<string, any>();
    const audioBuffers = new Map<string, AudioBuffer>();
    const audioSources: AudioBufferSourceNode[] = [];
    const startedAudios = new Set<string>();
    const startTime = performance.now();
    let audioCtx: AudioContext | null = null;

    const getAudioBuffer = async (b64: string): Promise<AudioBuffer> => {
      if (audioBuffers.has(b64)) return audioBuffers.get(b64)!;
      // Use the shared decoded-buffer cache so preloaded audio (widget idle
      // preload) starts instantly and repeated plays are free.
      const buffer = await decodeAudioUrl(b64);
      if (buffer) audioBuffers.set(b64, buffer);
      return buffer!;
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
      // Notify widgets so their active state resets (natural end or stop)
      try { window.dispatchEvent(new Event('lm-perf-play-stopped')); } catch {}
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
            getAudioBuffer(item.audioFileBase64).then((buffer) => {
              if (!showPlaybackRef.current) return;
              // Lazy-init the AudioContext: it was never created before, so
              // show audio never played while the lights (scene/chaser/efx
              // branches) did — "lights on, no audio".
              if (!audioCtx) {
                try {
                  audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
                  showPlaybackRef.current.audioCtx = audioCtx;
                } catch { return; }
              }
              const ctx = audioCtx;
              if (!ctx || ctx.state === 'closed') return;
              if (ctx.state === 'suspended') void ctx.resume();
              // Recompute the offset at playback time: the async decode
              // above took real time, so the offset captured at tick time
              // would start the audio late relative to the show clock
              // (the lights). Align on the show clock instead.
              const startRef = showPlaybackRef.current;
              const audioOffsetSec = Math.max(0, (performance.now() - startRef.startTime - itemStart)) / 1000;
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
            const efxSpread = (efx as any).spread ?? 0;
            for (let efxi = 0; efxi < ids.length; efxi++) {
              const fid = ids[efxi];
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

              // Math EXACTE du moteur (fixture-tracks.ts) : identique au preview.
              // L'ancienne copie locale tronquait les patterns (seuls 5 sur 10
              // bougeaient), sous-dosait amplitude/offsets et lisait la
              // rotation en unités /255 au lieu de degrés.
              const tBase = (tSec * (efx.speed || 0.5) * 2) / (Math.PI * 2);
              const tCycles = ids.length > 1 && efxSpread > 0 ? tBase + (efxi * efxSpread) / ids.length : tBase;
              const { pan: dmxPan, tilt: dmxTilt } = generateEfxPanTilt(
                efx.pattern, tCycles, efx.width ?? 0.5, efx.height ?? 0.5,
                efx.rotation ?? 0, efx.xOffset ?? 0, efx.yOffset ?? 0,
              );

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
    };

    // Stop function accessible from cleanup
    const stopAll = () => {
      if (showPlaybackRef.current) {
        cancelAnimationFrame(showPlaybackRef.current.rafId);
        for (const src of showPlaybackRef.current.audioSources) { try { src.stop(); } catch {} }
        try { showPlaybackRef.current.audioCtx?.close(); } catch {}
      }
      showPlaybackRef.current = null;
      delete (window as any).__lm_perfPlayActive;
      vcZeroAllUniverses();
    };

    // Listen for show-play requests from widget activate()
    const handlePlayShow = () => {
      const showData = (window as any).__lm_perfPlayShow;
      if (showData) {
        delete (window as any).__lm_perfPlayShow;
        startShowPlayback(showData);
      }
    };
    window.addEventListener('lm-perf-play-show', handlePlayShow);

    // Also check for any pending signal from before mount
    const pending = (window as any).__lm_perfPlayShow;
    if (pending) {
      delete (window as any).__lm_perfPlayShow;
      startShowPlayback(pending);
    }

    return () => {
      window.removeEventListener('lm-perf-play-show', handlePlayShow);
      stopAll();
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

        <div className="w-px h-5 bg-gray-800/60 mx-1" />

        {/* Akai-style pre-programmed surface */}
        <button
          onClick={handleAddAkaiSurface}
          className="px-2 py-1 rounded-md text-[11px] flex items-center gap-1.5 text-gray-300 hover:text-purple-300 hover:bg-white/5 border border-gray-800/60 transition-colors"
          title={t('perform.vc.addAkaiSurfaceHint')}
        >
          <Sliders size={13} />
          {t('perform.vc.addAkaiSurface')}
        </button>

        {addingWidget && (
          <span className="text-[10px] text-amber-400 ml-2">
            {t('perform.vc.clickToPlace', { widget: addingWidget })}
          </span>
        )}
      </div>

      {/* Page Tabs */}
      <div className="px-2 pt-1.5 flex items-center gap-0.5 shrink-0 overflow-x-auto">
        {pages.map((page, i) =>
          renamingPage?.index === i ? (
            <input
              key={`rename-${i}`}
              autoFocus
              value={renamingPage.value}
              onChange={(e) => setRenamingPage({ index: i, value: e.target.value })}
              onBlur={commitPageRename}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitPageRename(); }
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setRenamingPage(null); }
              }}
              size={Math.max(6, Math.min(24, renamingPage.value.length + 1))}
              className="px-2 py-1.5 rounded-t-md text-xs font-medium bg-purple-600/20 text-purple-200 border border-purple-500/40 outline-none"
            />
          ) : (
            <button
              key={i}
              onClick={() => vcSetActivePage(i)}
              onDoubleClick={() => startPageRename(i)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setPageMenu({ x: e.clientX, y: e.clientY, index: i });
              }}
              title={t('perform.vc.renamePage')}
              className={`px-4 py-1.5 rounded-t-md text-xs font-medium transition-all ${
                activePage === i
                  ? 'bg-purple-600/20 text-purple-300 border-t border-x border-purple-500/30'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {page.name}
            </button>
          ),
        )}
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

      {/* Page context menu — clic droit sur un onglet de page */}
      {pageMenu && (
        <PageContextMenu
          x={pageMenu.x}
          y={pageMenu.y}
          canDelete={pages.length > 1}
          onClose={() => setPageMenu(null)}
          onRename={() => startPageRename(pageMenu.index)}
          onDelete={() => { setPageMenu(null); vcDeletePage(pageMenu.index); }}
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
          style={{ left: float3DPos.x, top: float3DPos.y, width: float3DSize.w, height: float3DSize.h, minWidth: 320, minHeight: 200, maxWidth: '95vw', maxHeight: '85vh', overflow: 'hidden' }}
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
        style={{ ...clampRect(x, y, 180, 220, window.innerWidth, window.innerHeight) }}
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

/** Menu clic droit d'un onglet de page : renommer (en ligne) / supprimer. */
const PageContextMenu: React.FC<{
  x: number; y: number;
  canDelete: boolean;
  onClose: () => void;
  onRename: () => void;
  onDelete: () => void;
}> = ({ x, y, canDelete, onClose, onRename, onDelete }) => {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] bg-[#12121a] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px]"
      style={{ ...clampRect(x, y, 180, 120, window.innerWidth, window.innerHeight) }}
    >
      <button
        onClick={onRename}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 hover:bg-purple-600/20"
      >
        <Pencil size={12} /> {t('perform.vc.renamePage')}
      </button>
      <div className="border-t border-gray-800 my-1" />
      <button
        onClick={onDelete}
        disabled={!canDelete}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-red-600/20 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Trash2 size={12} /> {t('perform.vc.deletePage')}
      </button>
    </div>
  );
};

// ─── Widget Config Modal ───────────────────────────────────

/**
 * Picker de boucles auto pour la config d'un widget `autoLoop`.
 * Génère le même catalogue (seed 0) que le panneau QuickShow et le présente
 * groupé par catégorie, pour retrouver la boucle choisie en amont.
 */
const AutoLoopPicker: React.FC<{ selected?: LoopRecipe; onSelect: (r: LoopRecipe) => void }> = ({ selected, onSelect }) => {
  const patchedFixtures = useShowStore((s) => s.patchedFixtures);
  const fixturePositions = useShowStore((s) => s.fixturePositions);
  const [loops, setLoops] = useState<AutoLoop[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!patchedFixtures.length) { setLoops([]); return; }
    const ids = [...new Set(patchedFixtures.map((f) => f.fixtureDefId))];
    loadFixtureDefinitions(ids)
      .then((defs) => {
        if (!cancelled) setLoops(generateLoopLibrary(patchedFixtures, defs, { count: 36, seed: 0, positions: fixturePositions }));
      })
      .catch(() => { if (!cancelled) setLoops([]); });
    return () => { cancelled = true; };
  }, [patchedFixtures, fixturePositions]);

  const grouped: [AutoLoop['kind'], AutoLoop[]][] = LOOP_KIND_ORDER
    .map((k) => [k, loops.filter((l) => l.kind === k)] as [AutoLoop['kind'], AutoLoop[]])
    .filter(([, arr]) => arr.length > 0);

  const selectedId = selected
    ? loops.find((l) => l.kind === selected.kind && l.name === selected.name && l.tier === selected.tier)?.id ?? ''
    : '';

  return (
    <div>
      <label className="text-[10px] text-gray-500 uppercase tracking-wider">Scène pré-programmée</label>
      <select
        value={selectedId}
        onChange={(e) => {
          const loop = loops.find((l) => l.id === e.target.value);
          if (loop) onSelect(loopToRecipe(loop));
        }}
        className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300"
      >
        <option value="">— Choisir une boucle —</option>
        {grouped.map(([kind, arr]) => (
          <optgroup key={kind} label={LOOP_KIND_LABEL[kind]}>
            {arr.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} · {l.speedBpm} BPM {l.direction === 'forward' ? '→' : l.direction === 'backward' ? '←' : '↔'}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {loops.length === 0 && (
        <p className="text-[9px] text-amber-400 mt-1">Patch des fixtures dans Setup pour générer des boucles.</p>
      )}
    </div>
  );
};

const WidgetConfigModal: React.FC<{ widget: ConsoleWidget; onClose: () => void }> = ({ widget, onClose }) => {
  const { t } = useTranslation();
  const vcUpdateWidget = usePerformStore((s) => s.vcUpdateWidget);
  const scenes = useShowStore((s) => s.scenes);
  const chasers = useShowStore((s) => s.chasers);
  const songPresets = useShowStore((s) => s.songPresets);
  const storeShows = useShowStore((s) => s.shows);
  const universes = useShowStore((s) => s.universes);

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
      <div className="bg-[#12121a] border border-gray-700 rounded-xl shadow-2xl w-[380px] max-w-[95vw] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
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
                  <option value="grandMaster">{t('perform.vc.grandMaster')}</option>
                  <option value="dmxChannel">{t('perform.vc.dmxChannel')}</option>
                  <option value="loadShow">♪ Play Show</option>
                  <option value="playSong">♪ Play Preset</option>
                  <option value="autoLoop">🎛 Scène pré-programmée</option>
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
                    <p className="text-[10px] text-emerald-400">📂 {config.showName}</p>
                  ) : (
                    <p className="text-[9px] text-purple-400">Pick a show from the store or load a .lmshow file</p>
                  )}
                  {storeShows.length > 0 && (
                    <select
                      value={config.showId || ''}
                      onChange={(e) => {
                        const show = storeShows.find((s) => s.id === e.target.value);
                        if (show) {
                          setConfig({ ...config, showId: show.id, showName: show.name, showData: show });
                        }
                      }}
                      className="w-full text-[10px] bg-gray-800 border border-gray-700 rounded px-1 py-0.5 text-gray-300"
                    >
                      <option value="">— Select a show —</option>
                      {storeShows.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
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
                      onClick={() => setConfig({ ...config, showName: undefined as any, showData: undefined as any, showId: undefined as any })}
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
                        const full: any = {
                          name,
                          // Ne jamais écraser l'audio existant par du vide :
                          // si le fichier n'apporte pas de son, on garde le
                          // base64 et la ref déjà en store (merge de update).
                          ...(audioSrc ? { audioFileBase64: audioSrc, audioRef: undefined } : {}),
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
                          disabledFixtures: p.disabledFixtures || [],
                          musicians: p.musicians,
                          stageScene: p.stageScene,
                          view3D: p.view3D,
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

              {config.actionType === 'grandMaster' && (
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('perform.vc.gmValue')}</label>
                  <input type="number" min={0} max={255} value={config.grandMasterValue ?? 0}
                    onChange={(e) => setConfig({ ...config, grandMasterValue: Number(e.target.value) })}
                    className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300" />
                  <p className="text-[9px] text-gray-500 mt-1">0 = noir (kill), 255 = pleine puissance. Réappuyer restaure 255.</p>
                </div>
              )}

              {config.actionType === 'dmxChannel' && (
                <div className="space-y-2">
                  <div>
                    <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('perform.vc.universe')}</label>
                    <select value={config.dmxUniverse ?? 0}
                      onChange={(e) => setConfig({ ...config, dmxUniverse: Number(e.target.value) })}
                      className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300">
                      {universes.length === 0 ? (
                        <option value={0}>1</option>
                      ) : (
                        universes.map((u: any, i: number) => (
                          <option key={String(u.id)} value={i}>
                            {i + 1}{u.name ? ` · ${u.name}` : ''}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('perform.vc.channelAddress')}</label>
                    <input type="number" min={1} max={512} value={config.dmxAddress || ''}
                      placeholder="1-512"
                      onChange={(e) => setConfig({ ...config, dmxAddress: Number(e.target.value) })}
                      className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('perform.vc.dmxValue')}</label>
                    <input type="number" min={0} max={255} value={config.dmxValue ?? 255}
                      onChange={(e) => setConfig({ ...config, dmxValue: Number(e.target.value) })}
                      className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300" />
                  </div>
                </div>
              )}

              {config.actionType === 'autoLoop' && (
                <AutoLoopPicker
                  selected={config.autoLoopRecipe}
                  onSelect={(recipe) => setConfig({ ...config, autoLoopRecipe: recipe })}
                />
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
                <>
                  <div>
                    <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('perform.vc.universe')}</label>
                    <select value={config.sliderUniverse ?? 0}
                      onChange={(e) => setConfig({ ...config, sliderUniverse: Number(e.target.value) })}
                      className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300">
                      {universes.length === 0 ? (
                        <option value={0}>1</option>
                      ) : (
                        universes.map((u: any, i: number) => (
                          <option key={String(u.id)} value={i}>
                            {i + 1}{u.name ? ` · ${u.name}` : ''}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] text-gray-500 uppercase tracking-wider">{t('perform.vc.channelAddress')}</label>
                    <input type="number" min={1} max={512} value={config.channelAddress || 1}
                      onChange={(e) => setConfig({ ...config, channelAddress: Number(e.target.value) })}
                      className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300" />
                  </div>
                </>
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
      const analysis = await analyzeAudioBuffer(
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
  const autoAudioRef = useRef<HTMLAudioElement | null>(null);
  const autoRafRef = useRef<number>(0);
  const regeneratingRef = useRef(false);
  const playIntentRef = useRef(false);
  const [songPlayer, setSongPlayer] = useState<SongPreset | null>(null);
  const unregisterAudioRef = useRef<(() => void) | null>(null);

  // La LED de la tuile suit l'état réel du runtime partagé (clic, MIDI,
  // fin naturelle d'une scène) — le run survit au changement de page.
  useEffect(() => vcOnRunChange((id, running) => {
    if (id === widget.id) setActive(running);
  }), [widget.id]);

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
    const sp = findBestSongPreset(songPresets, config.songId, config.songName);
    return sp ? `♪ ${sp.name}` : (config.songName ? `♪ ${config.songName}` : '♪ Song');
  };

  // Pre-decode the preset's audio while the widget is idle (before any
  // click), so playback starts with ~zero audio latency. The decoded
  // AudioBuffer is cached module-wide and reused by SongPresetPlayer.
  // Résout aussi audioRef (preset externalisé après sauvegarde).
  useEffect(() => {
    if (config.actionType !== 'playSong') return;
    const sp: any = findBestSongPreset(songPresets, config.songId, config.songName);
    if (!sp) return;
    const direct = sp.audioFileBase64 || sp.audioDataBase64;
    if (direct) { preloadAudioUrl(direct); return; }
    if (sp.audioRef) {
      void resolveAudioUrl(sp).then((url) => { if (url) preloadAudioUrl(url); });
    }
  }, [config.actionType, config.songId, config.songName, songPresets]);

  // ─── audioAutoScript playback helper ──────────────────
  const _startAudioAutoScript = (cues: any[]) => {
    if (!cues || cues.length === 0) {
      console.warn('AudioAutoScript: no cues to play');
      return;
    }
    console.log('AudioAutoScript: starting', config.audioFileName, 'cues:', cues.length);
    // Use the shared decoded-buffer cache instead of new Audio(dataUrl):
    // HTMLAudioElement blocks the renderer while decoding multi-MB base64,
    // which stalls the watchdog and delays the first DMX frame by seconds.
    let audioCtx: AudioContext | null = null;
    let audioSrc: AudioBufferSourceNode | null = null;
    let audioPlayOffset = 0; // seconds already elapsed before audio starts
    const stopAudio = () => {
      try { audioSrc?.stop(); } catch {}
      try { audioCtx?.close(); } catch {}
      audioSrc = null;
      audioCtx = null;
    };
    autoAudioRef.current = { stop: stopAudio } as any;
    // Register with global mutex: stop all other audio, then track this one
    unregisterAudioRef.current = registerAudioPlayback(widget.id, () => {
      cancelAnimationFrame(autoRafRef.current);
      stopAudio();
      autoAudioRef.current = null;
      vcZeroAllUniverses();
      setActive(false);
    });
    let startTime = 0;
    let firstFrameDone = false;
    const firedCues = new Set<string>();
    // Ensure the DMX engine is running (and any fail-safe blackout lifted)
    // before the first frame — writing into a stopped/blacked engine outputs
    // nothing.
    (async () => {
      try {
        const api = (window as any).lightMaestro?.dmx;
        if (api) {
          const running = await api.isRunning().catch(() => false);
          if (!running) await api.start().catch(() => {});
        }
      } catch {}
    })();
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
      const playing = audioSrc !== null || (performance.now() - startTime) < (cues[cues.length - 1]?.time ?? 0) * 1000 + 2000;
      if (playing) autoRafRef.current = requestAnimationFrame(fireAutoDmx);
    };
    const beginPlayback = () => {
      startTime = performance.now();
      fireAutoDmx();
    };
    (async () => {
      try {
        audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        const buffer = await decodeAudioUrl(config.audioDataUrl);
        if (!buffer || !audioCtx || audioCtx.state === 'closed') { beginPlayback(); return; }
        audioSrc = audioCtx.createBufferSource();
        audioSrc.buffer = buffer;
        audioSrc.connect(audioCtx.destination);
        audioSrc.onended = () => {
          cancelAnimationFrame(autoRafRef.current);
          vcZeroAllUniverses();
          autoAudioRef.current = null;
          if (unregisterAudioRef.current) { unregisterAudioRef.current(); unregisterAudioRef.current = null; }
          setActive(false);
        };
        audioSrc.start(0, audioPlayOffset);
        beginPlayback();
      } catch {
        // Audio failed — still run the DMX script on the virtual clock
        beginPlayback();
      }
    })();
  };

  const activate = () => {
    setActive(true);
    const currentState = useShowStore.getState();

    // Scènes / chasers / blackout / grandMaster / canal DMX → runtime partagé
    // (mêmes chemins que le pilotage MIDI, testable unitairement, survit au
    // changement de page). La LED de la tuile suit l'état réel via vcOnRunChange.
    if (
      config.actionType === 'scene' ||
      config.actionType === 'chaser' ||
      config.actionType === 'blackout' ||
      config.actionType === 'grandMaster' ||
      config.actionType === 'dmxChannel'
    ) {
      vcButtonPress(widget.id, true);
      return;
    }

    // DMX engine will be restarted by PlaySong/audioAutoScript handlers when needed

    if (config.actionType === 'loadShow') {
      (async () => {
        try {
          // Toggle: if already playing, stop
          if ((window as any).__lm_perfPlayActive) {
            (window as any).__lm_perfStopPlayback?.();
            stopAllAudioPlayback();
            return;
          }
          // Stop any other widget audio before starting show playback
          stopAllAudioPlayback();
          // Use pre-loaded show data, or find it in the store, or open file picker
          let p = config.showData;
          if (!p) {
            // Try to find the show in the store by name or ID (showData was stripped on save)
            const storeShows = useShowStore.getState().shows;
            p = storeShows.find((s: any) =>
              s.name === config.showName || s.id === config.showId
            ) as any;
          }
          if (!p) {
            const r = await window.lightMaestro?.dialog?.openFile?.([{ name: 'Light Maestro Show', extensions: ['lmshow', 'lmproj'] }]);
            if (!r?.content) return;
            p = JSON.parse(r.content);
          }
          // Ré-importer les fixtures custom embarquées (.lmshow/.lmproj)
          await importCustomFixtureDefs(p?.customFixtures);
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
            // Mark active immediately so toggle stop works before React processes the event
            (window as any).__lm_perfPlayActive = true;
            // Pass the show via a window ref (NO structured clone — the show can
            // embed multi-MB audio base64 and CustomEvent detail would deep-copy
            // it synchronously, freezing the renderer for seconds).
            (window as any).__lm_perfPlayShow = showData;
            window.dispatchEvent(new Event('lm-perf-play-show'));
          } else {
            // .lmproject format - load into QuickShow
            useAppStore.getState().setMode?.('quick');
            (window as any).__lm_triggerPlay?.();
          }
        } catch (err) { console.error('[VC loadShow] failed:', err); }
      })();
      return;
    }

    if (config.actionType === 'playSong' && config.songId) {
      const preset = findBestSongPreset(songPresets, config.songId, config.songName);
      if (!preset) {
        console.warn('PlaySong: preset not found', config.songId, 'available:', songPresets.map((p) => `${p.name}#${p.id}`).join(', '));
        return;
      }
      if (config.songName) {
        const dupes = songPresets.filter((p) => p.name === (preset as any).name).length;
        if (dupes > 1) console.warn(`[PlaySong] preset "${(preset as any).name}": ${dupes} homonymes, audio=${presetHasAudio(preset as any) ? 'oui' : 'non'}`);
      }
      // Playback no longer requires an audio file: SongPresetPlayer uses a
      // virtual clock when the audio is missing or not yet playable.
      // Toggle the full live playback (SongPresetPlayer) on/off
      if (songPlayer) {
        // Already playing this preset → stop
        if (unregisterAudioRef.current) { unregisterAudioRef.current(); unregisterAudioRef.current = null; }
        setSongPlayer(null);
        return;
      }
      // Stop all other audio, then register this playback
      unregisterAudioRef.current = registerAudioPlayback(widget.id, () => {
        setSongPlayer(null);
        setActive(false);
      });
      setSongPlayer(preset);
      return;
    }

    if (config.actionType === 'audioAutoScript' && config.audioDataUrl) {
      // Toggle: if already playing this button, stop
      if (autoAudioRef.current) {
        if (unregisterAudioRef.current) { unregisterAudioRef.current(); unregisterAudioRef.current = null; }
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
            analysis = await analyzeAudioBuffer(ab, config.audioFileName || 'audio.mp3', buf.byteLength);
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

    if (config.actionType === 'autoLoop' && config.autoLoopRecipe) {
      // Le toggle/flash est géré par `active` (handleClick/handleMouseUp) :
      // ici on démarre simplement ; `deactivate()` arrête la boucle.
      startAutoLoop(widget.id, config.autoLoopRecipe).then(() => {});
      return;
    }
  };

  const deactivate = () => {
    setActive(false);
    playIntentRef.current = false;
    // Scènes / chasers / blackout / grandMaster / canal DMX → runtime partagé :
    // annule timers et fades, éteint les canaux allumés (fadeOut respecté),
    // RESTAURE blackout / GM / canal (l'inverse exact de l'activation).
    if (
      config.actionType === 'scene' ||
      config.actionType === 'chaser' ||
      config.actionType === 'blackout' ||
      config.actionType === 'grandMaster' ||
      config.actionType === 'dmxChannel'
    ) {
      vcDeactivate(widget.id);
      return;
    }
    // Stop audioAutoScript playback
    if (autoAudioRef.current) {
      cancelAnimationFrame(autoRafRef.current);
      const h = autoAudioRef.current as any;
      if (typeof h.stop === 'function') h.stop();
      autoAudioRef.current = null;
      vcZeroAllUniverses();
    }
    // Stop auto loop playback
    if (config.actionType === 'autoLoop') {
      stopAutoLoop(widget.id);
    }
    // Stop playSong playback
    setSongPlayer(null);
    // Stop show playback (loadShow widget) — the toggle path: the 2nd
    // click lands here (active=true → deactivate), not in activate()'s
    // __lm_perfPlayActive check, so the show would otherwise keep running.
    if (config.actionType === 'loadShow' && (window as any).__lm_perfPlayActive) {
      try { (window as any).__lm_perfStopPlayback?.(); } catch {}
    }
    // Unregister from global audio mutex
    if (unregisterAudioRef.current) { unregisterAudioRef.current(); unregisterAudioRef.current = null; }
  };

  // Reset the widget's active state when the global show playback stops
  // (natural end of the show or stop from another widget), so the next
  // click restarts it instead of toggling a dead "active" state.
  useEffect(() => {
    if (config.actionType !== 'loadShow') return;
    const onStop = () => setActive(false);
    window.addEventListener('lm-perf-play-stopped', onStop);
    return () => window.removeEventListener('lm-perf-play-stopped', onStop);
  }, [config.actionType]);

  // Stop the auto loop if the widget is deleted or unmounted.
  useEffect(() => {
    return () => { if (config.actionType === 'autoLoop') stopAutoLoop(widget.id); };
  }, [config.actionType, widget.id]);

  // Contrôleur MIDI physique (Akai…) → le VRAI composant (état visuel inclus).
  // Registre exigé par midi-actions (dette M3) : sans ça, seul le fallback
  // config — scene/chaser/blackout — serait piloté. Les handlers sont lus
  // via une ref pour éviter une closure périmée à l'enregistrement.
  const midiHandlersRef = useRef({ activate, deactivate });
  const activeRef = useRef(active);
  activeRef.current = active;
  midiHandlersRef.current = { activate, deactivate };

  useEffect(() => {
    registerMidiWidgetHandler(widget.id, (_property, _value, rawValue) => {
      // rawValue undefined (Program Change) = press ; 0 = release.
      const press = rawValue !== 0;
      const { activate: on, deactivate: off } = midiHandlersRef.current;
      if (isFlash) {
        if (press) on(); else off();
        return;
      }
      // Bouton toggle : le note-on bascule, la release est ignorée.
      if (press) { if (activeRef.current) off(); else on(); }
    });
    return () => unregisterMidiWidgetHandler(widget.id);
  }, [widget.id, isFlash]);

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
           config.actionType === 'grandMaster' ? `GM ${config.grandMasterValue ?? 0}` :
           config.actionType === 'dmxChannel' ? `CH ${config.dmxAddress || '–'} → ${config.dmxValue ?? 255}` :
           config.actionType === 'chaser' ? getChaserLabel() :
           config.actionType === 'autoLoop' ? (config.autoLoopRecipe?.name || '🎛 Scène pré-programmée') :
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
          onEnded={() => {
            setSongPlayer(null);
            setActive(false);
            if (unregisterAudioRef.current) { unregisterAudioRef.current(); unregisterAudioRef.current = null; }
          }}
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
  // Valeur partagée avec le store : survit au changement de page et sert de
  // miroir pour un contrôleur MIDI (Akai) dont le fader pilote ce widget.
  const value = usePerformStore((s) => s.vcWidgetValues[widget.id] ?? 128);
  const vcSetWidgetValue = usePerformStore((s) => s.vcSetWidgetValue);
  const { config } = widget;
  const min = config.min ?? 0;
  const max = config.max ?? 255;
  const step = config.step ?? 1;
  const ratio = (value - min) / (max - min);

  const handleChange = (newVal: number) => {
    const clamped = Math.max(min, Math.min(max, Math.round(newVal / step) * step));
    vcSetWidgetValue(widget.id, clamped);
    applyWidgetSliderEffect(config, clamped, 'vc');
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
        {config.sliderFunction === 'grandMaster'
          ? 'GM'
          : `${(config.sliderUniverse ?? 0) > 0 ? `U${(config.sliderUniverse ?? 0) + 1} ` : ''}CH${config.channelAddress || '?'}`}
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

  // Color palettes per section type (autoloop-style)
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

/** Per-channel metadata resolved from fixture definitions. */
interface ChannelMeta {
  fixtureId: string;
  fixtureName: string;
  channelName: string;
  channelType: string; // "Intensity", "Red", "Pan", …
  fixtureIndex: number; // ordering index within the universe (startAddress)
}

/** A contiguous group of channels belonging to one fixture. */
interface FixtureGroup {
  fixtureId: string;
  fixtureName: string;
  channels: { dmxChannel: number; meta: ChannelMeta }[];
  color: string; // deterministic hue from fixture name
}

const FIXTURE_COLORS = [
  '#a855f7', '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
  '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1',
  '#14b8a6', '#e879f9', '#22d3ee', '#facc15', '#fb923c',
];

function fixtureColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return FIXTURE_COLORS[Math.abs(hash) % FIXTURE_COLORS.length];
}

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
  const patchedFixtures = useShowStore((s) => s.patchedFixtures);

  // Keep the selected universe in sync with the real (showStore) universe list
  useEffect(() => {
    if (universes.length === 0) return;
    if (!universes.some((u) => u.id === universeId)) {
      sdSetUniverseId(universes[0].id);
    }
  }, [universes, universeId, sdSetUniverseId]);

  // ── Build channel→metadata map from fixture definitions ──
  const [channelMap, setChannelMap] = useState<Map<number, ChannelMeta>>(new Map());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const map = new Map<number, ChannelMeta>();
      const fixturesInUniverse = patchedFixtures
        .filter((pf) => pf.universeId === universeId)
        .sort((a, b) => a.startAddress - b.startAddress);

      for (let fi = 0; fi < fixturesInUniverse.length; fi++) {
        const pf = fixturesInUniverse[fi];
        try {
          const def = await (window as any).lightMaestro?.fixtures?.getDefinition?.(pf.fixtureDefId);
          if (cancelled) return;
          const mode = def?.modes?.[pf.modeIndex];
          if (!mode?.channels) continue;
          for (let ci = 0; ci < mode.channels.length; ci++) {
            const ch = mode.channels[ci];
            const offset = ch.offset ?? ci;
            const dmxChannel = pf.startAddress + offset;
            if (dmxChannel >= 1 && dmxChannel <= TOTAL_CHANNELS) {
              map.set(dmxChannel, {
                fixtureId: pf.id,
                fixtureName: pf.name || `${pf.manufacturer} ${pf.model}`,
                channelName: ch.name || `Ch ${ci + 1}`,
                channelType: ch.type || 'Nothing',
                fixtureIndex: fi,
              });
            }
          }
        } catch { /* skip unresolvable defs */ }
      }
      if (!cancelled) setChannelMap(map);
    }
    load();
    return () => { cancelled = true; };
  }, [
    patchedFixtures.map((pf) => `${pf.id}:${pf.fixtureDefId}:${pf.modeIndex}:${pf.startAddress}:${pf.universeId}`).join('|'),
    universeId,
  ]);

  // ── Group channels by fixture ──
  const fixtureGroups = useMemo<FixtureGroup[]>(() => {
    const groups: FixtureGroup[] = [];
    const seen = new Map<string, FixtureGroup>();
    for (let ch = 1; ch <= TOTAL_CHANNELS; ch++) {
      const meta = channelMap.get(ch);
      if (!meta) continue;
      let grp = seen.get(meta.fixtureId);
      if (!grp) {
        grp = {
          fixtureId: meta.fixtureId,
          fixtureName: meta.fixtureName,
          channels: [],
          color: fixtureColor(meta.fixtureName),
        };
        seen.set(meta.fixtureId, grp);
        groups.push(grp);
      }
      grp.channels.push({ dmxChannel: ch, meta });
    }
    return groups;
  }, [channelMap]);

  // Set of all patched channel numbers (for quick lookup)
  const patchedChannels = useMemo(() => new Set(channelMap.keys()), [channelMap]);

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
        if (gridRef.current) {
          // Scroll to the channel — find the element with data-channel
          const el = gridRef.current.querySelector(`[data-channel="${ch}"]`);
          if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
      }
      setJumpInput('');
    }
  };

  // ── Fader cell (extracted for reuse) ──
  const renderFader = (channel: number, meta?: ChannelMeta) => {
    const val = channelValues[channel] ?? 0;
    const isSelected = selectedChannel === channel;
    const isInRange = shiftRange && channel >= shiftRange.from && channel <= shiftRange.to;
    const isActive = val > 0;
    const hidden = highlightActive && !isActive;

    if (hidden) return <div key={channel} data-channel={channel} className="w-12 h-[120px]" />;

    const labelTop = meta ? meta.channelName : '';
    const labelBottom = meta ? `CH ${channel}` : `${channel}`;
    const accentColor = meta ? fixtureColor(meta.fixtureName) : '#a855f7';

    return (
      <div
        key={channel}
        data-channel={channel}
        className={`flex flex-col items-center gap-0.5 pt-1 cursor-pointer rounded transition-all ${
          isSelected ? 'bg-purple-600/10 ring-1 ring-purple-500/30' :
          isInRange ? 'bg-purple-600/5' : ''
        }`}
        onClick={(e) => handleSliderClick(channel, e)}
      >
        {/* Channel name (top) */}
        <span className={`text-[8px] leading-tight text-center w-full truncate px-0.5 ${
          isSelected ? 'text-purple-300' : 'text-gray-500'
        }`} title={meta ? `${meta.fixtureName} — ${meta.channelName}` : `CH ${channel}`}>
          {labelTop}
        </span>

        {/* Value badge */}
        <span className={`text-[9px] font-mono ${
          isSelected ? 'text-purple-400' : isActive ? 'text-purple-500/70' : 'text-gray-600'
        }`}>
          {val > 0 ? val : ''}
        </span>

        {/* Slider track */}
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
              backgroundColor: isSelected ? '#c084fc' : isActive ? accentColor : '#374151',
              opacity: val > 0 ? 0.7 : 0.3,
            }}
          />
          <div className="absolute inset-0 opacity-0 group-hover/slider:opacity-100 transition-opacity rounded-full"
            style={{ boxShadow: `inset 0 0 6px ${accentColor}44` }}
          />
        </div>

        {/* Channel number (bottom) */}
        <span className={`text-[9px] font-mono shrink-0 ${
          isSelected ? 'text-purple-400 font-bold' : 'text-gray-600'
        }`}>
          {labelBottom}
        </span>
      </div>
    );
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
        {/* Fader Grid — grouped by fixture */}
        <div ref={gridRef} className="flex-1 overflow-auto p-3">
          <div className="space-y-4 max-w-[900px] mx-auto">
            {/* ── Patched fixtures ── */}
            {fixtureGroups.map((grp) => (
              <div key={grp.fixtureId} className="space-y-1">
                {/* Fixture header */}
                <div className="flex items-center gap-2 px-1 py-1 rounded" style={{ borderLeft: `3px solid ${grp.color}` }}>
                  <span className="text-[11px] font-semibold truncate" style={{ color: grp.color }}>
                    {grp.fixtureName}
                  </span>
                  <span className="text-[9px] text-gray-600 font-mono">
                    CH {grp.channels[0]?.dmxChannel}–{grp.channels[grp.channels.length - 1]?.dmxChannel}
                  </span>
                  <span className="text-[9px] text-gray-700">·</span>
                  <span className="text-[9px] text-gray-600">{grp.channels.length} ch</span>
                </div>
                {/* Faders for this fixture */}
                <div className="flex flex-wrap gap-1">
                  {grp.channels.map(({ dmxChannel, meta }) => renderFader(dmxChannel, meta))}
                </div>
              </div>
            ))}

            {/* ── Unpatched channels (free universe space) ── */}
            {(() => {
              const unpatched: number[] = [];
              for (let ch = 1; ch <= TOTAL_CHANNELS; ch++) {
                if (!patchedChannels.has(ch)) unpatched.push(ch);
              }
              if (unpatched.length === 0) return null;
              // Group consecutive unpatched channels into rows of 16
              const rows: number[][] = [];
              for (let i = 0; i < unpatched.length; i += CHANNELS_PER_ROW) {
                rows.push(unpatched.slice(i, i + CHANNELS_PER_ROW));
              }
              return (
                <div className="space-y-1 pt-2 border-t border-gray-800/30">
                  <div className="flex items-center gap-2 px-1 py-1">
                    <span className="text-[10px] text-gray-600 uppercase tracking-wider">Libres</span>
                    <span className="text-[9px] text-gray-700">{unpatched.length} canaux</span>
                  </div>
                  {rows.map((row, ri) => (
                    <div key={ri} className="flex gap-1">
                      {row.map((ch) => renderFader(ch))}
                    </div>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Detail Panel */}
        <div className="w-44 xl:w-52 bg-[#0d0d14] border-l border-gray-800/50 p-4 flex flex-col shrink-0">
          {selectedChannel ? (
            <>
              <div className="text-center mb-4">
                <div className="text-[10px] text-gray-500 uppercase tracking-wider">{t('perform.simpleDesk.channelDetail')}</div>
                <div className="text-3xl font-bold text-purple-300 font-mono mt-1">{selectedChannel}</div>
                {(() => {
                  const meta = channelMap.get(selectedChannel);
                  if (meta) {
                    return (
                      <div className="mt-1 space-y-0.5">
                        <div className="text-[11px] font-medium truncate" style={{ color: fixtureColor(meta.fixtureName) }}>
                          {meta.fixtureName}
                        </div>
                        <div className="text-[10px] text-gray-400">{meta.channelName}</div>
                        <div className="text-[9px] text-gray-600 font-mono">{meta.channelType}</div>
                      </div>
                    );
                  }
                  return <div className="text-[10px] text-gray-600 mt-1">Non patché</div>;
                })()}
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
                {fixtureGroups.length > 0 && (
                  <p className="text-[10px] text-gray-700 mt-3">{fixtureGroups.length} fixture{fixtureGroups.length > 1 ? 's' : ''} patché{fixtureGroups.length > 1 ? 's' : ''}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status bar */}
      <div className="h-6 px-3 border-t border-gray-800/50 flex items-center text-[10px] text-gray-600 bg-[#0d0d14] shrink-0">
        <span>{t('perform.simpleDesk.status.universe')}: {universeId}</span>
        <span className="mx-2">·</span>
        <span>{patchedChannels.size}/{TOTAL_CHANNELS} patchés</span>
        {fixtureGroups.length > 0 && (
          <>
            <span className="mx-2">·</span>
            <span>{fixtureGroups.length} fixture{fixtureGroups.length > 1 ? 's' : ''}</span>
          </>
        )}
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
  /** press = on/off pour un pad ; value = curseur 0-255 pour un fader. */
  const [targetWidgetProperty, setTargetWidgetProperty] = useState<'press' | 'value'>('press');

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
      case 'widget': return targetWidgetId ? { type: 'widget', widgetId: targetWidgetId, property: targetWidgetProperty } : null;
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
                onChange={(e) => {
                  const id = e.target.value;
                  setTargetWidgetId(id);
                  // Le type du widget décide de la sémantique par défaut :
                  // fader → valeur 0-255, pad → pression on/off.
                  const w = widgets.find((x) => x.id === id);
                  setTargetWidgetProperty(w?.type === 'slider' ? 'value' : 'press');
                }}
                className="bg-[#0a0a0f] border border-gray-800/60 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-purple-500/50 min-w-[160px]"
              >
                <option value="">{t('perform.midi.learn.selectPlaceholder')}</option>
                {widgets.filter((w) => w.type !== 'frame').length === 0 && <option value="" disabled>{t('perform.midi.learn.noWidgets')}</option>}
                {widgets.filter((w) => w.type !== 'frame').map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.config && w.config.label ? `${w.config.label} (${w.type})` : w.type}
                  </option>
                ))}
              </select>
            </div>
          )}

          {targetKind === 'widget' && targetWidgetId && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-600">{t('perform.midi.learn.property')}</span>
              <select
                value={targetWidgetProperty}
                onChange={(e) => setTargetWidgetProperty(e.target.value as 'press' | 'value')}
                className="bg-[#0a0a0f] border border-gray-800/60 rounded-lg px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-purple-500/50 min-w-[160px]"
              >
                <option value="press">{t('perform.midi.learn.propertyPress')}</option>
                <option value="value">{t('perform.midi.learn.propertyValue')}</option>
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
      <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl overflow-x-auto">
        <div className="px-4 py-2.5 border-b border-gray-800/50 flex items-center justify-between min-w-[560px]">
          <span className="text-xs font-medium text-gray-300">{t('perform.midi.mappings')}</span>
          <span className="text-[10px] text-gray-600">{mappings.length}</span>
        </div>
        <div className="grid grid-cols-12 gap-2 px-4 py-2 min-w-[560px] border-b border-gray-800/50 text-[10px] font-medium text-gray-500 uppercase tracking-wider">
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
              <div key={m.id} className="grid grid-cols-12 gap-2 px-4 py-2 min-w-[560px] text-xs hover:bg-gray-800/20 border-b border-gray-800/20 last:border-0 items-center">
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

  // Persiste la préférence de démarrage auto : le main la lit au lancement
  // (`remote-prefs.json` dans userData) pour démarrer (ou non) le serveur LAN
  // sans intervention. Stop = ne plus démarrer tout seul, Start = démarrer auto.
  const persistAutoStart = (autoStart: boolean) => {
    try {
      void (window as any)?.lightMaestro?.storage?.set?.('remote-prefs', { autoStart });
    } catch { /* best effort : la préférence n'empêche jamais le démarrage manuel */ }
  };

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
      else persistAutoStart(true);
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
      persistAutoStart(false);
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
// OSC entrant (lot #16) — panneau de contrôle du serveur UDP
// ═══════════════════════════════════════════════════════════

/** Statut du serveur OSC (miroir local de electron/osc/server.ts). */
interface OscStatus {
  running: boolean;
  /** Vrai pendant la fenêtre asynchrone entre `bind()` et l'event `listening`/`error`. */
  starting?: boolean;
  port: number;
  startedAt: number | null;
  lastError?: string | null;
  packetsReceived: number;
  lastAddress: string | null;
  lastActivityAt: number | null;
}

interface OscApiContract {
  getStatus: () => Promise<OscStatus>;
  start: (port?: number) => Promise<OscStatus>;
  stop: () => Promise<OscStatus>;
}

/**
 * #16 — Accès typé à `window.lightMaestro.osc`. Le cast local (même pattern
 * que getRemoteApi()) garde ce panneau indépendant du typage partagé.
 */
function getOscApi(): OscApiContract | null {
  const api = (window.lightMaestro as unknown as { osc?: OscApiContract }).osc;
  return api ?? null;
}

/** Clé de persistance du port OSC (mécanisme générique storage:get/set). */
const OSC_CONFIG_KEY = 'osc-config';

/** Formatage relatif court d'un timestamp (alimenté par le polling 3 s). */
function fmtAgo(ts: number | null): string {
  if (!ts) return '—';
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m${sec % 60}s`;
}

const OscPanel: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<OscStatus | null>(null);
  const [portText, setPortText] = useState('9000');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastStatus = useRef<OscStatus | null>(null);

  // Polling : état au montage puis toutes les 3 s (pas de push côté main) +
  // chargement du port persisté (osc-config).
  useEffect(() => {
    const api = getOscApi();
    let cancelled = false;

    // Port persisté : récupéré une fois au montage (meilleur effort).
    try {
      const win = window as unknown as {
        lightMaestro?: { storage?: { get: (key: string) => Promise<{ port?: number } | null> } };
      };
      const storage = win.lightMaestro?.storage;
      if (storage && typeof storage.get === 'function') {
        void storage.get(OSC_CONFIG_KEY).then((cfg) => {
          if (!cancelled && cfg && typeof cfg.port === 'number' && cfg.port > 0) {
            setPortText(String(cfg.port));
          }
        }).catch(() => { /* meilleur effort */ });
      }
    } catch { /* meilleur effort */ }

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
        setError(st.lastError ?? null);
      } catch {
        if (!cancelled && lastStatus.current === null) {
          setError(t('perform.osc.errors.status'));
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
    };
  }, [t]);

  /** Persiste le port (osc-config) en meilleur effort. */
  const savePort = (port: number) => {
    try {
      const win = window as unknown as {
        lightMaestro?: { storage?: { set: (key: string, data: unknown) => Promise<boolean> } };
      };
      const storage = win.lightMaestro?.storage;
      if (storage && typeof storage.set === 'function') {
        void storage.set(OSC_CONFIG_KEY, { port }).catch(() => { /* meilleur effort */ });
      }
    } catch { /* meilleur effort */ }
  };

  const parsePort = (): number | null => {
    const n = Number(portText.trim());
    return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
  };

  const handleStart = async () => {
    const api = getOscApi();
    if (!api || busy) return;
    const port = parsePort();
    if (port === null) {
      setError(t('perform.osc.errors.port'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const st = await api.start(port);
      savePort(port);
      lastStatus.current = st;
      setStatus(st);
      if (st.lastError) setError(st.lastError);
    } catch {
      setError(t('perform.osc.errors.start'));
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    const api = getOscApi();
    if (!api || busy) return;
    setBusy(true);
    setError(null);
    try {
      const st = await api.stop();
      lastStatus.current = st;
      setStatus(st);
    } catch {
      setError(t('perform.osc.errors.stop'));
    } finally {
      setBusy(false);
    }
  };

  const apiAvailable = getOscApi() !== null;
  const running = !!status?.running;
  const starting = !!status?.starting;
  const badge = loading
    ? t('perform.osc.loading')
    : starting
      ? t('perform.osc.statusStarting')
      : running
        ? t('perform.osc.statusActive')
        : t('perform.osc.statusStopped');
  // Voyant d'activité : vert si un paquet OSC a été reçu dans les 3 dernières
  // secondes (preuve qu'un contrôleur parle bien au serveur).
  const live = !!status && status.lastActivityAt !== null && Date.now() - status.lastActivityAt < 3000;

  return (
    <div className="h-full p-8 overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Radio size={20} className="text-purple-400" /> {t('perform.osc.title')}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">{t('perform.osc.subtitle')}</p>
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
          <span className="text-xs font-medium text-gray-300">{t('perform.osc.server')}</span>
          <span className="text-[10px] font-mono text-gray-600">
            {running && status && status.port > 0 ? `:${status.port}` : t('perform.osc.offline')}
          </span>
        </div>

        {loading ? (
          <div className="px-4 py-6 text-xs text-gray-600 flex items-center gap-2">
            <Loader size={14} className="animate-spin text-gray-500" /> {t('perform.osc.loading')}
          </div>
        ) : !apiAvailable ? (
          <div className="px-4 py-6 text-xs text-gray-600">{t('perform.osc.unavailable')}</div>
        ) : (
          <div className="p-4 space-y-4">
            <div className="flex items-end gap-3">
              <div className="flex-1 max-w-[200px]">
                <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider mb-1.5">{t('perform.osc.port')}</div>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  value={portText}
                  disabled={running || busy}
                  onChange={(e) => setPortText(e.target.value)}
                  onBlur={() => {
                    const p = parsePort();
                    if (p !== null) savePort(p);
                  }}
                  className="w-full bg-[#0a0a0f] border border-gray-800/60 rounded-lg px-3 py-2 text-xs font-mono text-white disabled:opacity-50"
                />
                <p className="text-[10px] text-gray-600 mt-1">{t('perform.osc.portHint')}</p>
              </div>
            </div>

            {running && status && (
              <div className="grid grid-cols-3 gap-3 pt-2 border-t border-gray-800/50">
                <div className={`rounded-lg px-3 py-2 border ${live ? 'border-green-500/30 bg-green-500/5' : 'border-gray-800/60 bg-[#0a0a0f]'}`}>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-green-400 animate-pulse' : 'bg-gray-700'}`} />
                    <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">{t('perform.osc.activity')}</span>
                  </div>
                  <div className="text-lg font-mono text-white mt-1">{status.packetsReceived}</div>
                </div>
                <div className="rounded-lg px-3 py-2 border border-gray-800/60 bg-[#0a0a0f]">
                  <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">{t('perform.osc.lastAddress')}</span>
                  <div className="text-xs font-mono text-purple-300 mt-1 truncate" title={status.lastAddress ?? undefined}>
                    {status.lastAddress ?? t('perform.osc.never')}
                  </div>
                </div>
                <div className="rounded-lg px-3 py-2 border border-gray-800/60 bg-[#0a0a0f]">
                  <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">{t('perform.osc.lastActivity')}</span>
                  <div className="text-xs font-mono text-gray-300 mt-1">{fmtAgo(status.lastActivityAt)}</div>
                </div>
              </div>
            )}

            {!running && <p className="text-xs text-gray-600">{t('perform.osc.stoppedHint')}</p>}
          </div>
        )}

        <div className="px-4 py-3 border-t border-gray-800/50 flex items-center justify-end">
          <button
            onClick={running ? handleStop : handleStart}
            disabled={busy || loading}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50 flex items-center gap-2 ${running ? 'border border-red-500/30 text-red-400 hover:bg-red-500/10' : 'bg-purple-600/20 text-purple-300 hover:bg-purple-600/30'}`}
          >
            {busy && <Loader size={13} className="animate-spin" />}
            {busy ? t('perform.osc.working') : running ? t('perform.osc.stop') : t('perform.osc.start')}
          </button>
        </div>
      </div>

      {/* Documentation du mapping d'adresses (statique — les routes OSC sont du code) */}
      <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-800/50">
          <span className="text-xs font-medium text-gray-300">{t('perform.osc.mapping')}</span>
        </div>
        <div className="p-4 space-y-1.5 font-mono text-[11px]">
          <div className="flex justify-between gap-4"><span className="text-purple-300">/scene/&lt;id&gt;/play · stop · toggle</span><span className="text-gray-600">{t('perform.osc.mappingScene')}</span></div>
          <div className="flex justify-between gap-4"><span className="text-purple-300">/scene/index/&lt;n&gt;/play · stop · toggle</span><span className="text-gray-600">{t('perform.osc.mappingSceneIndex')}</span></div>
          <div className="flex justify-between gap-4"><span className="text-purple-300">/chaser/&lt;id&gt;/play · stop · next · previous</span><span className="text-gray-600">{t('perform.osc.mappingChaser')}</span></div>
          <div className="flex justify-between gap-4"><span className="text-purple-300">/chaser/index/&lt;n&gt;/play · stop · next · previous</span><span className="text-gray-600">{t('perform.osc.mappingChaserIndex')}</span></div>
          <div className="flex justify-between gap-4"><span className="text-purple-300">/blackout</span><span className="text-gray-600">{t('perform.osc.mappingBlackout')}</span></div>
          <div className="flex justify-between gap-4"><span className="text-purple-300">/grandmaster</span><span className="text-gray-600">{t('perform.osc.mappingGrandmaster')}</span></div>
          <div className="flex justify-between gap-4"><span className="text-purple-300">/grandmaster/&lt;v&gt;</span><span className="text-gray-600">{t('perform.osc.mappingGrandmasterAddr')}</span></div>
          <p className="pt-2 text-[10px] text-gray-600 font-sans">{t('perform.osc.mappingHint')}</p>
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
                      className={`flex-1 min-w-0 text-sm truncate ${
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

// ═══════════════════════════════════════════════════════════
// MTC PANEL (lot #15) — MIDI Time Code entrant + cues sur timecode
// ═══════════════════════════════════════════════════════════
// L'état MTC est poussé par useMtcTriggers() (src/hooks/mtc-trigger.ts)
// dans performStore.mtcState (~30 msg/s max, décodé en main). Les marqueurs
// vivent dans showStore.mtcMarkers (persistés dans le .lmproj) et sont
// déclenchés par le même hook (edge-trigger, sources 'mtc' LTP 72).

const MTC_RATES = ['24', '25', '30drop', '30'] as const;
type MtcRateLabel = (typeof MTC_RATES)[number];

function fmtTc(h: number, m: number, s: number, f: number): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`;
}

/** Parse « HH:MM:SS:FF » → ms (rate donné). `dropFrame` = position illégale
 *  en 29.97 DF (frames 0-1 d'une minute non ÷10) — à signaler à l'utilisateur. */
function parseTcInput(text: string, rate: MtcRateLabel): { ms: number | null; dropFrame: boolean } {
  const parts = text.trim().split(':');
  if (parts.length !== 4) return { ms: null, dropFrame: false };
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  const s = Number(parts[2]);
  const f = Number(parts[3]);
  if (![h, m, s, f].every((n) => Number.isFinite(n))) return { ms: null, dropFrame: false };
  if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59 || f < 0 || f > 29) return { ms: null, dropFrame: false };
  if (!isValidTimecode(h, m, s, f, rate)) return { ms: null, dropFrame: true };
  return { ms: timecodeToMs(h, m, s, f, rate), dropFrame: false };
}

const MTCPanel: React.FC = () => {
  const { t } = useTranslation();
  const mtcState = usePerformStore((s) => s.mtcState);
  const markers = useShowStore((s) => s.mtcMarkers);
  const scenes = useShowStore((s) => s.scenes);
  const chasers = useShowStore((s) => s.chasers);
  const addMtcMarker = useShowStore((s) => s.addMtcMarker);
  const updateMtcMarker = useShowStore((s) => s.updateMtcMarker);
  const deleteMtcMarker = useShowStore((s) => s.deleteMtcMarker);

  const [posText, setPosText] = useState('');
  const [name, setName] = useState('');
  const [targetType, setTargetType] = useState<'scene' | 'chaser'>('scene');
  const [targetId, setTargetId] = useState('');
  const [action, setAction] = useState<'play' | 'stop' | 'toggle'>('play');
  const [formRate, setFormRate] = useState<MtcRateLabel>('30');
  const [formError, setFormError] = useState<string | null>(null);

  const sorted = [...markers].sort((a, b) => a.positionMs - b.positionMs);
  const targets = targetType === 'scene' ? scenes : chasers;

  const captureCurrent = () => {
    if (!mtcState.locked) return;
    setPosText(fmtTc(mtcState.hours, mtcState.minutes, mtcState.seconds, mtcState.frames));
    setFormRate(mtcState.rate);
    setFormError(null);
  };

  const handleAdd = () => {
    const parsed = parseTcInput(posText, formRate);
    if (parsed.ms === null) {
      setFormError(
        parsed.dropFrame ? t('perform.mtc.errors.dropFrame') : t('perform.mtc.errors.position')
      );
      return;
    }
    const positionMs = parsed.ms;
    const target =
      targetType === 'scene'
        ? { type: 'scene' as const, sceneId: targetId }
        : { type: 'chaser' as const, chaserId: targetId };
    if ((targetType === 'scene' && !targetId) || (targetType === 'chaser' && !targetId)) {
      setFormError(t('perform.mtc.errors.target'));
      return;
    }
    addMtcMarker({
      name: name.trim() || `MTC ${sorted.length + 1}`,
      positionMs,
      rate: formRate,
      target,
      action,
      enabled: true,
    });
    setPosText('');
    setName('');
    setFormError(null);
  };

  const rateBadge = (rate: MtcRateLabel): string => {
    if (rate === '30drop') return '29.97 DF';
    return `${rate} fps`;
  };

  return (
    <div className="h-full p-8 overflow-y-auto">
      <h2 className="text-xl font-bold text-white flex items-center gap-2 mb-1">
        <TimerIcon size={20} className="text-purple-400" /> {t('perform.mtc.title')}
      </h2>
      <p className="text-xs text-gray-500 mb-6">{t('perform.mtc.subtitle')}</p>

      {/* État MTC */}
      <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl p-4 mb-6 max-w-lg">
        <div className="flex items-center gap-3">
          <span
            className={`w-2.5 h-2.5 rounded-full shrink-0 ${
              mtcState.locked ? 'bg-green-500 shadow-[0_0_8px_#22c55e]' : 'bg-red-500'
            }`}
          />
          <span className="font-mono text-2xl text-white tracking-wider">
            {fmtTc(mtcState.hours, mtcState.minutes, mtcState.seconds, mtcState.frames)}
          </span>
          <span className="text-[10px] text-gray-500 border border-gray-800 rounded px-1.5 py-0.5">
            {rateBadge(mtcState.rate)}
          </span>
        </div>
        <div className="mt-2 text-xs">
          {mtcState.locked ? (
            <span className="text-green-500">{t('perform.mtc.locked')}</span>
          ) : (
            <span className="text-red-500">{t('perform.mtc.unlocked')}</span>
          )}
        </div>
      </div>

      {/* Ajout d'un marqueur */}
      <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl p-4 mb-6 max-w-2xl">
        <div className="text-sm font-medium text-gray-300 mb-3">{t('perform.mtc.addMarker')}</div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-[10px] text-gray-600 mb-1">{t('perform.mtc.columns.position')}</label>
            <div className="flex gap-1">
              <input
                value={posText}
                onChange={(e) => setPosText(e.target.value)}
                placeholder="HH:MM:SS:FF"
                className="bg-[#15151f] border border-gray-800 rounded px-2 py-1.5 text-xs font-mono text-white w-32 focus:border-purple-500 outline-none"
              />
              <button
                onClick={captureCurrent}
                disabled={!mtcState.locked}
                title={t('perform.mtc.captureHint')}
                className="text-xs text-purple-400 hover:text-purple-300 disabled:text-gray-700 px-1"
              >
                {t('perform.mtc.capture')}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-gray-600 mb-1">{t('perform.mtc.columns.rate')}</label>
            <select
              value={formRate}
              onChange={(e) => setFormRate(e.target.value as MtcRateLabel)}
              className="bg-[#15151f] border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-300 focus:border-purple-500 outline-none"
            >
              {MTC_RATES.map((r) => (
                <option key={r} value={r}>{rateBadge(r)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-gray-600 mb-1">{t('perform.mtc.columns.name')}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('perform.mtc.namePlaceholder')}
              className="bg-[#15151f] border border-gray-800 rounded px-2 py-1.5 text-xs text-white w-36 focus:border-purple-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-[10px] text-gray-600 mb-1">{t('perform.mtc.columns.target')}</label>
            <div className="flex gap-1">
              <select
                value={targetType}
                onChange={(e) => { setTargetType(e.target.value as 'scene' | 'chaser'); setTargetId(''); }}
                className="bg-[#15151f] border border-gray-800 rounded px-1 py-1.5 text-xs text-gray-300 focus:border-purple-500 outline-none"
              >
                <option value="scene">{t('perform.mtc.targets.scene')}</option>
                <option value="chaser">{t('perform.mtc.targets.chaser')}</option>
              </select>
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="bg-[#15151f] border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-300 w-36 focus:border-purple-500 outline-none"
              >
                <option value="">—</option>
                {targets.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] text-gray-600 mb-1">{t('perform.mtc.columns.action')}</label>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as 'play' | 'stop' | 'toggle')}
              className="bg-[#15151f] border border-gray-800 rounded px-2 py-1.5 text-xs text-gray-300 focus:border-purple-500 outline-none"
            >
              <option value="play">{t('perform.mtc.actions.play')}</option>
              <option value="stop">{t('perform.mtc.actions.stop')}</option>
              <option value="toggle">{t('perform.mtc.actions.toggle')}</option>
            </select>
          </div>
          <button
            onClick={handleAdd}
            className="bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium rounded px-3 py-2"
          >
            <Plus size={12} className="inline mr-1" />
            {t('perform.mtc.add')}
          </button>
        </div>
        {formError && <div className="mt-2 text-[11px] text-red-500">{formError}</div>}
      </div>

      {/* Liste des marqueurs */}
      <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl overflow-hidden max-w-2xl">
        <div className="px-4 py-2 border-b border-gray-800/50 flex items-center justify-between">
          <span className="text-xs font-medium text-gray-400">
            {t('perform.mtc.markers')} — {sorted.length}
          </span>
        </div>
        {sorted.length === 0 ? (
          <div className="p-8 text-center text-xs text-gray-600">{t('perform.mtc.noMarkers')}</div>
        ) : (
          sorted.map((mk) => {
            const tc = msToTimecode(mk.positionMs, mk.rate);
            const tgt = mk.target;
            const targetName =
              tgt.type === 'scene'
                ? scenes.find((s) => s.id === tgt.sceneId)?.name || tgt.sceneId
                : chasers.find((c) => c.id === tgt.chaserId)?.name || tgt.chaserId;
            return (
              <div key={mk.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-800/20 last:border-0">
                <span className="font-mono text-xs text-gray-300 w-24 shrink-0">{fmtTc(tc.hours, tc.minutes, tc.seconds, tc.frames)}</span>
                <span className="text-[9px] text-gray-600 w-14 shrink-0">{rateBadge(mk.rate)}</span>
                <span className="flex-1 text-xs text-gray-400 truncate">{mk.name}</span>
                <span className="text-[10px] text-gray-500 min-w-0 truncate max-w-[40%]">
                  {tgt.type === 'scene' ? t('perform.mtc.targets.scene') : t('perform.mtc.targets.chaser')}: {targetName}
                </span>
                <span className="text-[10px] text-gray-600 w-10 shrink-0">
                  {t(`perform.mtc.actions.${mk.action}`)}
                </span>
                <label className="relative w-7 h-4 cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={mk.enabled}
                    onChange={(e) => updateMtcMarker(mk.id, { enabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-full h-full bg-gray-700 rounded-full peer-checked:bg-purple-600 transition-colors" />
                  <div className="absolute w-2.5 h-2.5 bg-white rounded-full top-0.5 left-0.5 peer-checked:left-4 transition-all" />
                </label>
                <button
                  onClick={() => deleteMtcMarker(mk.id)}
                  className="text-gray-600 hover:text-red-400 shrink-0"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
