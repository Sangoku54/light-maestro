import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Play, Square, Save, Trash2, Check, Plus, X } from 'lucide-react';
import { useShowStore } from '../stores/showStore';
import { loadFixtureDefinitions, type DmxFixtureDefinition } from '../hooks/dmx-cues';
import {
  generateAmbianceLoops,
  regenerateLoopAtBpm,
  computeLoopDmxCues,
  getAmbianceProfile,
  getThemeProfile,
  AMBIANCE_PROFILES,
  THEMES,
  TEMPO_VARIANTS,
  type AmbianceLoop,
} from '../engine/ambiance-loops';
import TrackTimeline, {
  type EfxTrackEntry,
  type ColorTrackEntry,
  type StrobeTrackEntry,
  type DimmerTrackEntry,
  type ChaserTrackEntry,
} from './TrackTimeline';
import { dmxBridge } from '../utils/dmx-bridge';
import { useTimelineTracks, type TrackTargetType } from '../hooks/useTimelineTracks';

const AMBIANCE_ICON: Record<string, string> = {
  energetic: '⚡', dark: '🌑', uplifting: '🌅', dreamy: '🌙', aggressive: '🔥', groovy: '🕺', epic: '🏔️',
};

const COLOR_PRESETS = ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#ffff00', '#00ffff', '#ff00ff', '#ff8c00', '#8b5cf6', '#ff0064'];
const STROBE_SPEEDS = [2, 4, 6, 8, 10, 15, 20, 25];
const DIMMER_VALUES = [10, 25, 50, 75, 100];

// ─── Small UI helpers ───────────────────────────────────────

