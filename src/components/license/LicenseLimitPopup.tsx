/**
 * LicenseLimitPopup — affiché quand une limite de licence est atteinte
 * (trop de fixtures ou trop d'univers). Propose les boutons d'upgrade
 * appropriés selon l'édition courante.
 */
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLicenseStore } from '../../stores/licenseStore';
import { useShowStore } from '../../stores/showStore';
import { toast } from '../Toast';

export const LicenseLimitPopup: React.FC = () => {
  const { t } = useTranslation();
  const state = useLicenseStore();
  const showStore = useShowStore();
  const limitType = showStore.licenseLimitReached;

  // Fermeture automatique quand l'utilisateur achète et passe à une édition supérieure
  useEffect(() => {
    if (limitType === null) return;
    const cur = useLicenseStore.getState();
    if ((limitType === 'fixture' && cur.edition !== 'free') ||
        (limitType === 'universe' && cur.edition === 'full')) {
      showStore.resetLicenseLimitReached();
    }
  }, [limitType, state.edition]);

  if (!limitType) return null;

  const isFree = state.edition === 'free';
  const isStandard = state.edition === 'standard';

  const isFixtureLimit = limitType === 'fixture';

  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={close}>
      <div
        className="bg-[#12121a] border border-purple-600/50 rounded-xl shadow-2xl w-[440px] max-w-[90vw] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-800/50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">{t('licenseLimit.title')}</h3>
          <button onClick={close} className="text-gray-500 hover:text-gray-300">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {/* Message */}
          <div className="space-y-2">
            <p className="text-[11px] leading-relaxed text-gray-300">
              {isFixtureLimit
                ? t('licenseLimit.limitFixture', { label: state.licensed ? state.edition : 'gratuite' })
                : t('licenseLimit.limitUniverse', { label: state.licensed ? state.edition : 'gratuite' })}
            </p>
            <p className="text-[10px] text-gray-500 italic">
              {t('licenseLimit.upgradeHint')}
            </p>
          </div>

          {/* Boutons d'achat */}
          <div className="space-y-2">
            {isFree && (
              <>
                <button
                  onClick={() => { close(); state.checkout('standard'); }}
                  className="w-full px-3 py-2 rounded-md bg-blue-600 text-white text-xs font-semibold hover:bg-blue-500 disabled:opacity-40"
                >
                  {t('license.checkoutStandard')}
                </button>
                <button
                  onClick={() => { close(); state.checkout('full'); }}
                  className="w-full px-3 py-2 rounded-md bg-purple-600 text-white text-xs font-semibold hover:bg-purple-500"
                >
                  {t('license.checkoutFullFree')}
                </button>
              </>
            )}
            {isStandard && (
              <button
                onClick={() => { close(); state.checkout('full'); }}
                className="w-full px-3 py-2 rounded-md bg-purple-600 text-white text-xs font-semibold hover:bg-purple-500"
              >
                {t('license.checkoutUpgrade')}
              </button>
            )}
            {!isFree && !isStandard && (
              <button
                onClick={() => { close(); state.checkout('full'); }}
                className="w-full px-3 py-2 rounded-md bg-purple-600 text-white text-xs font-semibold hover:bg-purple-500"
              >
                {t('license.checkoutUpgrade')}
              </button>
            )}
          </div>

          {/* Fermer sans acheter */}
          <button
            onClick={close}
            className="w-full px-3 py-1.5 rounded-md text-xs font-medium text-gray-400 hover:bg-gray-800/50"
          >
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );

  function close() {
    showStore.resetLicenseLimitReached();
  }
};
