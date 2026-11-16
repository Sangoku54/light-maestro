/**
 * Virtual Console — runtime des actions « playback ».
 *
 * Ces actions vivaient dans le composant React `VCButtonWidget`
 * (src/views/PerformanceView.tsx), sous forme de closures + `useState`/`useRef`
 * locaux. Conséquence : elles n'existaient QUE si la tuile était montée
 * (page VC active). D'où deux limitations :
 *   - le pilotage MIDI ne marchait que si la console était à l'écran
 *     (avertissement dans `midi-actions.ts`) ;
 *   - le Remote LAN (télécommande) ne pouvait pas les déclencher du tout
 *     (`vcButtonPress` renvoyait `false`).
 *
 * Ce module sort la logique du composant React :
 *   - l'état de lecture (preset actif, audio, rAF, mutex audio) vit au niveau
 *     module — donc indépendant de ce qui est affiché ;
 *   - `vcPlaybackPress(widgetId, press)` est le point d'entrée unique ;
 *   - le preset en cours est exposé par `vcPlaybackGetSongPreset()` ; un hôte
 *     unique (`<VcPlaybackHost>`) le rend via `<SongPresetPlayer>`.
 *
 * Dépendances **unidirectionnelles** : ce module n'importe JAMAIS
 * `virtual-console-runtime.ts` (c'est l'inverse). `virtual-console-runtime.ts`
 * délègue ici les actions playback et notifie le registre `activeIds`.
 *
 * ─── CONTRAT ────────────────────────────────────────────────────────────────
 * `vcPressWidget(widgetId, press)` (dans virtual-console-runtime.ts) est le
 * point d'entrée public. `vcPlaybackPress` implémente la famille « playback ».
 */

import { useShowStore, findBestSongPreset, type SongPreset } from '../stores/showStore';
import { usePerformStore, type ConsoleWidget } from '../stores/performStore';
import { dmxBridge } from '../utils/dmx-bridge';
import { decodeAudioUrl, normalizeAudioUrl } from '../utils/audio-cache';
import { loadFixtureDefinitions, type CueInput } from '../hooks/dmx-cues';
import { computeDmxForCue } from '../hooks/dmx-playback';
import { analyzeAudioBuffer, type TrackAnalysis } from '../hooks/audio-analysis';
import { startAutoLoop, stopAutoLoop } from './auto-loop-player';
import { startBankLoop, stopBankLoop } from './bank-loop-player';
import i18n from '../i18n';

// ═══════════════════════════════════════════════════════════
// Mutex audio — une seule source audio à la fois (toutes tuiles)
// ═══════════════════════════════════════════════════════════

type AudioPlaybackController = {
  stop: () => void;
  widgetId: string;
};

const _activeAudioRegistry: AudioPlaybackController[] = [];

/** Stoppe et désenregistre TOUTES les lectures audio en cours. */
export function stopAllAudioPlayback(): void {
  for (const ctl of _activeAudioRegistry.splice(0)) {
    try { ctl.stop(); } catch { /* best effort */ }
  }
  // Arrête aussi la lecture de show globale (widget loadShow).
  if (typeof window !== 'undefined' && (window as any).__lm_perfPlayActive) {
    try { (window as any).__lm_perfStopPlayback?.(); } catch { /* best effort */ }
  }
}

/** Enregistre une nouvelle lecture audio (stoppe les autres d'abord). */
export function registerAudioPlayback(widgetId: string, stop: () => void): () => void {
  stopAllAudioPlayback();
  const ctl: AudioPlaybackController = { stop, widgetId };
  _activeAudioRegistry.push(ctl);
  return () => {
    const idx = _activeAudioRegistry.indexOf(ctl);
    if (idx >= 0) _activeAudioRegistry.splice(idx, 1);
  };
}

// ═══════════════════════════════════════════════════════════
// Mise à zéro des univers (fin de lecture)
// ═══════════════════════════════════════════════════════════

