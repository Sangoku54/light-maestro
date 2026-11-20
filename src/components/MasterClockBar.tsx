import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useClockStore, enableLink, isLinkAvailable } from '../stores/clockStore';
import { Gauge, Link2, Link2Off, Timer } from 'lucide-react';

/**
 * Bandeau « Clock » — tempo, source et transport du rig.
 *
 * Règles d'affichage (validées contre le moteur, pas contre une intention) :
 *  - la source affichée est l'état RÉEL de l'horloge maître (`source`) ;
 *  - le tempo affiché est le tempo EFFECTIF (base × multiplicateur) ; le tempo
 *    reçu n'est affiché qu'en complément quand un multiplicateur est actif ;
 *  - le bouton Link est INOPÉRANT (désactivé + explicite) quand aucun moteur
 *    Link n'existe : ce n'est pas un bouton qui pretend synchroniser avec un
 *    logiciel DJ alors qu'il ne synchronise rien.
 */
export const MasterClockBar: React.FC = () => {
  const { t } = useTranslation();
  const bpm = useClockStore((s) => s.bpm);
  const baseBpm = useClockStore((s) => s.baseBpm);
  const source = useClockStore((s) => s.source);
  const isPlaying = useClockStore((s) => s.isPlaying);
  const externalRunning = useClockStore((s) => s.externalRunning);
  const linkEnabled = useClockStore((s) => s.linkEnabled);
  const linkAvailable = useClockStore((s) => s.linkAvailable);
  const tempoMultiplier = useClockStore((s) => s.tempoMultiplier);
  const setBpm = useClockStore((s) => s.setBpm);
  const tap = useClockStore((s) => s.tap);
  const setPlaying = useClockStore((s) => s.setPlaying);
  const setTempoMultiplier = useClockStore((s) => s.setTempoMultiplier);

  const external = source === 'midi' || source === 'link';
  const ledRef = useRef<HTMLSpanElement>(null);

  // Détection du backend Link au montage (l'état initial du store est false).
  useEffect(() => {
    useClockStore.setState({ linkAvailable: isLinkAvailable() });
  }, []);

  // LED de temps : mise à jour IMPÉRATIVE (pas de re-render à 60 fps).
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = ledRef.current;
      if (el) {
        const s = useClockStore.getState();
        const on = s.isPlaying && s.phase < 0.12;
        el.style.opacity = on ? '1' : '0.15';
        el.style.transform = on ? 'scale(1.4)' : 'scale(1)';
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const sourceClass =
    source === 'link'
      ? 'bg-cyan-600/20 text-cyan-300'
      : source === 'tap'
        ? 'bg-amber-600/20 text-amber-300'
        : source === 'midi'
          ? 'bg-purple-600/20 text-purple-300'
          : source === 'audio'
            ? 'bg-emerald-600/20 text-emerald-300'
            : 'bg-gray-800 text-gray-400';

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0d0d14] border-b border-gray-800/50 shrink-0 flex-wrap">
      <Gauge size={14} className="text-cyan-400" />
      <span className="text-[11px] font-semibold text-gray-300">Clock</span>
      <span className={`text-[10px] px-1.5 py-0.5 rounded ${sourceClass}`}>{source}</span>
      {external && (
        <span
          className={`text-[10px] ${externalRunning ? 'text-cyan-400/80' : 'text-amber-500/80'}`}
          title={t('masterClock.externalSource')}
        >
          {externalRunning ? t('masterClock.lockedPhase') : t('masterClock.externalPaused')}
        </span>
      )}
      <span
        ref={ledRef}
        title={t('masterClock.beatLed')}
        className="w-2 h-2 rounded-full bg-cyan-400"
        style={{ opacity: 0.15, transition: 'opacity 40ms linear, transform 40ms linear' }}
      />
      <div className="flex items-center gap-1">
        <button
          onClick={() => setBpm(baseBpm - 1)}
          disabled={external}
          className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs disabled:opacity-30 disabled:cursor-not-allowed"
        >
          −
        </button>
        <span className="w-12 text-center text-sm font-mono font-bold text-white">{bpm}</span>
        <button
          onClick={() => setBpm(baseBpm + 1)}
          disabled={external}
          className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs disabled:opacity-30 disabled:cursor-not-allowed"
        >
          +
        </button>
        <span className="text-[10px] text-gray-600">BPM</span>
      </div>
      {tempoMultiplier !== 1 && (
        <span className="text-[10px] text-gray-500" title={t('masterClock.baseBpm')}>
          ({baseBpm} {t('masterClock.baseBpm')})
        </span>
      )}

      {/* Multiplicateur de tempo : ½ / ×1 / ×2 (parité DMXDesktop) */}
      <div className="flex items-center gap-1" title={t('masterClock.tempoMultiplier')}>
        {([0.5, 1, 2] as const).map((m) => (
          <button
            key={m}
            onClick={() => setTempoMultiplier(m)}
            title={
              m === 0.5
                ? t('masterClock.halfTempo')
                : m === 2
                  ? t('masterClock.doubleTempo')
                  : t('masterClock.normalTempo')
            }
            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${
              tempoMultiplier === m
                ? 'bg-cyan-600/25 text-cyan-200 border-cyan-500/50'
                : 'bg-gray-800/60 text-gray-500 border-gray-700/60 hover:text-gray-300'
            }`}
          >
            {m === 0.5 ? '½' : m === 2 ? '×2' : '×1'}
          </button>
        ))}
      </div>

      <button
        onClick={tap}
        className="px-2.5 py-1 rounded bg-amber-600/20 text-amber-300 border border-amber-500/30 text-xs font-medium hover:bg-amber-600/30 flex items-center gap-1"
      >
        <Timer size={12} /> Tap
      </button>
      <button
        onClick={() => setPlaying(!isPlaying)}
        className={`px-2 py-1 rounded text-xs font-medium border ${isPlaying ? 'bg-green-600/20 text-green-300 border-green-500/30' : 'bg-gray-800 text-gray-400 border-gray-700'}`}
      >
        {isPlaying ? '▶ Play' : '⏸ Pause'}
      </button>
      <button
        onClick={() => enableLink(!linkEnabled)}
        disabled={!linkAvailable}
        title={linkAvailable ? t('masterClock.abletonLink') : t('masterClock.linkUnavailable')}
        className={`ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border ${
          linkEnabled
            ? 'bg-cyan-600/20 text-cyan-300 border-cyan-500/30'
            : 'bg-gray-800 text-gray-500 border-gray-700 hover:text-gray-300'
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        {linkEnabled ? <Link2 size={12} /> : <Link2Off size={12} />}
        Link
      </button>
    </div>
  );
};
