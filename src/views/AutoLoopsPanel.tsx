import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Play, Square, Save, Trash2, Check } from 'lucide-react';
import { useShowStore } from '../stores/showStore';
import { loadFixtureDefinitions, type DmxFixtureDefinition } from '../hooks/dmx-cues';
import {
  generateAmbianceLoops,
  computeLoopDmxCues,
  getAmbianceProfile,
  type AmbianceLoop,
} from '../engine/ambiance-loops';
import TrackTimeline from './TrackTimeline';
import { dmxBridge } from '../utils/dmx-bridge';

const AMBIANCE_ICON: Record<string, string> = {
  energetic: '⚡',
  dark: '🌑',
  uplifting: '🌅',
  dreamy: '🌙',
  aggressive: '🔥',
  groovy: '🕺',
  epic: '🏔️',
};

/**
 * AutoLoopsPanel — the ambiance-loop library. Generates 7 fixture-driven
 * lighting loops (one per ambiance), each a 16-measure cue timeline classified
 * by mood. Selecting a loop renders the same timeline visual as the autoscript
 * (TrackTimeline) — without audio. Loops can be saved and recalled later from a
 * Performance widget.
 */
export const AutoLoopsPanel: React.FC = () => {
  const { t } = useTranslation();
  const patchedFixtures = useShowStore((s) => s.patchedFixtures);
  const universes = useShowStore((s) => s.universes);
  const autoLoops = useShowStore((s) => s.autoLoops);
  const addAutoLoop = useShowStore((s) => s.addAutoLoop);
  const deleteAutoLoop = useShowStore((s) => s.deleteAutoLoop);

  const [fixtureDefs, setFixtureDefs] = useState<Map<string, DmxFixtureDefinition>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const rafRef = useRef<number>(0);

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

  const loops = useMemo<AmbianceLoop[]>(() => generateAmbianceLoops(patchedFixtures), [patchedFixtures]);
  const selected = loops.find((l) => l.id === selectedId) ?? loops[0] ?? null;

  const stopPlay = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    setPlayingId(null);
    dmxBridge.release('vc');
  }, []);

  // Stop preview playback on unmount.
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      dmxBridge.release('vc');
    };
  }, []);

  const playLoop = (loop: AmbianceLoop) => {
    if (playingId === loop.id) {
      stopPlay();
      return;
    }
    stopPlay();
    const universeIds = universes.map((u) => u.id);
    const dmxCues = computeLoopDmxCues(loop, patchedFixtures, fixtureDefs, universeIds);
    if (dmxCues.length === 0) return;
    const duration = loop.duration;
    let passStart = performance.now();
    let fired = new Set<string>();
    let first = true;
    const fire = () => {
      if (first) {
        first = false;
        dmxBridge.release('vc');
      }
      let elapsed = (performance.now() - passStart) / 1000;
      if (elapsed >= duration) {
        // Start a new pass (loop).
        passStart = performance.now();
        fired = new Set();
        elapsed = 0;
        dmxBridge.release('vc');
      }
      for (const cue of dmxCues) {
        const key = `${cue.time.toFixed(2)}-${cue.universe}`;
        if (fired.has(key)) continue;
        if (elapsed >= cue.time && Object.keys(cue.channelValues || {}).length > 0) {
          fired.add(key);
          try { dmxBridge.write('vc', cue.universe, cue.channelValues); } catch {}
        }
      }
      rafRef.current = requestAnimationFrame(fire);
    };
    fire();
    setPlayingId(loop.id);
  };

  const handleSave = () => {
    if (!selected) return;
    const profile = getAmbianceProfile(selected.ambiance);
    addAutoLoop({
      name: `${profile.labelFr} · ${selected.bpm} BPM`,
      ambiance: selected.ambiance,
      bpm: selected.bpm,
      measures: selected.measures,
      duration: selected.duration,
      sections: selected.sections,
      cues: selected.cues,
    });
    setSavedFlash(selected.id);
    window.setTimeout(() => setSavedFlash(null), 1500);
  };

  if (patchedFixtures.length === 0) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-gray-500">
          <Sparkles className="w-8 h-8 text-gray-600" />
          <p className="text-sm">Aucune fixture patchée.</p>
          <p className="text-xs text-gray-600">
            Patch des fixtures dans l'onglet Setup pour générer des boucles d'ambiance.
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
          <h2 className="text-sm font-semibold text-gray-200">{t('sidebar.autoLoops') || 'Boucles d’ambiance'}</h2>
          <span className="text-[10px] text-gray-500 bg-gray-800 rounded-full px-2 py-0.5">{loops.length}</span>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Ambiance list */}
        <div className="w-48 shrink-0 overflow-y-auto border-r border-gray-800 p-2 space-y-1.5">
          {loops.map((loop) => {
            const profile = getAmbianceProfile(loop.ambiance);
            const active = selected?.id === loop.id;
            return (
              <button
                key={loop.id}
                onClick={() => {
                  setSelectedId(loop.id);
                  if (playingId) stopPlay();
                }}
                className={
                  'w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border text-left transition-colors ' +
                  (active
                    ? 'border-purple-500/40 bg-purple-600/15 text-gray-100'
                    : 'border-gray-800 bg-gray-900/40 text-gray-300 hover:border-gray-700 hover:bg-gray-900/70')
                }
              >
                <span className="text-base leading-none">{AMBIANCE_ICON[loop.ambiance] ?? '✨'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium truncate">{profile.labelFr}</span>
                  <span className="block text-[10px] text-gray-500 truncate">
                    {loop.bpm} BPM · {loop.measures} mes.
                  </span>
                </span>
                <span className="flex shrink-0 -space-x-1">
                  {profile.palette.slice(0, 4).map((c, i) => (
                    <span key={i} className="w-2.5 h-2.5 rounded-full border border-black/40" style={{ backgroundColor: c }} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>

        {/* Timeline + actions */}
        <div className="flex-1 min-w-0 flex flex-col">
          {selected && (
            <>
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-800 shrink-0">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-200 truncate">
                    {getAmbianceProfile(selected.ambiance).labelFr}
                  </div>
                  <div className="text-[10px] text-gray-500">
                    {selected.bpm} BPM · 16 mesures virtuelles · {selected.cues.length} cues ·{' '}
                    {selected.fixtureCount} fixtures
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => playLoop(selected)}
                    className={
                      'flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ' +
                      (playingId === selected.id
                        ? 'bg-purple-600 text-white'
                        : 'bg-gray-800 text-gray-200 hover:bg-purple-600/30 hover:text-purple-200')
                    }
                  >
                    {playingId === selected.id ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    {playingId === selected.id ? 'Arrêter' : 'Jouer'}
                  </button>
                  <button
                    onClick={handleSave}
                    className={
                      'flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ' +
                      (savedFlash === selected.id
                        ? 'bg-green-600/20 text-green-300'
                        : 'bg-purple-600/20 text-purple-300 hover:bg-purple-600/30')
                    }
                  >
                    {savedFlash === selected.id ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                    {savedFlash === selected.id ? 'Enregistré' : 'Enregistrer'}
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-auto px-3 py-2">
                <TrackTimeline
                  cues={selected.cues as any}
                  duration={selected.duration}
                  currentTime={0}
                  onSeek={() => {}}
                  sections={selected.sections}
                  patchedFixtures={patchedFixtures}
                  bpm={selected.bpm}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Saved loops */}
      {autoLoops.length > 0 && (
        <div className="shrink-0 border-t border-gray-800 px-3 py-2">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">
            Boucles enregistrées ({autoLoops.length})
          </div>
          <div className="flex flex-wrap gap-1.5">
            {autoLoops.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-800/60 border border-gray-700 text-xs text-gray-300"
              >
                <span className="truncate max-w-[160px]">{a.name}</span>
                <button
                  onClick={() => deleteAutoLoop(a.id)}
                  title="Supprimer"
                  className="text-gray-500 hover:text-rose-400 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
