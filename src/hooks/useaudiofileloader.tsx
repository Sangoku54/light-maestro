import React, { useRef, useState, useCallback, useEffect } from 'react';
import { Upload, Play, Pause, SkipBack, SkipForward } from 'lucide-react';
import { analyzeAudioBuffer, TrackAnalysis, TrackSection, SECTION_COLORS } from './audio-analysis';
import type { GenreProfile } from './audio-analysis';

/**
 * Audio File Loader — Upload & analyze MP3/WAV/FLAC for AutoScript
 */

export interface AudioFileState {
  file: File | null;
  audioBuffer: AudioBuffer | null;
  analysis: TrackAnalysis | null;
  isPlaying: boolean;
  currentTime: number;
  isAnalyzing: boolean;
  error: string | null;
}

// ─── Hook ──────────────────────────────────────────────────

export function useAudioFileLoader() {
  const [state, setState] = useState<AudioFileState>({
    file: null, audioBuffer: null, analysis: null,
    isPlaying: false, currentTime: 0, isAnalyzing: false, error: null,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const startTimeRef = useRef<number>(0);
  const startOffsetRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const pausedRef = useRef(false);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContextRef.current;
  }, []);

  const loadFile = useCallback(async (file: File) => {
    setState(s => ({ ...s, file, isAnalyzing: true, error: null, analysis: null }));
    try {
      const ctx = getAudioContext();
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const analysis = analyzeAudioBuffer(audioBuffer, file.name, file.size);
      setState(s => ({ ...s, file, audioBuffer, analysis, isAnalyzing: false, currentTime: 0 }));
    } catch (err: any) {
      setState(s => ({ ...s, error: `Failed: ${err.message}`, isAnalyzing: false }));
    }
  }, [getAudioContext]);

  const loadWithAnalysis = useCallback(async (file: File, analysis: TrackAnalysis) => {
    setState(s => ({ ...s, file, isAnalyzing: true, error: null, analysis: null }));
    try {
      const ctx = getAudioContext();
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      setState(s => ({ ...s, file, audioBuffer, analysis, isAnalyzing: false, currentTime: 0 }));
    } catch (err: any) {
      setState(s => ({ ...s, error: `Failed: ${err.message}`, isAnalyzing: false }));
    }
  }, [getAudioContext]);

  const restoreAnalysis = useCallback((analysis: TrackAnalysis) => {
    setState(s => ({ ...s, file: null, audioBuffer: null, analysis, isAnalyzing: false, currentTime: 0, error: null }));
  }, []);

  const restoreWithAudio = useCallback(async (analysis: TrackAnalysis, dataUrl: string) => {
    setState(s => ({ ...s, isAnalyzing: true, error: null }));
    try {
      // Use fetch to decode the data URL — handles base64 natively, no atob/corruption
      const response = await fetch(dataUrl);
      if (!response.ok) throw new Error('Failed to fetch data URL');
      const buf = await response.arrayBuffer();
      const ctx = getAudioContext();
      const audioBuffer = await ctx.decodeAudioData(buf);
      const syntheticFile = new File([buf], analysis.fileName || 'restored.mp3', { type: 'audio/mpeg' });
      setState(s => ({ ...s, file: syntheticFile, audioBuffer, analysis, isAnalyzing: false, currentTime: 0, error: null }));
    } catch (err: any) {
      console.error('restoreWithAudio failed:', err.message);
      // Fallback: analysis only, no audio
      setState(s => ({ ...s, analysis, isAnalyzing: false, currentTime: 0, error: 'Audio decode failed: ' + err.message }));
    }
  }, [getAudioContext]);

  const play = useCallback(() => {
    pausedRef.current = false;
    const ctx = getAudioContext();
    const buffer = state.audioBuffer;
    if (!buffer) return;
    if (ctx.state === 'suspended') ctx.resume();
    sourceRef.current?.stop();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0, state.currentTime);
    sourceRef.current = source;
    startTimeRef.current = ctx.currentTime;
    startOffsetRef.current = state.currentTime;
    const updateTime = () => {
      const elapsed = ctx.currentTime - startTimeRef.current;
      const pos = startOffsetRef.current + elapsed;
      setState(s => ({ ...s, currentTime: Math.min(pos, buffer.duration) }));
      if (pos < buffer.duration) rafRef.current = requestAnimationFrame(updateTime);
      else setState(s => ({ ...s, isPlaying: false, currentTime: 0 }));
    };
    setState(s => ({ ...s, isPlaying: true }));
    updateTime();
    source.onended = () => {
      if (pausedRef.current) return;
      setState(s => ({ ...s, isPlaying: false, currentTime: 0 }));
    };
  }, [state.audioBuffer, state.currentTime, getAudioContext]);

  const pause = useCallback(() => {
    pausedRef.current = true;
    sourceRef.current?.stop();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setState(s => ({ ...s, isPlaying: false }));
  }, []);

  const stop = useCallback(() => {
    sourceRef.current?.stop();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setState(s => ({ ...s, isPlaying: false, currentTime: 0 }));
  }, []);

  const clear = useCallback(() => {
    sourceRef.current?.stop();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setState(s => ({ ...s, file: null, audioBuffer: null, analysis: null, isPlaying: false, currentTime: 0, error: null }));
  }, []);

  const seek = useCallback((time: number) => {
    const buffer = state.audioBuffer;
    if (!buffer) return;
    const wasPlaying = state.isPlaying;
    sourceRef.current?.stop();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    setState(s => ({ ...s, currentTime: Math.max(0, Math.min(time, buffer.duration)) }));
    if (wasPlaying) {
      const ctx = getAudioContext();
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0, time);
      sourceRef.current = source;
      startTimeRef.current = ctx.currentTime;
      startOffsetRef.current = time;
      const updateTime = () => {
        const elapsed = ctx.currentTime - startTimeRef.current;
        const pos = startOffsetRef.current + elapsed;
        setState(s => ({ ...s, currentTime: Math.min(pos, buffer.duration) }));
        if (pos < buffer.duration) rafRef.current = requestAnimationFrame(updateTime);
        else setState(s => ({ ...s, isPlaying: false, currentTime: 0 }));
      };
      updateTime();
      source.onended = () => { if (pausedRef.current) return; setState(s => ({ ...s, isPlaying: false, currentTime: 0 })); };
    }
  }, [state.audioBuffer, state.isPlaying, getAudioContext]);

  return { ...state, loadFile, loadWithAnalysis, restoreAnalysis, restoreWithAudio, play, pause, stop, seek, clear };
}

