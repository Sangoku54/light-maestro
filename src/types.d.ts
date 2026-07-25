/// <reference types="vite/client" />

interface LightMaestroAPI {
  dmx: {
    start: () => Promise<void>;
    stop: () => Promise<void>;
    setChannel: (universe: number, channel: number, value: number) => Promise<void>;
    setChannels: (universe: number, channels: Record<number, number>) => Promise<void>;
    blackout: () => Promise<void>;
    getUniverses: () => Promise<any[]>;
    addUniverse: (config: any) => Promise<void>;
    removeUniverse: (id: string) => Promise<void>;
    listSerialPorts: () => Promise<any[]>;
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
    save: (show: any, filePath?: string) => Promise<string>;
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
    openFile: (filters: any[]) => Promise<string | null>;
    saveFile: (filters: any[], defaultName: string) => Promise<string | null>;
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
