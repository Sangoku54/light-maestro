import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { UpdateStatus } from '../../types';

export const UpdateNotification: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    window.lightMaestro.app?.getUpdateStatus?.().then((s) => {
      if (s) setStatus(s);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const unsubscribe = window.lightMaestro.app?.onUpdateStatus?.((s: UpdateStatus) => {
      setStatus(s);
      // Afficher la modale uniquement quand une mise à jour est trouvée ou téléchargée
      if (s.state === 'available' || s.state === 'downloaded') {
        setShowModal(true);
      }
    });
    return () => { unsubscribe?.(); };
  }, []);

  const handleInstall = useCallback(() => {
    setShowModal(false);
    window.lightMaestro.app?.installUpdate?.();
  }, []);

  // ── Modal intrusif pour les mises à jour disponibles/téléchargées ────────
  if (showModal && (status.state === 'available' || status.state === 'downloaded')) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm no-drag">
        <div className="bg-[#12121a] border border-gray-700 rounded-2xl shadow-2xl w-[440px] max-w-[95vw] overflow-hidden animate-in fade-in zoom-in duration-200">
          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-800 bg-[#0d0d14]">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-lg ${status.state === 'downloaded' ? 'bg-emerald-900/40 text-emerald-400' : 'bg-amber-900/40 text-amber-400'}`}>
              {status.state === 'downloaded' ? '✓' : '↓'}
            </div>
            <div>
              <div className="text-white font-semibold text-sm">{t('app.update.title', { defaultValue: 'Mise à jour disponible' })}</div>
              <div className="text-gray-500 text-xs">{status.version ? `v${status.version}` : ''}</div>
            </div>
            <button
              onClick={() => setShowModal(false)}
              className="ml-auto text-gray-600 hover:text-gray-300 transition-colors text-lg leading-none"
              title={t('common.close', { defaultValue: 'Fermer' })}
            >
              ×
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-5">
            {status.state === 'available' && (
              <p className="text-gray-400 text-sm leading-relaxed">
                {t('app.update.availableDesc', {
                  defaultValue: 'Une nouvelle version de Light Maestro est prête. Nous vous recommandons de mettre à jour pour bénéficier des dernières corrections et fonctionnalités.',
                })}
              </p>
            )}
            {status.state === 'downloaded' && (
              <p className="text-gray-400 text-sm leading-relaxed">
                {t('app.update.downloadedDesc', {
                  defaultValue: 'La mise à jour a été téléchargée. Redémarrez l\'application pour appliquer les changements.',
                })}
              </p>
            )}

            {/* Release notes lien */}
            {('releaseNotes' in status) && status.releaseNotes && (
              <details className="mt-4">
                <summary className="text-xs text-purple-400 cursor-pointer hover:text-purple-300 select-none">
                  {t('app.update.releaseNotes', { defaultValue: 'Voir le changelog' })}
                </summary>
                <pre className="mt-2 text-xs text-gray-500 bg-[#0a0a0f] rounded-lg p-3 whitespace-pre-wrap max-h-40 overflow-y-auto font-mono">
                  {status.releaseNotes}
                </pre>
              </details>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 px-6 pb-5">
            <button
              onClick={() => setShowModal(false)}
              className="flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-200 transition-all"
            >
              {t('app.update.later', { defaultValue: 'Plus tard' })}
            </button>
            <button
              onClick={handleInstall}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold transition-all ${
                status.state === 'downloaded'
                  ? 'bg-emerald-700 text-emerald-100 hover:bg-emerald-600'
                  : 'bg-purple-700 text-white hover:bg-purple-600'
              }`}
            >
              {status.state === 'downloaded'
                ? t('app.update.installAndRestart', { defaultValue: 'Redémarrer maintenant' })
                : t('app.update.downloadNow', { defaultValue: 'Télécharger et installer' })
              }
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Badge TopBar (toujours visible quand pas de modale) ──────────────────
  if (status.state === 'idle' || status.state === 'not-available') return null;

  if (status.state === 'checking') {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-gray-800/30 text-gray-500 no-drag">
        <span className="inline-block w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
        <span className="hidden md:inline">{t('app.update.checking')}</span>
      </div>
    );
  }

  if (status.state === 'downloading' && !showModal) {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-blue-900/20 text-blue-400 no-drag">
        <span className="hidden md:inline">{t('app.update.downloading', { percent: status.percent })}</span>
      </div>
    );
  }

  if (status.state === 'error') {
    return (
      <button
        onClick={() => setShowModal(true)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-red-900/20 text-red-400 hover:bg-red-800/30 no-drag transition-colors"
        title={status.message}
      >
        <span>⚠</span>
        <span className="hidden md:inline">{t('app.update.error')}</span>
      </button>
    );
  }

  if (status.state === 'available' || status.state === 'downloaded') {
    // Déjà géré par la modale ci-dessus, mais on garde un fallback badge discret
    return null;
  }

  return null;
};