// ═══════════════════════════════════════════════════════════
// AudioFileUpload Component
// ═══════════════════════════════════════════════════════════

interface AudioFileUploadProps {
  onFileLoaded?: (analysis: TrackAnalysis) => void;
  compact?: boolean;
  externalState?: ReturnType<typeof useAudioFileLoader>;
  onSelectionChange?: (startTime: number, endTime: number, newType: string) => void;
  onSectionClick?: (idx: number) => void;
  sections?: TrackSection[];
  onInsertEntity?: (startTime: number, endTime: number, entityType: 'scene' | 'chaser' | 'cuelist' | 'efx', entityId: string) => void;
  scenes?: { id: string; name: string }[];
  chasers?: { id: string; name: string }[];
  cueLists?: { id: string; name: string }[];
  effects?: { id: string; name: string }[];
}

export const AudioFileUpload: React.FC<AudioFileUploadProps> = ({ onFileLoaded, compact, externalState, onSelectionChange, onSectionClick, sections: sectionsOverride, onInsertEntity, scenes, chasers, cueLists, effects }) => {
  const internalState = useAudioFileLoader();
  const { file, analysis, isAnalyzing, isPlaying, currentTime, error, loadFile, play, pause, stop, seek, clear } = externalState || internalState;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => { if (analysis && onFileLoaded) onFileLoaded(analysis); }, [analysis, onFileLoaded]);

  // Spacebar play/pause
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && e.target === document.body) {
        e.preventDefault();
        if (!file || !analysis) return;
        if (isPlaying) pause(); else play();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [file, analysis, isPlaying, play, pause]);

  const handleFile = useCallback((f: File) => loadFile(f), [loadFile]);
  const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }, [handleFile]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  };

  if (!file || !analysis) {
    return (
      <div onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${dragOver ? 'border-purple-400 bg-purple-600/10' : 'border-gray-700 hover:border-purple-500/50 bg-[#0d0d14]'} ${compact ? 'p-4' : 'p-8'}`}>
        <input ref={fileInputRef} type="file" accept=".mp3,.wav,.flac,.ogg,.m4a,.aac,.wma"
          onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} className="hidden" />
        {isAnalyzing ? (
          <div className="space-y-3">
            <div className="w-8 h-8 border-2 border-purple-400 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-sm text-gray-400">Analyzing audio...</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="w-12 h-12 rounded-full bg-purple-600/20 flex items-center justify-center mx-auto">
              <Upload size={24} className="text-purple-400" />
            </div>
            <p className="text-sm text-gray-300 font-medium">Drop an audio file here or click to browse</p>
            <p className="text-xs text-gray-600">MP3, WAV, FLAC, OGG, M4A</p>
          </div>
        )}
        {error && <p className="text-xs text-red-400 mt-3">{error}</p>}
      </div>
    );
  }

  const progress = analysis.duration > 0 ? currentTime / analysis.duration : 0;
  const displaySections = sectionsOverride && sectionsOverride.length > 0 ? sectionsOverride : analysis.sections;

  return (
    <div className="space-y-3">
      {/* Waveform */}
      <div className="bg-[#0d0d14] border border-gray-800/50 rounded-xl p-2">
        <WaveformDisplay waveform={analysis.waveform} beats={analysis.beats} sections={displaySections}
          duration={analysis.duration} currentTime={currentTime} onSeek={seek}
          onSelectionChange={onSelectionChange} onSectionClick={onSectionClick}
          onInsertEntity={onInsertEntity} scenes={scenes} chasers={chasers} cueLists={cueLists} effects={effects}
          energyCurve={analysis.energyCurve} lowCurve={analysis.lowCurve} />
      </div>

      {/* Playback bar */}
      <div className="flex items-center gap-2">
        <button onClick={() => seek(0)} className="p-1.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors" title="Début (↖)">
          <SkipBack size={14} />
        </button>
        <button onClick={isPlaying ? pause : play} className="p-2 rounded-full bg-purple-600/20 text-purple-300 hover:bg-purple-600/30 transition-colors">
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button onClick={() => seek(analysis.duration)} className="p-1.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors" title="Fin (↷)">
          <SkipForward size={14} />
        </button>
        <span className="text-[11px] text-gray-400 font-mono w-20 text-right">{formatTime(currentTime)}</span>
        <div className="flex-1 h-1.5 bg-gray-800 rounded-full cursor-pointer"
          onClick={e => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * analysis.duration); }}>
          <div className="h-full bg-purple-500 rounded-full" style={{ width: `${(analysis.duration > 0 ? currentTime / analysis.duration : 0) * 100}%` }} />
        </div>
        <span className="text-[11px] text-gray-500 font-mono w-20">{formatTime(analysis.duration)}</span>
        <span className="text-[10px] text-pink-400 ml-1">{analysis.bpm} BPM</span>
        <button
          onClick={() => { clear(); setTimeout(() => fileInputRef.current?.click(), 50); }}
          className="ml-2 p-1 rounded text-gray-500 hover:text-purple-400 hover:bg-gray-800 transition-colors"
          title="Changer de fichier audio"
        >
          <Upload size={14} />
        </button>
      </div>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════
// WaveformDisplay — canvas with sections, beats, selection
// ═══════════════════════════════════════════════════════════

interface WaveformDisplayProps {
  waveform: number[]; beats: number[]; sections: TrackSection[];
  duration: number; currentTime: number; onSeek: (time: number) => void;
  onSelectionChange?: (startTime: number, endTime: number, newType: string) => void;
  onSectionClick?: (idx: number) => void;
  onInsertEntity?: (startTime: number, endTime: number, entityType: 'scene' | 'chaser' | 'cuelist' | 'efx', entityId: string) => void;
  scenes?: { id: string; name: string }[];
  chasers?: { id: string; name: string }[];
  cueLists?: { id: string; name: string }[];
  effects?: { id: string; name: string }[];
  energyCurve?: number[]; lowCurve?: number[];
}

const TYPE_KEYS: Record<string, string> = { Digit1: 'intro', Digit2: 'verse', Digit3: 'chorus', Digit4: 'bridge', Digit5: 'drop', Digit6: 'outro' };

const WaveformDisplay: React.FC<WaveformDisplayProps> = ({ waveform, beats, sections, duration, currentTime, onSeek, onSelectionChange, onSectionClick, onInsertEntity, scenes, chasers, cueLists, effects, energyCurve, lowCurve }) => {
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement>(null);
  const mainContainerRef = useRef<HTMLDivElement>(null);
  const minimapContainerRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const selStartRef = useRef<number | null>(null);
  const selEndRef = useRef<number | null>(null);
  const hasSelRef = useRef(false);

  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState(duration);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef({ startX: 0, startViewStart: 0 });
  const isDraggingRef = useRef(false);
  const isSelectingRef = useRef(false);

  const viewDuration = viewEnd - viewStart;
  const zoomLevel = duration / viewDuration;
  const ZOOM_STEPS = [1, 2, 4, 8, 16, 32, 64];

  const zoomIn = useCallback(() => {
    const nextZoom = ZOOM_STEPS.find(z => z > zoomLevel * 1.1) || zoomLevel;
    if (nextZoom === zoomLevel) return;
    const center = (viewStart + viewEnd) / 2;
    const newDur = duration / nextZoom;
    let ns = center - newDur / 2, ne = center + newDur / 2;
    if (ns < 0) { ns = 0; ne = newDur; }
    if (ne > duration) { ne = duration; ns = duration - newDur; }
    setViewStart(ns); setViewEnd(ne);
  }, [viewStart, viewEnd, duration, zoomLevel]);

  const zoomOut = useCallback(() => {
    const nextZoom = [...ZOOM_STEPS].reverse().find(z => z < zoomLevel * 0.9) || 1;
    if (nextZoom >= zoomLevel) return;
    const center = (viewStart + viewEnd) / 2;
    const newDur = duration / nextZoom;
    const ns = Math.max(0, center - newDur / 2);
    const ne = Math.min(duration, center + newDur / 2);
    setViewStart(ns); setViewEnd(ne);
  }, [viewStart, viewEnd, duration, zoomLevel]);

  const zoomToFit = useCallback(() => { setViewStart(0); setViewEnd(duration); }, [duration]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) { if (e.deltaY < 0) zoomIn(); else zoomOut(); }
    else if (zoomLevel > 1.05) {
      const amt = viewDuration * 0.1 * (e.deltaY > 0 ? 1 : -1);
      const ns = Math.max(0, Math.min(duration - viewDuration, viewStart + amt));
      setViewStart(ns); setViewEnd(ns + viewDuration);
    }
  }, [zoomLevel, viewStart, viewDuration, duration, zoomIn, zoomOut]);

  // Selection state
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd, setSelEnd] = useState<number | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selMenu, setSelMenu] = useState<{ x: number; y: number } | null>(null);
  const [entitySubMenu, setEntitySubMenu] = useState<'scene' | 'chaser' | 'cuelist' | 'efx' | null>(null);
  const mouseMovedRef = useRef(false);

  const getTimeFromClientX = useCallback((clientX: number): number => {
    const c = mainContainerRef.current; if (!c) return 0;
    const r = c.getBoundingClientRect();
    return viewStart + ((clientX - r.left) / r.width) * viewDuration;
  }, [viewStart, viewDuration]);

  const resetSelection = useCallback(() => { setSelStart(null); setSelEnd(null); setSelMenu(null); }, []);

  const hasSel = selStart !== null && selEnd !== null && Math.abs(selEnd - selStart) > 0.05;
  const hasSelForRender = selStart !== null && selEnd !== null && Math.abs(selEnd - selStart) > 0.05;

  // Keep refs in sync with selection state for keyboard shortcut access
  useEffect(() => { selStartRef.current = selStart; selEndRef.current = selEnd; hasSelRef.current = hasSel; }, [selStart, selEnd, hasSel]);

  // Keyboard shortcuts: 1=intro 2=verse 3=chorus 4=bridge 5=drop 6=outro
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const type = TYPE_KEYS[e.code];
      if (type && hasSelRef.current && onSelectionChange && selStartRef.current != null && selEndRef.current != null) {
        e.preventDefault();
        onSelectionChange(selStartRef.current, selEndRef.current, type);
        resetSelection();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSelectionChange, resetSelection]);

  // Escape = zoom to fit
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && zoomLevel > 1.01) {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        zoomToFit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [zoomLevel, zoomToFit]);

  // Mouse handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    mouseMovedRef.current = false;
    // When zoomed: Shift+drag = pan, normal drag = select
    if (zoomLevel > 1.05 && e.shiftKey) {
      isDraggingRef.current = true;
      setIsDragging(true);
      dragRef.current = { startX: e.clientX, startViewStart: viewStart };
      return;
    }
    const t = getTimeFromClientX(e.clientX);
    isSelectingRef.current = true;
    setSelStart(t); setSelEnd(t); setIsSelecting(true);
  }, [zoomLevel, viewStart, getTimeFromClientX]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDraggingRef.current) {
      const dx = e.clientX - dragRef.current.startX;
      const timeDelta = (dx / (mainContainerRef.current?.getBoundingClientRect().width || 1)) * viewDuration;
      const ns = Math.max(0, Math.min(duration - viewDuration, dragRef.current.startViewStart - timeDelta));
      setViewStart(ns); setViewEnd(ns + viewDuration); return;
    }
    if (isSelectingRef.current) {
      mouseMovedRef.current = true;
      setSelEnd(getTimeFromClientX(e.clientX));
    }
  }, [viewDuration, duration, getTimeFromClientX]);

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    isSelectingRef.current = false;
    setIsDragging(false); setIsSelecting(false);
  }, []);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    // If selection exists, zoom to selection
    if (hasSel && selStart != null && selEnd != null) {
      const s = Math.min(selStart, selEnd);
      const en = Math.max(selStart, selEnd);
      const pad = (en - s) * 0.15;
      const ns = Math.max(0, s - pad);
      const ne = Math.min(duration, en + pad);
      setViewStart(ns); setViewEnd(ne);
      resetSelection();
      return;
    }
    // If no selection, zoom to clicked section
    const t = getTimeFromClientX(e.clientX);
    const sec = sections.find(s => t >= s.startTime && t < s.endTime);
    if (sec) {
      const pad = (sec.endTime - sec.startTime) * 0.1;
      setViewStart(Math.max(0, sec.startTime - pad));
      setViewEnd(Math.min(duration, sec.endTime + pad));
    }
  }, [hasSel, selStart, selEnd, duration, resetSelection, getTimeFromClientX, sections]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (mouseMovedRef.current) { mouseMovedRef.current = false; return; }
    if (isDraggingRef.current || isSelectingRef.current) return;
    const t = getTimeFromClientX(e.clientX);
    const secIdx = sections.findIndex(s => t >= s.startTime && t < s.endTime);
    if (secIdx >= 0 && onSectionClick && !hasSel) { onSectionClick(secIdx); return; }
    resetSelection(); onSeek(t);
  }, [getTimeFromClientX, sections, onSectionClick, hasSel, onSeek, resetSelection]);

  // Dismiss context menu on outside click
  useEffect(() => {
    if (!selMenu) { setEntitySubMenu(null); return; }
    const dismiss = (e: MouseEvent) => {
      // Don't dismiss if clicking inside the menu itself
      const menuEl = document.querySelector('.waveform-context-menu');
      if (menuEl && menuEl.contains(e.target as Node)) return;
      resetSelection();
      setEntitySubMenu(null);
    };
    // Use mousedown to catch clicks before they reach other handlers
    document.addEventListener('mousedown', dismiss, true);
    return () => document.removeEventListener('mousedown', dismiss, true);
  }, [selMenu, resetSelection]);

  // Context menu — capture selection values in ref to prevent stale closures
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!hasSel) {
      const t = getTimeFromClientX(e.clientX);
      const secIdx = sections.findIndex(s => t >= s.startTime && t < s.endTime);
      if (secIdx >= 0 && onSectionClick) { onSectionClick(secIdx); return; }
      return;
    }
    // 🔒 Lock selection values in ref before showing menu
    selectionRef.current = { start: selStart!, end: selEnd! };
    setSelMenu({ x: e.clientX, y: e.clientY });
  }, [hasSel, selStart, selEnd, sections, onSectionClick, getTimeFromClientX]);

  const handleMinimapClick = useCallback((e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const center = x * duration;
    const ns = Math.max(0, Math.min(duration - viewDuration, center - viewDuration / 2));
    setViewStart(ns); setViewEnd(ns + viewDuration);
  }, [duration, viewDuration]);

  // ─── Draw main canvas ───────────────────────────────

  useEffect(() => {
    const canvas = mainCanvasRef.current;
    const container = mainContainerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px'; canvas.style.height = rect.height + 'px';
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.scale(dpr, dpr);
    const w = rect.width; const h = rect.height;
    const rulerH = 20; const waveTop = rulerH; const waveH = h - rulerH;
    ctx.clearRect(0, 0, w, h);

    // Section backgrounds
    for (const s of sections) {
      const x1 = ((s.startTime - viewStart) / viewDuration) * w;
      const x2 = ((s.endTime - viewStart) / viewDuration) * w;
      if (x2 < 0 || x1 > w) continue;
      ctx.fillStyle = s.color + '35';
      ctx.fillRect(Math.max(0, x1), waveTop, Math.min(w, x2) - Math.max(0, x1), waveH);
      ctx.fillStyle = s.color + '80';
      ctx.fillRect(Math.max(0, x1), h - 3, Math.min(w, x2) - Math.max(0, x1), 3);
      const sw = Math.min(w, x2) - Math.max(0, x1);
      if (sw > 20) {
        ctx.font = `${sw > 60 ? 11 : 9}px -apple-system, sans-serif`;
        ctx.textAlign = 'center'; ctx.fillStyle = s.color;
        ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 2;
        ctx.fillText(s.type.toUpperCase(), Math.max(0, x1) + sw / 2, waveTop + 14);
        ctx.shadowBlur = 0;
      }
    }

    // Ruler
    const tickInt = viewDuration > 30 ? 5 : viewDuration > 15 ? 2 : viewDuration > 5 ? 1 : 0.5;
    ctx.fillStyle = '#4b5563'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
    for (let t = Math.floor(viewStart / tickInt) * tickInt; t <= viewEnd; t += tickInt) {
      const x = ((t - viewStart) / viewDuration) * w;
      if (x < 0 || x > w) continue;
      ctx.strokeStyle = '#374151'; ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(x, rulerH - 4); ctx.lineTo(x, rulerH); ctx.stroke();
      const m = Math.floor(t / 60);
      ctx.fillText(`${m}:${(t % 60).toFixed(tickInt < 1 ? 1 : 0).padStart(tickInt < 1 ? 4 : 2, '0')}`, x, rulerH - 6);
    }

    // Center line
    const cy = waveTop + waveH / 2;
    ctx.strokeStyle = '#1f1f2e'; ctx.lineWidth = 0.5; ctx.setLineDash([4, 8]);
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke(); ctx.setLineDash([]);

    // Energy curve overlay — full track energy as warm gradient behind waveform
    if (energyCurve && energyCurve.length > 0) {
      const eSamplesPerPx = (energyCurve.length * viewDuration) / (duration * w);
      for (let pass = 0; pass < 2; pass++) {
        ctx.beginPath();
        if (pass === 0) { ctx.strokeStyle = 'rgba(255, 120, 50, 0.18)'; ctx.lineWidth = 1.5; }
        else { ctx.strokeStyle = 'rgba(255, 80, 30, 0.25)'; ctx.lineWidth = 3; }
        for (let px = 0; px < w; px++) {
          const ei = Math.floor(((viewStart + (px / w) * viewDuration) / duration) * energyCurve.length);
          let mxe = 0;
          for (let s = 0; s < Math.max(1, Math.ceil(eSamplesPerPx)); s++) {
            const v = energyCurve[Math.min(ei + s, energyCurve.length - 1)] || 0;
            if (v > mxe) mxe = v;
          }
          const ey = waveTop + waveH * (1 - mxe);
          if (px === 0) ctx.moveTo(px, ey); else ctx.lineTo(px, ey);
        }
        ctx.stroke();
      }
    }

    // Bass ratio overlay — blue line at bottom of wave area
    if (lowCurve && lowCurve.length > 0) {
      const lSamplesPerPx = (lowCurve.length * viewDuration) / (duration * w);
      ctx.beginPath(); ctx.strokeStyle = 'rgba(96, 165, 250, 0.2)'; ctx.lineWidth = 1;
      for (let px = 0; px < w; px++) {
        const li = Math.floor(((viewStart + (px / w) * viewDuration) / duration) * lowCurve.length);
        let mxL = 0;
        for (let s = 0; s < Math.max(1, Math.ceil(lSamplesPerPx)); s++) {
          const v = lowCurve[Math.min(li + s, lowCurve.length - 1)] || 0;
          if (v > mxL) mxL = v;
        }
        const ly = waveTop + waveH * (1 - mxL * 0.7);
        if (px === 0) ctx.moveTo(px, ly); else ctx.lineTo(px, ly);
      }
      ctx.stroke();
    }

    // Waveform
    ctx.beginPath(); ctx.strokeStyle = '#a855f7'; ctx.lineWidth = zoomLevel > 4 ? 1.2 : 0.8;
    const samplesPerPx = (waveform.length * viewDuration) / (duration * w);
    for (let px = 0; px < w; px++) {
      const si = Math.floor(((viewStart + (px / w) * viewDuration) / duration) * waveform.length);
      let mx = 0, mn = 0;
      for (let s = 0; s < Math.max(1, Math.ceil(samplesPerPx)); s++) {
        const v = waveform[Math.min(si + s, waveform.length - 1)] || 0;
        if (v > mx) mx = v; if (v < mn) mn = v;
      }
      ctx.moveTo(px, cy - mx * waveH * 0.45); ctx.lineTo(px, cy - mn * waveH * 0.45);
    }
    ctx.stroke();

    // Beat grid
    beats.forEach((b, i) => {
      if (b < viewStart || b > viewEnd) return;
      const x = ((b - viewStart) / viewDuration) * w;
      const down = i % 4 === 0;
      ctx.strokeStyle = down ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)';
      ctx.lineWidth = down ? 0.8 : 0.4; ctx.setLineDash(down ? [] : [2, 6]);
      ctx.beginPath(); ctx.moveTo(x, waveTop); ctx.lineTo(x, h); ctx.stroke();
    });
    ctx.setLineDash([]);

    // Beat dots
    beats.forEach(b => {
      if (b < viewStart || b > viewEnd) return;
      ctx.fillStyle = '#ec4899'; ctx.beginPath();
      ctx.arc(((b - viewStart) / viewDuration) * w, waveTop + 4, zoomLevel > 4 ? 2.5 : 1.8, 0, Math.PI * 2); ctx.fill();
    });

    // Selection overlay — high-visibility highlight
    if (hasSel) {
      const s1 = ((Math.min(selStart!, selEnd!) - viewStart) / viewDuration) * w;
      const s2 = ((Math.max(selStart!, selEnd!) - viewStart) / viewDuration) * w;
      const selW = s2 - s1;
      // Fill — vibrant semi-transparent purple
      ctx.fillStyle = 'rgba(168, 85, 247, 0.25)';
      ctx.fillRect(s1, waveTop, selW, waveH);
      // Outer glow border
      ctx.strokeStyle = 'rgba(168, 85, 247, 0.9)'; ctx.lineWidth = 2;
      ctx.strokeRect(s1, waveTop, selW, waveH);
      // Inner bright edge
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'; ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.strokeRect(s1 + 1, waveTop + 1, selW - 2, waveH - 2);
      ctx.setLineDash([]);
      // Time label — white text on dark background
      const st = Math.min(selStart!, selEnd!), et = Math.max(selStart!, selEnd!);
      const labelW = ctx.measureText(`${fmt(st)} → ${fmt(et)} (${(et - st).toFixed(1)}s)`).width + 10;
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fillRect(s1, waveTop, labelW, 18);
      ctx.fillStyle = '#ffffff'; ctx.font = 'bold 10px monospace'; ctx.textAlign = 'left';
      ctx.fillText(`${fmt(st)} → ${fmt(et)} (${(et - st).toFixed(1)}s)`, s1 + 5, waveTop + 13);
    }

    // Playhead
    if (currentTime >= viewStart - 0.1 && currentTime <= viewEnd + 0.1) {
      const px = ((currentTime - viewStart) / viewDuration) * w;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
      ctx.fillStyle = '#ffffff'; ctx.beginPath();
      ctx.moveTo(px, rulerH); ctx.lineTo(px - 5, rulerH - 8); ctx.lineTo(px + 5, rulerH - 8); ctx.closePath(); ctx.fill();
    }
  }, [waveform, beats, sections, duration, viewStart, viewEnd, viewDuration, zoomLevel, currentTime, hasSel, selStart, selEnd, energyCurve, lowCurve]);

  // Minimap
  useEffect(() => {
    const canvas = minimapCanvasRef.current; const container = minimapContainerRef.current;
    if (!canvas || !container) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px'; canvas.style.height = rect.height + 'px';
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.scale(dpr, dpr); const w = rect.width; const h = rect.height;
    ctx.clearRect(0, 0, w, h);
    sections.forEach(s => {
      ctx.fillStyle = s.color + '40';
      ctx.fillRect((s.startTime / duration) * w, 0, ((s.endTime - s.startTime) / duration) * w, h);
    });
    const midY = h / 2; ctx.beginPath(); ctx.strokeStyle = '#a855f766'; ctx.lineWidth = 0.6;
    for (let x = 0; x < w; x++) {
      const idx = Math.floor((x / w) * waveform.length);
      const amp = waveform[Math.min(idx, waveform.length - 1)] || 0;
      ctx.moveTo(x, midY - amp * h * 0.4); ctx.lineTo(x, midY + amp * h * 0.4);
    }
    ctx.stroke();
    ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 1.5;
    ctx.strokeRect((viewStart / duration) * w, 0, (viewDuration / duration) * w, h);
    ctx.fillStyle = '#a855f720'; ctx.fillRect((viewStart / duration) * w, 0, (viewDuration / duration) * w, h);
    if (currentTime > 0) {
      const px = (currentTime / duration) * w;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();
    }
  }, [waveform, sections, duration, viewStart, viewEnd, currentTime]);

  const fmt = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  const fmtSel = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  const zoomPct = Math.round((viewDuration / duration) * 100);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <button onClick={zoomOut} disabled={zoomLevel <= 1.05} className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
        </button>
        <button onClick={zoomToFit} disabled={zoomLevel <= 1.05} className="text-[10px] px-2 py-0.5 rounded text-gray-500 hover:text-gray-300 hover:bg-gray-800 disabled:opacity-30">Fit</button>
        <div className="flex-1 h-4 bg-gray-900/50 rounded-full cursor-pointer relative" onClick={handleMinimapClick}>
          <div className="absolute inset-0 flex items-center px-0.5"><div className="h-2 bg-purple-600/30 rounded-full" style={{ width: `${zoomPct}%` }} /></div>
        </div>
        <button onClick={zoomIn} disabled={zoomLevel >= 64} className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-800 disabled:opacity-30">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
        </button>
        <span className="text-[10px] text-gray-500 w-12 text-right font-mono">{zoomLevel >= 10 ? `${Math.round(zoomLevel)}x` : `${zoomLevel.toFixed(1)}x`}</span>
      </div>
      {zoomLevel > 1.05 && (
        <>
        <div ref={minimapContainerRef} className="w-full h-8 cursor-pointer rounded overflow-hidden" onClick={handleMinimapClick}>
          <canvas ref={minimapCanvasRef} className="w-full h-full" />
        </div>
        <div className="flex items-center gap-3 px-1">
          <span className="text-[9px] text-gray-600">🖱 Glisser = naviguer</span>
          <span className="text-[9px] text-gray-600">⇧/Ctrl + 🖱 glisser = sélection</span>
          <span className="text-[9px] text-gray-600">⇧/Ctrl + 1-6 = type</span>
          <span className="text-[9px] text-gray-600">Double-clic = zoom zone</span>
          <span className="text-[9px] text-gray-600">Échap = vue complète</span>
        </div>
        </>
      )}
      <div ref={mainContainerRef} data-waveform="true"
        className="w-full h-40 cursor-pointer relative rounded-lg overflow-hidden select-none border border-gray-800/50"
        onClick={handleClick} onDoubleClick={handleDoubleClick} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} onWheel={handleWheel} onContextMenu={handleContextMenu}
        style={{ cursor: isDragging ? 'grabbing' : isSelecting ? 'col-resize' : zoomLevel > 1.05 ? 'grab' : 'crosshair' }}>
        <canvas ref={mainCanvasRef} className="w-full h-full" />
      </div>
      {/* Context menu — uses ref-captured selection values */}
      {selMenu && hasSelForRender && (
        <div className="fixed z-50 bg-[#1a1a2e] border border-purple-700/50 rounded-lg shadow-xl py-1 min-w-[150px] waveform-context-menu"
          style={{ left: selMenu.x, top: selMenu.y }}>
          <div className="px-3 py-1.5 text-[10px] text-purple-400 uppercase tracking-wider border-b border-gray-800">
            Set: {fmtSel(Math.min(selectionRef.current.start, selectionRef.current.end))} → {fmtSel(Math.max(selectionRef.current.start, selectionRef.current.end))}
          </div>
          {(['intro', 'verse', 'chorus', 'bridge', 'drop', 'outro'] as const).map(type => (
            <button key={type}
              onClick={(e) => {
                e.stopPropagation();
                // Use ref-captured values to avoid stale closures
                onSelectionChange?.(selectionRef.current.start, selectionRef.current.end, type);
                resetSelection();
              }}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 capitalize flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SECTION_COLORS[type] }} />{type}
            </button>
          ))}
          {/* ── Entity Insert ── */}
          {onInsertEntity && ((scenes && scenes.length > 0) || (chasers && chasers.length > 0) || (cueLists && cueLists.length > 0) || (effects && effects.length > 0)) ? (
            <>
              <div className="border-t border-gray-800 my-0.5" />
              <div className="px-3 py-1 text-[9px] text-gray-600 uppercase tracking-wider">
                ─── Insert ───
              </div>
              {/* Scene sub-menu */}
              {scenes && scenes.length > 0 && (
                <div className="relative"
                  onMouseEnter={() => setEntitySubMenu('scene')}
                  onMouseLeave={() => setEntitySubMenu(null)}>
                  <button className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 flex items-center gap-2">
                    <span className="text-[14px] leading-none">💡</span> Scene ▸
                  </button>
                  {entitySubMenu === 'scene' && (
                    <div className="absolute left-full top-0 bg-[#1a1a2e] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px] max-h-44 overflow-y-auto">
                      {scenes.map(s => (
                        <button key={s.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            const st = Math.min(selectionRef.current.start, selectionRef.current.end);
                            const et = Math.max(selectionRef.current.start, selectionRef.current.end);
                            onInsertEntity(st, et, 'scene', s.id);
                            resetSelection();
                            setEntitySubMenu(null);
                          }}
                          className="w-full text-left px-3 py-1.5 text-[11px] text-gray-300 hover:bg-gray-800 truncate">
                          {s.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {/* Chaser sub-menu */}
              {chasers && chasers.length > 0 && (
                <div className="relative"
                  onMouseEnter={() => setEntitySubMenu('chaser')}
                  onMouseLeave={() => setEntitySubMenu(null)}>
                  <button className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 flex items-center gap-2">
                    <span className="text-[14px] leading-none">🏃</span> Chaser ▸
                  </button>
                  {entitySubMenu === 'chaser' && (
                    <div className="absolute left-full top-0 bg-[#1a1a2e] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px] max-h-44 overflow-y-auto">
                      {chasers.map(c => (
                        <button key={c.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            const st = Math.min(selectionRef.current.start, selectionRef.current.end);
                            const et = Math.max(selectionRef.current.start, selectionRef.current.end);
                            onInsertEntity(st, et, 'chaser', c.id);
                            resetSelection();
                            setEntitySubMenu(null);
                          }}
                          className="w-full text-left px-3 py-1.5 text-[11px] text-gray-300 hover:bg-gray-800 truncate">
                          {c.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {/* Cue List sub-menu */}
              {cueLists && cueLists.length > 0 && (
                <div className="relative"
                  onMouseEnter={() => setEntitySubMenu('cuelist')}
                  onMouseLeave={() => setEntitySubMenu(null)}>
                  <button className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 flex items-center gap-2">
                    <span className="text-[14px] leading-none">📋</span> Cue List ▸
                  </button>
                  {entitySubMenu === 'cuelist' && (
                    <div className="absolute left-full top-0 bg-[#1a1a2e] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px] max-h-44 overflow-y-auto">
                      {cueLists.map(cl => (
                        <button key={cl.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            const st = Math.min(selectionRef.current.start, selectionRef.current.end);
                            const et = Math.max(selectionRef.current.start, selectionRef.current.end);
                            onInsertEntity(st, et, 'cuelist', cl.id);
                            resetSelection();
                            setEntitySubMenu(null);
                          }}
                          className="w-full text-left px-3 py-1.5 text-[11px] text-gray-300 hover:bg-gray-800 truncate">
                          {cl.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {/* EFX sub-menu */}
              {effects && effects.length > 0 && (
                <div className="relative"
                  onMouseEnter={() => setEntitySubMenu('efx')}
                  onMouseLeave={() => setEntitySubMenu(null)}>
                  <button className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 flex items-center gap-2">
                    <span className="text-[14px] leading-none">⚡</span> EFX ▸
                  </button>
                  {entitySubMenu === 'efx' && (
                    <div className="absolute left-full top-0 bg-[#1a1a2e] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px] max-h-44 overflow-y-auto">
                      {effects.map(efx => (
                        <button key={efx.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            const st = Math.min(selectionRef.current.start, selectionRef.current.end);
                            const et = Math.max(selectionRef.current.start, selectionRef.current.end);
                            onInsertEntity(st, et, 'efx', efx.id);
                            resetSelection();
                            setEntitySubMenu(null);
                          }}
                          className="w-full text-left px-3 py-1.5 text-[11px] text-gray-300 hover:bg-gray-800 truncate">
                          {efx.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            // Disabled Insert section when no entities or no callback
            onInsertEntity ? (
              <>
                <div className="border-t border-gray-800 my-0.5" />
                <div className="px-3 py-1 text-[9px] text-gray-700 uppercase tracking-wider">─── Insert ───</div>
                <div className="px-3 py-1.5 text-[10px] text-gray-600 italic">No saved entities</div>
              </>
            ) : null
          )}
          {/* Color / Dimmer / Strobe insert (always available on selection) */}
          {(window as any).__lm_insertColor && (
            <>
              <div className="border-t border-gray-800 my-0.5" />
              <button className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 flex items-center gap-2"
                onClick={(e) => {
                  e.stopPropagation();
                  const st = Math.min(selectionRef.current.start, selectionRef.current.end);
                  const et = Math.max(selectionRef.current.start, selectionRef.current.end);
                  // Color picker centered
                  const popup = document.createElement('div');
                  popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:99999;background:#1a1a2e;border:1px solid #374151;border-radius:12px;padding:20px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5)';
                  popup.innerHTML = '<div style="color:#ec4899;font-size:13px;font-weight:600;margin-bottom:10px">🎨 Pick Color</div><input type="color" id="__cp" value="#ff0000" style="width:60px;height:40px;border:none;cursor:pointer;background:transparent" /><div id="__cv" style="color:#ec4899;font-size:18px;font-weight:700;margin:8px 0">#ff0000</div><div style="display:flex;gap:8px;margin-top:12px;justify-content:center"><button id="__cc" style="background:#ec4899;color:#000;border:none;border-radius:6px;padding:6px 16px;font-size:12px;font-weight:600;cursor:pointer">Insert</button><button id="__cx" style="background:#374151;color:#9ca3af;border:none;border-radius:6px;padding:6px 16px;font-size:12px;cursor:pointer">Cancel</button></div>';
                  document.body.appendChild(popup);
                  const cp = popup.querySelector('#__cp') as HTMLInputElement;
                  const cv = popup.querySelector('#__cv')!;
                  cp.oninput = () => { cv.textContent = cp.value; };
                  popup.querySelector('#__cc')!.addEventListener('click', () => {
                    document.body.removeChild(popup);
                    (window as any).__lm_insertColor(st, et, cp.value);
                    resetSelection();
                  });
                  popup.querySelector('#__cx')!.addEventListener('click', () => document.body.removeChild(popup));
                }}
              >
                <span className="text-[14px] leading-none">🎨</span> Color
              </button>
              <button className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 flex items-center gap-2"
                onClick={(e) => {
                  e.stopPropagation();
                  const st = Math.min(selectionRef.current.start, selectionRef.current.end);
                  const et = Math.max(selectionRef.current.start, selectionRef.current.end);
                  (window as any).__lm_insertDimmer(st, et);
                  resetSelection();
                }}
              >
                <span className="text-[14px] leading-none">💡</span> Dimmer
              </button>
              <button className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800 flex items-center gap-2"
                onClick={(e) => {
                  e.stopPropagation();
                  const st = Math.min(selectionRef.current.start, selectionRef.current.end);
                  const et = Math.max(selectionRef.current.start, selectionRef.current.end);
                  (window as any).__lm_insertStrobe(st, et);
                  resetSelection();
                }}
              >
                <span className="text-[14px] leading-none">⚡</span> Strobe
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
};
