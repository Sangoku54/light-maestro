import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Sparkles, Play, Square, Palette, Move, Sun, Zap } from 'lucide-react';
import { useShowStore } from '../stores/showStore';
import { loadFixtureDefinitions, type DmxFixtureDefinition } from '../hooks/dmx-cues';
import { generateLoopLibrary, materializeAutoLoops, purgeAutoLoops, LOOP_KIND_LABEL, LOOP_KIND_ORDER, type AutoLoop, type AutoLoopKind } from '../engine/auto-loops';
import { midiPlayChaser, midiStopChaser } from '../engine/midi-actions';

const KIND_META: Record<AutoLoopKind, { icon: React.ReactNode; label: string; accent: string }> = {
  'color-chase': { icon: <Palette className="w-4 h-4" />, label: 'Couleur', accent: 'text-purple-400' },
  movement: { icon: <Move className="w-4 h-4" />, label: 'Mouvement', accent: 'text-cyan-400' },
  'dimmer-pulse': { icon: <Sun className="w-4 h-4" />, label: 'Ambiance', accent: 'text-amber-400' },
  strobe: { icon: <Zap className="w-4 h-4" />, label: 'Strobe', accent: 'text-rose-400' },
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
    return generateLoopLibrary(patchedFixtures, fixtureDefs, { count: DEFAULT_COUNT, seed });
  }, [patchedFixtures, fixtureDefs, seed]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return library.filter((l) => {
      if (filter !== 'all' && l.kind !== filter) return false;
      if (q && !l.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [library, filter, search]);

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
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-400" />
          <h2 className="text-sm font-semibold text-gray-200">{t('sidebar.autoLoops') || 'Loops auto'}</h2>
          <span className="text-[10px] text-gray-500 bg-gray-800 rounded-full px-2 py-0.5">
            {library.length}
          </span>
        </div>
        <button
          onClick={handleRegenerate}
          title={t('regenerate') || 'Régénérer la bibliothèque'}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 text-xs font-medium transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Régénérer
        </button>
      </div>

      {/* Filter + search */}
      <div className="flex items-center gap-1.5 px-3 pt-2 shrink-0 flex-wrap">
        <button
          onClick={() => setFilter('all')}
          className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${filter === 'all' ? 'bg-purple-600/30 text-purple-300' : 'bg-gray-800/50 text-gray-500 hover:text-gray-300'}`}
        >
          Toutes
        </button>
        {LOOP_KIND_ORDER.map((k) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${filter === k ? 'bg-purple-600/30 text-purple-300' : 'bg-gray-800/50 text-gray-500 hover:text-gray-300'}`}
          >
            {LOOP_KIND_LABEL[k]}
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

      {/* Library grouped by category */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
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
          Cliquer une carte joue le loop sur les fixtures patchées · « Régénérer » produit un nouveau set
        </p>
      </div>
    </div>
  );
};