/**
 * Envoie un zéro transitoire sur chaque univers patché (flush matériel puis
 * relâche de la source après 2 s pour que le moteur reprenne la main).
 * Remplace le zéro permanent qui laissait le show noir après un arrêt banal.
 */
export function vcZeroAllUniverses(): void {
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
      try { dmxBridge.writeTransient('vc', uniNum, z); } catch { /* best effort */ }
    }
  } catch { /* best effort */ }
}

// ═══════════════════════════════════════════════════════════
// Registre des tuiles « allumées » (feedback LED + Remote)
// ═══════════════════════════════════════════════════════════

const activeIds = new Set<string>();
const activeListeners = new Set<(widgetId: string, active: boolean) => void>();

function notifyActive(widgetId: string, active: boolean): void {
  for (const cb of activeListeners) {
    try { cb(widgetId, active); } catch { /* listener défaillant */ }
  }
}

/**
 * Marque une tuile comme active/inactive. Utilisé par la famille « simple »
 * (virtual-console-runtime) pour un registre unifié.
 */
export function vcPlaybackSetActive(widgetId: string, active: boolean): void {
  const was = activeIds.has(widgetId);
  if (was === active) return;
  if (active) activeIds.add(widgetId);
  else activeIds.delete(widgetId);
  notifyActive(widgetId, active);
}

/** La tuile est-elle « allumée » (run ou lecture en cours) ? */
export function vcPlaybackIsActive(widgetId: string): boolean {
  return activeIds.has(widgetId);
}

/** Ids de toutes les tuiles allumées (instantané pour le snapshot Remote). */
export function vcPlaybackActiveIds(): string[] {
  return [...activeIds];
}

/** Abonnement aux changements d'état « allumée ». */
export function vcPlaybackSubscribe(cb: (widgetId: string, active: boolean) => void): () => void {
  activeListeners.add(cb);
  return () => { activeListeners.delete(cb); };
}

// ═══════════════════════════════════════════════════════════
// État de lecture
// ═══════════════════════════════════════════════════════════

interface PlaybackState {
  /** Preset en cours (playSong) — rendu par <VcPlaybackHost>. */
  songPreset: SongPreset | null;
  /** Widget-id propriétaire de la lecture preset. */
  songPresetWidgetId: string | null;
  /** Handle audio de l'audioAutoScript en cours. */
  autoAudio: { stop: () => void } | null;
  /** rAF de l'audioAutoScript. */
  autoRaf: number;
  /** Désabonnement du mutex audio. */
  unregisterAudio: (() => void) | null;
  /** Régénération de cues en cours (garde anti double-clic). */
  regenerating: boolean;
  /** Intention de lecture (annulée si l'utilisateur reclique pendant la régén). */
  playIntent: boolean;
}

const state: PlaybackState = {
  songPreset: null,
  songPresetWidgetId: null,
  autoAudio: null,
  autoRaf: 0,
  unregisterAudio: null,
  regenerating: false,
  playIntent: false,
};

const songListeners = new Set<(preset: SongPreset | null) => void>();

function notifySong(preset: SongPreset | null): void {
  for (const cb of songListeners) {
    try { cb(preset); } catch { /* listener défaillant */ }
  }
}

/** Preset en cours de lecture (null si aucun). */
export function vcPlaybackGetSongPreset(): SongPreset | null {
  return state.songPreset;
}

/** Abonnement au changement de preset en cours. */
export function vcPlaybackSubscribeSong(cb: (preset: SongPreset | null) => void): () => void {
  songListeners.add(cb);
  return () => { songListeners.delete(cb); };
}

/** Fin naturelle du preset (le player a fini) → on éteint la tuile. */
export function vcPlaybackSongEnded(): void {
  const widgetId = state.songPresetWidgetId;
  state.songPreset = null;
  state.songPresetWidgetId = null;
  notifySong(null);
  if (widgetId) vcPlaybackSetActive(widgetId, false);
}

