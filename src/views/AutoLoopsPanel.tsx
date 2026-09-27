import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Sparkles, Play, Square, Palette, Move, Sun, Zap, Disc, Aperture, Gem, ZoomIn, Snowflake, Crosshair } from 'lucide-react';
import { useShowStore } from '../stores/showStore';
import { useAppStore } from '../stores/appStore';
import { loadFixtureDefinitions, type DmxFixtureDefinition } from '../hooks/dmx-cues';
import { generateLoopLibrary, materializeAutoLoops, purgeAutoLoops, LOOP_KIND_LABEL, LOOP_KIND_ORDER, type AutoLoop, type AutoLoopKind } from '../engine/auto-loops';
import { midiPlayChaser, midiStopChaser } from '../engine/midi-actions';
import { AutoLoopBanks } from '../components/AutoLoopBanks';
import { Stage3D } from './Stage3D';
import { Maximize2, X } from 'lucide-react';

const KIND_META: Record<AutoLoopKind, { icon: React.ReactNode; label: string; accent: string }> = {
  'color-chase': { icon: <Palette className="w-4 h-4" />, label: 'Couleur', accent: 'text-purple-400' },
  movement: { icon: <Move className="w-4 h-4" />, label: 'Mouvement', accent: 'text-cyan-400' },
  'dimmer-pulse': { icon: <Sun className="w-4 h-4" />, label: 'Ambiance', accent: 'text-amber-400' },
  strobe: { icon: <Zap className="w-4 h-4" />, label: 'Strobe', accent: 'text-rose-400' },
  'color-wheel': { icon: <Disc className="w-4 h-4" />, label: 'Roue couleur', accent: 'text-fuchsia-400' },
  gobo: { icon: <Aperture className="w-4 h-4" />, label: 'Gobo', accent: 'text-emerald-400' },
  effect: { icon: <Sparkles className="w-4 h-4" />, label: 'Effet', accent: 'text-indigo-400' },
  prism: { icon: <Gem className="w-4 h-4" />, label: 'Prisme', accent: 'text-sky-400' },
  'beam-zoom': { icon: <ZoomIn className="w-4 h-4" />, label: 'Zoom', accent: 'text-teal-400' },
  'beam-frost': { icon: <Snowflake className="w-4 h-4" />, label: 'Frost', accent: 'text-blue-300' },
  'beam-iris': { icon: <Aperture className="w-4 h-4" />, label: 'Iris', accent: 'text-violet-400' },
  'beam-focus': { icon: <Crosshair className="w-4 h-4" />, label: 'Focus', accent: 'text-lime-400' },
  'laser-pattern': { icon: <Aperture className="w-4 h-4" />, label: 'Motif laser', accent: 'text-red-400' },
  'laser-scan': { icon: <Move className="w-4 h-4" />, label: 'Balayage laser', accent: 'text-orange-400' },
  'laser-color': { icon: <Disc className="w-4 h-4" />, label: 'Couleur laser', accent: 'text-pink-400' },
};

const DIR_LABEL: Record<AutoLoop['direction'], string> = {
  forward: '→',
  backward: '←',
  bounce: '↔',
};

/** How many loops to generate per batch. */
const DEFAULT_COUNT = 36;

/**
 * AutoLoopsPanel — the "LoopAuto"-style library. Generates a near-infinite,
 * seeded catalog of loop variations from the patched fixtures. Each card
 * materializes the loop into a playable chaser and starts it on click.
 */
