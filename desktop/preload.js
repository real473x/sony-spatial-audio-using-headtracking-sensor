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

  // Head tracking & playback trigger from system tray
  onTrayAction: (callback) => {
    ipcRenderer.on('tray-action', (event, action) => callback(action));
  }
});