/** Réinitialisation complète (changement de projet, purge). */
export function vcPlaybackReset(): void {
  try { stopAllAudioPlayback(); } catch { /* best effort */ }
  if (state.autoRaf) {
    try { cancelAnimationFrame(state.autoRaf); } catch { /* noop */ }
  }
  state.autoRaf = 0;
  state.autoAudio = null;
  state.unregisterAudio = null;
  state.regenerating = false;
  state.playIntent = false;
  state.songPreset = null;
  state.songPresetWidgetId = null;
  notifySong(null);
  for (const id of [...activeIds]) vcPlaybackSetActive(id, false);
}

// ═══════════════════════════════════════════════════════════
// audioAutoScript — génération des cues depuis l'analyse audio
// ═══════════════════════════════════════════════════════════

/**
 * Génère les cues (mirroring de QuickShow) pour l'audioAutoScript.
 * Déplacé depuis `PerformanceView.genCuesLocal` pour que le runtime playback
 * n'ait plus besoin de la vue.
 */
export function genCuesLocal(a: TrackAnalysis): CueInput[] {
  const cues: CueInput[] = [];
  if (!a.sections || a.sections.length === 0) return cues;

  const bpm = a.bpm || 120;
  const beatDuration = 60 / bpm;
  const barDuration = beatDuration * 4; // 4/4
  const sceneDuration = barDuration * 2; // 2 mesures par scène

  const PALETTES: Record<string, string[]> = {
    intro:  ['#1a5276', '#2980b9', '#3498db', '#5dade2', '#85c1e9'],
    verse:  ['#6c3483', '#8e44ad', '#a569bd', '#bb8fce', '#d2b4de'],
    chorus: ['#922b21', '#c0392b', '#e74c3c', '#f1948a', '#f5b7b1'],
    bridge: ['#0e6251', '#117a65', '#148f77', '#1abc9c', '#48c9b0'],
    drop:   ['#ffffff', '#f39c12', '#e67e22', '#d35400', '#ff0000'],
    outro:  ['#1b2631', '#2c3e50', '#5d6d7e', '#85929e', '#aeb6bf'],
  };

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

    let sceneTime = sectionStart;
    let sceneIdx = 0;
    while (sceneTime < sectionEnd) {
      const nextSceneTime = Math.min(sceneTime + sceneDuration, sectionEnd);

      const eCurve = a.energyCurve;
      const eCurveLen = eCurve?.length || 1;
      const energyIdx = Math.min(
        Math.floor((sceneTime / a.duration) * eCurveLen),
        eCurveLen - 1,
      );
      const localEnergy = eCurve?.[energyIdx] ?? sectionEnergy;

      const intensity = localEnergy > 0.7 ? 'high' : localEnergy > 0.4 ? 'medium' : 'low';
      const isStrobeSection = section.type === 'drop' ||
        (section.type === 'chorus' && localEnergy > 0.65);
      const colorIndex = (globalCueIdx + sceneIdx) % colors.length;

      const cuesPerScene = 4;
      for (let i = 0; i < cuesPerScene; i++) {
        const cueTime = sceneTime + (i / cuesPerScene) * (nextSceneTime - sceneTime);

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
// Actions playback
// ═══════════════════════════════════════════════════════════

/** Lance la lecture audio + le script DMX de l'audioAutoScript. */
function startAudioAutoScript(widgetId: string, config: any, cues: any[]): void {
  if (!cues || cues.length === 0) {
    console.warn('[VC audioAutoScript] aucun cue à jouer');
    return;
  }
  console.log('[VC audioAutoScript] démarrage', config.audioFileName, 'cues:', cues.length);

  let audioCtx: AudioContext | null = null;
  let audioSrc: AudioBufferSourceNode | null = null;
  const audioPlayOffset = 0;

  const stopAudio = () => {
    try { audioSrc?.stop(); } catch { /* noop */ }
    try { audioCtx?.close(); } catch { /* noop */ }
    audioSrc = null;
    audioCtx = null;
  };

  state.autoAudio = { stop: stopAudio };
  state.unregisterAudio = registerAudioPlayback(widgetId, () => {
    try { cancelAnimationFrame(state.autoRaf); } catch { /* noop */ }
    state.autoRaf = 0;
    stopAudio();
    state.autoAudio = null;
    vcZeroAllUniverses();
    vcPlaybackSetActive(widgetId, false);
  });

  let startTime = 0;
  let firstFrameDone = false;
  const firedCues = new Set<string>();

  // Le moteur DMX doit tourner (et le fail-safe blackout levé) avant la
  // première frame, sinon les écritures partent dans le vide.
  void (async () => {
    try {
      const api = (window as any).lightMaestro?.dmx;
      if (api) {
        const running = await api.isRunning().catch(() => false);
        if (!running) await api.start().catch(() => {});
      }
    } catch { /* silencieux */ }
  })();

  const fireAutoDmx = () => {
    const elapsed = (performance.now() - startTime) / 1000;
    if (!firstFrameDone) {
      firstFrameDone = true;
      vcZeroAllUniverses();
    }
    for (const cue of cues) {
      const key = `${cue.time.toFixed(2)}-${cue.universe}`;
      if (firedCues.has(key)) continue;
      if (elapsed >= cue.time && Object.keys(cue.channelValues).length > 0) {
        firedCues.add(key);
        try { dmxBridge.write('vc', cue.universe, cue.channelValues); } catch { /* noop */ }
      }
    }
    const playing = audioSrc !== null ||
      (performance.now() - startTime) < (cues[cues.length - 1]?.time ?? 0) * 1000 + 2000;
    if (playing) state.autoRaf = requestAnimationFrame(fireAutoDmx);
  };

  const beginPlayback = () => {
    startTime = performance.now();
    fireAutoDmx();
  };

  void (async () => {
    try {
      audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      const buffer = await decodeAudioUrl(config.audioDataUrl);
      if (!buffer || !audioCtx || audioCtx.state === 'closed') { beginPlayback(); return; }
      audioSrc = audioCtx.createBufferSource();
      audioSrc.buffer = buffer;
      audioSrc.connect(audioCtx.destination);
      audioSrc.onended = () => {
        try { cancelAnimationFrame(state.autoRaf); } catch { /* noop */ }
        state.autoRaf = 0;
        vcZeroAllUniverses();
        state.autoAudio = null;
        if (state.unregisterAudio) { state.unregisterAudio(); state.unregisterAudio = null; }
        vcPlaybackSetActive(widgetId, false);
      };
      audioSrc.start(0, audioPlayOffset);
      beginPlayback();
    } catch {
      // Audio en échec — on joue quand même le script DMX sur l'horloge virtuelle.
      beginPlayback();
    }
  })();
}

/** Régénère les cues puis démarre l'audioAutoScript (le cas échéant). */
async function activateAudioAutoScript(widgetId: string, config: any): Promise<void> {
  if (state.regenerating) return;
  state.regenerating = true;
  state.playIntent = true;

  try {
    // 1. S'assurer que le moteur DMX est prêt.
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
          console.log('[VC audioAutoScript] moteur DMX prêt');
        }
      } catch { /* silencieux */ }
    }

    // 2. Analyse audio (mise en cache dans la config si absente).
    let analysis = config.audioAnalysis;
    if (!analysis?.sections?.length) {
      console.log('[VC audioAutoScript] ré-analyse de l\'audio');
      const resp = await fetch(normalizeAudioUrl(config.audioDataUrl) as string);
      const buf = await resp.arrayBuffer();
      const ctx = new AudioContext();
      const ab = await ctx.decodeAudioData(buf);
      analysis = await analyzeAudioBuffer(ab, config.audioFileName || 'audio.mp3', buf.byteLength);
      ctx.close();
      config.audioAnalysis = analysis;
    }

    // 3. Génération des cues DMX.
    const fitState = useShowStore.getState();
    if (!fitState.patchedFixtures?.length) {
      console.warn('[VC audioAutoScript] aucune fixture patchée');
      if (state.playIntent) startAudioAutoScript(widgetId, config, config.audioCues ?? []);
      return;
    }
    const defs = await loadFixtureDefinitions(
      fitState.patchedFixtures.map((f: any) => f.fixtureDefId),
    );
    const cueInputs = genCuesLocal(analysis);
    const cues: any[] = [];
    for (const ci of cueInputs) {
      for (const r of computeDmxForCue(
        ci as any,
        fitState.patchedFixtures,
        defs,
        fitState.universes,
      )) {
        cues.push({
          time: ci.time,
          section: ci.section,
          universe: r.universe,
          channelValues: r.channelValues,
          fixtureNames: [],
          fixtureCount: fitState.patchedFixtures.length,
          effect: ci.effect,
          colors: ci.colors,
        });
      }
    }
    config.audioCues = cues;
    console.log('[VC audioAutoScript]', cues.length, 'cues régénérés');
    if (state.playIntent) startAudioAutoScript(widgetId, config, cues);
  } catch (err) {
    console.error('[VC audioAutoScript] régénération échouée, repli', err);
    if (state.playIntent) startAudioAutoScript(widgetId, config, config.audioCues ?? []);
  } finally {
    state.regenerating = false;
  }
}

