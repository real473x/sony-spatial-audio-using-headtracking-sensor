/**
 * Spatial Audio Visualizer — 3D Perspective View
 *
 * Canvas-based 3D isometric perspective showing:
 * - Floor ring with grid and compass labels
 * - Floor-level speakers at correct azimuth positions
 * - Height speakers ELEVATED with vertical connecting stems (correct 3D position)
 * - LFE subwoofer at center floor
 * - Interactive draggable listener head + orientation arrow
 * - Camera rotation via drag anywhere outside the head
 * - Real-time speaker activity glow from audio levels
 * - Dark & Light theme support
 */

import { speakerToCartesian } from './audio-engine.js';

export class Visualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;

    // Head orientation (degrees)
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;

    // Speakers and audio levels
    this.speakers = [];
    this.channelLevels = [];
    this.analyserData = null;
    this.isTracking = false;

    // Listener position in meters in 3D room space
    // x = right/left, y = POV height (+Y is elevated), z = forward/back
    this.listenerMX = 0;
    this.listenerMY = 0;
    this.listenerMZ = 0;

    // Legacy pixel-space aliases (kept for external compat)
    this.listenerX = 0;
    this.listenerY = 0;

    // Drag state
    this.isDraggingHead = false;
    this.isHoveringHead = false;
    this.hoverAxis = null;     // 'X' | 'Y' | 'Z' | 'all' | null
    this.dragAxis = null;      // 'X' | 'Y' | 'Z' | 'all' | null
    this._dragStartPos = { x: 0, y: 0 };
    this._dragStartMX = 0;
    this._dragStartMY = 0;
    this._dragStartMZ = 0;
    this.isDraggingCamera = false;
    this._cameraDragStart = { x: 0, y: 0, az: 0, tilt: 0 };
    this.isDraggingPOVLook = false;
    this._povDragStart = { x: 0, y: 0, yaw: 0, pitch: 0 };
    this.virtualHeadLookEnabled = false;
    this.isDraggingVirtualLook = false;
    this._virtualLookDragStart = { x: 0, y: 0, yaw: 0, pitch: 0 };
    this._onListenerMove = null;
    this._onOrientationChange = null;

    // Feature toggles & scaling
    this.showAxes = true;
    this.topSpeakerHeightScale = 1.0;
    this.activeEffectName = null;
    this.allowOutsideBoundary = false;

    // Virtual room radius in meters (size of the speaker sphere boundary)
    this.roomRadius = 2.0;

    // First-person stage view: the listener position becomes the camera origin.
    this.povFollowSensor = false;
    this.walkableSceneMode = false;
    this.scene = 'living-room';
    this._pendingCinemaSpawn = null;
    this._cinemaSpeakerLayout = null;
    this._cinemaRoomGeometry = null;
    this.scenes = {
      'living-room': { title: 'Living room', hint: 'HOME CINEMA · ACTIVE SPEAKER POSITIONS', width: 5.4, depth: 6.5, open: false },
      cinema: {
        title: 'Cinema 1',
        hint: '64-SPEAKER ATMOS · SCOPE SCREEN · 14 ROWS',
        width: 14,
        depth: 24,
        open: false,
        cinema: true,
        spawn: { x: 0, y: 4, z: -13.7 }
      },
      'cinema-2': {
        title: 'Cinema 2 · Rear seat',
        hint: '64-SPEAKER ATMOS · REAR-SEAT VIEW',
        width: 14,
        depth: 24,
        open: false,
        cinema: true,
        spawn: { x: 0, y: 6.1, z: -20.3 }
      },
      concert: { title: 'Open-air concert', hint: 'LIVE EVENT · ACTIVE SPEAKER POSITIONS', width: 18, depth: 20, open: true },
      studio: { title: 'Reference studio', hint: 'NEARFIELD ROOM · ACTIVE SPEAKER POSITIONS', width: 5, depth: 6, open: false }
    };

    // Solo Calibration channels (Set of channel indices 0..N-1)
    this.soloedChannels = new Set();

    // 3D Camera: azimuth = horizontal orbit (deg), tilt = downward angle (deg)
    // az=0, tilt=35 gives a "from above-and-behind" view where BACK=top, FRONT=bottom
    this.cameraAzimuth = 0;
    this.cameraTilt = 35;

    // Scale3D: pixels per meter. Computed in _resize().
    this.scale3D = 100;
    this.baseScale3D = 100;
    this.zoomLevel = 1.0;

    // Animation
    this.animationFrame = null;
    this.time = 0;

    // Theme palettes
    this.theme = 'light';
    this.themes = {
      dark: {
        bg: '#06060f',
        bgTop: '#0b1020',
        bgGlow: 'rgba(34, 211, 238, 0.1)',
        roomWall: 'rgba(55, 83, 142, 0.12)',
        roomEdge: 'rgba(116, 151, 230, 0.3)',
        roomGrid: 'rgba(118, 153, 226, 0.12)',
        roomFloor: 'rgba(41, 65, 110, 0.24)',
        floor: 'rgba(80, 100, 255, 0.07)',
        floorRim: 'rgba(100, 150, 255, 0.42)',
        floorGrid: 'rgba(123, 151, 255, 0.14)',
        floorAxisLine: 'rgba(122, 168, 255, 0.22)',
        hudBg: 'rgba(10, 15, 30, 0.78)',
        hudBorder: 'rgba(148, 163, 220, 0.18)',
        hudText: 'rgba(220, 230, 255, 0.88)',
        ceiling: 'rgba(192, 132, 252, 0.08)',
        ceilRim: 'rgba(192, 132, 252, 0.22)',
        stem: 'rgba(192, 132, 252, 0.35)',
        stemActive: 'rgba(167, 139, 250, 0.65)',
        floorShadow: 'rgba(192, 132, 252, 0.12)',
        speaker: '#6c7aff',
        speakerGlow: 'rgba(108, 122, 255, 0.45)',
        speakerActive: '#a78bfa',
        speakerActiveGlow: 'rgba(167, 139, 250, 0.7)',
        subwoofer: '#f59e0b',
        subwooferGlow: 'rgba(245, 158, 11, 0.5)',
        heightSpeaker: '#c084fc',
        heightSpeakerGlow: 'rgba(192, 132, 252, 0.7)',
        heightText: 'rgba(233, 213, 255, 0.95)',
        bottomSpeaker: '#06b6d4',
        bottomSpeakerGlow: 'rgba(6, 182, 212, 0.65)',
        bottomText: 'rgba(103, 232, 249, 0.95)',
        objectSpeaker: '#f43f5e',
        objectSpeakerGlow: 'rgba(244, 63, 94, 0.7)',
        objectText: 'rgba(253, 164, 175, 0.95)',
        virtualSpeaker: '#38bdf8',
        virtualSpeakerGlow: 'rgba(56, 189, 248, 0.65)',
        virtualText: 'rgba(125, 211, 252, 0.95)',
        head: '#22d3ee',
        headGlow: 'rgba(34, 211, 238, 0.4)',
        cone: 'rgba(34, 211, 238, 0.08)',
        text: 'rgba(210, 220, 255, 0.85)',
        subText: 'rgba(245, 158, 11, 0.9)',
        compassText: 'rgba(160, 170, 220, 0.5)',
        waveform: 'rgba(108, 122, 255, 0.28)',
        dragRing: 'rgba(34, 211, 238, 0.35)',
        guideLine: 'rgba(34, 211, 238, 0.25)',
        hint: 'rgba(34, 211, 238, 0.8)',
      },
      light: {
        bg: '#f8fafc',
        bgTop: '#eef3ff',
        bgGlow: 'rgba(14, 165, 233, 0.09)',
        roomWall: 'rgba(79, 70, 229, 0.055)',
        roomEdge: 'rgba(79, 70, 229, 0.36)',
        roomGrid: 'rgba(79, 70, 229, 0.2)',
        roomFloor: 'rgba(99, 102, 241, 0.08)',
        floor: 'rgba(99, 102, 241, 0.06)',
        floorRim: 'rgba(79, 70, 229, 0.38)',
        floorGrid: 'rgba(79, 70, 229, 0.13)',
        floorAxisLine: 'rgba(79, 70, 229, 0.2)',
        hudBg: 'rgba(255, 255, 255, 0.84)',
        hudBorder: 'rgba(100, 116, 139, 0.22)',
        hudText: '#334155',
        ceiling: 'rgba(147, 51, 234, 0.05)',
        ceilRim: 'rgba(147, 51, 234, 0.22)',
        stem: 'rgba(147, 51, 234, 0.30)',
        stemActive: 'rgba(124, 58, 237, 0.6)',
        floorShadow: 'rgba(147, 51, 234, 0.10)',
        speaker: '#4f46e5',
        speakerGlow: 'rgba(79, 70, 229, 0.32)',
        speakerActive: '#7c3aed',
        speakerActiveGlow: 'rgba(124, 58, 237, 0.5)',
        subwoofer: '#d97706',
        subwooferGlow: 'rgba(217, 119, 6, 0.38)',
        heightSpeaker: '#9333ea',
        heightSpeakerGlow: 'rgba(147, 51, 234, 0.52)',
        heightText: '#6b21a8',
        bottomSpeaker: '#0891b2',
        bottomSpeakerGlow: 'rgba(8, 145, 178, 0.5)',
        bottomText: '#0e7490',
        objectSpeaker: '#e11d48',
        objectSpeakerGlow: 'rgba(225, 29, 72, 0.55)',
        objectText: '#be123c',
        virtualSpeaker: '#0284c7',
        virtualSpeakerGlow: 'rgba(2, 132, 199, 0.5)',
        virtualText: '#0369a1',
        head: '#0284c7',
        headGlow: 'rgba(2, 132, 199, 0.32)',
        cone: 'rgba(2, 132, 199, 0.07)',
        text: '#1e293b',
        subText: '#b45309',
        compassText: '#94a3b8',
        waveform: 'rgba(79, 70, 229, 0.28)',
        dragRing: 'rgba(2, 132, 199, 0.38)',
        guideLine: 'rgba(2, 132, 199, 0.26)',
        hint: 'rgba(2, 132, 199, 0.9)',
      }

    };
    this.colors = this.themes.light;

    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._setupPointerEvents();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  setTheme(theme) {
    this.theme = theme;
    this.colors = this.themes[theme] || this.themes.light;
  }

  _isCinemaScene() {
    return this.scenes[this.scene]?.cinema === true;
  }

  setScene(scene) {
    if (!Object.hasOwn(this.scenes, scene)) {
      throw new RangeError(`Unknown listening scene: ${scene}`);
    }
    const changed = this.scene !== scene;
    this.scene = scene;
    const sceneConfig = this.scenes[scene];
    if (changed && sceneConfig.cinema) {
      this._pendingCinemaSpawn = sceneConfig.spawn;
      if (this.walkableSceneMode) this._applyCinemaSpawn();
    } else if (changed) {
      this._pendingCinemaSpawn = null;
    }
    if (this.walkableSceneMode) {
      this._clampListenerToScene();
    }
    return sceneConfig;
  }

  setWalkableSceneMode(enabled) {
    this.walkableSceneMode = !!enabled;
    if (this.walkableSceneMode) {
      if (this._pendingCinemaSpawn && this._isCinemaScene()) this._applyCinemaSpawn();
      this._clampListenerToScene();
    }
  }

  _applyCinemaSpawn() {
    const spawn = this._pendingCinemaSpawn;
    if (!spawn) return;
    this.listenerMX = spawn.x;
    this.listenerMY = spawn.y;
    this.listenerMZ = spawn.z;
    this.listenerX = this.listenerMX;
    this.listenerY = this.listenerMZ;
    this._pendingCinemaSpawn = null;
    this._onListenerMove?.(this.listenerMX, this.listenerMY, this.listenerMZ);
  }

  _sceneGeometry() {
    const scene = this.scenes[this.scene];
    if (scene.cinema) {
      return {
        halfWidth: scene.width / 2,
        halfDepth: scene.depth / 2,
        minX: -scene.width / 2,
        maxX: scene.width / 2,
        minZ: -scene.depth,
        maxZ: 0,
        floorY: 0,
        ceilingY: 8,
        cinema: true
      };
    }
    const halfWidth = scene.width / 2;
    const halfDepth = scene.depth / 2;
    return {
      halfWidth,
      halfDepth,
      minX: -halfWidth,
      maxX: halfWidth,
      minZ: -halfDepth,
      maxZ: halfDepth,
      floorY: -1.15,
      ceilingY: this.scene === 'concert' ? 7 : 1.7,
      cinema: false
    };
  }

  _cinemaFloorAtDepth(depth) {
    if (depth < 3) return 0.6;
    if (depth < 6) return 0;
    if (depth < 20.3) {
      const row = Math.min(13, Math.floor((depth - 6) / 1.1));
      return (row + 1) * 0.35;
    }
    return depth < 22 ? 4.9 : 4.5;
  }

  _clampListenerToScene() {
    const { minX, maxX, minZ, maxZ, floorY, ceilingY, cinema } = this._sceneGeometry();
    const margin = 0.4;
    const x = Math.max(minX + margin, Math.min(maxX - margin, this.listenerMX));
    const z = Math.max(minZ + margin, Math.min(maxZ - margin, this.listenerMZ));
    const minY = cinema ? this._cinemaFloorAtDepth(-z) + 0.15 : floorY + 0.15;
    const y = Math.max(minY, Math.min(ceilingY - 0.15, this.listenerMY));
    if (x !== this.listenerMX || y !== this.listenerMY || z !== this.listenerMZ) {
      this.listenerMX = x;
      this.listenerMY = y;
      this.listenerMZ = z;
      this.listenerX = x;
      this.listenerY = z;
      if (this._onListenerMove) {
        this._onListenerMove(x, y, z);
      }
    }
  }

  setSpeakers(layout) {
    this.speakers = layout.map((speaker, i) => {
      const sp = {
        ...speaker,
        index: i,
        baseElevation: speaker.elevation,
        baseDistance: speaker.distance
      };
      sp.pos3D = this._speakerToVizCoords(sp);
      sp.sx = 0;
      sp.sy = 0;
      return sp;
    });
  }

  updateHeadOrientation(yaw, pitch, roll) {
    this.yaw = yaw;
    this.pitch = pitch;
    this.roll = roll;
  }

  updateChannelLevels(levels) {
    this.channelLevels = levels;
  }

  updateAnalyserData(data) {
    this.analyserData = data;
  }

  setTrackingStatus(connected) {
    this.isTracking = connected;
  }

  onListenerMove(callback) {
    this._onListenerMove = callback;
  }

  onOrientationChange(callback) {
    this._onOrientationChange = callback;
  }

  setAllowOutsideBoundary(allowed) {
    this.allowOutsideBoundary = !!allowed;
    if (this.walkableSceneMode) {
      this._clampListenerToScene();
    } else if (!this.allowOutsideBoundary) {
      const R = this.roomRadius;
      const dist = Math.hypot(this.listenerMX, this.listenerMZ);
      if (dist > R) {
        this.listenerMX = (this.listenerMX / dist) * R;
        this.listenerMZ = (this.listenerMZ / dist) * R;
        this.listenerX = this.listenerMX;
        this.listenerY = this.listenerMZ;
        if (this._onListenerMove) {
          this._onListenerMove(this.listenerMX, this.listenerMY || 0, this.listenerMZ);
        }
      }
    }
  }

  /**
   * Set the virtual room radius (sphere size) in meters.
   * Affects visual ring, boundary clamp, and all related geometry.
   * @param {number} r - radius in meters (e.g. 1.0 to 6.0)
   */
  setRoomRadius(r) {
    this.roomRadius = Math.max(0.5, Math.min(10.0, r));
    // Recompute speaker 3D positions so speakers scale proportionally with the virtual room radius
    if (this.speakers.length > 0) {
      this.speakers.forEach(s => {
        s.pos3D = this._speakerToVizCoords(s);
      });
    }
    // If listener is now outside the new boundary, pull it back in
    if (!this.walkableSceneMode && !this.allowOutsideBoundary) {
      const dist = Math.hypot(this.listenerMX, this.listenerMZ);
      if (dist > this.roomRadius) {
        this.listenerMX = (this.listenerMX / dist) * this.roomRadius;
        this.listenerMZ = (this.listenerMZ / dist) * this.roomRadius;
        this.listenerX = this.listenerMX;
        this.listenerY = this.listenerMZ;
        if (this._onListenerMove) {
          this._onListenerMove(this.listenerMX, this.listenerMY || 0, this.listenerMZ);
        }
      }
    }
    console.log(`[Visualizer] Room radius set to ${this.roomRadius.toFixed(1)}m`);
  }

  /**
   * Set POV Follow Sensor mode (Real First-Person POV).
   * When enabled: user POV is locked forward, and the virtual room/speakers spin
   * as the user's head turns to show which speaker they are currently listening to.
   * @param {boolean} enabled
   */
  setPovFollowSensor(enabled) {
    this.povFollowSensor = !!enabled;
    console.log(`[Visualizer] POV Follow Sensor: ${this.povFollowSensor ? 'ENABLED' : 'DISABLED'}`);
  }

  /**
   * Set currently soloed speaker channels for axis calibration visual feedback
   * @param {number[]|Set<number>|number|null} channelIndices
   */
  setSoloedChannels(channelIndices) {
    if (channelIndices instanceof Set) {
      this.soloedChannels = new Set(channelIndices);
    } else if (Array.isArray(channelIndices)) {
      this.soloedChannels = new Set(channelIndices.filter(i => i !== null && i !== undefined && i >= 0));
    } else if (channelIndices !== null && channelIndices !== undefined && channelIndices >= 0) {
      this.soloedChannels = new Set([channelIndices]);
    } else {
      this.soloedChannels.clear();
    }
  }

  setSoloedChannel(channelIndex) {
    this.setSoloedChannels(channelIndex);
  }

  /** Set listener position from sensor/tracker data (meters). Supports (x, y, z) or (x, z) */
  setListenerPositionMeters(meterX, meterY, meterZ) {
    if (this.isDraggingHead) return;
    let mx = meterX;
    let my = meterZ !== undefined ? meterY : this.listenerMY;
    let mz = meterZ !== undefined ? meterZ : meterY;

    if (this.walkableSceneMode) {
      const { minX, maxX, minZ, maxZ, floorY, ceilingY, cinema } = this._sceneGeometry();
      const margin = 0.4;
      mx = Math.max(minX + margin, Math.min(maxX - margin, mx));
      const minY = cinema ? this._cinemaFloorAtDepth(-mz) + 0.15 : floorY + 0.15;
      my = Math.max(minY, Math.min(ceilingY - 0.15, my));
      mz = Math.max(minZ + margin, Math.min(maxZ - margin, mz));
    } else if (!this.allowOutsideBoundary) {
      const R = this.roomRadius;
      const dist = Math.hypot(mx, mz);
      if (dist > R) {
        mx = (mx / dist) * R;
        mz = (mz / dist) * R;
      }
    }
    this.listenerMX = mx;
    this.listenerMY = my;
    this.listenerMZ = mz;
    this.listenerX = mx;
    this.listenerY = mz;
  }

  /** Move listener by horizontal delta (meters). Used by WASD keyboard walking. */
  moveListenerBy(dx, dz) {
    if (this.walkableSceneMode) {
      const { minX, maxX, minZ, maxZ, cinema } = this._sceneGeometry();
      const margin = 0.4;
      const previousFloor = cinema ? this._cinemaFloorAtDepth(-this.listenerMZ) : 0;
      this.listenerMX = Math.max(minX + margin, Math.min(maxX - margin, this.listenerMX + dx));
      this.listenerMZ = Math.max(minZ + margin, Math.min(maxZ - margin, this.listenerMZ + dz));
      if (cinema) {
        this.listenerMY += this._cinemaFloorAtDepth(-this.listenerMZ) - previousFloor;
      }
      this.listenerX = this.listenerMX;
      this.listenerY = this.listenerMZ;
      if (this._onListenerMove) this._onListenerMove(this.listenerMX, this.listenerMY, this.listenerMZ);
      return;
    }

    const R = this.roomRadius;
    const maxBound = this.allowOutsideBoundary ? 10.0 : R;
    const nx = this.listenerMX + dx;
    const nz = this.listenerMZ + dz;
    const dist = Math.hypot(nx, nz);

    if (!this.allowOutsideBoundary && dist > R) {
      this.listenerMX = (nx / dist) * R;
      this.listenerMZ = (nz / dist) * R;
    } else {
      this.listenerMX = Math.max(-maxBound, Math.min(maxBound, nx));
      this.listenerMZ = Math.max(-maxBound, Math.min(maxBound, nz));
    }
    this.listenerX  = this.listenerMX;
    this.listenerY  = this.listenerMZ;
    if (this._onListenerMove) this._onListenerMove(this.listenerMX, this.listenerMY, this.listenerMZ);
  }

  /** Move listener POV height by delta (meters). Used by Arrow Up / Down keys. */
  moveListenerHeightBy(dy) {
    const { floorY, ceilingY, cinema } = this.walkableSceneMode
      ? this._sceneGeometry()
      : { floorY: -1.5, ceilingY: 2.5 };
    const minY = this.walkableSceneMode && cinema
      ? this._cinemaFloorAtDepth(-this.listenerMZ) + 0.15
      : floorY + (this.walkableSceneMode ? 0.15 : 0);
    const MIN_H = minY;
    const MAX_H = this.walkableSceneMode ? ceilingY - 0.15 : ceilingY;
    this.listenerMY = Math.max(MIN_H, Math.min(MAX_H, this.listenerMY + dy));
    if (this._onListenerMove) this._onListenerMove(this.listenerMX, this.listenerMY, this.listenerMZ);
  }

  /** Set listener POV height directly (meters). */
  setListenerHeight(meterY) {
    const { floorY, ceilingY, cinema } = this.walkableSceneMode
      ? this._sceneGeometry()
      : { floorY: -1.5, ceilingY: 2.5 };
    const minY = this.walkableSceneMode && cinema
      ? this._cinemaFloorAtDepth(-this.listenerMZ) + 0.15
      : floorY + (this.walkableSceneMode ? 0.15 : 0);
    const MIN_H = minY;
    const MAX_H = this.walkableSceneMode ? ceilingY - 0.15 : ceilingY;
    this.listenerMY = Math.max(MIN_H, Math.min(MAX_H, meterY));
    if (this._onListenerMove) this._onListenerMove(this.listenerMX, this.listenerMY, this.listenerMZ);
  }

  resetListenerPosition() {
    this.listenerMX = 0;
    this.listenerMY = 0;
    this.listenerMZ = 0;
    this.listenerX = 0;
    this.listenerY = 0;
    if (this._onListenerMove) this._onListenerMove(0, 0, 0);
  }

  /** Reset 3D camera view / plane to default bird's-eye view (Front=top, Left=left, Right=right) and 1.0x zoom */
  resetView() {
    this.cameraAzimuth = 0;
    this.cameraTilt = 35;
    this.zoomLevel = 1.0;
    this._resize();
  }

  /** Zoom the 3D plane by a factor (e.g. 1.15 to zoom in, 0.85 to zoom out) */
  zoom(factor) {
    this.zoomLevel = Math.max(0.35, Math.min(3.5, this.zoomLevel * factor));
    if (this.baseScale3D) {
      this.scale3D = this.baseScale3D * this.zoomLevel;
      this.radius = this.scale3D;
    }
  }

  setZoom(level) {
    this.zoomLevel = Math.max(0.35, Math.min(3.5, level));
    if (this.baseScale3D) {
      this.scale3D = this.baseScale3D * this.zoomLevel;
      this.radius = this.scale3D;
    }
  }

  resetZoom() {
    this.zoomLevel = 1.0;
    if (this.baseScale3D) {
      this.scale3D = this.baseScale3D;
      this.radius = this.scale3D;
    }
  }

  /** Show or hide the 3-axis (X, Y, Z) coordinate arrows on listener avatar */
  setShowAxes(show) {
    this.showAxes = !!show;
  }

  /** Set height scale for top / ceiling Atmos speakers (0.0 to 1.5) */
  setTopSpeakerHeightScale(scale) {
    this.topSpeakerHeightScale = Math.max(0.0, Math.min(1.5, scale));
    if (this.speakers.length > 0) {
      this.speakers.forEach(s => { s.pos3D = this._speakerToVizCoords(s); });
    }
  }

  /** Set active spatial effect name for canvas HUD display */
  setActiveEffect(name) {
    this.activeEffectName = name;
  }

  start() {
    if (this.animationFrame) return;
    this._render();
  }

  stop() {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  // ─── 3D Math & Projection ───────────────────────────────────────────────────

  /**
   * Convert speaker azimuth/elevation/distance to 3D visualization coordinates.
   * Coordinate frame:
   *   +X = Right, -X = Left
   *   +Y = Up / Height
   *   +Z = Front / Forward, -Z = Back / Rear
   */
  _speakerToVizCoords(speaker) {
    if (speaker.baseElevation === undefined) speaker.baseElevation = speaker.elevation;
    if (speaker.baseDistance === undefined) speaker.baseDistance = speaker.distance;
    const effectiveEl = speaker.isHeight ? (speaker.baseElevation * this.topSpeakerHeightScale) : speaker.elevation;
    const az = (speaker.azimuth * Math.PI) / 180;
    const el = (effectiveEl * Math.PI) / 180;
    const scale = (this.roomRadius || 2.0) / 2.0;
    const d = speaker.baseDistance * scale;
    return {
      x:  d * Math.sin(az) * Math.cos(el),   // right = positive, left = negative
      y:  d * Math.sin(el),                   // up = positive
      z:  d * Math.cos(az) * Math.cos(el)     // front = positive, back = negative
    };
  }

  _sceneSpeakerPosition(speaker) {
    if (this._isCinemaScene()) {
      const azimuth = (speaker.azimuth * Math.PI) / 180;
      const directionX = Math.sin(azimuth);
      const directionZ = Math.cos(azimuth);
      const centerDepth = 12;
      const halfWidth = 6.5;
      const depthToWall = directionZ >= 0
        ? (centerDepth - 0.2) / Math.max(directionZ, 0.0001)
        : (23.8 - centerDepth) / Math.max(-directionZ, 0.0001);
      const wallDistance = Math.min(
        halfWidth / Math.max(Math.abs(directionX), 0.0001),
        depthToWall
      );
      const depth = centerDepth - directionZ * wallDistance;
      const y = speaker.isLFE || speaker.isBottom
        ? 0.3
        : speaker.isHeight
          ? 7.7
          : Math.max(3.2, Math.min(6.5, 3.2 + ((depth - 5) / 14.4) * 3.3));
      return {
        x: directionX * wallDistance,
        y,
        z: -depth
      };
    }

    // Keep the existing compact room mapping for non-cinema scenes.
    const { halfWidth, halfDepth, floorY, ceilingY } = this._sceneGeometry();
    const az = (speaker.azimuth * Math.PI) / 180;
    const dirX = Math.sin(az);
    const dirZ = Math.cos(az);
    const wallDistance = Math.min(
      (halfWidth - 0.55) / Math.max(Math.abs(dirX), 0.0001),
      (halfDepth - 0.55) / Math.max(Math.abs(dirZ), 0.0001)
    );
    const radiusScale = speaker.isHeight ? 0.72 : 0.96;
    const effectiveElevation = (speaker.baseElevation ?? speaker.elevation ?? 0) * this.topSpeakerHeightScale;
    const heightFraction = Math.max(0, Math.min(1, effectiveElevation / 45));
    const earLevel = 0.05;

    return {
      x: dirX * wallDistance * radiusScale,
      y: speaker.isHeight
        ? earLevel + (ceilingY - 0.45 - earLevel) * heightFraction
        : speaker.isBottom
          ? floorY + 0.28
          : speaker.isLFE
            ? floorY + 0.55
            : earLevel,
      z: dirZ * wallDistance * radiusScale
    };
  }

  /**
   * Convert a 3D world coordinate into camera space (relative to listener head position and orientation).
   */
  _toCamSpace(x, y, z) {
    const dx = x - this.listenerMX;
    const dy = y - (this.listenerMY || 0);
    const dz = z - this.listenerMZ;

    const camera = this._getPOVCameraCache();

    // 1. Rotate around Y (Yaw)
    const x1 =  dx * camera.cosYaw - dz * camera.sinYaw;
    const y1 =  dy;
    const z1 =  dx * camera.sinYaw + dz * camera.cosYaw;

    // 2. Rotate around X (Pitch)
    const x2 = x1;
    const y2 = y1 * camera.cosPitch - z1 * camera.sinPitch;
    const z2 = y1 * camera.sinPitch + z1 * camera.cosPitch;

    // 3. Rotate around Z (Roll)
    const camX =  x2 * camera.cosRoll + y2 * camera.sinRoll;
    const camY = -x2 * camera.sinRoll + y2 * camera.cosRoll;
    const camZ =  z2;

    return { camX, camY, camZ };
  }

  _getPOVCameraCache() {
    const cache = this._povCameraCache;
    if (cache && cache.yaw === this.yaw && cache.pitch === this.pitch
      && cache.roll === this.roll && cache.width === this.width) {
      return cache;
    }

    const yawRad = (this.yaw * Math.PI) / 180;
    const pitchRad = (this.pitch * Math.PI) / 180;
    const rollRad = (this.roll * Math.PI) / 180;
    const fovRad = (78 * Math.PI) / 180;
    this._povCameraCache = {
      yaw: this.yaw,
      pitch: this.pitch,
      roll: this.roll,
      width: this.width,
      sinYaw: Math.sin(yawRad),
      cosYaw: Math.cos(yawRad),
      sinPitch: Math.sin(pitchRad),
      cosPitch: Math.cos(pitchRad),
      sinRoll: Math.sin(rollRad),
      cosRoll: Math.cos(rollRad),
      focalLength: (this.width / 2) / Math.tan(fovRad / 2)
    };
    return this._povCameraCache;
  }

  /**
   * Project a camera-space point to screen coordinates with a wide horizontal game-view FOV.
   */
  _camToScreen(camX, camY, camZ) {
    const focalLength = this._getPOVCameraCache().focalLength;

    return {
      x: this.cx + (camX / camZ) * focalLength,
      y: this.cy - (camY / camZ) * focalLength,
      depth: camZ,
      scale: focalLength / camZ
    };
  }

  /**
   * Unified 3D → 2D projection.
   * If povFollowSensor is ON: uses first-person perspective from listener position.
   * If povFollowSensor is OFF: uses standard 3D isometric orbit camera.
   */
  _project(x, y, z) {
    if (this.povFollowSensor) {
      const c = this._toCamSpace(x, y, z);
      if (c.camZ <= 0.08) {
        return { x: -9999, y: -9999, depth: c.camZ, inFront: false, scale: 0 };
      }
      const scr = this._camToScreen(c.camX, c.camY, c.camZ);
      return {
        x: scr.x,
        y: scr.y,
        depth: c.camZ,
        inFront: true,
        scale: scr.scale
      };
    }

    const az   = (this.cameraAzimuth * Math.PI) / 180;
    const tilt = (this.cameraTilt   * Math.PI) / 180;

    // Rotate around Y (azimuth orbit)
    const rx =  x * Math.cos(az) + z * Math.sin(az);
    const ry =  y;
    const rz = -x * Math.sin(az) + z * Math.cos(az);

    // Rotate around X (downward tilt looking forward from behind)
    const sx = rx;
    const sy = ry * Math.cos(tilt) + rz * Math.sin(tilt);
    const depth = -ry * Math.sin(tilt) + rz * Math.cos(tilt);

    return {
      x: this.cx + sx * this.scale3D,
      y: this.cy - sy * this.scale3D,
      depth,
      inFront: true,
      scale: this.scale3D
    };
  }

  /**
   * Draw a 3D line segment with near-plane clipping in Real POV mode.
   */
  _drawLine3D(x1, y1, z1, x2, y2, z2, strokeStyle, lineWidth = 1, dash = []) {
    const ctx = this.ctx;
    if (!this.povFollowSensor) {
      const p1 = this._project(x1, y1, z1);
      const p2 = this._project(x2, y2, z2);
      ctx.save();
      if (dash && dash.length) ctx.setLineDash(dash);
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const NEAR = 0.08;
    const c1 = this._toCamSpace(x1, y1, z1);
    const c2 = this._toCamSpace(x2, y2, z2);

    if (c1.camZ < NEAR && c2.camZ < NEAR) return;

    let sx1 = c1.camX, sy1 = c1.camY, sz1 = c1.camZ;
    let sx2 = c2.camX, sy2 = c2.camY, sz2 = c2.camZ;

    if (sz1 < NEAR) {
      const t = (NEAR - sz1) / (sz2 - sz1);
      sx1 = sx1 + t * (sx2 - sx1);
      sy1 = sy1 + t * (sy2 - sy1);
      sz1 = NEAR;
    } else if (sz2 < NEAR) {
      const t = (NEAR - sz2) / (sz1 - sz2);
      sx2 = sx2 + t * (sx1 - sx2);
      sy2 = sy2 + t * (sy1 - sy2);
      sz2 = NEAR;
    }

    const p1 = this._camToScreen(sx1, sy1, sz1);
    const p2 = this._camToScreen(sx2, sy2, sz2);

    ctx.save();
    if (dash && dash.length) ctx.setLineDash(dash);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw a 3D circle with near-plane clipping in Real POV mode.
   */
  _drawCircle3D(r, y, strokeStyle, lineWidth = 1, dash = [], seg = 96) {
    for (let i = 0; i < seg; i++) {
      const a1 = (i / seg) * Math.PI * 2;
      const a2 = ((i + 1) / seg) * Math.PI * 2;
      this._drawLine3D(
        Math.sin(a1) * r, y, Math.cos(a1) * r,
        Math.sin(a2) * r, y, Math.cos(a2) * r,
        strokeStyle, lineWidth, dash
      );
    }
  }

  /**
   * Inverse-project a screen point back to the listener plane at elevation y = this.listenerMY.
   * Used for listener-drag interaction in Orbit mode.
   */
  _unprojectFloor(screenX, screenY) {
    const az   = (this.cameraAzimuth * Math.PI) / 180;
    const tilt = (this.cameraTilt   * Math.PI) / 180;
    const sinT = Math.sin(tilt);
    const cosT = Math.cos(tilt);
    if (Math.abs(sinT) < 0.01) return { x: 0, z: 0 };

    const my = this.listenerMY || 0;
    const sx = (screenX - this.cx) / this.scale3D;
    const sy = (this.cy - screenY) / this.scale3D;
    const rz = (sy - my * cosT) / sinT;

    return {
      x: sx * Math.cos(az) - rz * Math.sin(az),
      z: sx * Math.sin(az) + rz * Math.cos(az)
    };
  }

  // ─── Virtual Head Look (Phase 2) ──────────────────────────────────────────

  setVirtualHeadLookEnabled(enabled) {
    this.virtualHeadLookEnabled = !!enabled;
    if (!this.virtualHeadLookEnabled) {
      this.isDraggingVirtualLook = false;
    }
  }

  setVirtualOrientation(yaw, pitch, roll = 0) {
    this.yaw = yaw;
    this.pitch = pitch;
    this.roll = roll;
    if (this._onOrientationChange) {
      this._onOrientationChange(this.yaw, this.pitch, this.roll);
    }
  }

  // ─── Resize ──────────────────────────────────────────────────────────────────

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width  = rect.width  * this.dpr;
    this.canvas.height = rect.height * this.dpr;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.width  = rect.width;
    this.height = rect.height;
    // Current view of listener in the exact middle of the canvas
    this.cx     = this.width  / 2;
    this.cy     = this.height / 2;
    this.baseScale3D = Math.min(this.width, this.height) * 0.19;
    this.scale3D     = this.baseScale3D * (this.zoomLevel || 1.0);
    this.radius      = this.scale3D;  // legacy compat alias

    // Recompute speaker 3D positions
    if (this.speakers.length > 0) {
      this.speakers.forEach(s => { s.pos3D = this._speakerToVizCoords(s); });
    }
  }

  // ─── Pointer Events ──────────────────────────────────────────────────────────

  _setupPointerEvents() {
    this.canvas.addEventListener('pointerdown',  (e) => this._onDown(e));
    window.addEventListener('pointermove',       (e) => this._onMove(e));
    window.addEventListener('pointerup',         (e) => this._onUp(e));
    window.addEventListener('pointercancel',     (e) => this._onUp(e));
    this.canvas.addEventListener('contextmenu',  (e) => e.preventDefault());

    // Mouse wheel zoom on 3D plane (smooth zoom in/out)
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.08 : 0.92;
      this.zoom(factor);
    }, { passive: false });

    // Touch pinch-to-zoom support
    let touchDist = 0;
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        touchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    }, { passive: true });

    this.canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2) {
        const newDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (touchDist > 0) {
          const factor = newDist / touchDist;
          this.zoom(factor);
        }
        touchDist = newDist;
      }
    }, { passive: true });
  }

  _canvasPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  _headScreenPos() {
    return this._project(this.listenerMX, this.listenerMY || 0, this.listenerMZ);
  }

  // ─── Axis Gizmo & Hit-Testing Helpers ────────────────────────────────────────

  _distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lsq = dx * dx + dy * dy;
    if (lsq === 0) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lsq));
    const projX = x1 + t * dx;
    const projY = y1 + t * dy;
    return Math.hypot(px - projX, py - projY);
  }

  _getAxisVectors() {
    const my = this.listenerMY || 0;
    const hx = this.listenerMX;
    const hy = my;
    const hz = this.listenerMZ;

    const yawRad   = (this.yaw   * Math.PI) / 180;
    const pitchRad = (this.pitch * Math.PI) / 180;

    // 1. Forward Z axis (facing direction) — Blue (Z sensor)
    const fwdX =  Math.sin(yawRad) * Math.cos(pitchRad);
    const fwdY =  Math.sin(pitchRad);
    const fwdZ =  Math.cos(yawRad) * Math.cos(pitchRad);
    const LEN_Z = 1.35;

    // 2. Lateral Right X axis — Red (X sensor)
    const rightX =  Math.cos(yawRad);
    const rightY =  0;
    const rightZ = -Math.sin(yawRad);
    const LEN_X = 0.95;

    // 3. Vertical Up Y axis — Green (Y sensor height)
    const upX = -0.45 * Math.cos(yawRad) - Math.sin(yawRad) * Math.sin(pitchRad);
    const upY =  Math.cos(pitchRad);
    const upZ =  0.35 * Math.sin(yawRad) - Math.cos(yawRad) * Math.sin(pitchRad) * 0.4;
    const LEN_Y = 0.95;

    const headProj = this._project(hx, hy, hz);
    const tipXProj = this._project(hx + rightX * LEN_X, hy + rightY * LEN_X, hz + rightZ * LEN_X);
    const tipYProj = this._project(hx + upX * LEN_Y,    hy + upY * LEN_Y,    hz + upZ * LEN_Y);
    const tipZProj = this._project(hx + fwdX * LEN_Z,    hy + fwdY * LEN_Z,    hz + fwdZ * LEN_Z);

    return {
      head: headProj,
      angleZ: Math.atan2(tipZProj.y - headProj.y, tipZProj.x - headProj.x),
      X: {
        tip: tipXProj,
        dx: tipXProj.x - headProj.x,
        dy: tipXProj.y - headProj.y,
        lenWorld: LEN_X,
        worldFactor: Math.abs(rightX) > 0.08 ? rightX : (Math.sign(rightX) || 1)
      },
      Y: {
        tip: tipYProj,
        dx: tipYProj.x - headProj.x,
        dy: tipYProj.y - headProj.y,
        lenWorld: LEN_Y,
        worldFactor: Math.abs(upY) > 0.08 ? upY : 1
      },
      Z: {
        tip: tipZProj,
        dx: tipZProj.x - headProj.x,
        dy: tipZProj.y - headProj.y,
        lenWorld: LEN_Z,
        worldFactor: Math.abs(fwdZ) > 0.08 ? fwdZ : (Math.sign(fwdZ) || 1)
      }
    };
  }

  _hitTestAxes(pos) {
    const head = this._headScreenPos();
    const distToHead = Math.hypot(pos.x - head.x, pos.y - head.y);

    if (this.showAxes) {
      const axes = this._getAxisVectors();
      const distX = this._distToSegment(pos.x, pos.y, head.x, head.y, axes.X.tip.x, axes.X.tip.y);
      const distY = this._distToSegment(pos.x, pos.y, head.x, head.y, axes.Y.tip.x, axes.Y.tip.y);
      const distZ = this._distToSegment(pos.x, pos.y, head.x, head.y, axes.Z.tip.x, axes.Z.tip.y);

      const THRESH = 14;
      const candidates = [];
      if (distX <= THRESH) candidates.push({ axis: 'X', dist: distX, vec: axes.X });
      if (distY <= THRESH) candidates.push({ axis: 'Y', dist: distY, vec: axes.Y });
      if (distZ <= THRESH) candidates.push({ axis: 'Z', dist: distZ, vec: axes.Z });

      if (candidates.length > 0) {
        // If right in the core avatar body and not closer to arrow tip
        if (distToHead <= 11) {
          return { type: 'avatar', axis: 'all' };
        }
        candidates.sort((a, b) => a.dist - b.dist);
        return { type: 'axis', axis: candidates[0].axis, vec: candidates[0].vec };
      }
    }

    if (distToHead <= 24) {
      return { type: 'avatar', axis: 'all' };
    }

    return null;
  }

  _onDown(e) {
    const pos = this._canvasPos(e);

    // If in Real POV mode, drag on canvas looks around (yaw / pitch)
    if (this.povFollowSensor) {
      this.isDraggingPOVLook = true;
      this._povDragStart = {
        x: pos.x,
        y: pos.y,
        yaw: this.yaw,
        pitch: this.pitch
      };
      this.canvas.style.cursor = 'grabbing';
      try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }

    // Virtual Head Look (Phase 2): Right-click (button === 2) OR Alt+drag OR Shift+drag
    if (e.button === 2 || e.altKey || (this.virtualHeadLookEnabled && (e.shiftKey || e.button === 2))) {
      this.isDraggingVirtualLook = true;
      this._virtualLookDragStart = {
        x: pos.x,
        y: pos.y,
        yaw: this.yaw,
        pitch: this.pitch
      };
      this.canvas.style.cursor = 'crosshair';
      try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }

    const hit = this._hitTestAxes(pos);

    if (hit) {
      this.isDraggingHead = true;
      this.dragAxis = hit.axis;
      this._dragStartPos = { x: pos.x, y: pos.y };
      this._dragStartMX = this.listenerMX;
      this._dragStartMY = this.listenerMY || 0;
      this._dragStartMZ = this.listenerMZ;
      if (hit.vec) {
        this._dragAxisVec = {
          vx: hit.vec.dx,
          vy: hit.vec.dy,
          lenWorld: hit.vec.lenWorld,
          worldFactor: hit.vec.worldFactor
        };
      } else {
        this._dragAxisVec = null;
      }
      this.canvas.style.cursor = 'grabbing';
      try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
    } else {
      // Drag anywhere else: rotate camera
      this.isDraggingCamera = true;
      this._cameraDragStart = {
        x: pos.x, y: pos.y,
        az: this.cameraAzimuth, tilt: this.cameraTilt
      };
      this.canvas.style.cursor = 'all-scroll';
      try { this.canvas.setPointerCapture(e.pointerId); } catch (_) {}
    }
  }

  _onMove(e) {
    const pos = this._canvasPos(e);

    if (this.isDraggingPOVLook) {
      const dx = pos.x - this._povDragStart.x;
      const dy = pos.y - this._povDragStart.y;
      let nextYaw = (this._povDragStart.yaw + dx * 0.3) % 360;
      if (nextYaw > 180) nextYaw -= 360;
      if (nextYaw < -180) nextYaw += 360;
      let nextPitch = Math.max(-80, Math.min(80, this._povDragStart.pitch + dy * 0.25));
      this.yaw = nextYaw;
      this.pitch = nextPitch;
      if (this._onOrientationChange) {
        this._onOrientationChange(this.yaw, this.pitch, this.roll);
      }
      return;
    }

    if (this.isDraggingVirtualLook) {
      const dx = pos.x - this._virtualLookDragStart.x;
      const dy = pos.y - this._virtualLookDragStart.y;
      let nextYaw = (this._virtualLookDragStart.yaw + dx * 0.35) % 360;
      if (nextYaw > 180) nextYaw -= 360;
      if (nextYaw < -180) nextYaw += 360;
      let nextPitch = Math.max(-80, Math.min(80, this._virtualLookDragStart.pitch + dy * 0.25));
      this.yaw = nextYaw;
      this.pitch = nextPitch;
      if (this._onOrientationChange) {
        this._onOrientationChange(this.yaw, this.pitch, this.roll);
      }
      return;
    }

    if (this.povFollowSensor) {
      this.canvas.style.cursor = 'grab';
      return;
    }

    if (this.isDraggingHead) {
      if (this.dragAxis === 'all') {
        const fp = this._unprojectFloor(pos.x, pos.y);
        const R = this.roomRadius;
        const maxR = this.allowOutsideBoundary ? 10.0 : R;
        const dist = Math.hypot(fp.x, fp.z);
        let mx = fp.x, mz = fp.z;
        if (dist > maxR) { mx = (mx / dist) * maxR; mz = (mz / dist) * maxR; }
        this.listenerMX = mx;
        this.listenerMZ = mz;
        this.listenerX  = mx;
        this.listenerY  = mz;
        if (this._onListenerMove) this._onListenerMove(mx, this.listenerMY || 0, mz);
      } else if (this._dragAxisVec) {
        const dx = pos.x - this._dragStartPos.x;
        const dy = pos.y - this._dragStartPos.y;
        const { vx, vy, lenWorld, worldFactor } = this._dragAxisVec;
        const lsq = vx * vx + vy * vy;
        if (lsq > 0.001) {
          const frac = (dx * vx + dy * vy) / lsq;
          const deltaWorld = frac * lenWorld * (worldFactor || 1);
          const R = this.roomRadius;
          const maxBound = this.allowOutsideBoundary ? 10.0 : R;
          const R2 = R * R;

          if (this.dragAxis === 'X') {
            let nextMX = this._dragStartMX + deltaWorld;
            if (!this.allowOutsideBoundary) {
              const curZ = this._dragStartMZ;
              const maxAllowedX = Math.sqrt(Math.max(0, R2 - curZ * curZ));
              nextMX = Math.max(-maxAllowedX, Math.min(maxAllowedX, nextMX));
            } else {
              nextMX = Math.max(-maxBound, Math.min(maxBound, nextMX));
            }
            this.listenerMX = nextMX;
            this.listenerMY = this._dragStartMY;
            this.listenerMZ = this._dragStartMZ;
          } else if (this.dragAxis === 'Y') {
            this.listenerMY = Math.max(-1.5, Math.min(2.5, this._dragStartMY + deltaWorld));
            this.listenerMX = this._dragStartMX;
            this.listenerMZ = this._dragStartMZ;
          } else if (this.dragAxis === 'Z') {
            let nextMZ = this._dragStartMZ + deltaWorld;
            if (!this.allowOutsideBoundary) {
              const curX = this._dragStartMX;
              const maxAllowedZ = Math.sqrt(Math.max(0, R2 - curX * curX));
              nextMZ = Math.max(-maxAllowedZ, Math.min(maxAllowedZ, nextMZ));
            } else {
              nextMZ = Math.max(-maxBound, Math.min(maxBound, nextMZ));
            }
            this.listenerMZ = nextMZ;
            this.listenerMX = this._dragStartMX;
            this.listenerMY = this._dragStartMY;
          }
          this.listenerX = this.listenerMX;
          this.listenerY = this.listenerMZ;
          if (this._onListenerMove) {
            this._onListenerMove(this.listenerMX, this.listenerMY || 0, this.listenerMZ);
          }
        }
      }
    } else if (this.isDraggingCamera) {
      const dx = pos.x - this._cameraDragStart.x;
      const dy = pos.y - this._cameraDragStart.y;
      this.cameraAzimuth = this._cameraDragStart.az + dx * 0.5;
      this.cameraTilt    = Math.max(8, Math.min(82, this._cameraDragStart.tilt - dy * 0.4));
    } else {
      const hit = this._hitTestAxes(pos);
      this.hoverAxis = hit ? hit.axis : null;
      this.isHoveringHead = !!hit;
      if (this.hoverAxis) {
        this.canvas.style.cursor = 'grab';
      } else {
        this.canvas.style.cursor = 'default';
      }
    }
  }

  _onUp(e) {
    if (this.isDraggingPOVLook) {
      this.isDraggingPOVLook = false;
      this.canvas.style.cursor = this.povFollowSensor ? 'grab' : 'default';
      try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    if (this.isDraggingVirtualLook) {
      this.isDraggingVirtualLook = false;
      this.canvas.style.cursor = 'default';
      try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    if (this.isDraggingHead) {
      this.isDraggingHead = false;
      this.dragAxis = null;
      this._dragAxisVec = null;
      this.canvas.style.cursor = this.hoverAxis ? 'grab' : 'default';
      try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    if (this.isDraggingCamera) {
      this.isDraggingCamera = false;
      this.canvas.style.cursor = 'default';
      try { this.canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    }
  }

  // ─── Rendering ───────────────────────────────────────────────────────────────

  _render() {
    this.time += 0.016;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, this.width, this.height);
    const backdrop = ctx.createLinearGradient(0, 0, this.width, this.height);
    backdrop.addColorStop(0, this.colors.bgTop);
    backdrop.addColorStop(0.58, this.colors.bg);
    backdrop.addColorStop(1, this.colors.bg);
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, 0, this.width, this.height);

    const ambient = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, Math.max(this.width, this.height) * 0.66);
    ambient.addColorStop(0, this.colors.bgGlow);
    ambient.addColorStop(1, 'transparent');
    ctx.fillStyle = ambient;
    ctx.fillRect(0, 0, this.width, this.height);

    this._drawRoom();
    this._drawWaveformRing();
    this._drawSpeakers();
    this._drawHead();
    this._drawHUD();

    this.animationFrame = requestAnimationFrame(() => this._render());
  }

  // ─── Room Geometry ───────────────────────────────────────────────────────────

  _drawRoom() {
    const ctx = this.ctx;
    const ROOM_R = this.roomRadius;  // virtual room radius in meters (user-adjustable)
    const SEG = 80;                  // circle resolution

    if (!this.povFollowSensor) {
      // ── Orbit Mode Floor fill ──────────────────────────────────────────────────
      const floorPts = this._circlePoints(ROOM_R, 0, SEG);
      ctx.beginPath();
      ctx.moveTo(floorPts[0].x, floorPts[0].y);
      for (const p of floorPts) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      const floorGradient = ctx.createRadialGradient(this.cx, this.cy, 0, this.cx, this.cy, this.scale3D * ROOM_R * 1.25);
      floorGradient.addColorStop(0, this.colors.floor);
      floorGradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = floorGradient;
      ctx.fill();
      ctx.save();
      ctx.shadowColor = this.colors.speakerGlow;
      ctx.shadowBlur = 18;
      ctx.strokeStyle = this.colors.floorRim;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();

      // ── Concentric floor rings (distance reference at 25%, 50%, 75% of ROOM_R) ──
      for (const frac of [0.25, 0.5, 0.75]) {
        const r = ROOM_R * frac;
        const pts = this._circlePoints(r, 0, SEG);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (const p of pts) ctx.lineTo(p.x, p.y);
        ctx.closePath();
        ctx.strokeStyle = this.colors.floorGrid;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }

      // Radial bearings make the floor plane read as a measured listening volume.
      ctx.save();
      ctx.strokeStyle = this.colors.floorGrid;
      ctx.lineWidth = 0.7;
      ctx.setLineDash([2, 7]);
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const endX = Math.sin(angle) * ROOM_R;
        const endZ = Math.cos(angle) * ROOM_R;
        const start = this._project(0, 0, 0);
        const end = this._project(endX, 0, endZ);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.stroke();
      }
      ctx.restore();

      // ── Extended outer concentric rings (when moving outside boundary is allowed) ──
      if (this.allowOutsideBoundary) {
        ctx.save();
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = this.colors.floorGrid;
        ctx.lineWidth = 0.8;
        for (const frac of [1.5, 2.25, 3.0]) {
          const r = ROOM_R * frac;
          const pts = this._circlePoints(r, 0, SEG);
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (const p of pts) ctx.lineTo(p.x, p.y);
          ctx.closePath();
          ctx.stroke();
        }
        ctx.restore();
      }

      // ── Outer tether guide line if listener is outside room circle ──────────
      const listenerDist = Math.hypot(this.listenerMX, this.listenerMZ);
      if (listenerDist > ROOM_R * 1.01) {
        const centerPt = this._project(0, 0, 0);
        const floorPt  = this._project(this.listenerMX, 0, this.listenerMZ);
        ctx.save();
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = this.colors.dragRing || 'rgba(34, 211, 238, 0.4)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(centerPt.x, centerPt.y);
        ctx.lineTo(floorPt.x, floorPt.y);
        ctx.stroke();
        ctx.restore();
      }

      // ── Floor X/Z axis lines ────────────────────────────────────────────────────
      ctx.setLineDash([5, 7]);
      ctx.strokeStyle = this.colors.floorAxisLine;
      ctx.lineWidth = 1;
      for (const [fx, fz, tx, tz] of [
        [-ROOM_R, 0, ROOM_R, 0],
        [0, -ROOM_R, 0, ROOM_R]
      ]) {
        const a = this._project(fx, 0, fz);
        const b = this._project(tx, 0, tz);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.setLineDash([]);
    } else if (this.walkableSceneMode) {
      this._drawPOVRoom();
    } else {
      this._drawPOVSphere();
    }

    // ── Height layer ceiling ring (shown only when height speakers exist) ──────
    const hasHeight = !this.povFollowSensor && this.speakers.some(s => s.isHeight);
    if (hasHeight) {
      const effElRad = (45 * this.topSpeakerHeightScale * Math.PI) / 180;
      const heightDist = ROOM_R * 1.1; // ceiling ring slightly wider than floor
      const CEIL_R = heightDist * Math.cos(effElRad);
      const CEIL_Y = heightDist * Math.sin(effElRad);

      if (!this.povFollowSensor) {
        const ceilPts = this._circlePoints(CEIL_R, CEIL_Y, SEG);
        ctx.beginPath();
        ctx.moveTo(ceilPts[0].x, ceilPts[0].y);
        for (const p of ceilPts) ctx.lineTo(p.x, p.y);
        ctx.closePath();
        ctx.strokeStyle = this.colors.ceilRim;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        this._drawCircle3D(CEIL_R, CEIL_Y, this.colors.ceilRim, 1.4, [5, 5]);
      }

      // Vertical pillars at cardinal points connecting floor to ceiling ring
      for (const angle of [0, 90, 180, 270]) {
        const rad = (angle * Math.PI) / 180;
        const fx = Math.sin(rad) * ROOM_R * 0.78;
        const fz = Math.cos(rad) * ROOM_R * 0.78;
        const cx = fx * (CEIL_R / (ROOM_R * 0.78));
        const cz = fz * (CEIL_R / (ROOM_R * 0.78));
        this._drawLine3D(fx, 0, fz, cx, CEIL_Y, cz, this.colors.ceilRim, 1, [3, 5]);
      }

      // "HEIGHT LAYER" label near ceiling ring
      const labelPt = this._project(0, CEIL_Y + 0.18, -CEIL_R - 0.05);
      if (labelPt.inFront !== false) {
        ctx.fillStyle = this.colors.ceilRim;
        ctx.font = '500 8.5px "Inter", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('▲ HEIGHT LAYER', labelPt.x, labelPt.y);
      }
    }

    // ── Compass labels on floor rim ────────────────────────────────────────────
    if (!this.povFollowSensor) {
      const compassItems = [
        { label: 'FRONT', x: 0,                z: ROOM_R + 0.28 },
        { label: 'BACK',  x: 0,                z: -(ROOM_R + 0.28) },
        { label: 'LEFT',  x: -(ROOM_R + 0.26), z: 0 },
        { label: 'RIGHT', x: ROOM_R + 0.26,    z: 0 },
      ];
      ctx.font = '600 10px "Inter", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = this.colors.compassText;
      for (const c of compassItems) {
        const p = this._project(c.x, 0, c.z);
        if (p.inFront !== false) {
          ctx.fillText(c.label, p.x, p.y);
        }
      }
    }
  }

  _drawPOVSphere() {
    const radius = this.roomRadius * 1.18;
    const latitudes = [-60, -30, 0, 30, 60];
    const longitudes = Array.from({ length: 6 }, (_, i) => i * 60);
    const drawCurve = (points) => {
      const ctx = this.ctx;
      ctx.beginPath();
      let drawing = false;
      for (const [x, y, z] of points) {
        const projected = this._project(x, y, z);
        if (projected.inFront === false) {
          drawing = false;
          continue;
        }
        if (drawing) {
          ctx.lineTo(projected.x, projected.y);
        } else {
          ctx.moveTo(projected.x, projected.y);
          drawing = true;
        }
      }
      ctx.strokeStyle = this.colors.roomEdge;
      ctx.lineWidth = 0.8;
      ctx.setLineDash([3, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    for (const latitude of latitudes) {
      const lat = latitude * Math.PI / 180;
      const points = [];
      for (let i = 0; i <= 36; i++) {
        const angle = i * Math.PI * 2 / 36;
        points.push([
          radius * Math.cos(lat) * Math.sin(angle),
          radius * Math.sin(lat),
          radius * Math.cos(lat) * Math.cos(angle)
        ]);
      }
      drawCurve(points);
    }

    for (const longitude of longitudes) {
      const lon = longitude * Math.PI / 180;
      const points = [];
      for (let i = 0; i <= 36; i++) {
        const latitude = -Math.PI / 2 + i * Math.PI / 36;
        points.push([
          radius * Math.cos(latitude) * Math.sin(lon),
          radius * Math.sin(latitude),
          radius * Math.cos(latitude) * Math.cos(lon)
        ]);
      }
      drawCurve(points);
    }
  }

  _getCinemaSpeakerLayout() {
    if (this._cinemaSpeakerLayout) return this._cinemaSpeakerLayout;

    const speakers = [];
    const add = (name, group, x, y, cinemaZ) => {
      speakers.push({
        name,
        group,
        x,
        y,
        z: -cinemaZ,
        downTiltDegrees: group === 'side' ? 18 : 0,
        inwardDirection: x < 0 ? 1 : -1
      });
    };

    [
      ['L', -5.5], ['LC', -2.75], ['C', 0], ['RC', 2.75], ['R', 5.5]
    ].forEach(([name, x]) => add(name, 'screen', x, 3.5, 0.2));
    add('Screen sub L', 'sub', -1.8, 0.3, 0.2);
    add('Screen sub R', 'sub', 1.8, 0.3, 0.2);

    for (let index = 0; index < 10; index++) {
      const cinemaZ = 5 + index * 1.6;
      const y = 3.2 + (3.3 * index) / 9;
      add(`Side L ${String(index + 1).padStart(2, '0')}`, 'side', -6.9, y, cinemaZ);
      add(`Side R ${String(index + 1).padStart(2, '0')}`, 'side', 6.9, y, cinemaZ);
    }

    [-6, -4.5, -3, -1.5, 1.5, 3, 4.5, 6].forEach((x, index) => {
      add(`Rear ${String(index + 1).padStart(2, '0')}`, 'rear', x, 6.2, 21.9);
    });
    // Add a center rear fill to reach the requested 64-speaker total.
    add('Rear center', 'rear', 0, 6.2, 21.9);

    for (let index = 0; index < 10; index++) {
      const cinemaZ = 4 + (16 * index) / 9;
      add(`Top L ${String(index + 1).padStart(2, '0')}`, 'overhead', -3, 7.7, cinemaZ);
      add(`Top R ${String(index + 1).padStart(2, '0')}`, 'overhead', 3, 7.7, cinemaZ);
    }

    [-4.5, -1.5, 1.5, 4.5].forEach((x, index) => {
      add(`Stage sub ${index + 1}`, 'sub', x, 0, 0.2);
    });
    [-1, 1].forEach((side) => {
      [10, 18].forEach((cinemaZ) => {
        add(`Surround sub ${side < 0 ? 'L' : 'R'} ${cinemaZ}`, 'sub', side * 6.8, 6.4, cinemaZ);
      });
    });

    if (speakers.length !== 64) {
      throw new Error(`Cinema speaker layout must contain 64 speakers; got ${speakers.length}.`);
    }
    this._cinemaSpeakerLayout = speakers;
    return speakers;
  }

  _getCinemaRoomGeometry() {
    if (this._cinemaRoomGeometry) return this._cinemaRoomGeometry;

    const polygons = [];
    const lines = [];
    const treads = [];
    const aisles = [];
    const line = (collection, x1, y1, z1, x2, y2, z2) => {
      collection.push([[x1, y1, z1], [x2, y2, z2]]);
    };
    const quad = (collection, x1, y1, z1, x2, y2, z2, x3, y3, z3, x4, y4, z4, style) => {
      collection.push({ points: [[x1, y1, z1], [x2, y2, z2], [x3, y3, z3], [x4, y4, z4]], style });
    };

    quad(polygons, -7, 0, 0, 7, 0, 0, 7, 0, -24, -7, 0, -24, 'floor');
    quad(polygons, -7, 8, 0, 7, 8, 0, 7, 8, -24, -7, 8, -24, 'ceiling');
    quad(polygons, -7, 0, 0, -7, 8, 0, -7, 8, -24, -7, 0, -24, 'wall');
    quad(polygons, 7, 0, 0, 7, 0, -24, 7, 8, -24, 7, 8, 0, 'wall');
    quad(polygons, -7, 0, -24, -7, 8, -24, 7, 8, -24, 7, 0, -24, 'wall');
    quad(polygons, -7, 0, -3, 7, 0, -3, 7, 0.6, -3, -7, 0.6, -3, 'stage');
    quad(polygons, -7, 0.6, 0, 7, 0.6, 0, 7, 0.6, -3, -7, 0.6, -3, 'stage');

    const screenZ = -0.5;
    quad(polygons, -6.4, 1, screenZ, 6.4, 1, screenZ, 6.4, 7, screenZ, -6.4, 7, screenZ, 'screen-frame');
    const imageHeight = 12.8 / 2.39;
    quad(
      polygons,
      -6.4, 4 - imageHeight / 2, screenZ - 0.015,
      6.4, 4 - imageHeight / 2, screenZ - 0.015,
      6.4, 4 + imageHeight / 2, screenZ - 0.015,
      -6.4, 4 + imageHeight / 2, screenZ - 0.015,
      'screen'
    );

    quad(polygons, -7, 4.5, -22, 7, 4.5, -22, 7, 4.5, -24, -7, 4.5, -24, 'booth');
    quad(polygons, -7, 4.5, -24, -7, 7.5, -24, 7, 7.5, -24, 7, 4.5, -24, 'booth');
    quad(polygons, -7, 4.5, -22, -7, 7.5, -22, -7, 7.5, -24, -7, 4.5, -24, 'booth');
    quad(polygons, 7, 4.5, -22, 7, 4.5, -24, 7, 7.5, -24, 7, 7.5, -22, 'booth');
    quad(polygons, -1.2, 5, -22.01, 1.2, 5, -22.01, 1.2, 6, -22.01, -1.2, 6, -22.01, 'booth-window');

    for (let depth = 2; depth < 24; depth += 2) {
      line(lines, -7, 0.015, -depth, 7, 0.015, -depth);
    }
    for (let x = -6; x <= 6; x += 2) {
      line(lines, x, 0.015, 0, x, 0.015, -24);
    }
    for (const x of [-7, 7]) {
      line(lines, x, 0, 0, x, 8, 0);
      line(lines, x, 8, 0, x, 8, -24);
      line(lines, x, 0, -24, x, 8, -24);
    }

    const seatBanks = [[-6.5, -4.8], [-4.2, 4.2], [4.8, 6.5]];
    for (let row = 0; row < 14; row++) {
      const depth = 6 + row * 1.1;
      const z = -depth;
      const rearZ = z - 1.1;
      const floorY = (row + 1) * 0.35;
      const previousY = row * 0.35;
      for (const [left, right] of seatBanks) {
        quad(treads, left, floorY, z, right, floorY, z, right, floorY, rearZ, left, floorY, rearZ, 'tread');
        line(lines, left, previousY, z, right, previousY, z);
        line(lines, left, previousY, z, left, floorY, z);
        line(lines, right, previousY, z, right, floorY, z);
        line(lines, left, floorY + 0.94, rearZ + 0.18, right, floorY + 0.94, rearZ + 0.18);
        for (let seatX = left + 0.32; seatX < right - 0.2; seatX += 0.58) {
          line(lines, seatX, floorY + 0.43, rearZ + 0.18, seatX, floorY + 0.94, rearZ + 0.18);
        }
      }

      for (const aisleX of [-4.5, 4.5]) {
        quad(
          aisles,
          aisleX - 0.3, floorY, z, aisleX + 0.3, floorY, z,
          aisleX + 0.3, floorY, rearZ, aisleX - 0.3, floorY, rearZ,
          'aisle'
        );
      }
    }

    const polygonGroups = new Map();
    for (const polygon of polygons) {
      if (!polygonGroups.has(polygon.style)) polygonGroups.set(polygon.style, []);
      polygonGroups.get(polygon.style).push(polygon);
    }

    this._cinemaRoomGeometry = { polygonGroups, lines, treads, aisles };
    return this._cinemaRoomGeometry;
  }

  _drawCinemaRoom() {
    const ctx = this.ctx;
    const geometry = this._getCinemaRoomGeometry();
    const dark = this.theme === 'dark';
    const polygonStyles = {
      floor: dark ? 'rgba(17, 23, 35, 0.92)' : 'rgba(45, 54, 68, 0.88)',
      wall: dark ? 'rgba(22, 29, 43, 0.38)' : 'rgba(70, 78, 91, 0.2)',
      ceiling: dark ? 'rgba(8, 12, 21, 0.14)' : 'rgba(45, 53, 65, 0.08)',
      stage: dark ? 'rgba(45, 53, 70, 0.92)' : 'rgba(75, 79, 87, 0.9)',
      'screen-frame': dark ? '#111827' : '#263344',
      screen: dark ? 'rgba(105, 173, 215, 0.62)' : 'rgba(121, 183, 218, 0.72)',
      booth: dark ? 'rgba(13, 19, 30, 0.96)' : 'rgba(42, 48, 59, 0.92)',
      'booth-window': dark ? 'rgba(100, 177, 220, 0.7)' : 'rgba(133, 198, 229, 0.72)',
      tread: dark ? 'rgba(87, 46, 60, 0.8)' : 'rgba(111, 63, 72, 0.72)',
      aisle: dark ? 'rgba(71, 77, 89, 0.78)' : 'rgba(115, 119, 124, 0.72)'
    };

    const projectClippedPolygon = (points) => {
      const near = 0.08;
      const cameraPoints = points.map(([x, y, z]) => this._toCamSpace(x, y, z));
      const clipped = [];
      for (let index = 0; index < cameraPoints.length; index++) {
        const current = cameraPoints[index];
        const next = cameraPoints[(index + 1) % cameraPoints.length];
        const currentInside = current.camZ >= near;
        const nextInside = next.camZ >= near;
        if (currentInside) clipped.push(current);
        if (currentInside !== nextInside) {
          const fraction = (near - current.camZ) / (next.camZ - current.camZ);
          clipped.push({
            camX: current.camX + (next.camX - current.camX) * fraction,
            camY: current.camY + (next.camY - current.camY) * fraction,
            camZ: near
          });
        }
      }
      return clipped.map(point => this._camToScreen(point.camX, point.camY, point.camZ));
    };

    const fillPolygons = (polygons) => {
      if (polygons.length === 0) return;
      ctx.beginPath();
      let hasVisiblePolygon = false;
      for (const polygon of polygons) {
        const projected = projectClippedPolygon(polygon.points);
        if (projected.length < 3) continue;
        ctx.moveTo(projected[0].x, projected[0].y);
        for (let index = 1; index < projected.length; index++) {
          ctx.lineTo(projected[index].x, projected[index].y);
        }
        ctx.closePath();
        hasVisiblePolygon = true;
      }
      if (!hasVisiblePolygon) return;
      ctx.fillStyle = polygonStyles[polygons[0].style];
      ctx.fill();
    };

    const strokeWorldLines = (segments, color, width) => {
      ctx.beginPath();
      for (const [start, end] of segments) {
        let a = this._toCamSpace(start[0], start[1], start[2]);
        let b = this._toCamSpace(end[0], end[1], end[2]);
        if (a.camZ < 0.08 && b.camZ < 0.08) continue;
        if (a.camZ < 0.08 || b.camZ < 0.08) {
          const fraction = (0.08 - a.camZ) / (b.camZ - a.camZ);
          const intersection = {
            camX: a.camX + (b.camX - a.camX) * fraction,
            camY: a.camY + (b.camY - a.camY) * fraction,
            camZ: 0.08
          };
          if (a.camZ < 0.08) a = intersection;
          else b = intersection;
        }
        const screenA = this._camToScreen(a.camX, a.camY, a.camZ);
        const screenB = this._camToScreen(b.camX, b.camY, b.camZ);
        ctx.moveTo(screenA.x, screenA.y);
        ctx.lineTo(screenB.x, screenB.y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.stroke();
    };

    for (const polygons of geometry.polygonGroups.values()) fillPolygons(polygons);
    fillPolygons(geometry.treads);
    fillPolygons(geometry.aisles);
    strokeWorldLines(geometry.lines, dark ? 'rgba(186, 139, 151, 0.56)' : 'rgba(83, 45, 51, 0.6)', 1);
    this._drawCinemaSpeakerArray();
  }

  _drawCinemaSpeakerArray() {
    const ctx = this.ctx;
    const colors = {
      screen: '#ffd08a',
      side: '#f07491',
      rear: '#8faeff',
      overhead: '#c19aff',
      sub: '#59d5dc'
    };
    const paths = {
      screen: [],
      side: [],
      rear: [],
      overhead: [],
      sub: []
    };
    const sideAimLines = [];

    for (const speaker of this._getCinemaSpeakerLayout()) {
      const projected = this._project(speaker.x, speaker.y, speaker.z);
      if (projected.inFront === false) continue;
      const size = Math.max(2, Math.min(9, projected.scale * 0.045));
      if (speaker.group === 'side') {
        const aimDistance = 0.42;
        const aimY = Math.tan((speaker.downTiltDegrees * Math.PI) / 180) * aimDistance;
        const aim = this._project(
          speaker.x + speaker.inwardDirection * aimDistance,
          speaker.y - aimY,
          speaker.z
        );
        if (aim.inFront !== false) {
          sideAimLines.push([projected.x, projected.y, aim.x, aim.y]);
        }
      }
      const path = paths[speaker.group];
      if (speaker.group === 'overhead') {
        path.push({ shape: 'diamond', x: projected.x, y: projected.y, size });
      } else if (speaker.group === 'sub') {
        path.push({ shape: 'circle', x: projected.x, y: projected.y, size: size * 0.72 });
      } else {
        path.push({ shape: 'square', x: projected.x, y: projected.y, size });
      }
    }

    for (const [group, icons] of Object.entries(paths)) {
      ctx.beginPath();
      for (const icon of icons) {
        if (icon.shape === 'circle') {
          ctx.moveTo(icon.x + icon.size, icon.y);
          ctx.arc(icon.x, icon.y, icon.size, 0, Math.PI * 2);
        } else if (icon.shape === 'diamond') {
          ctx.moveTo(icon.x, icon.y - icon.size);
          ctx.lineTo(icon.x + icon.size, icon.y);
          ctx.lineTo(icon.x, icon.y + icon.size);
          ctx.lineTo(icon.x - icon.size, icon.y);
          ctx.closePath();
        } else {
          ctx.rect(icon.x - icon.size, icon.y - icon.size, icon.size * 2, icon.size * 2);
        }
      }
      ctx.fillStyle = colors[group];
      ctx.fill();
      ctx.strokeStyle = 'rgba(9, 15, 25, 0.9)';
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }

    ctx.beginPath();
    for (const [x1, y1, x2, y2] of sideAimLines) {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    }
    ctx.strokeStyle = colors.side;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  _drawPOVRoom() {
    if (this._isCinemaScene()) {
      this._drawCinemaRoom();
      return;
    }

    const ctx = this.ctx;
    const scene = this.scenes[this.scene];
    const { halfWidth, halfDepth, floorY, ceilingY } = this._sceneGeometry();
    const gridStep = this.scene === 'concert' ? 2 : 1;
    const warm = this.theme === 'dark' ? 'rgba(255, 184, 105, 0.2)' : 'rgba(194, 99, 28, 0.2)';
    const accent = this.theme === 'dark' ? '#75dfff' : '#187da8';

    const polygon = (points, fill, stroke = null, lineWidth = 1) => {
      const projected = points.map(([x, y, z]) => this._project(x, y, z));
      if (projected.some(point => point.inFront === false)) return;
      ctx.beginPath();
      ctx.moveTo(projected[0].x, projected[0].y);
      for (let i = 1; i < projected.length; i++) ctx.lineTo(projected[i].x, projected[i].y);
      ctx.closePath();
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fill();
      }
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      }
    };
    const panel = (x1, x2, y1, y2, z, fill, stroke = null) => {
      polygon([[x1, y1, z], [x2, y1, z], [x2, y2, z], [x1, y2, z]], fill, stroke);
    };
    const line = (x1, y1, z1, x2, y2, z2, color, width = 1, dash = []) => {
      this._drawLine3D(x1, y1, z1, x2, y2, z2, color, width, dash);
    };
    const frontZ = halfDepth - 0.08;
    const backZ = -halfDepth + 0.08;

    ctx.save();
    const roomFloor = [
      [-halfWidth, floorY, backZ], [halfWidth, floorY, backZ],
      [halfWidth, floorY, frontZ], [-halfWidth, floorY, frontZ]
    ];
    polygon(roomFloor, this.colors.roomFloor);
    if (this.scene === 'living-room') {
      polygon([[-1.55, floorY + 0.01, -1.5], [1.55, floorY + 0.01, -1.5], [1.55, floorY + 0.01, 1.5], [-1.55, floorY + 0.01, 1.5]],
        this.theme === 'dark' ? 'rgba(102, 72, 130, 0.16)' : 'rgba(113, 85, 153, 0.13)', this.colors.roomGrid);
    }

    if (!scene.open) {
      panel(-halfWidth, halfWidth, floorY, ceilingY, frontZ, this.colors.roomWall);
      panel(-halfWidth, halfWidth, floorY, ceilingY, backZ, this.colors.roomWall);
      for (const x of [-halfWidth, halfWidth]) {
        polygon([[x, floorY, backZ], [x, floorY, frontZ], [x, ceilingY, frontZ], [x, ceilingY, backZ]], this.colors.roomWall);
        line(x, floorY, backZ, x, ceilingY, backZ, this.colors.roomEdge, 1);
        line(x, floorY, frontZ, x, ceilingY, frontZ, this.colors.roomEdge, 1);
        line(x, ceilingY, backZ, x, ceilingY, frontZ, this.colors.roomEdge, 1);
      }
      line(-halfWidth, ceilingY, frontZ, halfWidth, ceilingY, frontZ, this.colors.roomEdge, 1);
      line(-halfWidth, ceilingY, backZ, halfWidth, ceilingY, backZ, this.colors.roomEdge, 1);
    } else {
      const sky = ctx.createLinearGradient(0, 0, 0, this.cy);
      sky.addColorStop(0, this.theme === 'dark' ? 'rgba(41, 52, 105, 0.55)' : 'rgba(82, 142, 199, 0.24)');
      sky.addColorStop(1, 'transparent');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, this.width, this.height * 0.62);
    }

    for (let z = -halfDepth + gridStep; z < halfDepth; z += gridStep) {
      line(-halfWidth, floorY, z, halfWidth, floorY, z, this.colors.roomGrid, Math.abs(z % 2) < 0.01 ? 1 : 0.65);
    }
    for (let x = -halfWidth; x <= halfWidth + 0.01; x += gridStep) {
      line(x, floorY, backZ, x, floorY, frontZ, this.colors.roomGrid, 0.7);
    }
    line(-halfWidth, floorY, frontZ, halfWidth, floorY, frontZ, this.colors.roomEdge, 1);
    line(-halfWidth, floorY, backZ, halfWidth, floorY, backZ, this.colors.roomEdge, 1);

    if (this.scene === 'living-room') {
      const wallZ = frontZ - 0.02;
      panel(-1.25, 1.25, 0.62, 2.08, wallZ, this.theme === 'dark' ? '#111827' : '#243247', accent);
      panel(-1.14, 1.14, 0.73, 1.97, wallZ - 0.02,
        this.theme === 'dark' ? 'rgba(20, 52, 77, 0.88)' : 'rgba(42, 102, 133, 0.82)', 'rgba(255,255,255,0.16)');
      panel(-1.65, 1.65, -0.72, -0.42, -2.45, this.theme === 'dark' ? '#30241f' : '#76533a');
      panel(-1.78, 1.78, -0.82, -0.7, -2.45, warm);
      for (const side of [-1, 1]) {
        panel(side * 2.15, side * 2.48, 0.15, 2.1, -0.05, this.theme === 'dark' ? 'rgba(160, 111, 70, 0.18)' : 'rgba(153, 96, 49, 0.15)');
        line(side * 2.12, -0.4, backZ + 0.1, side * 2.12, 1.65, backZ + 0.1, warm, 2);
      }
    } else if (this.scene === 'cinema') {
      const wallZ = frontZ - 0.02;
      panel(-3.6, 3.6, 1.0, 4.25, wallZ, this.theme === 'dark' ? '#090b14' : '#172333', accent);
      panel(-3.25, 3.25, 1.28, 3.98, wallZ - 0.02, this.theme === 'dark' ? 'rgba(25, 45, 64, 0.96)' : 'rgba(35, 71, 98, 0.94)', 'rgba(195, 224, 255, 0.18)');
      for (const side of [-1, 1]) {
        for (let z = -halfDepth + 2; z < halfDepth; z += 2.5) {
          line(side * (halfWidth - 0.2), 0.25, z, side * (halfWidth - 0.2), 2.6, z, this.colors.roomEdge, 1);
        }
        line(side * (halfWidth - 0.4), 1.1, backZ + 0.5, side * (halfWidth - 0.4), 1.1, frontZ - 0.4, warm, 1.4);
      }
      for (let z = -halfDepth + 2; z < halfDepth; z += 2) {
        line(-halfWidth + 1, ceilingY - 0.25, z, halfWidth - 1, ceilingY - 0.25, z, this.colors.roomGrid, 1);
      }
      for (const side of [-1, 1]) {
        for (let z = -halfDepth + 2.5; z < halfDepth - 1; z += 2) {
          polygon([
            [side * 2.2, -0.95, z], [side * 3.1, -0.95, z],
            [side * 3.1, -0.58, z + 0.65], [side * 2.2, -0.58, z + 0.65]
          ], this.theme === 'dark' ? 'rgba(104, 37, 61, 0.45)' : 'rgba(104, 37, 61, 0.32)', this.colors.roomEdge);
        }
      }
    } else if (this.scene === 'concert') {
      const stageZ = frontZ - 0.15;
      panel(-5.4, 5.4, 0.1, 4.5, stageZ, this.theme === 'dark' ? 'rgba(17, 19, 42, 0.96)' : 'rgba(29, 43, 72, 0.92)', accent);
      for (const x of [-5.8, -3.9, 0, 3.9, 5.8]) {
        line(x, 0.05, stageZ, x, 7, stageZ, accent, 1.4);
      }
      line(-5.8, 6.9, stageZ, 5.8, 6.9, stageZ, accent, 2);
      line(-5.8, 5.9, stageZ, 5.8, 5.9, stageZ, warm, 1.2);
      for (const side of [-1, 1]) {
        const beam = this.theme === 'dark' ? 'rgba(101, 225, 255, 0.12)' : 'rgba(17, 137, 188, 0.12)';
        polygon([[side * 4.2, 5.9, stageZ], [side * 0.8, 0.2, stageZ - 0.2], [side * 2.2, 0.2, stageZ - 0.2]], beam);
      }
      for (let x = -4.8; x <= 4.8; x += 1.6) {
        line(x, 0.2, stageZ - 0.08, x, 4.8, stageZ - 0.08, this.colors.roomGrid, 0.8);
      }
    } else {
      const wallZ = frontZ - 0.02;
      for (const x of [-1.8, -0.9, 0, 0.9, 1.8]) {
        panel(x - 0.34, x + 0.34, 0.15, 2.2, wallZ, this.theme === 'dark' ? 'rgba(71, 82, 109, 0.23)' : 'rgba(58, 82, 122, 0.17)');
      }
      panel(-1.9, 1.9, -0.78, -0.56, -2.4, this.theme === 'dark' ? '#202a3d' : '#65758b');
      for (const side of [-1, 1]) {
        panel(side * 1.15 - 0.18, side * 1.15 + 0.18, 0.1, 1.75, 0, this.theme === 'dark' ? '#121a26' : '#34485f', accent);
        panel(side * 1.15 - 0.09, side * 1.15 + 0.09, 0.45, 1.52, -0.02, this.theme === 'dark' ? '#1a2737' : '#526c87', 'rgba(255,255,255,0.25)');
      }
    }
    ctx.restore();
  }

  /** Utility: compute projected screen points for a circle at given y (floor height) */
  _circlePoints(r, y, seg) {
    const pts = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      pts.push(this._project(Math.sin(a) * r, y, Math.cos(a) * r));
    }
    return pts;
  }

  // ─── Frequency Waveform Ring ─────────────────────────────────────────────────

  _drawWaveformRing() {
    if (this.walkableSceneMode || !this.analyserData || this.analyserData.length === 0) return;
    const ctx = this.ctx;
    const bins  = this.analyserData.length;
    const baseR = this.roomRadius * 1.04; // waveform ring hugs just outside room rim

    if (!this.povFollowSensor) {
      ctx.beginPath();
      let first = true;
      for (let i = 0; i <= bins; i++) {
        const angle = (i / bins) * Math.PI * 2;
        const amp   = this.analyserData[i % bins] / 255;
        const r     = baseR + amp * 0.28;
        const p     = this._project(Math.sin(angle) * r, amp * 0.12, Math.cos(angle) * r);
        if (first) { ctx.moveTo(p.x, p.y); first = false; }
        else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.strokeStyle = this.colors.waveform;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      const step = Math.max(1, Math.floor(bins / 48));
      for (let i = 0; i < bins; i += step) {
        const a1 = (i / bins) * Math.PI * 2;
        const a2 = ((i + step) / bins) * Math.PI * 2;
        const amp1 = this.analyserData[i % bins] / 255;
        const amp2 = this.analyserData[(i + step) % bins] / 255;
        const r1 = baseR + amp1 * 0.28;
        const r2 = baseR + amp2 * 0.28;
        this._drawLine3D(
          Math.sin(a1) * r1, amp1 * 0.12, Math.cos(a1) * r1,
          Math.sin(a2) * r2, amp2 * 0.12, Math.cos(a2) * r2,
          this.colors.waveform, 1.5
        );
      }
    }
  }

  // ─── Speaker Rendering (3D depth-sorted) ─────────────────────────────────────

  _drawSpeakers() {
    if (this.walkableSceneMode && this._isCinemaScene()) {
      this.activeGazeSpeaker = null;
      return;
    }
    if (!this.speakers.length) return;
    const ctx = this.ctx;

    // Project all speakers and depth-sort (back-to-front)
    const renderList = this.speakers.map((sp, i) => {
      const position = this.walkableSceneMode ? this._sceneSpeakerPosition(sp) : sp.pos3D;
      const proj = this._project(position.x, position.y, position.z);
      sp.sx = proj.x;
      sp.sy = proj.y;
      return { sp, position, proj, level: this.channelLevels[i] || 0 };
    })
    .filter(item => item.proj.inFront !== false)
    .sort((a, b) => b.proj.depth - a.proj.depth);

    const hasSolo = (this.soloedChannels && this.soloedChannels.size > 0);

    for (const { sp, position, proj, level } of renderList) {
      const isLFE      = sp.isLFE || sp.name === 'LFE';
      const isHeight   = !!sp.isHeight;
      const isBottom   = !!sp.isBottom;
      const isObject   = !!sp.isObject;
      const isVirtual  = !!sp.isVirtual;
      const isSoloed   = hasSolo && this.soloedChannels.has(sp.index);
      const isMutedBySolo = hasSolo && !isSoloed;
      const pulse      = Math.sin(this.time * 3 + sp.index) * 0.5 + 0.5;

      ctx.save();
      if (isMutedBySolo) {
        ctx.globalAlpha = 0.28;
      }

      // In Real POV mode, scale speaker icon dynamically based on distance to eyes
      let scaleMult = 1.0;
      if (this.povFollowSensor) {
        scaleMult = Math.max(0.6, Math.min(3.2, 2.2 / Math.max(0.2, proj.depth)));
      }
      if (isSoloed) {
        scaleMult *= 1.25;
      }

      // ── Height speaker: draw vertical stem from floor shadow up to speaker ───
      if (isHeight) {
        const floorProj = this._project(position.x, 0, position.z);
        if (floorProj.inFront !== false) {
          // Floor shadow dot
          ctx.beginPath();
          ctx.arc(floorProj.x, floorProj.y, Math.max(2, 3 * scaleMult), 0, Math.PI * 2);
          ctx.fillStyle = this.colors.floorShadow;
          ctx.fill();
        }

        // Stem connecting floor to elevated speaker
        const stemColor = level > 0.05 ? this.colors.stemActive : this.colors.stem;
        this._drawLine3D(
          position.x, 0, position.z,
          position.x, position.y, position.z,
          stemColor, level > 0.05 ? 2 : 1.5, [4, 3]
        );
      } else if (isBottom) {
        // ── Bottom / Floor speaker (e.g. 22.2 layout): draw vertical stem down from floor ───
        const floorProj = this._project(position.x, 0, position.z);
        if (floorProj.inFront !== false) {
          ctx.beginPath();
          ctx.arc(floorProj.x, floorProj.y, Math.max(2, 2.5 * scaleMult), 0, Math.PI * 2);
          ctx.fillStyle = this.colors.bottomSpeakerGlow || 'rgba(6, 182, 212, 0.4)';
          ctx.fill();
        }

        const stemColor = level > 0.05 ? (this.colors.bottomSpeakerGlow || 'rgba(6, 182, 212, 0.8)') : (this.colors.stem || 'rgba(6, 182, 212, 0.35)');
        this._drawLine3D(
          position.x, 0, position.z,
          position.x, position.y, position.z,
          stemColor, level > 0.05 ? 2 : 1.5, [2, 3]
        );
      } else if (isObject && Math.abs(position.y) > 0.1) {
        // ── Dynamic 3D Object with elevation: draw connecting guideline ───
        this._drawLine3D(
          position.x, 0, position.z,
          position.x, position.y, position.z,
          this.colors.objectSpeakerGlow || 'rgba(244, 63, 94, 0.4)',
          1, [2, 4]
        );
      }

      // ── Glow halo ──────────────────────────────────────────────────────────────
      const baseSize = isLFE ? 7 : (isHeight || isBottom || isObject) ? 5.5 : 5.5;
      const size     = baseSize * scaleMult;
      const glowSize = size + (10 + level * 15 + pulse * 2.5) * scaleMult;

      const glowColor = isSoloed   ? 'rgba(0, 240, 255, 0.85)'
                      : isObject   ? (level > 0.08 ? this.colors.objectSpeakerGlow : 'rgba(244, 63, 94, 0.35)')
                      : isBottom   ? (level > 0.08 ? this.colors.bottomSpeakerGlow : 'rgba(6, 182, 212, 0.35)')
                      : isVirtual  ? (level > 0.08 ? this.colors.virtualSpeakerGlow : 'rgba(56, 189, 248, 0.35)')
                      : isLFE      ? this.colors.subwooferGlow
                      : isHeight   ? (level > 0.08 ? this.colors.heightSpeakerGlow : this.colors.stem)
                      :              (level > 0.08 ? this.colors.speakerActiveGlow : this.colors.speakerGlow);
      const grad = ctx.createRadialGradient(proj.x, proj.y, 0, proj.x, proj.y, glowSize * (isSoloed ? 1.5 : 1));
      grad.addColorStop(0, glowColor);
      grad.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, glowSize * (isSoloed ? 1.5 : 1), 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      if (this.povFollowSensor && level > 0.04) {
        const wavePhase = (this.time * 1.1 + sp.index * 0.37) % 1;
        const waveRadius = size * (1.7 + wavePhase * 2.8);
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, waveRadius, 0, Math.PI * 2);
        ctx.strokeStyle = glowColor;
        ctx.globalAlpha *= (1 - wavePhase) * Math.min(0.8, level + 0.25);
        ctx.lineWidth = Math.max(0.7, 1.4 * scaleMult);
        ctx.stroke();
        ctx.globalAlpha = isMutedBySolo ? 0.28 : 1;
      }

      // ── Solo Calibration Target HUD Ring ───────────────────────────────────────
      if (isSoloed) {
        const targetRadius = size * 2.2 + Math.sin(this.time * 6) * 3;
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, targetRadius, 0, Math.PI * 2);
        ctx.strokeStyle = '#00f0ff';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Outer pulse ring
        const outerRadius = targetRadius + ((this.time * 25) % 18);
        const outerAlpha = Math.max(0, 1 - (outerRadius - targetRadius) / 18);
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, outerRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0, 240, 255, ${outerAlpha.toFixed(2)})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // ── Speaker shape ──────────────────────────────────────────────────────────
      if (this.povFollowSensor && !isVirtual) {
        const cabinetWidth = (isLFE ? 16 : 12) * scaleMult;
        const cabinetHeight = (isLFE ? 22 : 19) * scaleMult;
        const cabinetX = proj.x - cabinetWidth / 2;
        const cabinetY = proj.y - cabinetHeight / 2;
        ctx.fillStyle = this.theme === 'dark' ? '#101827' : '#f8fafc';
        ctx.strokeStyle = isSoloed ? '#00f0ff'
          : isLFE ? this.colors.subwoofer
          : isHeight ? this.colors.heightSpeaker
          : isObject ? this.colors.objectSpeaker
          : isBottom ? this.colors.bottomSpeaker
          : this.colors.speaker;
        ctx.lineWidth = Math.max(1, scaleMult);
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(cabinetX, cabinetY, cabinetWidth, cabinetHeight, 3 * scaleMult);
        else ctx.rect(cabinetX, cabinetY, cabinetWidth, cabinetHeight);
        ctx.fill();
        ctx.stroke();

        const driverRadius = Math.max(1.5, (isLFE ? 3.6 : 2.8) * scaleMult);
        const driverY = proj.y + (isLFE ? 2 : 1) * scaleMult;
        ctx.beginPath();
        ctx.arc(proj.x, driverY, driverRadius, 0, Math.PI * 2);
        ctx.fillStyle = this.theme === 'dark' ? '#25364a' : '#cbd5e1';
        ctx.fill();
        ctx.strokeStyle = isSoloed ? '#00f0ff' : glowColor;
        ctx.lineWidth = Math.max(0.7, 0.8 * scaleMult);
        ctx.stroke();

        if (isHeight) {
          ctx.beginPath();
          ctx.moveTo(proj.x, cabinetY - 4 * scaleMult);
          ctx.lineTo(proj.x, cabinetY);
          ctx.strokeStyle = this.colors.heightSpeaker;
          ctx.lineWidth = Math.max(1, scaleMult);
          ctx.stroke();
        }
      } else if (isObject) {
        // ✦ Hexagonal Dynamic Audio Object Beacon with orbital ring
        const sides = 6;
        ctx.beginPath();
        for (let s = 0; s < sides; s++) {
          const a = (s / sides) * Math.PI * 2 + (this.time * 1.2);
          const r = size * 1.15;
          const px = proj.x + Math.cos(a) * r;
          const py = proj.y + Math.sin(a) * r;
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = isSoloed ? '#00f0ff' : (level > 0.08 ? '#ffe4e6' : this.colors.objectSpeaker);
        ctx.fill();
        ctx.strokeStyle = isSoloed ? '#ffffff' : '#fb7185';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Pulsing dynamic orbit ring around active object
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, (size * 1.7) + Math.sin(this.time * 4 + sp.index) * 2, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(244, 63, 94, ${(0.35 + level * 0.45).toFixed(2)})`;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (isBottom) {
        // ▼ Inverted triangle for bottom / floor speakers (22.2 layout)
        ctx.beginPath();
        ctx.moveTo(proj.x - size * 1.1, proj.y - size * 0.85);
        ctx.lineTo(proj.x + size * 1.1, proj.y - size * 0.85);
        ctx.lineTo(proj.x,              proj.y + size * 1.15);
        ctx.closePath();
        ctx.fillStyle = isSoloed ? '#00f0ff' : (level > 0.08 ? '#cffafe' : this.colors.bottomSpeaker);
        ctx.fill();
        ctx.strokeStyle = isSoloed ? '#ffffff' : 'rgba(255,255,255,0.75)';
        ctx.lineWidth = isSoloed ? 2 : 1;
        ctx.stroke();
      } else if (isVirtual) {
        // 🎧 Binaural Virtual Space circle with dashed crossfeed boundary ring
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, size + level * 4 * scaleMult, 0, Math.PI * 2);
        ctx.fillStyle = isSoloed ? '#00f0ff' : (level > 0.08 ? '#38bdf8' : this.colors.virtualSpeaker);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, (size + 4) * scaleMult, 0, Math.PI * 2);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else if (isHeight) {
        // ◆ Diamond for overhead speakers
        ctx.beginPath();
        ctx.moveTo(proj.x,          proj.y - size * 1.3);
        ctx.lineTo(proj.x + size,   proj.y);
        ctx.lineTo(proj.x,          proj.y + size * 1.3);
        ctx.lineTo(proj.x - size,   proj.y);
        ctx.closePath();
        ctx.fillStyle   = isSoloed ? '#00f0ff' : (level > 0.08 ? '#f3e8ff' : this.colors.heightSpeaker);
        ctx.fill();
        ctx.strokeStyle = isSoloed ? '#ffffff' : 'rgba(255,255,255,0.7)';
        ctx.lineWidth   = isSoloed ? 2 : 1;
        ctx.stroke();
      } else {
        // ● Circle for standard ear-level speakers
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, size + level * 4 * scaleMult, 0, Math.PI * 2);
        ctx.fillStyle = isSoloed ? '#00f0ff'
                      : isLFE ? this.colors.subwoofer
                      : level > 0.08 ? this.colors.speakerActive
                      : this.colors.speaker;
        ctx.fill();
        // Inner highlight
        ctx.beginPath();
        ctx.arc(proj.x, proj.y, (size + level * 4 * scaleMult) * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.fill();
      }

      // ── Channel label ─────────────────────────────────────────────────────────
      const labelY = proj.y - (this.povFollowSensor ? 12 * scaleMult : size + 12);
      const fontSize = Math.max(8.5, Math.min(13, (isSoloed ? 10 : 9) * Math.sqrt(scaleMult)));
      const label = isSoloed ? (sp.shortName || sp.name) : isLFE ? 'LFE' : (sp.shortName || sp.name);
      const labelColor = isSoloed ? '#00f0ff'
        : isLFE ? this.colors.subText
        : isObject ? this.colors.objectText
        : isBottom ? this.colors.bottomText
        : isVirtual ? this.colors.virtualText
        : isHeight ? this.colors.heightText
        : this.colors.text;
      ctx.font = `700 ${fontSize}px "Inter", sans-serif`;
      const textWidth = ctx.measureText(label).width;
      const badgeWidth = textWidth + 19;
      const badgeHeight = fontSize + 9;
      const badgeX = proj.x - badgeWidth / 2;
      const badgeY = labelY - fontSize - 5;
      ctx.fillStyle = this.colors.hudBg;
      ctx.strokeStyle = isSoloed || level > 0.08 ? labelColor : this.colors.hudBorder;
      ctx.lineWidth = isSoloed ? 1.3 : 0.8;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(badgeX, badgeY, badgeWidth, badgeHeight, 5);
      else ctx.rect(badgeX, badgeY, badgeWidth, badgeHeight);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(badgeX + 7, badgeY + badgeHeight / 2, 2, 0, Math.PI * 2);
      ctx.fillStyle = labelColor;
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = labelColor;
      ctx.fillText(label, badgeX + 12, labelY - 1);
      if (level > 0.025) {
        ctx.fillStyle = labelColor;
        ctx.globalAlpha *= Math.min(1, 0.35 + level);
        ctx.fillRect(badgeX + 4, badgeY + badgeHeight - 2, (badgeWidth - 8) * Math.min(1, level), 1.5);
      }
      ctx.restore();
    }
  }

  // ─── Listener Head & Direction ───────────────────────────────────────────────

  _drawHead() {
    const ctx = this.ctx;

    // ──────────────────────────────────────────────────────────────────────────
    // REAL POV MODE (45° First-Person Human Eye Perspective)
    // ──────────────────────────────────────────────────────────────────────────
    if (this.povFollowSensor) {
      this._drawRealPOVHUD();
      return;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // 3RD-PERSON ORBIT MODE (Top-down / Isometric Avatar)
    // ──────────────────────────────────────────────────────────────────────────
    const my   = this.listenerMY || 0;
    const head = this._project(this.listenerMX, my, this.listenerMZ);
    const floorPt = this._project(this.listenerMX, 0, this.listenerMZ);
    const hx   = head.x;
    const hy   = head.y;

    // If elevated or depressed (my != 0), draw vertical dashed stem & floor shadow
    if (Math.abs(my) > 0.04) {
      // Floor shadow
      ctx.beginPath();
      ctx.ellipse(floorPt.x, floorPt.y, 13, 6, 0, 0, Math.PI * 2);
      ctx.fillStyle = this.colors.floorShadow || 'rgba(0,0,0,0.18)';
      ctx.fill();

      // Vertical stem connecting floor to head
      ctx.save();
      ctx.setLineDash([2, 3]);
      ctx.beginPath();
      ctx.moveTo(floorPt.x, floorPt.y);
      ctx.lineTo(hx, hy);
      ctx.strokeStyle = this.colors.stem || 'rgba(34, 211, 238, 0.45)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      // Height badge next to head
      ctx.save();
      ctx.font = '600 10px "Roboto Mono", monospace';
      const hText = `H: ${my > 0 ? '+' : ''}${my.toFixed(2)}m`;
      const tw = ctx.measureText(hText).width;
      ctx.fillStyle = 'rgba(10, 15, 30, 0.75)';
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(hx + 14, hy - 14, tw + 8, 16, 4);
      } else {
        ctx.rect(hx + 14, hy - 14, tw + 8, 16);
      }
      ctx.fill();
      ctx.fillStyle = this.colors.head;
      ctx.fillText(hText, hx + 18, hy - 2);
      ctx.restore();
    }

    // Guide line from room center to listener floor position (if moved)
    if (Math.hypot(this.listenerMX, this.listenerMZ) > 0.05) {
      const origin = this._project(0, 0, 0);
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(origin.x, origin.y);
      ctx.lineTo(floorPt.x, floorPt.y);
      ctx.strokeStyle = this.colors.guideLine;
      ctx.lineWidth   = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    // Hover/drag ring
    if (this.isHoveringHead || this.isDraggingHead) {
      ctx.beginPath();
      ctx.arc(hx, hy, 28, 0, Math.PI * 2);
      ctx.strokeStyle = this.colors.dragRing;
      ctx.lineWidth   = 2;
      ctx.stroke();
    }

    // ── 3-Axis Sensor Coordinate Frame (X=Red, Y=Green, Z=Blue) ─────────────
    const axes = this._getAxisVectors();
    const angleZ = axes.angleZ;

    // ── Hearing Coverage – always-visible directional field ───────────────────
    {
      const isDark = this.theme === 'dark';
      const coneR   = isDark ? 'rgba(34,211,238,' : 'rgba(2,132,199,';
      const coneHue = isDark ? 'rgba(34,211,238,' : 'rgba(14,165,233,';

      // Full 360° ambient listening ring (soft, very transparent)
      const ambGrad = ctx.createRadialGradient(hx, hy, 0, hx, hy, this.scale3D * 0.52);
      ambGrad.addColorStop(0, coneHue + '0.06)');
      ambGrad.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(hx, hy, this.scale3D * 0.52, 0, Math.PI * 2);
      ctx.fillStyle = ambGrad;
      ctx.fill();

      // Front hearing cone – always visible, wider, clearer
      const coneHalf = Math.PI * 0.55; // ~198° = wide binaural hearing field
      const coneLen  = axes.Z.lenWorld * this.scale3D * 1.1;
      const coneGrad = ctx.createRadialGradient(hx, hy, 0, hx, hy, coneLen);
      coneGrad.addColorStop(0,   coneR + '0.22)');
      coneGrad.addColorStop(0.6, coneR + '0.09)');
      coneGrad.addColorStop(1,   'transparent');
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.arc(hx, hy, coneLen, angleZ - coneHalf, angleZ + coneHalf);
      ctx.closePath();
      ctx.fillStyle = coneGrad;
      ctx.globalAlpha = 0.6;
      ctx.fill();
      ctx.globalAlpha = 1.0;

      // Facing direction strong beam (narrower inner cone highlighting exact gaze)
      const beamHalf = Math.PI / 8; // ~22.5° narrow forward beam
      const beamLen  = axes.Z.lenWorld * this.scale3D * 0.9;
      const beamGrad = ctx.createLinearGradient(hx, hy, axes.Z.tip.x, axes.Z.tip.y);
      beamGrad.addColorStop(0, coneR + '0.55)');
      beamGrad.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.arc(hx, hy, beamLen, angleZ - beamHalf, angleZ + beamHalf);
      ctx.closePath();
      ctx.fillStyle = beamGrad;
      ctx.globalAlpha = 0.7;
      ctx.fill();
      ctx.globalAlpha = 1.0;

      // Arc outline at the edge of the hearing cone
      ctx.beginPath();
      ctx.arc(hx, hy, coneLen, angleZ - coneHalf, angleZ + coneHalf);
      ctx.strokeStyle = coneR + '0.30)';
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.5;
      ctx.stroke();
      ctx.globalAlpha = 1.0;
    }

    if (this.showAxes) {
      const isActX = this.dragAxis === 'X' || (!this.dragAxis && this.hoverAxis === 'X');
      const isActY = this.dragAxis === 'Y' || (!this.dragAxis && this.hoverAxis === 'Y');
      const isActZ = this.dragAxis === 'Z' || (!this.dragAxis && this.hoverAxis === 'Z');

      const colorX = isActX ? '#ff4d4d' : (this.theme === 'dark' ? '#f87171' : '#ef4444');
      const colorY = isActY ? '#34d399' : (this.theme === 'dark' ? '#10b981' : '#059669');
      const colorZ = isActZ ? '#38bdf8' : (this.theme === 'dark' ? '#0284c7' : '#0369a1');

      this._drawArrow(hx, hy, axes.X.tip.x, axes.X.tip.y, colorX, isActX ? 'X (Axis)' : 'X', isActX ? 4.2 : 2.2);
      this._drawArrow(hx, hy, axes.Y.tip.x, axes.Y.tip.y, colorY, isActY ? 'Y (Height)' : 'Y', isActY ? 4.2 : 2.2);
      this._drawArrow(hx, hy, axes.Z.tip.x, axes.Z.tip.y, colorZ, isActZ ? 'Z (Fwd/Back)' : 'Z', isActZ ? 4.5 : 2.8);
    }

    // ── Person figure (at origin of the 3 axes) ───────────────────────────────
    const glow = ctx.createRadialGradient(hx, hy, 0, hx, hy, 24);
    glow.addColorStop(0, this.colors.headGlow);
    glow.addColorStop(1, 'transparent');
    ctx.beginPath();
    ctx.arc(hx, hy, 24, 0, Math.PI * 2);
    ctx.fillStyle = glow;
    ctx.fill();

    // Body / shoulders
    ctx.beginPath();
    ctx.ellipse(hx, hy + 6, 10, 7, 0, 0, Math.PI * 2);
    ctx.fillStyle = this.colors.head;
    ctx.globalAlpha = 0.55;
    ctx.fill();
    ctx.globalAlpha = 1.0;

    // Head circle
    ctx.beginPath();
    ctx.arc(hx, hy - 4, 8, 0, Math.PI * 2);
    ctx.fillStyle = this.colors.head;
    ctx.fill();

    // Head highlight
    ctx.beginPath();
    ctx.arc(hx - 1, hy - 6, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.fill();

    // Ears
    const earDist = 9;
    const earAngleL = angleZ - Math.PI / 2;
    const earAngleR = angleZ + Math.PI / 2;
    ctx.beginPath();
    ctx.arc(hx + Math.cos(earAngleL) * earDist, hy - 4 + Math.sin(earAngleL) * earDist, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = this.colors.head;
    ctx.globalAlpha = 0.8;
    ctx.fill();
    ctx.globalAlpha = 1.0;

    ctx.beginPath();
    ctx.arc(hx + Math.cos(earAngleR) * earDist, hy - 4 + Math.sin(earAngleR) * earDist, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = this.colors.head;
    ctx.globalAlpha = 0.8;
    ctx.fill();
    ctx.globalAlpha = 1.0;

    // Facing dot on head
    const faceDotDist = 5;
    ctx.beginPath();
    ctx.arc(hx + Math.cos(angleZ) * faceDotDist, hy - 4 + Math.sin(angleZ) * faceDotDist, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fill();

    // Forward direction tick mark
    ctx.beginPath();
    ctx.moveTo(hx + Math.cos(angleZ) * 9,  hy - 4 + Math.sin(angleZ) * 9);
    ctx.lineTo(hx + Math.cos(angleZ) * 16, hy - 4 + Math.sin(angleZ) * 16);
    ctx.strokeStyle = this.theme === 'dark' ? 'rgba(255,255,255,0.65)' : 'rgba(30,30,80,0.55)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // ── Active Drag Constraint Badge ──────────────────────────────────────────
    if (this.isDraggingHead && this.dragAxis && this.dragAxis !== 'all') {
      ctx.save();
      ctx.font = '700 11px "Roboto Mono", monospace';
      let badgeText = '';
      let badgeBg = 'rgba(15, 23, 42, 0.88)';
      let badgeColor = '#ffffff';

      if (this.dragAxis === 'X') {
        badgeText = `⟷ X: ${this._fmtM(this.listenerMX)} (Locked X-Axis)`;
        badgeBg = 'rgba(239, 68, 68, 0.9)';
      } else if (this.dragAxis === 'Y') {
        badgeText = `↕ Y: ${this._fmtM(this.listenerMY || 0)} (Locked Height)`;
        badgeBg = 'rgba(16, 185, 129, 0.9)';
      } else if (this.dragAxis === 'Z') {
        badgeText = `⤢ Z: ${this._fmtM(this.listenerMZ)} (Locked Z-Axis)`;
        badgeBg = 'rgba(2, 132, 199, 0.9)';
      }

      const tw = ctx.measureText(badgeText).width;
      const bx = hx - tw / 2 - 8;
      const by = hy - 40;
      ctx.fillStyle = badgeBg;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, tw + 16, 22, 6);
      else ctx.rect(bx, by, tw + 16, 22);
      ctx.fill();
      ctx.fillStyle = badgeColor;
      ctx.textAlign = 'center';
      ctx.fillText(badgeText, hx, by + 15);
      ctx.restore();
    }

    // ── Hover/Help hints ──────────────────────────────────────────────────────
    if (this.isHoveringHead && !this.isDraggingHead) {
      ctx.fillStyle    = this.colors.hint;
      ctx.font         = '11px "Inter", sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';

      let hintText = 'Drag body to move · WASD walk · ↑↓ height · V reset view';
      if (this.showAxes) {
        if (this.hoverAxis === 'X') hintText = 'Drag Red Arrow ⟷ Move on X-axis only';
        else if (this.hoverAxis === 'Y') hintText = 'Drag Green Arrow ↕ Move Height only';
        else if (this.hoverAxis === 'Z') hintText = 'Drag Blue Arrow ⤢ Move on Z-axis only';
      }
      ctx.fillText(hintText, hx, hy + 20);
      ctx.textBaseline = 'alphabetic';
    }
  }

  /**
   * First-person HUD rendered when immersive POV is active.
   * Features:
   * 1. Center reticle
   * 2. Active Speaker Direct Gaze Lock-on
   * 3. Sleek Top Compass Tape (0° FRONT, 90° RIGHT, 180° BACK, 270° LEFT)
   * 4. 360° Soundstage Mini-Radar in Bottom-Right Corner
   */
  _drawRealPOVHUD() {
    const ctx = this.ctx;
    const cx  = this.cx;
    const cy  = this.cy;

    // ── 1. Center reticle ────────────────────────────────────────────────────
    ctx.save();
    const reticleColor = 'rgba(133, 238, 255, 0.82)';
    const reticleDim   = 'rgba(133, 238, 255, 0.3)';

    // Center focal point
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#22d3ee';
    ctx.fill();

    // Outer subtle circle
    ctx.beginPath();
    ctx.arc(cx, cy, 22, 0, Math.PI * 2);
    ctx.strokeStyle = reticleDim;
    ctx.lineWidth = 1;
    ctx.stroke();

    // 4 Cardinal tick marks
    for (let a = 0; a < 4; a++) {
      const ang = (a * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * 7,  cy + Math.sin(ang) * 7);
      ctx.lineTo(cx + Math.cos(ang) * 16, cy + Math.sin(ang) * 16);
      ctx.strokeStyle = reticleColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();

    // ── 2. Direct Gaze Speaker Targeting ──────────────────────────────────────
    let closestSp = null;
    let minDiffDeg = 360;
    if (this.speakers.length > 0 && !this._isCinemaScene()) {
      for (const sp of this.speakers) {
        if (sp.isLFE) continue;
        const c = this._toCamSpace(sp.pos3D.x, sp.pos3D.y, sp.pos3D.z);
        if (c.camZ <= 0.1) continue; // Behind eyes
        // Angle in degrees from direct forward optical axis (+Z)
        const angleDeg = Math.atan2(Math.hypot(c.camX, c.camY), c.camZ) * (180 / Math.PI);
        if (angleDeg < minDiffDeg) {
          minDiffDeg = angleDeg;
          closestSp = sp;
        }
      }
    }
    // Focused if within the central ~22.5° cone of human sharp gaze
    this.activeGazeSpeaker = (minDiffDeg < 22.5) ? closestSp : null;

    if (this.activeGazeSpeaker && this.activeGazeSpeaker.sx !== undefined && this.activeGazeSpeaker.sx > -100) {
      const sp = this.activeGazeSpeaker;
      const sx = sp.sx;
      const sy = sp.sy;
      const distM = Math.hypot(
        sp.pos3D.x - this.listenerMX,
        sp.pos3D.y - (this.listenerMY || 0),
        sp.pos3D.z - this.listenerMZ
      );

      ctx.save();
      // Target lock bracket box
      const boxSize = 20 + Math.sin(this.time * 5) * 2;
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 1.8;
      const bracketLen = 6;
      // Top-left
      ctx.beginPath(); ctx.moveTo(sx - boxSize, sy - boxSize + bracketLen); ctx.lineTo(sx - boxSize, sy - boxSize); ctx.lineTo(sx - boxSize + bracketLen, sy - boxSize); ctx.stroke();
      // Top-right
      ctx.beginPath(); ctx.moveTo(sx + boxSize - bracketLen, sy - boxSize); ctx.lineTo(sx + boxSize, sy - boxSize); ctx.lineTo(sx + boxSize, sy - boxSize + bracketLen); ctx.stroke();
      // Bottom-left
      ctx.beginPath(); ctx.moveTo(sx - boxSize, sy + boxSize - bracketLen); ctx.lineTo(sx - boxSize, sy + boxSize); ctx.lineTo(sx - boxSize + bracketLen, sy + boxSize); ctx.stroke();
      // Bottom-right
      ctx.beginPath(); ctx.moveTo(sx + boxSize - bracketLen, sy + boxSize); ctx.lineTo(sx + boxSize, sy + boxSize); ctx.lineTo(sx + boxSize, sy + boxSize - bracketLen); ctx.stroke();

      // Floating lock-on badge
      const focusPct = Math.max(0, Math.min(100, Math.round(100 - minDiffDeg * 3.5)));
      const badgeText = `🎯 ${sp.name.toUpperCase()} · ${distM.toFixed(1)}m · ${focusPct}% Focus`;
      ctx.font = '700 10.5px "Roboto Mono", monospace';
      const tw = ctx.measureText(badgeText).width;
      const bx = sx - tw / 2 - 8;
      const by = sy - boxSize - 22;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.strokeStyle = 'rgba(34, 211, 238, 0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, tw + 16, 20, 4);
      else ctx.rect(bx, by, tw + 16, 20);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#22d3ee';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(badgeText, sx, by + 10);
      ctx.restore();
    }

    // ── 3. Bottom-Center Compass Tape Bar ─────────────────────────────────────
    ctx.save();
    const tapeW = Math.min(250, this.width - 36);
    const tapeH = 28;
    const tapeX = (this.width - tapeW) / 2;
    const tapeY = Math.max(12, this.height - tapeH - 16);
    const tapeCenter = tapeX + tapeW / 2;

    ctx.fillStyle = this.colors.hudBg;
    ctx.strokeStyle = this.colors.hudBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(tapeX, tapeY, tapeW, tapeH, 6);
    else ctx.rect(tapeX, tapeY, tapeW, tapeH);
    ctx.fill();
    ctx.stroke();

    // Center indicator marker (triangle)
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath();
    ctx.moveTo(tapeCenter, tapeY + tapeH);
    ctx.lineTo(tapeCenter - 5, tapeY + tapeH + 5);
    ctx.lineTo(tapeCenter + 5, tapeY + tapeH + 5);
    ctx.closePath();
    ctx.fill();

    // Compass cardinal and degree ticks
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(tapeX + 2, tapeY + 2, tapeW - 4, tapeH - 4, 4);
    else ctx.rect(tapeX + 2, tapeY + 2, tapeW - 4, tapeH - 4);
    ctx.clip();

    const pixelsPerDeg = tapeW / 100;
    const currentYaw = ((this.yaw % 360) + 360) % 360;

    for (let deg = -180; deg <= 540; deg += 15) {
      const diff = deg - currentYaw;
      const x = tapeCenter + diff * pixelsPerDeg;
      if (x < tapeX - 20 || x > tapeX + tapeW + 20) continue;

      const normDeg = ((deg % 360) + 360) % 360;
      let label = null;
      if (normDeg === 0)   label = 'FRONT (N)';
      else if (normDeg === 90)  label = 'RIGHT (E)';
      else if (normDeg === 180) label = 'BACK (S)';
      else if (normDeg === 270) label = 'LEFT (W)';

      ctx.beginPath();
      ctx.moveTo(x, tapeY + 2);
      ctx.lineTo(x, tapeY + (label ? 10 : 6));
      ctx.strokeStyle = label ? '#7deaff' : 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = label ? 1.5 : 1;
      ctx.stroke();

      if (label) {
        ctx.font = '700 9px "Roboto Mono", monospace';
        ctx.fillStyle = '#7deaff';
        ctx.textAlign = 'center';
        ctx.fillText(label, x, tapeY + 20);
      } else if (normDeg % 30 === 0) {
        ctx.font = '500 8px "Roboto Mono", monospace';
        ctx.fillStyle = this.colors.compassText;
        ctx.textAlign = 'center';
        ctx.fillText(`${normDeg}°`, x, tapeY + 19);
      }
    }
    ctx.restore();
    ctx.restore();

    // ── 4. 360° Soundstage Mini-Radar (Bottom-Right) ──────────────────────────
    ctx.save();
    const radarR = 46;
    const radarX = this.width - radarR - 16;
    const radarY = this.height - radarR - 16;

    // Radar background disc
    ctx.fillStyle = this.colors.hudBg;
    ctx.strokeStyle = this.colors.roomEdge;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(radarX, radarY, radarR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Inner distance ring
    ctx.beginPath();
    ctx.arc(radarX, radarY, radarR * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = this.colors.roomGrid;
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // 45° View Frustum Wedge facing current Yaw
    const yawRad = (this.yaw * Math.PI) / 180;
    const fovHalfRad = (45 * Math.PI) / 360; // 22.5° half-angle
    // In radar: Top = Front (+Z), Right = +X
    // Yaw=0 points straight UP (-PI/2 in canvas 2D screen space)
    const baseAngle = -Math.PI / 2 + yawRad;

    ctx.fillStyle = 'rgba(34, 211, 238, 0.12)';
    ctx.beginPath();
    ctx.moveTo(radarX, radarY);
    ctx.arc(radarX, radarY, radarR * 0.95, baseAngle - fovHalfRad, baseAngle + fovHalfRad);
    ctx.closePath();
    ctx.fill();

    // Viewing cone boundary rays
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(radarX, radarY);
    ctx.lineTo(radarX + Math.cos(baseAngle - fovHalfRad) * radarR * 0.95, radarY + Math.sin(baseAngle - fovHalfRad) * radarR * 0.95);
    ctx.moveTo(radarX, radarY);
    ctx.lineTo(radarX + Math.cos(baseAngle + fovHalfRad) * radarR * 0.95, radarY + Math.sin(baseAngle + fovHalfRad) * radarR * 0.95);
    ctx.stroke();

    // Center listener dot
    ctx.beginPath();
    ctx.arc(radarX, radarY, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Speakers on mini-radar
    if (this.speakers.length > 0) {
      for (let i = 0; i < this.speakers.length; i++) {
        const sp = this.speakers[i];
        const lvl = this.channelLevels[i] || 0;
        // In visualizer world: +X = Right, +Z = Front
        const spRad = (radarR * 0.78) * ((sp.baseDistance || 2) / 2.0);
        const azRad = (sp.azimuth * Math.PI) / 180;
        const spX = radarX + Math.sin(azRad) * spRad;
        const spY = radarY - Math.cos(azRad) * spRad;

        // Speaker dot
        ctx.beginPath();
        ctx.arc(spX, spY, 2.5 + lvl * 2, 0, Math.PI * 2);
        ctx.fillStyle = lvl > 0.08 ? '#a78bfa' : (sp.isHeight ? '#c084fc' : '#60a5fa');
        ctx.fill();
      }
    }

    // Mini-Radar Title
    ctx.font = '600 8.5px "Roboto Mono", monospace';
    ctx.fillStyle = this.colors.hudText;
    ctx.textAlign = 'center';
    ctx.fillText('360° RADAR', radarX, radarY + radarR + 11);
    ctx.restore();
  }

  /** Draw a 3D vector arrow with tip arrowhead and text label */
  _drawArrow(fromX, fromY, toX, toY, color, label, lineWidth = 2) {
    const ctx = this.ctx;
    const dx = toX - fromX;
    const dy = toY - fromY;
    const len = Math.hypot(dx, dy);
    if (len < 5) return;
    const angle = Math.atan2(dy, dx);

    ctx.save();
    // Stem line
    ctx.beginPath();
    ctx.moveTo(fromX, fromY);
    ctx.lineTo(toX, toY);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Arrowhead triangle
    ctx.translate(toX, toY);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(9, 0);
    ctx.lineTo(-6, -4.5);
    ctx.lineTo(-6, 4.5);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();

    // Text label at arrowhead tip
    if (label) {
      ctx.font = '700 10.5px "Roboto Mono", monospace';
      ctx.fillStyle = color;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 12, 0);
    }
    ctx.restore();
  }

  // ─── HUD / Labels ────────────────────────────────────────────────────────────

  _drawHUD() {
    const ctx = this.ctx;
    const cardX = 14;
    const cardY = this.height - 150;
    const cardW = 154;
    const cardH = 136;
    ctx.save();
    ctx.globalAlpha = this.povFollowSensor ? 0.88 : 1;
    ctx.fillStyle = this.colors.hudBg;
    ctx.strokeStyle = this.colors.hudBorder;
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cardX, cardY, cardW, cardH, 10);
    else ctx.rect(cardX, cardY, cardW, cardH);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '600 8px "Roboto Mono", monospace';
    ctx.fillStyle = this.colors.compassText;
    ctx.fillText(this.povFollowSensor ? 'LIVE POV' : 'LISTENER', cardX + 11, cardY + 15);

    ctx.font = '600 8px "Roboto Mono", monospace';
    ctx.fillStyle = this.colors.hudText;
    const rows = [
      ['YAW', `${this._fmtDeg(this.yaw)}°`],
      ['PITCH', `${this._fmtDeg(this.pitch)}°`],
      ['ROLL', `${this._fmtDeg(this.roll)}°`],
      ['X', this._fmtM(this.listenerMX)],
      ['Y', this._fmtM(this.listenerMY || 0)],
      ['Z', this._fmtM(this.listenerMZ)]
    ];
    rows.forEach(([label, value], index) => {
      const rowY = cardY + 38 + index * 15;
      ctx.fillStyle = this.colors.compassText;
      ctx.fillText(label, cardX + 11, rowY);
      ctx.fillStyle = this.colors.hudText;
      ctx.textAlign = 'right';
      ctx.fillText(value, cardX + cardW - 11, rowY);
      ctx.textAlign = 'left';
      if (index === 2) {
        ctx.strokeStyle = this.colors.hudBorder;
        ctx.beginPath();
        ctx.moveTo(cardX + 10, rowY + 9);
        ctx.lineTo(cardX + cardW - 10, rowY + 9);
        ctx.stroke();
      }
    });
    if (this.povFollowSensor) {
      ctx.fillStyle = '#7deaff';
      ctx.beginPath();
      ctx.arc(cardX + cardW - 12, cardY + 15, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _fmtDeg(v) { return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`; }
  _fmtM(v)   { return `${v >= 0 ? '+' : ''}${v.toFixed(2)}m`; }
}
