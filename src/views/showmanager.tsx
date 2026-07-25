import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Play, Pause, Square, Repeat, Plus, Trash2, Music, Film,
  Zap, Volume2, VolumeX, GripHorizontal, ChevronDown, X,
  SkipBack, Save, Edit2, FolderOpen, Crosshair,
} from 'lucide-react';
import { useShowStore, type ShowData, type ShowTrack, type ShowTrackItem } from '../stores/showStore';
import { loadFixtureDefinitions, type DmxFixtureDefinition } from '../hooks/dmx-cues';
import { sendChannelsToHardware } from '../utils/dmx-helpers';

// ─── Helpers ─────────────────────────────────────────────────

const fmtTime = (ms: number): string => {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
};

const msToPct = (ms: number, total: number): string => {
  if (total <= 0) return '0%';
  return ((ms / total) * 100).toFixed(4) + '%';
};

const TRACK_HEADER_WIDTH = 180;
const TRACK_HEIGHT = 50;
const RULER_HEIGHT = 30;
const RULER_TICK_INTERVAL = 5000; // 5s ticks

// ─── Main Component ──────────────────────────────────────────

export const ShowManager: React.FC = () => {
  const shows = useShowStore((s) => s.shows);
  const scenes = useShowStore((s) => s.scenes);
  const chasers = useShowStore((s) => s.chasers);
  const songPresets = useShowStore((s) => s.songPresets);
  const effects = useShowStore((s) => s.effects);
  const patchedFixtures = useShowStore((s) => s.patchedFixtures);
  const fixtureDefCacheRef = useRef<Map<string, DmxFixtureDefinition>>(new Map());
  const createShow = useShowStore((s) => s.createShow);
  const updateShow = useShowStore((s) => s.updateShow);
  const deleteShow = useShowStore((s) => s.deleteShow);

  const [selectedShowId, setSelectedShowId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editItemName, setEditItemName] = useState('');
  const [editItemFadeIn, setEditItemFadeIn] = useState(0);
  const [editItemFadeOut, setEditItemFadeOut] = useState(0);
  const [draggingItem, setDraggingItem] = useState<{ itemId: string; trackId: string; startX: number; origStartTime: number } | null>(null);
  const [resizingItem, setResizingItem] = useState<{ itemId: string; trackId: string; edge: 'left' | 'right'; startX: number; origStartTime: number; origDuration: number } | null>(null);
  const [scrollStart, setScrollStart] = useState({ x: 0, scrollLeft: 0 });
  const timelineMoveRef = useRef(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; itemId: string } | null>(null);
  const trackWaveformsRef = useRef<Map<string, number[]>>(new Map());
  const [waveformVersion, setWaveformVersion] = useState(0);
  const audioCanvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [addItemTrackId, setAddItemTrackId] = useState<string | null>(null);
  const [addItemBtnRect, setAddItemBtnRect] = useState<DOMRect | null>(null);

  // Playback state
  const [playState, setPlayState] = useState<'stopped' | 'playing' | 'paused'>('stopped');
  const [playheadTime, setPlayheadTime] = useState(0);
  const [loop, setLoop] = useState(false);
  const playTimerRef = useRef<number | null>(null);
  const playStartRef = useRef<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioBuffersRef = useRef<Map<string, AudioBuffer>>(new Map());
  const audioSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const playheadTimeRef = useRef<number>(0);

  const timelineRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);

  const selectedShow = shows.find((s) => s.id === selectedShowId) || null;
  const trackItems = selectedShow?.tracks ?? [];

  const totalDuration = selectedShow?.duration ?? 60000;

  // Effective duration for zoom: use the longest item end time (audio track, etc.)
  const effectiveDuration = React.useMemo(() => {
    let end = totalDuration;
    for (const track of trackItems) {
      for (const item of track.items) {
        end = Math.max(end, item.startTime + item.duration);
      }
    }
    return end;
  }, [totalDuration, trackItems]);

  // Show name editing
  const [editShowName, setEditShowName] = useState('');

  useEffect(() => {
    if (selectedShow) setEditShowName(selectedShow.name);
  }, [selectedShow?.id]);

  // ── Keyboard ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === ' ') { e.preventDefault(); if (playState === 'playing') pausePlayback(); else if (playState === 'paused') resumePlayback(); else startPlayback(); }
      if (e.key === 'Escape') { stopPlayback(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playState, selectedShow]);

  // ── Load fixture definitions for EFX tracks ──
  useEffect(() => {
    if (effects.length === 0) return;
    const fixtureIds = new Set<string>();
    for (const efx of effects) {
      for (const fid of efx.fixtureIds) {
        const pf = patchedFixtures.find((f) => f.id === fid);
        if (pf) fixtureIds.add(pf.fixtureDefId);
      }
    }
    if (fixtureIds.size === 0) return;
    loadFixtureDefinitions([...fixtureIds]).then((defs) => {
      fixtureDefCacheRef.current = defs;
    }).catch(() => {});
  }, [effects, patchedFixtures]);

  // ── Playback logic ──
  const stopPlayback = useCallback(() => {
    if (playTimerRef.current) { cancelAnimationFrame(playTimerRef.current); playTimerRef.current = null; }
    for (const src of audioSourcesRef.current) { try { src.stop(); } catch {} }
    audioSourcesRef.current = [];
    setPlayState('stopped');
    setPlayheadTime(0);
    playheadTimeRef.current = 0;
    try {
      const allZero: Record<number, number> = {};
      for (let i = 1; i <= 512; i++) allZero[i] = 0;
      sendChannelsToHardware(allZero, useShowStore.getState().patchedFixtures, useShowStore.getState().universes).catch(() => {});
    } catch {}
  }, []);

  // Audio: ensure AudioContext is ready and decode a base64 buffer (cached)
  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    return audioCtxRef.current;
  }, []);

  const getAudioBuffer = useCallback(async (b64: string) => {
    const cache = audioBuffersRef.current;
    const hashKey = b64.slice(0, 200); // simple cache key
    if (cache.has(hashKey)) return cache.get(hashKey)!;
    const ctx = getAudioCtx();
    const resp = await fetch(b64);
    const arrayBuffer = await resp.arrayBuffer();
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    cache.set(hashKey, buffer);
    return buffer;
  }, [getAudioCtx]);

  const startPlayback = useCallback(() => {
    if (!selectedShow || selectedShow.tracks.length === 0) return;

    const isResuming = playState === 'paused';
    if (!isResuming) {
      // Full reset only when starting from stopped
      stopPlayback();
    } else {
      // Clean up stale frame without resetting playhead/DMX (preserve pause position)
      if (playTimerRef.current) { cancelAnimationFrame(playTimerRef.current); playTimerRef.current = null; }
      audioSourcesRef.current = [];
    }

    getAudioCtx(); // ensure context exists (unlocks audio on first user gesture)

    const startTime = isResuming ? playheadTime : 0;
    playStartRef.current = performance.now() - startTime;
    playheadTimeRef.current = startTime;

    // Track which audio items have been started (prevent duplicates)
    const startedAudios = new Set<string>();

    const tick = () => {
      const currentMs = performance.now() - playStartRef.current;
      playheadTimeRef.current = currentMs;
      setPlayheadTime(currentMs);

      for (const track of selectedShow.tracks) {
        if (track.muted) continue;
        for (const item of track.items) {
          const itemStart = item.startTime;
          const itemEnd = item.startTime + item.duration;

          if (currentMs < itemStart || currentMs > itemEnd) {
            if (track.type === 'audio') startedAudios.delete(item.id);
            continue;
          }

          const elapsed = currentMs - itemStart;
          const fadeInEnd = item.fadeIn;
          const fadeOutStart = item.duration - item.fadeOut;

          let intensity = 1;
          if (elapsed < fadeInEnd && fadeInEnd > 0) intensity = elapsed / fadeInEnd;
          else if (elapsed > fadeOutStart && item.fadeOut > 0) intensity = 1 - (elapsed - fadeOutStart) / item.fadeOut;

          // ── Audio Track Item ──
          if (track.type === 'audio' && item.audioFileBase64 && !startedAudios.has(item.id)) {
            startedAudios.add(item.id);
            const audioOffsetSec = Math.max(0, elapsed) / 1000;
            getAudioBuffer(item.audioFileBase64).then((buffer) => {
              if (playheadTimeRef.current < itemStart || playheadTimeRef.current > itemEnd) return; // already past
              const ctx = audioCtxRef.current;
              if (!ctx || ctx.state === 'closed') return;
              if (ctx.state === 'suspended') ctx.resume();
              const source = ctx.createBufferSource();
              source.buffer = buffer;
              source.connect(ctx.destination);
              source.start(0, audioOffsetSec);
              audioSourcesRef.current.push(source);
              source.onended = () => {
                audioSourcesRef.current = audioSourcesRef.current.filter(s => s !== source);
              };
            }).catch(() => {});
          }

          // ── Scene Item ──
          if (track.type === 'scene') {
            const scene = scenes.find((s) => s.id === item.resourceId);
            if (scene) {
              const faded: Record<number, number> = {};
              for (const [addr, val] of Object.entries(scene.channels)) faded[Number(addr)] = Math.round(val * intensity);
              sendChannelsToHardware(faded, currentState.patchedFixtures, currentState.universes).catch(() => {})
            }
          }

          // ── Chaser Item ──
          if (track.type === 'chaser') {
            const chaser = chasers.find((c) => c.id === item.resourceId);
            if (chaser && chaser.steps.length > 0) {
              const totalCycle = chaser.steps.reduce((sum, s) => sum + s.fadeIn + s.hold + s.fadeOut, 0);
              if (totalCycle <= 0) continue;
              const cyclePos = elapsed % totalCycle;
              let accumulated = 0;
              for (const step of chaser.steps) {
                const stepDur = step.fadeIn + step.hold + step.fadeOut;
                if (cyclePos >= accumulated && cyclePos < accumulated + stepDur) {
                  const stepElapsed = cyclePos - accumulated;
                  let si = 1;
                  if (stepElapsed < step.fadeIn && step.fadeIn > 0) si = stepElapsed / step.fadeIn;
                  else if (stepElapsed > stepDur - step.fadeOut && step.fadeOut > 0) si = 1 - (stepElapsed - (stepDur - step.fadeOut)) / step.fadeOut;
                  const stepScene = scenes.find((s) => s.id === step.sceneId);
                  if (stepScene) {
                    const faded: Record<number, number> = {};
                    for (const [addr, val] of Object.entries(stepScene.channels)) faded[Number(addr)] = Math.round(val * si * intensity);
                    sendChannelsToHardware(faded, currentState.patchedFixtures, currentState.universes).catch(() => {})
                  }
                  break;
                }
                accumulated += stepDur;
              }
            }
          }

          // ── EFX Item ──
          if (track.type === 'efx') {
            const currentEffects = useShowStore.getState().effects;
            const effect = currentEffects.find((e) => e.id === item.resourceId);
            if (effect && effect.fixtureIds.length > 0) {
              const store = useShowStore.getState();
              const allPatched = store.patchedFixtures;
              const targetFixtures = allPatched.filter((f) => effect.fixtureIds.includes(f.id));
              for (const pf of targetFixtures) {
                // Use identical math to EFX Editor live DMX preview
                const elapsedSec = elapsed / 1000;
                const phase = (elapsedSec * (effect.speed || 0.5) * 2) % (Math.PI * 2);
                const rx = (effect.width || 1) * 0.7;
                const ry = (effect.height || 1) * 0.7;
                const rotRad = ((effect.rotation || 0) * Math.PI) / 180;
                const ox = ((effect.xOffset || 0) / 255) * 0.3;
                const oy = ((effect.yOffset || 0) / 255) * 0.3;

                let px = 0, py = 0;
                const seg = phase / (Math.PI * 2);
                switch (effect.pattern) {
                  case 'Circle':
                    px = Math.cos(phase) * rx; py = Math.sin(phase) * ry;
                    break;
                  case 'Line': {
                    const lp = seg % 1;
                    const lineX = lp < 0.5 ? (lp * 2) * 2 - 1 : (1 - (lp - 0.5) * 2) * 2 - 1;
                    px = lineX * rx; py = 0;
                    break;
                  }
                  case 'Eight':
                    px = Math.sin(phase) * rx; py = Math.sin(phase * 2) * ry * 0.5;
                    break;
                  case 'Square': {
                    const s = seg * 4; const sIdx = Math.floor(s) % 4; const sFrac = s - Math.floor(s);
                    const cs: [number, number][] = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
                    const ce: [number, number][] = [[-1, 1], [-1, -1], [1, -1], [1, 1]];
                    px = (cs[sIdx][0] + (ce[sIdx][0] - cs[sIdx][0]) * sFrac) * rx;
                    py = (cs[sIdx][1] + (ce[sIdx][1] - cs[sIdx][1]) * sFrac) * ry;
                    break;
                  }
                  case 'Triangle': {
                    const ta = seg * 3; const ti = Math.floor(ta) % 3; const tf = ta - Math.floor(ta);
                    const tv: [number, number][] = [[0, -1], [-0.866, 0.5], [0.866, 0.5]];
                    const tn = tv[(ti + 1) % 3];
                    px = (tv[ti][0] + (tn[0] - tv[ti][0]) * tf) * rx;
                    py = (tv[ti][1] + (tn[1] - tv[ti][1]) * tf) * ry;
                    break;
                  }
                }
                // Apply rotation and offset (same as EFX editor)
                const rx2 = px * Math.cos(rotRad) - py * Math.sin(rotRad) + ox;
                const ry2 = px * Math.sin(rotRad) + py * Math.cos(rotRad) + oy;
                // Map -1..1 → 0..255 with center at 128
                const dmxPan = Math.round(Math.max(0, Math.min(255, 128 + rx2 * 127)));
                const dmxTilt = Math.round(Math.max(0, Math.min(255, 128 + ry2 * 127)));

                // Find pan/tilt channels for this fixture
                const def = fixtureDefCacheRef.current.get(pf.fixtureDefId);
                if (!def) continue;
                const mode = def.modes[pf.modeIndex];
                if (!mode) continue;
                let panOff = -1, tiltOff = -1, panFineOff = -1, tiltFineOff = -1, dimmerOff = -1;
                for (let ci = 0; ci < mode.channels.length; ci++) {
                  const ch = mode.channels[ci];
                  if (ch.type === 'Pan') {
                    if (ch.name?.toLowerCase().includes('fine')) panFineOff = ci;
                    else panOff = ci;
                  }
                  if (ch.type === 'Tilt') {
                    if (ch.name?.toLowerCase().includes('fine')) tiltFineOff = ci;
                    else tiltOff = ci;
                  }
                  if (ch.type === 'Intensity') dimmerOff = ci;
                }
                if (panOff >= 0 || tiltOff >= 0) {
                  const vals: Record<number, number> = {};
                  if (dimmerOff >= 0) vals[pf.startAddress + dimmerOff] = Math.round(255 * intensity);
                  if (panOff >= 0) vals[pf.startAddress + panOff] = dmxPan;
                  if (tiltOff >= 0) vals[pf.startAddress + tiltOff] = dmxTilt;
                  if (panFineOff >= 0) vals[pf.startAddress + panFineOff] = dmxPan;
                  if (tiltFineOff >= 0) vals[pf.startAddress + tiltFineOff] = dmxTilt;
                  sendChannelsToHardware(vals, currentState.patchedFixtures, currentState.universes).catch(() => {})
                }
              }
            }
          }
        }
      }

      if (currentMs >= selectedShow.duration) {
        if (loop) { playStartRef.current = performance.now(); playheadTimeRef.current = 0; setPlayheadTime(0); startedAudios.clear(); }
        else { stopPlayback(); return; }
      }

      playTimerRef.current = requestAnimationFrame(tick);
    };

    setPlayState('playing');
    setPlayheadTime(startTime);
    playTimerRef.current = requestAnimationFrame(tick);
  }, [selectedShow, scenes, chasers, playState, playheadTime, loop, stopPlayback, getAudioCtx, getAudioBuffer]);

  const pausePlayback = useCallback(() => {
    if (playTimerRef.current) { cancelAnimationFrame(playTimerRef.current); playTimerRef.current = null; }
    for (const src of audioSourcesRef.current) { try { src.stop(); } catch {} }
    audioSourcesRef.current = [];
    setPlayState('paused');
  }, []);

  const resumePlayback = useCallback(() => {
    startPlayback();
  }, [startPlayback]);