/** Active le widget « loadShow » (lecture d'un show depuis un fichier). */
async function activateLoadShow(widgetId: string, config: any): Promise<void> {
  try {
    // Toggle : si déjà en lecture → arrêt.
    if ((window as any).__lm_perfPlayActive) {
      (window as any).__lm_perfStopPlayback?.();
      stopAllAudioPlayback();
      return;
    }
    stopAllAudioPlayback();

    let p = config.showData;
    if (!p) {
      const storeShows = useShowStore.getState().shows;
      p = storeShows.find((s: any) =>
        s.name === config.showName || s.id === config.showId,
      ) as any;
    }
    if (!p) {
      const r = await window.lightMaestro?.dialog?.openFile?.([{
        name: i18n.t('dialogs.filterShow'),
        extensions: ['lmshow', 'lmproj'],
      }]);
      if (!r?.content) return;
      p = JSON.parse(r.content);
    }

    const { importCustomFixtureDefs } = await import('../utils/custom-fixtures');
    await importCustomFixtureDefs(p?.customFixtures);
    const s = useShowStore.getState();
    if (p.scenes) s.setScenes(p.scenes);
    if (p.chasers) s.setChasers(p.chasers);
    if (p.cueLists) s.setCueLists(p.cueLists);
    if (p.effects) {
      s.setEffects(p.effects.map((e: any) => ({
        ...e,
        fixtureIds: e.fixtureIds || e.fixtures || [],
      })));
    }
    if (p.fixtureGroups || p.groups) s.setFixtureGroups(p.fixtureGroups || p.groups);
    if (p.universes) s.setShowUniverses(p.universes);
    if (p.patchedFixtures) {
      s.setPatchedFixtures(p.patchedFixtures);
    } else if (p.fixtures && Array.isArray(p.fixtures)) {
      s.setPatchedFixtures(p.fixtures.map((f: any) => ({
        id: f.id,
        fixtureDefId: f.definitionId || f.fixtureDefId,
        manufacturer: f.manufacturer || '',
        model: f.model || '',
        fixtureType: f.fixtureType || '',
        modeIndex: f.modeIndex ?? 0,
        modeName: f.modeName || '',
        universeId: typeof f.universe === 'number'
          ? `universe-${f.universe + 1}`
          : (f.universeId || 'universe-1'),
        startAddress: f.startAddress ?? 1,
        channelCount: f.channelCount ?? 1,
        name: f.name || '',
        tier: f.tier || 'primary',
      })));
    }
    const { loadFixturePositionsMeters } = await import('../utils/fixture-height');
    if (p.fixturePositions) {
      s.setFixturePositions(loadFixturePositionsMeters(p) ?? {});
    }
    if (p.songPresets) s.setSongPresets(p.songPresets);
    if (p.quickShow) (window as any).__lm_setQuickShow?.(p.quickShow);
    if (p.audioFileBase64 && p.audioFileName) {
      try {
        const resp = await fetch(p.audioFileBase64);
        const blob = await resp.blob();
        const file = new File([blob], p.audioFileName, { type: 'audio/wav' });
        (window as any).__lm_loadAudioFile?.(file);
      } catch { /* audio indisponible */ }
    }

    if (p.tracks || p.format?.startsWith('lightmaestro/show')) {
      const showData = {
        id: p.id || `loaded-${Date.now()}`,
        name: p.name || config.showName || 'Loaded Show',
        duration: p.duration ?? 60000,
        tracks: p.tracks || [],
        audioFileBase64: p.audioFileBase64,
        audioFileName: p.audioFileName,
      };
      s.setShows([...s.shows.filter((sh: any) => sh.id !== showData.id), showData]);
      (window as any).__lm_perfPlayActive = true;
      (window as any).__lm_perfPlayShow = showData;
      window.dispatchEvent(new Event('lm-perf-play-show'));
    } else {
      useShowStore.getState();
      const { useAppStore } = await import('../stores/appStore');
      useAppStore.getState().setMode?.('quick');
      (window as any).__lm_triggerPlay?.();
    }
  } catch (err) {
    console.error('[VC loadShow] échec :', err);
  }
}

