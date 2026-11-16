/**
 * SafetyModal — avertissement photosensibilité affiché UNE fois (persisté
 * `safetyAccepted` dans appStore). Prérequis commercialisation : un strobe
 * mal réglé en public = risque de malaise/crise + responsabilité de
 * l'opérateur. Le plafond moteur (`STROBE_SAFE_MAX`) est rappelé ici.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';

export const SafetyModal: React.FC = () => {
  const { t } = useTranslation();
  const acceptSafety = useAppStore((s) => s.acceptSafety);

  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#12121a] border border-amber-500/40 rounded-xl shadow-2xl w-[440px] max-w-[95vw] max-h-[85vh] overflow-y-auto">
        <div className="px-5 py-3 border-b border-amber-500/20">
          <h3 className="text-sm font-bold text-amber-300">{t('safety.title')}</h3>
        </div>
        <div className="p-5 space-y-3 text-xs text-gray-300 leading-relaxed">
          <p>{t('safety.p1')}</p>
          <p>{t('safety.p2')}</p>
          <p className="text-gray-400">{t('safety.p3')}</p>
          <button
            onClick={acceptSafety}
            className="w-full mt-2 px-3 py-2 rounded-md bg-amber-600 text-white text-xs font-semibold hover:bg-amber-500"
          >
            {t('safety.accept')}
          </button>
        </div>
      </div>
    </div>
  );
};