// ── Event handlers ──
  const handleCreateShow = () => {
    const id = createShow('New Show');
    setSelectedShowId(id);
  };

  const handleShowNameChange = () => {
    if (selectedShow && editShowName.trim()) {
      updateShow(selectedShow.id, { name: editShowName.trim() });
    }
  };

  const handleAddTrack = (type: ShowTrack['type']) => {
    if (!selectedShow) return;
    const id = 'trk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const newTrack: ShowTrack = {
      id,
      name: type === 'scene' ? 'Scene Track' : type === 'chaser' ? 'Chaser Track' : type === 'efx' ? 'EFX Track' : 'Audio Track',
      type,
      items: [],
      muted: false,
      solo: false,
    };
    updateShow(selectedShow.id, { tracks: [...selectedShow.tracks, newTrack] });
  };

  const handleDeleteTrack = (trackId: string) => {
    if (!selectedShow) return;
    updateShow(selectedShow.id, {
      tracks: selectedShow.tracks.filter((t) => t.id !== trackId),
    });
  };

  const handleToggleMute = (trackId: string) => {
    if (!selectedShow) return;
    updateShow(selectedShow.id, {
      tracks: selectedShow.tracks.map((t) =>
        t.id === trackId ? { ...t, muted: !t.muted, solo: false } : t
      ),
    });
  };

  const handleToggleSolo = (trackId: string) => {
    if (!selectedShow) return;
    updateShow(selectedShow.id, {
      tracks: selectedShow.tracks.map((t) =>
        t.id === trackId ? { ...t, solo: !t.solo, muted: false } : t
      ),
    });
  };

  const handleAddItemToTrack = (trackId: string, resourceId: string, name: string, duration?: number, audioFileBase64?: string) => {
    if (!selectedShow) return;
    const itemId = 'tmi-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const itemDur = duration ?? 5000;
    const newItem: ShowTrackItem = {
      id: itemId,
      startTime: playheadTime,
      duration: itemDur,
      resourceId,
      fadeIn: 500,
      fadeOut: 500,
      name,
      audioFileBase64,
    };
    const itemEnd = playheadTime + itemDur;
    // Read fresh show state from store to avoid stale closure issues
    const freshShow = useShowStore.getState().shows.find((s) => s.id === selectedShow.id);
    const currentDuration = freshShow?.duration ?? selectedShow.duration;
    const updates: Partial<ShowData> = {
      tracks: selectedShow.tracks.map((t) =>
        t.id === trackId ? { ...t, items: [...t.items, newItem] } : t
      ),
    };
    // Update show duration if the new item extends beyond current duration
    if (itemEnd > currentDuration) {
      updates.duration = itemEnd;
    }
    updateShow(selectedShow.id, updates);
    setAddItemTrackId(null);
  };

  const handleDeleteItem = (itemId: string) => {
    if (!selectedShow) return;
    updateShow(selectedShow.id, {
      tracks: selectedShow.tracks.map((t) => ({
        ...t,
        items: t.items.filter((it) => it.id !== itemId),
      })),
    });
    setContextMenu(null);
  };

  const handleItemDoubleClick = (item: ShowTrackItem) => {
    setEditingItemId(item.id);
    setEditItemName(item.name);
    setEditItemFadeIn(item.fadeIn);
    setEditItemFadeOut(item.fadeOut);
  };

  const handleSaveItemEdit = () => {
    if (!selectedShow || !editingItemId) return;
    updateShow(selectedShow.id, {
      tracks: selectedShow.tracks.map((t) => ({
        ...t,
        items: t.items.map((it) =>
          it.id === editingItemId
            ? { ...it, name: editItemName, fadeIn: editItemFadeIn, fadeOut: editItemFadeOut }
            : it
        ),
      })),
    });
    setEditingItemId(null);
  };

  // ── Drag/Resize handlers ──
  const handleItemDragStart = (e: React.MouseEvent, itemId: string, trackId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const item = selectedShow?.tracks.find((t) => t.id === trackId)?.items.find((it) => it.id === itemId);
    if (!item) return;
    const startX = e.clientX;
    setDraggingItem({ itemId, trackId, startX, origStartTime: item.startTime });
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const containerW = timelineRef.current?.clientWidth ?? 1;
      const dt = (dx / containerW) * effectiveDuration;
      setDraggingItem((prev) => prev ? { ...prev, origStartTime: Math.max(0, item.startTime + dt) } : null);
    };
    const onUp = () => {
      setDraggingItem((prev) => {
        if (prev && selectedShow) {
          updateShow(selectedShow.id, {
            tracks: selectedShow.tracks.map((t) =>
              t.id === trackId
                ? {
                    ...t,
                    items: t.items.map((it) =>
                      it.id === itemId ? { ...it, startTime: Math.max(0, Math.round(prev.origStartTime)) } : it
                    ),
                  }
                : t
            ),
          });
        }
        return null;
      });
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleItemResizeStart = (e: React.MouseEvent, itemId: string, trackId: string, edge: 'left' | 'right') => {
    e.stopPropagation();
    e.preventDefault();
    const item = selectedShow?.tracks.find((t) => t.id === trackId)?.items.find((it) => it.id === itemId);
    if (!item) return;
    setResizingItem({ itemId, trackId, edge, startX: e.clientX, origStartTime: item.startTime, origDuration: item.duration });
    const startX = e.clientX;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const containerW = timelineRef.current?.clientWidth ?? 1;
      const dt = (dx / containerW) * effectiveDuration;
      setResizingItem((prev) => {
        if (!prev) return null;
        if (edge === 'left') {
          const newStart = Math.max(0, item.startTime + dt);
          const newDur = item.duration + (item.startTime - newStart);
          return { ...prev, origStartTime: newStart, origDuration: Math.max(200, newDur) };
        } else {
          return { ...prev, origDuration: Math.max(200, item.duration + dt) };
        }
      });
    };
    const onUp = () => {
      setResizingItem((prev) => {
        if (prev && selectedShow) {
          const newStart = Math.max(0, Math.round(prev.origStartTime));
          const newDur = Math.round(prev.origDuration);
          const itemEnd = newStart + newDur;
          const updates: Partial<ShowData> = {
            tracks: selectedShow.tracks.map((t) =>
              t.id === trackId
                ? {
                    ...t,
                    items: t.items.map((it) =>
                      it.id === itemId
                        ? { ...it, startTime: newStart, duration: newDur }
                        : it
                    ),
                  }
                : t
            ),
          };
          // Read fresh state from store for accurate duration check
          const latestShow = useShowStore.getState().shows.find((s) => s.id === selectedShow.id);
          const latestDuration = latestShow?.duration ?? selectedShow.duration;
          if (itemEnd > latestDuration) updates.duration = itemEnd;
          updateShow(selectedShow.id, updates);
        }
        return null;
      });
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleTimelineScroll = (e: React.MouseEvent) => {
    if (draggingItem || resizingItem) return;
    timelineMoveRef.current = false;
    const el = timelineRef.current;
    if (!el) return;
    const startX = e.clientX;
    const startScrollLeft = el.scrollLeft;
    setScrollStart({ x: startX, scrollLeft: startScrollLeft });
    const onMove = (ev: MouseEvent) => {
      timelineMoveRef.current = true;
      if (el) el.scrollLeft = startScrollLeft - (ev.clientX - startX);
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleTimelineWheel = (e: React.WheelEvent) => {
    // Zoom removed — percentage layout adapts automatically
  };

  const handleDurationChange = (newDuration: number) => {
    if (!selectedShow) return;
    updateShow(selectedShow.id, { duration: Math.max(5000, newDuration) });
  };

  const handleTimelineClick = (e: React.MouseEvent) => {
    if (draggingItem || resizingItem) return;
    if (timelineMoveRef.current) { timelineMoveRef.current = false; return; }
    const el = timelineRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left + el.scrollLeft;
    const contentWidth = el.scrollWidth || rect.width || 1;
    const time = (x / contentWidth) * effectiveDuration;
    setPlayheadTime(Math.max(0, Math.min(time, effectiveDuration)));
    if (playState === 'paused') {
      playStartRef.current = performance.now() - time;
    }
  };

  // ── Sync ruler scroll ──
  useEffect(() => {
    const timeline = timelineRef.current;
    const ruler = rulerRef.current;
    if (!timeline || !ruler) return;
    const sync = () => { ruler.scrollLeft = timeline.scrollLeft; };
    timeline.addEventListener('scroll', sync);
    return () => timeline.removeEventListener('scroll', sync);
  }, []);

  // ── Load waveforms for all audio track items ──
  useEffect(() => {
    let cancelled = false;
    const audioTracks = trackItems.filter((t) => t.type === 'audio');
    audioTracks.forEach(async (track) => {
      for (const item of track.items) {
        if (cancelled) return;
        if (!item.audioFileBase64) continue;
        if (trackWaveformsRef.current.has(item.id)) continue; // already loaded
        try {
          const buffer = await getAudioBuffer(item.audioFileBase64);
          if (cancelled) return;
          const channel = buffer.getChannelData(0);
          const bins = 500;
          const step = Math.max(1, Math.floor(channel.length / bins));
          const peaks: number[] = [];
          for (let i = 0; i < channel.length; i += step) {
            let max = 0;
            for (let j = i; j < i + step && j < channel.length; j++) {
              max = Math.max(max, Math.abs(channel[j]));
            }
            peaks.push(max);
          }
          trackWaveformsRef.current.set(item.id, peaks);
          if (!cancelled) setWaveformVersion((v) => v + 1);
        } catch {}
      }
    });
    return () => {
      cancelled = true;
    };
  }, [trackItems, getAudioBuffer]);

  // ── Draw waveforms on audio track canvases ──
  useEffect(() => {
    const canvases = audioCanvasRefs.current;
    if (canvases.size === 0) return;
    const raf = requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;
      for (const [trackId, canvas] of canvases) {
        const track = trackItems.find((t) => t.id === trackId);
        if (!track || track.type !== 'audio') continue;
        const rect = canvas.getBoundingClientRect();
        const w = rect.width * dpr;
        const h = rect.height * dpr;
        if (w <= 0 || h <= 0) continue;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.clearRect(0, 0, w, h);
        ctx.scale(dpr, dpr);
        const midH = rect.height / 2;
        for (const item of track.items) {
          const peaks = trackWaveformsRef.current.get(item.id);
          if (!peaks || peaks.length === 0) continue;
          const itemLeft = (item.startTime / effectiveDuration) * rect.width;
          const itemWidth = Math.max(1, (item.duration / effectiveDuration) * rect.width);
          const barW = itemWidth / peaks.length;
          ctx.fillStyle = '#3b82f660';
          for (let i = 0; i < peaks.length; i++) {
            const bh = Math.max(0.5, peaks[i] * rect.height * 0.8);
            const x = itemLeft + i * barW;
            ctx.fillRect(x, midH - bh / 2, Math.max(0.5, barW - 1), bh);
          }
        }
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [waveformVersion, effectiveDuration, totalDuration, trackItems]);

  // Percentage-based timeline (always fills container, no zoom needed)
  const pctLeft = useCallback((ms: number) => msToPct(ms, effectiveDuration), [effectiveDuration]);
  const pctWidth = useCallback((ms: number) => msToPct(ms, effectiveDuration), [effectiveDuration]);
  const timelineWidth = '100%';
  const rulerTicks = useMemo(() => {
    const ticks: { time: number; pct: string; label: string; major: boolean }[] = [];
    // Auto tick interval based on duration
    const durSec = effectiveDuration / 1000;
    const interval = durSec > 600 ? 30000 : durSec > 120 ? 10000 : durSec > 30 ? 5000 : 1000;
    for (let t = 0; t <= effectiveDuration; t += interval) {
      const sec = Math.floor(t / 1000);
      const min = Math.floor(sec / 60);
      const s = sec % 60;
      ticks.push({
        time: t,
        pct: msToPct(t, effectiveDuration),
        label: `${min}:${s.toString().padStart(2, '0')}`,
        major: t % (interval * 5) === 0 || t === 0 || t >= effectiveDuration - interval,
      });
    }
    return ticks;
  }, [effectiveDuration]);

  const TRACK_COLORS: Record<string, string> = {
    scene: '#a855f7',
    chaser: '#22c55e',
    efx: '#f59e0b',
    audio: '#3b82f6',
  };

  const TRACK_ICONS: Record<string, string> = {
    scene: '🎬',
    chaser: '🎞️',
    efx: '✨',
    audio: '🎵',
  };

  // ── If no show selected, show list ──
  if (!selectedShow) {
    return (
      <div className="h-full flex flex-col bg-[#0a0a0f]">
        <div className="px-4 pt-3 pb-2 flex items-center gap-3 border-b border-gray-800/50">
          <span className="text-sm font-bold text-white">Show Manager</span>
          <div className="flex-1" />
          <button
            onClick={handleCreateShow}
            className="px-3 py-1.5 bg-purple-600/20 text-purple-300 rounded-lg text-xs font-medium hover:bg-purple-600/30 flex items-center gap-1.5 border border-purple-500/30"
          >
            <Plus size={14} /> New Show
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {shows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-600">
              <div className="text-4xl mb-3 opacity-30">🎭</div>
              <div className="text-sm mb-1">No shows yet</div>
              <div className="text-xs">Create a new show to start building a timeline</div>
              <button onClick={handleCreateShow} className="mt-4 px-4 py-2 bg-purple-600/20 text-purple-300 rounded-lg text-xs hover:bg-purple-600/30 transition-colors">
                <Plus size={14} className="inline mr-1" /> Create Show
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {shows.map((show) => (
                <div
                  key={show.id}
                  onClick={() => { setSelectedShowId(show.id); stopPlayback(); }}
                  className="bg-[#0d0d14] border border-gray-800/50 rounded-xl p-4 cursor-pointer hover:border-purple-500/30 transition-all group"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-bold text-gray-200 truncate flex-1">{show.name}</h3>
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteConfirm(show.id); }}
                      className="p-1 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="text-[10px] text-gray-500 space-y-0.5">
                    <div>{show.tracks.length} track{show.tracks.length !== 1 ? 's' : ''}</div>
                    <div>Duration: {fmtTime(show.duration)}</div>
                    <div>{show.audioFileName ? `🎵 ${show.audioFileName}` : 'No audio'}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        {/* Delete confirmation */}
        {deleteConfirm && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onClick={() => setDeleteConfirm(null)}>
            <div className="bg-[#12121a] border border-gray-700 rounded-xl p-5 shadow-2xl w-80" onClick={(e) => e.stopPropagation()}>
              <h4 className="text-sm font-bold text-white mb-2">Delete Show?</h4>
              <p className="text-xs text-gray-400 mb-4">This will permanently delete this show. This cannot be undone.</p>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setDeleteConfirm(null)} className="px-3 py-1.5 bg-gray-800/50 border border-gray-700 rounded-lg text-xs text-gray-300 hover:bg-gray-700/50">Cancel</button>
                <button onClick={() => { stopPlayback(); deleteShow(deleteConfirm); setDeleteConfirm(null); setSelectedShowId(null); setEditingItemId(null); }} className="px-3 py-1.5 bg-red-600/20 border border-red-500/30 rounded-lg text-xs text-red-300 hover:bg-red-600/30">Delete</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#0a0a0f]">
      {/* ── Top Bar: Show name, controls ── */}
      <div className="px-3 py-2 border-b border-gray-800/50 flex items-center gap-3 shrink-0 bg-[#0d0d14]">
        <button
          onClick={() => { setSelectedShowId(null); stopPlayback(); }}
          className="p-1 text-gray-500 hover:text-gray-300"
          title="Back to shows"
        >
          <SkipBack size={16} />
        </button>

        {/* Show name */}
        <input
          type="text"
          value={editShowName}
          onChange={(e) => setEditShowName(e.target.value)}
          onBlur={handleShowNameChange}
          onKeyDown={(e) => { if (e.key === 'Enter') handleShowNameChange(); }}
          className="bg-transparent text-sm font-bold text-white outline-none border-b border-transparent hover:border-gray-700 focus:border-purple-500/50 w-48"
          placeholder="Show Name"
        />

        <div className="w-px h-5 bg-gray-800" />

        {/* Transport controls */}
        <div className="flex items-center gap-1">
          {playState === 'stopped' || playState === 'paused' ? (
            <button onClick={playState === 'paused' ? resumePlayback : startPlayback}
              className="p-1.5 rounded-md bg-green-600/20 text-green-400 hover:bg-green-600/30 transition-colors" title="Play">
              <Play size={16} />
            </button>
          ) : (
            <button onClick={pausePlayback}
              className="p-1.5 rounded-md bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/30 transition-colors" title="Pause">
              <Pause size={16} />
            </button>
          )}
          <button onClick={stopPlayback}
            className="p-1.5 rounded-md bg-red-600/20 text-red-400 hover:bg-red-600/30 transition-colors" title="Stop">
            <Square size={16} />
          </button>
          <button onClick={() => setLoop(!loop)}
            className={`p-1.5 rounded-md transition-colors ${loop ? 'bg-purple-600/30 text-purple-300' : 'text-gray-500 hover:text-gray-300'}`}
            title="Loop">
            <Repeat size={16} />
          </button>
        </div>

        <div className="w-px h-5 bg-gray-800" />

        {/* Time display */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-mono text-purple-300">{fmtTime(playheadTime)}</span>
          <span className="text-xs text-gray-600">/</span>
          <span className="text-xs font-mono text-gray-500">{fmtTime(totalDuration)}</span>
        </div>

        <div className="flex-1" />

        {/* Duration input */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-gray-500">Duration:</span>
          <input
            type="number"
            value={Math.round(totalDuration / 1000)}
            onChange={(e) => handleDurationChange(Number(e.target.value) * 1000)}
            min={5}
            max={3600}
            className="w-14 px-1.5 py-0.5 bg-gray-800/50 border border-gray-700 rounded text-[10px] text-gray-300 text-center font-mono"
          />
          <span className="text-[10px] text-gray-600">s</span>
        </div>

        {/* Zoom: removed — timeline uses 100% width percentage layout */}
        <div className="w-px h-5 bg-gray-800" />

        {/* Save / Load */}
        <div className="flex items-center gap-1">
          <button
            onClick={async () => {
              if (!selectedShow) return;
              try {
                // Save via system file dialog
                const filePath = await window.lightMaestro.dialog.saveFile(
                  [{ name: 'Light Maestro Show', extensions: ['lmshow'] }],
                  `${selectedShow.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.lmshow`,
                  JSON.stringify(selectedShow, null, 2)
                );
                if (filePath) {
                  console.log('Show saved to', filePath);
                  // Also save via the show storage for recent list
                  try { await window.lightMaestro.show.save(selectedShow, filePath); } catch {}
                }
              } catch (err) { console.error('Save failed', err); }
            }}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-green-600/20 text-green-300 hover:bg-green-600/30 transition-colors"
            title="Save Show"
          >
            <Save size={12} />
            <span className="hidden sm:inline">Save</span>
          </button>
          <button
            onClick={async () => {
              const show = await window.lightMaestro.show.openDialog();
              if (!show) return;
              // Merge into the store
              const state = useShowStore.getState();
              const others = state.shows.filter((s: any) => s.id !== show.id);
              useShowStore.setState({ shows: [...others, show] });
              setSelectedShowId(show.id);
            }}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-gray-800/30 text-gray-400 hover:bg-gray-700/40 transition-colors"
            title="Load Show"
          >
            <FolderOpen size={12} />
            <span className="hidden sm:inline">Load</span>
          </button>
        </div>
      </div>

      {/* ── Add Track Bar ── */}
      <div className="px-3 py-2 border-b border-gray-800/50 bg-[#0d0d14] flex items-center gap-3 shrink-0">
        <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">Add Track:</span>
        <button onClick={() => handleAddTrack('scene')}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-600/30 text-purple-300 hover:bg-purple-600/40 border border-purple-500/30 flex items-center gap-1.5 transition-colors">
          <Film size={14} /> Scene Track
        </button>
        <button onClick={() => handleAddTrack('chaser')}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-green-600/30 text-green-300 hover:bg-green-600/40 border border-green-500/30 flex items-center gap-1.5 transition-colors">
          <Zap size={14} /> Chaser Track
        </button>
        <button onClick={() => handleAddTrack('audio')}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600/30 text-blue-300 hover:bg-blue-600/40 border border-blue-500/30 flex items-center gap-1.5 transition-colors">
          <Music size={14} /> Audio Track
        </button>
        <button onClick={() => handleAddTrack('efx')}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-600/30 text-cyan-300 hover:bg-cyan-600/40 border border-cyan-500/30 flex items-center gap-1.5 transition-colors">
          <Crosshair size={14} /> EFX Track
        </button>
        <span className="text-[10px] text-gray-600 ml-auto">Drag items from sidebar onto tracks</span>
      </div>

      {/* ── Main Timeline ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Ruler */}
        <div
          ref={rulerRef}
          className="h-[30px] border-b border-gray-800/50 overflow-hidden shrink-0"
          style={{ marginLeft: TRACK_HEADER_WIDTH }}
        >
          <div style={{ width: timelineWidth, height: '100%', position: 'relative' }}>
            {/* Ruler background */}
            <div className="absolute inset-0 bg-[#0d0d14]" />
            {rulerTicks.map((tick) => (
              <div
                key={tick.time}
                className="absolute top-0 h-full"
                style={{ left: tick.pct }}
              >
                <div className={`w-px ${tick.major ? 'h-full bg-gray-600' : 'h-1/2 bg-gray-800'}`} />
                {tick.major && (
                  <span className="absolute top-1 left-1 text-[9px] text-gray-500 font-mono whitespace-nowrap">
                    {tick.label}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Track headers + Timeline body */}
        <div className="flex-1 flex overflow-hidden">
          {/* Track headers (left panel) */}
          <div className="w-[180px] shrink-0 border-r border-gray-800/50 bg-[#0d0d14] overflow-y-auto">
            {trackItems.map((track) => (
              <div
                key={track.id}
                onClick={() => setSelectedTrackId(track.id)}
                onDoubleClick={() => setEditingItemId(null)} // close any item edit
                className={`h-[50px] px-3 py-1.5 border-b border-gray-800/30 flex items-center gap-2 cursor-pointer transition-colors ${
                  selectedTrackId === track.id ? 'bg-purple-600/10' : 'hover:bg-gray-800/20'
                }`}
              >
                {/* Type icon */}
                <span className="text-sm">{TRACK_ICONS[track.type] || '📋'}</span>

                {/* Add Item Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setAddItemBtnRect(rect);
                    setAddItemTrackId(addItemTrackId === track.id ? null : track.id);
                  }}
                  className="p-0.5 rounded text-gray-600 hover:text-purple-400 hover:bg-purple-600/10 transition-colors shrink-0"
                  title={`Add ${track.type} item at playhead`}
                >
                  <Plus size={12} />
                </button>

                {/* Track name */}
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-gray-300 truncate">{track.name}</div>
                  <div className="text-[9px] text-gray-600">{track.type}</div>
                </div>

                {/* Mute / Solo / Delete */}
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); handleToggleSolo(track.id); }}
                    className={`p-0.5 rounded text-[9px] font-bold ${track.solo ? 'bg-yellow-600/30 text-yellow-400' : 'text-gray-600 hover:text-yellow-400'}`}
                    title="Solo"
                  >S</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleToggleMute(track.id); }}
                    className={`p-0.5 rounded ${track.muted ? 'text-red-400' : 'text-gray-600 hover:text-gray-300'}`}
                    title="Mute"
                  >
                    {track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteTrack(track.id); }}
                    className="p-0.5 text-gray-600 hover:text-red-400"
                    title="Delete Track"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}

            {/* Empty state */}
            {trackItems.length === 0 && (
              <div className="p-4 text-center">
                <div className="text-xs text-gray-600">No tracks</div>
                <div className="text-[10px] text-gray-700 mt-1">Use the buttons above to add tracks</div>
              </div>
            )}
          </div>

          {/* Timeline body */}
          <div
            ref={timelineRef}
            className="flex-1 overflow-auto"
            onMouseDown={(e) => {
              if ((e.target as HTMLElement).closest('[data-timeline-item]')) return;
              handleTimelineScroll(e);
            }}
            onWheel={handleTimelineWheel}
            onClick={handleTimelineClick}
          >
            <div
              className="relative"
              style={{
                width: timelineWidth,
                minWidth: '100%',
                cursor: 'crosshair',
              }}
            >
              {/* Track rows */}
              {trackItems.map((track, tIdx) => (
                <div
                  key={track.id}
                  className="relative border-b border-gray-800/20"
                  style={{
                    height: TRACK_HEIGHT,
                    backgroundColor: tIdx % 2 === 0 ? '#0a0a0f' : '#0d0d12',
                    opacity: track.muted ? 0.4 : 1,
                  }}
                >
                  {/* Waveform canvas for audio tracks */}
                  {track.type === 'audio' && (
                    <canvas
                      ref={(el) => {
                        if (el) audioCanvasRefs.current.set(track.id, el);
                        else audioCanvasRefs.current.delete(track.id);
                      }}
                      className="absolute inset-0 pointer-events-none"
                      style={{ width: '100%', height: '100%' }}
                    />
                  )}
                  {/* Items on this track */}
                  {track.items.map((item) => {
                    const previewItem = draggingItem?.itemId === item.id
                      ? { ...item, startTime: draggingItem.origStartTime }
                      : resizingItem?.itemId === item.id
                      ? { ...item, startTime: resizingItem.origStartTime, duration: resizingItem.origDuration }
                      : item;

                    const color = TRACK_COLORS[track.type] || '#6b7280';
                    const left = pctLeft(previewItem.startTime);
                    const widthPx = Math.max(4, (previewItem.duration / effectiveDuration) * 100);
                    const isEditing = editingItemId === item.id;

                    const resourceName = (() => {
                      if (track.type === 'scene') return scenes.find((s) => s.id === item.resourceId)?.name || item.name;
                      if (track.type === 'chaser') return chasers.find((c) => c.id === item.resourceId)?.name || item.name;
                      return item.name;
                    })();

                    return (
                      <div
                        key={item.id}
                        data-timeline-item="true"
                        className="absolute top-1 rounded-md cursor-pointer group transition-shadow"
                        style={{
                          left,
                          width: `${widthPx}%`,
                          height: TRACK_HEIGHT - 8,
                          backgroundColor: `${color}20`,
                          border: `1px solid ${color}40`,
                          boxShadow: isEditing ? `0 0 12px ${color}40` : undefined,
                        }}
                        onMouseDown={(e) => handleItemDragStart(e, item.id, track.id)}
                        onDoubleClick={(e) => { e.stopPropagation(); handleItemDoubleClick(item); }}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setContextMenu({ x: e.clientX, y: e.clientY, itemId: item.id });
                        }}
                      >
                        {/* Fade in/out indicators */}
                        {item.fadeIn > 0 && widthPx > 1 && (
                          <div
                            className="absolute top-0 left-0 h-full pointer-events-none"
                            style={{
                              width: `${Math.min(widthPx * 0.3, (item.fadeIn / effectiveDuration) * 100)}%`,
                              background: `linear-gradient(to right, ${color}40, transparent)`,
                              borderRadius: '4px 0 0 4px',
                            }}
                          />
                        )}
                        {item.fadeOut > 0 && widthPx > 1 && (
                          <div
                            className="absolute top-0 right-0 h-full pointer-events-none"
                            style={{
                              width: `${Math.min(widthPx * 0.3, (item.fadeOut / effectiveDuration) * 100)}%`,
                              background: `linear-gradient(to left, ${color}40, transparent)`,
                              borderRadius: '0 4px 4px 0',
                            }}
                          />
                        )}

                        {/* Label */}
                        <div className="px-2 py-0.5 text-[9px] text-gray-300 truncate select-none" title={resourceName}>
                          {resourceName}
                        </div>
                        <div className="px-2 text-[8px] text-gray-500 select-none">
                          {fmtTime(item.fadeIn)} / {fmtTime(item.fadeOut)}
                        </div>

                        {/* Resize handles */}
                        <div
                          className="absolute top-0 left-0 w-2 h-full cursor-w-resize opacity-0 group-hover:opacity-100 z-10"
                          onMouseDown={(e) => handleItemResizeStart(e, item.id, track.id, 'left')}
                          style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                        />
                        <div
                          className="absolute top-0 right-0 w-2 h-full cursor-e-resize opacity-0 group-hover:opacity-100 z-10"
                          onMouseDown={(e) => handleItemResizeStart(e, item.id, track.id, 'right')}
                          style={{ backgroundColor: 'rgba(255,255,255,0.05)' }}
                        />
                      </div>
                    );
                  })}
                </div>
              ))}

              {/* Playhead */}
              <div
                className="absolute top-0 w-0.5 bg-red-500 pointer-events-none z-20"
                style={{
                  left: pctLeft(playheadTime),
                  height: trackItems.length * TRACK_HEIGHT,
                  boxShadow: '0 0 8px rgba(239,68,68,0.5)',
                }}
              >
                <div
                  className="w-0 h-0"
                  style={{
                    borderLeft: '5px solid transparent',
                    borderRight: '5px solid transparent',
                    borderTop: '6px solid #ef4444',
                    position: 'absolute',
                    top: -6,
                    left: -6,
                  }}
                />
              </div>

              {/* Empty timeline */}
              {trackItems.length === 0 && (
                <div className="h-[200px] flex items-center justify-center text-gray-700 text-xs">
                  Add tracks to start building your show
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Context Menu ── */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 bg-[#1a1a28] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[160px]"
            style={{ left: Math.min(contextMenu.x, window.innerWidth - 180), top: Math.min(contextMenu.y, window.innerHeight - 180) }}
          >
            <div className="px-3 py-1.5 text-[10px] text-gray-500 uppercase tracking-wider">Item</div>
            <button
              onClick={() => {
                const item = selectedShow?.tracks.flatMap((t) => t.items).find((it) => it.id === contextMenu.itemId);
                if (item) handleItemDoubleClick(item);
                setContextMenu(null);
              }}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-purple-600/20 flex items-center gap-2"
            >
              <Edit2 size={12} /> Edit Properties
            </button>
            <button
              onClick={() => handleDeleteItem(contextMenu.itemId)}
              className="w-full text-left px-3 py-1.5 text-xs text-red-300 hover:bg-red-600/20 flex items-center gap-2"
            >
              <Trash2 size={12} /> Delete Item
            </button>
          </div>
        </>
      )}

      {/* ── Add Item Popover ── */}
      {addItemTrackId && addItemBtnRect && (() => {
        const track = trackItems.find((t) => t.id === addItemTrackId);
        if (!track) return null;
        const resources = (() => {
          if (track.type === 'scene') return scenes.map((s) => ({ id: s.id, name: s.name, duration: s.duration }));
          if (track.type === 'chaser') return chasers.map((c) => {
            const totalCycle = c.steps.reduce((sum, s) => sum + s.fadeIn + s.hold + s.fadeOut, 0);
            return { id: c.id, name: c.name, duration: totalCycle || 10000 };
          });
          if (track.type === 'audio') return songPresets.map((p) => ({ id: p.id, name: p.audioFileName || p.name, duration: 30000, audioFileBase64: p.audioFileBase64 }));
          if (track.type === 'efx') return effects.map((e) => ({ id: e.id, name: e.name, duration: 4000 }));
          return [];
        })();
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setAddItemTrackId(null)} />
            <div
              className="fixed z-50 bg-[#1a1a28] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px] max-h-[300px] overflow-y-auto"
              style={{
                left: Math.min(addItemBtnRect.left, window.innerWidth - 200),
                top: Math.min(addItemBtnRect.bottom + 4, window.innerHeight - 320),
              }}
            >
              <div className="px-3 py-1.5 text-[10px] text-gray-500 uppercase tracking-wider">
                Add {track.type} at {fmtTime(playheadTime)}
              </div>
              {resources.length === 0 ? (
                <div className="px-3 py-2 text-[10px] text-gray-600">
                  No {track.type === 'efx' ? 'EFX effects' : track.type} available
                </div>
              ) : (
                resources.map((res) => (
                  <button
                    key={res.id}
                    onClick={() => handleAddItemToTrack(track.id, res.id, res.name, (res as any).duration, (res as any).audioFileBase64)}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-purple-600/20 flex items-center gap-2 transition-colors"
                  >
                    <span className="text-sm">{TRACK_ICONS[track.type] || '📋'}</span>
                    <span className="truncate">{res.name}</span>
                  </button>
                ))
              )}
              {track.type === 'audio' && (
                <button
                  onClick={async () => {
                    const result = await window.lightMaestro.audio.importFile();
                    if (!result) return;
                    // Decode to get real duration
                    let dur = 60000; // fallback
                    try {
                      // Use fetch+AudioContext (shared) for robust cross-browser decode
                      const buffer = await getAudioBuffer(result.dataUrl);
                      dur = Math.round(buffer.duration * 1000);
                    } catch (e) { console.error('Failed to decode audio duration:', e); }
                    handleAddItemToTrack(track.id, 'local-' + Date.now(), result.fileName, dur, result.dataUrl);
                  }}
                  className="w-full text-left px-3 py-1.5 text-xs text-purple-300 hover:bg-purple-600/20 flex items-center gap-2 transition-colors border-t border-gray-700/50"
                >
                  <span className="text-sm">📂</span>
                  <span>Load audio file...</span>
                </button>
              )}
            </div>
          </>
        );
      })()}

      {/* ── Edit Item Modal ── */}
      {editingItemId && (() => {
        const item = selectedShow?.tracks.flatMap((t) => t.items).find((it) => it.id === editingItemId);
        if (!item) return null;
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={() => setEditingItemId(null)}>
            <div className="bg-[#12121a] border border-gray-700 rounded-xl shadow-2xl w-80" onClick={(e) => e.stopPropagation()}>
              <div className="px-5 py-3 border-b border-gray-800/50 flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">Edit Item</h3>
                <button onClick={() => setEditingItemId(null)} className="text-gray-600 hover:text-gray-400">✕</button>
              </div>
              <div className="p-5 space-y-4">
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">Name</label>
                  <input type="text" value={editItemName} onChange={(e) => setEditItemName(e.target.value)}
                    className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">Fade In (ms)</label>
                  <input type="number" value={editItemFadeIn} onChange={(e) => setEditItemFadeIn(Number(e.target.value))}
                    min={0} className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">Fade Out (ms)</label>
                  <input type="number" value={editItemFadeOut} onChange={(e) => setEditItemFadeOut(Number(e.target.value))}
                    min={0} className="w-full mt-1 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300" />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500 uppercase tracking-wider">Resource</label>
                  <div className="text-xs text-gray-500 mt-1 bg-gray-800/30 rounded px-2 py-1.5">
                    {item.resourceId} ({item.name})
                  </div>
                </div>
                <div className="text-[10px] text-gray-600">
                  Start: {fmtTime(item.startTime)} · Duration: {fmtTime(item.duration)}
                </div>
              </div>
              <div className="px-5 py-3 border-t border-gray-800/50 flex justify-end gap-2">
                <button onClick={() => setEditingItemId(null)} className="px-4 py-1.5 bg-gray-800/50 text-gray-400 rounded text-xs hover:bg-gray-700/50">Cancel</button>
                <button onClick={handleSaveItemEdit} className="px-4 py-1.5 bg-purple-600/30 text-purple-300 rounded text-xs font-medium hover:bg-purple-600/50">Save</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Track Resource Drop Zone ── */}
      {selectedTrackId && (() => {
        const selTrack = selectedShow?.tracks.find((t) => t.id === selectedTrackId);
        return (
        <div className="h-32 border-t border-gray-800/50 bg-[#0d0d14] p-3 overflow-y-auto shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">
              Add to {selTrack?.name || 'Track'}
            </span>
            <button onClick={() => setSelectedTrackId(null)} className="text-gray-600 hover:text-gray-400">
              <X size={14} />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {selTrack?.type === 'scene' && scenes.map((scene) => (
              <button
                key={scene.id}
                onClick={() => handleAddItemToTrack(selectedTrackId, scene.id, scene.name, scene.duration)}
                className="px-3 py-1.5 rounded-lg text-xs bg-purple-600/10 border border-purple-500/20 text-purple-300 hover:bg-purple-600/20 transition-colors"
              >
                🎬 {scene.name}
              </button>
            ))}
            {selTrack?.type === 'chaser' && chasers.map((chaser) => {
              const totalCycle = chaser.steps.reduce((sum, s) => sum + s.fadeIn + s.hold + s.fadeOut, 0);
              return (
              <button
                key={chaser.id}
                onClick={() => handleAddItemToTrack(selectedTrackId, chaser.id, chaser.name, totalCycle || 10000)}
                className="px-3 py-1.5 rounded-lg text-xs bg-green-600/10 border border-green-500/20 text-green-300 hover:bg-green-600/20 transition-colors"
              >
                🎞️ {chaser.name}
              </button>
            )})}
            {selTrack?.type === 'audio' && songPresets.map((p) => (
              <button
                key={p.id}
                onClick={() => handleAddItemToTrack(selectedTrackId, p.id, p.audioFileName || p.name, 30000, p.audioFileBase64)}
                className="px-3 py-1.5 rounded-lg text-xs bg-blue-600/10 border border-blue-500/20 text-blue-300 hover:bg-blue-600/20 transition-colors"
              >
                🎵 {p.audioFileName || p.name}
              </button>
            ))}
            {selTrack?.type === 'efx' && effects.map((efx) => (
              <button
                key={efx.id}
                onClick={() => handleAddItemToTrack(selectedTrackId, efx.id, efx.name, 4000)}
                className="px-3 py-1.5 rounded-lg text-xs bg-cyan-600/10 border border-cyan-500/20 text-cyan-300 hover:bg-cyan-600/20 transition-colors"
              >
                <Crosshair size={12} className="inline mr-1" /> {efx.name}
              </button>
            ))}
            {(!selTrack || (selTrack.type === 'scene' && scenes.length === 0) || (selTrack.type === 'chaser' && chasers.length === 0) || (selTrack.type === 'audio' && songPresets.length === 0) || (selTrack.type === 'efx' && effects.length === 0)) && (
              <span className="text-xs text-gray-600">No {selTrack?.type === 'efx' ? 'EFX effects' : selTrack?.type || 'resources'} available. Create them in the Configuration tab first.</span>
            )}
          </div>
        </div>
      )})()}
    </div>
  );
};
