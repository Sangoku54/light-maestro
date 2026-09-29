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
    getStatus: () => ipcRenderer.invoke('dmx:getStatus'),
    addUniverse: (config: any) => ipcRenderer.invoke('dmx:addUniverse', config),
    syncUniverses: (configs: any[]) => ipcRenderer.invoke('dmx:syncUniverses', configs),
    removeUniverse: (id: string) => ipcRenderer.invoke('dmx:removeUniverse', id),
    setSacnReceive: (id: string, enabled: boolean) =>
      ipcRenderer.invoke('dmx:setSacnReceive', id, enabled),
    listSerialPorts: () => ipcRenderer.invoke('dmx:listSerialPorts'),
    isRunning: () => ipcRenderer.invoke('dmx:isRunning'),
    applyGrandMaster: (level: number) => ipcRenderer.invoke('dmx:applyGrandMaster', level),
    onError: (callback: (msg: string) => void) => {
      const handler = (_: any, msg: string) => callback(msg);
      ipcRenderer.on('dmx:error', handler);
      return () => { ipcRenderer.removeListener('dmx:error', handler); };
    },
  },

  // Fixtures
  fixtures: {
    loadLibrary: () => ipcRenderer.invoke('fixtures:loadLibrary'),
    search: (query: string) => ipcRenderer.invoke('fixtures:search', query),
    getDefinition: (id: string) => ipcRenderer.invoke('fixtures:getDefinition', id),
    addCustom: (def: any) => ipcRenderer.invoke('fixtures:addCustom', def),
    importQLC: (filePath: string) => ipcRenderer.invoke('fixtures:importQLC', filePath),
    importGDTF: (filePath: string) => ipcRenderer.invoke('fixtures:importGDTF', filePath),
    getAll: () => ipcRenderer.invoke('fixtures:getAll'),
    getBudgetList: () => ipcRenderer.invoke('fixtures:getBudgetList'),
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
    addMapping: (mapping: any) => ipcRenderer.invoke('midi:addMapping', mapping),
    removeMapping: (id: string) => ipcRenderer.invoke('midi:removeMapping', id),
    startLearn: (target: any) => ipcRenderer.invoke('midi:startLearn', target),
    stopLearn: () => ipcRenderer.invoke('midi:stopLearn'),
    // Feedback LED : entries = [{ type: 'widget'|'scene'|'chaser'|'blackout', id?, on }]
    feedback: (entries: any) => ipcRenderer.invoke('midi:feedback', entries),
    onActivity: (callback: (a: { channel: number; type: string; note: number; value?: number }) => void) => {
      const handler = (_: any, data: any) => callback(data);
      ipcRenderer.on('midi:activity', handler);
      return () => { ipcRenderer.removeListener('midi:activity', handler); };
    },
    onTrigger: (callback: (t: { mapping: any; value: number; rawValue: number }) => void) => {
      const handler = (_: any, data: any) => callback(data);
      ipcRenderer.on('midi:trigger', handler);
      return () => { ipcRenderer.removeListener('midi:trigger', handler); };
    },
    onStatus: (callback: (s: { connected: boolean; deviceId?: string }) => void) => {
      const handler = (_: any, data: any) => callback(data);
      ipcRenderer.on('midi:status', handler);
      return () => { ipcRenderer.removeListener('midi:status', handler); };
    },
    onClock: (callback: (c: { bpm: number; running: boolean }) => void) => {
      const handler = (_: any, data: any) => callback(data);
      ipcRenderer.on('midi:clock', handler);
      return () => { ipcRenderer.removeListener('midi:clock', handler); };
    },
    onMtc: (callback: (s: any) => void) => {
      const handler = (_: any, data: any) => callback(data);
      ipcRenderer.on('midi:mtc', handler);
      return () => { ipcRenderer.removeListener('midi:mtc', handler); };
    },
    onMappingChanged: (callback: (m: any[]) => void) => {
      ipcRenderer.on('midi:mapping-changed', (_, data) => callback(data));
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

  // All-In-One structure analysis (option B, offline — python externe)
  allinone: {
    check: () => ipcRenderer.invoke('allinone:check'),
    analyze: (payload: { wavBase64: string; fileName: string; model?: string }) =>
      ipcRenderer.invoke('allinone:analyze', payload),
    cancel: () => ipcRenderer.invoke('allinone:cancel'),
    onProgress: (callback: (msg: string) => void) => {
      const handler = (_: any, msg: string) => callback(msg);
      ipcRenderer.on('allinone:progress', handler);
      return () => { ipcRenderer.removeListener('allinone:progress', handler); };
    },
  },

  // Dialog
  dialog: {
    openFile: (filters: any[]) => ipcRenderer.invoke('dialog:openFile', filters),
    saveFile: (filters: any[], defaultName: string, content: string) =>
      ipcRenderer.invoke('dialog:saveFile', filters, defaultName, content),
  },

  // Project (full-project save/load)
  project: {
    save: (payload: { content: string; blobs?: { key: string; audioFileBase64: string }[] }) =>
      ipcRenderer.invoke('project:save', payload),
    open: () => ipcRenderer.invoke('project:open'),
  },

  // Presets (file-based, avoids localStorage quota)
  presets: {
    save: (presets: any[]) => ipcRenderer.invoke('presets:save', presets),
    load: () => ipcRenderer.invoke('presets:load'),
    repairAudio: () => ipcRenderer.invoke('presets:repairAudio'),
  },

  // Last known-good audio per preset name (file-based, avoids localStorage quota)
  lastAudio: {
    save: (map: Record<string, { base64: string; fileName?: string; ts: string }>) => ipcRenderer.invoke('lastAudio:save', map),
    load: () => ipcRenderer.invoke('lastAudio:load'),
  },

  // General storage (file-based, avoids localStorage quota)
  storage: {
    get: (key: string) => ipcRenderer.invoke('storage:get', key),
    set: (key: string, data: any) => ipcRenderer.invoke('storage:set', key, data),
    remove: (key: string) => ipcRenderer.invoke('storage:remove', key),
    has: (key: string) => ipcRenderer.invoke('storage:has', key),
  },

  // Watchdog (renderer heartbeat — fail-safe blackout in the main process)
  watchdog: {
    ping: () => ipcRenderer.send('watchdog:ping'),
  },

  // App-level controls
  app: {
    setLocale: (locale: string) => ipcRenderer.invoke('app:set-locale', locale),    onBeforeClose: (callback: () => void) => {
      ipcRenderer.on('app:before-close', () => callback());
      return () => { ipcRenderer.removeAllListeners('app:before-close'); };
    },
    closeAction: (action: 'save-and-quit' | 'discard') =>
      ipcRenderer.invoke('app:close-action', action),

    // Auto-update
    onUpdateStatus: (callback: (status: any) => void) => {
      const handler = (_: any, status: any) => callback(status);
      ipcRenderer.on('app:update-status', handler);
      return () => { ipcRenderer.removeListener('app:update-status', handler); };
    },
    installUpdate: () => ipcRenderer.invoke('app:install-update'),
    getUpdateStatus: () => ipcRenderer.invoke('app:get-update-status'),

    // Crash reporting
    onCrashLog: (callback: (data: { type: string; message: string; timestamp: number }) => void) => {
      const handler = (_: any, data: any) => callback(data);
      ipcRenderer.on('app:crash-log', handler);
      return () => { ipcRenderer.removeListener('app:crash-log', handler); };
    },
    getCrashLogs: () => ipcRenderer.invoke('app:get-crash-logs'),
    readCrashLog: (filename: string) => ipcRenderer.invoke('app:read-crash-log', filename),
  },

  // Remote web server (contrôle LAN — panneau UI en polling sur getStatus)
  remote: {
    getStatus: () => ipcRenderer.invoke('remote:getStatus'),
    start: () => ipcRenderer.invoke('remote:start'),
    stop: () => ipcRenderer.invoke('remote:stop'),
    // Commandes HTTP reçues par le serveur LAN, forwardées au renderer
    onCommand: (callback: (cmd: any) => void) => {
      const handler = (_: any, cmd: any) => callback(cmd);
      ipcRenderer.on('remote:command', handler);
      return () => { ipcRenderer.removeListener('remote:command', handler); };
    },
    // Snapshot d'état poussé par le renderer vers le serveur LAN (cache HTTP)
    pushState: (snapshot: any) => { ipcRenderer.send('remote:state', snapshot); },
  },

  // OSC entrant (UDP LAN — contrôleur TouchOSC/Lemur/consoles)
  osc: {
    getStatus: () => ipcRenderer.invoke('osc:getStatus'),
    start: (port?: number) => ipcRenderer.invoke('osc:start', port),
    stop: () => ipcRenderer.invoke('osc:stop'),
    // Commandes OSC reçues par le serveur UDP, forwardées au renderer
    onCommand: (callback: (cmd: any) => void) => {
      const handler = (_: any, cmd: any) => callback(cmd);
      ipcRenderer.on('osc:command', handler);
      return () => { ipcRenderer.removeListener('osc:command', handler); };
    },
  },

  // Licence (connexion compte — état exposé, logique côté main)
  license: {
    getState: () => ipcRenderer.invoke('license:getState'),
    login: (email: string, password: string) =>
      ipcRenderer.invoke('license:login', email, password),
    register: (email: string, password: string, displayName?: string) =>
      ipcRenderer.invoke('license:register', email, password, displayName),
    checkout: (edition: 'standard' | 'full') =>
      ipcRenderer.invoke('license:checkout', edition),
    openUrl: (url: string) => ipcRenderer.invoke('license:openUrl', url),
    logout: () => ipcRenderer.invoke('license:logout'),
  },
});
