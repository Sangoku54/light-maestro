import React from 'react';
import { useTranslation } from 'react-i18next';
import { AppMode, QuickSidebarTab, DesignSidebarTab, PerformSidebarTab, useAppStore } from '../../stores/appStore';
import {
  Mic,
  LayoutGrid,
  Sliders,
  ListMusic,
  Palette,
  Settings,
  Radio,
  Crosshair,
  Users,
  Play,
  Eye,
  Wifi,
  Timer,
} from 'lucide-react';

interface SidebarProps {
  mode: AppMode;
  collapsed: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ mode, collapsed }) => {
  const { t } = useTranslation();
  const items = getSidebarItems(mode, t);

  if (collapsed) {
    return (
      <aside className="w-12 bg-[#0d0d14] border-r border-gray-800 flex flex-col items-center py-2 gap-1 shrink-0">
        {items.map((item, i) => (
          <SidebarIconButton key={i} item={item} mode={mode} collapsed />
        ))}
      </aside>
    );
  }

  return (
    <aside className="w-56 bg-[#0d0d14] border-r border-gray-800 flex flex-col shrink-0 overflow-hidden">
      <nav className="flex-1 py-2 px-1.5 space-y-0.5 overflow-y-auto">
        {items.map((item, i) => (
          <SidebarFullButton key={i} item={item} mode={mode} />
        ))}
      </nav>

      {/* Mode hint */}
      <div className="p-3 border-t border-gray-800">
        <span className="text-[10px] text-gray-600 uppercase tracking-wider">
          {mode === 'quick' && t('sidebar.modeHint_quick')}
          {mode === 'design' && t('sidebar.modeHint_design')}
          {mode === 'perform' && t('sidebar.modeHint_perform')}
        </span>
      </div>
    </aside>
  );
};

// ─── Sidebar Buttons ───────────────────────────────────────

interface SidebarItem {
  key: string;
  label: string;
  icon: React.ReactNode;
}

const SidebarIconButton: React.FC<{ item: SidebarItem; mode: AppMode; collapsed: boolean }> = ({ item, mode }) => {
  const isActive = useIsSidebarActive(item.key, mode);

  return (
    <button
      onClick={() => setSidebarTab(item.key, mode)}
      className={`
        p-2 rounded-md transition-colors
        ${isActive
          ? 'text-purple-300 bg-purple-600/20'
          : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/30'
        }
      `}
      title={item.label}
    >
      {item.icon}
    </button>
  );
};

const SidebarFullButton: React.FC<{ item: SidebarItem; mode: AppMode }> = ({ item, mode }) => {
  const isActive = useIsSidebarActive(item.key, mode);

  return (
    <button
      onClick={() => setSidebarTab(item.key, mode)}
      className={`
        w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-medium transition-all text-left
        ${isActive
          ? 'bg-purple-600/20 text-purple-300 border-l-2 border-purple-500'
          : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/30 border-l-2 border-transparent'
        }
      `}
    >
      {item.icon}
      <span>{item.label}</span>
    </button>
  );
};

// ─── Sidebar State Helpers ─────────────────────────────────

function useIsSidebarActive(key: string, mode: AppMode): boolean {
  const qTab = useAppStore((s) => s.quickSidebarTab);
  const dTab = useAppStore((s) => s.designSidebarTab);
  const pTab = useAppStore((s) => s.performSidebarTab);

  switch (mode) {
    case 'quick': return qTab === key;
    case 'design': return dTab === key;
    case 'perform': return pTab === key;
  }
}

function setSidebarTab(key: string, mode: AppMode): void {
  const store = useAppStore.getState();
  switch (mode) {
    case 'quick': store.setQuickSidebarTab(key as QuickSidebarTab); break;
    case 'design': store.setDesignSidebarTab(key as DesignSidebarTab); break;
    case 'perform': store.setPerformSidebarTab(key as PerformSidebarTab); break;
  }
}

// ─── Sidebar Items per mode ────────────────────────────────

function getSidebarItems(mode: AppMode, t: (key: string) => string): SidebarItem[] {
  switch (mode) {
    case 'quick':
      return [
        { key: 'autoscript', label: t('sidebar.autoScript'), icon: <Mic size={16} /> },
        { key: 'colors', label: t('sidebar.colorPresets'), icon: <Palette size={16} /> },
      ];

    case 'design':
      return [
        { key: 'fixtures', label: t('sidebar.fixtures'), icon: <LayoutGrid size={16} /> },
        { key: 'stage', label: 'Vue 2D', icon: <Eye size={16} /> },
        { key: 'groups', label: t('sidebar.groups'), icon: <Users size={16} /> },
        { key: 'scenes', label: t('sidebar.scenes'), icon: <ListMusic size={16} /> },
        { key: 'chasers', label: t('sidebar.chasers'), icon: <Radio size={16} /> },
        { key: 'show', label: t('sidebar.show'), icon: <Play size={16} /> },
        { key: 'cuelists', label: t('sidebar.cueLists'), icon: <ListMusic size={16} /> },
        { key: 'rgbmatrix', label: t('sidebar.rgbMatrix'), icon: <LayoutGrid size={16} /> },
        { key: 'efx', label: t('sidebar.efx'), icon: <Crosshair size={16} /> },
        { key: 'settings', label: t('common.settings'), icon: <Settings size={16} /> },
      ];

    case 'perform':
      return [
        { key: 'vconsole', label: t('sidebar.virtualConsole'), icon: <LayoutGrid size={16} /> },
        { key: 'midi', label: t('sidebar.midiMapping'), icon: <Sliders size={16} /> },
        { key: 'remote', label: t('sidebar.remote'), icon: <Wifi size={16} /> },
        { key: 'mtc', label: t('sidebar.mtc'), icon: <Timer size={16} /> },
        { key: 'simpledesk', label: t('sidebar.simpleDesk'), icon: <Sliders size={16} /> },
        { key: 'stage', label: t('sidebar.stageView'), icon: <Eye size={16} /> },
        { key: 'cuelist', label: t('sidebar.cueList'), icon: <ListMusic size={16} /> },
        { key: 'settings', label: t('common.settings'), icon: <Settings size={16} /> },
      ];

    default:
      return [];
  }
}