function TargetButtons(props: {
  type: TrackTargetType;
  onChange: (t: TrackTargetType) => void;
  accent: string;
}) {
  const opts: Array<{ type: TrackTargetType; label: string; icon: string }> = [
    { type: 'all', label: 'Toutes', icon: '🌐' },
    { type: 'group', label: 'Groupe', icon: '📁' },
    { type: 'fixture', label: 'Fixture', icon: '💡' },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {opts.map((o) => (
        <button key={o.type} onClick={() => props.onChange(o.type)}
          className={`px-2 py-2 rounded-lg text-xs border transition-all ${props.type === o.type ? `${props.accent} text-white` : 'bg-gray-800/40 border-gray-700/40 text-gray-400 hover:border-gray-600'}`}>
          <div className="text-base mb-0.5">{o.icon}</div>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function AddTrackModal(props: {
  title: string;
  name: string;
  setName: (v: string) => void;
  targetType: TrackTargetType;
  setTargetType: (v: TrackTargetType) => void;
  groupId: string;
  setGroupId: (v: string) => void;
  fixtureIds: string[];
  setFixtureIds: (v: string[]) => void;
  fixtureGroups: Array<{ id: string; name: string; fixtureIds: string[] }>;
  patchedFixtures: Array<{ id: string; name: string; universeId: string; startAddress: number; enabled?: boolean }>;
  onAdd: () => void;
  onClose: () => void;
  accentBtn: string;
  accentSel: string;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={props.onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
        <div className="bg-[#1a1a2e] border border-gray-700 rounded-xl shadow-2xl p-5 w-[420px] max-h-[80vh] overflow-auto pointer-events-auto">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-200">{props.title}</span>
            <button onClick={props.onClose} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
          </div>
          <label className="block text-[10px] text-gray-400 mb-1">Nom de la piste</label>
          <input autoFocus value={props.name} onChange={(e) => props.setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && props.name.trim()) props.onAdd(); if (e.key === 'Escape') props.onClose(); }}
            placeholder="ex. Blue Wash" className="w-full bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none mb-3" />
          <label className="block text-[10px] text-gray-400 mb-1">Appliquer à</label>
          <TargetButtons type={props.targetType} onChange={props.setTargetType} accent={props.accentSel} />
          {props.targetType === 'group' && (
            <div className="mt-3">
              <label className="block text-[10px] text-gray-400 mb-1">Groupe</label>
              <select value={props.groupId} onChange={(e) => props.setGroupId(e.target.value)}
                className="w-full bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none">
                <option value="">-- Choisir un groupe --</option>
                {props.fixtureGroups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name} ({g.fixtureIds.length})</option>
                ))}
              </select>
            </div>
          )}
          {props.targetType === 'fixture' && (
            <div className="mt-3">
              <label className="block text-[10px] text-gray-400 mb-1">Fixture</label>
              <select value={props.fixtureIds[0] || ''} onChange={(e) => props.setFixtureIds(e.target.value ? [e.target.value] : [])}
                className="w-full bg-gray-800/80 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none">
                <option value="">-- Choisir une fixture --</option>
                {props.patchedFixtures.filter((f) => f.enabled !== false).map((f) => (
                  <option key={f.id} value={f.id}>{f.name} ({f.universeId} ch.{f.startAddress})</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <button onClick={props.onClose} className="px-4 py-1.5 rounded-lg text-xs text-gray-400 border border-gray-700 hover:bg-gray-800">Annuler</button>
            <button onClick={props.onAdd} disabled={!props.name.trim()}
              className={`px-4 py-1.5 rounded-lg text-xs font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed ${props.accentBtn}`}>Ajouter</button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Main panel ─────────────────────────────────────────────

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
  const [currentTime, setCurrentTime] = useState(0);
  const [savedFlash, setSavedFlash] = useState<string | null>(null);
  const [bpmOverrides, setBpmOverrides] = useState<Record<string, number>>({});
  // filters
  const [ambFilter, setAmbFilter] = useState<string | null>(null);
  const [themeFilter, setThemeFilter] = useState<string | null>(null);
  const [tempoFilter, setTempoFilter] = useState<string | null>(null);
  const rafRef = useRef<number>(0);
  const passStartRef = useRef<number>(0);

  useEffect(() => {
    if (patchedFixtures.length === 0) { setFixtureDefs(new Map()); return; }
    let cancelled = false;
    loadFixtureDefinitions([...new Set(patchedFixtures.map((f) => f.fixtureDefId))])
      .then((defs) => { if (!cancelled) setFixtureDefs(defs); })
      .catch(() => { if (!cancelled) setFixtureDefs(new Map()); });
    return () => { cancelled = true; };
  }, [patchedFixtures]);

  const loops = useMemo<AmbianceLoop[]>(() => {
    const base = generateAmbianceLoops(patchedFixtures);
    const overridden = base.map((l) => (bpmOverrides[l.id] ? regenerateLoopAtBpm(l, bpmOverrides[l.id]) : l));
    return overridden.filter((l) => {
      if (ambFilter && l.ambiance !== ambFilter) return false;
      if (themeFilter && l.theme !== themeFilter) return false;
      if (tempoFilter) {
        const baseBpm = getAmbianceProfile(l.ambiance).bpm;
        const ratio = l.bpm / baseBpm;
        if (tempoFilter === 'slow' && ratio >= 0.9) return false;
        if (tempoFilter === 'mid' && (ratio < 0.9 || ratio > 1.1)) return false;
        if (tempoFilter === 'fast' && ratio <= 1.1) return false;
      }
      return true;
    });
  }, [patchedFixtures, bpmOverrides, ambFilter, themeFilter, tempoFilter]);

  const selected = loops.find((l) => l.id === selectedId) ?? loops[0] ?? null;

  const track = useTimelineTracks(selected?.duration ?? 32);

  const stopPlay = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    setPlayingId(null);
    setCurrentTime(0);
    dmxBridge.release('vc');
  }, []);

  useEffect(() => () => { cancelAnimationFrame(rafRef.current); dmxBridge.release('vc'); }, []);

  const selectLoop = useCallback((loop: AmbianceLoop) => {
    stopPlay();
    track.resetTracks();
    setSelectedId(loop.id);
  }, [stopPlay, track]);

  const playLoop = (loop: AmbianceLoop) => {
    if (playingId === loop.id) { stopPlay(); return; }
    stopPlay();
    const universeIds = universes.map((u) => u.id);
    const dmxCues = computeLoopDmxCues(loop, patchedFixtures, fixtureDefs, universeIds);
    if (dmxCues.length === 0) return;
    const duration = loop.duration;
    let fired = new Set<string>();
    let first = true;
    passStartRef.current = performance.now();
    setCurrentTime(0);
    const fire = () => {
      if (first) { first = false; dmxBridge.release('vc'); }
      let elapsed = (performance.now() - passStartRef.current) / 1000;
      if (elapsed >= duration) {
        passStartRef.current = performance.now();
        fired = new Set();
        elapsed = 0;
        dmxBridge.release('vc');
      }
      setCurrentTime(elapsed);
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

  const handleSeek = (tm: number) => {
    setCurrentTime(tm);
    if (playingId) passStartRef.current = performance.now() - tm * 1000;
  };

  const handleBpmChange = (bpm: number) => {
    if (!selected) return;
    setBpmOverrides((prev) => ({ ...prev, [selected.id]: Math.max(40, Math.min(240, bpm)) }));
    stopPlay();
  };

  const handleSave = () => {
    if (!selected) return;
    addAutoLoop({
      name: selected.name,
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
          <p className="text-xs text-gray-600">Patch des fixtures dans l'onglet Setup pour générer des boucles d'ambiance.</p>
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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-gray-800 shrink-0">
        <button onClick={() => setAmbFilter(null)}
          className={`px-2 py-0.5 rounded text-[10px] border ${ambFilter === null ? 'bg-purple-600/20 border-purple-500/40 text-purple-300' : 'border-gray-700 text-gray-500 hover:border-gray-600'}`}>Toutes</button>
        {AMBIANCE_PROFILES.map((p) => (
          <button key={p.ambiance} onClick={() => setAmbFilter(ambFilter === p.ambiance ? null : p.ambiance)}
            className={`px-2 py-0.5 rounded text-[10px] border ${ambFilter === p.ambiance ? 'bg-purple-600/20 border-purple-500/40 text-purple-300' : 'border-gray-700 text-gray-500 hover:border-gray-600'}`}>
            {AMBIANCE_ICON[p.ambiance]} {p.labelFr}
          </button>
        ))}
        <span className="text-gray-700 mx-1">·</span>
        {THEMES.map((th) => (
          <button key={th.id} onClick={() => setThemeFilter(themeFilter === th.id ? null : th.id)}
            className={`px-2 py-0.5 rounded text-[10px] border ${themeFilter === th.id ? 'bg-cyan-600/20 border-cyan-500/40 text-cyan-300' : 'border-gray-700 text-gray-500 hover:border-gray-600'}`}>
            {th.labelFr}
          </button>
        ))}
        <span className="text-gray-700 mx-1">·</span>
        {TEMPO_VARIANTS.map((tv) => (
          <button key={tv.id} onClick={() => setTempoFilter(tempoFilter === tv.id ? null : tv.id)}
            className={`px-2 py-0.5 rounded text-[10px] border ${tempoFilter === tv.id ? 'bg-amber-600/20 border-amber-500/40 text-amber-300' : 'border-gray-700 text-gray-500 hover:border-gray-600'}`}>
            {tv.labelFr}
          </button>
        ))}
      </div>

      <div className="flex-1 flex min-h-0">
        {/* Loop list */}
        <div className="w-56 shrink-0 overflow-y-auto border-r border-gray-800 p-2 space-y-1">
          {loops.map((loop) => {
            const profile = getAmbianceProfile(loop.ambiance);
            const active = selected?.id === loop.id;
            return (
              <button key={loop.id} onClick={() => selectLoop(loop)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-left transition-colors ${active ? 'border-purple-500/40 bg-purple-600/15 text-gray-100' : 'border-gray-800 bg-gray-900/40 text-gray-300 hover:border-gray-700 hover:bg-gray-900/70'}`}>
                <span className="text-sm leading-none shrink-0">{AMBIANCE_ICON[loop.ambiance] ?? '✨'}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium truncate">{getThemeProfile(loop.theme).labelFr} · {profile.labelFr}</span>
                  <span className="block text-[10px] text-gray-500 truncate">{loop.bpm} BPM · {loop.measures} mes.</span>
                </span>
                <span className="flex shrink-0 -space-x-1">
                  {profile.palette.slice(0, 3).map((c, i) => (
                    <span key={i} className="w-2 h-2 rounded-full border border-black/40" style={{ backgroundColor: c }} />
                  ))}
                </span>
              </button>
            );
          })}
          {loops.length === 0 && <p className="text-[10px] text-gray-600 px-2 pt-2">Aucune boucle pour ces filtres.</p>}
        </div>

        {/* Timeline editor */}
        <div className="flex-1 min-w-0 flex flex-col">
          {selected && (
            <>
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-800 shrink-0">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-200 truncate">{selected.name}</div>
                  <div className="text-[10px] text-gray-500">
                    {selected.fixtureCount} fixtures · {selected.cues.length} cues · {selected.duration.toFixed(1)}s
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <label className="text-[10px] text-gray-500">BPM</label>
                  <input type="number" min={40} max={240} value={selected.bpm}
                    onChange={(e) => handleBpmChange(Number(e.target.value))}
                    className="w-16 px-1.5 py-1 rounded bg-gray-800/60 border border-gray-700 text-xs text-gray-200 outline-none" />
                  <button onClick={() => playLoop(selected)}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${playingId === selected.id ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-200 hover:bg-purple-600/30 hover:text-purple-200'}`}>
                    {playingId === selected.id ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    {playingId === selected.id ? 'Arrêter' : 'Jouer'}
                  </button>
                  <button onClick={handleSave}
                    className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${savedFlash === selected.id ? 'bg-green-600/20 text-green-300' : 'bg-purple-600/20 text-purple-300 hover:bg-purple-600/30'}`}>
                    {savedFlash === selected.id ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                    {savedFlash === selected.id ? 'Enregistré' : 'Enregistrer'}
                  </button>
                </div>
              </div>

              <div className="flex-1 min-h-0 overflow-auto px-3 py-2">
                <TrackTimeline
                  cues={selected.cues as any}
                  duration={selected.duration}
                  currentTime={currentTime}
                  onSeek={handleSeek}
                  sections={selected.sections}
                  patchedFixtures={patchedFixtures}
                  bpm={selected.bpm}
                  efxTracks={track.efxTracks}
                  onEfxTrackContextMenu={track.handleEfxTrackContextMenu}
                  onEfxEntryContextMenu={track.handleEfxEntryContextMenu}
                  onEfxEntryChange={track.handleEfxEntryChange}
                  colorTracks={track.colorTracks}
                  onColorTrackContextMenu={track.handleColorTrackContextMenu}
                  onColorEntryChange={track.handleColorEntryChange}
                  onColorEntryContextMenu={track.handleColorEntryContextMenu}
                  strobeTracks={track.strobeTracks}
                  onStrobeTrackContextMenu={track.handleStrobeTrackContextMenu}
                  onStrobeEntryContextMenu={track.handleStrobeEntryContextMenu}
                  onStrobeEntryChange={track.handleStrobeEntryChange}
                  dimmerTracks={track.dimmerTracks}
                  onDimmerTrackContextMenu={track.handleDimmerTrackContextMenu}
                  onDimmerEntryContextMenu={track.handleDimmerEntryContextMenu}
                  onDimmerEntryChange={track.handleDimmerEntryChange}
                  chaserTracks={track.chaserTracks}
                  onChaserTrackContextMenu={track.handleChaserTrackContextMenu}
                  onChaserEntryContextMenu={track.handleChaserEntryContextMenu}
                  onChaserEntryChange={track.handleChaserEntryChange}
                  onSectionsChange={() => {}}
                  fixtureTracks={track.fixtureTracks}
                  onFixtureTracksChange={track.setFixtureTracks}
                />
              </div>

              {/* Track toolbar */}
              <div className="px-3 py-2 border-t border-gray-800/50 bg-[#0d0d14] flex items-center gap-1.5 flex-wrap shrink-0">
                <button onClick={() => { track.setEfxTrackModal(true); track.setEfxTrackName(''); track.setEfxTargetType('all'); }}
                  className="px-2 py-0.5 rounded text-[10px] text-cyan-400 border border-cyan-700/50 hover:bg-cyan-400/10 flex items-center gap-1"><Plus className="w-3 h-3" /> EFX Track</button>
                <button onClick={() => { track.setColorTrackModal(true); track.setColorTrackName(''); track.setColorTargetType('all'); }}
                  className="px-2 py-0.5 rounded text-[10px] text-pink-400 border border-pink-700/50 hover:bg-pink-400/10 flex items-center gap-1"><Plus className="w-3 h-3" /> Color Track</button>
                <button onClick={() => { track.setStrobeTrackModal(true); track.setStrobeTrackName(''); track.setStrobeTargetType('all'); }}
                  className="px-2 py-0.5 rounded text-[10px] text-purple-400 border border-purple-700/50 hover:bg-purple-400/10 flex items-center gap-1"><Plus className="w-3 h-3" /> Strobe Track</button>
                <button onClick={() => { track.setDimmerTrackModal(true); track.setDimmerTrackName(''); track.setDimmerTargetType('all'); }}
                  className="px-2 py-0.5 rounded text-[10px] text-orange-400 border border-orange-700/50 hover:bg-orange-400/10 flex items-center gap-1"><Plus className="w-3 h-3" /> Dimmer Track</button>
                <button onClick={track.handleAddChaserTrack}
                  className="px-2 py-0.5 rounded text-[10px] text-emerald-400 border border-emerald-700/50 hover:bg-emerald-400/10 flex items-center gap-1"><Plus className="w-3 h-3" /> Chaser Track</button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Saved loops */}
      {autoLoops.length > 0 && (
        <div className="shrink-0 border-t border-gray-800 px-3 py-2">
          <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Boucles enregistrées ({autoLoops.length})</div>
          <div className="flex flex-wrap gap-1.5">
            {autoLoops.map((a) => (
              <div key={a.id} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-gray-800/60 border border-gray-700 text-xs text-gray-300">
                <span className="truncate max-w-[160px]">{a.name}</span>
                <button onClick={() => deleteAutoLoop(a.id)} title="Supprimer" className="text-gray-500 hover:text-rose-400 transition-colors"><Trash2 className="w-3 h-3" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Modals + context menus ── */}
      {track.efxTrackModal && (
        <AddTrackModal title="Nouvelle piste EFX" name={track.efxTrackName} setName={track.setEfxTrackName}
          targetType={track.efxTargetType} setTargetType={track.setEfxTargetType}
          groupId={track.efxTargetGroupId} setGroupId={track.setEfxTargetGroupId}
          fixtureIds={track.efxTargetFixtureIds} setFixtureIds={track.setEfxTargetFixtureIds}
          fixtureGroups={track.fixtureGroups} patchedFixtures={patchedFixtures}
          onAdd={track.handleAddEfxTrack} onClose={() => track.setEfxTrackModal(false)}
          accentBtn="bg-cyan-600 hover:bg-cyan-500" accentSel="bg-cyan-600/20 border-cyan-500/50 text-cyan-300" />
      )}
      {track.colorTrackModal && (
        <AddTrackModal title="Nouvelle piste couleur" name={track.colorTrackName} setName={track.setColorTrackName}
          targetType={track.colorTargetType} setTargetType={track.setColorTargetType}
          groupId={track.colorTargetGroupId} setGroupId={track.setColorTargetGroupId}
          fixtureIds={track.colorTargetFixtureIds} setFixtureIds={track.setColorTargetFixtureIds}
          fixtureGroups={track.fixtureGroups} patchedFixtures={patchedFixtures}
          onAdd={track.handleAddColorTrack} onClose={() => track.setColorTrackModal(false)}
          accentBtn="bg-pink-600 hover:bg-pink-500" accentSel="bg-pink-600/20 border-pink-500/50 text-pink-300" />
      )}
      {track.strobeTrackModal && (
        <AddTrackModal title="Nouvelle piste strobe" name={track.strobeTrackName} setName={track.setStrobeTrackName}
          targetType={track.strobeTargetType} setTargetType={track.setStrobeTargetType}
          groupId={track.strobeTargetGroupId} setGroupId={track.setStrobeTargetGroupId}
          fixtureIds={track.strobeTargetFixtureIds} setFixtureIds={track.setStrobeTargetFixtureIds}
          fixtureGroups={track.fixtureGroups} patchedFixtures={patchedFixtures}
          onAdd={track.handleAddStrobeTrack} onClose={() => track.setStrobeTrackModal(false)}
          accentBtn="bg-purple-600 hover:bg-purple-500" accentSel="bg-purple-600/20 border-purple-500/50 text-purple-300" />
      )}
      {track.dimmerTrackModal && (
        <AddTrackModal title="Nouvelle piste dimmer" name={track.dimmerTrackName} setName={track.setDimmerTrackName}
          targetType={track.dimmerTargetType} setTargetType={track.setDimmerTargetType}
          groupId={track.dimmerTargetGroupId} setGroupId={track.setDimmerTargetGroupId}
          fixtureIds={track.dimmerTargetFixtureIds} setFixtureIds={track.setDimmerTargetFixtureIds}
          fixtureGroups={track.fixtureGroups} patchedFixtures={patchedFixtures}
          onAdd={track.handleAddDimmerTrackFromModal} onClose={() => track.setDimmerTrackModal(false)}
          accentBtn="bg-orange-600 hover:bg-orange-500" accentSel="bg-orange-600/20 border-orange-500/50 text-orange-300" />
      )}

      {/* EFX track context menu */}
      {track.efxContextMenu && (
        <ContextMenu pos={track.efxContextMenu} title={`EFX à ${track.efxContextMenu.time.toFixed(1)}s`} onClose={() => track.setEfxContextMenu(null)}>
          {track.effects.length === 0 && <div className="px-3 py-2 text-[10px] text-gray-600">Aucun effet (créez-en dans l'onglet EFX).</div>}
          {track.effects.map((e) => (
            <button key={e.id} onClick={() => track.handleInsertEfxToTrack(track.efxContextMenu!.trackId, track.efxContextMenu!.time, e.id, e.name, e.pattern)}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800">{e.name} ({e.pattern})</button>
          ))}
          <button onClick={() => { track.handleRemoveEfxTrack(track.efxContextMenu!.trackId); track.setEfxContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800 border-t border-gray-800">Supprimer la piste</button>
        </ContextMenu>
      )}
      {track.efxEntryMenu && (
        <ContextMenu pos={{ x: track.efxEntryMenu.x, y: track.efxEntryMenu.y }} title={track.efxEntryMenu.entry.effectName} onClose={() => track.setEfxEntryMenu(null)}>
          <button onClick={() => track.handleRemoveEfxEntry(track.efxEntryMenu!.trackId, track.efxEntryMenu!.entry.time)}
            className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800">Supprimer</button>
        </ContextMenu>
      )}

      {/* Color context menu */}
      {track.colorContextMenu && (
        <ContextMenu pos={track.colorContextMenu} title={`Couleur à ${track.colorContextMenu.time.toFixed(1)}s`} onClose={() => track.setColorContextMenu(null)}>
          <div className="flex flex-wrap gap-1 px-2 py-1.5">
            {COLOR_PRESETS.map((c) => (
              <button key={c} onClick={() => track.handleInsertColorToTrack(track.colorContextMenu!.trackId, track.colorContextMenu!.time, c)}
                className="w-5 h-5 rounded-full border border-black/40" style={{ backgroundColor: c }} />
            ))}
          </div>
          <button onClick={() => { track.handleRemoveColorTrack(track.colorContextMenu!.trackId); track.setColorContextMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800 border-t border-gray-800">Supprimer la piste</button>
        </ContextMenu>
      )}
      {track.colorEntryMenu && (
        <ContextMenu pos={{ x: track.colorEntryMenu.x, y: track.colorEntryMenu.y }} title="Entrée couleur" onClose={() => track.setColorEntryMenu(null)}>
          <button onClick={() => track.handleRemoveColorEntry(track.colorEntryMenu!.trackId, track.colorEntryMenu!.entry.time)}
            className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800">Supprimer</button>
        </ContextMenu>
      )}

      {/* Strobe context menu */}
      {track.strobeMenu && (
        <ContextMenu pos={track.strobeMenu} title={`Strobe à ${track.strobeMenu.time.toFixed(1)}s`} onClose={() => track.setStrobeMenu(null)}>
          <div className="flex flex-wrap gap-1 px-2 py-1.5">
            {STROBE_SPEEDS.map((s) => (
              <button key={s} onClick={() => track.handleInsertStrobeToTrack(track.strobeMenu!.trackId, track.strobeMenu!.time, s)}
                className="px-2 py-1 rounded text-[10px] bg-gray-800 text-gray-300 hover:bg-purple-600/30">{s} Hz</button>
            ))}
          </div>
          <button onClick={() => { track.handleDeleteStrobeTrack(track.strobeMenu!.trackId); track.setStrobeMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800 border-t border-gray-800">Supprimer la piste</button>
        </ContextMenu>
      )}
      {track.strobeEntryMenu && (
        <ContextMenu pos={{ x: track.strobeEntryMenu.x, y: track.strobeEntryMenu.y }} title={`${track.strobeEntryMenu.entry.speed} Hz`} onClose={() => track.setStrobeEntryMenu(null)}>
          <button onClick={() => track.handleRemoveStrobeEntry(track.strobeEntryMenu!.trackId, track.strobeEntryMenu!.entry.id)}
            className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800">Supprimer</button>
        </ContextMenu>
      )}

      {/* Dimmer context menu */}
      {track.dimmerInsertMenu && (
        <ContextMenu pos={track.dimmerInsertMenu} title={`Dimmer à ${track.dimmerInsertMenu.time.toFixed(1)}s`} onClose={() => track.setDimmerInsertMenu(null)}>
          <div className="flex flex-wrap gap-1 px-2 py-1.5">
            {DIMMER_VALUES.map((v) => (
              <button key={v} onClick={() => track.handleInsertDimmerToTrack(track.dimmerInsertMenu!.trackId, track.dimmerInsertMenu!.time, v)}
                className="px-2 py-1 rounded text-[10px] bg-gray-800 text-gray-300 hover:bg-orange-600/30">{v}%</button>
            ))}
          </div>
          <button onClick={() => { track.handleDeleteDimmerTrack(track.dimmerInsertMenu!.trackId); track.setDimmerInsertMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800 border-t border-gray-800">Supprimer la piste</button>
        </ContextMenu>
      )}
      {track.dimmerEntryMenu && (
        <ContextMenu pos={{ x: track.dimmerEntryMenu.x, y: track.dimmerEntryMenu.y }} title={`${track.dimmerEntryMenu.entry.value}%`} onClose={() => track.setDimmerEntryMenu(null)}>
          <button onClick={() => track.handleRemoveDimmerEntry(track.dimmerEntryMenu!.trackId, track.dimmerEntryMenu!.entry.id)}
            className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800">Supprimer</button>
        </ContextMenu>
      )}

      {/* Chaser context menu */}
      {track.chaserInsertMenu && (
        <ContextMenu pos={track.chaserInsertMenu} title={`Chaser à ${track.chaserInsertMenu.time.toFixed(1)}s`} onClose={() => track.setChaserInsertMenu(null)}>
          {track.chasers.length === 0 && <div className="px-3 py-2 text-[10px] text-gray-600">Aucun chaser (créez-en dans Design → Chasers).</div>}
          {track.chasers.map((c) => (
            <button key={c.id} onClick={() => track.handleInsertChaserToTrack(track.chaserInsertMenu!.trackId, track.chaserInsertMenu!.time, c.id, c.name)}
              className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800">🎬 {c.name}</button>
          ))}
          <button onClick={() => { track.handleDeleteChaserTrack(track.chaserInsertMenu!.trackId); track.setChaserInsertMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800 border-t border-gray-800">Supprimer la piste</button>
        </ContextMenu>
      )}
      {track.chaserEntryMenu && (
        <ContextMenu pos={{ x: track.chaserEntryMenu.x, y: track.chaserEntryMenu.y }} title={track.chaserEntryMenu.entry.chaserName || 'Chaser'} onClose={() => track.setChaserEntryMenu(null)}>
          <button onClick={() => track.handleRemoveChaserEntry(track.chaserEntryMenu!.trackId, track.chaserEntryMenu!.entry.id)}
            className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-gray-800">Supprimer</button>
        </ContextMenu>
      )}

      {/* Chaser picker modal */}
      {track.chaserPickModal && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => track.setChaserPickModal(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
            <div className="bg-[#1a1a2e] border border-emerald-700/50 rounded-xl shadow-2xl p-5 w-[420px] max-h-[80vh] overflow-auto pointer-events-auto">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-gray-200">Sélectionner un chaser</span>
                <button onClick={() => track.setChaserPickModal(null)} className="text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
              </div>
              {track.chasers.length === 0 && <div className="text-[10px] text-gray-600">Aucun chaser disponible.</div>}
              {track.chasers.map((c) => (
                <button key={c.id} onClick={() => track.handlePickChaserForTrack(track.chaserPickModal!.trackId, c.id, c.name)}
                  className="w-full text-left px-3 py-1.5 text-xs text-gray-300 hover:bg-emerald-500/10 flex items-center gap-2">
                  <span>🎬</span>{c.name}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

// ─── Context menu helper ────────────────────────────────────

function ContextMenu(props: {
  pos: { x: number; y: number; time?: number };
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={props.onClose} />
      <div className="fixed z-50 bg-[#1a1a2e] border border-gray-700 rounded-lg shadow-xl py-1 min-w-[180px]"
        style={{ left: props.pos.x, top: props.pos.y }} onClick={(e) => e.stopPropagation()}>
        <div className="px-3 py-1.5 text-[10px] text-gray-400 uppercase tracking-wider border-b border-gray-800">{props.title}</div>
        {props.children}
      </div>
    </>
  );
}
