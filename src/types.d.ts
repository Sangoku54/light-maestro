/// <reference types="vite/client" />

// NOTE: `export {}` makes this file a module so the `declare global`
// augmentation below is legal (TS2669 otherwise) and actually applied
// to Window — without it, `window.lightMaestro` stays unknown everywhere.

export {};

interface LightMaestroAPI {
  dmx: {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    setChannel: (universe: number, channel: number, value: number) => Promise<void>;
    setChannels: (universe: number, channels: Record<number, number>) => Promise<void>;
    blackout: () => Promise<void>;
    restore: () => Promise<void>;
    getUniverses: () => Promise<any[]>;
    getStatus: () => Promise<any>;
    addUniverse: (config: any) => Promise<void>;
    syncUniverses: (configs: any[]) => Promise<void>;
    removeUniverse: (id: string) => Promise<void>;
    listSerialPorts: () => Promise<any[]>;
    isRunning: () => Promise<boolean>;
    /** Not exposed by preload today — present only if the main process adds it later. */
    applyGrandMaster?: (value: number) => Promise<void>;
    onError: (callback: (msg: string) => void) => () => void;
  };
  fixtures: {
    loadLibrary: () => Promise<any[]>;
    search: (query: string) => Promise<any[]>;
    getDefinition: (id: string) => Promise<any>;
    addCustom: (def: any) => Promise<void>;
    importQLC: (filePath: string) => Promise<any>;
    getAll: () => Promise<any[]>;
    reloadLibrary: () => Promise<{ count: number }>;
    getUpdateStatus: () => Promise<{ checking: boolean; lastCheck: number; lastSha: string; newCount: number; error?: string }>;
    onUpdateStatus: (callback: (status: any) => void) => void;
    onUpdateComplete: (callback: (data: { newCount: number }) => void) => void;
  };
  show: {
    save: (show: any, filePath?: string | { filePath: string; name: string }) => Promise<string>;
    load: (filePath: string) => Promise<any>;
    listRecent: () => Promise<string[]>;
    openDialog: () => Promise<any | null>;
  };
  midi: {
    listDevices: () => Promise<any[]>;
    connect: (deviceId: string) => Promise<void>;
    disconnect: () => Promise<void>;
    getMapping: () => Promise<any[]>;
    setMapping: (mapping: any) => Promise<void>;
    onEvent: (callback: (event: any) => void) => void;
    onActivity: (callback: (activity: any) => void) => void;
    onTrigger: (callback: (trigger: any) => void) => void;
    onStatus: (callback: (status: any) => void) => void;
  };
  audio: {
    getDevices: () => Promise<any[]>;
    startCapture: (deviceId: string) => Promise<void>;
    stopCapture: () => Promise<void>;
    pushBuffer: (buffer: Float32Array) => void;
    onAnalysis: (callback: (analysis: any) => void) => void;
    importFile: () => Promise<{ fileName: string; filePath: string; dataUrl: string } | null>;
  };
  dialog: {
    openFile: (filters: any[]) => Promise<{ filePath: string; content: string; name: string } | null>;
    saveFile: (filters: any[], defaultName: string, content: string) => Promise<{ filePath: string; name: string } | null>;
  };
  project: {
    save: (content: string) => Promise<string | { filePath: string } | null>;
    open: () => Promise<{ content: string; filePath: string } | null>;
  };
  presets: {
    save: (presets: any[]) => Promise<void>;
    load: () => Promise<any[] | null>;
  };
  storage: {
    get: (key: string) => Promise<any>;
    set: (key: string, data: any) => Promise<boolean>;
    remove: (key: string) => Promise<void>;
  };
  app: {
    onBeforeClose: (callback: () => void) => () => void;
    closeAction: (action: 'save-and-quit' | 'discard') => Promise<void>;
  };
}

declare global {
  interface Window {
    lightMaestro: LightMaestroAPI;
  }
}
