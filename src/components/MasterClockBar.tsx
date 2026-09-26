import React from 'react';
import { useTranslation } from 'react-i18next';
import { useClockStore, enableLink } from '../stores/clockStore';
import { Gauge, Link2, Link2Off, Timer } from 'lucide-react';

export const MasterClockBar: React.FC = () => {
  const { t } = useTranslation();
  const bpm = useClockStore((s) => s.bpm);
  const source = useClockStore((s) => s.source);
  const isPlaying = useClockStore((s) => s.isPlaying);
  const linkEnabled = useClockStore((s) => s.linkEnabled);
  const setBpm = useClockStore((s) => s.setBpm);
  const tap = useClockStore((s) => s.tap);
  const setPlaying = useClockStore((s) => s.setPlaying);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-[#0d0d14] border-b border-gray-800/50 shrink-0 flex-wrap">
      <Gauge size={14} className="text-cyan-400" />
      <span className="text-[11px] font-semibold text-gray-300">Clock</span>
      <span className={`text-[10px] px-1.5 py-0.5 rounded ${source === 'link' ? 'bg-cyan-600/20 text-cyan-300' : source === 'tap' ? 'bg-amber-600/20 text-amber-300' : source === 'midi' ? 'bg-purple-600/20 text-purple-300' : 'bg-gray-800 text-gray-400'}`}>{source}</span>
      <div className="flex items-center gap-1">
        <button onClick={() => setBpm(bpm - 1)} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs">−</button>
        <span className="w-12 text-center text-sm font-mono font-bold text-white">{bpm}</span>
        <button onClick={() => setBpm(bpm + 1)} className="w-6 h-6 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-xs">+</button>
        <span className="text-[10px] text-gray-600">BPM</span>
      </div>
      <button onClick={tap} className="px-2.5 py-1 rounded bg-amber-600/20 text-amber-300 border border-amber-500/30 text-xs font-medium hover:bg-amber-600/30 flex items-center gap-1"><Timer size={12} /> Tap</button>
      <button onClick={() => setPlaying(!isPlaying)} className={`px-2 py-1 rounded text-xs font-medium border ${isPlaying ? 'bg-green-600/20 text-green-300 border-green-500/30' : 'bg-gray-800 text-gray-400 border-gray-700'}`}>{isPlaying ? '▶ Play' : '⏸ Pause'}</button>
      <button
        onClick={() => enableLink(!linkEnabled)}
        className={`ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border ${linkEnabled ? 'bg-cyan-600/20 text-cyan-300 border-cyan-500/30' : 'bg-gray-800 text-gray-500 border-gray-700 hover:text-gray-300'}`}
        title={t('masterClock.abletonLink')}
      >
        {linkEnabled ? <Link2 size={12} /> : <Link2Off size={12} />}
        Link
      </button>
    </div>
  );
};