export const AutoLoopsPanel: React.FC = () => {
  const { t } = useTranslation();
  const patchedFixtures = useShowStore((s) => s.patchedFixtures);
  const [fixtureDefs, setFixtureDefs] = useState<Map<string, DmxFixtureDefinition>>(new Map());
  const [seed, setSeed] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | AutoLoopKind>('all');
  const [search, setSearch] = useState('');
  const [show3D, setShow3D] = useState(true);
  const [showFloating3D, setShowFloating3D] = useState(false);
  const [float3DPos, setFloat3DPos] = useState({ x: 100, y: 80 });
  const [float3DSize, setFloat3DSize] = useState({ w: 960, h: 540 });
  const float3DDragRef = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null);
  const float3DResizeRef = useRef<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const handleFloat3DDragStart = useCallback((e: React.MouseEvent) => {
    float3DDragRef.current = { startX: e.clientX, startY: e.clientY, startLeft: float3DPos.x, startTop: float3DPos.y };
    const onMove = (ev: MouseEvent) => {
      if (!float3DDragRef.current) return;
      setFloat3DPos({ x: Math.max(0, Math.min(float3DDragRef.current.startLeft + ev.clientX - float3DDragRef.current.startX, window.innerWidth - 120)), y: Math.max(0, Math.min(float3DDragRef.current.startTop + ev.clientY - float3DDragRef.current.startY, window.innerHeight - 40)) });
    };
    const onUp = () => { float3DDragRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [float3DPos]);
  const handleFloat3DResizeStart = useCallback((e: React.MouseEvent) => {
    float3DResizeRef.current = { startX: e.clientX, startY: e.clientY, startW: float3DSize.w, startH: float3DSize.h };
    const onMove = (ev: MouseEvent) => {
      if (!float3DResizeRef.current) return;
      setFloat3DSize({ w: Math.max(320, float3DResizeRef.current.startW + ev.clientX - float3DResizeRef.current.startX), h: Math.max(200, float3DResizeRef.current.startH + ev.clientY - float3DResizeRef.current.startY) });
    };
    const onUp = () => { float3DResizeRef.current = null; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [float3DSize]);

  // Chaser ids currently playing (exclusive playback — one loop at a time).
  const launchedRef = useRef<Set<string>>(new Set());

  // Stable patch signature — invalidates playback when the patch changes.
  const patchKey = useMemo(
    () =>
      patchedFixtures
        .map((f) => `${f.id}|${f.tier}|${f.enabled === false ? 0 : 1}|${f.fixtureDefId}|${f.startAddress}`)
        .join(';'),
    [patchedFixtures],
  );

  // Load fixture definitions for the patched fixtures.
  useEffect(() => {
    if (patchedFixtures.length === 0) {
      setFixtureDefs(new Map());
      return;
    }
    let cancelled = false;
    const ids = [...new Set(patchedFixtures.map((f) => f.fixtureDefId))];
    loadFixtureDefinitions(ids)
      .then((defs) => {
        if (!cancelled) setFixtureDefs(defs);
      })
      .catch(() => {
        if (!cancelled) setFixtureDefs(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [patchedFixtures]);

  const stopAll = useCallback(() => {
    for (const id of launchedRef.current) midiStopChaser(id);
    launchedRef.current.clear();
    setPlayingId(null);
  }, []);

  const purgeStore = useCallback(() => {
    purgeAutoLoops(useShowStore.getState());
  }, []);

  // Le panneau ne démonte jamais (display:none dans QuickShowView) : quand on
  // quitte l'onglet Loops, la carte en cours doit s'arrêter ET s'éteindre
  // (midiStopChaser flush les zéros), sinon la scène persiste sans contrôle.
  const loopsTab = useAppStore((s) => s.quickSidebarTab);
  const stopAllRef = useRef(stopAll);
  stopAllRef.current = stopAll;
  useEffect(() => {
    if (loopsTab !== 'loops') stopAllRef.current();
  }, [loopsTab]);

  // On patch change: stop playback and purge stale materialized loops.
  useEffect(() => {
    stopAll();
    purgeStore();
  }, [patchKey, stopAll, purgeStore]);

  // On unmount: stop any playing loop and clean up the transient chaser.
  useEffect(() => {
    return () => {
      stopAll();
      purgeStore();
    };
  }, [stopAll, purgeStore]);

  const library = useMemo<AutoLoop[]>(() => {
    if (patchedFixtures.length === 0 || fixtureDefs.size === 0) return [];
    // Positions pour le zéro pan/tilt : chaque tête oscille autour de son tare.
    return generateLoopLibrary(patchedFixtures, fixtureDefs, {
      count: DEFAULT_COUNT,
      seed,
      positions: useShowStore.getState().fixturePositions,
    });
  }, [patchedFixtures, fixtureDefs, seed, patchKey]);

  const counts = useMemo(() => {
    const map = new Map<AutoLoopKind, number>();
    for (const l of library) map.set(l.kind, (map.get(l.kind) ?? 0) + 1);
    return map;
  }, [library]);

  // Filtres « intelligents » : seuls les kinds RÉELLEMENT présents sont
  // proposés (avec leur compte) — plus de bouton de filtre qui mène à une
  // liste vide.
  const availableKinds = useMemo(
    () => LOOP_KIND_ORDER.filter((k) => (counts.get(k) ?? 0) > 0),
    [counts],
  );
  const effectiveFilter = filter !== 'all' && (counts.get(filter) ?? 0) === 0 ? 'all' : filter;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return library.filter((l) => {
      if (effectiveFilter !== 'all' && l.kind !== effectiveFilter) return false;
      if (q && !l.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [library, effectiveFilter, search]);

  const grouped = useMemo(
    () =>
      LOOP_KIND_ORDER
        .map((k) => [k, filtered.filter((l) => l.kind === k)] as [AutoLoopKind, AutoLoop[]])
        .filter(([, arr]) => arr.length > 0),
    [filtered],
  );

  const handleToggle = (loop: AutoLoop) => {
    // Exclusive playback: stop + purge the previous loop before starting a new one.
    if (playingId === loop.id) {
      stopAll();
      purgeStore();
      return;
    }
    stopAll();
    purgeStore();
    const store = useShowStore.getState();
    const [chaserId] = materializeAutoLoops([loop], store);
    if (!chaserId) return;
    launchedRef.current.add(chaserId);
    midiPlayChaser(chaserId);
    setPlayingId(loop.id);
  };

  const handleRegenerate = () => {
    stopAll();
    purgeStore();
    setSeed((s) => (s + 1) % 100000);
  };

  if (patchedFixtures.length === 0) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-gray-500">
          <Sparkles className="w-8 h-8 text-gray-600" />
          <p className="text-sm">Aucune fixture patchée.</p>
          <p className="text-xs text-gray-600">
            Patch des fixtures dans l'onglet Setup pour générer des loops automatiques.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col relative">
      {/* Boucles auto — banques 4×32 + lecture quantifiée */}
      <AutoLoopBanks />

      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-400" />
          <h2 className="text-sm font-semibold text-gray-200">Scènes pré-programmées</h2>
          <span className="text-[10px] text-gray-500 bg-gray-800 rounded-full px-2 py-0.5">
            {library.length}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShow3D(v => !v)}
            title={show3D ? t('stage3D.hide') : t('stage3D.show')}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${show3D ? 'bg-cyan-600/20 text-cyan-300 border border-cyan-500/30' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
          >
            <Maximize2 className="w-3.5 h-3.5" />
            Vue 3D
          </button>
          <button
            onClick={handleRegenerate}
            title={t('regenerate') || 'Régénérer la bibliothèque'}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 text-xs font-medium transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Régénérer
          </button>
        </div>
      </div>

      {/* Filter + search */}
      <div className="flex items-center gap-1.5 px-3 pt-2 shrink-0 flex-wrap">
        <button
          onClick={() => setFilter('all')}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${effectiveFilter === 'all' ? 'bg-purple-600/30 text-purple-300' : 'bg-gray-800/50 text-gray-500 hover:text-gray-300'}`}
        >
          Toutes <span className="text-[9px] opacity-60">{library.length}</span>
        </button>
        {availableKinds.map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${effectiveFilter === k ? 'bg-purple-600/30 text-purple-300' : 'bg-gray-800/50 text-gray-500 hover:text-gray-300'}`}
          >
            {LOOP_KIND_LABEL[k]}{' '}
            <span className="text-[9px] opacity-60">{counts.get(k) ?? 0}</span>
          </button>
        ))}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher…"
          className="ml-auto w-36 px-2 py-1 bg-gray-800/50 border border-gray-700 rounded text-xs text-gray-300 placeholder:text-gray-600"
        />
      </div>

      {/* Library + Vue 3D */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        <div className="flex-1 overflow-y-auto p-3 space-y-4 min-w-0">
          {grouped.map(([kind, arr]) => (
            <section key={kind}>
              <div className="flex items-center gap-2 mb-1.5">
                <span className={KIND_META[kind].accent}>{KIND_META[kind].icon}</span>
                <h3 className="text-xs font-semibold text-gray-300">{LOOP_KIND_LABEL[kind]}</h3>
                <span className="text-[10px] text-gray-600">{arr.length}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {arr.map((loop) => {
                  const meta = KIND_META[loop.kind];
                  const active = playingId === loop.id;
                  return (
                    <div
                      key={loop.id}
                      className="group flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-gray-800 bg-gray-900/40 hover:border-gray-700 hover:bg-gray-900/70 transition-colors"
                    >
                      <div className={`shrink-0 ${meta.accent}`}>{meta.icon}</div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-gray-200 truncate" title={loop.name}>
                          {loop.name}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-gray-500">
                          <span>{meta.label}</span>
                          <span>·</span>
                          <span>{loop.speedBpm}</span>
                          <span>{DIR_LABEL[loop.direction]}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleToggle(loop)}
                        className={
                          'shrink-0 w-8 h-8 rounded-md flex items-center justify-center transition-colors ' +
                          (active
                            ? 'bg-purple-600 text-white'
                            : 'bg-gray-800 text-gray-300 hover:bg-purple-600/30 hover:text-purple-300')
                        }
                        title={active ? t('stop') || 'Arrêter' : t('play') || 'Jouer'}
                      >
                        {active ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {filtered.length === 0 && (
            <p className="text-[10px] text-gray-600 text-center">Aucune boucle ne correspond.</p>
          )}
          <p className="text-[10px] text-gray-600 text-center pb-2">
            Cliquer une carte joue la scène sur les fixtures patchées · « Régénérer » produit un nouveau set
          </p>
        </div>
        {show3D && !showFloating3D && (
          <div className="w-[46%] shrink-0 rounded-xl overflow-hidden border border-gray-800/50 bg-[#08080e] min-h-0 h-full relative ml-2 mr-2 mb-2">
            <Stage3D />
            <div className="absolute bottom-2 right-2 z-10 flex items-center gap-1">
              <button onClick={() => setShowFloating3D(true)} title={t('stage3D.detach')} className="flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-cyan-600/80 hover:bg-cyan-500 text-white text-[11px] font-medium shadow-lg transition-all"><Maximize2 className="w-3.5 h-3.5" /> Détacher</button>
              <button onClick={() => setShow3D(false)} title={t('stage3D.hide')} className="w-7 h-7 rounded-md bg-gray-700/80 hover:bg-gray-600 text-white flex items-center justify-center"><X className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        )}
      </div>
      {show3D && showFloating3D && (
        <div className="fixed z-40 bg-black/90 rounded-xl border border-cyan-700/40 shadow-2xl flex flex-col" style={{ left: float3DPos.x, top: float3DPos.y, width: float3DSize.w, height: float3DSize.h, minWidth: 320, minHeight: 200, maxWidth: '95vw', maxHeight: '85vh', overflow: 'hidden' }}>
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#0d0d18] border-b border-gray-800 cursor-move shrink-0" onMouseDown={handleFloat3DDragStart}>
            <span className="text-[11px] text-cyan-400 font-medium">🎥 Vue 3D — Scènes pré-programmées</span>
            <div className="flex items-center gap-1">
              <button onClick={() => { setFloat3DSize({ w: 640, h: 360 }); setFloat3DPos({ x: 100, y: 80 }); }} className="text-[10px] text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded">◲</button>
              <button onClick={() => setShowFloating3D(false)} className="text-[10px] text-gray-500 hover:text-red-400 px-1.5 py-0.5 rounded">✕</button>
            </div>
          </div>
          <div className="flex-1 min-h-0 relative"><Stage3D /><div className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize" onMouseDown={handleFloat3DResizeStart} style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(6,200,255,0.4) 50%)', borderBottomRightRadius: '0.75rem' }} /></div>
        </div>
      )}
      {!show3D && (
        <button onClick={() => setShow3D(true)} title={t('stage3D.show')} className="absolute bottom-3 right-3 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-cyan-600/80 hover:bg-cyan-500 text-white text-[11px] font-medium shadow-lg transition-all"><Maximize2 className="w-3.5 h-3.5" /> Vue 3D</button>
      )}
    </div>
  );
};
