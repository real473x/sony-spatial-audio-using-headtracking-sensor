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
  getMpeghSources: () => ipcRenderer.invoke('get-mpegh-sources')
});
