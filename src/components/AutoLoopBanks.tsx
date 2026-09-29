import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Square, ChevronLeft, ChevronRight, Layers, SkipForward } from 'lucide-react';
import { useAutoloopEngine } from '../hooks/use-autoloop-engine';
import { useAppStore } from '../stores/appStore';
import { PER_BANK } from '../engine/autoloop-banks';
import { BANK_THEMES } from '../engine/autoloop-themes';

/**
 * Boucles auto — contrôles des boucles automatiques 4×32.
 *
 * Surface compacte branchée sur `useAutoloopEngine` : 4 banques THÉMATIQUES
 * (Couleurs / Effets / Matrice RGB / Mix), navigation dans la matrice 4×32,
 * lecture/arrêt quantisés au barline, override, et bascule du mode de
 * répétition (Infinite / Track Duration).
 *
 * Chaque slot affiche le LIBELLÉ de la boucle (+ sa couleur d'accent) :
 * aucun bouton anonyme, aucun slot vide (le générateur remplit les 32 emplacements).
 */
export const AutoLoopBanks: React.FC = () => {
  const { t } = useTranslation();
  const api = useAutoloopEngine(120);
  const { ready, playing, repeatMode, activeBank, activeSlot, activeLoop, banks } = api;
  const theme = BANK_THEMES[activeBank];

  // Le panneau parent ne démonte jamais (display:none) : quand on quitte
  // l'onglet Loops, la banque doit s'arrêter ET s'éteindre, sinon la scène
  // reste figée allumée sans aucun contrôle visible.
  const loopsTab = useAppStore((s) => s.quickSidebarTab);
  const stopRef = useRef(api.stop);
  stopRef.current = api.stop;
  useEffect(() => {
    if (loopsTab !== 'loops') stopRef.current();
  }, [loopsTab]);

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
          <h3 className="text-xs font-semibold text-gray-200">{t('loops.banksTitle')}</h3>
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
          title={t('loops.repeatTitle')}
        >
          {repeatMode === 'infinite' ? t('loops.repeatInfinite') : t('loops.repeatTrack')}
        </button>
      </div>

      {/* Banques (4) — thèmes nommés, sélection de banque */}
      <div className="flex items-center gap-1 mb-2">
        {BANK_THEMES.map((meta, bank) => (
          <button
            key={meta.id}
            onClick={() => api.select(bank, 0)}
            title={t(`loops.themes.${meta.id}.hint`, { defaultValue: meta.hint })}
            className={`flex-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
              activeBank === bank
                ? 'bg-cyan-600/30 text-cyan-300 border border-cyan-500/30'
                : `bg-gray-800/50 hover:text-gray-300 border border-transparent ${meta.accent} opacity-60 hover:opacity-100`
            }`}
          >
            {t(`loops.themes.${meta.id}.label`, { defaultValue: meta.label })}
          </button>
        ))}
      </div>

      {/* Grille 32 slots de la banque active */}
      {banks && (
        <div className="mb-2">
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-1">
            {Array.from({ length: PER_BANK }, (_, slot) => {
              const loop = banks.get(activeBank, slot);
              const isActive = activeSlot === slot && loop !== null;
              const isEmpty = loop === null;
              const swatch = loop?.swatch;
              return (
                <button
                  key={slot}
                  onClick={() => {
                    if (isEmpty) return;
                    api.select(activeBank, slot);
                    // Clic = charger ET jouer : sinon un slot cliqué à l'arrêt
                    // « ne fait rien » et semble inactif.
                    if (!playing) api.play();
                  }}
                  disabled={isEmpty}
                  title={
                    loop
                      ? t('loops.slotTitle', { label: loop.label ?? loop.id, bars: loop.bars, category: loop.category, slot: slot + 1 })
                      : t('loops.slotEmpty', { slot: slot + 1 })
                  }
                  className={`h-7 px-1 rounded text-[8px] font-medium transition-all border flex items-center justify-center gap-1 leading-none ${
                    isActive
                      ? 'bg-cyan-500 text-white border-cyan-400 shadow shadow-cyan-500/30'
                      : isEmpty
                      ? 'bg-gray-900/30 text-gray-700 border-gray-800/50 cursor-not-allowed'
                      : 'bg-gray-800/60 text-gray-400 border-gray-700/50 hover:bg-gray-700 hover:text-gray-200 hover:border-gray-600'
                  }`}
                >
                  {swatch && (
                    <span
                      className="w-1.5 h-1.5 rounded-sm shrink-0 border border-black/40"
                      style={{ background: swatch }}
                    />
                  )}
                  <span className="truncate">{loop ? (loop.label ?? loop.id) : slot + 1}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-1 text-[9px] text-gray-600 text-center truncate">
            {t(`loops.themes.${theme.id}.label`, { defaultValue: theme.label })} — 32 slots · {banks.get(activeBank, activeSlot)?.category ?? '—'}
          </div>
        </div>
      )}

      {/* Transport */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={api.previous}
          className="w-7 h-7 rounded-md bg-gray-800 text-gray-300 hover:bg-gray-700 flex items-center justify-center"
          title={t('loops.prevScene')}
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
          {playing ? t('common.stop') : t('common.play')}
        </button>
        <button
          onClick={api.next}
          className="w-7 h-7 rounded-md bg-gray-800 text-gray-300 hover:bg-gray-700 flex items-center justify-center"
          title={t('loops.nextScene')}
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={api.override}
          disabled={!playing}
          className="flex items-center gap-1 px-2 h-7 rounded-md bg-purple-600/20 text-purple-300 text-[11px] font-medium hover:bg-purple-600/30 disabled:opacity-40 disabled:cursor-not-allowed"
          title={t('loops.overrideTitle')}
        >
          <SkipForward className="w-3 h-3" />
          {t('loops.override')}
        </button>
      </div>

      {/* Loop actif */}
      {activeLoop && (
        <div className="mt-1.5 text-[10px] text-gray-500 truncate">
          {t('loops.activeLine', {
            label: activeLoop.label ?? activeLoop.id,
            bars: activeLoop.bars,
            category: activeLoop.category,
            theme: t(`loops.themes.${theme.id}.label`, { defaultValue: theme.label }),
            slot: activeSlot + 1,
          })}
        </div>
      )}
    </div>
  );
};
