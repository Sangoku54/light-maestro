/**
 * FixturePanel — Panneau latéral gauche de la vue 3D.
 *
 * Liste des fixtures patchées avec recherche, sélection, et drag.
 * Rendu optimisé avec React.memo pour éviter les re-rendus inutiles.
 */
import React, { memo, useRef, useState, useCallback } from 'react';
import { Search, List, ChevronUp, X, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useShowStore, getFixtureColor, type PatchedFixture } from '../stores/showStore';

interface FixturePanelProps {
  patchedFixtures: PatchedFixture[];
  selectedFixtureId: string | null;
  multiSelectedIds: Set<string>;
  fixtureSearch: string;
  setFixtureSearch: (v: string) => void;
  onSelect: (id: string) => void;
  onAddToSelection: (id: string) => void;
  onSetMultiSelection: (ids: Set<string>) => void;
  onCollapse: () => void;
  onExpand: () => void;
  leftDockCollapsed: boolean;
  unpatchFixture: (id: string) => void;
}

/** Bouton par fixture — memoisé pour éviter le re-render à chaque frame */
const FixtureItem = memo(({
  fixture,
  index,
  isSel,
  onSelect,
  onAddToSelection,
}: {
  fixture: PatchedFixture;
  index: number;
  isSel: boolean;
  onSelect: (id: string) => void;
  onAddToSelection: (id: string) => void;
}) => {
  const { t } = useTranslation();
  const color = getFixtureColor(index);
  // Gestion de la sélection multiple : Shift+clic ajoute la fixture à la sélection existante
  const handleSelect = (e: React.MouseEvent) => {
    // Si Shift est maintenu, on ajoute la fixture sans enlever les précédentes
    if (e.shiftKey) {
      onAddToSelection(fixture.id);
      // Empêcher le comportement par défaut de la propagation Shift
      e.stopPropagation();
      return;
    }
    onSelect(fixture.id);
  };
  return (
    <button
      onClick={handleSelect}
      className={`w-full text-left px-2.5 py-2 rounded-lg border flex items-center gap-2 transition-all ${
        isSel
          ? 'bg-purple-600/15 border-purple-500/40 text-purple-200'
          : 'bg-black/20 border-gray-800/50 text-gray-400 hover:bg-white/[0.04] hover:border-gray-700'
      }`}
      data-fixture-id={fixture.id}
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="flex-1 min-w-0 truncate text-xs font-medium">{fixture.name}</span>
      <span className="text-[10px] text-gray-500 font-mono">{fixture.startAddress}</span>
    </button>
  );
});
FixtureItem.displayName = 'FixtureItem';