/**
 * Active le widget playback. Retourne false si le widget n'existe pas ou si
 * son `actionType` n'est pas de cette famille.
 */
export function vcPlaybackActivate(widgetId: string): boolean {
  const widget = usePerformStore.getState().vcWidgets.find((w) => w.id === widgetId);
  if (!widget || widget.type !== 'button') return false;
  const config = (widget.config ?? {}) as any;
  const kind = config.actionType;

  if (kind === 'loadShow') {
    vcPlaybackSetActive(widgetId, true);
    void activateLoadShow(widgetId, config);
    return true;
  }

  if (kind === 'playSong') {
    if (!config.songId) return false;
    const songPresets = useShowStore.getState().songPresets;
    const preset = findBestSongPreset(songPresets, config.songId, config.songName);
    if (!preset) {
      console.warn('[VC playSong] preset introuvable', config.songId);
      return false;
    }
    // Toggle : si ce preset est déjà en lecture → arrêt.
    if (state.songPresetWidgetId === widgetId) {
      vcPlaybackStopSongPreset();
      return true;
    }
    // Un autre preset tournait → on l'arrête avant de démarrer celui-ci.
    if (state.songPreset) vcPlaybackStopSongPreset();
    stopAllAudioPlayback();
    state.songPreset = preset;
    state.songPresetWidgetId = widgetId;
    notifySong(preset);
    vcPlaybackSetActive(widgetId, true);
    return true;
  }

  if (kind === 'audioAutoScript') {
    if (!config.audioDataUrl) return false;
    // Toggle : si déjà en lecture → arrêt.
    if (state.autoAudio) {
      vcPlaybackDeactivate(widgetId);
      return true;
    }
    vcPlaybackSetActive(widgetId, true);
    void activateAudioAutoScript(widgetId, config);
    return true;
  }

  if (kind === 'autoLoop') {
    if (!config.autoLoopRecipe) return false;
    vcPlaybackSetActive(widgetId, true);
    void startAutoLoop(widgetId, config.autoLoopRecipe).catch(() => {});
    return true;
  }

  if (kind === 'bankLoop') {
    if (config.bankIndex === undefined || config.bankSlot === undefined) return false;
    vcPlaybackSetActive(widgetId, true);
    void startBankLoop(widgetId, config.bankIndex, config.bankSlot).catch(() => {});
    return true;
  }

  return false;
}

