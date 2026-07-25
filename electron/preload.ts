import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lightMaestro', {
  // DMX
  dmx: {
    start: () => ipcRenderer.invoke('dmx:start'),
    stop: () => ipcRenderer.invoke('dmx:stop'),
    setChannel: (universe: number, channel: number, value: number) =>
      ipcRenderer.invoke('dmx:setChannel', universe, channel, value),
    setChannels: (universe: number, channels: Record<number, number>) =>
      ipcRenderer.invoke('dmx:setChannels', universe, channels),
    blackout: () => ipcRenderer.invoke('dmx:blackout'),
    restore: () => ipcRenderer.invoke('dmx:restore'),
    getUniverses: () => ipcRenderer.invoke('dmx:getUniverses'),
    addUniverse: (config: any) => ipcRenderer.invoke('dmx:addUniverse', config),
    removeUniverse: (id: string) => ipcRenderer.invoke('dmx:removeUniverse', id),
    listSerialPorts: () => ipcRenderer.invoke('dmx:listSerialPorts'),
    isRunning: () => ipcRenderer.invoke('dmx:isRunning'),
  },

  // Fixtures
  fixtures: {
    loadLibrary: () => ipcRenderer.invoke('fixtures:loadLibrary'),
    search: (query: string) => ipcRenderer.invoke('fixtures:search', query),
    getDefinition: (id: string) => ipcRenderer.invoke('fixtures:getDefinition', id),
    addCustom: (def: any) => ipcRenderer.invoke('fixtures:addCustom', def),
    importQLC: (filePath: string) => ipcRenderer.invoke('fixtures:importQLC', filePath),
    getAll: () => ipcRenderer.invoke('fixtures:getAll'),
    reloadLibrary: () => ipcRenderer.invoke('fixtures:reloadLibrary'),
    getUpdateStatus: () => ipcRenderer.invoke('fixtures:getUpdateStatus'),
    onUpdateStatus: (callback: (status: any) => void) => {
      ipcRenderer.on('fixtures:update-status', (_, data) => callback(data));
    },
    onUpdateComplete: (callback: (data: any) => void) => {
      ipcRenderer.on('fixtures:update-complete', (_, data) => callback(data));
    },
  },

  // Show
  show: {
    save: (show: any, filePath?: string) => ipcRenderer.invoke('show:save', show, filePath),
    load: (filePath: string) => ipcRenderer.invoke('show:load', filePath),
    listRecent: () => ipcRenderer.invoke('show:listRecent'),
    openDialog: () => ipcRenderer.invoke('show:openDialog'),
  },

  // MIDI
  midi: {
    listDevices: () => ipcRenderer.invoke('midi:listDevices'),
    connect: (deviceId: string) => ipcRenderer.invoke('midi:connect', deviceId),
    disconnect: () => ipcRenderer.invoke('midi:disconnect'),
    getMapping: () => ipcRenderer.invoke('midi:getMapping'),
    setMapping: (mapping: any) => ipcRenderer.invoke('midi:setMapping', mapping),
    onEvent: (callback: (event: any) => void) => {
      ipcRenderer.on('midi:event', (_, data) => callback(data));
    },
    onActivity: (callback: (activity: any) => void) => {
      ipcRenderer.on('midi:activity', (_, data) => callback(data));
    },
    onTrigger: (callback: (trigger: any) => void) => {
      ipcRenderer.on('midi:trigger', (_, data) => callback(data));
    },
    onStatus: (callback: (status: any) => void) => {
      ipcRenderer.on('midi:status', (_, data) => callback(data));
    },
  },

  // Audio
  audio: {
    getDevices: () => ipcRenderer.invoke('audio:getDevices'),
    startCapture: (deviceId: string) => ipcRenderer.invoke('audio:startCapture', deviceId),
    stopCapture: () => ipcRenderer.invoke('audio:stopCapture'),
    pushBuffer: (buffer: Float32Array) => ipcRenderer.send('audio:pushBuffer', buffer),
    onAnalysis: (callback: (analysis: any) => void) => {
      ipcRenderer.on('audio:analysis', (_, data) => callback(data));
    },
    importFile: () => ipcRenderer.invoke('audio:import'),
  },

  // Dialog
  dialog: {
    openFile: (filters: any[]) => ipcRenderer.invoke('dialog:openFile', filters),
    saveFile: (filters: any[], defaultName: string, content: string) =>
      ipcRenderer.invoke('dialog:saveFile', filters, defaultName, content),
  },

  // Project (full-project save/load)
  project: {
    save: (content: string) => ipcRenderer.invoke('project:save', content),
    open: () => ipcRenderer.invoke('project:open'),
  },

  // Presets (file-based, avoids localStorage quota)
  presets: {
    save: (presets: any[]) => ipcRenderer.invoke('presets:save', presets),
    load: () => ipcRenderer.invoke('presets:load'),
  },

  // General storage (file-based, avoids localStorage quota)
  storage: {
    get: (key: string) => ipcRenderer.invoke('storage:get', key),
    set: (key: string, data: any) => ipcRenderer.invoke('storage:set', key, data),
    remove: (key: string) => ipcRenderer.invoke('storage:remove', key),
  },

  // App-level controls
  app: {
    onBeforeClose: (callback: () => void) => {
      ipcRenderer.on('app:before-close', () => callback());
      return () => { ipcRenderer.removeAllListeners('app:before-close'); };
    },
    closeAction: (action: 'save-and-quit' | 'discard') =>
      ipcRenderer.invoke('app:close-action', action),
  },
});
