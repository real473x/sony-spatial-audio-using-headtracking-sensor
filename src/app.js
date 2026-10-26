/**
 * SpatialAudio App
 * 
 * Wires together the audio engine, head tracker, and visualizer.
 * Handles UI events, file loading, and playback state.
 */

import { AudioEngine, SPEAKER_LAYOUTS } from './audio-engine.js';
import { HeadTracker } from './head-tracker.js';
import { Visualizer } from './visualizer.js';

class App {
  constructor() {
    this.engine = new AudioEngine();
    this.tracker = new HeadTracker();
    this.visualizer = null;
    
    this.currentFile = null;
    this.fileInfo = null;

    // Queue & Looping
    this.queue = [];
    this.queueIndex = -1;
    this.loopMode = 'none'; // 'none' | 'single' | 'all'
    this.queueOpen = true;

    // Auto-POV Spatial Effects
    this.activeEffect = null; // null | 'orbit' | 'height' | 'infinity' | 'tour'
    this.effectPace = 1.0;
    this.effectDirection = 1.0; // 1 = CW, -1 = CCW
    this.effectPhase = 0;
    this.tourCurrentSpeaker = 0;
    this.tourProgress = 0;
    this.tourHoverTimer = 0;
    this.scenePovReturnState = null;

    // Solo & Axis Calibration
    this.autoCycleInterval = null;
    this.autoCycleIndex = 0;

    // Headphone Profile & Virtual Look (Phases 1-3)
    this.headphoneMode = localStorage.getItem('spatial_headphone_mode') || 'standard';
    this.virtualHeadLook = false;
    this.virtualYaw = 0;
    this.virtualPitch = 0;
    this.ambientSway = false;
    this.ambientSwayIntensity = 0.5;
    this._swayYawOffset = 0;
    this._swayPitchOffset = 0;
    this._ambientSwayRaf = null;
    this._ambientSwayStartTime = 0;
  }

  init() {
    // ─── Theme ───────────────────────────────────────────────────────────
    this.theme = localStorage.getItem('spatial_theme') || 'light';
    this.setTheme(this.theme);
    this._initControlDeck();

    // ─── Target Channel Layout ────────────────────────────────────────────
    this.targetLayout = localStorage.getItem('spatial_target_layout') || 'auto';
    this.engine.setTargetLayout(this.targetLayout);

    // ─── Visualizer ───────────────────────────────────────────────────────
    const canvas = document.getElementById('visualizer-canvas');
    this.visualizer = new Visualizer(canvas);
    this.visualizer.setTheme(this.theme);
    const sceneSelect = document.getElementById('scene-select');
    const savedScene = localStorage.getItem('spatial_scene');
    const activeScene = this.visualizer.scenes[savedScene] ? savedScene : 'living-room';
    this.visualizer.setScene(activeScene);
    if (sceneSelect) sceneSelect.value = activeScene;
    this.visualizer.start();

    // Default preview layout on startup so 3D speaker stage is visible immediately
    const defaultLayout = this.targetLayout !== 'auto' ? this.targetLayout : '7.1.4';
    if (!this.engine.layout) {
      this.engine.setLayout(defaultLayout);
    }
    this.visualizer.setSpeakers(this.engine.layout);
    this.visualizer.setPovFollowSensor(true);
    document.querySelector('.visualizer-panel')?.classList.add('immersive-pov');
    const povButton = document.getElementById('btn-pov-lock');
    if (povButton) {
      povButton.classList.add('active');
      povButton.setAttribute('aria-pressed', 'true');
      povButton.setAttribute('aria-label', 'Switch to orbit overview');
      povButton.title = 'Immersive first-person view active. Click to switch to orbit overview (P).';
    }
    const povToggle = document.getElementById('pov-lock-toggle');
    if (povToggle) povToggle.checked = true;
    const povBadge = document.getElementById('pov-lock-badge');
    if (povBadge) {
      povBadge.textContent = 'Immersive POV';
      povBadge.style.color = 'var(--accent-cyan)';
      povBadge.style.background = 'rgba(34, 211, 238, 0.12)';
      povBadge.style.borderColor = 'rgba(34, 211, 238, 0.25)';
    }
    this._syncPovModeControls(false);
    this._updateSceneHeading();
    this._renderAdvancedChannels(this.engine.getChannelConfigs());

    // ─── Draggable Listener Position & Orientation ─────────────────────────
    this.visualizer.onListenerMove((meterX, meterY, meterZ) => {
      // If user drags listener avatar, stop any running auto-effect so user has manual control
      if (this.activeEffect) {
        this.stopEffect(false);
      }
      this.engine.setListenerPosition(meterX, meterY, meterZ);
      this._updateHeightDisplay();
    });

    this.visualizer.onOrientationChange((yaw, pitch, roll) => {
      this.virtualYaw = yaw;
      this.virtualPitch = pitch;
      this._applyVirtualOrientation();
    });

    // ─── Head Tracker ─────────────────────────────────────────────────────
    this.tracker.onUpdate((yaw, pitch, roll, pos) => {
      if (this.headphoneMode === 'standard') {
        // Standard mode silences physical sensor yaw/pitch/roll so sensor noise doesn't interfere
        return;
      }
      this.engine.updateListenerOrientation(yaw, pitch, roll);
      this.visualizer.updateHeadOrientation(yaw, pitch, roll);
      // Only set position from tracker if no automated spatial effect is running
      if (pos && !this.activeEffect) {
        this.engine.setListenerPosition(pos.x, pos.y, pos.z);
        this.visualizer.setListenerPositionMeters(pos.x, pos.y, pos.z);
        this._updateHeightDisplay();
      }
    });

    this.tracker.onStatusChange((active, info, details) => {
      this.visualizer.setTrackingStatus(this.headphoneMode === 'standard' ? true : active);
      this._updateTrackingUI(active, info, details);
    });

    this.tracker.onStep((steps, x, z) => {
      const badge = document.getElementById('step-counter-badge');
      if (badge) {
        badge.textContent = `👣 ${steps} step${steps > 1 ? 's' : ''}`;
      }
    });

    this.tracker.connect();

    // ─── Desktop Device Status & Bluetooth Settings Integration ─────────
    this.deviceStatus = null;
    this.trackingConnected = false;

    if (window.desktopAPI) {
      if (window.desktopAPI.onDeviceStatusUpdate) {
        window.desktopAPI.onDeviceStatusUpdate((deviceStatus) => {
          this._updateDeviceStatusUI(deviceStatus);
        });
      }
      if (window.desktopAPI.scanDevices) {
        window.desktopAPI.scanDevices().then((deviceStatus) => {
          this._updateDeviceStatusUI(deviceStatus);
        });
      }
    }

    const trackingStatusEl = document.getElementById('tracking-status');
    if (trackingStatusEl) {
      trackingStatusEl.addEventListener('click', () => {
        if (this.headphoneMode === 'standard') {
          this.recenter();
          this._showStatus('🎯 Standard audio orientation recentered to (0, 0, 0)');
          setTimeout(() => this._showStatus('Ready'), 1500);
        } else if (!this.trackingConnected) {
          this._showSensorHelpModal();
        } else {
          this.tracker.recenter();
          this._showStatus('🎯 Head tracking zero-point recentered');
          setTimeout(() => this._showStatus('Ready'), 2000);
        }
      });
    }

    // ─── Bootstrap default tracker state to match HTML initial values ─────
    // Yaw invert is ON by default (matches the checked HTML attribute)
    this.tracker.setInvertYaw(true);
    // Walking / Position (6-DoF) is OFF by default
    this.tracker.setPositionalEnabled(false);
    // Axis mapping order (Default: YXZ — standard in OpenTrack, tested on Sony WF-1000XM5)
    const savedAxisOrder = localStorage.getItem('spatial_axis_order') || 'YXZ';
    this.tracker.setAxisOrder(savedAxisOrder);
    const axisSelectInit = document.getElementById('axis-order-select');
    if (axisSelectInit) axisSelectInit.value = savedAxisOrder;
    const axisBadgeInit = document.getElementById('axis-order-badge');
    if (axisBadgeInit) axisBadgeInit.textContent = savedAxisOrder;

    // ─── Audio Engine Callbacks ───────────────────────────────────────────
    this.engine.onEnded(() => {
      if (this.loopMode === 'single') {
        // AudioEngine handles seamless single track repeat directly
        return;
      }
      if (this.queue.length > 0 && this.queueIndex < this.queue.length - 1) {
        this.playNext();
      } else if (this.loopMode === 'all' && this.queue.length > 0) {
        this.playQueueIndex(0);
      } else {
        this._updatePlaybackUI(false);
      }
    });

    this.engine.onLoop(() => {
      this._showStatus('Looping: Replaying track...');
      setTimeout(() => this._showStatus('Playing'), 1500);
    });

    this.engine.onSeekUpdate((time) => {
      this._updateSeekBar(time);
    });

    // ─── Level Metering Loop ──────────────────────────────────────────────
    this._meterLoop();

    // ─── UI Event Binding ─────────────────────────────────────────────────
    this._bindEvents();
    this._initGpuPreferenceSettings();

    // ─── Decoder Engine Status Check ──────────────────────────────────────
    this._checkDecoderStatus();

    console.log('[App] SpatialAudio initialized');
  }

  async _initGpuPreferenceSettings() {
    const select = document.getElementById('gpu-preference-select');
    const status = document.getElementById('gpu-preference-status');
    const restartButton = document.getElementById('btn-restart-for-gpu');
    const api = window.desktopAPI;
    if (!select || !status || !restartButton) return;

    if (!api?.getGpuPreference || !api?.setGpuPreference || !api?.restartApp) {
      select.disabled = true;
      return;
    }

    let savedPreference = select.value;
    let activePreference = select.value;
    try {
      const state = await api.getGpuPreference();
      select.value = state.preference;
      select.disabled = !state.supported;
      activePreference = state.activePreference;
      status.textContent = state.supported
        ? (state.preference !== activePreference
          ? 'A saved GPU preference is waiting for a restart. Windows or the graphics driver may override the request.'
          : 'Select a GPU preference. Restart SpatialAudio to apply it; Windows or the graphics driver may override the request.')
        : 'GPU preference is available only in the Windows desktop app.';
      restartButton.classList.toggle('hidden', !state.supported || state.preference === activePreference);
    } catch (error) {
      select.disabled = true;
      status.textContent = 'Could not load the GPU preference.';
      console.error('[App] Could not load GPU preference:', error);
      return;
    }
    if (select.disabled) return;

    savedPreference = select.value;
    select.addEventListener('change', async () => {
      select.disabled = true;
      status.textContent = 'Saving GPU preference...';
      try {
        const result = await api.setGpuPreference(select.value);
        savedPreference = result.preference;
        activePreference = result.activePreference;
        const restartRequired = savedPreference !== activePreference;
        status.textContent = restartRequired
          ? 'Saved. Restart SpatialAudio to apply; Windows or the graphics driver may override the request.'
          : 'Saved. This GPU preference is already active.';
        restartButton.classList.toggle('hidden', !restartRequired);
      } catch (error) {
        select.value = savedPreference;
        status.textContent = 'Could not save the GPU preference.';
        console.error('[App] Could not save GPU preference:', error);
      } finally {
        select.disabled = false;
      }
    });

    restartButton.addEventListener('click', () => api.restartApp());
  }

