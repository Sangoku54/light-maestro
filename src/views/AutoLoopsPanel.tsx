import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Play, Square, Palette } from 'lucide-react';
import { useShowStore } from '../stores/showStore';
import { useAppStore } from '../stores/appStore';
import {
  loadFixtureDefinitions,
  computeDmxCues,
  type DmxFixtureDefinition,
  type DmxCue,
} from '../hooks/dmx-cues';
import { generateThemeLoop, THEME_LOOP_PRESETS } from '../engine/theme-loop';
import { purgeAutoLoops } from '../engine/auto-loops';
import { dmxBridge } from '../utils/dmx-bridge';

/**
 * AutoLoopsPanel — « Boucle unique », à la façon de l'autoscript.
 *
 * Une SEULE boucle déterministe (thème fixe = palette + mouvement + bpm),
 * sans analyse audio, sans ambiance, sans détection de tempo. La boucle est
 * une séquence de cues (comme l'autoscript) : cue.color est la couleur du bloc,
 * et computeDmxCues() joue exactement cette couleur. Les blocs affichés
 * ci-dessous SONT la couleur jouée (source unique = cue.color).
 */

/** Write one frame (all universes of one cue) to the bridge + 3D mirror. */
function writeFrame(dmxs: DmxCue[]) {
  for (const dc of dmxs) {
    try {
      dmxBridge.write('vc', dc.universe, dc.channelValues);
    } catch {}
    try {
      useAppStore.getState().setUniverseData(dc.universe, dc.channelValues);
    } catch {}
  }
}

/** Darken every patched universe (transient zeros so hardware actually fades out). */
function zeroAllUniverses() {
  const s = useShowStore.getState();
  const uniIds = s.universes.map((u) => String(u.id));
  const z: Record<number, number> = {};
  for (let i = 1; i <= 512; i++) z[i] = 0;
  const seen = new Set<number>();
  for (const pf of s.patchedFixtures) {
    const uniNum = uniIds.includes(pf.universeId) ? uniIds.indexOf(pf.universeId) : 0;
    if (seen.has(uniNum)) continue;
    seen.add(uniNum);
    try {
      dmxBridge.writeTransient('vc', uniNum, z);
    } catch {}
    try {
      useAppStore.getState().setUniverseData(uniNum, z);
    } catch {}
  }
}