/** Arrête le preset en cours (sans toucher aux autres lectures). */
export function vcPlaybackStopSongPreset(): void {
  state.songPreset = null;
  const widgetId = state.songPresetWidgetId;
  state.songPresetWidgetId = null;
  notifySong(null);
  if (widgetId) vcPlaybackSetActive(widgetId, false);
}

/** Lance un SongPreset par son ID (sans widget — pour MIDI/Remote). */
export function vcPlaySongPresetById(presetId: string): void {
  const songPresets = useShowStore.getState().songPresets;
  const preset = findBestSongPreset(songPresets, presetId);
  if (!preset) {
    console.warn('[VC playSong] preset introuvable', presetId);
    return;
  }
  // Si ce preset est déjà en lecture → arrêt (toggle).
  if (state.songPresetWidgetId === `remote-${presetId}`) {
    vcPlaybackStopSongPreset();
    return;
  }
  // Un autre preset tournait → on l'arrête avant de démarrer celui-ci.
  if (state.songPreset) vcPlaybackStopSongPreset();
  stopAllAudioPlayback();
  state.songPreset = preset;
  state.songPresetWidgetId = `remote-${presetId}`;
  notifySong(preset);
  vcPlaybackSetActive(`remote-${presetId}`, true);
}

/** Désactive (arrête) le widget playback. */
export function vcPlaybackDeactivate(widgetId: string): void {
  const widget = usePerformStore.getState().vcWidgets.find((w) => w.id === widgetId);
  const config = (widget?.config ?? {}) as any;
  const kind = config.actionType;

  state.playIntent = false;

  if (kind === 'playSong' && state.songPresetWidgetId === widgetId) {
    vcPlaybackStopSongPreset();
    return;
  }

  if (kind === 'audioAutoScript') {
    if (state.autoRaf) {
      try { cancelAnimationFrame(state.autoRaf); } catch { /* noop */ }
      state.autoRaf = 0;
    }
    if (state.autoAudio) {
      try { state.autoAudio.stop(); } catch { /* noop */ }
      state.autoAudio = null;
    }
    if (state.unregisterAudio) {
      try { state.unregisterAudio(); } catch { /* noop */ }
      state.unregisterAudio = null;
    }
    vcZeroAllUniverses();
    vcPlaybackSetActive(widgetId, false);
    return;
  }

  if (kind === 'autoLoop') {
    stopAutoLoop(widgetId);
    vcPlaybackSetActive(widgetId, false);
    return;
  }

  if (kind === 'bankLoop') {
    stopBankLoop(widgetId);
    vcPlaybackSetActive(widgetId, false);
    return;
  }

  if (kind === 'loadShow') {
    if ((window as any).__lm_perfPlayActive) {
      try { (window as any).__lm_perfStopPlayback?.(); } catch { /* noop */ }
    }
    stopAllAudioPlayback();
    vcPlaybackSetActive(widgetId, false);
    return;
  }

  vcPlaybackSetActive(widgetId, false);
}

/**
 * Point d'entrée de la famille « playback ».
 * @param press true = appui (activation ou bascule), false = relâchement.
 * @returns false si le widget n'est pas de cette famille.
 */
export function vcPlaybackPress(widgetId: string, press: boolean): boolean {
  const widget = usePerformStore.getState().vcWidgets.find((w) => w.id === widgetId);
  if (!widget || widget.type !== 'button') return false;
  const kind = (widget.config ?? {}).actionType;
  const isPlaybackKind =
    kind === 'loadShow' ||
    kind === 'playSong' ||
    kind === 'audioAutoScript' ||
    kind === 'autoLoop' ||
    kind === 'bankLoop';
  if (!isPlaybackKind) return false;

  const isFlash = widget.config?.flashMode === 'flash';

  if (isFlash) {
    if (press) {
      vcPlaybackActivate(widgetId);
    } else {
      vcPlaybackDeactivate(widgetId);
    }
    return true;
  }

  if (press) {
    // Bouton toggle : si déjà allumé → on éteint, sinon on allume.
    if (vcPlaybackIsActive(widgetId)) vcPlaybackDeactivate(widgetId);
    else vcPlaybackActivate(widgetId);
  }
  // Release ignorée (sémantique toggle).
  return true;
}