  _initControlDeck() {
    const sidebar = document.querySelector('.control-sidebar');
    const tabs = Array.from(document.querySelectorAll('.control-tab[data-panel]'));
    const title = document.getElementById('control-panel-title');
    const index = document.getElementById('control-panel-index');
    const panelNames = {
      playback: 'Playback',
      sound: 'Soundstage',
      tracking: 'Head tracking',
      tools: 'Tools & decoders'
    };

    if (!sidebar || tabs.length === 0) return;

    const selectPanel = (panel) => {
      sidebar.dataset.activePanel = panel;
      if (title) title.textContent = panelNames[panel] || 'Controls';
      const panelIndex = tabs.findIndex((tab) => tab.dataset.panel === panel);
      if (index) index.textContent = `${String(panelIndex + 1).padStart(2, '0')} / ${String(tabs.length).padStart(2, '0')}`;

      tabs.forEach((tab) => {
        const isActive = tab.dataset.panel === panel;
        tab.classList.toggle('active', isActive);
        tab.setAttribute('aria-selected', String(isActive));
        tab.tabIndex = isActive ? 0 : -1;
      });

      sidebar.querySelectorAll('[data-control-panel]').forEach((card) => {
        card.hidden = card.dataset.controlPanel !== panel;
        card.setAttribute('role', 'tabpanel');
        card.setAttribute('aria-labelledby', `tab-${card.dataset.controlPanel}`);
      });
    };

    tabs.forEach((tab, tabIndex) => {
      tab.addEventListener('click', () => selectPanel(tab.dataset.panel));
      tab.addEventListener('keydown', (event) => {
        let nextIndex = tabIndex;
        if (event.key === 'ArrowRight') nextIndex = (tabIndex + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') nextIndex = (tabIndex - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = tabs.length - 1;
        else return;

        event.preventDefault();
        tabs[nextIndex].focus();
        selectPanel(tabs[nextIndex].dataset.panel);
      });
    });

    selectPanel(sidebar.dataset.activePanel || 'playback');
  }

  async _checkDecoderStatus() {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        this._serverStatus = data;
        const ffmpegEl = document.getElementById('status-ffmpeg');
        if (ffmpegEl) {
          ffmpegEl.textContent = data.ffmpegAvailable ? '✅ Active (FFmpeg Multichannel)' : '❌ Not installed';
          ffmpegEl.style.color = data.ffmpegAvailable ? 'var(--accent-success)' : 'var(--accent-danger, #ef4444)';
        }
        this._updateMasterCustomDecodersUI();
      }
    } catch (e) {
      console.warn('[App] Could not fetch server status:', e);
    }
  }

  _updateMasterCustomDecodersUI() {
    const masterToggle = document.getElementById('toggle-custom-decoders');
    const masterBadge = document.getElementById('badge-custom-decoders');
    const container = document.getElementById('custom-decoders-container');
    const isMasterOn = this.engine.useCustomDecoders;
    if (masterToggle) masterToggle.checked = isMasterOn;
    if (container) container.classList.toggle('hidden', !isMasterOn);
    if (masterBadge) {
      masterBadge.textContent = isMasterOn ? '🟢 On' : 'Off';
      masterBadge.style.background = isMasterOn ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-card-hover)';
      masterBadge.style.color = isMasterOn ? 'var(--accent-success, #10b981)' : 'var(--text-muted)';
    }
    this._updateDecoderEngineBadges();
  }

  _updateDecoderEngineBadges() {
    const data = this._serverStatus || {};
    const ffcodecToggle = document.getElementById('toggle-engine-ffcodec');
    const ffcodecBadge = document.getElementById('badge-engine-ffcodec');
    if (ffcodecToggle) ffcodecToggle.checked = this.engine.useFFCodec;
    if (ffcodecBadge) {
      if (!this.engine.useFFCodec) {
        ffcodecBadge.textContent = '⚪ Disabled';
        ffcodecBadge.style.background = 'var(--bg-card-hover)';
        ffcodecBadge.style.color = 'var(--text-muted)';
      } else if (data.ffcodecAvailable || data.ac4Available) {
        ffcodecBadge.textContent = '🟢 Active';
        ffcodecBadge.style.background = 'rgba(16, 185, 129, 0.15)';
        ffcodecBadge.style.color = 'var(--accent-success, #10b981)';
      } else {
        ffcodecBadge.textContent = '❌ Missing';
        ffcodecBadge.style.background = 'rgba(239, 68, 68, 0.15)';
        ffcodecBadge.style.color = '#ef4444';
      }
    }
  }

  setTheme(theme) {
    const normalizedTheme = theme === 'dark' ? 'dark' : 'light';
    this.theme = normalizedTheme;
    document.documentElement.dataset.theme = normalizedTheme;
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
      const nextTheme = normalizedTheme === 'dark' ? 'light' : 'dark';
      themeToggle.setAttribute('aria-label', `Switch to ${nextTheme} mode`);
      themeToggle.title = `Switch to ${nextTheme} mode`;
      themeToggle.setAttribute('aria-pressed', String(normalizedTheme === 'dark'));
    }
    if (this.visualizer) {
      this.visualizer.setTheme(normalizedTheme);
    }
    localStorage.setItem('spatial_theme', normalizedTheme);
  }

  // ─── File Loading ───────────────────────────────────────────────────────────

  async loadFile(file) {
    const ext = (file?.name || '').toLowerCase().split('?')[0];
    const isAC4Ext = ext.endsWith('.ac4');
    const isCustomActive = this.engine.useCustomDecoders && this.engine.useFFCodec;

    // Detect AC-4 by file extension before loading if custom decoders are not enabled
    if (isAC4Ext && !isCustomActive) {
      this._showFFCodecModal(file);
      return;
    }

    try {
      this._showStatus(`Loading ${file.name}...`);
      this.currentFile = file;
      this.fileInfo = await this.engine.loadFile(file);
      
      // Update visualizer with speaker layout
      this.visualizer.setSpeakers(this.fileInfo.layout);
      this._syncSceneSpeakerPositions();
      
      this._updateFileInfo(file, this.fileInfo);
      this._renderAdvancedChannels(this.fileInfo.channelConfigs || this.engine.getChannelConfigs());
      this._showStatus('Ready');

      // Update JOC Object Decoder target file display
      const jocCurrentName = document.getElementById('joc-current-file-name');
      const jocHint = document.getElementById('joc-file-detection-hint');
      if (jocCurrentName) {
        jocCurrentName.textContent = file.name;
        const ext = (file.name || '').toLowerCase().split('.').pop();
        if (jocHint) {
          if (['eac3', 'ec3', 'm4a', 'mp4'].includes(ext)) {
            jocHint.textContent = `Detected .${ext.toUpperCase()} (may contain Atmos JOC objects). Use OpenJOC or Cavernize below to extract 7.1.4.`;
            jocHint.style.color = 'var(--accent-cyan)';
          } else {
            jocHint.textContent = `Loaded .${ext}. Recommended for JOC: .eac3 / .m4a with Atmos metadata.`;
            jocHint.style.color = 'var(--text-muted)';
          }
        }
      }
      
      // Ensure file is in queue
      if (this.queue.length === 0 || !this.queue.some(q => q.file === file)) {
        if (this.queue.length === 0) {
          this.queue.push({
            id: `q_${Date.now()}`,
            file,
            name: file.name,
            size: file.size
          });
          this.queueIndex = 0;
        }
      }
      this._renderQueue();

      // Enable play button
      document.getElementById('btn-play').disabled = false;
      
    } catch (e) {
      this._showStatus(`Error: ${e.message}`);
      console.error('[App] Load error:', e);

      // Check if file requires ffcodec64.dll
      if (e.requiresFFCodec || e.isAC4 || (e.message && (e.message.includes('AC-4') || e.message.includes('ffcodec')))) {
        this._showFFCodecModal(file);
      } else if (!this.engine.useCustomDecoders || e.unsupportedFormat) {
        // Custom decode is not on or file is unsupported without ffcodec64: show supported formats list
        this._showSupportedFormatsModal(file.name, e.message);
      }
    }
  }

  // ─── Modals: ffcodec64 & Supported Formats ──────────────────────────────────

  _showFFCodecModal(file) {
    this._pendingFFCodecFile = file;
    const overlay = document.getElementById('app-modal-overlay');
    const promptModal = document.getElementById('modal-ffcodec-prompt');
    const formatsModal = document.getElementById('modal-supported-formats');
    const filenameEl = document.getElementById('modal-ffcodec-filename');
    const statusBadge = document.getElementById('modal-ffcodec-status-badge');

    if (filenameEl) filenameEl.textContent = file ? file.name : 'Dolby AC-4 Audio File';
    if (statusBadge) {
      const hasFFCodec = this._serverStatus?.ffcodecAvailable || this._serverStatus?.ac4Available;
      if (hasFFCodec) {
        statusBadge.textContent = '🟢 ffcodec64.dll Ready';
        statusBadge.style.background = 'rgba(16, 185, 129, 0.15)';
        statusBadge.style.color = 'var(--accent-success, #10b981)';
      } else {
        statusBadge.textContent = '⚠️ ffcodec64.dll Missing in tools/';
        statusBadge.style.background = 'rgba(245, 158, 11, 0.15)';
        statusBadge.style.color = '#f59e0b';
      }
    }

    if (formatsModal) formatsModal.classList.add('hidden');
    if (promptModal) promptModal.classList.remove('hidden');
    if (overlay) overlay.classList.add('active');
  }

  _showSupportedFormatsModal(failedFileName = '', reasonMsg = '') {
    const overlay = document.getElementById('app-modal-overlay');
    const promptModal = document.getElementById('modal-ffcodec-prompt');
    const formatsModal = document.getElementById('modal-supported-formats');
    const reasonEl = document.getElementById('modal-formats-reason');

    if (reasonEl) {
      if (failedFileName) {
        reasonEl.textContent = `The file "${failedFileName}" cannot be played by the current decoder. Standard mode is active (ffcodec64.dll is OFF). Supported native audio formats:`;
      } else {
        reasonEl.textContent = `Custom decoders (ffcodec64.dll) are currently OFF. Below are the audio and surround formats supported natively without external plugins:`;
      }
    }

    if (promptModal) promptModal.classList.add('hidden');
    if (formatsModal) formatsModal.classList.remove('hidden');
    if (overlay) overlay.classList.add('active');
  }

  _showSpatialHelpModal() {
    const overlay = document.getElementById('app-modal-overlay');
    const promptModal = document.getElementById('modal-ffcodec-prompt');
    const formatsModal = document.getElementById('modal-supported-formats');
    const helpModal = document.getElementById('modal-spatial-help');

    if (promptModal) promptModal.classList.add('hidden');
    if (formatsModal) formatsModal.classList.add('hidden');
    if (helpModal) helpModal.classList.remove('hidden');
    if (overlay) overlay.classList.add('active');
  }

  async _showSensorHelpModal() {
    const overlay = document.getElementById('app-modal-overlay');
    this._hideModals();
    const sensorModal = document.getElementById('modal-sensor-help');
    if (!sensorModal || !overlay) return;

    const headingEl = document.getElementById('modal-sensor-status-heading');
    const subEl = document.getElementById('modal-sensor-status-sub');
    const badgeEl = document.getElementById('modal-sensor-badge');

    if (this.trackingConnected) {
      if (badgeEl) {
        badgeEl.textContent = '🟢 Active';
        badgeEl.style.background = 'rgba(16, 185, 129, 0.15)';
        badgeEl.style.color = 'var(--accent-success, #10b981)';
        badgeEl.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      }
      if (headingEl) headingEl.textContent = 'Sensor Active (Telemetry Streaming)';
      if (subEl) subEl.textContent = `Receiving UDP 4242 motion packets (${this.tracker?.packetsPerSecond || 25}Hz). Head tracking is working properly.`;
    } else {
      if (badgeEl) {
        badgeEl.textContent = '⚠️ Inactive';
        badgeEl.style.background = 'rgba(245, 158, 11, 0.15)';
        badgeEl.style.color = '#f59e0b';
        badgeEl.style.borderColor = 'rgba(245, 158, 11, 0.3)';
      }
      if (headingEl) headingEl.textContent = 'Sensor Inactive (No UDP 4242 Telemetry Stream)';
      if (subEl) {
        subEl.textContent = 'SpatialAudio is listening on UDP port 4242, but no motion data packets are currently arriving from the tracker.';
      }
    }

    sensorModal.classList.remove('hidden');
    overlay.classList.add('active');
  }

  _hideModals() {
    const overlay = document.getElementById('app-modal-overlay');
    const promptModal = document.getElementById('modal-ffcodec-prompt');
    const formatsModal = document.getElementById('modal-supported-formats');
    const helpModal = document.getElementById('modal-spatial-help');
    const sensorModal = document.getElementById('modal-sensor-help');
    if (overlay) overlay.classList.remove('active');
    if (promptModal) promptModal.classList.add('hidden');
    if (formatsModal) formatsModal.classList.add('hidden');
    if (helpModal) helpModal.classList.add('hidden');
    if (sensorModal) sensorModal.classList.add('hidden');
  }

  _enableFFCodecAndPlayPending() {
    this.engine.setCustomDecodersMaster(true);
    this.engine.setDecoderEngineToggle('ffcodec', true);
    this._updateMasterCustomDecodersUI();
    this._hideModals();
    this._showStatus('⚡ ffcodec64 enabled');
    
    if (this._pendingFFCodecFile) {
      const file = this._pendingFFCodecFile;
      this._pendingFFCodecFile = null;
      this.loadFile(file).then(() => {
        this.engine.play();
        this._updatePlaybackUI(true);
      });
    }
  }

  // ─── Playback Controls ─────────────────────────────────────────────────────

  togglePlay() {
    if (this.engine.isPlaying) {
      this.engine.pause();
      this._updatePlaybackUI(false);
    } else {
      this.engine.play();
      this._updatePlaybackUI(true);
    }
  }

  stop() {
    this.engine.stop();
    this._updatePlaybackUI(false);
    this._updateSeekBar(0);
  }

  seek(fraction) {
    if (!this.engine.duration) return;
    this.engine.seek(fraction * this.engine.duration);
  }

  setVolume(value) {
    this.engine.setVolume(value);
    document.getElementById('volume-value').textContent = Math.round(value * 100) + '%';
  }

  recenter() {
    this.virtualYaw = 0;
    this.virtualPitch = 0;
    this._swayYawOffset = 0;
    this._swayPitchOffset = 0;
    if (this.visualizer) {
      this.visualizer.setVirtualOrientation(0, 0, 0);
      this.visualizer.resetListenerPosition();
    }
    if (this.headphoneMode === 'sensor') {
      this.tracker.recenter();
    }
    this.engine.updateListenerOrientation(0, 0, 0);
    this.engine.resetListenerPosition();
    this._updateHeightDisplay();
    const badge = document.getElementById('step-counter-badge');
    if (badge) badge.textContent = '👣 0 steps';
    this._showStatus('Head tracking & orientation recentered');
    setTimeout(() => this._showStatus('Ready'), 1500);
  }

  // ─── Headphone Profile (Phase 1) ───────────────────────────────────────────

  setHeadphoneMode(mode, showToast = true) {
    this.headphoneMode = mode === 'sensor' ? 'sensor' : 'standard';
    localStorage.setItem('spatial_headphone_mode', this.headphoneMode);

    const isStd = this.headphoneMode === 'standard';
    const badge = document.getElementById('headphone-mode-badge');
    if (badge) {
      badge.textContent = isStd ? 'Standard' : 'Motion Sensor';
      badge.style.color = isStd ? 'var(--accent-primary)' : 'var(--accent-green, #34d399)';
      badge.style.background = isStd ? 'rgba(56, 189, 248, 0.12)' : 'rgba(52, 211, 153, 0.12)';
      badge.style.borderColor = isStd ? 'rgba(56, 189, 248, 0.25)' : 'rgba(52, 211, 153, 0.25)';
    }

    const btnStd = document.getElementById('btn-profile-standard');
    const btnSensor = document.getElementById('btn-profile-sensor');
    if (btnStd) btnStd.classList.toggle('active', isStd);
    if (btnSensor) btnSensor.classList.toggle('active', !isStd);

    const desc = document.getElementById('headphone-profile-desc');
    if (desc) {
      desc.textContent = isStd
        ? 'Standard mode: Silences sensor UDP warnings. Binaural HRTF 3D spatial audio works automatically over 3.5mm, USB-C, or regular Bluetooth earphones.'
        : 'Motion Sensor mode: Connects to OpenTrack via UDP 4242 for real-time head gyroscope orientation & 6-DoF walking.';
    }

    if (isStd) {
      this.visualizer?.setTrackingStatus(true);
      this.engine.updateListenerOrientation(this.virtualYaw, this.virtualPitch, 0);
    } else {
      this.visualizer?.setTrackingStatus(this.trackingConnected);
    }

    this._renderDeviceBadge();

    if (showToast) {
      this._showStatus(isStd
        ? '🎧 Profile: Standard Headphones (Binaural 3D active, sensor warnings silenced)'
        : '🛰️ Profile: Motion Sensor (Listening on UDP 4242)'
      );
      setTimeout(() => this._showStatus('Ready'), 2000);
    }
  }

  // ─── Virtual Head Look (Phase 2) ───────────────────────────────────────────

  setVirtualHeadLook(enabled) {
    this.virtualHeadLook = !!enabled;
    this.visualizer?.setVirtualHeadLookEnabled(this.virtualHeadLook);
    const toggle = document.getElementById('virtual-look-toggle');
    if (toggle && toggle.checked !== this.virtualHeadLook) {
      toggle.checked = this.virtualHeadLook;
    }
    const badge = document.getElementById('virtual-look-badge');
    if (badge) {
      badge.textContent = this.virtualHeadLook ? 'ON' : 'OFF';
      badge.style.color = this.virtualHeadLook ? 'var(--accent-primary)' : 'var(--text-muted)';
      badge.style.background = this.virtualHeadLook ? 'rgba(56, 189, 248, 0.15)' : 'var(--bg-card-hover)';
      badge.style.borderColor = this.virtualHeadLook ? 'rgba(56, 189, 248, 0.3)' : 'var(--border-subtle)';
    }

    if (!this.virtualHeadLook) {
      // Safe fallback: immediately reset orientation
      this.virtualYaw = 0;
      this.virtualPitch = 0;
      this.visualizer?.setVirtualOrientation(0, 0, 0);
      this._applyVirtualOrientation();
      this._showStatus('Virtual Head Look: OFF · Reset to center');
    } else {
      this._showStatus('Virtual Head Look: ON (Right-Click/Alt+Drag or ←/→ keys)');
    }
    setTimeout(() => this._showStatus('Ready'), 1500);
  }

  _applyVirtualOrientation() {
    let y = this.virtualYaw;
    let p = this.virtualPitch;
    if (this.ambientSway) {
      y += this._swayYawOffset || 0;
      p += this._swayPitchOffset || 0;
    }
    this.engine.updateListenerOrientation(y, p, 0);
    if (this.visualizer) {
      this.visualizer.yaw = y;
      this.visualizer.pitch = p;
    }
  }

  // ─── Ambient Micro-Sway Anti-Fatigue (Phase 3) ─────────────────────────────

  setAmbientSway(enabled, intensity = 0.5) {
    this.ambientSway = !!enabled;
    this.ambientSwayIntensity = intensity;

    const toggle = document.getElementById('micro-sway-toggle');
    if (toggle && toggle.checked !== this.ambientSway) {
      toggle.checked = this.ambientSway;
    }
    const badge = document.getElementById('micro-sway-badge');
    if (badge) {
      badge.textContent = this.ambientSway ? 'ON' : 'OFF';
      badge.style.color = this.ambientSway ? 'var(--accent-primary)' : 'var(--text-muted)';
      badge.style.background = this.ambientSway ? 'rgba(56, 189, 248, 0.15)' : 'var(--bg-card-hover)';
      badge.style.borderColor = this.ambientSway ? 'rgba(56, 189, 248, 0.3)' : 'var(--border-subtle)';
    }
    const sliderContainer = document.getElementById('micro-sway-slider-container');
    if (sliderContainer) {
      sliderContainer.style.opacity = this.ambientSway ? '1' : '0.5';
      sliderContainer.style.pointerEvents = this.ambientSway ? 'auto' : 'none';
    }

    if (this.ambientSway) {
      if (!this._ambientSwayRaf) {
        this._ambientSwayStartTime = performance.now();
        const swayTick = () => {
          if (!this.ambientSway) return;
          const t = (performance.now() - this._ambientSwayStartTime) * 0.001;
          this._swayYawOffset = Math.sin(t * 0.75) * (2.5 * this.ambientSwayIntensity);
          this._swayPitchOffset = Math.cos(t * 0.50) * (1.0 * this.ambientSwayIntensity);
          this._applyVirtualOrientation();
          this._ambientSwayRaf = requestAnimationFrame(swayTick);
        };
        this._ambientSwayRaf = requestAnimationFrame(swayTick);
      }
      this._showStatus('🌊 Ambient Micro-Sway active (Anti-fatigue drift)');
    } else {
      if (this._ambientSwayRaf) {
        cancelAnimationFrame(this._ambientSwayRaf);
        this._ambientSwayRaf = null;
      }
      this._swayYawOffset = 0;
      this._swayPitchOffset = 0;
      this._applyVirtualOrientation();
      this._showStatus('Ambient Micro-Sway stopped');
    }
    setTimeout(() => this._showStatus('Ready'), 1500);
  }

  setSmoothing(value) {
    this.tracker.setSmoothing(value);
    document.getElementById('smoothing-value').textContent = Math.round(value * 100) + '%';
  }

  // ─── UI Updates ────────────────────────────────────────────────────────────

  _updateFileInfo(file, info) {
    document.getElementById('file-name').textContent = file.name;

    const atmosBadge = document.getElementById('badge-atmos');
    if (atmosBadge) {
      if (info.isMPEGH) {
        atmosBadge.classList.remove('hidden');
        atmosBadge.textContent = 'SONY 360RA (MPEG-H 3D)';
        atmosBadge.style.background = 'linear-gradient(135deg, #0ea5e9, #6366f1)';
      } else {
        atmosBadge.classList.toggle('hidden', !info.isAtmos);
        if (info.isAtmos) {
          atmosBadge.textContent = info.channels === 12 ? 'DOLBY ATMOS 7.1.4' : 'DOLBY ATMOS';
          atmosBadge.style.background = '';
        }
      }
    }
    
    if (info.isMPEGH) {
      document.getElementById('file-details').textContent = 
        `Sony 360 Reality Audio (MPEG-H 3D) · 3D Immersive Soundfield · Fraunhofer VVPlayer`;
    } else {
      const layoutName = info.channels === 1 ? 'Mono' :
                         info.channels === 2 ? 'Stereo' :
                         info.channels === 6 ? '5.1 Surround' :
                         info.channels === 8 ? '7.1 Surround' :
                         info.channels === 12 ? '7.1.4 Dolby Atmos (Overhead Objects)' :
                         `${info.channels} Channels`;
      
      const desc = info.isAtmos 
        ? `${info.codec || 'Dolby Atmos'} · ${layoutName}`
        : layoutName;

      document.getElementById('file-details').textContent = 
        `${desc} · ${info.sampleRate || 48000} Hz · ${this._formatTime(info.duration || 0)}`;
    }
    
    document.getElementById('time-total').textContent = this._formatTime(info.duration || 0);
    document.getElementById('time-current').textContent = '0:00';
    
    // Update seek bar max
    const seekBar = document.getElementById('seek-bar');
    seekBar.max = 1000;
    seekBar.value = 0;
    seekBar.disabled = false;
    
    // Show file info panel, hide drop zone
    document.getElementById('drop-zone').classList.add('hidden');
    document.getElementById('player-panel').classList.remove('hidden');
  }

  _updatePlaybackUI(playing) {
    const btn = document.getElementById('btn-play');
    const icon = btn.querySelector('.btn-icon');
    icon.textContent = playing ? '⏸' : '▶';
    btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');

    // Also sync JOC mini player play/pause button if present
    const jocPlayBtn = document.getElementById('btn-joc-play-pause');
    if (jocPlayBtn) {
      jocPlayBtn.textContent = playing ? '⏸' : '▶';
      jocPlayBtn.title = playing ? 'Pause' : 'Play';
    }
  }

  _updateSeekBar(time) {
    if (!this.engine.duration) return;
    const fraction = time / this.engine.duration;
    const seekBar = document.getElementById('seek-bar');
    
    // Don't update if user is dragging
    if (document.activeElement !== seekBar) {
      seekBar.value = Math.round(fraction * 1000);
    }
    
    document.getElementById('time-current').textContent = this._formatTime(time);

    // Also sync JOC mini player seek bar and time readout
    const jocSeekBar = document.getElementById('joc-seek-bar');
    const jocTime = document.getElementById('joc-now-playing-time');
    if (jocSeekBar && document.activeElement !== jocSeekBar) {
      jocSeekBar.value = Math.round(fraction * 1000);
    }
    if (jocTime) {
      jocTime.textContent = `${this._formatTime(time)} / ${this._formatTime(this.engine.duration)}`;
    }
  }

  _updateDeviceStatusUI(deviceStatus) {
    this.deviceStatus = deviceStatus;
    this._renderDeviceBadge();
  }

  _updateTrackingUI(active, info, details) {
    this.trackingConnected = !!active;
    this.trackingDetails = details || null;
    this._renderDeviceBadge();
  }

  _renderDeviceBadge() {
    const dot = document.getElementById('tracking-dot');
    const text = document.getElementById('tracking-text');
    const container = document.getElementById('tracking-status');
    if (!dot || !text || !container) return;

    if (this.headphoneMode === 'standard') {
      dot.className = 'tracking-dot standard';
      text.textContent = '🎧 Standard Audio (Binaural 3D Active)';
      container.title = 'Standard / Wired headphones profile: Full HRTF 3D binaural audio active. Click to center orientation.';
      return;
    }

    let devName = this.deviceStatus?.deviceName;
    if (!devName) {
      devName = (this.deviceStatus?.deviceCategory === 'none') ? null : 'Audio Output';
    }

    if (this.trackingConnected) {
      dot.className = 'tracking-dot connected';
      text.textContent = `🎯 ${devName} (Sensor Active)`;
      const pps = this.tracker?.packetsPerSecond || 25;
      container.title = `Head-tracking motion sensor active (${pps}Hz). Click to recenter zero-point.`;
    } else {
      dot.className = 'tracking-dot inactive';
      if (this.deviceStatus?.deviceCategory === 'none') {
        dot.className = 'tracking-dot disconnected';
        text.textContent = '⚠️ No Headset • Pair in Bluetooth';
        container.title = 'No Bluetooth headset connected. Click for setup & troubleshooting.';
      } else {
        text.textContent = `⚠️ ${devName} (Sensor Inactive)`;
        container.title = 'No head-tracking data detected on UDP 4242. Click for setup & troubleshooting.';
      }
    }
  }

  _showStatus(msg) {
    document.getElementById('status-text').textContent = msg;
  }

  _formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ─── Queue Management & Looping ──────────────────────────────────────────

  async addFilesToQueue(fileList, autoPlay = true) {
    // Accept all files — FFmpeg on the server will extract audio from any container.
    // Browser will natively decode pure audio files; video containers go through FFmpeg.
    const files = Array.from(fileList).filter(f => f.size > 0);

    if (files.length === 0) {
      this._showStatus('No files to add');
      setTimeout(() => this._showStatus('Ready'), 2000);
      return;
    }

    const wasEmpty = this.queue.length === 0;

    files.forEach((file, idx) => {
      this.queue.push({
        id: `q_${Date.now()}_${idx}`,
        file,
        name: file.name,
        size: file.size
      });
    });

    this._renderQueue();
    this._showStatus(`Added ${files.length} track${files.length === 1 ? '' : 's'} to queue`);

    if (wasEmpty && autoPlay) {
      await this.playQueueIndex(0);
    } else {
      setTimeout(() => this._showStatus('Ready'), 2000);
    }
  }

  async playQueueIndex(index) {
    if (index < 0 || index >= this.queue.length) return;
    this.queueIndex = index;
    const item = this.queue[index];

    // Reset effect phase so trajectory begins with new song
    this.effectPhase = 0;
    this.tourCurrentSpeaker = 0;
    this.tourProgress = 0;
    this.tourHoverTimer = 0;

    await this.loadFile(item.file);
    this.engine.play();
    this._updatePlaybackUI(true);
    this._renderQueue();
  }

  playNext() {
    if (this.queue.length === 0) return;
    if (this.queueIndex < this.queue.length - 1) {
      this.playQueueIndex(this.queueIndex + 1);
    } else if (this.loopMode === 'all') {
      this.playQueueIndex(0);
    } else {
      this._showStatus('Reached end of queue');
      setTimeout(() => this._showStatus('Ready'), 1500);
    }
  }

  playPrev() {
    if (this.queue.length === 0) return;
    const curTime = this.engine.getCurrentTime ? this.engine.getCurrentTime() : 0;
    if (curTime > 3) {
      this.engine.seek(0);
      this._updateSeekBar(0);
      return;
    }
    if (this.queueIndex > 0) {
      this.playQueueIndex(this.queueIndex - 1);
    } else if (this.loopMode === 'all') {
      this.playQueueIndex(this.queue.length - 1);
    } else {
      this.engine.seek(0);
      this._updateSeekBar(0);
    }
  }

  removeFromQueue(index) {
    if (index < 0 || index >= this.queue.length) return;
    const isCurrent = index === this.queueIndex;
    this.queue.splice(index, 1);

    if (this.queue.length === 0) {
      this.queueIndex = -1;
      this.stop();
      this._renderQueue();
      return;
    }

    if (isCurrent) {
      if (this.queueIndex >= this.queue.length) {
        this.queueIndex = this.queue.length - 1;
      }
      this.playQueueIndex(this.queueIndex);
    } else if (index < this.queueIndex) {
      this.queueIndex--;
      this._renderQueue();
    } else {
      this._renderQueue();
    }
  }

  clearQueue() {
    this.queue = [];
    this.queueIndex = -1;
    this._renderQueue();
    this._showStatus('Queue cleared');
    setTimeout(() => this._showStatus('Ready'), 1500);
  }

  cycleLoopMode() {
    if (this.loopMode === 'none') {
      this.loopMode = 'single';
    } else if (this.loopMode === 'single') {
      this.loopMode = 'all';
    } else {
      this.loopMode = 'none';
    }

    this.engine.setLoopMode(this.loopMode);
    this._updateLoopUI();
    this._updateTransportButtons();

    const label = this.loopMode === 'single' ? 'Loop: Single Song (🔂)' :
                  this.loopMode === 'all' ? 'Loop: All Queue (🔁)' :
                  'Loop: Off';
    this._showStatus(label);
    setTimeout(() => this._showStatus('Ready'), 1500);
  }

  _updateLoopUI() {
    const btn = document.getElementById('btn-loop');
    const icon = document.getElementById('loop-icon');
    if (!btn) return;

    btn.classList.remove('loop-active', 'loop-single');
    if (this.loopMode === 'single') {
      btn.classList.add('loop-single');
      if (icon) icon.textContent = '🔂';
      btn.title = 'Loop Mode: Repeat Current Song (Click to loop queue)';
    } else if (this.loopMode === 'all') {
      btn.classList.add('loop-active');
      if (icon) icon.textContent = '🔁';
      btn.title = 'Loop Mode: Repeat Queue (Click to turn off)';
    } else {
      if (icon) icon.textContent = '🔁';
      btn.title = 'Loop Mode: Off (Click to loop current song)';
    }
  }

  _renderQueue() {
    const listEl = document.getElementById('queue-list');
    const badgeEl = document.getElementById('queue-badge');
    const countBadgeEl = document.getElementById('queue-count-badge');
    if (!listEl) return;

    if (badgeEl) {
      badgeEl.textContent = this.queue.length;
      badgeEl.classList.toggle('hidden', this.queue.length === 0);
    }
    if (countBadgeEl) {
      countBadgeEl.textContent = `${this.queue.length} track${this.queue.length === 1 ? '' : 's'}`;
    }

    if (this.queue.length === 0) {
      listEl.innerHTML = `<div class="queue-empty" style="font-size: 11px; color: var(--text-muted); text-align: center; padding: 12px 0;">
        Queue is empty. Load or drop multiple songs!
      </div>`;
      this._updateTransportButtons();
      return;
    }

    listEl.innerHTML = '';
    this.queue.forEach((item, index) => {
      const isCurrent = index === this.queueIndex;
      const row = document.createElement('div');
      row.className = `queue-item ${isCurrent ? 'active' : ''}`;
      row.title = `Click to play: ${item.file.name}`;
      
      const icon = isCurrent && this.engine.isPlaying ? '🔊' : isCurrent ? '▶' : `${index + 1}.`;
      
      row.innerHTML = `
        <span style="font-size: 11px; width: 18px; color: ${isCurrent ? 'var(--accent-primary)' : 'var(--text-muted)'}; font-weight: 600;">${icon}</span>
        <div class="queue-item-info">
          <span class="queue-item-title">${item.file.name}</span>
          <span class="queue-item-meta">${this._formatFileSize(item.file.size)}</span>
        </div>
        <button class="queue-item-del" title="Remove from queue">✕</button>
      `;

      row.addEventListener('click', (e) => {
        if (e.target.closest('.queue-item-del')) return;
        this.playQueueIndex(index);
      });

      const delBtn = row.querySelector('.queue-item-del');
      delBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeFromQueue(index);
      });

      listEl.appendChild(row);
    });

    this._updateTransportButtons();
  }

  _updateTransportButtons() {
    const prevBtn = document.getElementById('btn-prev');
    const nextBtn = document.getElementById('btn-next');
    if (prevBtn) {
      prevBtn.disabled = this.queue.length === 0;
    }
    if (nextBtn) {
      const canNext = (this.queueIndex < this.queue.length - 1) || (this.loopMode === 'all' && this.queue.length > 0);
      nextBtn.disabled = !canNext;
    }
  }

  _formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // ─── Spatial Effects & Auto-POV Controller ───────────────────────────────

  setEffect(effectName) {
    if (this.activeEffect === effectName) {
      this.stopEffect(true);
      return;
    }

    this.activeEffect = effectName;
    this.effectPhase = 0;
    this.tourCurrentSpeaker = 0;
    this.tourProgress = 0;
    this.tourHoverTimer = 0;

    document.querySelectorAll('.effect-btn, .quick-effect-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.effect === effectName);
    });

    const effectNames = {
      orbit: 'Floor Orbit',
      midorbit: 'Mid-Air Orbit',
      heightorbit: 'Height Orbit',
      height: 'Height Elevator',
      vortex: 'Cosmic Vortex',
      swing: 'Binaural Swing',
      infinity: 'Infinity Loop',
      wave: 'Serpentine Wave',
      tour: 'Speaker Tour'
    };
    const friendlyName = effectNames[effectName] || effectName;

    const hasHeight = (this.engine.layout && this.engine.layout.some(s => s.isHeight)) ||
                      (this.visualizer.speakers && this.visualizer.speakers.some(s => s.isHeight));

    let vizBadge = friendlyName;
    let statusMsg = `Auto-POV: ${friendlyName} (${this.effectPace.toFixed(1)}x)`;

    if ((effectName === 'height' || effectName === 'midorbit' || effectName === 'heightorbit') && !hasHeight) {
      statusMsg = `Auto-POV: ${friendlyName} (vertical listener motion over the active bed layout)`;
    } else if (hasHeight && (effectName === 'heightorbit' || effectName === 'midorbit' || effectName === 'height' || effectName === 'infinity' || effectName === 'tour' || effectName === 'wave' || effectName === 'vortex')) {
      const extra = effectName === 'heightorbit' ? 'Ceiling Atmos Plane' : (effectName === 'midorbit' ? 'Midway Base & Ceiling' : '3D Spatial Active');
      statusMsg = `Auto-POV: ${friendlyName} (${extra} · ${this.effectPace.toFixed(1)}x)`;
    }

    if (this.visualizer) {
      this.visualizer.setActiveEffect(vizBadge);
    }

    if (this.engine.audioBuffer && !this.engine.isPlaying) {
      this.engine.play();
      this._updatePlaybackUI(true);
    }

    this._showStatus(statusMsg);
  }

  stopEffect(resetCenter = true) {
    this.activeEffect = null;
    document.querySelectorAll('.effect-btn, .quick-effect-btn').forEach(btn => btn.classList.remove('active'));
    if (this.visualizer) {
      this.visualizer.setActiveEffect(null);
    }
    if (resetCenter) {
      this.visualizer.resetListenerPosition();
      this.engine.resetListenerPosition();
      this._updateHeightDisplay();
      this._showStatus('Auto-POV stopped · Centered');
    } else {
      this._showStatus('Auto-POV stopped');
    }
    setTimeout(() => this._showStatus('Ready'), 1500);
  }

  setEffectPace(pace) {
    this.effectPace = Math.max(0.2, Math.min(3.0, pace));
    const slider = document.getElementById('effect-pace-slider');
    const valDisplay = document.getElementById('effect-pace-val');
    if (slider) slider.value = this.effectPace;
    if (valDisplay) valDisplay.textContent = `${this.effectPace.toFixed(1)}x`;

    document.querySelectorAll('.pace-preset').forEach(btn => {
      btn.classList.toggle('active', Math.abs(parseFloat(btn.dataset.pace) - this.effectPace) < 0.05);
    });
  }

  toggleEffectDirection() {
    this.effectDirection = -this.effectDirection;
    const btn = document.getElementById('btn-effect-dir');
    if (btn) {
      btn.textContent = this.effectDirection > 0 ? '🔄 CW' : '🔃 CCW';
    }
    this._showStatus(`Effect Direction: ${this.effectDirection > 0 ? 'Clockwise' : 'Counter-Clockwise'}`);
    setTimeout(() => this._showStatus('Ready'), 1500);
  }

  // ─── Level Metering & Visualization ─────────────────────────────────────────

  _meterLoop() {
    const update = () => {
      if (this.engine.isPlaying) {
        this.visualizer.updateChannelLevels(this.engine.getChannelLevels());
        this.visualizer.updateAnalyserData(this.engine.getAnalyserData());
      }
      requestAnimationFrame(update);
    };
    update();
  }

  // ─── Advanced Channels Controls ──────────────────────────────────────────

  _renderAdvancedChannels(configs) {
    const list = document.getElementById('channel-strips-list');
    if (!list) return;

    if (!configs || configs.length === 0) {
      list.innerHTML = '<div class="channel-placeholder">Load an audio file to view & control individual channels.</div>';
      this._populateSoloSelect([]);
      this._updateSoloUI();
      return;
    }

    const isGlobalBoostOn = this.engine.gainBoostEnabled;
    const soloedList = this.engine.getSoloedChannels();
    const hasSolo = soloedList.length > 0;
    const layout = this.engine.layout || [];

    this._populateSoloSelect(configs);

    list.innerHTML = configs.map((cfg, i) => {
      const sp = layout[i] || {};
      const azText = sp.azimuth !== undefined ? `${sp.azimuth > 0 ? '+' : ''}${sp.azimuth}°` : '';
      const elText = sp.elevation ? `, ${sp.elevation > 0 ? '+' : ''}${sp.elevation}°` : '';
      const posTag = (azText || elText) ? `<span class="channel-pos-tag">${azText}${elText}</span>` : '';
      const isSoloActive = this.engine.isChannelSoloed(i);
      const isMutedBySolo = (hasSolo && !isSoloActive);

      return `
      <div class="channel-strip ${!cfg.enabled ? 'disabled' : ''} ${isSoloActive ? 'solo-active' : ''} ${isMutedBySolo ? 'muted-by-solo' : ''}" id="channel-strip-${i}">
        <div class="channel-strip-header">
          <div class="channel-strip-name">
            <span class="channel-badge">${i + 1}</span>
            <strong>${cfg.name}</strong>
            ${posTag}
          </div>
          <div class="channel-strip-actions">
            <button class="btn-solo ${isSoloActive ? 'active' : ''}" data-channel="${i}" title="Toggle solo on this speaker (allows multiple solo channels)">
              ${isSoloActive ? '🎯 Solo Active' : '🎯 Solo'}
            </button>
            <label class="toggle-switch small" title="Toggle Channel">
              <input type="checkbox" class="channel-toggle" data-channel="${i}" ${cfg.enabled ? 'checked' : ''}>
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

        <div class="channel-controls-row">
          <!-- Volume Slider -->
          <div class="channel-control-col">
            <div class="channel-control-label">
              <span>Volume</span>
              <span class="channel-vol-val" id="chan-vol-val-${i}">${Math.round((cfg.volume ?? 1) * 100)}%</span>
            </div>
            <input type="range" class="channel-vol-slider" data-channel="${i}" min="0" max="1" step="0.01" value="${cfg.volume ?? 1}">
          </div>

          <!-- Gain Slider (-12 to +12 dB) -->
          <div class="channel-control-col">
            <div class="channel-control-label">
              <span>Gain</span>
              <span class="channel-gain-val" id="chan-gain-val-${i}">${isGlobalBoostOn ? 'Locked' : `${(cfg.gainDb ?? 0) > 0 ? '+' : ''}${(cfg.gainDb ?? 0).toFixed(1)} dB`}</span>
            </div>
            <input type="range" class="channel-gain-slider" data-channel="${i}" min="-12" max="12" step="0.5" value="${cfg.gainDb ?? 0}" ${isGlobalBoostOn ? 'disabled' : ''}>
          </div>
        </div>
      </div>
      `;
    }).join('');

    // Attach listeners
    list.querySelectorAll('.btn-solo').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.channel, 10);
        this.toggleSoloChannel(idx);
      });
    });

    list.querySelectorAll('.channel-toggle').forEach(el => {
      el.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.channel, 10);
        const enabled = e.target.checked;
        this.engine.setChannelEnabled(idx, enabled);
        document.getElementById(`channel-strip-${idx}`)?.classList.toggle('disabled', !enabled);
        if (this.engine.hasActiveSolo()) {
          if (!enabled && this.engine.isChannelSoloed(idx)) {
            this.toggleSoloChannel(idx);
          }
        }
      });
    });

    list.querySelectorAll('.channel-vol-slider').forEach(el => {
      el.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.channel, 10);
        const val = parseFloat(e.target.value);
        this.engine.setChannelVolume(idx, val);
        const label = document.getElementById(`chan-vol-val-${idx}`);
        if (label) label.textContent = `${Math.round(val * 100)}%`;
      });
    });

    list.querySelectorAll('.channel-gain-slider').forEach(el => {
      el.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.channel, 10);
        const val = parseFloat(e.target.value);
        this.engine.setChannelGain(idx, val);
        const label = document.getElementById(`chan-gain-val-${idx}`);
        if (label) {
          const sign = val > 0 ? '+' : '';
          label.textContent = `${sign}${val.toFixed(1)} dB`;
        }
      });
    });

    this._updateSoloUI();
    this._updateGainBoostMutex(isGlobalBoostOn);
  }

  _populateSoloSelect(configs) {
    const select = document.getElementById('solo-speaker-select');
    if (!select) return;
    let html = '<option value="-1">🔊 All Speakers (Full Mix)</option>';
    if (configs && configs.length > 0) {
      const layout = this.engine.layout || [];
      configs.forEach((cfg, i) => {
        const sp = layout[i] || {};
        const azStr = sp.azimuth !== undefined ? ` [${sp.azimuth > 0 ? '+' : ''}${sp.azimuth}°${sp.elevation ? `, ${sp.elevation > 0 ? '+' : ''}${sp.elevation}°` : ''}]` : '';
        html += `<option value="${i}">[${i + 1}] ${cfg.name}${azStr}</option>`;
      });
    }
    select.innerHTML = html;
  }

  toggleSoloChannel(channelIndex) {
    const soloed = this.engine.toggleSoloChannel(channelIndex);
    this.visualizer.setSoloedChannels(soloed);
    this._updateSoloUI();

    if (soloed.length > 0) {
      const layout = this.engine.layout || [];
      const names = soloed.map(idx => layout[idx]?.shortName || layout[idx]?.name || `Ch ${idx + 1}`).join(', ');
      this._showStatus(`🎯 Soloing (${soloed.length}): ${names}`);
    } else {
      this._showStatus('🔊 All speakers enabled (Full Mix)');
    }
  }

  soloChannel(channelIndex) {
    return this.toggleSoloChannel(channelIndex);
  }

  setSoloLayer(layerType) {
    const layout = this.engine.layout || [];
    let targets = [];
    if (layerType === 'bed') {
      targets = layout.map((sp, i) => (!sp.isHeight ? i : -1)).filter(i => i >= 0);
    } else if (layerType === 'height') {
      targets = layout.map((sp, i) => (sp.isHeight ? i : -1)).filter(i => i >= 0);
    } else if (layerType === 'surround') {
      targets = layout.map((sp, i) => (Math.abs(sp.azimuth || 0) >= 60 && !sp.isHeight ? i : -1)).filter(i => i >= 0);
    }

    if (targets.length === 0) {
      this._showStatus(`No ${layerType} speakers in current layout`);
      return;
    }

    // Toggle: if currently soloed equals this target set, unsolo all
    const currentSolos = this.engine.getSoloedChannels();
    const isSame = (currentSolos.length === targets.length && targets.every(t => currentSolos.includes(t)));
    if (isSame) {
      this.unsoloAll();
      return;
    }

    const soloed = this.engine.setSoloChannels(targets);
    this.visualizer.setSoloedChannels(soloed);
    this._updateSoloUI();
    const layerNames = { bed: 'Bed Layer (Ear-level)', height: 'Height Layer (Overhead)', surround: 'Surround Speakers' };
    this._showStatus(`🎯 Soloing ${layerNames[layerType] || layerType} (${soloed.length} speakers)`);
  }

  unsoloAll() {
    this.stopAutoCycleSpeakers();
    this.engine.unsoloAll();
    this.visualizer.setSoloedChannels([]);
    this._updateSoloUI();
    this._showStatus('🔊 All speakers enabled (Full Mix)');
  }

  _updateSoloUI() {
    const soloed = this.engine.getSoloedChannels();
    const hasSolo = soloed.length > 0;

    const select = document.getElementById('solo-speaker-select');
    if (select) {
      select.value = (soloed.length === 1) ? soloed[0] : -1;
    }

    const badge = document.getElementById('solo-count-badge');
    if (badge) {
      if (hasSolo) {
        badge.textContent = `🎯 ${soloed.length} Soloed`;
        badge.classList.add('active');
      } else {
        badge.textContent = '🔊 Full Mix';
        badge.classList.remove('active');
      }
    }

    // Update preset buttons active state
    const layout = this.engine.layout || [];
    const bedIndices = layout.map((sp, i) => (!sp.isHeight ? i : -1)).filter(i => i >= 0);
    const heightIndices = layout.map((sp, i) => (sp.isHeight ? i : -1)).filter(i => i >= 0);
    const surroundIndices = layout.map((sp, i) => (Math.abs(sp.azimuth || 0) >= 60 && !sp.isHeight ? i : -1)).filter(i => i >= 0);

    const isBed = (hasSolo && soloed.length === bedIndices.length && bedIndices.every(t => soloed.includes(t)));
    const isHeight = (hasSolo && soloed.length === heightIndices.length && heightIndices.every(t => soloed.includes(t)));
    const isSurround = (hasSolo && soloed.length === surroundIndices.length && surroundIndices.every(t => soloed.includes(t)));

    document.getElementById('btn-solo-bed')?.classList.toggle('active', isBed);
    document.getElementById('btn-solo-height')?.classList.toggle('active', isHeight);
    document.getElementById('btn-solo-surround')?.classList.toggle('active', isSurround);

    const configs = this.engine.getChannelConfigs();
    configs.forEach((cfg, i) => {
      const strip = document.getElementById(`channel-strip-${i}`);
      const btn = strip?.querySelector('.btn-solo');
      const toggle = strip?.querySelector('.channel-toggle');

      if (!strip) return;

      const isSolo = this.engine.isChannelSoloed(i);
      const isMuted = (hasSolo && !isSolo);

      strip.classList.toggle('solo-active', isSolo);
      strip.classList.toggle('muted-by-solo', isMuted);
      strip.classList.toggle('disabled', !cfg.enabled);

      if (btn) {
        btn.classList.toggle('active', isSolo);
        btn.innerHTML = isSolo ? '🎯 Solo Active' : '🎯 Solo';
      }

      if (toggle) {
        toggle.checked = cfg.enabled;
      }
    });
  }

  startAutoCycleSpeakers() {
    if (this.autoCycleInterval) {
      this.stopAutoCycleSpeakers();
      return;
    }
    const layout = this.engine.layout;
    if (!layout || layout.length === 0) {
      this._showStatus('Load an audio file first to cycle speakers');
      return;
    }

    this.autoCycleIndex = 0;
    const cycleBtn = document.getElementById('btn-auto-cycle-speakers');
    const cycleText = document.getElementById('cycle-btn-text');
    if (cycleBtn) cycleBtn.classList.add('active');

    const step = () => {
      if (this.autoCycleIndex >= layout.length) {
        this.autoCycleIndex = 0;
      }
      const idx = this.autoCycleIndex;
      const sp = layout[idx];
      this.soloChannel(idx);
      if (cycleText) {
        cycleText.textContent = `Cycling: ${sp.shortName || sp.name}`;
      }
      this.autoCycleIndex++;
    };

    step();
    this.autoCycleInterval = setInterval(step, 2500);
  }

  stopAutoCycleSpeakers() {
    if (this.autoCycleInterval) {
      clearInterval(this.autoCycleInterval);
      this.autoCycleInterval = null;
    }
    const cycleBtn = document.getElementById('btn-auto-cycle-speakers');
    const cycleText = document.getElementById('cycle-btn-text');
    if (cycleBtn) cycleBtn.classList.remove('active');
    if (cycleText) cycleText.textContent = 'Auto-Cycle Speakers';
  }

  toggleTestTone() {
    const btn = document.getElementById('btn-toggle-test-tone');
    const text = document.getElementById('test-tone-text');
    if (this.engine._testToneActive) {
      this.engine.stopTestTone();
      if (btn) btn.classList.remove('active');
      if (text) text.textContent = 'Test Tone';
      this._showStatus('Test tone stopped');
    } else {
      this.engine.init().then(() => {
        const soloIdx = (this.engine.soloedChannel !== null && this.engine.soloedChannel !== undefined && this.engine.soloedChannel >= 0) ? this.engine.soloedChannel : 0;
        this.engine.playTestTone(soloIdx);
        if (btn) btn.classList.add('active');
        if (text) text.textContent = 'Stop Tone';
        const sp = this.engine.layout ? this.engine.layout[soloIdx] : null;
        this._showStatus(`🔔 Playing spatial calibration tone on ${sp ? sp.name : 'speaker'}`);
      });
    }
  }

  _updateGainBoostMutex(globalBoostActive) {
    const badge = document.getElementById('gain-mutex-badge');
    if (badge) {
      badge.classList.toggle('hidden', !globalBoostActive);
    }

    const sliders = document.querySelectorAll('.channel-gain-slider');
    sliders.forEach(slider => {
      slider.disabled = globalBoostActive;
      const idx = slider.dataset.channel;
      const label = document.getElementById(`chan-gain-val-${idx}`);
      if (label) {
        if (globalBoostActive) {
          label.textContent = 'Locked';
        } else {
          const cfg = this.engine.channelConfigs[idx];
          const val = cfg?.gainDb ?? 0;
          const sign = val > 0 ? '+' : '';
          label.textContent = `${sign}${val.toFixed(1)} dB`;
        }
      }
    });
  }

  // ─── Event Binding ─────────────────────────────────────────────────────────

  _bindEvents() {
    document.getElementById('scene-select')?.addEventListener('change', (event) => {
      const scene = this.visualizer.setScene(event.currentTarget.value);
      localStorage.setItem('spatial_scene', this.visualizer.scene);
      this._syncSceneSpeakerPositions();
      this._updateSceneHeading(scene);
    });

    const povModeToggle = document.getElementById('pov-mode-toggle');
    const povModeContent = document.getElementById('pov-mode-content');
    const povModeIcon = document.getElementById('pov-mode-toggle-icon');
    const togglePovModeContent = () => {
      const expanded = povModeToggle.getAttribute('aria-expanded') !== 'true';
      povModeToggle.setAttribute('aria-expanded', String(expanded));
      povModeToggle.classList.toggle('collapsed', !expanded);
      povModeContent?.classList.toggle('hidden', !expanded);
      if (povModeIcon) povModeIcon.style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
    };
    povModeToggle?.addEventListener('click', togglePovModeContent);
    povModeToggle?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        togglePovModeContent();
      }
    });
    document.getElementById('btn-scene-pov-toggle')?.addEventListener('click', () => {
      this._setScenePovMode(!this.visualizer.walkableSceneMode);
    });
    document.getElementById('btn-scene-pov-exit')?.addEventListener('click', () => {
      this._setScenePovMode(false);
    });

    // File input (supports multiple files for queue)
    const fileInput = document.getElementById('file-input');
    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        this.addFilesToQueue(e.target.files);
        fileInput.value = '';
      }

    });

    // Drop zone
    const dropZone = document.getElementById('drop-zone');
    const body = document.body;
    
    ['dragenter', 'dragover'].forEach(evt => {
      body.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone?.classList.add('drag-over');
      });
    });
    
    ['dragleave', 'drop'].forEach(evt => {
      body.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone?.classList.remove('drag-over');
      });
    });
    
    body.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone?.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        this.addFilesToQueue(e.dataTransfer.files);
      }
    });

    // Click anywhere on drop zone to browse files
    dropZone?.addEventListener('click', () => {
      fileInput.click();
    });

    // Browse button inside drop zone
    document.getElementById('btn-browse')?.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });

    // Load/Add new file button in player panel
    document.getElementById('btn-load-new')?.addEventListener('click', () => {
      fileInput.click();
    });

    // Transport & Playback controls
    document.getElementById('btn-prev')?.addEventListener('click', () => this.playPrev());
    document.getElementById('btn-play')?.addEventListener('click', () => this.togglePlay());
    document.getElementById('btn-stop')?.addEventListener('click', () => this.stop());
    document.getElementById('btn-next')?.addEventListener('click', () => this.playNext());
    document.getElementById('btn-loop')?.addEventListener('click', () => this.cycleLoopMode());

    // Queue drawer toggle & buttons
    const queueToggleBtn = document.getElementById('btn-queue-toggle');
    const queuePanel = document.getElementById('queue-panel');
    queueToggleBtn?.addEventListener('click', () => {
      this.queueOpen = !this.queueOpen;
      if (queuePanel) {
        queuePanel.classList.toggle('hidden', !this.queueOpen);
      }
      queueToggleBtn.classList.toggle('active', this.queueOpen);
    });

    document.getElementById('btn-queue-add')?.addEventListener('click', () => {
      fileInput.click();
    });
    document.getElementById('btn-queue-clear')?.addEventListener('click', () => {
      this.clearQueue();
    });

    // Spatial Effects Accordion Toggle
    const effToggle = document.getElementById('effects-toggle');
    const effIcon = document.getElementById('effects-toggle-icon');
    const effContent = document.getElementById('effects-content');
    const toggleEffects = () => {
      effToggle.classList.toggle('collapsed');
      const expanded = !effToggle.classList.contains('collapsed');
      effToggle.setAttribute('aria-expanded', String(expanded));
      if (effContent) effContent.classList.toggle('hidden', !expanded);
      if (effIcon) {
        effIcon.style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
      }
    };
    effToggle?.addEventListener('click', toggleEffects);
    effToggle?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleEffects();
      }
    });

    // Preset Effect Buttons
    ['orbit', 'midorbit', 'heightorbit', 'height', 'vortex', 'swing', 'infinity', 'wave', 'tour'].forEach(name => {
      document.getElementById(`btn-effect-${name}`)?.addEventListener('click', () => {
        this.setEffect(name);
      });
    });

    // Quick Spatial Effect buttons on Player Panel (Phase 3)
    document.querySelectorAll('.quick-effect-btn[data-effect]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.setEffect(btn.dataset.effect);
      });
    });
    document.getElementById('btn-quick-effect-stop')?.addEventListener('click', () => {
      this.stopEffect(true);
    });

    // Stop Effect Button
    document.getElementById('btn-effect-stop')?.addEventListener('click', () => {
      this.stopEffect(true);
    });

    // Ambient Micro-Sway Anti-Fatigue (Phase 3)
    const microSwayToggle = document.getElementById('micro-sway-toggle');
    const microSwaySlider = document.getElementById('micro-sway-slider');
    const microSwaySliderVal = document.getElementById('micro-sway-intensity-val');
    microSwayToggle?.addEventListener('change', (e) => {
      this.setAmbientSway(e.target.checked, this.ambientSwayIntensity);
    });
    microSwaySlider?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      this.ambientSwayIntensity = val / 100;
      if (microSwaySliderVal) microSwaySliderVal.textContent = `${val}%`;
    });

    // Effect Pace Slider
    const paceSlider = document.getElementById('effect-pace-slider');
    paceSlider?.addEventListener('input', (e) => {
      this.setEffectPace(parseFloat(e.target.value));
    });

    // Pace Presets (0.5x, 1.0x, 2.0x)
    document.querySelectorAll('.pace-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const pace = parseFloat(btn.dataset.pace);
        this.setEffectPace(pace);
      });
    });

    // Effect Direction Toggle (CW / CCW)
    document.getElementById('btn-effect-dir')?.addEventListener('click', () => {
      this.toggleEffectDirection();
    });
    
    // Seek bar
    const seekBar = document.getElementById('seek-bar');
    seekBar.addEventListener('input', (e) => {
      this.seek(e.target.value / 1000);
    });

    // Volume
    const volumeSlider = document.getElementById('volume-slider');
    volumeSlider.addEventListener('input', (e) => {
      this.setVolume(parseFloat(e.target.value));
    });

    // Smoothing
    const smoothingSlider = document.getElementById('smoothing-slider');
    smoothingSlider.addEventListener('input', (e) => {
      this.setSmoothing(parseFloat(e.target.value));
    });

    // Recenter
    document.getElementById('btn-recenter').addEventListener('click', () => this.recenter());

    // Reset Listener Position (Arrow & Height)
    document.getElementById('btn-reset-pos')?.addEventListener('click', () => {
      this.visualizer.resetListenerPosition();
      this.engine.resetListenerPosition();
      this._updateHeightDisplay();
      this._showStatus('Listener position & height centered');
      setTimeout(() => this._showStatus('Ready'), 1500);
    });

    // Channel Layout Dropdown
    const layoutSelect = document.getElementById('channel-layout-select');
    const layoutBadge = document.getElementById('layout-badge');
    const statusLayout = document.getElementById('status-layout');

    if (layoutSelect) {
      layoutSelect.value = this.targetLayout;
      if (layoutBadge) {
        layoutBadge.textContent = this.targetLayout === 'auto' ? 'Auto (Native)' : `${this.targetLayout} (${this._getLayoutChannelCount(this.targetLayout)}ch)`;
      }
      if (statusLayout) {
        statusLayout.textContent = layoutSelect.options[layoutSelect.selectedIndex]?.text || this.targetLayout;
      }

      layoutSelect.addEventListener('change', async (e) => {
        const newLayout = e.target.value;
        this.targetLayout = newLayout;
        localStorage.setItem('spatial_target_layout', newLayout);
        this.engine.setTargetLayout(newLayout);

        if (layoutBadge) {
          layoutBadge.textContent = newLayout === 'auto' ? 'Auto (Native)' : `${newLayout} (${this._getLayoutChannelCount(newLayout)}ch)`;
        }
        if (statusLayout) {
          statusLayout.textContent = layoutSelect.options[layoutSelect.selectedIndex]?.text || newLayout;
        }

        // If an audio file is currently loaded, re-decode it with the selected layout!
        if (this.currentFile) {
          this._showStatus(`Switching layout to ${newLayout}...`);
          await this.loadFile(this.currentFile);
        } else {
          this._showStatus(`Playback layout set to ${newLayout}`);
          setTimeout(() => this._showStatus('Ready'), 1500);
        }
      });

      // Auto / Reset Channel Layout Button
      document.getElementById('btn-reset-layout')?.addEventListener('click', async () => {
        const defaultLayout = 'auto';
        if (this.targetLayout === defaultLayout) {
          this._showStatus('Already in Auto (Native) mode');
          setTimeout(() => this._showStatus('Ready'), 1500);
          return;
        }
        this.targetLayout = defaultLayout;
        layoutSelect.value = defaultLayout;
        localStorage.setItem('spatial_target_layout', defaultLayout);
        this.engine.setTargetLayout(defaultLayout);

        if (layoutBadge) {
          layoutBadge.textContent = 'Auto (Native)';
        }
        if (statusLayout) {
          statusLayout.textContent = 'Auto (Native File Channels)';
        }

        if (this.currentFile) {
          this._showStatus('Resetting to native multichannel audio...');
          await this.loadFile(this.currentFile);
        } else {
          this._showStatus('Layout reset to Auto (Native Channels)');
          setTimeout(() => this._showStatus('Ready'), 1500);
        }
      });

      // Top Speaker Height Slider
      const topHeightSlider = document.getElementById('top-speaker-height-slider');
      const topHeightVal = document.getElementById('top-speaker-height-val');
      topHeightSlider?.addEventListener('input', (e) => {
        const pct = parseInt(e.target.value, 10);
        const scale = pct / 100.0;
        if (topHeightVal) topHeightVal.textContent = `${pct}%`;
        this.engine.setTopSpeakerHeightScale(scale);
        this.visualizer.setTopSpeakerHeightScale(scale);
        this._syncSceneSpeakerPositions();
      });
    }

    // Theme toggle
    document.getElementById('theme-toggle')?.addEventListener('click', () => {
      const nextTheme = this.theme === 'dark' ? 'light' : 'dark';
      this.setTheme(nextTheme);
    });

    // Surround Gain Boost toggle
    const gainBoostToggle = document.getElementById('gain-boost-toggle');
    gainBoostToggle?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      this.engine.setGainBoost(enabled, 6);
      this._updateGainBoostMutex(enabled);
      this._showStatus(enabled ? 'Surround gain boost active (+6 dB)' : 'Gain boost disabled');
      setTimeout(() => this._showStatus('Ready'), 2000);
    });

    // Advanced Channels Accordion Toggle
    const advToggle = document.getElementById('advanced-toggle');
    const advIcon = document.getElementById('advanced-toggle-icon');
    const toggleAdvanced = () => {
      advToggle.classList.toggle('collapsed');
      const expanded = !advToggle.classList.contains('collapsed');
      advToggle.setAttribute('aria-expanded', String(expanded));
      if (advIcon) {
        advIcon.style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
      }
    };
    advToggle?.addEventListener('click', toggleAdvanced);
    advToggle?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggleAdvanced();
      }
    });

    // Reset all channels button (Mix reset)
    document.getElementById('btn-reset-channels')?.addEventListener('click', () => {
      this.unsoloAll();
      this.engine.resetAllChannels();
      this._renderAdvancedChannels(this.engine.getChannelConfigs());
      this._showStatus('All channel levels & mix reset to default');
      setTimeout(() => this._showStatus('Ready'), 1500);
    });

    // Solo Speaker Selector (Axis Calibration)
    document.getElementById('solo-speaker-select')?.addEventListener('change', (e) => {
      const idx = parseInt(e.target.value, 10);
      if (idx === -1) {
        this.unsoloAll();
      } else {
        this.toggleSoloChannel(idx);
      }
    });

    // Layer Preset Solo Buttons (Bed, Height, Surrounds)
    document.getElementById('btn-solo-bed')?.addEventListener('click', () => {
      this.setSoloLayer('bed');
    });
    document.getElementById('btn-solo-height')?.addEventListener('click', () => {
      this.setSoloLayer('height');
    });
    document.getElementById('btn-solo-surround')?.addEventListener('click', () => {
      this.setSoloLayer('surround');
    });

    // Unsolo All Button
    document.getElementById('btn-unsolo-all')?.addEventListener('click', () => {
      this.unsoloAll();
    });

    // Auto-Cycle Speakers Button (Hands-free Axis Calibration)
    document.getElementById('btn-auto-cycle-speakers')?.addEventListener('click', () => {
      if (this.autoCycleInterval) {
        this.stopAutoCycleSpeakers();
        this.unsoloAll();
      } else {
        this.startAutoCycleSpeakers();
      }
    });

    // Test Tone / Spatial Ping Button
    document.getElementById('btn-toggle-test-tone')?.addEventListener('click', () => {
      this.toggleTestTone();
    });

    // Route Track Audio to Solo Toggle
    document.getElementById('solo-route-toggle')?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      this.engine.setSoloRouteAll(enabled);
      this._showStatus(enabled ? 'Route Track Audio to Solo: Enabled' : 'Route Track Audio to Solo: Disabled (Original Channel Only)');
      setTimeout(() => this._showStatus('Ready'), 1800);
    });

    // ── Credits & Open Source Collapsible Header Toggle ───
    const creditsCollapseToggle = document.getElementById('credits-collapse-toggle');
    const creditsCollapseIcon = document.getElementById('credits-collapse-icon');
    const creditsCollapseContent = document.getElementById('credits-collapse-content');
    creditsCollapseToggle?.addEventListener('click', () => {
      const isHidden = creditsCollapseContent?.classList.toggle('hidden');
      if (creditsCollapseIcon) {
        creditsCollapseIcon.style.transform = isHidden ? 'rotate(-90deg)' : 'rotate(0deg)';
      }
    });

    // ── Custom Decoders Collapsible Header Toggle ───
    const decodersCollapseToggle = document.getElementById('custom-decoders-collapse-toggle');
    const decodersCollapseIcon = document.getElementById('custom-decoders-collapse-icon');
    const decodersCollapseContent = document.getElementById('custom-decoders-collapse-content');
    decodersCollapseToggle?.addEventListener('click', () => {
      const isHidden = decodersCollapseContent?.classList.toggle('hidden');
      if (decodersCollapseIcon) {
        decodersCollapseIcon.style.transform = isHidden ? 'rotate(-90deg)' : 'rotate(0deg)';
      }
    });

    // ── Master Custom Decoders Toggle (Hidden & disabled by default) ───
    document.getElementById('toggle-custom-decoders')?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      this.engine.setCustomDecodersMaster(enabled);
      this._updateMasterCustomDecodersUI();
      this._showStatus(`Custom Decoders: ${enabled ? 'Enabled' : 'Disabled'}`);
      setTimeout(() => this._showStatus('Ready'), 1500);
    });

    // ── Modal Actions: Spatial Layout & Dolby AC-4 Guide Modal ───
    document.getElementById('btn-footer-help')?.addEventListener('click', () => {
      this._showSpatialHelpModal();
    });

    document.getElementById('modal-close-help')?.addEventListener('click', () => {
      this._hideModals();
    });

    document.getElementById('btn-modal-help-close')?.addEventListener('click', () => {
      this._hideModals();
    });

    // ── ffcodec64 Plugin Toggle ───
    document.getElementById('toggle-engine-ffcodec')?.addEventListener('change', (e) => {
      this.engine.setDecoderEngineToggle('ffcodec', e.target.checked);
      this._updateDecoderEngineBadges();
      this._showStatus(`ffcodec64: ${e.target.checked ? 'Enabled' : 'Disabled'}`);
      setTimeout(() => this._showStatus('Ready'), 1500);
    });

    // ── View Supported Formats Button ───
    document.getElementById('btn-view-supported-formats')?.addEventListener('click', () => {
      this._showSupportedFormatsModal();
    });

    // ── Modal Actions: ffcodec64 Prompt ───
    document.getElementById('modal-close-ffcodec')?.addEventListener('click', () => {
      this._hideModals();
    });

    document.getElementById('btn-modal-ffcodec-cancel')?.addEventListener('click', () => {
      const pendingName = this._pendingFFCodecFile?.name || '';
      this._showSupportedFormatsModal(pendingName);
    });

    document.getElementById('btn-modal-ffcodec-formats')?.addEventListener('click', () => {
      const pendingName = this._pendingFFCodecFile?.name || '';
      this._showSupportedFormatsModal(pendingName);
    });

    document.getElementById('btn-modal-ffcodec-enable')?.addEventListener('click', () => {
      this._enableFFCodecAndPlayPending();
    });

    // ── Modal Actions: Supported Formats Dialog ───
    document.getElementById('modal-close-formats')?.addEventListener('click', () => {
      this._hideModals();
    });

    document.getElementById('btn-modal-formats-close')?.addEventListener('click', () => {
      this._hideModals();
    });

    document.getElementById('btn-modal-formats-enable-ffcodec')?.addEventListener('click', () => {
      this._enableFFCodecAndPlayPending();
    });

    // ── Modal Actions: Sensor Setup & Troubleshooting ───
    document.getElementById('modal-close-sensor-help')?.addEventListener('click', () => {
      this._hideModals();
    });

    document.getElementById('btn-modal-sensor-close')?.addEventListener('click', () => {
      this._hideModals();
    });

    document.getElementById('btn-modal-open-bluetooth')?.addEventListener('click', () => {
      if (window.desktopAPI?.openBluetoothSettings) {
        window.desktopAPI.openBluetoothSettings();
      } else {
        this._showStatus('Open Windows Settings → Bluetooth & Devices to pair your headphones');
      }
    });



    // Click outside modal dialog to close
    document.getElementById('app-modal-overlay')?.addEventListener('click', (e) => {
      if (e.target.id === 'app-modal-overlay') {
        this._hideModals();
      }
    });

    // ─── Fraunhofer MPEG-H VV Live Audio Stream Integration ─────────────────
    const mpeghFeatureToggle = document.getElementById('toggle-mpegh-feature');
    const mpeghBadge = document.getElementById('badge-mpegh-toggle');
    const mpeghContent = document.getElementById('mpegh-content-container');

    const updateMpeghFeatureUI = (enabled) => {
      if (mpeghFeatureToggle) mpeghFeatureToggle.checked = enabled;
      if (mpeghContent) mpeghContent.classList.toggle('hidden', !enabled);
      if (mpeghBadge) {
        mpeghBadge.textContent = enabled ? '🟢 On' : 'Off';
        mpeghBadge.style.background = enabled ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-card-hover)';
        mpeghBadge.style.color = enabled ? 'var(--accent-success, #10b981)' : 'var(--text-muted)';
        mpeghBadge.style.borderColor = enabled ? 'rgba(16, 185, 129, 0.3)' : 'var(--border-subtle)';
      }
    };

    // Load persisted state (default: false / off)
    const savedMpeghState = localStorage.getItem('spatial_mpegh_feature_enabled') === 'true';
    updateMpeghFeatureUI(savedMpeghState);

    mpeghFeatureToggle?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      localStorage.setItem('spatial_mpegh_feature_enabled', enabled ? 'true' : 'false');
      updateMpeghFeatureUI(enabled);
      if (!enabled && this.engine.isLiveStream) {
        this.engine.disconnectLiveStream();
        const streamingBar = document.getElementById('mpegh-vv-streaming-bar');
        if (streamingBar) streamingBar.style.display = 'none';
        this._updatePlayButton(false);
      }
      this._showStatus(`MPEG-H VV Live Stream: ${enabled ? 'Enabled' : 'Disabled'}`);
      setTimeout(() => this._showStatus('Ready'), 1500);
    });

    const checkMpeghStatus = async () => {
      const badge = document.getElementById('mpegh-vv-status-badge');
      if (!badge) return;
      if (window.desktopAPI?.getMpeghStatus) {
        const stat = await window.desktopAPI.getMpeghStatus();
        if (stat.isInstalled) {
          badge.textContent = stat.isRunning ? '🟢 Running' : '🟢 Ready';
          badge.style.color = 'var(--accent-success)';
        } else {
          badge.textContent = '⚪ Not Found';
          badge.style.color = 'var(--text-muted)';
        }
      } else {
        badge.textContent = 'Desktop Ready';
      }
    };
    checkMpeghStatus();
    setInterval(checkMpeghStatus, 5000);

    document.getElementById('btn-launch-mpegh-vv')?.addEventListener('click', async () => {
      this._showStatus('Launching Fraunhofer MPEG-H VVPlayer...');
      if (window.desktopAPI?.openMpeghVv) {
        const res = await window.desktopAPI.openMpeghVv(this.currentFile?.path || null);
        if (res.success) {
          this._showStatus('🚀 Fraunhofer MPEG-H VVPlayer launched');
        } else {
          this._showStatus(`⚠️ ${res.error || 'Failed to launch'}`);
        }
      } else {
        try {
          const res = await fetch('/api/open-mpegh-vv', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filePath: this.currentFile?.path || null })
          });
          const data = await res.json();
          if (res.ok) this._showStatus('🚀 MPEG-H VVPlayer launched');
          else this._showStatus(`⚠️ ${data.error || 'Failed to launch'}`);
        } catch (e) {
          this._showStatus(`⚠️ ${e.message}`);
        }
      }
      setTimeout(() => this._showStatus('Ready'), 2500);
    });

    document.getElementById('btn-hook-mpegh-audio')?.addEventListener('click', async () => {
      const streamingBar = document.getElementById('mpegh-vv-streaming-bar');
      try {
        this._showStatus('Hooking audio stream from MPEG-H VVPlayer...');
        
        // In desktop mode, setDisplayMediaRequestHandler provides screen loopback with audio automatically
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: true,
          audio: true
        });
        
        if (stream && stream.getAudioTracks().length > 0) {
          stream.getVideoTracks().forEach(t => t.stop());
          
          // Connect stream into AudioEngine
          await this.engine.connectLiveMediaStream(stream, 'stereo');
          this.visualizer.setSpeakers(this.engine.layout);
          this._syncSceneSpeakerPositions();
          this._renderAdvancedChannels(this.engine.getChannelConfigs());
          
          if (streamingBar) streamingBar.style.display = 'flex';
          this._updatePlayButton(true);
          this._showStatus('🟢 Streaming Live Audio from MPEG-H VVPlayer (Head-Tracked)');
          
          stream.getAudioTracks()[0].onended = () => {
            this.engine.disconnectLiveStream();
            if (streamingBar) streamingBar.style.display = 'none';
            this._updatePlayButton(false);
            this._showStatus('MPEG-H VV Live stream ended');
            setTimeout(() => this._showStatus('Ready'), 2000);
          };
        } else {
          this._showStatus('⚠️ No audio track found in captured stream. Ensure system/window audio sharing was checked!');
          setTimeout(() => this._showStatus('Ready'), 3000);
        }
      } catch (err) {
        console.error('[App] Audio hook failed:', err);
        this._showStatus(`⚠️ Audio hook cancelled or failed: ${err.message}`);
        setTimeout(() => this._showStatus('Ready'), 3000);
      }
    });

    document.getElementById('btn-toggle-mpegh-mute')?.addEventListener('click', (e) => {
      const isMuted = !this.engine.liveMonitorMuted;
      this.engine.setLiveMonitorMuted(isMuted);
      e.target.textContent = isMuted ? '🔊 Unmute Output (Echo)' : '🔇 Mute Output (No Echo)';
      this._showStatus(isMuted ? 'Live loopback monitor muted (Visualizer only)' : 'Live loopback monitor unmuted');
      setTimeout(() => this._showStatus('Ready'), 2000);
    });

    document.getElementById('btn-disconnect-mpegh-audio')?.addEventListener('click', () => {
      this.engine.disconnectLiveStream();
      const streamingBar = document.getElementById('mpegh-vv-streaming-bar');
      if (streamingBar) streamingBar.style.display = 'none';
      this._updatePlayButton(false);
      this._showStatus('MPEG-H VV stream disconnected');
      setTimeout(() => this._showStatus('Ready'), 2000);
    });

    // ─── JOC Dolby Atmos Object Decoder Pre-Processor (Isolated) ───────────
    const jocFeatureToggle = document.getElementById('toggle-joc-feature');
    const jocBadge = document.getElementById('badge-joc-toggle');
    const jocContent = document.getElementById('joc-content-container');
    const jocFileNameEl = document.getElementById('joc-current-file-name');
    const jocFileHintEl = document.getElementById('joc-file-detection-hint');
    const jocLogEl = document.getElementById('joc-console-log');
    const btnJocOpenJOC = document.getElementById('btn-joc-decode-openjoc');
    const btnJocCavernize = document.getElementById('btn-joc-decode-cavernize');
    const btnJocCancel = document.getElementById('btn-joc-cancel');
    const btnJocLoadResult = document.getElementById('btn-joc-load-result');
    const btnJocRestore = document.getElementById('btn-joc-restore-original');
    const btnJocBrowse = document.getElementById('btn-joc-browse-file');
    const btnJocClearLog = document.getElementById('btn-joc-clear-log');
    const btnJocOpenTools = document.getElementById('btn-joc-open-tools');
    const jocLayoutSelect = document.getElementById('joc-target-layout-select');

    // Progress Bar Elements
    const jocProgressWrapper = document.getElementById('joc-progress-wrapper');
    const jocProgressBar = document.getElementById('joc-progress-bar');
    const jocProgressPercent = document.getElementById('joc-progress-percent');
    const jocProgressLabel = document.getElementById('joc-progress-label');
    const jocProgressStatus = document.getElementById('joc-progress-status');
    const jocProgressElapsed = document.getElementById('joc-progress-elapsed');

    // Mini Player Controls Elements
    const jocPlayerControls = document.getElementById('joc-player-controls');
    const btnJocPlayPause = document.getElementById('btn-joc-play-pause');
    const btnJocStop = document.getElementById('btn-joc-stop');
    const btnJocPrev = document.getElementById('btn-joc-prev');
    const btnJocNext = document.getElementById('btn-joc-next');
    const jocSeekBar = document.getElementById('joc-seek-bar');

    // Collapsible Log Elements
    const jocLogToggle = document.getElementById('joc-log-toggle');
    const jocLogCollapsible = document.getElementById('joc-log-collapsible');
    const jocLogToggleIcon = document.getElementById('joc-log-toggle-icon');

    this.jocSelectedFilePath = null;
    this.jocDecodedResult = null;
    this._jocOriginalFile = null;

    let progressTimer = null;
    let progressStartTime = 0;
    let simulatedPercent = 0;

    const startProgress = (engineName) => {
      if (jocProgressWrapper) jocProgressWrapper.classList.remove('hidden');
      if (jocProgressBar) {
        jocProgressBar.style.width = '8%';
        jocProgressBar.classList.add('animated-shimmer');
      }
      if (jocProgressPercent) jocProgressPercent.textContent = '8%';
      if (jocProgressLabel) jocProgressLabel.textContent = `Extracting Atmos objects via ${engineName}...`;
      if (jocProgressStatus) jocProgressStatus.textContent = 'Decoding OAMD metadata & spatial objects...';
      
      progressStartTime = Date.now();
      simulatedPercent = 8;
      if (progressTimer) clearInterval(progressTimer);
      
      progressTimer = setInterval(() => {
        const elapsedSec = ((Date.now() - progressStartTime) / 1000).toFixed(1);
        if (jocProgressElapsed) jocProgressElapsed.textContent = `${elapsedSec}s`;
        
        // Progress smoothly towards 92% while waiting for binary to finish writing WAV
        if (simulatedPercent < 90) {
          simulatedPercent += Math.max(0.4, (90 - simulatedPercent) * 0.06);
          const rounded = Math.round(simulatedPercent);
          if (jocProgressBar) jocProgressBar.style.width = `${rounded}%`;
          if (jocProgressPercent) jocProgressPercent.textContent = `${rounded}%`;
        }
      }, 200);
    };

    const finishProgress = (success, message) => {
      if (progressTimer) clearInterval(progressTimer);
      progressTimer = null;
      const elapsedSec = ((Date.now() - (progressStartTime || Date.now())) / 1000).toFixed(1);
      if (jocProgressElapsed) jocProgressElapsed.textContent = `${elapsedSec}s`;
      
      if (jocProgressBar) {
        jocProgressBar.classList.remove('animated-shimmer');
        jocProgressBar.style.width = success ? '100%' : '0%';
      }
      if (jocProgressPercent) jocProgressPercent.textContent = success ? '100%' : 'Failed';
      if (jocProgressLabel) jocProgressLabel.textContent = success ? '✅ Discrete 7.1.4 Output Ready' : '❌ Extraction Failed';
      if (jocProgressStatus) jocProgressStatus.textContent = message || (success ? `Finished in ${elapsedSec}s` : 'Error occurred');
    };

    const appendJocLog = (msg) => {
      if (!jocLogEl) return;
      if (jocLogEl.textContent === 'Standby. Select a decoder above to begin extraction.') {
        jocLogEl.textContent = '';
      }
      jocLogEl.textContent += (jocLogEl.textContent ? '\n' : '') + msg;
      jocLogEl.scrollTop = jocLogEl.scrollHeight;
    };

    if (window.desktopAPI?.onJocLog) {
      window.desktopAPI.onJocLog((msg) => {
        appendJocLog(msg);
      });
    }

    // Toggle Log collapsible
    jocLogToggle?.addEventListener('click', () => {
      if (!jocLogCollapsible) return;
      const isHidden = jocLogCollapsible.classList.toggle('hidden');
      if (jocLogToggleIcon) jocLogToggleIcon.textContent = isHidden ? '▼' : '▲';
    });

    const updateJocFeatureUI = (enabled) => {
      if (jocFeatureToggle) jocFeatureToggle.checked = enabled;
      if (jocContent) jocContent.classList.toggle('hidden', !enabled);
      if (jocBadge) {
        jocBadge.textContent = enabled ? '🟢 Ready' : 'Off';
        jocBadge.style.background = enabled ? 'rgba(16, 185, 129, 0.15)' : 'var(--bg-card-hover)';
        jocBadge.style.color = enabled ? 'var(--accent-success, #10b981)' : 'var(--text-muted)';
        jocBadge.style.borderColor = enabled ? 'rgba(16, 185, 129, 0.3)' : 'var(--border-subtle)';
      }
    };

    const savedJocState = localStorage.getItem('spatial_joc_feature_enabled') === 'true';
    updateJocFeatureUI(savedJocState);

    jocFeatureToggle?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      localStorage.setItem('spatial_joc_feature_enabled', enabled ? 'true' : 'false');
      updateJocFeatureUI(enabled);
      this._showStatus(`JOC Object Decoder: ${enabled ? 'Enabled' : 'Disabled'}`);
      setTimeout(() => this._showStatus('Ready'), 1500);
    });

    const checkJocStatus = async () => {
      const statusOpenJoc = document.getElementById('joc-status-openjoc');
      const statusCavernize = document.getElementById('joc-status-cavernize');
      if (window.desktopAPI?.jocGetStatus) {
        try {
          const stat = await window.desktopAPI.jocGetStatus();
          if (statusOpenJoc) {
            statusOpenJoc.textContent = stat.openjoc?.available ? '🟢 Available (Rust)' : '⚪ Not Found';
            statusOpenJoc.style.color = stat.openjoc?.available ? 'var(--accent-success)' : 'var(--text-muted)';
          }
          if (statusCavernize) {
            statusCavernize.textContent = stat.cavernize?.available ? '🟢 Available (.NET)' : '⚪ Not Found';
            statusCavernize.style.color = stat.cavernize?.available ? 'var(--accent-success)' : 'var(--text-muted)';
          }
        } catch (_) {}
      } else {
        if (statusOpenJoc) statusOpenJoc.textContent = 'Desktop App Required';
        if (statusCavernize) statusCavernize.textContent = 'Desktop App Required';
      }
    };
    checkJocStatus();
    setInterval(checkJocStatus, 5000);

    btnJocClearLog?.addEventListener('click', () => {
      if (jocLogEl) jocLogEl.textContent = 'Standby. Select a decoder above to begin extraction.';
    });

    btnJocOpenTools?.addEventListener('click', () => {
      if (window.desktopAPI?.openToolsFolder) {
        window.desktopAPI.openToolsFolder();
      } else {
        this._showStatus('Place openjoc.exe or Cavernize.exe into the tools/ directory');
      }
    });

    btnJocBrowse?.addEventListener('click', async () => {
      if (window.desktopAPI?.jocSelectFile) {
        const filePath = await window.desktopAPI.jocSelectFile();
        if (filePath) {
          this.jocSelectedFilePath = filePath;
          if (jocFileNameEl) jocFileNameEl.textContent = filePath.split(/[\\/]/).pop();
          if (jocFileHintEl) {
            const ext = filePath.toLowerCase().split('.').pop();
            const isEAC3 = ['eac3', 'ec3', 'm4a', 'mp4', 'mkv'].includes(ext);
            jocFileHintEl.textContent = isEAC3
              ? `Ready to extract Atmos objects from ${ext.toUpperCase()} container.`
              : `Selected file: .${ext}. Recommended: .eac3 / .m4a JOC streams.`;
            jocFileHintEl.style.color = isEAC3 ? 'var(--accent-cyan)' : 'var(--text-muted)';
          }
          appendJocLog(`📁 Selected file: ${filePath}`);
        }
      } else {
        this._showStatus('Browse is available in the desktop application');
      }
    });

    const runJocDecoder = async (engine) => {
      const targetPath = this.jocSelectedFilePath || this.currentFile?.path || null;
      if (!targetPath) {
        appendJocLog('⚠️ No file path available. Please click "Browse File..." to select an audio file from your hard drive.');
        this._showStatus('⚠️ Please select a file via Browse File first');
        return;
      }

      if (!window.desktopAPI?.jocDecodeOpenJOC) {
        appendJocLog('⚠️ JOC decoders require running the SpatialAudio Electron desktop app.');
        return;
      }

      const layout = jocLayoutSelect?.value || '7.1.4';
      const section = document.getElementById('joc-decoder-section');
      section?.classList.add('decoding');
      if (btnJocOpenJOC) btnJocOpenJOC.disabled = true;
      if (btnJocCavernize) btnJocCavernize.disabled = true;
      if (btnJocCancel) btnJocCancel.disabled = false;
      if (btnJocLoadResult) btnJocLoadResult.disabled = true;
      if (jocBadge) {
        jocBadge.textContent = '⏳ Decoding...';
        jocBadge.style.color = '#f59e0b';
      }
      this._showStatus(`Extracting Atmos objects via ${engine}...`);
      startProgress(engine);

      try {
        let result;
        if (engine === 'OpenJOC') {
          result = await window.desktopAPI.jocDecodeOpenJOC(targetPath, layout);
        } else {
          result = await window.desktopAPI.jocDecodeCavernize(targetPath, layout);
        }

        if (result && result.success) {
          this.jocDecodedResult = result;
          finishProgress(true, `Decoded ${(result.sizeBytes / (1024 * 1024)).toFixed(2)} MB 7.1.4 WAV`);
          if (btnJocLoadResult) btnJocLoadResult.disabled = false;
          if (jocBadge) {
            jocBadge.textContent = '✅ Decoded';
            jocBadge.style.color = 'var(--accent-success)';
          }
          this._showStatus(`✅ ${engine} decoded successfully! Click "Load Decoded Result"`);
        } else {
          const err = result?.error || 'Unknown decode error';
          finishProgress(false, err);
          appendJocLog(`❌ Error: ${err}`);
          this._showStatus(`⚠️ ${engine} failed: ${err}`);
          if (jocBadge) {
            jocBadge.textContent = '❌ Failed';
            jocBadge.style.color = '#f43f5e';
          }
        }
      } catch (err) {
        finishProgress(false, err.message);
        appendJocLog(`❌ Exception: ${err.message}`);
        this._showStatus(`⚠️ Decoder error: ${err.message}`);
        if (jocBadge) {
          jocBadge.textContent = '❌ Error';
          jocBadge.style.color = '#f43f5e';
        }
      } finally {
        section?.classList.remove('decoding');
        if (btnJocOpenJOC) btnJocOpenJOC.disabled = false;
        if (btnJocCavernize) btnJocCavernize.disabled = false;
        if (btnJocCancel) btnJocCancel.disabled = true;
      }
    };

    btnJocOpenJOC?.addEventListener('click', () => runJocDecoder('OpenJOC'));
    btnJocCavernize?.addEventListener('click', () => runJocDecoder('Cavernize'));

    btnJocCancel?.addEventListener('click', () => {
      if (window.desktopAPI?.jocCancel) {
        window.desktopAPI.jocCancel();
        finishProgress(false, 'Cancelled by user');
        appendJocLog('⚠️ Cancel request sent.');
        this._showStatus('JOC decode cancelled');
      }
    });

    btnJocLoadResult?.addEventListener('click', async () => {
      if (!this.jocDecodedResult?.outputFile) {
        this._showStatus('⚠️ No decoded result ready to load');
        return;
      }

      try {
        this._showStatus('Loading decoded 7.1.4 Atmos PCM result...');
        const res = await window.desktopAPI.jocReadFile(this.jocDecodedResult.outputFile);
        if (!res || !res.success || !res.data) {
          throw new Error(res?.error || 'Could not read decoded file data');
        }

        const uint8 = new Uint8Array(res.data);
        const blob = new Blob([uint8], { type: 'audio/wav' });
        const wavFile = new File([blob], this.jocDecodedResult.filename || 'atmos_7.1.4_decoded.wav', { type: 'audio/wav' });

        // Save original file for restore
        this._jocOriginalFile = this.currentFile;

        await this.loadFile(wavFile);
        if (btnJocRestore) btnJocRestore.disabled = false;
        if (jocPlayerControls) jocPlayerControls.classList.remove('hidden');
        
        // Auto-play the loaded 7.1.4 result!
        this.engine.play();
        this._updatePlaybackUI(true);

        this._showStatus('▶️ Loaded and playing 7.1.4 Atmos discrete PCM output!');
        appendJocLog(`▶️ Loaded into player: ${wavFile.name} (7.1.4 Discrete)`);
      } catch (err) {
        console.error('[App] Load JOC result failed:', err);
        this._showStatus(`⚠️ Failed to load result: ${err.message}`);
        appendJocLog(`❌ Failed to load decoded file: ${err.message}`);
      }
    });

    btnJocRestore?.addEventListener('click', async () => {
      if (!this._jocOriginalFile) {
        this._showStatus('⚠️ No original file stored to restore');
        return;
      }
      try {
        this._showStatus(`Restoring original file: ${this._jocOriginalFile.name}...`);
        await this.loadFile(this._jocOriginalFile);
        btnJocRestore.disabled = true;
        this._showStatus('↩️ Original audio file restored');
        appendJocLog(`↩️ Restored original file: ${this._jocOriginalFile.name}`);
      } catch (err) {
        this._showStatus(`⚠️ Restore failed: ${err.message}`);
      }
    });

    // ─── Mini JOC Player Controls Wiring ───────────────────────────────────
    btnJocPlayPause?.addEventListener('click', () => {
      this.togglePlay();
    });

    btnJocStop?.addEventListener('click', () => {
      this.stop();
    });

    btnJocPrev?.addEventListener('click', () => {
      this.playPrev();
    });

    btnJocNext?.addEventListener('click', () => {
      this.playNext();
    });

    jocSeekBar?.addEventListener('input', (e) => {
      this.seek(parseFloat(e.target.value) / 1000);
    });

    // Headphone Profile buttons (Phase 1)
    document.getElementById('btn-profile-standard')?.addEventListener('click', () => {
      this.setHeadphoneMode('standard');
    });
    document.getElementById('btn-profile-sensor')?.addEventListener('click', () => {
      this.setHeadphoneMode('sensor');
    });

    // Virtual Head Look toggle (Phase 2)
    const virtualLookToggle = document.getElementById('virtual-look-toggle');
    virtualLookToggle?.addEventListener('change', (e) => {
      this.setVirtualHeadLook(e.target.checked);
    });

    // Initialize Headphone Profile UI state
    this.setHeadphoneMode(this.headphoneMode, false);

    // Head Tracking Enable/Disable toggle (for standard earbuds/headphones)
    const trackingEnableToggle = document.getElementById('tracking-enable-toggle');
    trackingEnableToggle?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      this.tracker.setEnabled(enabled);
      if (!enabled) {
        this.engine.updateListenerOrientation(0, 0, 0);
        this.visualizer.updateHeadOrientation(0, 0, 0);
        this.visualizer.setTrackingStatus(false);
      }
    });

    // 6-DoF Positional / Walking Tracking toggle
    const posTrackingToggle = document.getElementById('positional-tracking-toggle');
    const posScaleControl = document.getElementById('position-scale-control');
    const sensorMirrorContainer = document.getElementById('sensor-mirror-container');

    posTrackingToggle?.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      this.tracker.setPositionalEnabled(enabled);
      const badge = document.getElementById('step-counter-badge');
      if (!enabled) {
        this.visualizer.resetListenerPosition();
        this.engine.resetListenerPosition();
        this._updateHeightDisplay();
        if (badge) badge.textContent = '👣 Off';
      } else {
        if (badge) badge.textContent = '👣 0 steps';
      }
      this._showStatus(enabled ? '6-DoF Walking Tracking Enabled' : 'Positional Tracking Disabled');
      setTimeout(() => this._showStatus('Ready'), 1500);
    });

    // ── Sensor Axes: Yaw / Pitch / Roll — On/Off + Invert ──────────────────
    // Enable / disable each orientation axis
    document.getElementById('enable-axis-yaw')?.addEventListener('change', (e) => {
      this.tracker.setEnableYaw(e.target.checked);
      this._showStatus(`Yaw axis: ${e.target.checked ? 'Enabled' : 'Disabled'}`);
      setTimeout(() => this._showStatus('Ready'), 1500);
    });
    document.getElementById('enable-axis-pitch')?.addEventListener('change', (e) => {
      this.tracker.setEnablePitch(e.target.checked);
      this._showStatus(`Pitch axis: ${e.target.checked ? 'Enabled' : 'Disabled'}`);
      setTimeout(() => this._showStatus('Ready'), 1500);
    });
    document.getElementById('enable-axis-roll')?.addEventListener('change', (e) => {
      this.tracker.setEnableRoll(e.target.checked);
      this._showStatus(`Roll axis: ${e.target.checked ? 'Enabled' : 'Disabled'}`);
      setTimeout(() => this._showStatus('Ready'), 1500);
    });

    // Invert / mirror each orientation axis
    document.getElementById('invert-axis-yaw')?.addEventListener('change', (e) => {
      this.tracker.setInvertYaw(e.target.checked);
      this._showStatus(`Invert Yaw (turn L/R): ${e.target.checked ? 'ON' : 'OFF'}`);
      setTimeout(() => this._showStatus('Ready'), 1500);
    });
    document.getElementById('invert-axis-pitch')?.addEventListener('change', (e) => {
      this.tracker.setInvertPitch(e.target.checked);
      this._showStatus(`Invert Pitch (nod up/down): ${e.target.checked ? 'ON' : 'OFF'}`);
      setTimeout(() => this._showStatus('Ready'), 1500);
    });
    // Sensor Rotation Order / Axis Mapping Dropdown
    const axisOrderSelect = document.getElementById('axis-order-select');
    const axisOrderBadge = document.getElementById('axis-order-badge');
    axisOrderSelect?.addEventListener('change', (e) => {
      const order = e.target.value;
      this.tracker.setAxisOrder(order);
      localStorage.setItem('spatial_axis_order', order);
      if (axisOrderBadge) axisOrderBadge.textContent = order;
      this._showStatus(`Sensor Axis Mapping set to ${order}`);
      setTimeout(() => this._showStatus('Ready'), 1500);
    });

    // Walking Sensitivity slider
    const posScaleSlider = document.getElementById('position-scale-slider');
    const posScaleValue = document.getElementById('position-scale-value');
    posScaleSlider?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      this.tracker.setPositionScale(val);
      if (posScaleValue) posScaleValue.textContent = `${val.toFixed(1)}×`;
    });

    // Invert WASD Controls Toggle
    this.invertWasd = false;
    const invertWasdToggle = document.getElementById('invert-wasd-toggle');
    invertWasdToggle?.addEventListener('change', (e) => {
      this.invertWasd = e.target.checked;
      this._showStatus(`Invert WASD: ${this.invertWasd ? 'ON (Reversed)' : 'OFF (Normal)'}`);
      setTimeout(() => this._showStatus('Ready'), 1500);
    });

    // Show / Hide 3-Axis Sensor Arrows Toggle
    const toggleShowAxes = document.getElementById('toggle-show-axes');
    toggleShowAxes?.addEventListener('change', (e) => {
      const show = e.target.checked;
      this.visualizer.setShowAxes(show);
      this._showStatus(`Sensor Arrows: ${show ? 'Visible' : 'Hidden'}`);
      setTimeout(() => this._showStatus('Ready'), 1500);
    });

    // POV Height buttons
    document.getElementById('btn-height-up')?.addEventListener('click', () => {
      this.visualizer.moveListenerHeightBy(0.2);
      this.engine.setListenerPosition(
        this.visualizer.listenerMX,
        this.visualizer.listenerMY,
        this.visualizer.listenerMZ
      );
      this._updateHeightDisplay();
    });

    document.getElementById('btn-height-down')?.addEventListener('click', () => {
      this.visualizer.moveListenerHeightBy(-0.2);
      this.engine.setListenerPosition(
        this.visualizer.listenerMX,
        this.visualizer.listenerMY,
        this.visualizer.listenerMZ
      );
      this._updateHeightDisplay();
    });

    document.getElementById('btn-height-reset')?.addEventListener('click', () => {
      this.visualizer.setListenerHeight(0);
      this.engine.setListenerPosition(
        this.visualizer.listenerMX,
        0,
        this.visualizer.listenerMZ
      );
      this._updateHeightDisplay();
      this._showStatus('POV Height reset to 0.00m');
      setTimeout(() => this._showStatus('Ready'), 1500);
    });

    // Reset 3D Camera View / Plane
    const handleResetView = () => {
      this.visualizer.resetView();
      this._showStatus('3D View reset to default (Left-Front-Right-Back)');
      setTimeout(() => this._showStatus('Ready'), 1500);
    };
    document.getElementById('btn-reset-view')?.addEventListener('click', handleResetView);
    document.getElementById('btn-reset-view-side')?.addEventListener('click', handleResetView);

    // Zoom in / out controls
    const handleZoomIn = () => {
      this.visualizer.zoom(1.15);
      this._showStatus(`Zoom: ${Math.round(this.visualizer.zoomLevel * 100)}%`);
    };
    const handleZoomOut = () => {
      this.visualizer.zoom(0.87);
      this._showStatus(`Zoom: ${Math.round(this.visualizer.zoomLevel * 100)}%`);
    };
    document.getElementById('btn-zoom-in')?.addEventListener('click', handleZoomIn);
    document.getElementById('btn-zoom-out')?.addEventListener('click', handleZoomOut);

    // Boundary Limit Toggle (Allow moving outside circle)
    const updateBoundaryUI = (allowOutside) => {
      this.visualizer.setAllowOutsideBoundary(allowOutside);
      const outsideToggle = document.getElementById('outside-boundary-toggle');
      if (outsideToggle && outsideToggle.checked !== allowOutside) {
        outsideToggle.checked = allowOutside;
      }
      const icon = document.getElementById('boundary-btn-icon');
      const label = document.getElementById('boundary-btn-label');
      const btn = document.getElementById('btn-boundary-toggle');
      if (icon) icon.textContent = allowOutside ? '🔓' : '⭕';
      if (label) label.textContent = allowOutside ? 'Boundary: Free' : 'Boundary: Clamped';
      if (btn) {
        btn.classList.toggle('active', allowOutside);
        btn.setAttribute('aria-pressed', String(allowOutside));
        btn.setAttribute('aria-label', allowOutside
          ? 'Clamp movement to the speaker boundary'
          : 'Allow movement outside the speaker boundary');
        btn.title = allowOutside
          ? 'Circle Boundary: Free (Click to clamp inside circle)'
          : 'Circle Boundary: Clamped (Click to allow moving outside)';
      }
      this._showStatus(allowOutside ? 'Circle Boundary: Free (Can move outside)' : 'Circle Boundary: Clamped (Inside only)');
      setTimeout(() => this._showStatus('Ready'), 1500);
    };

    document.getElementById('outside-boundary-toggle')?.addEventListener('change', (e) => {
      updateBoundaryUI(e.target.checked);
    });

    document.getElementById('btn-boundary-toggle')?.addEventListener('click', () => {
      updateBoundaryUI(!this.visualizer.allowOutsideBoundary);
    });

    // ── Immersive first-person stage view ──────────────────────────────────
    const updatePovLockUI = (active) => {
      if (this.visualizer.walkableSceneMode) return;
      this.visualizer.setPovFollowSensor(active);
      const povToggle = document.getElementById('pov-lock-toggle');
      if (povToggle && povToggle.checked !== active) {
        povToggle.checked = active;
      }
      const badge = document.getElementById('pov-lock-badge');
      if (badge) {
        badge.textContent = active ? 'Immersive POV' : 'Orbit View';
        badge.style.color = active ? 'var(--accent-cyan)' : 'var(--text-muted)';
        badge.style.background = active ? 'rgba(34, 211, 238, 0.12)' : 'var(--bg-card-hover)';
        badge.style.borderColor = active ? 'rgba(34, 211, 238, 0.25)' : 'var(--border-subtle)';
      }
      const icon = document.getElementById('pov-btn-icon');
      const label = document.getElementById('pov-btn-label');
      const btn = document.getElementById('btn-pov-lock');
      if (icon) icon.textContent = '👁️';
      if (label) label.textContent = active ? 'Immersive POV: On' : 'Immersive POV: Off';
      if (btn) {
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', String(active));
        btn.setAttribute('aria-label', active ? 'Switch to orbit overview' : 'Switch to immersive first-person view');
        btn.title = active
          ? 'Immersive first-person view active. Click to switch to orbit overview (P).'
          : 'Orbit overview active. Click to enter immersive first-person view (P).';
      }
      document.querySelector('.visualizer-panel')?.classList.toggle('immersive-pov', active);
      this._updateSceneHeading();
      this._showStatus(active ? 'Immersive POV: First-person stage view' : 'Orbit overview: Speaker layout');
      setTimeout(() => this._showStatus('Ready'), 1500);
    };

    document.getElementById('pov-lock-toggle')?.addEventListener('change', (e) => {
      updatePovLockUI(e.target.checked);
    });

    document.getElementById('btn-pov-lock')?.addEventListener('click', () => {
      updatePovLockUI(!this.visualizer.povFollowSensor);
    });

    // ── Room Size Controls (virtual sphere radius) ─────────────────────────
    const updateRoomSize = (r) => {
      r = Math.round(r * 4) / 4; // snap to 0.25m steps
      r = Math.max(0.5, Math.min(8.0, r));

      // Visual sphere
      this.visualizer.setRoomRadius(r);

      // Audio panner positions — scale from the default 2.0m layout distance
      this.engine.setSpeakerScale(r / 2.0);

      // Sync slider
      const slider = document.getElementById('room-radius-slider');
      if (slider) slider.value = r;
      // Sync sidebar label
      const label = document.getElementById('room-radius-value');
      if (label) label.textContent = `${r.toFixed(2).replace(/\.?0+$/, '').padEnd(3, '')} m`;
      // Sync overlay badge
      const badge = document.getElementById('room-size-badge');
      if (badge) badge.textContent = `⬤ ${r.toFixed(1)}m`;
      this._showStatus(`Room radius: ${r.toFixed(2)}m`);
      setTimeout(() => this._showStatus('Ready'), 1200);
    };

    document.getElementById('btn-room-shrink')?.addEventListener('click', () => {
      updateRoomSize(this.visualizer.roomRadius - 0.5);
    });
    document.getElementById('btn-room-grow')?.addEventListener('click', () => {
      updateRoomSize(this.visualizer.roomRadius + 0.5);
    });
    document.getElementById('room-radius-slider')?.addEventListener('input', (e) => {
      updateRoomSize(parseFloat(e.target.value));
    });

    // ─── Keyboard: WASD walking + Arrow height + shortcuts ───────────────────
    this._heldKeys = new Set();
    this._walkSpeed = 0.04;    // meters per frame (~60fps → ~2.4 m/s)
    this._heightSpeed = 0.03;  // meters per frame (~1.8 m/s)

    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        e.preventDefault();
        this._heldKeys.add(key);
      }
      if (e.shiftKey) {
        this._heldKeys.add('shift');
      }

      switch (key) {
        case ' ':
          e.preventDefault();
          this.togglePlay();
          break;
        case 'r':
          this.recenter();
          break;
        case 'v':
          handleResetView();
          break;
        case 'b':
          if (!this.visualizer.walkableSceneMode) {
            updateBoundaryUI(!this.visualizer.allowOutsideBoundary);
          }
          break;
        case 'p':
          if (!this.visualizer.walkableSceneMode) {
            updatePovLockUI(!this.visualizer.povFollowSensor);
          }
          break;
        case '+':
        case '=':
          handleZoomIn();
          break;
        case '-':
        case '_':
          handleZoomOut();
          break;
      }
    });

    document.addEventListener('keyup', (e) => {
      this._heldKeys.delete(e.key.toLowerCase());
      if (!e.shiftKey) {
        this._heldKeys.delete('shift');
      }
    });

    // Movement tick — runs every frame for smooth WASD walking & Arrow height
    const movementTick = () => {
      if (this._heldKeys.size > 0) {
        // Compute movement relative to listener's current yaw
        const currentYaw = this.headphoneMode === 'standard' ? this.virtualYaw : this.tracker.yaw;
        const yawRad = (currentYaw * Math.PI) / 180;
        const fwdX =  Math.sin(yawRad);  // forward X component
        const fwdZ =  Math.cos(yawRad);  // forward Z component
        const rightX =  Math.cos(yawRad); // right X component (perpendicular)
        const rightZ = -Math.sin(yawRad); // right Z component

        let dx = 0, dz = 0;
        if (this._heldKeys.has('w')) { dx += fwdX;   dz += fwdZ;   }
        if (this._heldKeys.has('s')) { dx -= fwdX;   dz -= fwdZ;   }
        if (this._heldKeys.has('d')) { dx += rightX; dz += rightZ; }
        if (this._heldKeys.has('a')) { dx -= rightX; dz -= rightZ; }

        if (this.invertWasd) {
          dx = -dx;
          dz = -dz;
        }

        let moved = false;
        // Normalize diagonal so you don't go sqrt(2) faster
        const mag = Math.hypot(dx, dz);
        if (mag > 0) {
          dx = (dx / mag) * this._walkSpeed;
          dz = (dz / mag) * this._walkSpeed;
          this.visualizer.moveListenerBy(dx, dz);
          moved = true;
        }

        // Virtual Head Look keys (Arrow Left / Right for yaw, Shift + Arrow Up / Down for pitch)
        if (this.virtualHeadLook) {
          let lookRotated = false;
          if (this._heldKeys.has('arrowleft')) {
            this.virtualYaw = (this.virtualYaw - 2.0) % 360;
            if (this.virtualYaw < -180) this.virtualYaw += 360;
            lookRotated = true;
          }
          if (this._heldKeys.has('arrowright')) {
            this.virtualYaw = (this.virtualYaw + 2.0) % 360;
            if (this.virtualYaw > 180) this.virtualYaw -= 360;
            lookRotated = true;
          }
          if (this._heldKeys.has('shift') && this._heldKeys.has('arrowup')) {
            this.virtualPitch = Math.min(80, this.virtualPitch + 1.5);
            lookRotated = true;
          }
          if (this._heldKeys.has('shift') && this._heldKeys.has('arrowdown')) {
            this.virtualPitch = Math.max(-80, this.virtualPitch - 1.5);
            lookRotated = true;
          }
          if (lookRotated) {
            this._applyVirtualOrientation();
          }
        }

        // POV Height adjustment via Arrow Up / Arrow Down keys (when Shift is NOT held)
        let dy = 0;
        if (!this._heldKeys.has('shift')) {
          if (this._heldKeys.has('arrowup'))   dy += this._heightSpeed;
          if (this._heldKeys.has('arrowdown')) dy -= this._heightSpeed;
        }
        if (dy !== 0) {
          this.visualizer.moveListenerHeightBy(dy);
          moved = true;
        }

        if (moved) {
          this.engine.setListenerPosition(
            this.visualizer.listenerMX,
            this.visualizer.listenerMY,
            this.visualizer.listenerMZ
          );
          this._updateHeightDisplay();
        }
      } else if (this.activeEffect && !this.visualizer.isDraggingHead) {
        let x = 0, y = 0, z = 0;
        const pace = this.effectPace;
        const dir = this.effectDirection;

        // Check whether height channels exist in active layout
        const hasHeight = (this.engine.layout && this.engine.layout.some(s => s.isHeight)) ||
                          (this.visualizer.speakers && this.visualizer.speakers.some(s => s.isHeight));

        if (this.activeEffect === 'orbit') {
          // Continuous circular orbit around bed speakers: strictly at ear level y=0, skipping height channel
          const R = 1.48; // meters (orbit ring radius touching bed speakers)
          this.effectPhase += 0.012 * pace * dir;
          x = R * Math.sin(this.effectPhase);
          z = R * Math.cos(this.effectPhase);
          y = 0; // Bed channels only — strictly no height axis
        } else if (this.activeEffect === 'midorbit') {
          // Continuous circular orbit halfway between base speakers and height speakers
          const R = 1.48; // meters (same orbit radius)
          this.effectPhase += 0.012 * pace * dir;
          x = R * Math.sin(this.effectPhase);
          z = R * Math.cos(this.effectPhase);

          const topScale = this.visualizer.topSpeakerHeightScale || 1.0;
          const topElRad = (45 * topScale * Math.PI) / 180;
          const topHeight = 2.2 * Math.sin(topElRad);
          y = topHeight / 2;
        } else if (this.activeEffect === 'heightorbit') {
          // Continuous circular orbit specifically on the ceiling Atmos height speaker plane
          this.effectPhase += 0.012 * pace * dir;

          const topScale = this.visualizer.topSpeakerHeightScale || 1.0;
          const topElRad = (45 * topScale * Math.PI) / 180;
          const topHeight = 2.2 * Math.sin(topElRad);
          const topRadius = 2.2 * Math.cos(topElRad);
          const R = Math.min(1.50, Math.max(1.15, topRadius));
          x = R * Math.sin(this.effectPhase);
          z = R * Math.cos(this.effectPhase);
          y = topHeight;
        } else if (this.activeEffect === 'height') {
          const R = 1.25;
          this.effectPhase += 0.010 * pace * dir;
          x = R * Math.sin(this.effectPhase);
          z = R * Math.cos(this.effectPhase);
          y = 0.85 + 0.70 * Math.sin(this.effectPhase * 1.5);
        } else if (this.activeEffect === 'vortex') {
          // Cosmic Vortex: Breathing spiral expanding from sweet spot out to perimeter and back
          this.effectPhase += 0.014 * pace * dir;
          const breath = 0.5 + 0.5 * Math.sin(this.effectPhase * 0.35); // expands and contracts
          const R = 0.28 + 1.22 * breath; // expands from 0.28m to 1.50m
          x = R * Math.sin(this.effectPhase);
          z = R * Math.cos(this.effectPhase);
          y = 0.75 * breath;
        } else if (this.activeEffect === 'swing') {
          // Binaural Swing: Soothing pendulum hammock sway across the ears (X and slight Z curve)
          this.effectPhase += 0.016 * pace * dir;
          x = 1.42 * Math.sin(this.effectPhase);
          z = 0.45 * Math.cos(this.effectPhase * 2);
          y = 0.20 + 0.45 * Math.pow(Math.sin(this.effectPhase), 2);
        } else if (this.activeEffect === 'infinity') {
          this.effectPhase += 0.012 * pace * dir;
          x = 1.45 * Math.sin(this.effectPhase);
          z = 1.20 * Math.sin(this.effectPhase * 2);
          y = 0.70 + 0.60 * Math.cos(this.effectPhase);
        } else if (this.activeEffect === 'wave') {
          // Serpentine Wave: Refreshing 3D ribbon undulating diagonally through soundfield
          this.effectPhase += 0.012 * pace * dir;
          x = 1.40 * Math.sin(this.effectPhase);
          z = 1.15 * Math.sin(this.effectPhase * 2);
          y = 0.75 + 0.65 * Math.sin(this.effectPhase * 3);
        } else if (this.activeEffect === 'tour') {
          // Speaker-to-speaker guided tour
          // If height channels exist, tour includes height channels at their 3D elevations!
          // If height channels do not exist, tour only visits the available bed channels at y=0!
          let speakers = (this.engine.layout || this.visualizer.speakers || []).filter(s => s.name !== 'LFE');
          if (!hasHeight) {
            speakers = speakers.filter(s => !s.isHeight);
          }

          if (speakers.length > 0) {
            const curIdx = this.tourCurrentSpeaker % speakers.length;
            const nextIdx = (this.tourCurrentSpeaker + 1) % speakers.length;
            const curSpk = speakers[curIdx];
            const nxtSpk = speakers[nextIdx];

            const getSpeakerPosition = this.visualizer.walkableSceneMode
              ? speaker => this.visualizer._sceneSpeakerPosition(speaker)
              : speaker => this.visualizer._speakerToVizCoords(speaker);
            const curPos = getSpeakerPosition(curSpk);
            const nxtPos = getSpeakerPosition(nxtSpk);

            const FACTOR = 0.75;
            const startX = curPos.x * FACTOR;
            const startY = hasHeight ? (curPos.y * FACTOR) : 0;
            const startZ = curPos.z * FACTOR;

            const targetX = nxtPos.x * FACTOR;
            const targetY = hasHeight ? (nxtPos.y * FACTOR) : 0;
            const targetZ = nxtPos.z * FACTOR;

            const hoverFrames = Math.max(20, Math.round(60 / pace));
            const transitionFrames = Math.max(30, Math.round(90 / pace));

            if (this.tourHoverTimer < hoverFrames) {
              this.tourHoverTimer++;
              x = startX;
              y = startY;
              z = startZ;
            } else {
              this.tourProgress += 1 / transitionFrames;
              if (this.tourProgress >= 1) {
                this.tourProgress = 0;
                this.tourHoverTimer = 0;
                this.tourCurrentSpeaker = nextIdx;
                x = targetX;
                y = targetY;
                z = targetZ;
              } else {
                const ease = (1 - Math.cos(this.tourProgress * Math.PI)) / 2;
                x = startX + (targetX - startX) * ease;
                y = startY + (targetY - startY) * ease;
                z = startZ + (targetZ - startZ) * ease;
              }
            }
          }
        }

        this.visualizer.setListenerPositionMeters(x, y, z);
        if (this.engine.audioContext) {
          this.engine.setListenerPosition(x, y, z);
        }
        this._updateHeightDisplay();
      }
      requestAnimationFrame(movementTick);
    };
    requestAnimationFrame(movementTick);

    // Load new file button
    document.getElementById('btn-load-new')?.addEventListener('click', () => {
      fileInput.click();
    });
  }

  _updateSceneHeading(scene = this.visualizer.scenes[this.visualizer.scene]) {
    const title = document.getElementById('viz-stage-title');
    const hint = document.getElementById('viz-stage-hint');
    if (this.visualizer.walkableSceneMode) {
      if (title) title.textContent = scene.title;
      if (hint) hint.textContent = scene.hint;
    } else if (this.visualizer.povFollowSensor) {
      if (title) title.textContent = 'Speaker sphere';
      if (hint) hint.textContent = 'SPHERICAL SPEAKER FIELD · FIRST-PERSON';
    } else {
      if (title) title.textContent = 'Speaker layout';
      if (hint) hint.textContent = 'DRAG TO ORBIT · DRAG LISTENER TO MOVE';
    }
  }

  _syncPovModeControls(active) {
    const povButton = document.getElementById('btn-pov-lock');
    const povToggle = document.getElementById('pov-lock-toggle');
    const sceneButton = document.getElementById('btn-scene-pov-toggle');
    const boundaryButton = document.getElementById('btn-boundary-toggle');
    const outsideBoundaryToggle = document.getElementById('outside-boundary-toggle');
    const roomRadiusSlider = document.getElementById('room-radius-slider');
    const sceneExitButton = document.getElementById('btn-scene-pov-exit');

    if (povButton) {
      povButton.disabled = active;
      povButton.setAttribute('aria-label', active
        ? 'POV Mode is active; exit using the POV Mode controls'
        : 'Toggle immersive first-person view');
      povButton.title = active
        ? 'Exit POV Mode using the POV Mode panel to return to your previous view.'
        : 'Toggle immersive first-person view (P).';
    }
    if (povToggle) povToggle.disabled = active;
    if (boundaryButton) boundaryButton.disabled = active;
    if (outsideBoundaryToggle) outsideBoundaryToggle.disabled = active;
    if (roomRadiusSlider) roomRadiusSlider.disabled = active;
    sceneExitButton?.classList.toggle('visible', active);
    if (sceneButton) {
      sceneButton.textContent = active ? 'Exit POV Mode' : 'Enter POV Mode';
      sceneButton.setAttribute('aria-pressed', String(active));
      sceneButton.classList.toggle('active', active);
    }
    document.querySelector('.visualizer-panel')?.classList.toggle('scene-pov-mode', active);
    document.querySelector('.visualizer-panel')?.classList.toggle('immersive-pov', this.visualizer.povFollowSensor);
  }

  _syncSceneSpeakerPositions() {
    if (!this.engine || !this.visualizer) return;
    const positions = this.visualizer.walkableSceneMode
      ? this.visualizer.speakers.map(speaker => this.visualizer._sceneSpeakerPosition(speaker))
      : null;
    this.engine.setSceneSpeakerPositions(positions);
  }

  _setScenePovMode(active) {
    if (active === this.visualizer.walkableSceneMode) return;

    if (active) {
      this.scenePovReturnState = {
        povFollowSensor: this.visualizer.povFollowSensor,
        x: this.visualizer.listenerMX,
        y: this.visualizer.listenerMY,
        z: this.visualizer.listenerMZ,
        yaw: this.visualizer.yaw,
        pitch: this.visualizer.pitch,
        roll: this.visualizer.roll,
        virtualYaw: this.virtualYaw,
        virtualPitch: this.virtualPitch
      };
      if (this.activeEffect) this.stopEffect(false);
      this.visualizer.setWalkableSceneMode(true);
      this.visualizer.setPovFollowSensor(true);
      this._syncSceneSpeakerPositions();
      this.engine.setListenerPosition(
        this.visualizer.listenerMX,
        this.visualizer.listenerMY,
        this.visualizer.listenerMZ
      );
      this._syncPovModeControls(true);
      this._showStatus(`POV Mode: ${this.visualizer.scenes[this.visualizer.scene].title}`);
    } else {
      const previous = this.scenePovReturnState;
      this.visualizer.setWalkableSceneMode(false);
      this.engine.setSceneSpeakerPositions(null);
      if (previous) {
        this.visualizer.setPovFollowSensor(previous.povFollowSensor);
        this.visualizer.setListenerPositionMeters(previous.x, previous.y, previous.z);
        this.visualizer.updateHeadOrientation(previous.yaw, previous.pitch, previous.roll);
        this.engine.setListenerPosition(previous.x, previous.y, previous.z);
        this.engine.updateListenerOrientation(previous.yaw, previous.pitch, previous.roll);
        this.virtualYaw = previous.virtualYaw;
        this.virtualPitch = previous.virtualPitch;
      }
      this.scenePovReturnState = null;
      this._syncPovModeControls(false);
      this._showStatus('POV Mode closed · Previous view restored');
    }

    const povToggle = document.getElementById('pov-lock-toggle');
    if (povToggle) povToggle.checked = this.visualizer.povFollowSensor;
    const povButton = document.getElementById('btn-pov-lock');
    povButton?.classList.toggle('active', this.visualizer.povFollowSensor);
    povButton?.setAttribute('aria-pressed', String(this.visualizer.povFollowSensor));
    const povBadge = document.getElementById('pov-lock-badge');
    if (povBadge) {
      povBadge.textContent = active
        ? 'POV Mode'
        : this.visualizer.povFollowSensor ? 'Immersive POV' : 'Orbit View';
      povBadge.style.color = this.visualizer.povFollowSensor ? 'var(--accent-cyan)' : 'var(--text-muted)';
      povBadge.style.background = this.visualizer.povFollowSensor ? 'rgba(34, 211, 238, 0.12)' : 'var(--bg-card-hover)';
      povBadge.style.borderColor = this.visualizer.povFollowSensor ? 'rgba(34, 211, 238, 0.25)' : 'var(--border-subtle)';
    }
    const povLabel = document.getElementById('pov-btn-label');
    if (povLabel) {
      povLabel.textContent = active
        ? 'POV Mode: On'
        : `Immersive POV: ${this.visualizer.povFollowSensor ? 'On' : 'Off'}`;
    }
    this._updateSceneHeading();
    this._updateHeightDisplay();
    setTimeout(() => this._showStatus('Ready'), 1500);
  }

  _updateHeightDisplay() {
    const el = document.getElementById('pov-height-val');
    if (!el || !this.visualizer) return;
    const y = this.visualizer.listenerMY || 0;
    el.textContent = `${y >= 0 ? '+' : ''}${y.toFixed(2)} m`;
  }

  _getLayoutChannelCount(layout) {
    if (layout === 'auto') {
      return this.engine?.layout ? this.engine.layout.length : 'Native';
    }
    if (SPEAKER_LAYOUTS && SPEAKER_LAYOUTS[layout]) {
      return SPEAKER_LAYOUTS[layout].length;
    }
    const counts = {
      'mono': 1,
      'stereo': 2,
      'ac4-ims': 2,
      '4.0': 4,
      '5.1': 6,
      'ac4-core-objects': 7,
      '5.1.2': 8,
      '7.1': 8,
      '5.1.4': 10,
      '7.1.2': 10,
      '7.1.4': 12,
      '9.1.4': 14,
      '9.1.6': 16,
      'ac4-advanced-objects': 16,
      '22.2': 24,
    };
    return counts[layout] || 12;
  }
}

// ─── Bootstrap ─────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
  
  // Expose for debugging
  window.spatialAudio = app;

  // Desktop integration (Electron System Tray)
  if (window.desktopAPI && typeof window.desktopAPI.onTrayAction === 'function') {
    window.desktopAPI.onTrayAction((action) => {
      if (action === 'recenter') app.recenter();
      if (action === 'play-pause') app.togglePlay();
    });
  }
});
