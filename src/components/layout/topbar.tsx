import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AppMode, useAppStore } from '../../stores/appStore';
import {
  Zap,       // Quick
  PenTool,   // Design
  Play,      // Perform
  Power,
  Sun,
  Download,
  CheckCircle,
  Loader,
  FilePlus,
  FolderOpen,
  Save,
} from 'lucide-react';

interface TopBarProps {
  mode: AppMode;
  onModeChange: (mode: AppMode) => void;
}

const MODE_BUTTONS: { mode: AppMode; labelKey: string; icon: React.ReactNode; shortcut: string }[] = [
  { mode: 'quick', labelKey: 'modes.quick', icon: <Zap size={16} />, shortcut: '1' },
  { mode: 'design', labelKey: 'modes.design', icon: <PenTool size={16} />, shortcut: '2' },
  { mode: 'perform', labelKey: 'modes.perform', icon: <Play size={16} />, shortcut: '3' },
];

export const TopBar: React.FC<TopBarProps> = ({ mode, onModeChange }) => {
  const { t, i18n } = useTranslation();
  
  const toggleLanguage = () => {
    const next = i18n.language === 'fr' ? 'en' : 'fr';
    i18n.changeLanguage(next);
    localStorage.setItem('light-maestro-lang', next);
  };

  return (
    <header className="h-12 bg-[#0d0d14] border-b border-gray-800 flex items-center px-3 gap-2 select-none drag-region">
      {/* Logo */}
      <div className="flex items-center gap-2 mr-4 ml-2 no-drag">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center">
          <Sun size={16} className="text-white" />
        </div>
        <span className="font-semibold text-white text-sm tracking-wide">{t('app.title')}</span>
      </div>

      {/* Mode Switcher — SoundSwitch-style clean tabs */}
      <nav className="flex items-center bg-[#12121a] rounded-lg p-0.5 no-drag">
        {MODE_BUTTONS.map((btn) => (
          <button
            key={btn.mode}
            onClick={() => onModeChange(btn.mode)}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all
              ${mode === btn.mode
                ? 'bg-purple-600/30 text-purple-300 shadow-sm'
                : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/30'
              }
            `}
          >
            {btn.icon}
            <span className="hidden sm:inline">{t(btn.labelKey)}</span>
            <kbd className="hidden lg:inline text-[10px] px-1 py-0.5 rounded bg-gray-800/50 text-gray-600 ml-0.5">
              {btn.shortcut}
            </kbd>
          </button>
        ))}
      </nav>

      <div className="flex-1" />

      {/* Open/Save */}
      <button
        onClick={() => (window as any).__lm_new?.()}
        className="no-drag flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-gray-800/30 text-gray-400 hover:bg-purple-800/30 hover:text-purple-300 transition-all"
        title="Nouveau Projet"
      >
        <FilePlus size={12} />
        <span className="hidden sm:inline">Nouveau</span>
      </button>
      <div className="w-px h-4 bg-gray-700" />
      <button
        onClick={() => (window as any).__lm_open?.()}
        className="no-drag flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-gray-800/30 text-gray-400 hover:bg-gray-700/40 hover:text-gray-200 transition-all"
        title="Ouvrir un projet (.lmproj)"
      >
        <FolderOpen size={12} />
        <span className="hidden sm:inline">Ouvrir</span>
      </button>
      <div className="w-px h-4 bg-gray-700" />
      <button
        onClick={() => (window as any).__lm_save?.()}
        className="no-drag flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-gray-800/30 text-gray-400 hover:bg-gray-700/40 hover:text-gray-200 transition-all"
        title="Enregistrer le projet (.lmproj)"
      >
        <Save size={12} />
        <span className="hidden sm:inline">Enregistrer</span>
      </button>
      <div className="w-px h-4 bg-gray-700" />

      {/* Language Switcher */}
      <button
        onClick={toggleLanguage}
        className="no-drag flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-gray-800/30 text-gray-400 hover:bg-gray-700/40 hover:text-gray-200 transition-all"
        title={i18n.language === 'fr' ? 'Switch to English' : 'Passer en Français'}
      >
        {i18n.language === 'fr' ? '🇫🇷 FR' : '🇬🇧 EN'}
      </button>

      {/* Fixture update status */}
      <FixtureUpdateBadge />

      {/* Quick actions */}
      <div className="flex items-center gap-1 no-drag">
        <BlackoutButton />
      </div>
    </header>
  );
};

const BlackoutButton: React.FC = () => {
  const { t } = useTranslation();
  const blackout = useAppStore((s) => s.dmx.blackout);
  const setBlackout = useAppStore((s) => s.setBlackout);

  const toggle = () => {
    const newVal = !blackout;
    setBlackout(newVal);
    const api = (window as any).lightMaestro?.dmx;
    if (api) {
      if (newVal) api.blackout().catch(() => {});
      else api.restore().catch(() => {});
    }
  };
  return (
    <button
      onClick={toggle}
      className={`
        flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all
        ${blackout
          ? 'bg-red-600 text-white animate-pulse'
          : 'bg-gray-800/50 text-gray-400 hover:bg-red-900/30 hover:text-red-400'
        }
      `}
    >
      <Power size={14} />
      <span className="hidden sm:inline">{t('topbar.blackout')}</span>
    </button>
  );
};

type UpdateStatus = {
  checking: boolean;
  lastCheck: number;
  lastSha: string;
  newCount: number;
  error?: string;
};

const FixtureUpdateBadge: React.FC = () => {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [showTooltip, setShowTooltip] = useState(false);

  useEffect(() => {
    // Listen for update status changes from main process
    const onUpdateStatus = (s: UpdateStatus) => setStatus(s);
    const onUpdateComplete = (data: { newCount: number }) => {
      setStatus((prev) => ({
        ...(prev || { checking: false, lastCheck: 0, lastSha: '', newCount: 0 }),
        checking: false,
        newCount: data.newCount,
      }));
    };

    window.lightMaestro.fixtures?.onUpdateStatus?.(onUpdateStatus);
    window.lightMaestro.fixtures?.onUpdateComplete?.(onUpdateComplete);
  }, []);

  const handleClick = useCallback(() => {
    if (!status?.checking && status?.newCount > 0) {
      window.lightMaestro.fixtures?.reloadLibrary?.();
      setStatus((prev) => (prev ? { ...prev, newCount: 0 } : null));
    }
  }, [status]);

  // Don't show badge if nothing happening
  if (!status) return null;
  if (!status.checking && status.newCount === 0 && !status.error) return null;

  const isChecking = status.checking;
  const hasUpdates = !isChecking && status.newCount > 0;
  const hasError = !isChecking && !!status.error;
  const isUpToDate = !isChecking && status.newCount === 0 && !status.error;

  return (
    <div className="relative no-drag">
      <button
        onClick={handleClick}
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        className={`
          flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-all
          ${isChecking
            ? 'bg-gray-800/30 text-gray-500'
            : hasUpdates
              ? 'bg-emerald-900/30 text-emerald-400 hover:bg-emerald-800/40 cursor-pointer'
              : hasError
                ? 'bg-red-900/20 text-red-400'
                : 'bg-gray-800/20 text-gray-500'
          }
        `}
        title={
          isChecking ? t('topbar.checkingUpdates') :
          hasUpdates ? t('topbar.clickToLoad') :
          hasError ? status.error :
          t('topbar.fixturesUpToDate')
        }
      >
        {isChecking ? (
          <Loader size={12} className="animate-spin" />
        ) : hasUpdates ? (
          <Download size={12} />
        ) : isUpToDate ? (
          <CheckCircle size={12} />
        ) : null}
        <span className="hidden md:inline">
          {isChecking
            ? t('topbar.checkingFixtures')
            : hasUpdates
              ? `${status.newCount} ${t('topbar.newFixtures')}`
              : hasError
                ? t('topbar.updateError')
                : t('topbar.upToDate')}
        </span>
      </button>

      {/* Tooltip for narrow screens */}
      {showTooltip && (
        <div className="absolute top-full right-0 mt-1 px-2 py-1 bg-gray-900 border border-gray-700 rounded text-[11px] text-gray-300 whitespace-nowrap z-50 shadow-lg">
          {isChecking ? t('topbar.checkingUpdates') :
           hasUpdates ? `${status.newCount} ${t('topbar.newFixturesAvailable')}` :
           hasError ? `Error: ${status.error}` :
           t('topbar.fixturesUpToDate')}
        </div>
      )}
    </div>
  );
};
