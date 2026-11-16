import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';

// Traduction hors composant (saveProject) : instance i18next directe.
const t0 = (k: string, o?: Record<string, unknown>) => i18next.t(k, o);
import { useAppStore, AppMode } from './stores/appStore';
import { useShowStore, type FixturePos } from './stores/showStore';
import { loadFixturePositionsMeters } from './utils/fixture-height';
import { useLicenseStore } from './stores/licenseStore';
import { usePerformStore } from './stores/performStore';
import { TopBar } from './components/layout/TopBar';
import { Sidebar } from './components/layout/Sidebar';
import { QuickShowView } from './views/QuickShowView';
import { ToastHost, toast } from './components/Toast';
import { SafetyModal } from './components/SafetyModal';
import { DisclaimerModal } from './components/DisclaimerModal';
import { DesignView } from './views/DesignView';
import { PerformanceView } from './views/PerformanceView';
import { VcPlaybackHost } from './components/VcPlaybackHost';
import { MasterClockBar } from './components/MasterClockBar';
import { AudioCaptureProvider } from './hooks/useAudioCapture';
import { useAudioFileLoader } from './hooks/useAudioFileLoader';
import { useRgbMatrixPlayback } from './hooks/rgb-matrix-playback';
import { useGroupMasters } from './hooks/use-group-masters';
import { useMidiTriggers } from './hooks/midi-trigger';
import { useLoopLocale } from './hooks/use-loop-locale';
import { useMidiFeedback } from './hooks/use-midi-feedback';
import { useRemoteTriggers } from './hooks/remote-trigger';
import { useMtcTriggers } from './hooks/mtc-trigger';
import { useOscTriggers } from './hooks/osc-trigger';
import { getLatencyMs } from './utils/latency-meter';
import { dmxBridge } from './utils/dmx-bridge';
import { collectCustomFixtureDefs, importCustomFixtureDefs } from './utils/custom-fixtures';
import { externalizeProjectAudio, writeAudioBlobs, resolveProjectAudio, resolveWidgetAudio, audioKeyOf, type ExtractedBlob } from './utils/project-audio';
import { stripUncloneable } from './utils/ipc-safe';
import { createSaveQueue, type SaveOutcome } from './utils/save-queue';
import { version as appVersion } from '../package.json';
import './styles/global.css';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, background: '#1a0000', color: '#ff4444', height: '100vh', fontFamily: 'monospace' }}>
          <h1>App Crash</h1>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{this.state.error?.message}</pre>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, color: '#994444', marginTop: 10 }}>{this.state.error?.stack?.slice(0, 500)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Project save (shared by Ctrl+S / __lm_save, Save & Quit and autosave) ───
const AUTOSAVE_INTERVAL_MS = 45 * 1000;

interface SaveOptions {
  silent?: boolean;
  /** Autosave : ne PAS attendre une sauvegarde en cours, l'abandonner. */
  skipIfBusy?: boolean;
}

// Exclusion mutuelle par FILE D'ATTENTE (et non par booléen).
//
// Avec un booléen, une 2e sauvegarde était REFUSÉE (return false). Or
// « Sauvegarder & Quitter » faisait ensuite `markClean()` + `closeAction
// ('discard')` → l'app QUITTAIT sans rien écrire. Cliquer « Sauvegarder &
// Quitter » pendant l'autosave de 45 s = TOUT LE TRAVAIL PERDU, sans
// avertissement. La file ATTEND la sauvegarde en cours puis s'exécute avec
// l'état courant → la demande n'est jamais perdue.
// (file + tests : src/utils/save-queue.ts)
const projectSaveQueue = createSaveQueue();

/**
 * Serialize the FULL project (app store + show store incl. scenes/chasers/
 * effects/cueLists/shows/songPresets + virtual console widgets) and persist it.
 *
 * - silent=false → open the .lmproj save dialog (same path as Ctrl+S / __lm_save)
 * - silent=true  → write the userData autosave slot, no dialog, no toast
 *
 * Never throws.
 */
async function saveProject(options: SaveOptions = {}): Promise<SaveOutcome> {
  if (!options.silent && projectSaveQueue.busy) {
    try { toast(t0('toasts.saving'), 'err'); } catch {}
  }
  return projectSaveQueue.run(() => performSave(options), { skipIfBusy: options.skipIfBusy });
}

async function performSave(options: SaveOptions = {}): Promise<SaveOutcome> {
  try {
    const showState = useShowStore.getState();
    const perfState = usePerformStore.getState();
    const appState = useAppStore.getState();
    // getState() renvoie AUSSI les actions (setMode, markDirty,…) — sans ce
    // filtre, storage:set / project:save plantent en IPC :
    // « An object could not be cloned ».
    const persistable = Object.fromEntries(
      Object.entries(appState).filter(
        ([k, v]) =>
          !['isDirty', 'dirtyAt', 'markDirty', 'markClean'].includes(k) &&
          typeof v !== 'function',
      ),
    ) as Omit<typeof appState, 'isDirty' | 'dirtyAt' | 'markDirty' | 'markClean'>;
    // Strip showData from widget configs (large binary, stored separately in show store)
    // but preserve showId and showName so the show can be found in the store on load.
    // Strip showData (gros binaire, stocké séparément dans le show store) et
    // externalise l'audio des widgets (ex. audioAutoScript : config.audioDataUrl
    // = data URL complète) — sinon le plafond de string V8 est déplacé, pas
    // supprimé.
    const widgetBlobs: ExtractedBlob[] = [];
    const widgetBlobKeys: string[] = [];
    const widgets: any[] = [];
    for (const w of perfState.vcWidgets) {
      let out: any = w;
      if (out.config?.showData) {
        const { showData, ...rest } = out.config;
        out = { ...out, config: { ...rest, showId: showData.id, showName: showData.name } };
      }
      const audioDataUrl = out.config?.audioDataUrl;
      const existingRef = out.config?.audioRef;
      if (typeof audioDataUrl === 'string' && audioDataUrl.length >= 1024) {
        try {
          const key = await audioKeyOf(audioDataUrl);
          widgetBlobs.push({ key, audioFileBase64: audioDataUrl });
          widgetBlobKeys.push(key);
          out = { ...out, config: { ...out.config, audioDataUrl: undefined, audioRef: key } };
        } catch { /* champ illisible → conservé tel quel */ }
      } else if (typeof existingRef === 'string' && existingRef.length > 0) {
        // Audio déjà externalisé : le blob est dans le userData, le main
        // process le lira sur disque au pack de l'enveloppe. On ne le relit
        // PAS ici (55 Mo de base64 dans le renderer → OOM).
        widgetBlobKeys.push(existingRef);
      }
      widgets.push(out);
    }
    // Embarquer les définitions des fixtures custom : elles vivent dans
    // userData/fixtures et ne sont pas packagées → sans ça, un projet ouvert
    // sur une machine vierge ne peut pas résoudre ses fixtures patchées.
    const customFixtures = await collectCustomFixtureDefs(showState.patchedFixtures);
    // Externalise les blobs audio (songPresets ~55 Mo par chanson, shows,
    // tracks) hors du JSON du projet : au-delà de la taille maximale de
    // string de V8 (~536 Mo), JSON.stringify jette RangeError et la
    // sauvegarde échoue silencieusement (plus de sauvegarde possible après
    // ~8 presets paramétrés dans des widgets).
    const storage = window.lightMaestro?.storage;
    // Externalise les blobs audio : le store garde des RÉFÉRENCES (audioRef),
    // le contenu vit dans le userData et est lu à la demande par le main
    // process au moment de packer l'enveloppe .lmproj (jamais de base64 de
    // 55 Mo × N dans le renderer → OOM sur machine peu mémoire).
    const { presets: songPresetsOut, shows: showsOut, blobs, blobKeys } = await externalizeProjectAudio(
      showState.songPresets ?? [],
      showState.shows ?? [],
    );
    const data = {
      schemaVersion: 1,
      appStore: persistable,
      customFixtures,
      showStore: {
        patchedFixtures: showState.patchedFixtures,
        stageDims: showState.stageDims,
        stageDecks: showState.stageDecks,
        stageRigs: showState.stageRigs,
        universes: showState.universes,
        fixturePositions: showState.fixturePositions,
        fixtureHeightUnit: 'm',
        fixtureGroups: showState.fixtureGroups,
        musicians: showState.musicians,
        view3D: showState.view3D,
        stageScene: showState.stageScene,
        scenes: showState.scenes,
        sceneFolders: showState.sceneFolders,
        chasers: showState.chasers,
        effects: showState.effects,
        cueLists: showState.cueLists,
        shows: showsOut,
        songPresets: songPresetsOut,
        mtcMarkers: showState.mtcMarkers,
      },
      vcWidgets: widgets,
      // Pages AVANT les widgets (un widget référence un pageIndex) : sans elles,
      // la page « Akai MIDIMIX » et ses onglets disparaîtraient à la réouverture
      // alors que ses widgets sont bien rechargés.
      vcPages: perfState.vcPages,
      vcActivePage: perfState.vcActivePage,
      vcGridSnap: perfState.vcGridSnap,
      version: 1,
      timestamp: new Date().toISOString(),
    };

    const allBlobs = [...blobs, ...widgetBlobs];
    // Toutes les clés à embarquer dans l'enveloppe .lmproj : les blobs neufs
    // (contenu en mémoire) ET ceux déjà externalisés (déjà dans le userData).
    const allBlobKeys = Array.from(new Set([...blobKeys, ...widgetBlobKeys]));
    const writeBlobs = async () => {
      if (storage?.set && storage?.has) await writeAudioBlobs(allBlobs, storage);
    };
    if (options.silent) {
      // No dialog: persist the full snapshot to the stable autosave slot.
      // NOTE: does NOT mark the project clean — only an explicit save (Ctrl+S /
      // Save & Quit) clears the dirty flag, so the quit save reminder stays active.
      // L'autosave reste LOCAL (même machine, userData) → l'audio garde la
      // forme externalisée (blobs userData + références) : embarqué ici, le
      // JSON.stringify de storage:set dépasserait la limite de string de V8.
      // Le .lmproj EXPLICITE, lui, embarque l'audio (enveloppe binaire).
      await writeBlobs();
      // Belt-and-braces : aucun champ non clonable ne doit partir en IPC
      // (functions / symbols → DataCloneError « could not be cloned »).
      const ok = await window.lightMaestro?.storage?.set('autosave', stripUncloneable(data));
      return ok ? 'saved' : 'failed';
    }

    const json = JSON.stringify(data, null, 2);
    // Embarque l'audio DANS le fichier .lmproj (conteneur binaire) via le main
    // process — le projet devient autonome et portable entre machines.
    // + écriture traversante dans userData (skip si déjà stocké) : si
    // l'enveloppe venait à perdre un blob, la résolution au rechargement et
    // la résolution à la lecture (ref->hit) le retrouvent quand même en local.
    await writeBlobs();
    const projectApi = window.lightMaestro?.project;
    if (!projectApi?.save) {
      if (!options.silent) {
        try { toast(t0('toasts.saveApi'), 'err'); } catch {}
      }
      return 'failed';
    }
    const saved = await projectApi.save({
      content: json,
      blobKeys: allBlobKeys,
    });
    if (saved) {
      useAppStore.getState().markClean();
      // Set project name from save result (project:save resolves to the file path)
      const filePath = typeof saved === 'string' ? saved : saved?.filePath;
      if (filePath) {
        const fileName = String(filePath).split(/[/\\]/).pop()?.replace(/\.lmproj$/i, '') || '';
        useAppStore.getState().setProjectName(fileName || 'Sans titre');
      }
      // Audio absent du userData : le .lmproj est écrit SANS lui, mais le
      // manifeste le référence encore → le projet n'est plus autonome et le
      // son est perdu en silence. On prévient l'utilisateur.
      const missingKeys = typeof saved === 'object' && saved ? saved.missingKeys : undefined;
      if (missingKeys && missingKeys.length > 0) {
        console.warn('[save] blobs audio absents du projet :', missingKeys);
        try {
          toast(
            t0('toasts.saveMissingAudio', { count: missingKeys.length }),
            'err',
          );
        } catch {}
      }
      return 'saved';
    }
    // falsy = dialog cancelled (null) or IPC failure — silent for cancel,
    // visible when the API itself blew up (no path, no toast otherwise).
    if (!options.silent && saved === false) {
      try { toast(t0('toasts.saveRefused'), 'err'); } catch {}
    }
    return saved === null ? 'cancelled' : 'failed';
  } catch (e) {
    console.error('Failed to save project:', e);
    try { toast(t0('toasts.saveFailed', { msg: e instanceof Error ? e.message : String(e) }), 'err'); } catch {}
    return 'failed';
  }
}

const App: React.FC = () => {
  const { t } = useTranslation();
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const safetyAccepted = useAppStore((s) => s.safetyAccepted);
  const disclaimerAccepted = useAppStore((s) => s.disclaimerAccepted);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // ─── Licence : charger l'état au démarrage (édition + limites) ────
  // + pousser la langue au main (tray + dialogues natifs localisés).
  useEffect(() => {
    try {
      const lang = localStorage.getItem('light-maestro-lang');
      if (lang === 'fr' || lang === 'en') {
        window.lightMaestro?.app?.setLocale?.(lang)?.catch?.(() => {});
      }
    } catch { /* main non dispo */ }
    useLicenseStore.getState().refresh();
  }, []);

  // Lifted to App level — audio survives ALL tab AND mode switches
  const audioFile = useAudioFileLoader();

  // Licence — boutons d'upgrade en bas de page
  const license = useLicenseStore();

  // RGB Matrix playback engine — runs globally, writes DMX directly
  useRgbMatrixPlayback();
  useGroupMasters();

  // MIDI triggers — global (scènes/chasers/cuelists/autoscript/widgets)
  useMidiTriggers();
  // Libellés moteur des boucles : suivent la langue UI.
  useLoopLocale();

  // Feedback MIDI (LED des pads du contrôleur) — état des tuiles poussé au main
  useMidiFeedback();

  // Remote web LAN (lot #17) — commandes HTTP du serveur + push d'état
  useRemoteTriggers();

  // MTC entrant (lot #15) — cues sur timecode (global, toutes vues)
  useMtcTriggers();

  // OSC entrant (lot #16) — commandes UDP TouchOSC/Lemur (global, toutes vues)
  useOscTriggers();

  // Clear old persisted widgets from localStorage (now saved in project file)
  useEffect(() => {
    try {
      const key = 'light-maestro-perform';
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.state?.vcWidgets?.length > 0) {
          delete parsed.state.vcWidgets;
          localStorage.setItem(key, JSON.stringify(parsed));
        }
      }
    } catch { /* ignore */ }
  }, []);

  // Force default view on startup : QuickShow + onglet Script auto.
  // Persists the last-used mode in localStorage but always resets here
  // so a fresh launch (or after __lm_new) always starts on the right screen.
  useEffect(() => {
    const st = useAppStore.getState();
    if (st.mode !== 'quick' || st.quickSidebarTab !== 'autoscript') {
      useAppStore.setState({ mode: 'quick', quickSidebarTab: 'autoscript' });
    }
  }, []);

  // ─── Close Guard ─────────────────────────────────────────
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // ─── DMX Error Popup ────────────────────────────────────
  const [dmxError, setDmxError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.lightMaestro?.dmx;
    if (!api?.onError) return;
    const unsub = api.onError((msg: string) => {
      if (!dmxError) setDmxError(msg);
    });
    return unsub;
  }, [dmxError]);

  useEffect(() => {
    if (!window.lightMaestro?.app?.onBeforeClose) return;
    const unsub = window.lightMaestro.app.onBeforeClose(() => {
      if (useAppStore.getState().isDirty) {
        setShowCloseModal(true);
      } else {
        // No unsaved changes — close immediately
        window.lightMaestro.app.closeAction('discard');
      }
    });
    return unsub;
  }, []);

  // ─── ShowStore: no auto-load on startup (project starts fresh) ──

  const syncUniversesToEngine = async (universes: any[]) => {
    const api = window.lightMaestro?.dmx;
    const configs = (universes || []).map((u: any) => ({
      id: u.id, name: u.name, type: u.type || 'usb-dmx',
      output: true, input: false, channels: u.channels || 512,
      serialPort: u.serialPort || '', artnetIP: u.artnetIP || '',
      artnetSubnet: u.artnetSubnet ?? 0, artnetUniverse: u.artnetUniverse ?? 0,
      sacnUniverse: u.sacnUniverse ?? 1, sacnPriority: u.sacnPriority ?? 100,
    }));
    try {
      if (api.syncUniverses) {
        await api.syncUniverses(configs).catch(() => {});
      } else {
        for (const u of configs) await api.addUniverse(u).catch(() => {});
      }
    } catch { /* engine may not be ready yet */ }
  };

  // Keep the DMX engine's universe table mirroring showStore.universes so that
  // every output path (playback, Simple Desk, RGB matrix, design live-edit)
  // always has a registered hardware target — even right after a project load.
  const showUniverses = useShowStore((s) => s.universes);
  useEffect(() => {
    const id = setTimeout(() => syncUniversesToEngine(showUniverses), 150);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showUniverses]);

  // ─── Project: New / Save / Open (.lmproj) ──────────
  useEffect(() => {
    (window as any).__lm_new = () => {
      // Clear project identity
      useAppStore.getState().setProjectName('');
      useAppStore.getState().setPresetName('');
      // Wipe persisted state
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith('light-maestro') || k.startsWith('zustand')) {
          localStorage.removeItem(k);
        }
      });
      // Clear showStore
      const ss = useShowStore.getState();
      ss.setPatchedFixtures([]);
      ss.setShowUniverses([]);
      ss.setFixturePositions({});
      ss.setFixtureGroups([]);
      ss.setScenes([]);
      ss.setSceneFolders([]);
      ss.setChasers([]);
      ss.setEffects([]);
      ss.setCueLists([]);
      ss.setShows([]);
      ss.setSongPresets([]);
      ss.setMtcMarkers([]);
      usePerformStore.getState().vcSetWidgets([]);
      // Also remove persisted show-store from disk
      window.lightMaestro?.storage?.remove('show-store').catch(() => {});
      window.location.reload();
    };

    (window as any).__lm_open = async () => {
      try {
        const result = await window.lightMaestro?.project?.open();
        if (!result) return;
        const data = JSON.parse(result.content);
        // Ré-importer les fixtures custom embarquées AVANT que les fixtures
        // patchées ne tentent de résoudre leurs définitions (getDefinition).
        await importCustomFixtureDefs(data.customFixtures);
        // Extract project name from file path
        if (result.filePath) {
          const fileName = result.filePath.split(/[/\\]/).pop()?.replace(/\.lmproj$/i, '') || '';
          useAppStore.getState().setProjectName(fileName || 'Sans titre');
        }
        const ss = useShowStore.getState();
        // PROTOCOLE STREAMING : le main process a écrit les blobs audio de
        // l'enveloppe DIRECTEMENT dans le userData (un par un) et ne renvoie
        // que le manifeste + la liste des clés. Le renderer ne materialise
        // donc JAMAIS 55 Mo × N de base64 → pas d'OOM au chargement.
        //
        // Le store garde des RÉFÉRENCES (audioRef) ; le blob est relu à la
        // demande au moment de la lecture (resolveAudioUrl → storage.get).
        const storageApi = window.lightMaestro?.storage;
        const getAudio = async (key: string): Promise<string | undefined> => {
          if (storageApi?.get) {
            try {
              const stored = await storageApi.get(key);
              const b64 = typeof stored === 'string' ? stored : stored?.audioFileBase64;
              return typeof b64 === 'string' ? b64 : undefined;
            } catch { return undefined; }
          }
          return undefined;
        };

        let resolvedShows: any[] = [];
        let resolvedPresets: any[] = [];
        try {
          const r = await resolveProjectAudio(data.showStore?.songPresets ?? [], data.showStore?.shows ?? [], getAudio);
          resolvedShows = r.shows;
          resolvedPresets = r.presets;
        } catch (e) { console.warn('Failed to resolve project audio blobs:', e); }
        if (data.showStore) {
          if (data.showStore.patchedFixtures) ss.setPatchedFixtures(data.showStore.patchedFixtures);
          if (data.showStore.stageDims) ss.setStageDims(data.showStore.stageDims);
          // Inconditionnel (migration) : un projet sans plateaux reçoit le
          // plateau unique historique, sans hériter du projet précédent.
          ss.setStageDecks(data.showStore.stageDecks);
          // Inconditionnel (migration) : un projet sans structures reçoit la
          // liste vide, sans hériter du projet précédent.
          ss.setStageRigs(data.showStore.stageRigs);
          if (data.showStore.universes) { ss.setShowUniverses(data.showStore.universes); syncUniversesToEngine(data.showStore.universes); }
          // Hauteurs : projets anciens = h normalisé 0..1 (×5 m) → migration mètres.
          const migratedPositions = loadFixturePositionsMeters<FixturePos>(data.showStore);
          if (migratedPositions) ss.setFixturePositions(migratedPositions);
          if (data.showStore.fixtureGroups) ss.setFixtureGroups(data.showStore.fixtureGroups);
          // Project-level 3D config : musiciens + camera/toggles + ponts.
          // INCONDITIONNEL (anti-héritage) : un projet sans ces champs repart
          // de zéro, sans hériter de la config du projet précédent.
          ss.setMusicians(data.showStore.musicians ?? {});
          ss.setView3D(data.showStore.view3D ?? undefined);
          ss.setProjectStageScene(data.showStore.stageScene ?? 'empty');
          if (data.showStore.scenes) ss.setScenes(data.showStore.scenes);
          // Unconditional: a project without the field must not leak folders
          // from a previously opened project (sceneFolders is a plain list).
          ss.setSceneFolders(data.showStore.sceneFolders || []);
          if (data.showStore.chasers) ss.setChasers(data.showStore.chasers);
          if (data.showStore.effects) ss.setEffects(data.showStore.effects);
          if (data.showStore.cueLists) ss.setCueLists(data.showStore.cueLists);
          // Unconditional: un projet sans ces champs ne doit pas hériter des
          // shows/presets du projet précédent (blobs audio inclus).
          ss.setShows(resolvedShows);
          ss.setSongPresets(resolvedPresets);
          if (data.showStore.mtcMarkers) ss.setMtcMarkers(data.showStore.mtcMarkers);
        }
        if (data.appStore) {
          // Don't restore session-only fields from project file
          const { presetName: _discardedPreset, projectName: _discardedProj, ...restAppStore } = data.appStore;
          useAppStore.setState(restAppStore);
        }
        // Console virtuelle : PAGES d'abord (chaque widget référence un
        // pageIndex — sans pages restaurées, la page « Akai MIDIMIX » serait
        // invisible même si ses widgets sont rechargés), puis widgets.
        // Le localStorage ne sert que de filet pour les vieux .lmproj.
        let legacyPerf: any = null;
        try {
          const raw = localStorage.getItem('light-maestro-perform');
          if (raw) legacyPerf = JSON.parse(raw)?.state ?? null;
        } catch { /* pas de source de migration */ }

        const filePages = Array.isArray(data.vcPages) && data.vcPages.length > 0 ? data.vcPages : null;
        const legacyPages = Array.isArray(legacyPerf?.vcPages) && legacyPerf.vcPages.length > 0
          ? legacyPerf.vcPages
          : null;
        const vcPages = filePages ?? legacyPages ?? [{ name: 'Main' }, { name: 'Spots' }, { name: 'Wash' }];
        usePerformStore.getState().vcSetPages(vcPages);
        if (typeof data.vcGridSnap === 'boolean') usePerformStore.getState().vcSetGridSnap(data.vcGridSnap);
        const savedActivePage = Number(data.vcActivePage);
        usePerformStore.getState().vcSetActivePage(
          Number.isFinite(savedActivePage)
            ? Math.max(0, Math.min(vcPages.length - 1, savedActivePage))
            : 0,
        );

        if (data.vcWidgets) {
          try { data.vcWidgets = await resolveWidgetAudio(data.vcWidgets, getAudio); } catch { /* blob absent */ }
        }
        if (data.vcWidgets) {
          usePerformStore.getState().vcSetWidgets(data.vcWidgets);
        } else if (Array.isArray(legacyPerf?.vcWidgets) && legacyPerf.vcWidgets.length > 0) {
          // Migration : vieux .lmproj sans vcWidgets → localStorage
          usePerformStore.getState().vcSetWidgets(legacyPerf.vcWidgets);
          useAppStore.getState().markDirty();
        }
        useAppStore.getState().markClean();
      } catch (e) { console.error('Failed to open project:', e); }
    };

    (window as any).__lm_save = async () => {
      const ok = await saveProject();
      if (ok === 'saved') {
        try { toast(t0('toasts.saved'), 'ok'); } catch {}
      }
      return ok === 'saved';
    };

    return () => {
      delete (window as any).__lm_new;
      delete (window as any).__lm_open;
      delete (window as any).__lm_save;
    };
  }, []);

  // ─── Global error visibility ────────────────────
  // Un throw dans un onClick n'atteint PAS l'ErrorBoundary → sans ça,
  // un échec de sauvegarde est totalement invisible pour l'utilisateur.
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      try { toast(t0('toasts.error', { msg: e.message }), 'err'); } catch {}
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
      try { toast(t0('toasts.errorAsync', { msg }), 'err'); } catch {}
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection as EventListener);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection as EventListener);
    };
  }, []);

  // ─── Global keyboard shortcuts ──────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        (window as any).__lm_save?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ─── Autosave ───────────────────────────────────
  // Full-project snapshot every 45 s, only when there are unsaved changes.
  // Silent: no dialog, no toast. Skipped while another save is in flight
  // (manual Ctrl+S with the dialog open, or a Save & Quit in progress) —
  // `skipIfBusy` évite d'empiler une sauvegarde derrière la boîte de
  // dialogue (l'autosave attendrait que l'utilisateur réponde).
  useEffect(() => {
    let lastAutosaveAt = 0;
    const id = setInterval(async () => {
      const { isDirty, dirtyAt } = useAppStore.getState();
      if (!isDirty) return; // nothing new since last explicit save
      if (lastAutosaveAt >= dirtyAt) return; // snapshot already up to date
      const snapshotAt = dirtyAt; // capture before the async save (micro-race guard)
      const ok = await saveProject({ silent: true, skipIfBusy: true });
      if (ok === 'saved') lastAutosaveAt = snapshotAt;
    }, AUTOSAVE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const handleSaveAndQuit = async () => {
    setSaving(true);
    let outcome: SaveOutcome = 'failed';
    try {
      // Full project save (same path as Ctrl+S / __lm_save) — scenes, chasers,
      // effects, cue lists, shows, songPresets and VC widgets are all included.
      outcome = await saveProject();
      if (outcome === 'failed') {
        // Erreur technique : on réessaie via le slot autosave pour garder la
        // session récupérable. (Ce slot n'est pas relu au démarrage — c'est
        // un filet, pas une sauvegarde à proprement parler.)
        outcome = await saveProject({ silent: true });
      }
    } catch {
      outcome = 'failed';
    }
    setSaving(false);
    if (outcome === 'failed') {
      // ÉCHEC RÉEL : on NE quitte PAS et on NE marque PAS le projet clean.
      // Avant, `markClean()` + `closeAction('discard')` partaient QUOI QU'IL
      // ARRIVE → l'app se fermait sans rien écrire (perte de données).
      // On laisse la modale ouverte : l'utilisateur peut réessayer ou
      // choisir explicitement « Jeter et quitter ».
      try { toast(t0('toasts.saveFailed', { msg: '' }), 'err'); } catch {}
      setShowCloseModal(true);
      return;
    }
    // 'saved' → projet écrit. 'cancelled' → l'utilisateur a fermé la boîte
    // de dialogue : il a choisi de ne pas enregistrer, on respecte ce choix.
    if (outcome === 'saved') {
      useAppStore.getState().markClean();
    }
    window.lightMaestro.app.closeAction('discard');
  };

  const handleDiscardAndQuit = () => {
    useAppStore.getState().markClean();
    window.lightMaestro.app.closeAction('discard');
  };

  const handleCancelClose = () => {
    setShowCloseModal(false);
  };

  const handleModeChange = useCallback((newMode: AppMode) => {
    // Leaving the design tools (or any view) releases the design-only
    // arbiter sources so the playback engine regains control — a scene
    // preview or fixture-on in the design panel must not keep pinning
    // channels (LTP) once the user switches to Perform/Quick.
    if (newMode !== 'design') {
      dmxBridge.release('design-test');
      dmxBridge.release('design-efx');
      dmxBridge.release('scene-efx');
      dmxBridge.release('fixture-onoff');
      // Le menu scène / panneau design écrit via la source 'default' (LTP 50).
      // Sans release, ces valeurs persistent et écrasent le HTP du quickshow
      // (prio 40) → l'autoscript joue mais la 3D reste figée sur la scène.
      dmxBridge.release('default');
      // Garde le programmeur (faders Live) actif : les faders de DesignView
      // restent pertinents hors du mode Design (console en overlay, etc.).
      // On ne le relâche que si on revient en Design (useProgrammerSync
      // reprend la main dès qu'un fader bouge).
    }
    setMode(newMode);
  }, [setMode]);

  // ─── Close Guard Modal ────────────────────────────
  return (
    <ErrorBoundary>
    <AudioCaptureProvider>
      <div className="app-shell bg-[#0a0a0f] text-gray-100 h-screen flex flex-col overflow-hidden">
        {/* Top Bar */}
        <TopBar
          mode={mode}
          onModeChange={handleModeChange}
        />

        <MasterClockBar />
        {/* Main Content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Sidebar */}
          <Sidebar mode={mode} collapsed={sidebarCollapsed} />

          {/* View Area — all views stay mounted, only one visible */}
          <main className="flex-1 overflow-hidden min-w-0">
            <div style={{ display: mode === 'quick' ? 'flex' : 'none' }} className="h-full flex-col min-w-0 overflow-hidden">
              <QuickShowView audioFile={audioFile} />
            </div>
            <div style={{ display: mode === 'design' ? 'flex' : 'none' }} className="h-full flex-col min-w-0 overflow-hidden">
              <DesignView />
            </div>
            <div style={{ display: mode === 'perform' ? 'flex' : 'none' }} className="h-full flex-col min-w-0 overflow-hidden">
              <PerformanceView />
            </div>
          </main>
          {/* Hôte global du lecteur de preset (Virtual Console) : monté hors
              de PerformanceView pour qu'un preset lancé depuis le téléphone
              (Remote LAN) ou MIDI joue même si l'onglet Performance n'est
              pas affiché. */}
          <VcPlaybackHost />
        </div>

        {/* Status Bar */}
        <StatusBar />
        <ToastHost />

        {/* Avertissement photosensibilité : une fois, persisté (safetyAccepted) */}
        {!safetyAccepted && <SafetyModal />}
        {/* Avertissement vue 3D / responsabilité : une fois, persisté (disclaimerAccepted) */}
        {!disclaimerAccepted && <DisclaimerModal />}

        {/* ─── Close Guard Modal ──────────────────────────── */}
        {showCloseModal && (
          <div
            className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={handleCancelClose}
          >
            <div
              className="bg-[#12121a] border border-gray-700 rounded-xl shadow-2xl w-[420px] max-w-[95vw] overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="px-6 py-4 border-b border-gray-800/50 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                  <span className="text-amber-400 text-lg">⚠</span>
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{t('closeGuard.title')}</h3>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {t('closeGuard.message')}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="p-6 space-y-3">
                <button
                  onClick={handleSaveAndQuit}
                  disabled={saving}
                  className="w-full px-4 py-3 bg-purple-600/30 border border-purple-500/30 rounded-lg text-sm text-purple-200 hover:bg-purple-600/50 active:bg-purple-600/60 transition-all font-medium flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-wait"
                >
                  {saving ? (
                    <>
                      <span className="w-4 h-4 border-2 border-purple-300 border-t-transparent rounded-full animate-spin" />
                      {t('closeGuard.saving')}
                    </>
                  ) : (
                    t('closeGuard.saveAndQuit')
                  )}
                </button>

                <button
                  onClick={handleDiscardAndQuit}
                  className="w-full px-4 py-3 bg-red-600/15 border border-red-700/30 rounded-lg text-sm text-red-300 hover:bg-red-600/25 active:bg-red-600/30 transition-all"
                >
                  {t('closeGuard.discardAndQuit')}
                </button>

                <button
                  onClick={handleCancelClose}
                  className="w-full px-4 py-3 bg-gray-800/50 border border-gray-700 rounded-lg text-sm text-gray-300 hover:bg-gray-700/50 transition-all"
                >
                  {t('common.cancel')}
                </button>
              </div>

              {/* Footer hint */}
              <div className="px-6 py-3 border-t border-gray-800/50 bg-[#0d0d14]">
                <p className="text-[10px] text-gray-600 text-center">
                  {t('closeGuard.footer')}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </AudioCaptureProvider>
    </ErrorBoundary>
  );
};

const StatusBar: React.FC = () => {
  const { t } = useTranslation();
  const blackout = useAppStore((s) => s.dmx.blackout);
  const bpm = useAppStore((s) => s.audio.bpm);
  const analyzing = useAppStore((s) => s.audio.analyzing);
  const license = useLicenseStore();

  // Live DMX output status, polled from the main-process engine
  const [dmxStatus, setDmxStatus] = useState<{
    running: boolean;
    frameRate: number;
    universes: Array<{ id: string; name: string; type: string; serialPort: string; artnetIP: string; sacnUniverse: number; active: boolean }>;
    lastError: string | null;
  } | null>(null);
  // Audio→DMX latency (renderer pipeline, rolling average over ~30 samples)
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const api = window.lightMaestro?.dmx;
      if (!api?.getStatus) return;
      try { const s = await api.getStatus(); if (alive) setDmxStatus(s); } catch {}
      setLatencyMs(getLatencyMs());
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  return (
    <footer className="h-7 bg-[#0d0d14] border-t border-gray-800 flex items-center px-4 text-xs text-gray-500 gap-2 sm:gap-4 select-none">
      <div
        className="flex items-center gap-1.5 min-w-0 overflow-hidden"
        title={[
          ...(dmxStatus?.universes || []).map((u) =>
            `${u.name || u.id} · ${u.type}${
              u.type === 'usb-dmx' ? ' · ' + (u.serialPort || 'no port')
              : u.type === 'artnet' ? ' · ' + (u.artnetIP || 'broadcast')
              : ' · U' + u.sacnUniverse
            }${u.active ? '' : ' (inactive)'}`
          ),
          ...(dmxStatus?.lastError ? ['', '⚠ ' + dmxStatus.lastError] : []),
        ].join('\n')}
      >
        <span
          className={`w-2 h-2 rounded-full ${
            dmxStatus?.lastError ? 'bg-red-500' : dmxStatus?.running ? 'bg-green-500 animate-pulse' : 'bg-gray-600'
          }`}
        />
        <span className={dmxStatus?.lastError ? 'text-red-400' : ''}>
          {dmxStatus?.lastError
            ? t('statusBar.dmxOn') + ' ⚠'
            : dmxStatus?.running
            ? `${t('statusBar.dmxOn')} ${dmxStatus.frameRate} fps`
            : t('statusBar.dmxOff')}
        </span>
        <span
          className={
            'min-w-0 truncate ' +
            (latencyMs === null
              ? 'text-gray-600'
              : latencyMs < 30
              ? 'text-green-400'
              : latencyMs < 80
              ? 'text-amber-400'
              : 'text-red-400')
          }
          title={t('statusBar.latencyHint')}
        >
          {latencyMs === null ? 'Latence audio→DMX : —' : `Latence audio→DMX : ${Math.round(latencyMs)} ms`}
        </span>
      </div>
      {blackout && (
        <span className="text-red-400 font-bold animate-pulse">{t('statusBar.blackout')}</span>
      )}
      {analyzing && (
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <span>{bpm > 0 ? `${Math.round(bpm)} BPM` : t('statusBar.listening')}</span>
        </div>
      )}
      <div className="flex items-center gap-2 mx-auto">
        <span title={`Build ${appVersion}`}>Light Maestro v{appVersion}</span>
        {license.edition === 'free' && (
          <button
            onClick={() => license.checkout('standard')}
            disabled={license.loading}
            className="px-2 py-1 rounded text-[10px] font-semibold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 transition-all"
            title={t('license.checkoutStandard')}
          >
            Standard
          </button>
        )}
        {license.edition === 'standard' && (
          <button
            onClick={() => license.checkout('full')}
            disabled={license.loading}
            className="px-2 py-1 rounded text-[10px] font-semibold bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-40 transition-all"
            title={t('license.checkoutUpgrade')}
          >
            Passer en Full
          </button>
        )}
      </div>
    </footer>
  );
};

export default App;
