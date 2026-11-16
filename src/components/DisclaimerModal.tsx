/**
 * DisclaimerModal — avertissement vue 3D / responsabilité affiché UNE fois
 * (persisté `disclaimerAccepted` dans appStore).
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../stores/appStore';

export const DisclaimerModal: React.FC = () => {
  const { t } = useTranslation();
  const acceptDisclaimer = useAppStore((s) => s.acceptDisclaimer);

  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="bg-[#12121a] border border-amber-500/40 rounded-xl shadow-2xl w-[520px] max-w-[95vw] max-h-[85vh] overflow-y-auto">
        <div className="px-5 py-3 border-b border-amber-500/20">
          <h3 className="text-sm font-bold text-amber-300">{t('disclaimer.title')}</h3>
        </div>
        <div className="p-5 space-y-3 text-xs text-gray-300 leading-relaxed">
          <p dangerouslySetInnerHTML={{ __html: t('disclaimer.p1') }} />
          <p dangerouslySetInnerHTML={{ __html: t('disclaimer.p2') }} />
          <p dangerouslySetInnerHTML={{ __html: t('disclaimer.p3') }} />
          <button
            onClick={acceptDisclaimer}
            className="w-full mt-2 px-3 py-2 rounded-md bg-amber-600 text-white text-xs font-semibold hover:bg-amber-500"
          >
            {t('disclaimer.accept')}
          </button>
        </div>
      </div>
    </div>
  );
};
