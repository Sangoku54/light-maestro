import React from 'react';
import { Play, Square, ChevronLeft, ChevronRight, Layers, SkipForward } from 'lucide-react';
import { useAutoloopEngine } from '../hooks/use-autoloop-engine';
import { PER_BANK } from '../engine/autoloop-banks';

/**
 * Boucles auto — contrôles des boucles automatiques 4×32.
 *
 * Surface compacte branchée sur `useAutoloopEngine` : navigation dans la
 * matrice 4×32, lecture/arrêt quantisés au barline, override, et bascule du
 * mode de répétition (Infinite / Track Duration).
 */
export const SoundSwitchAutoloop: React.FC = () => {
  const api = useAutoloopEngine(120);
  const { ready, playing, repeatMode, activeBank, activeSlot, activeLoop, banks } = api;

  if (!ready) {
    return (
      <div className="px-3 py-2 border-b border-gray-800 text-[11px] text-gray-600">
        Chargement des banques…
      </div>
    );
  }

  return (
    <div className="px-3 py-2.5 border-b border-gray-800 shrink-0">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-cyan-400" />
          <h3 className="text-xs font-semibold text-gray-200">Boucles auto — 4×32</h3>
        </div>
        <button
          onClick={() =>
            api.setRepeatMode(repeatMode === 'infinite' ? 'track_duration' : 'infinite')
          }
          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
            repeatMode === 'infinite'
              ? 'bg-cyan-600/20 text-cyan-300'
              : 'bg-amber-600/20 text-amber-300'
          }`}
          title="Mode de répétition (Infinite rejoue en boucle, Track Duration régénère au chargement)"
        >
          {repeatMode === 'infinite' ? '∞ Infinite' : '◷ Track Duration'}
        </button>
      </div>

      {/* Banques (4) — sélection de banque */}
      <div className="flex items-center gap-1 mb-2">
        {[0, 1, 2, 3].map((bank) => (
          <button
            key={bank}
            onClick={() => api.select(bank, 0)}
            className={`flex-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
              activeBank === bank
                ? 'bg-cyan-600/30 text-cyan-300 border border-cyan-500/30'
                : 'bg-gray-800/50 text-gray-500 hover:text-gray-300 border border-transparent'
            }`}
          >
            B{bank + 1}
          </button>
        ))}
      </div>

      {/* Grille 32 slots de la banque active */}
      {banks && (
        <div className="mb-2">
          <div className="grid grid-cols-8 gap-1">
            {Array.from({ length: PER_BANK }, (_, slot) => {
              const loop = banks.get(activeBank, slot);
              const isActive = activeSlot === slot && loop !== null;
              const isEmpty = loop === null;
              return (
                <button
                  key={slot}
                  onClick={() => !isEmpty && api.select(activeBank, slot)}
                  disabled={isEmpty}
                  title={loop ? `${loop.id} · ${loop.bars}b · ${loop.category}` : `Slot ${slot + 1} vide`}
                  className={`h-7 rounded text-[9px] font-mono font-medium transition-all border flex flex-col items-center justify-center leading-none ${
                    isActive
                      ? 'bg-cyan-500 text-white border-cyan-400 shadow shadow-cyan-500/30'
                      : isEmpty
                      ? 'bg-gray-900/30 text-gray-700 border-gray-800/50 cursor-not-allowed'
                      : 'bg-gray-800/60 text-gray-400 border-gray-700/50 hover:bg-gray-700 hover:text-gray-200 hover:border-gray-600'
                  }`}
                >
                  <span>{slot + 1}</span>
                  {loop && <span className="text-[7px] opacity-70">{loop.bars}b</span>}
                </button>
              );
            })}
          </div>
          <div className="mt-1 text-[9px] text-gray-600 text-center">Banque {activeBank + 1} — 32 slots · {banks.get(activeBank, activeSlot)?.category ?? '—'}</div>
        </div>
      )}

      {/* Transport */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={api.previous}
          className="w-7 h-7 rounded-md bg-gray-800 text-gray-300 hover:bg-gray-700 flex items-center justify-center"
          title="Loop précédent (wrap)"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={playing ? api.stop : api.play}
          className={`flex-1 h-7 rounded-md flex items-center justify-center gap-1.5 text-xs font-medium transition-colors ${
            playing
              ? 'bg-rose-600/30 text-rose-300 hover:bg-rose-600/40'
              : 'bg-cyan-600 text-white hover:bg-cyan-500'
          }`}
        >
          {playing ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {playing ? 'Stop' : 'Jouer'}
        </button>
        <button
          onClick={api.next}
          className="w-7 h-7 rounded-md bg-gray-800 text-gray-300 hover:bg-gray-700 flex items-center justify-center"
          title="Loop suivant (wrap)"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={api.override}
          disabled={!playing}
          className="flex items-center gap-1 px-2 h-7 rounded-md bg-purple-600/20 text-purple-300 text-[11px] font-medium hover:bg-purple-600/30 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Override 2 bars puis reprise (SCRIPT → OVERRIDE → SCRIPT)"
        >
          <SkipForward className="w-3 h-3" />
          Override
        </button>
      </div>

      {/* Loop actif */}
      {activeLoop && (
        <div className="mt-1.5 text-[10px] text-gray-500 truncate">
          {activeLoop.id} · {activeLoop.bars} bars · {activeLoop.category} · Banque {activeBank + 1} Slot {activeSlot + 1}/32
        </div>
      )}
    </div>
  );
};