export const AutoLoopsPanel: React.FC = () => {
  const { t } = useTranslation();
  const patchedFixtures = useShowStore((s) => s.patchedFixtures);
  const universes = useShowStore((s) => s.universes);
  const mode = useAppStore((s) => s.mode);
  const quickTab = useAppStore((s) => s.quickSidebarTab);

  const [fixtureDefs, setFixtureDefs] = useState<Map<string, DmxFixtureDefinition>>(new Map());
  const [themeName, setThemeName] = useState<string>(THEME_LOOP_PRESETS[0]?.name ?? 'Violet');
  const [playing, setPlaying] = useState(false);
  const [cueIdx, setCueIdx] = useState(0);

  const intervalRef = useRef<number>(0);
  const frameIdxRef = useRef(0);

  // Load fixture definitions for the patched fixtures.
  useEffect(() => {
    if (patchedFixtures.length === 0) {
      setFixtureDefs(new Map());
      return;
    }
    let cancelled = false;
    loadFixtureDefinitions([...new Set(patchedFixtures.map((f) => f.fixtureDefId))])
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

  const theme = useMemo(
    () => THEME_LOOP_PRESETS.find((p) => p.name === themeName) ?? THEME_LOOP_PRESETS[0],
    [themeName],
  );
  const cues = useMemo(() => generateThemeLoop(theme), [theme]);
  const universeIds = useMemo(() => universes.map((u) => String(u.id)), [universes]);

  const dmxCues = useMemo(() => {
    if (patchedFixtures.length === 0 || fixtureDefs.size === 0) return [];
    return computeDmxCues({ cues, patchedFixtures, fixtureDefs, universeIds });
  }, [cues, patchedFixtures, fixtureDefs, universeIds]);

  // Group dmxCues into frames (one frame per cue; one entry per universe).
  const frames = useMemo<DmxCue[][]>(() => {
    const out: DmxCue[][] = [];
    let cur: DmxCue[] = [];
    let last = -1;
    for (const dc of dmxCues) {
      if (last !== -1 && Math.abs(dc.time - last) > 0.0001) {
        out.push(cur);
        cur = [];
      }
      cur.push(dc);
      last = dc.time;
    }
    if (cur.length > 0) out.push(cur);
    return out;
  }, [dmxCues]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = 0;
      // Only darken if a loop was actually running — an unrelated mount /
      // patch-change stop must NOT blackout the hardware (LTP vc=80 would
      // override the HTP QuickShow output for ~2 s).
      zeroAllUniverses();
    }
    frameIdxRef.current = 0;
    setCueIdx(0);
    setPlaying(false);
  }, []);

  const play = useCallback(() => {
    if (frames.length === 0) return;
    stop();
    frameIdxRef.current = 0;
    writeFrame(frames[0]);
    setCueIdx(0);
    setPlaying(true);
    const beatMs = Math.max(50, Math.round((60 / (theme.bpm ?? 120)) * 1000));
    intervalRef.current = window.setInterval(() => {
      const next = (frameIdxRef.current + 1) % frames.length;
      frameIdxRef.current = next;
      writeFrame(frames[next]);
      setCueIdx(next);
    }, beatMs);
  }, [frames, theme, stop]);

  const patchKey = useMemo(
    () =>
      patchedFixtures
        .map((f) => `${f.id}|${f.universeId}|${f.startAddress}|${f.enabled === false ? 0 : 1}`)
        .join(';'),
    [patchedFixtures],
  );

  // Purge any stale auto-loop chasers left from the previous library + stop.
  useEffect(() => {
    stop();
    purgeAutoLoops(useShowStore.getState());
  }, [patchKey, stop]);

  // The views stay mounted and are only hidden via `display:none`
  // (QuickShowView switches tabs without unmounting, App switches modes the
  // same way). So the loop's setInterval would keep writing 'vc' (LTP 80)
  // forever and mask the timeline playback ('quickshow', HTP 40) — the
  // "toujours la même couleur" bug. Stop + release 'vc' as soon as this
  // panel is no longer the visible one (no blackout: the timeline must be
  // able to take over immediately).
  const visible = mode === 'quick' && quickTab === 'loops';
  useEffect(() => {
    if (visible) return;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = 0;
      frameIdxRef.current = 0;
      setCueIdx(0);
      setPlaying(false);
      try { dmxBridge.release('vc'); } catch {}
    }
  }, [visible]);

  // On unmount: stop and clean up.
  useEffect(() => {
    return () => {
      stop();
      purgeAutoLoops(useShowStore.getState());
    };
  }, [stop]);

  if (patchedFixtures.length === 0) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="flex flex-col items-center justify-center h-full text-center gap-2 text-gray-500">
          <Sparkles className="w-8 h-8 text-gray-600" />
          <p className="text-sm">Aucune fixture patchée.</p>
          <p className="text-xs text-gray-600">
            Patch des fixtures dans l'onglet Setup pour générer la boucle automatique.
          </p>
        </div>
      </div>
    );
  }

  const beatMs = Math.max(50, Math.round((60 / (theme.bpm ?? 120)) * 1000));

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-purple-400" />
          <h2 className="text-sm font-semibold text-gray-200">{t('sidebar.autoLoops') || 'Boucle unique'}</h2>
          <span className="text-[10px] text-gray-500 bg-gray-800 rounded-full px-2 py-0.5">1</span>
        </div>
        <select
          value={themeName}
          onChange={(e) => {
            stop();
            setThemeName(e.target.value);
          }}
          className="bg-gray-800 border border-gray-700 rounded-md px-2 py-1 text-xs text-gray-200 outline-none"
        >
          {THEME_LOOP_PRESETS.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Loop card */}
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Palette className="w-4 h-4 text-purple-400" />
              <span className="text-sm text-gray-200 font-medium">{theme.name}</span>
            </div>
            <span className="text-[10px] text-gray-500">
              {cues.length} cues · {theme.bpm ?? 120} BPM · sans audio
            </span>
          </div>
          <div className="flex items-center gap-1.5 mb-3">
            {theme.palette.map((c, i) => (
              <span
                key={i}
                className="w-5 h-5 rounded-full border border-white/20"
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
          <button
            onClick={playing ? stop : play}
            disabled={frames.length === 0}
            className={
              'w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ' +
              (playing
                ? 'bg-rose-600/20 text-rose-300 border border-rose-600/40'
                : 'bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed')
            }
          >
            {playing ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {playing ? 'Arrêter' : 'Jouer la boucle'}
          </button>
        </div>

        {/* Cue blocks (the "timeline") — colour shown == colour played */}
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
          <div className="text-[10px] text-gray-500 mb-2 uppercase tracking-wide">
            Blocs de cues · palette du thème (teinte par tier appliquée comme dans la timeline)
          </div>
          <div className="flex gap-1 overflow-x-auto pb-1">
            {cues.map((c, i) => (
              <div
                key={i}
                className={
                  'shrink-0 w-6 h-8 rounded-sm border transition-all ' +
                  (i === cueIdx && playing ? 'ring-2 ring-white scale-110' : 'border-white/10')
                }
                style={{ backgroundColor: c.color }}
                title={`#${i + 1} · ${c.color}`}
              />
            ))}
          </div>
          <div className="flex items-center justify-between text-[10px] text-gray-600 mt-2">
            <span>
              {playing ? `Cue ${cueIdx + 1}/${cues.length}` : 'En attente'}
            </span>
            <span>{beatMs} ms/cue</span>
          </div>
        </div>

        <p className="text-[10px] text-gray-600 text-center pb-2">
          Une seule boucle, thème fixe, sans audio · les couleurs jouées correspondent aux blocs ci-dessus
        </p>
      </div>
    </div>
  );
};
