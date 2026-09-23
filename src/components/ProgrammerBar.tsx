import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProgrammerStore } from '../stores/programmerStore';
import { useShowStore } from '../stores/showStore';
import { useAppStore } from '../stores/appStore';
import { sendChannelsToHardwareAndStore } from '../utils/dmx-helpers';
import { ensureFixtureLook, getFixtureChannelMaps } from '../utils/scene-look';
import { Trash2, Save, Layers, Sparkles } from 'lucide-react';

export const ProgrammerBar: React.FC = () => {
  const { t } = useTranslation();
  const { channels, isActive, clear } = useProgrammerStore();
  const count = Object.keys(channels).length;
  const scenes = useShowStore((s) => s.scenes);
  const createScene = useShowStore((s) => s.createScene);
  const updateScene = useShowStore((s) => s.updateScene);
  const [storeOpen, setStoreOpen] = useState(false);
  const [storeName, setStoreName] = useState('');
  const [storeMode, setStoreMode] = useState<'new' | 'update'>('new');
  const [storeTarget, setStoreTarget] = useState<string>('');
  const [storeChannels, setStoreChannels] = useState<Record<number, number>>({});

  const openStore = () => {
    setStoreChannels({ ...channels });
    setStoreMode('new');
    setStoreTarget('');
    setStoreName('');
    setStoreOpen(true);
    (window as any).__lm_storeOpen = true;
  };
  const closeStore = () => {
    setStoreOpen(false);
    (window as any).__lm_storeOpen = false;
  };

  const handleStore = () => {
    // Snapshot à l'ouverture, sinon fallback sur le live puis sur le backup
    // (programmeur pu/vide par la preview scène pendant que la modale est ouverte).
    const live = useProgrammerStore.getState().channels;
    const backupRaw = (globalThis as any).__lm_programmerBackup as Record<number, number> | undefined;
    // Sanitizer : ne garder que des adresses DMX numériques valides
    // (une clé `at` résiduelle donnerait Number('at')=NaN dans le merge).
    const backup: Record<number, number> | undefined = backupRaw
      ? Object.fromEntries(Object.entries(backupRaw).filter(([k]) => /^\d+$/.test(k)).map(([k, v]) => [Number(k), v]))
      : undefined;
    const snap = Object.keys(storeChannels).length > 0
      ? storeChannels
      : (Object.keys(live).length > 0 ? live : (backup && Object.keys(backup).length > 0 ? backup : {}));
    // Early-returns : fermer la modale TOUJOURS, sinon __lm_storeOpen reste
    // collé à true et SceneEditor ne vidé plus le programmeur (LTP 85 masque
    // design-test 60 → « tuile générée mais rien ne joue »).
    if (Object.keys(snap).length === 0) {
      try { (window as any).__lm_toast?.('Programmeur vide — rien à enregistrer', 'err'); } catch {}
      closeStore();
      return;
    }
    // Look minimal par fixture touchée : sans dimmer, la scène ne « lance »
    // rien (faisceau invisible). Idem Rec/Target — voir scene-look.ts.
    // Ne PAS muter `snap` (peut être storeChannels / état React) : copie.
    let snapFinal: Record<number, number> = snap;
    try {
      const maps = getFixtureChannelMaps();
      const ensured: Record<number, number> = { ...snap };
      for (const pf of useShowStore.getState().patchedFixtures) {
        ensureFixtureLook(ensured, pf, maps.get(pf.id) ?? null);
      }
      snapFinal = ensured;
    } catch {}
    if (storeMode === 'new') {
      const name = storeName.trim() || `Scene ${scenes.length + 1}`;
      const id = createScene(name);
      // duration 0 = hold (∞) : un look parké au Target doit rester, pas
      // blackout après le default createScene(5000).
      useShowStore.getState().updateScene(id, { channels: { ...snapFinal }, duration: 0 });
      (window as any).__lm_selectedSceneId = id;
    } else {
      const sid = storeTarget;
      if (!sid) {
        try { (window as any).__lm_toast?.('Choisissez une scène à mettre à jour', 'err'); } catch {}
        closeStore();
        return;
      }
      const sc = scenes.find((s) => s.id === sid);
      if (!sc) {
        try { (window as any).__lm_toast?.('Scène cible introuvable — sélectionnez-en une autre', 'err'); } catch {}
        closeStore();
        return;
      }
      const merged = { ...sc.channels };
      for (const [k, v] of Object.entries(snapFinal)) merged[Number(k)] = v;
      updateScene(sid, { channels: merged });
      (window as any).__lm_selectedSceneId = sid;
    }
    // Handoff transparent : bascule le look du programmeur (LTP 85) sur
    // design-test (LTP 60) AVANT clear() — sinon aucun source ne tient les
    // valeurs tant que l'éditeur n'a pas re-sélectionné la scène.
    const show = useShowStore.getState();
    sendChannelsToHardwareAndStore({ ...snapFinal }, show.patchedFixtures, show.universes, 'design-test').catch(() => {});
    useProgrammerStore.getState().clear();
    (globalThis as any).__lm_programmerBackup = undefined;
    closeStore();
    // La tuile doit être visible ET la preview doit jouer : mode design +
    // onglet Scènes (sinon isScenePreviewVisible reste false → rien ne push).
    try {
      const app = useAppStore.getState();
      if (app.mode !== 'design') app.setMode('design');
      app.setDesignSidebarTab('scenes');
    } catch {}
    try { (window as any).__lm_toast?.(storeMode === 'new' ? `Scène enregistrée (${Object.keys(snapFinal).length} ch)` : `Scène mise à jour (${Object.keys(snapFinal).length} ch)`, 'ok'); } catch {}
  };

  if (!isActive && !storeOpen) return null;

  return (
    <>
      {isActive && !storeOpen && (
        <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-3 py-2 rounded-xl bg-[#1a1a2e] border border-purple-500/40 shadow-2xl">
          <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
          <span className="text-xs font-semibold text-violet-300">Programmer</span>
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-violet-600/20 text-violet-300 border border-violet-500/30">{count} ch</span>
          <span className="text-[10px] text-gray-500 hidden sm:inline">{t('programmer.hint')}</span>
          <button onClick={openStore} className="ml-2 px-3 py-1 rounded-md bg-purple-600 text-white text-xs font-medium hover:bg-purple-500 flex items-center gap-1.5"><Save size={12} /> {t('programmer.store')}</button>
          <button onClick={clear} className="px-2.5 py-1 rounded-md bg-gray-800 text-gray-300 text-xs hover:bg-gray-700 flex items-center gap-1.5"><Trash2 size={12} /> {t('programmer.clear')}</button>
        </div>
      )}
      {storeOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60" onClick={closeStore}>
          <div className="bg-[#12121a] border border-gray-700 rounded-xl p-5 w-[360px] max-w-[95vw] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><Sparkles size={14} className="text-violet-400" /> {t('programmer.storeTitle', { count: Object.keys(storeChannels).length })}</h4>
            <div className="flex gap-1 mb-3">
              <button onClick={() => setStoreMode('new')} className={`flex-1 py-1.5 rounded text-xs font-medium border ${storeMode === 'new' ? 'bg-violet-600/20 text-violet-300 border-violet-500/40' : 'bg-gray-800 text-gray-400 border-gray-700'}`}>{t('programmer.newScene')}</button>
              <button onClick={() => setStoreMode('update')} className={`flex-1 py-1.5 rounded text-xs font-medium border ${storeMode === 'update' ? 'bg-violet-600/20 text-violet-300 border-violet-500/40' : 'bg-gray-800 text-gray-400 border-gray-700'}`}>{t('programmer.update')}</button>
            </div>
            {storeMode === 'new' ? (
              <input autoFocus value={storeName} onChange={(e) => setStoreName(e.target.value)} placeholder={t('programmer.sceneNamePlaceholder')} className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 outline-none focus:border-violet-500" />
            ) : (
              <select value={storeTarget} onChange={(e) => setStoreTarget(e.target.value)} className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-200 outline-none focus:border-violet-500">
                <option value="">{t('programmer.chooseScene')}</option>
                {scenes.map((s) => <option key={s.id} value={s.id}>{s.name} ({Object.keys(s.channels).length} ch)</option>)}
              </select>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={closeStore} className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300">{t('common.cancel')}</button>
              <button onClick={handleStore} disabled={storeMode === 'update' && !storeTarget} className="px-3 py-1.5 bg-violet-600 text-white rounded text-xs font-medium hover:bg-violet-500 disabled:opacity-40">{t('programmer.save')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
