// ─── useTimelineTracks — reusable timeline track state + handlers ─────────
//
// Encapsulates the track subsystem of the autoscript timeline: EFX / color /
// strobe / dimmer / chaser / fixture tracks, their add/remove/insert/edit
// handlers, the add-track modal state, and the context-menu state. Self-
// contained (reads fixtures/groups/effects/chasers from the show store) so it
// can drive the same timeline-editing UI in both the autoscript and the
// ambiance-loop panel.

import { useCallback, useState } from 'react';
import { useShowStore } from '../stores/showStore';
import type {
  EfxTrack,
  EfxTrackEntry,
  ColorTrack,
  ColorTrackEntry,
  StrobeTrack,
  StrobeTrackEntry,
  DimmerTrack,
  DimmerTrackEntry,
  ChaserTrack,
  ChaserTrackEntry,
} from '../views/TrackTimeline';
import type { FixtureTrack } from './fixture-tracks';

export type TrackTargetType = 'all' | 'group' | 'fixture';

interface MenuPos {
  trackId: string;
  time: number;
  x: number;
  y: number;
}

interface EfxEntryMenu {
  trackId: string;
  entry: EfxTrackEntry;
  x: number;
  y: number;
}
interface ColorEntryMenu {
  trackId: string;
  entry: ColorTrackEntry;
  x: number;
  y: number;
}
interface StrobeEntryMenu {
  trackId: string;
  entry: StrobeTrackEntry;
  x: number;
  y: number;
}
interface DimmerEntryMenu {
  trackId: string;
  entry: DimmerTrackEntry;
  x: number;
  y: number;
}
interface ChaserEntryMenu {
  trackId: string;
  entry: ChaserTrackEntry;
  x: number;
  y: number;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function useTimelineTracks(duration: number) {
  const fixtureGroups = useShowStore((s) => s.fixtureGroups);
  const effects = useShowStore((s) => s.effects);
  const chasers = useShowStore((s) => s.chasers);

  // ── Track state ──
  const [efxTracks, setEfxTracks] = useState<EfxTrack[]>([]);
  const [colorTracks, setColorTracks] = useState<ColorTrack[]>([]);
  const [strobeTracks, setStrobeTracks] = useState<StrobeTrack[]>([]);
  const [dimmerTracks, setDimmerTracks] = useState<DimmerTrack[]>([]);
  const [chaserTracks, setChaserTracks] = useState<ChaserTrack[]>([]);
  const [fixtureTracks, setFixtureTracks] = useState<FixtureTrack[]>([]);

  // ── Modal state ──
  const [efxTrackModal, setEfxTrackModal] = useState(false);
  const [efxTrackName, setEfxTrackName] = useState('');
  const [efxTargetType, setEfxTargetType] = useState<TrackTargetType>('all');
  const [efxTargetGroupId, setEfxTargetGroupId] = useState('');
  const [efxTargetFixtureIds, setEfxTargetFixtureIds] = useState<string[]>([]);
  const [efxCustomEffectId, setEfxCustomEffectId] = useState('');

  const [colorTrackModal, setColorTrackModal] = useState(false);
  const [colorTrackName, setColorTrackName] = useState('');
  const [colorTargetType, setColorTargetType] = useState<TrackTargetType>('all');
  const [colorTargetGroupId, setColorTargetGroupId] = useState('');
  const [colorTargetFixtureIds, setColorTargetFixtureIds] = useState<string[]>([]);

  const [strobeTrackModal, setStrobeTrackModal] = useState(false);
  const [strobeTrackName, setStrobeTrackName] = useState('');
  const [strobeTargetType, setStrobeTargetType] = useState<TrackTargetType>('all');
  const [strobeTargetGroupId, setStrobeTargetGroupId] = useState('');
  const [strobeTargetFixtureIds, setStrobeTargetFixtureIds] = useState<string[]>([]);

  const [dimmerTrackModal, setDimmerTrackModal] = useState(false);
  const [dimmerTrackName, setDimmerTrackName] = useState('');
  const [dimmerTargetType, setDimmerTargetType] = useState<TrackTargetType>('all');
  const [dimmerTargetGroupId, setDimmerTargetGroupId] = useState('');
  const [dimmerTargetFixtureIds, setDimmerTargetFixtureIds] = useState<string[]>([]);

  // ── Context-menu state ──
  const [efxContextMenu, setEfxContextMenu] = useState<MenuPos | null>(null);
  const [efxEntryMenu, setEfxEntryMenu] = useState<EfxEntryMenu | null>(null);
  const [colorContextMenu, setColorContextMenu] = useState<MenuPos | null>(null);
  const [colorEntryMenu, setColorEntryMenu] = useState<ColorEntryMenu | null>(null);
  const [strobeMenu, setStrobeMenu] = useState<MenuPos | null>(null);
  const [strobeEntryMenu, setStrobeEntryMenu] = useState<StrobeEntryMenu | null>(null);
  const [dimmerInsertMenu, setDimmerInsertMenu] = useState<MenuPos | null>(null);
  const [dimmerEntryMenu, setDimmerEntryMenu] = useState<DimmerEntryMenu | null>(null);
  const [chaserInsertMenu, setChaserInsertMenu] = useState<MenuPos | null>(null);
  const [chaserEntryMenu, setChaserEntryMenu] = useState<ChaserEntryMenu | null>(null);
  const [chaserPickModal, setChaserPickModal] = useState<{ trackId: string } | null>(null);

  const targetFixtures = (type: TrackTargetType, groupId: string, fixtureIds: string[]) =>
    ({
      type,
      ...(type === 'group' && groupId ? { groupId } : {}),
      ...(type === 'fixture' && fixtureIds.length ? { fixtureIds } : {}),
    } as EfxTrack['targetFixtures']);

  // ── EFX tracks ──
  const handleAddEfxTrack = useCallback(() => {
    const name = efxTrackName.trim();
    if (!name) return;
    setEfxTracks((prev) => [...prev, {
      id: uid('efxt'), name, entries: [],
      targetFixtures: targetFixtures(efxTargetType, efxTargetGroupId, efxTargetFixtureIds),
    }]);
    setEfxTrackModal(false); setEfxTrackName(''); setEfxTargetType('all');
    setEfxTargetGroupId(''); setEfxTargetFixtureIds([]); setEfxCustomEffectId('');
  }, [efxTrackName, efxTargetType, efxTargetGroupId, efxTargetFixtureIds]);

  const handleEfxTrackContextMenu = useCallback((trackId: string, time: number, clientX: number, clientY: number) => {
    setEfxContextMenu({ trackId, time, x: clientX, y: clientY });
  }, []);
  const handleEfxEntryContextMenu = useCallback((trackId: string, entry: EfxTrackEntry, clientX: number, clientY: number) => {
    setEfxEntryMenu({ trackId, entry, x: clientX, y: clientY });
  }, []);
  const handleRemoveEfxTrack = useCallback((trackId: string) => {
    setEfxTracks((prev) => prev.filter((t) => t.id !== trackId));
  }, []);
  const handleRemoveEfxEntry = useCallback((trackId: string, entryTime: number) => {
    setEfxTracks((prev) => prev.map((t) => t.id === trackId ? { ...t, entries: t.entries.filter((e) => e.time !== entryTime) } : t));
    setEfxEntryMenu(null);
  }, []);
  const handleInsertEfxToTrack = useCallback((trackId: string, time: number, effectId: string, effectName: string, pattern: string) => {
    setEfxTracks((prev) => prev.map((t) => {
      if (t.id !== trackId) return t;
      return {
        ...t,
        entries: [...t.entries, { time, endTime: Math.min(time + 4, duration || 120), effectId, effectName, pattern, fixtureNames: [] }]
          .sort((a, b) => a.time - b.time),
      };
    }));
  }, [duration]);
  const handleEfxEntryChange = useCallback((trackId: string, entryIndex: number, updates: Partial<EfxTrackEntry>) => {
    setEfxTracks((prev) => prev.map((t) => {
      if (t.id !== trackId) return t;
      const entries = [...t.entries];
      entries[entryIndex] = { ...entries[entryIndex], ...updates };
      entries.sort((a, b) => a.time - b.time);
      return { ...t, entries };
    }));
  }, []);

  // ── Color tracks ──
  const handleAddColorTrack = useCallback(() => {
    const name = colorTrackName.trim();
    if (!name) return;
    setColorTracks((prev) => [...prev, {
      id: uid('clrt'), name, entries: [],
      targetFixtures: targetFixtures(colorTargetType, colorTargetGroupId, colorTargetFixtureIds),
    }]);
    setColorTrackModal(false); setColorTrackName(''); setColorTargetType('all');
    setColorTargetGroupId(''); setColorTargetFixtureIds([]);
  }, [colorTrackName, colorTargetType, colorTargetGroupId, colorTargetFixtureIds]);

  const handleColorTrackContextMenu = useCallback((trackId: string, time: number, clientX: number, clientY: number) => {
    setColorContextMenu({ trackId, time, x: clientX, y: clientY });
  }, []);
  const handleColorEntryContextMenu = useCallback((trackId: string, entry: ColorTrackEntry, clientX: number, clientY: number) => {
    setColorEntryMenu({ trackId, entry, x: clientX, y: clientY });
  }, []);
  const handleRemoveColorTrack = useCallback((trackId: string) => {
    setColorTracks((prev) => prev.filter((t) => t.id !== trackId));
  }, []);
  const handleRemoveColorEntry = useCallback((trackId: string, entryTime: number) => {
    setColorTracks((prev) => prev.map((t) => t.id === trackId ? { ...t, entries: t.entries.filter((e) => e.time !== entryTime) } : t));
    setColorEntryMenu(null);
  }, []);
  const handleInsertColorToTrack = useCallback((trackId: string, time: number, color: string, endColor?: string) => {
    setColorTracks((prev) => prev.map((t) => {
      if (t.id !== trackId) return t;
      return {
        ...t,
        entries: [...t.entries, {
          id: uid('clre'), time, endTime: Math.min(time + 4, duration || 120), color, endColor: endColor || undefined,
        }].sort((a, b) => a.time - b.time),
      };
    }));
    setColorContextMenu(null);
  }, [duration]);
  const handleColorEntryChange = useCallback((trackId: string, entryIndex: number, newTime: number, newEndTime: number) => {
    setColorTracks((prev) => prev.map((t) => {
      if (t.id !== trackId) return t;
      const entries = [...t.entries];
      if (entryIndex >= 0 && entryIndex < entries.length) entries[entryIndex] = { ...entries[entryIndex], time: newTime, endTime: newEndTime };
      return { ...t, entries };
    }));
  }, []);

  // ── Strobe tracks ──
  const handleAddStrobeTrack = useCallback(() => {
    const name = strobeTrackName.trim();
    if (!name) return;
    setStrobeTracks((prev) => [...prev, {
      id: uid('strobe'), name, entries: [],
      targetFixtures: targetFixtures(strobeTargetType, strobeTargetGroupId, strobeTargetFixtureIds),
    }]);
    setStrobeTrackModal(false); setStrobeTrackName(''); setStrobeTargetType('all');
    setStrobeTargetGroupId(''); setStrobeTargetFixtureIds([]);
  }, [strobeTrackName, strobeTargetType, strobeTargetGroupId, strobeTargetFixtureIds]);

  const handleStrobeTrackContextMenu = useCallback((trackId: string, time: number, clientX: number, clientY: number) => {
    setStrobeMenu({ trackId, time, x: clientX, y: clientY });
  }, []);
  const handleStrobeEntryContextMenu = useCallback((trackId: string, entry: StrobeTrackEntry, clientX: number, clientY: number) => {
    setStrobeEntryMenu({ trackId, entry, x: clientX, y: clientY });
  }, []);
  const handleDeleteStrobeTrack = useCallback((trackId: string) => {
    setStrobeTracks((prev) => prev.filter((t) => t.id !== trackId));
  }, []);
  const handleInsertStrobeToTrack = useCallback((trackId: string, time: number, speed: number, endSpeed?: number) => {
    setStrobeTracks((prev) => prev.map((t) => {
      if (t.id !== trackId) return t;
      const entry: StrobeTrackEntry = { id: uid('strobe-e'), time, endTime: time + 10, speed, endSpeed: endSpeed || speed };
      return { ...t, entries: [...t.entries, entry] };
    }));
    setStrobeMenu(null);
  }, []);
  const handleRemoveStrobeEntry = useCallback((trackId: string, entryId: string) => {
    setStrobeTracks((prev) => prev.map((t) => t.id === trackId ? { ...t, entries: t.entries.filter((e) => e.id !== entryId) } : t));
    setStrobeEntryMenu(null);
  }, []);
  const handleStrobeEntryChange = useCallback((trackId: string, entryIndex: number, newTime: number, newEndTime: number) => {
    setStrobeTracks((prev) => prev.map((t) => {
      if (t.id !== trackId) return t;
      const entries = [...t.entries];
      if (entryIndex >= 0 && entryIndex < entries.length) entries[entryIndex] = { ...entries[entryIndex], time: newTime, endTime: newEndTime };
      return { ...t, entries };
    }));
  }, []);

  // ── Dimmer tracks ──
  const handleAddDimmerTrack = useCallback((name: string, targetType: TrackTargetType, groupId?: string, fixtureIds?: string[]) => {
    setDimmerTracks((prev) => [...prev, {
      id: uid('dimmer'), name, entries: [],
      targetFixtures: targetFixtures(targetType, groupId || '', fixtureIds || []),
    }]);
  }, []);

  const handleDimmerTrackContextMenu = useCallback((trackId: string, time: number, clientX: number, clientY: number) => {
    setDimmerInsertMenu({ trackId, time, x: clientX, y: clientY });
  }, []);
  const handleDimmerEntryContextMenu = useCallback((trackId: string, entry: DimmerTrackEntry, clientX: number, clientY: number) => {
    setDimmerEntryMenu({ trackId, entry, x: clientX, y: clientY });
  }, []);
  const handleDeleteDimmerTrack = useCallback((trackId: string) => {
    setDimmerTracks((prev) => prev.filter((t) => t.id !== trackId));
  }, []);
  const handleInsertDimmerToTrack = useCallback((trackId: string, time: number, value: number, endValue?: number) => {
    setDimmerTracks((prev) => prev.map((t) => {
      if (t.id !== trackId) return t;
      const entry: DimmerTrackEntry = { id: uid('dimmer-e'), time, endTime: time + 10, value, endValue: endValue ?? value };
      return { ...t, entries: [...t.entries, entry] };
    }));
    setDimmerInsertMenu(null);
  }, []);
  const handleRemoveDimmerEntry = useCallback((trackId: string, entryId: string) => {
    setDimmerTracks((prev) => prev.map((t) => t.id === trackId ? { ...t, entries: t.entries.filter((e) => e.id !== entryId) } : t));
    setDimmerEntryMenu(null);
  }, []);
  const handleDimmerEntryChange = useCallback((trackId: string, entryIndex: number, newTime: number, newEndTime: number) => {
    setDimmerTracks((prev) => prev.map((t) => {
      if (t.id !== trackId) return t;
      const entries = [...t.entries];
      if (entryIndex >= 0 && entryIndex < entries.length) entries[entryIndex] = { ...entries[entryIndex], time: newTime, endTime: newEndTime };
      return { ...t, entries };
    }));
  }, []);
  const handleAddDimmerTrackFromModal = useCallback(() => {
    const name = dimmerTrackName.trim();
    if (!name) return;
    handleAddDimmerTrack(name, dimmerTargetType, dimmerTargetGroupId || undefined, dimmerTargetFixtureIds);
    setDimmerTrackModal(false); setDimmerTrackName(''); setDimmerTargetType('all');
    setDimmerTargetGroupId(''); setDimmerTargetFixtureIds([]);
  }, [handleAddDimmerTrack, dimmerTrackName, dimmerTargetType, dimmerTargetGroupId, dimmerTargetFixtureIds]);

  // ── Chaser tracks ──
  const handleAddChaserTrack = useCallback(() => {
    const trackId = uid('chaser');
    setChaserTracks((prev) => [...prev, {
      id: trackId, name: `Chaser Track ${prev.length + 1}`, entries: [],
      targetFixtures: { type: 'all' },
    }]);
    setChaserPickModal({ trackId });
  }, []);

  const handleChaserTrackContextMenu = useCallback((trackId: string, time: number, clientX: number, clientY: number) => {
    setChaserInsertMenu({ trackId, time, x: clientX, y: clientY });
  }, []);
  const handleChaserEntryContextMenu = useCallback((trackId: string, entry: ChaserTrackEntry, clientX: number, clientY: number) => {
    setChaserEntryMenu({ trackId, entry, x: clientX, y: clientY });
  }, []);
  const handleDeleteChaserTrack = useCallback((trackId: string) => {
    setChaserTracks((prev) => prev.filter((t) => t.id !== trackId));
  }, []);
  const handleInsertChaserToTrack = useCallback((trackId: string, time: number, chaserId: string, chaserName?: string) => {
    const chaser = chasers.find((c) => c.id === chaserId);
    let defDur = 10;
    if (chaser && Array.isArray(chaser.steps) && chaser.steps.length > 0) {
      const total = chaser.steps.reduce((acc: number, s: any) => acc + Math.max(1, (s.fadeIn || 0) + (s.hold || 0) + (s.fadeOut || 0)), 0);
      defDur = Math.min(120, Math.max(2, total / 1000));
    }
    setChaserTracks((prev) => prev.map((t) => {
      if (t.id !== trackId) return t;
      const entry: ChaserTrackEntry = { id: uid('chaser-e'), time, endTime: time + defDur, chaserId, chaserName: chaserName || chaser?.name };
      return { ...t, entries: [...t.entries, entry] };
    }));
    setChaserInsertMenu(null);
  }, [chasers]);
  const handleRemoveChaserEntry = useCallback((trackId: string, entryId: string) => {
    setChaserTracks((prev) => prev.map((t) => t.id === trackId ? { ...t, entries: t.entries.filter((e) => e.id !== entryId) } : t));
    setChaserEntryMenu(null);
  }, []);
  const handleChaserEntryChange = useCallback((trackId: string, entryIndex: number, newTime: number, newEndTime: number) => {
    setChaserTracks((prev) => prev.map((t) => {
      if (t.id !== trackId) return t;
      const entries = [...t.entries];
      if (entryIndex >= 0 && entryIndex < entries.length) entries[entryIndex] = { ...entries[entryIndex], time: newTime, endTime: newEndTime };
      return { ...t, entries };
    }));
  }, []);
  const handlePickChaserForTrack = useCallback((trackId: string, chaserId: string, chaserName?: string) => {
    handleInsertChaserToTrack(trackId, 0, chaserId, chaserName);
    setChaserPickModal(null);
  }, [handleInsertChaserToTrack]);

  const resetTracks = useCallback(() => {
    setEfxTracks([]); setColorTracks([]); setStrobeTracks([]);
    setDimmerTracks([]); setChaserTracks([]); setFixtureTracks([]);
  }, []);

  return {
    // state
    efxTracks, setEfxTracks, colorTracks, setColorTracks, strobeTracks, setStrobeTracks,
    dimmerTracks, setDimmerTracks, chaserTracks, setChaserTracks, fixtureTracks, setFixtureTracks,
    // efx
    handleAddEfxTrack, handleEfxTrackContextMenu, handleEfxEntryContextMenu, handleRemoveEfxTrack,
    handleRemoveEfxEntry, handleInsertEfxToTrack, handleEfxEntryChange,
    efxTrackModal, setEfxTrackModal, efxTrackName, setEfxTrackName, efxTargetType, setEfxTargetType,
    efxTargetGroupId, setEfxTargetGroupId, efxTargetFixtureIds, setEfxTargetFixtureIds,
    efxCustomEffectId, setEfxCustomEffectId, efxContextMenu, setEfxContextMenu, efxEntryMenu, setEfxEntryMenu,
    // color
    handleAddColorTrack, handleColorTrackContextMenu, handleColorEntryContextMenu, handleRemoveColorTrack,
    handleRemoveColorEntry, handleInsertColorToTrack, handleColorEntryChange,
    colorTrackModal, setColorTrackModal, colorTrackName, setColorTrackName, colorTargetType, setColorTargetType,
    colorTargetGroupId, setColorTargetGroupId, colorTargetFixtureIds, setColorTargetFixtureIds,
    colorContextMenu, setColorContextMenu, colorEntryMenu, setColorEntryMenu,
    // strobe
    handleAddStrobeTrack, handleStrobeTrackContextMenu, handleStrobeEntryContextMenu, handleDeleteStrobeTrack,
    handleInsertStrobeToTrack, handleRemoveStrobeEntry, handleStrobeEntryChange,
    strobeTrackModal, setStrobeTrackModal, strobeTrackName, setStrobeTrackName, strobeTargetType, setStrobeTargetType,
    strobeTargetGroupId, setStrobeTargetGroupId, strobeTargetFixtureIds, setStrobeTargetFixtureIds,
    strobeMenu, setStrobeMenu, strobeEntryMenu, setStrobeEntryMenu,
    // dimmer
    handleAddDimmerTrack, handleDimmerTrackContextMenu, handleDimmerEntryContextMenu, handleDeleteDimmerTrack,
    handleInsertDimmerToTrack, handleRemoveDimmerEntry, handleDimmerEntryChange, handleAddDimmerTrackFromModal,
    dimmerTrackModal, setDimmerTrackModal, dimmerTrackName, setDimmerTrackName, dimmerTargetType, setDimmerTargetType,
    dimmerTargetGroupId, setDimmerTargetGroupId, dimmerTargetFixtureIds, setDimmerTargetFixtureIds,
    dimmerInsertMenu, setDimmerInsertMenu, dimmerEntryMenu, setDimmerEntryMenu,
    // chaser
    handleAddChaserTrack, handleChaserTrackContextMenu, handleChaserEntryContextMenu, handleDeleteChaserTrack,
    handleInsertChaserToTrack, handleRemoveChaserEntry, handleChaserEntryChange, handlePickChaserForTrack,
    chaserInsertMenu, setChaserInsertMenu, chaserEntryMenu, setChaserEntryMenu, chaserPickModal, setChaserPickModal,
    // helpers
    fixtureGroups, effects, chasers, resetTracks,
  };
}

export type TimelineTracks = ReturnType<typeof useTimelineTracks>;
