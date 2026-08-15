import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { UpdateStatus } from '../../types';

export const UpdateNotification: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    window.lightMaestro.app?.getUpdateStatus?.().then((s) => {
      if (s) setStatus(s);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const unsubscribe = window.lightMaestro.app?.onUpdateStatus?.((s) => {
      setStatus(s);
      if (s.state === 'checking' || s.state === 'available') {
        setDismissed(false);
      }
    });
    return () => { unsubscribe?.(); };
  }, []);

  const handleInstall = useCallback(() => {
    window.lightMaestro.app?.installUpdate?.();
  }, []);

  if (dismissed) return null;
  if (status.state === 'idle' || status.state === 'not-available') return null;

  if (status.state === 'checking') {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-gray-800/30 text-gray-500 no-drag">
        <span className="inline-block w-3 h-3 border border-gray-400 border-t-transparent rounded-full animate-spin" />
        <span className="hidden md:inline">{t('app.update.checking')}</span>
      </div>
    );
  }

  if (status.state === 'downloading') {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-blue-900/20 text-blue-400 no-drag">
        <span className="hidden md:inline">{t('app.update.downloading', { percent: status.percent })}</span>
      </div>
    );
  }

  if (status.state === 'error') {
    return (
      <button
        onClick={() => setDismissed(true)}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-red-900/20 text-red-400 hover:bg-red-800/30 no-drag transition-colors"
        title={status.message}
      >
        <span>⚠</span>
        <span className="hidden md:inline">{t('app.update.error')}</span>
      </button>
    );
  }

  if (status.state === 'available') {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-amber-900/20 text-amber-400 no-drag">
        <span>↓</span>
        <span className="hidden md:inline">{t('app.update.available', { version: status.version })}</span>
      </div>
    );
  }

  if (status.state === 'downloaded') {
    return (
      <button
        onClick={handleInstall}
        className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-700/40 text-emerald-300 hover:bg-emerald-600/50 no-drag transition-all"
      >
        <span>↻</span>
        <span className="hidden sm:inline">{t('app.update.installAndRestart')}</span>
      </button>
    );
  }

  return null;
};
