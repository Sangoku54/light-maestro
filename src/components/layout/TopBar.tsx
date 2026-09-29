import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AppMode, useAppStore } from '../../stores/appStore';
import { useLicenseStore } from '../../stores/licenseStore';
import { LicenseModal } from '../license/LicenseModal';
import { HelpModal } from '../help/HelpModal';
import { UpdateNotification } from './update-notification';
import logoIcon from '../../../assets/logo/icon.svg';
import {
  Zap,       // Quick
  PenTool,   // Design
  Play,      // Perform
  Power,
  Download,
  CheckCircle,
  Loader,
  FilePlus,
  FolderOpen,
  Save,
  Music,
  HelpCircle,
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
  const projectName = useAppStore((s) => s.projectName);
  const presetName = useAppStore((s) => s.presetName);
  const audioFileName = useAppStore((s) => s.quickShow.audioFileName);

  const toggleLanguage = () => {
    const next = i18n.language === 'fr' ? 'en' : 'fr';
    i18n.changeLanguage(next);
    localStorage.setItem('light-maestro-lang', next);
  };

  const [showLicense, setShowLicense] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  return (
    <header className="h-10 bg-[var(--bg-2)] border-b border-[var(--border)] grid grid-cols-[1fr_auto_1fr] items-center pl-3 pr-[150px] gap-2 select-none drag-region min-w-0 overflow-hidden">
      {/* Left zone: logo + project/preset/audio context */}
      <div className="flex items-center gap-2 no-drag min-w-0 overflow-hidden">
        <div className="flex items-center gap-2">
          <img src={logoIcon} alt="Light Maestro" className="w-7 h-7" />
          <span className="font-semibold text-white text-sm tracking-wide">{t('app.title')}</span>
          <EditionBadge />
        </div>
        {projectName && (
          <>
            <div className="w-px h-5 bg-gray-700" />
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-purple-700/20 border border-purple-600/20">
              <span className="text-[10px] text-purple-400/70 font-medium uppercase tracking-wider">{t('topbar.project')}</span>
              <span className="text-xs text-purple-200 font-semibold truncate max-w-[26vw] md:max-w-[180px]">{projectName}</span>
            </div>
          </>
        )}
        {presetName && (
          <>
            <div className="w-px h-5 bg-gray-700" />
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-700/15 border border-amber-600/15">
              <span className="text-[10px] text-amber-400/70 font-medium uppercase tracking-wider">{t('topbar.preset')}</span>
              <span className="text-xs text-amber-200 font-semibold truncate max-w-[22vw] md:max-w-[160px]">{presetName}</span>
            </div>
          </>
        )}
        {!presetName && audioFileName && (
            <>
              <div className="w-px h-5 bg-gray-700" />
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-700/15 border border-blue-600/15">
                <Music size={11} className="text-blue-400" />
                <span className="text-xs text-blue-200 font-semibold truncate max-w-[28vw] md:max-w-[200px]">{audioFileName}</span>
              </div>
            </>
          )}
      </div>

      {/* Mode Switcher — clean tabs */}
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
            <span className="hidden md:inline">{t(btn.labelKey)}</span>
            <kbd className="hidden xl:inline text-[10px] px-1 py-0.5 rounded bg-gray-800/50 text-gray-600 ml-0.5">
              {btn.shortcut}
            </kbd>
          </button>
        ))}
      </nav>

      {/* Right zone: actions */}
      {/* Right zone: actions — scroll horizontal sur écrans étroits (tablette),
          jamais de chevauchement : chaque contrôle reste cliquable. */}
      <div className="flex items-center justify-end gap-2 no-drag min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&>button]:shrink-0 [&>button]:min-h-[28px] [&>div]:shrink-0">
      {/* Open/Save */}
      <button
        onClick={() => (window as any).__lm_new?.()}
        className="no-drag flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-gray-800/30 text-gray-400 hover:bg-purple-800/30 hover:text-purple-300 transition-all"
        title={t('topbar.newTitle')}
      >
        <FilePlus size={12} />
        <span className="hidden lg:inline">{t('topbar.new')}</span>
      </button>
      <div className="w-px h-4 bg-gray-700 hidden md:block shrink-0" />
      <button
        onClick={() => (window as any).__lm_open?.()}
        className="no-drag flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-gray-800/30 text-gray-400 hover:bg-gray-700/40 hover:text-gray-200 transition-all"
        title={t('topbar.openTitle')}
      >
        <FolderOpen size={12} />
        <span className="hidden lg:inline">{t('topbar.open')}</span>
      </button>
      <div className="w-px h-4 bg-gray-700 hidden md:block shrink-0" />
      <button
        onClick={() => (window as any).__lm_save?.()}
        className="no-drag flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-gray-800/30 text-gray-400 hover:bg-gray-700/40 hover:text-gray-200 transition-all"
        title={t('topbar.saveTitle')}
      >
        <Save size={12} />
        <span className="hidden lg:inline">{t('topbar.save')}</span>
      </button>
      <div className="w-px h-4 bg-gray-700 hidden md:block shrink-0" />

      {/* Language Switcher */}
      <button
        onClick={toggleLanguage}
        className="no-drag flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-gray-800/30 text-gray-400 hover:bg-gray-700/40 hover:text-gray-200 transition-all"
        title={i18n.language === 'fr' ? t('topbar.switchToEn') : t('topbar.switchToFr')}
        aria-label={i18n.language === 'fr' ? t('topbar.switchToEn') : t('topbar.switchToFr')}
      >
        {i18n.language === 'fr' ? '🇫🇷 FR' : '🇬🇧 EN'}
      </button>

      {/* Licence / Compte */}
      <button
        onClick={() => setShowLicense(true)}
        className="no-drag flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-gray-800/30 text-gray-400 hover:bg-gray-700/40 hover:text-gray-200 transition-all"
        title="Compte & Licence"
      >
        <AccountLabel />
      </button>

      {/* Centre d'aide */}
      <button
        onClick={() => setShowHelp(true)}
        className="no-drag flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-gray-800/30 text-gray-400 hover:bg-gray-700/40 hover:text-gray-200 transition-all"
        title="Centre d'aide — 19 fiches par fonction"
      >
        <HelpCircle size={12} />
        <span className="hidden lg:inline">Aide</span>
      </button>

      {/* Auto-update notification */}
      <UpdateNotification />

      {/* Fixture update status */}
      <FixtureUpdateBadge />

      {/* Quick actions */}
      <div className="flex items-center gap-1 no-drag">
        <BlackoutButton />
      </div>
      </div>

      {showLicense && <LicenseModal onClose={() => setShowLicense(false)} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </header>
  );
};

const EditionBadge: React.FC = () => {
  const edition = useLicenseStore((s) => s.edition);
  const labels: Record<string, string> = {
    free: 'Version gratuite',
    standard: 'Version Standard',
    full: 'Version Complète',
  };
  const colors: Record<string, string> = {
    free: 'text-gray-400 border-gray-700',
    standard: 'text-blue-300 border-blue-500/40',
    full: 'text-purple-200 border-purple-500/40',
  };
  return (
    <span className={`text-[10px] font-semibold border rounded px-1.5 py-0.5 whitespace-nowrap ${colors[edition] ?? colors.free}`}>
      {labels[edition] ?? edition}
    </span>
  );
};

const AccountLabel: React.FC = () => {
  const licensed = useLicenseStore((s) => s.licensed);
  const email = useLicenseStore((s) => s.email);
  if (!licensed) return <span>Connexion</span>;
  const short = (email || '').split('@')[0] || 'Mon compte';
  return <span className="max-w-[140px] truncate">{short}</span>;
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
      <span className="hidden lg:inline">{t('topbar.blackout')}</span>
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
