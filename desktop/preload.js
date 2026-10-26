const { contextBridge, ipcRenderer } = require('electron');

// Expose safe desktop IPC APIs to the renderer
contextBridge.exposeInMainWorld('desktopAPI', {
  isDesktop: true,
  platform: process.platform,

  // Window control methods
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),

  // Head tracker configuration & auto-launch
  selectTrackerPath: () => ipcRenderer.invoke('select-tracker-path'),
  getTrackerStatus: () => ipcRenderer.invoke('get-tracker-status'),
  openToolsFolder: () => ipcRenderer.send('open-tools-folder'),
  openBluetoothSettings: () => ipcRenderer.send('open-bluetooth-settings'),
  scanDevices: () => ipcRenderer.invoke('scan-devices'),
  restartTracker: () => ipcRenderer.invoke('restart-tracker'),

  // Listeners for device and tracker events
  onDeviceStatusUpdate: (callback) => {
    ipcRenderer.on('device-status-update', (event, data) => callback(data));
  },
  onTrackerStatusChange: (callback) => {
    ipcRenderer.on('tracker-status-change', (event, data) => callback(data));
  },
  onHeadtrackingPose: (callback) => {
    ipcRenderer.on('headtracking-pose', (event, pose) => callback(pose));
  },

  // Head tracking & playback trigger from system tray
  onTrayAction: (callback) => {
    ipcRenderer.on('tray-action', (event, action) => callback(action));
  },

  // MPEG-H VVPlayer Integration & Audio Stream Hooking
  getMpeghStatus: () => ipcRenderer.invoke('get-mpegh-status'),
  openMpeghVv: (filePath) => ipcRenderer.invoke('open-mpegh-vv', filePath),
  getMpeghSources: () => ipcRenderer.invoke('get-mpegh-sources'),

  // JOC Dolby Atmos Object Decoder Pre-Processor
  jocGetStatus: () => ipcRenderer.invoke('joc-get-status'),
  jocDecodeOpenJOC: (filePath, layout) => ipcRenderer.invoke('joc-decode-openjoc', filePath, layout),
  jocDecodeCavernize: (filePath, layout) => ipcRenderer.invoke('joc-decode-cavernize', filePath, layout),
  jocCancel: () => ipcRenderer.send('joc-cancel'),
  jocGetRestoreInfo: () => ipcRenderer.invoke('joc-get-restore-info'),
  jocCleanup: () => ipcRenderer.send('joc-cleanup'),
  jocReadFile: (filePath) => ipcRenderer.invoke('joc-read-file', filePath),
  jocSelectFile: () => ipcRenderer.invoke('joc-select-file'),
  onJocLog: (callback) => {
    ipcRenderer.on('joc-decoder-log', (event, data) => callback(data));
  }
});
