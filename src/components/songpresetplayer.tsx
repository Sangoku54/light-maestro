/**
 * SongPresetPlayer — full live playback of a saved Song Preset for the
 * Virtual Console "Play Preset" widget.
 *
 * Unlike the old discrete-cue snapshot playback, this uses the same
 * `useDmxPlayback` engine as QuickShow's live playback, fed with the preset's
 * authored sections + every track type (fixture / color / strobe / dimmer / EFX)
 * + manual cues. Movement animates continuously (30fps), so the widget plays the
 * preset "intégralement" — including user-added tracks.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useShowStore, type SongPreset } from '../stores/showStore';
import { loadFixtureDefinitions } from '../hooks/dmx-cues';
import { useDmxPlayback } from '../hooks/dmx-playback';
import { genCues } from '../views/QuickShowView';

/**
 * Resolve the playback clock for one frame.
 *
 * Rule: a playback clock must NEVER depend on a single unguaranteed source
 * (an audio element may be missing, still decoding, or blocked by autoplay
 * policy). When the audio does not actually play, the virtual wall-clock
 * takes over so the show ALWAYS advances.
 */
export function resolvePlaybackTime(
  hasAudio: boolean,
  audioPaused: boolean,
  audioCurrentTime: number,
  startWallMs: number,
  nowMs: number,
): number {
  if (hasAudio && !audioPaused) {
    return audioCurrentTime;
  }
  return (nowMs - startWallMs) / 1000;
}

function zeroDmx() {
  try {
    const dmx = (window as any).lightMaestro?.dmx;
    if (!dmx) return;
    const z: Record<number, number> = {};
    for (let i = 1; i <= 512; i++) z[i] = 0;
    const s = useShowStore.getState();
    const uniIds = s.universes.map((u: any) => String(u.id));
    for (const pf of s.patchedFixtures) {
      const uniNum = uniIds.indexOf(pf.universeId) >= 0 ? uniIds.indexOf(pf.universeId) : 0;
      try { dmx.setChannels(uniNum, z); } catch {}
    }
  } catch {}
}

