const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const http = require('http');
const { spawn, exec, execSync } = require('child_process');
const os = require('os');
const fs = require('fs');

let mainWindow = null;
let tray = null;
let serverProcess = null;
let spawnedTrackerProcess = null;
let isQuitting = false;

const HTTP_PORT = 3000;
const SERVER_URL = `http://localhost:${HTTP_PORT}`;

// ─── 1. Settings & Persistence ────────────────────────────────────────────────

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function loadSettings() {
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf8');
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function saveSettings(settings) {
  try {
    const dir = path.dirname(getSettingsPath());
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('[Desktop] Could not save settings:', err.message);
  }
}

// ─── 2. Server Process Management ─────────────────────────────────────────────

function checkPortInUse(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/tracks`, (res) => {
      resolve(true);
    });
    req.on('error', () => {
      resolve(false);
    });
    req.setTimeout(600, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function ensureServerRunning() {
  const isRunning = await checkPortInUse(HTTP_PORT);
  if (isRunning) {
    console.log(`[Desktop] Server is already running on port ${HTTP_PORT}.`);
    return;
  }

  console.log(`[Desktop] Starting internal SpatialAudio server...`);
  const serverScript = path.join(__dirname, '..', 'server.js');
  serverProcess = spawn(process.execPath, [serverScript], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit'
  });

  serverProcess.on('error', (err) => {
    console.error('[Desktop] Failed to start server process:', err);
  });

  // Wait for server to become responsive
  for (let attempt = 0; attempt < 25; attempt++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await checkPortInUse(HTTP_PORT)) {
      console.log(`[Desktop] Internal server is ready!`);
      return;
    }
  }
  console.warn('[Desktop] Server did not respond within 5 seconds, proceeding anyway...');
}

// ─── 3. Head Tracker Supervisors (Approach B: Native HID / Approach A: Headless Bridge) ─

const dgram = require('dgram');
const Win32SonyHidTracker = require('./win32-hid-tracker');

let udpClient = null;
let nativeTracker = null;
let activeTrackerMode = 'direct'; // 'direct' (Approach B) or 'bridge' (Approach A)

function initUdpClient() {
  if (!udpClient) {
    udpClient = dgram.createSocket('udp4');
  }
}

function sendOpenTrackPacket(yaw, pitch, roll, tx = 0, ty = 0, tz = 0) {
  try {
    initUdpClient();
    const buf = Buffer.alloc(48);
    buf.writeDoubleLE(tx, 0);
    buf.writeDoubleLE(ty, 8);
    buf.writeDoubleLE(tz, 16);
    buf.writeDoubleLE(yaw, 24);
    buf.writeDoubleLE(pitch, 32);
    buf.writeDoubleLE(roll, 40);
    udpClient.send(buf, 0, 48, 4242, '127.0.0.1');
  } catch (_) {}
}

function isProcessRunning(exeName) {
  try {
    const stdout = execSync(`tasklist /fi "imagename eq ${exeName}" /nh`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return stdout.toLowerCase().includes(exeName.toLowerCase());
  } catch (e) {
    return false;
  }
}

function findTrackerExecutable() {
  const settings = loadSettings();

  // 1. Check user-configured path from settings
  if (settings.trackerExecutable && fs.existsSync(settings.trackerExecutable)) {
    return settings.trackerExecutable;
  }

  // 2. Check dedicated tools/ folder (app directory or packaged resources)
  const dedicatedCandidates = [
    path.join(__dirname, '..', 'tools', 'sony-head-tracker.exe'),
    path.join(__dirname, '..', 'tools', 'sony-head-tracker'),
    path.join(process.resourcesPath || '', 'tools', 'sony-head-tracker.exe'),
    path.join(process.resourcesPath || '', 'tools', 'sony-head-tracker')
  ];

  for (const p of dedicatedCandidates) {
    if (fs.existsSync(p)) return p;
  }

  // 3. Check system PATH
  try {
    const pathOutput = execSync('where.exe sony-head-tracker.exe', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (pathOutput && fs.existsSync(pathOutput.split('\n')[0].trim())) {
      return pathOutput.split('\n')[0].trim();
    }
  } catch (_) {}

  return null;
}

function startNativeHidTracker() {
  if (nativeTracker) return true;
  console.log('[Desktop] Starting Approach B: Native Win32 HID Direct Driver...');
  activeTrackerMode = 'direct';

  try {
    nativeTracker = new Win32SonyHidTracker();

    nativeTracker.on('pose', (pose) => {
      sendOpenTrackPacket(pose.yaw, pose.pitch, pose.roll);
      if (mainWindow) {
        mainWindow.webContents.send('headtracking-pose', pose);
      }
    });

    nativeTracker.on('status', (s) => {
      console.log(`[Desktop] [Native HID] Status: ${s.state} - ${s.message || ''}`);
      if (mainWindow) {
        mainWindow.webContents.send('tracker-status-change', { mode: 'direct', ...s });
      }
    });

    nativeTracker.on('error', (err) => {
      console.warn(`[Desktop] [Native HID] Error: ${err.message}. Falling back to Approach A...`);
      fallbackToHeadlessBridge();
    });

    nativeTracker.start();
    return true;
  } catch (err) {
    console.warn('[Desktop] Native tracker start failed, falling back to Approach A:', err.message);
    fallbackToHeadlessBridge();
    return false;
  }
}

function fallbackToHeadlessBridge() {
  if (nativeTracker) {
    nativeTracker.stop();
    nativeTracker = null;
  }
  startHeadlessBridge();
}

function startHeadlessBridge() {
  activeTrackerMode = 'bridge';
  const exeName = 'sony-head-tracker.exe';
  if (isProcessRunning(exeName)) {
    console.log(`[Desktop] ${exeName} is already running.`);
    return true;
  }

  const trackerPath = findTrackerExecutable();
  if (trackerPath) {
    console.log(`[Desktop] Starting Approach A: Silent headless bridge (${trackerPath} bridge --port 4242)...`);
    try {
      spawnedTrackerProcess = spawn(trackerPath, ['bridge', '--port', '4242'], {
        windowsHide: true,
        stdio: 'ignore'
      });
      console.log(`[Desktop] Silent headless bridge started (PID: ${spawnedTrackerProcess.pid})`);
      return true;
    } catch (err) {
      console.warn('[Desktop] Could not launch headless bridge:', err.message);
      return false;
    }
  } else {
    console.log(`[Desktop] Head tracker executable not found for fallback.`);
    return false;
  }
}

function autoStartHeadTracker() {
  // Try Approach B (Native Win32 direct HID) first
  if (activeTrackerMode === 'direct') {
    return startNativeHidTracker();
  } else {
    return startHeadlessBridge();
  }
}

function recenterHeadTracker() {
  if (nativeTracker) {
    nativeTracker.recenter();
  }
  if (mainWindow) {
    mainWindow.webContents.send('tray-action', 'recenter');
  }
}

function cleanUpProcesses() {
  if (serverProcess) {
    console.log('[Desktop] Stopping internal server process...');
    try {
      serverProcess.kill();
    } catch (_) {}
    serverProcess = null;
  }

  if (nativeTracker) {
    console.log('[Desktop] Stopping Native Win32 HID tracker...');
    try {
      nativeTracker.stop();
    } catch (_) {}
    nativeTracker = null;
  }

  if (spawnedTrackerProcess) {
    console.log('[Desktop] Stopping background bridge process...');
    try {
      if (process.platform === 'win32') {
        exec(`taskkill /pid ${spawnedTrackerProcess.pid} /f /t`);
      } else {
        spawnedTrackerProcess.kill();
      }
    } catch (_) {}
    spawnedTrackerProcess = null;
  }

  if (udpClient) {
    try { udpClient.close(); } catch (_) {}
    udpClient = null;
  }
}

async function promptUserForTrackerPath() {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Head Tracker Executable (sony-head-tracker.exe)',
    buttonLabel: 'Select Tracker',
    filters: [
      { name: 'Head Tracker Executables', extensions: ['exe'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (!canceled && filePaths.length > 0) {
    const selectedPath = filePaths[0];
    const settings = loadSettings();
    settings.trackerExecutable = selectedPath;
    saveSettings(settings);
    console.log(`[Desktop] Updated tracker path: ${selectedPath}`);

    // If tracker is not running, launch it now
    autoStartHeadTracker();
    return selectedPath;
  }
  return null;
}

// ─── 4. Tray Icon & Menu ──────────────────────────────────────────────────────

function createTrayIcon() {
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    // Luminous cyan / teal dot
    canvas[i * 4 + 0] = 56;   // B
    canvas[i * 4 + 1] = 189;  // G
    canvas[i * 4 + 2] = 248;  // R
    canvas[i * 4 + 3] = 255;  // A
  }
  return nativeImage.createFromBuffer(canvas, { width: size, height: size });
}

function setupTray() {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('SpatialAudio — Head-Tracked Spatial Audio Player');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '🎧 Show SpatialAudio',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: '🎯 Recenter Head Tracking (R)',
      click: () => {
        recenterHeadTracker();
      }
    },
    {
      label: '⏯️ Play / Pause (Space)',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('tray-action', 'play-pause');
        }
      }
    },
    { type: 'separator' },
    {
      label: '⚙️ Head Tracker Mode',
      submenu: [
        {
          label: 'Direct Win32 HID (Approach B - Experimental)',
          type: 'radio',
          checked: activeTrackerMode === 'direct',
          click: () => {
            if (spawnedTrackerProcess) {
              try { exec(`taskkill /pid ${spawnedTrackerProcess.pid} /f /t`); } catch (_) {}
              spawnedTrackerProcess = null;
            }
            startNativeHidTracker();
          }
        },
        {
          label: 'Silent Background Bridge (Approach A - Stable Fallback)',
          type: 'radio',
          checked: activeTrackerMode === 'bridge',
          click: () => {
            fallbackToHeadlessBridge();
          }
        }
      ]
    },
    {
      label: '📁 Select Head Tracker (.exe)...',
      click: () => {
        promptUserForTrackerPath();
      }
    },
    {
      label: '📂 Open Tools Folder',
      click: () => {
        const toolsDir = path.join(__dirname, '..', 'tools');
        if (!fs.existsSync(toolsDir)) fs.mkdirSync(toolsDir, { recursive: true });
        shell.openPath(toolsDir);
      }
    },
    { type: 'separator' },
    {
      label: '❌ Exit SpatialAudio',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });
}

// ─── 5. Window Creation ───────────────────────────────────────────────────────

async function createWindow() {
  await ensureServerRunning();
  autoStartHeadTracker();

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 880,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#0a0d14',
    title: 'SpatialAudio — Head-Tracked Binaural Player',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false // Keep audio processing active when window is unfocused!
    }
  });

  mainWindow.loadURL(SERVER_URL);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  setupTray();
  startDeviceWatcher();
}

// ─── 6. IPC Handlers ──────────────────────────────────────────────────────────

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('select-tracker-path', async () => {
  return await promptUserForTrackerPath();
});

ipcMain.handle('get-tracker-status', () => {
  const currentPath = findTrackerExecutable();
  const isRunning = isProcessRunning('sony-head-tracker.exe');
  return {
    configuredPath: currentPath,
    isRunning: isRunning,
    mode: activeTrackerMode,
    nativeActive: !!nativeTracker
  };
});

ipcMain.on('open-tools-folder', () => {
  const toolsDir = path.join(__dirname, '..', 'tools');
  if (!fs.existsSync(toolsDir)) fs.mkdirSync(toolsDir, { recursive: true });
  shell.openPath(toolsDir);
});

ipcMain.on('open-bluetooth-settings', () => {
  shell.openExternal('ms-settings:bluetooth');
});

ipcMain.handle('scan-devices', () => {
  return scanConnectedAudioDevices();
});

// ─── 7. In-Process WinMM Audio & Bluetooth Endpoint Scanner ───────────────────
// Instantaneous (< 1ms), pure C-FFI device enumeration without child processes

const winmm = koffi.load('winmm.dll');

const WAVEOUTCAPSW = koffi.struct('WAVEOUTCAPSW', {
  wMid: 'uint16_t',
  wPid: 'uint16_t',
  vDriverVersion: 'uint32_t',
  szPname: koffi.array('uint16_t', 32),
  dwFormats: 'uint32_t',
  wChannels: 'uint16_t',
  wReserved1: 'uint16_t',
  dwSupport: 'uint32_t'
});

const waveOutGetNumDevs = winmm.func('uint32_t __stdcall waveOutGetNumDevs()');
const waveOutGetDevCapsW = winmm.func('uint32_t __stdcall waveOutGetDevCapsW(uintptr_t uDeviceID, _Out_ WAVEOUTCAPSW *pwoc, uint32_t cbwoc)');

function scanConnectedAudioDevices() {
  if (process.platform !== 'win32') {
    return { deviceCategory: 'standard', deviceName: 'Default Audio', hasSensor: false, message: 'Audio output active' };
  }

  try {
    const num = waveOutGetNumDevs();
    const sensorKeywords = ['wf-1000xm5', 'wh-1000xm5', 'wf-1000xm6', 'wh-1000xm6', 'wh-ult900n', 'ult wear', 'linkbuds'];
    let sensorHeadset = null;
    let standardAudio = null;

    for (let i = 0; i < num; i++) {
      const caps = {};
      const res = waveOutGetDevCapsW(i, caps, 84);
      if (res === 0) {
        const rawArr = caps.szPname;
        const buf = Buffer.from(rawArr.buffer, rawArr.byteOffset, 64);
        const name = buf.toString('utf16le').replace(/\0.*$/, '').trim();
        const lower = name.toLowerCase();

        const isSensor = sensorKeywords.some(kw => lower.includes(kw));
        if (isSensor && !sensorHeadset) {
          sensorHeadset = name.replace(/^Headphones \((.*)\)$/, '$1').replace(/^Headset \((.*)\)$/, '$1');
        } else if (!standardAudio && (lower.includes('head') || lower.includes('buds') || lower.includes('pods') || lower.includes('ear') || lower.includes('speaker'))) {
          standardAudio = name.replace(/^Headphones \((.*)\)$/, '$1').replace(/^Headset \((.*)\)$/, '$1').replace(/^Speakers \((.*)\)$/, '$1');
        }
      }
    }

    if (sensorHeadset) {
      return {
        deviceCategory: 'sensor',
        deviceName: sensorHeadset,
        hasSensor: true,
        message: `${sensorHeadset} (Motion Sensor Supported)`
      };
    } else if (standardAudio) {
      return {
        deviceCategory: 'standard',
        deviceName: standardAudio,
        hasSensor: false,
        message: `${standardAudio} (Standard Audio — No Motion Sensor)`
      };
    } else {
      return {
        deviceCategory: 'none',
        deviceName: null,
        hasSensor: false,
        message: 'No headphones connected'
      };
    }
  } catch (err) {
    return {
      deviceCategory: 'standard',
      deviceName: null,
      hasSensor: false,
      message: 'Audio output active'
    };
  }
}

let lastBroadcastDeviceStatus = null;
function startDeviceWatcher() {
  setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const status = scanConnectedAudioDevices();
    if (JSON.stringify(status) !== JSON.stringify(lastBroadcastDeviceStatus)) {
      lastBroadcastDeviceStatus = status;
      mainWindow.webContents.send('device-status-update', status);
    }
  }, 2500);
}

// ─── 7. App Lifecycle ─────────────────────────────────────────────────────────

if (process.platform === 'win32') {
  app.setAppUserModelId('com.spatialaudio.player');
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  // Another instance is already running; exit immediately
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance, focus our main window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      if (!mainWindow.isVisible()) mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(createWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  app.on('before-quit', () => {
    isQuitting = true;
    cleanUpProcesses();
  });

  app.on('will-quit', () => {
    cleanUpProcesses();
  });

  app.on('window-all-closed', () => {
    isQuitting = true;
    cleanUpProcesses();
    app.quit();
  });
}