export const FixturePanel = memo(function FixturePanel({
  patchedFixtures,
  selectedFixtureId,
  multiSelectedIds,
  fixtureSearch,
  setFixtureSearch,
  onSelect,
  onCollapse,
  onExpand,
  leftDockCollapsed,
  unpatchFixture,
  onAddToSelection,
  onSetMultiSelection,
}: FixturePanelProps) {
  const { t } = useTranslation();

  // Marquee selection state
  const marqueeRef = useRef<{ startX: number; startY: number; currentX: number; currentY: number; active: boolean } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [showUnpatchConfirm, setShowUnpatchConfirm] = useState(false);

  const filteredFixtures = fixtureSearch.trim()
    ? patchedFixtures.filter(f =>
        (f.name || '').toLowerCase().includes(fixtureSearch.toLowerCase()) ||
        String(f.startAddress).includes(fixtureSearch.trim())
      )
    : patchedFixtures;

  // Marquee selection handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start marquee on empty space (not on a fixture button)
    const target = e.target as HTMLElement;
    if (target.closest('[data-fixture-id]')) return;
    if (target.closest('input, button')) return;

    const rect = listRef.current?.getBoundingClientRect();
    if (!rect) return;

    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;
    marqueeRef.current = { startX, startY, currentX: startX, currentY: startY, active: true };
    e.preventDefault();
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!marqueeRef.current?.active) return;
    const rect = listRef.current?.getBoundingClientRect();
    if (!rect) return;

    marqueeRef.current.currentX = e.clientX - rect.left;
    marqueeRef.current.currentY = e.clientY - rect.top;
  }, []);

  const handleMouseUp = useCallback(() => {
    if (!marqueeRef.current?.active) {
      marqueeRef.current = null;
      return;
    }

    const m = marqueeRef.current;
    const minX = Math.min(m.startX, m.currentX);
    const maxX = Math.max(m.startX, m.currentX);
    const minY = Math.min(m.startY, m.currentY);
    const maxY = Math.max(m.startY, m.currentY);

    const listRect = listRef.current?.getBoundingClientRect();
    if (!listRect) {
      marqueeRef.current = null;
      return;
    }

    // Check which fixtures are in the marquee rectangle
    const newSelection = new Set(multiSelectedIds);
    const items = listRef.current?.querySelectorAll('[data-fixture-id]');
    if (items) {
      items.forEach((item) => {
        const itemRect = item.getBoundingClientRect();
        const itemCenterX = (itemRect.left + itemRect.right) / 2 - listRect.left;
        const itemCenterY = (itemRect.top + itemRect.bottom) / 2 - listRect.top;
        if (itemCenterX >= minX && itemCenterX <= maxX && itemCenterY >= minY && itemCenterY <= maxY) {
          const fid = item.getAttribute('data-fixture-id');
          if (fid) newSelection.add(fid);
        }
      });
    }

    // Update multi-selection via onSetMultiSelection (sets the full selection at once)
    onSetMultiSelection(newSelection);
    marqueeRef.current = null;
  }, [multiSelectedIds, onSetMultiSelection]);

  // Clean up marquee on mouse leave
  const handleMouseLeave = useCallback(() => {
    marqueeRef.current = null;
  }, []);

  if (leftDockCollapsed) {
    return (
      <div className="order-1 w-10 shrink-0 border-r border-gray-800/50 bg-[#0d0d14]/80 flex flex-col items-center py-2 gap-2">
        <button
          onClick={() => onExpand()}
          className="w-7 h-7 rounded bg-purple-600/20 text-purple-300 hover:bg-purple-600/30 border border-purple-500/30 flex items-center justify-center transition-all"
          title={t('stage3D.openFixturePanel')}
        >
          <List size={13} />
        </button>
        <span className="text-[9px] text-gray-500 [writing-mode:vertical-lr] tracking-widest uppercase font-medium">
          {t('stage3D.fixtures')}
        </span>
        <span className="text-[10px] text-purple-400 font-mono font-semibold">{filteredFixtures.length}</span>
      </div>
    );
  }

  return (
    <div className="order-1 w-[220px] xl:w-[260px] shrink-0 border-r border-gray-800/50 bg-[#0d0d14]/80 flex flex-col min-h-0">
      <div className="px-3 py-2 border-b border-gray-800/50">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold tracking-widest text-gray-400 uppercase">
            {t('stage3D.fixtures')}
          </span>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-purple-300 font-mono">{filteredFixtures.length}</span>
            <button
              onClick={onCollapse}
              className="w-5 h-5 rounded bg-black/30 border border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-600 flex items-center justify-center"
              title={t('stage3D.collapseList')}
            >
              <ChevronUp size={10} className="rotate-[-90deg]" />
            </button>
          </div>
        </div>
        <div className="mt-2 relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={fixtureSearch}
            onChange={(e) => setFixtureSearch(e.target.value)}
            placeholder={t('stage3D.searchPlaceholder')}
            className="w-full pl-7 pr-2 py-1.5 bg-black/30 border border-gray-800 rounded-lg text-xs text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-purple-500/50"
          />
        </div>

        {/* Unpatch button when multiple fixtures selected */}
        {multiSelectedIds.size > 1 && (
          <div className="mt-2 pt-2 border-t border-gray-800/50 flex items-center justify-between">
            <span className="text-[10px] text-gray-500">{t('selectedCount', { count: multiSelectedIds.size })}</span>
            <button
              onClick={() => setShowUnpatchConfirm(true)}
              className="px-2 py-1 rounded text-[10px] bg-red-600/20 text-red-400 border border-red-500/30 hover:bg-red-600/30 hover:border-red-500/50 transition-colors"
              title={t('stage3D.unpatchSelected')}
            >
              <X size={10} className="inline mr-1" /> {t('stage3D.unpatch')}
            </button>
          </div>
        )}

        {/* Unpatch confirmation dialog */}
        {showUnpatchConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={() => setShowUnpatchConfirm(false)}
          >
            <div className="bg-[#1a1a2a] border border-gray-700 rounded-xl p-4 w-[320px] mx-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={20} className="text-amber-400" />
                <span className="text-sm font-semibold text-white">{t('stage3D.unpatchConfirmTitle')}</span>
              </div>
              <p className="text-sm text-gray-300 mb-4">
                {t('stage3D.unpatchConfirmMessage', { count: multiSelectedIds.size })}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowUnpatchConfirm(false)}
                  className="px-3 py-1.5 rounded text-xs bg-gray-700 text-gray-300 hover:bg-gray-600"
                >
                  {t('cancel')}
                </button>
                <button
                  onClick={() => {
                    multiSelectedIds.forEach(id => unpatchFixture(id));
                    setShowUnpatchConfirm(false);
                  }}
                  className="px-3 py-1.5 rounded text-xs bg-red-600 text-white hover:bg-red-500"
                >
                  {t('stage3D.unpatch')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto p-2 space-y-1 relative"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: marqueeRef.current?.active ? 'crosshair' : 'default' }}
      >
        {filteredFixtures.length === 0 ? (
          <div className="text-xs text-gray-600 text-center py-8">
            {t('stage3D.noProjector')}
          </div>
        ) : (
          filteredFixtures.map((f, idx) => (
            <FixtureItem
              key={f.id}
              fixture={f}
              index={idx}
              isSel={selectedFixtureId === f.id || multiSelectedIds.has(f.id)}
              onSelect={onSelect}
              onAddToSelection={onAddToSelection}
            />
          ))
        )}

        {/* Marquee selection rectangle */}
        {marqueeRef.current?.active && (() => {
          const m = marqueeRef.current;
          const minX = Math.min(m.startX, m.currentX);
          const maxX = Math.max(m.startX, m.currentX);
          const minY = Math.min(m.startY, m.currentY);
          const maxY = Math.max(m.startY, m.currentY);
          return (
            <div
              className="absolute pointer-events-none"
              style={{
                left: minX,
                top: minY,
                width: maxX - minX,
                height: maxY - minY,
                border: '2px dashed #a855f7',
                backgroundColor: 'rgba(168, 85, 247, 0.1)',
              }}
            />
          );
        })()}
      </div>

      <div className="p-2 border-t border-gray-800/50 text-[10px] text-gray-600">
        {t('stage3D.canvasHint')}
      </div>
    </div>
  );
});