export const SongPresetPlayer: React.FC<{
  preset: SongPreset;
  onEnded: () => void;
}> = ({ preset, onEnded }) => {
  const patchedFixtures = useShowStore((s) => s.patchedFixtures);
  const universes = useShowStore((s) => s.universes);
  const fixtureGroups = useShowStore((s) => s.fixtureGroups);
  const effects = useShowStore((s) => s.effects);

  const [cues, setCues] = useState<any[]>([]);
  const [defs, setDefs] = useState<Map<string, any>>(new Map());
  const currentTimeRef = useRef(0);
  const totalDurRef = useRef(0);

  const overrideCuesRef = useRef<any[]>([]);
  const fixtureTracksRef = useRef<any[]>([]);
  const efxTracksRef = useRef<any[]>([]);
  const effectsRef = useRef<any[]>([]);
  const fixtureGroupsRef = useRef<any[]>([]);
  const colorTracksRef = useRef<any[]>([]);
  const strobeTracksRef = useRef<any[]>([]);
  const dimmerTracksRef = useRef<any[]>([]);
  const chaserTracksRef = useRef<any[]>([]);
  const chasersRef = useRef<any[]>([]);
  const scenesRef = useRef<any[]>([]);

  // Keep live store refs in sync (used by the playback engine each frame)
  effectsRef.current = effects || [];
  fixtureGroupsRef.current = fixtureGroups || [];
  chasersRef.current = useShowStore.getState().chasers || [];
  scenesRef.current = useShowStore.getState().scenes || [];

  // Build the cue list (from authored sections) + load fixture defs on mount
  useEffect(() => {
    let alive = true;
    const qs = (preset.quickShow as any) || {};
    const analysis = (preset.trackAnalysis as any) || undefined;
    const bpm = analysis?.bpm || 120;
    const beatDivision = qs.beatDivision || 4;
    const key = (qs as any).regenSeed ?? 0;

    overrideCuesRef.current = [];
    fixtureTracksRef.current = (preset as any).fixtureTracks || [];
    efxTracksRef.current = preset.efxTracks || [];
    colorTracksRef.current = preset.colorTracks || [];
    strobeTracksRef.current = preset.strobeTracks || [];
    dimmerTracksRef.current = preset.dimmerTracks || [];
    chaserTracksRef.current = (preset as any).chaserTracks || [];

    let cueList: any[] = [];
    try {
      cueList = genCues(preset.sections || [], bpm, beatDivision, qs, preset.manualCues || [], key, analysis);
    } catch (e) {
      console.error('SongPresetPlayer: genCues failed', e);
    }
    if (alive) setCues(cueList);

    // Total show duration = max(cue ends, all track entry ends) — used to end
    // playback when there is no playable audio clock.
    let maxEnd = 0;
    for (const c of cueList) maxEnd = Math.max(maxEnd, Number(c?.endTime ?? c?.time ?? 0));
    for (const trs of [
      (preset as any).chaserTracks,
      preset.colorTracks,
      preset.dimmerTracks,
      preset.strobeTracks,
      preset.efxTracks,
      preset.fixtureTracks,
    ]) {
      for (const t of Array.isArray(trs) ? trs : []) {
        for (const e of (t as any)?.entries || []) maxEnd = Math.max(maxEnd, Number(e?.endTime ?? 0));
      }
    }
    totalDurRef.current = maxEnd;

    (async () => {
      const fitState = useShowStore.getState();
      if (fitState.patchedFixtures?.length) {
        try {
          const d = await loadFixtureDefinitions(
            fitState.patchedFixtures.map((f: any) => f.fixtureDefId)
          );
          if (alive) setDefs(d);
        } catch (e) {
          console.error('SongPresetPlayer: loadFixtureDefinitions failed', e);
        }
      }
    })();

    return () => {
      alive = false;
    };
  }, [preset]);

  // Playback clock: the audio element drives the time when it actually plays,
  // otherwise a virtual wall-clock takes over so the show ALWAYS advances
  // (audio data may be missing, still decoding, or blocked by autoplay policy).
  useEffect(() => {
    const audio = preset.audioFileBase64 ? new Audio(preset.audioFileBase64) : null;
    let rafId = 0;
    let hasAudio = false;
    const startWall = performance.now();

    const stop = () => {
      cancelAnimationFrame(rafId);
      zeroDmx();
      if (audio) { try { audio.pause(); } catch {} }
      onEnded();
    };

    if (audio) {
      audio.onended = stop;
      audio.onerror = () => { /* keep virtual clock running */ };
      audio.play().then(() => {
        hasAudio = true;
        // Re-align a late-starting audio element onto the virtual clock
        const elapsed = (performance.now() - startWall) / 1000;
        try {
          if (audio.readyState >= 1 && audio.duration > 0 && Math.abs(audio.currentTime - elapsed) > 0.1) {
            audio.currentTime = Math.min(Math.max(0, elapsed), Math.max(0, audio.duration - 0.05));
          }
        } catch { /* ignore seek errors */ }
      }).catch(() => { /* keep virtual clock running */ });
    }

    const raf = () => {
      currentTimeRef.current = resolvePlaybackTime(
        hasAudio,
        audio ? audio.paused : true,
        audio ? audio.currentTime : 0,
        startWall,
        performance.now(),
      );
      // End of show: stop when the authored duration is reached
      const total = totalDurRef.current;
      if (total > 0 && currentTimeRef.current >= total) { stop(); return; }
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(rafId);
      zeroDmx();
      if (audio) { try { audio.pause(); } catch {} }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  // The full live playback engine (same one QuickShow uses)
  useDmxPlayback({
    isPlaying: true,
    currentTimeRef,
    cues,
    patchedFixtures,
    fixtureDefs: defs,
    universes,
    dmxOutputEnabled: true,
    overrideCuesRef,
    fixtureTracksRef,
    efxTracksRef,
    effectsRef,
    fixtureGroupsRef,
    colorTracksRef,
    strobeTracksRef,
    dimmerTracksRef,
    chaserTracksRef,
    chasersRef,
    scenesRef,
  });

  return null;
};
