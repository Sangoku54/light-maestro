/**
 * Centre d'aide intégré — 18 fiches par fonction (voir helpContent.tsx).
 *
 * Ludique : navigation par groupes, barre de progression, case « J'ai
 * compris » par fiche (persistée), défi à essayer par fiche, boutons
 * précédent/suivant. Modal plein écran fermable (Échap/✕).
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HELP_GROUPS, HELP_PAGES, getHelpDone, setHelpDone } from './helpContent';

export const HelpModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { t } = useTranslation();
  const [pageId, setPageId] = useState<string>(HELP_PAGES[0].id);
  const [done, setDone] = useState<Record<string, boolean>>(getHelpDone);

  const page = HELP_PAGES.find((p) => p.id === pageId) ?? HELP_PAGES[0];
  const idx = HELP_PAGES.findIndex((p) => p.id === page.id);
  const doneCount = useMemo(
    () => HELP_PAGES.filter((p) => done[p.id]).length,
    [done],
  );

  const toggleDone = () => {
    const next = !done[page.id];
    setHelpDone(page.id, next);
    setDone(getHelpDone());
  };

  const go = (dir: 1 | -1) => {
    const next = HELP_PAGES[(idx + dir + HELP_PAGES.length) % HELP_PAGES.length];
    setPageId(next.id);
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-[#12121a] border border-gray-700 rounded-xl shadow-2xl w-[860px] max-w-[95vw] h-[82vh] max-h-[720px] flex overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sommaire */}
        <div className="w-[240px] shrink-0 border-r border-gray-800/60 overflow-y-auto p-3 space-y-3">
          <div>
            <div className="text-[11px] font-bold text-white px-1">{t('help.title')}</div>
            <div className="mt-1.5 h-1.5 rounded-full bg-gray-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-purple-500 to-cyan-400 transition-all"
                style={{ width: `${Math.round((doneCount / HELP_PAGES.length) * 100)}%` }}
              />
            </div>
            <div className="text-[10px] text-gray-500 mt-1 px-1">
              {t('help.progress', { done: doneCount, total: HELP_PAGES.length })}
              {doneCount === HELP_PAGES.length ? ` ${t('help.graduate')}` : ''}
            </div>
          </div>
          {HELP_GROUPS.map((g) => (
            <div key={g}>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 px-1 mb-1">{g}</div>
              {HELP_PAGES.filter((p) => p.group === g).map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPageId(p.id)}
                  className={`w-full text-left px-2 py-1.5 rounded-md text-xs flex items-center gap-1.5 ${p.id === page.id ? 'bg-purple-600/25 text-purple-200' : 'text-gray-400 hover:bg-gray-800/60 hover:text-gray-200'}`}
                >
                  <span>{p.emoji}</span>
                  <span className="truncate flex-1">{p.title}</span>
                  {done[p.id] && <span className="text-emerald-400 text-[10px]">✓</span>}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Fiche */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-6 py-4 border-b border-gray-800/50 flex items-start justify-between gap-3">
            <div>
              <div className="text-2xl">{page.emoji}</div>
              <h3 className="text-base font-bold text-white mt-1">{page.title}</h3>
              <p className="text-xs text-purple-300/90 mt-1 leading-relaxed">{page.pitch}</p>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none">✕</button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2">{t('help.steps')}</div>
              <ol className="space-y-2">
                {page.steps.map((s, i) => (
                  <li key={i} className="flex gap-2.5 text-[13px] text-gray-200 leading-relaxed">
                    <span className="shrink-0 w-5 h-5 rounded-full bg-purple-600/30 border border-purple-500/40 text-purple-200 text-[10px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </div>

            <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-4 py-3">
              <div className="text-[10px] uppercase tracking-wider text-amber-400/90 mb-2">{t('help.tips')}</div>
              <ul className="space-y-1.5">
                {page.tips.map((tip, i) => (
                  <li key={i} className="text-[13px] text-gray-300 leading-relaxed">💡 {tip}</li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/5 px-4 py-3">
              <div className="text-[10px] uppercase tracking-wider text-cyan-300/90 mb-1">{t('help.challenge')}</div>
              <p className="text-[13px] text-gray-200 leading-relaxed">{page.challenge}</p>
              <button
                onClick={toggleDone}
                className={`mt-2 px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors ${done[page.id] ? 'bg-emerald-600/25 border-emerald-500/40 text-emerald-200' : 'bg-gray-800/60 border-gray-700 text-gray-300 hover:border-emerald-500/40 hover:text-emerald-200'}`}
              >
                {done[page.id] ? t('help.understoodDone') : t('help.understood')}
              </button>
            </div>
          </div>

          <div className="px-6 py-3 border-t border-gray-800/50 flex items-center justify-between">
            <button onClick={() => go(-1)} className="px-3 py-1.5 rounded-md text-xs text-gray-400 hover:bg-gray-800/60 hover:text-gray-200">{t('help.prev')}</button>
            <span className="text-[11px] text-gray-600">{idx + 1} / {HELP_PAGES.length}</span>
            <button onClick={() => go(1)} className="px-3 py-1.5 rounded-md text-xs text-gray-400 hover:bg-gray-800/60 hover:text-gray-200">{t('help.next')}</button>
          </div>
        </div>
      </div>
    </div>
  );
};
