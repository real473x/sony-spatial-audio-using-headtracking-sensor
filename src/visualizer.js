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
    this._onListenerMove = null;
    this._onOrientationChange = null;

    // Feature toggles & scaling
    this.showAxes = true;
    this.topSpeakerHeightScale = 1.0;
    this.activeEffectName = null;
    this.allowOutsideBoundary = false;

    // Virtual room radius in meters (size of the speaker sphere boundary)
    this.roomRadius = 2.0;

    // Real POV Mode (45° Human Eye FOV): locks POV to front, display acts as user front eye
    this.povFollowSensor = false;

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
        floor: 'rgba(80, 100, 255, 0.05)',
        floorRim: 'rgba(100, 120, 255, 0.28)',
        floorGrid: 'rgba(100, 120, 255, 0.10)',
        floorAxisLine: 'rgba(100, 120, 255, 0.14)',
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
        floor: 'rgba(99, 102, 241, 0.04)',
        floorRim: 'rgba(99, 102, 241, 0.28)',
        floorGrid: 'rgba(99, 102, 241, 0.10)',
        floorAxisLine: 'rgba(99, 102, 241, 0.15)',
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
    if (!this.allowOutsideBoundary) {
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
    if (!this.allowOutsideBoundary) {
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

    if (!this.allowOutsideBoundary) {
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
    const MIN_H = -1.5;
    const MAX_H = 2.5;
    this.listenerMY = Math.max(MIN_H, Math.min(MAX_H, this.listenerMY + dy));
    if (this._onListenerMove) this._onListenerMove(this.listenerMX, this.listenerMY, this.listenerMZ);
  }

  /** Set listener POV height directly (meters). */
  setListenerHeight(meterY) {
    const MIN_H = -1.5;
    const MAX_H = 2.5;
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

  /**
   * Convert a 3D world coordinate into camera space (relative to listener head position and orientation).
   */
  _toCamSpace(x, y, z) {
    const dx = x - this.listenerMX;
    const dy = y - (this.listenerMY || 0);
    const dz = z - this.listenerMZ;

    const yawRad   = (this.yaw   * Math.PI) / 180;
    const pitchRad = (this.pitch * Math.PI) / 180;
    const rollRad  = (this.roll  * Math.PI) / 180;

    // 1. Rotate around Y (Yaw)
    const x1 =  dx * Math.cos(yawRad) - dz * Math.sin(yawRad);
    const y1 =  dy;
    const z1 =  dx * Math.sin(yawRad) + dz * Math.cos(yawRad);

    // 2. Rotate around X (Pitch)
    const x2 = x1;
    const y2 = y1 * Math.cos(pitchRad) - z1 * Math.sin(pitchRad);
    const z2 = y1 * Math.sin(pitchRad) + z1 * Math.cos(pitchRad);

    // 3. Rotate around Z (Roll)
    const camX =  x2 * Math.cos(rollRad) + y2 * Math.sin(rollRad);
    const camY = -x2 * Math.sin(rollRad) + y2 * Math.cos(rollRad);
    const camZ =  z2;

    return { camX, camY, camZ };
  }

  /**
   * Project a camera-space point (camX, camY, camZ) to 2D screen coordinates using realistic 45° Human Eye FOV.
   */
  _camToScreen(camX, camY, camZ) {
    const fovDeg = 45; // Real Human Eye Focal FOV (~45°)
    const fovRad = (fovDeg * Math.PI) / 180;
    const focalLength = (Math.min(this.width, this.height) / 2) / Math.tan(fovRad / 2);

    return {
      x: this.cx + (camX / camZ) * focalLength,
      y: this.cy - (camY / camZ) * focalLength,
      depth: camZ,
      scale: focalLength / camZ
    };
  }

  /**
   * Unified 3D → 2D projection.
   * If povFollowSensor is ON: uses 45° First-Person Human Eye perspective from listener head.
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

  // ─── Resize ──────────────────────────────────────────────────────────────────

  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width  = rect.width  * this.dpr;
    this.canvas.height = rect.height * this.dpr;
    this.ctx.scale(this.dpr, this.dpr);
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
    ctx.fillStyle = this.colors.bg;
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
      ctx.fillStyle = this.colors.floor;
      ctx.fill();
      ctx.strokeStyle = this.colors.floorRim;
      ctx.lineWidth = 1.8;
      ctx.stroke();

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
    } else {
      // ── Real POV Mode (45° First-Person Perspective) ─────────────────────────
      // Outer floor circle rim
      this._drawCircle3D(ROOM_R, 0, this.colors.floorRim, 2.0);

      // Concentric distance reference rings
      for (const frac of [0.25, 0.5, 0.75]) {
        this._drawCircle3D(ROOM_R * frac, 0, this.colors.floorGrid, 1.0);
      }

      // Extended outer boundary rings if enabled
      if (this.allowOutsideBoundary) {
        for (const frac of [1.5, 2.25, 3.0]) {
          this._drawCircle3D(ROOM_R * frac, 0, this.colors.floorGrid, 1.0, [4, 6]);
        }
      }

      // Floor X/Z axis cross lines
      this._drawLine3D(-ROOM_R, 0, 0, ROOM_R, 0, 0, this.colors.floorAxisLine, 1.2, [5, 6]);
      this._drawLine3D(0, 0, -ROOM_R, 0, 0, ROOM_R, this.colors.floorAxisLine, 1.2, [5, 6]);
    }

    // ── Height layer ceiling ring (shown only when height speakers exist) ──────
    const hasHeight = this.speakers.some(s => s.isHeight);
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
    if (!this.analyserData || this.analyserData.length === 0) return;
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
    if (!this.speakers.length) return;
    const ctx = this.ctx;

    // Project all speakers and depth-sort (back-to-front)
    const renderList = this.speakers.map((sp, i) => {
      const proj = this._project(sp.pos3D.x, sp.pos3D.y, sp.pos3D.z);
      sp.sx = proj.x;
      sp.sy = proj.y;
      return { sp, proj, level: this.channelLevels[i] || 0 };
    })
    .filter(item => item.proj.inFront !== false)
    .sort((a, b) => b.proj.depth - a.proj.depth);

    const hasSolo = (this.soloedChannels && this.soloedChannels.size > 0);

    for (const { sp, proj, level } of renderList) {
      const isLFE      = sp.isLFE || sp.name === 'LFE';
      const isHeight   = !!sp.isHeight;
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
        scaleMult = Math.max(0.45, Math.min(2.8, 2.0 / Math.max(0.2, proj.depth)));
      }
      if (isSoloed) {
        scaleMult *= 1.25;
      }

      // ── Height speaker: draw vertical stem from floor shadow up to speaker ───
      if (isHeight) {
        const floorProj = this._project(sp.pos3D.x, 0, sp.pos3D.z);
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
          sp.pos3D.x, 0, sp.pos3D.z,
          sp.pos3D.x, sp.pos3D.y, sp.pos3D.z,
          stemColor, level > 0.05 ? 2 : 1.5, [4, 3]
        );
      }

      // ── Glow halo ──────────────────────────────────────────────────────────────
      const baseSize = isLFE ? 7 : isHeight ? 5.5 : 5.5;
      const size     = baseSize * scaleMult;
      const glowSize = size + (10 + level * 15 + pulse * 2.5) * scaleMult;

      const glowColor = isSoloed   ? 'rgba(0, 240, 255, 0.85)'
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
      if (isHeight) {
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
        // ● Circle for floor speakers
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

      // ── Label ──────────────────────────────────────────────────────────────────
      const labelY = proj.y - size - (this.povFollowSensor ? 10 * scaleMult : 12);
      ctx.textAlign = 'center';
      const fontSize = Math.max(8.5, Math.min(14, (isSoloed ? 11 : 9.5) * Math.sqrt(scaleMult)));
      if (isSoloed) {
        ctx.fillStyle = '#00f0ff';
        ctx.font = `700 ${fontSize}px "Inter", sans-serif`;
        ctx.fillText(`🎯 ${sp.shortName || sp.name}`, proj.x, labelY);
      } else if (isLFE) {
        ctx.fillStyle = this.colors.subText;
        ctx.font = `600 ${fontSize}px "Inter", sans-serif`;
        ctx.fillText('LFE', proj.x, labelY);
      } else if (isHeight) {
        ctx.fillStyle = this.colors.heightText;
        ctx.font = `700 ${fontSize}px "Inter", sans-serif`;
        ctx.fillText(sp.shortName || sp.name, proj.x, labelY);
      } else {
        ctx.fillStyle = this.colors.text;
        ctx.font = `600 ${fontSize}px "Inter", sans-serif`;
        ctx.fillText(sp.shortName || sp.name, proj.x, labelY);
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
   * First-person HUD rendered when in Real POV Mode (45° Human Eye FOV).
   * Features:
   * 1. 45° Human Eye Center Crosshair & Reticle
   * 2. Active Speaker Direct Gaze Lock-on
   * 3. Sleek Top Compass Tape (0° FRONT, 90° RIGHT, 180° BACK, 270° LEFT)
   * 4. 360° Soundstage Mini-Radar in Bottom-Right Corner
   */
  _drawRealPOVHUD() {
    const ctx = this.ctx;
    const cx  = this.cx;
    const cy  = this.cy;

    // ── 1. Center Eye Crosshair (45° FOV Gaze Reticle) ────────────────────────
    ctx.save();
    const reticleColor = 'rgba(34, 211, 238, 0.75)';
    const reticleDim   = 'rgba(34, 211, 238, 0.25)';

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
    if (this.speakers.length > 0) {
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

    // ── 3. Top Compass Tape Bar ───────────────────────────────────────────────
    ctx.save();
    const tapeW = Math.min(380, this.width - 40);
    const tapeH = 28;
    const tapeX = cx - tapeW / 2;
    const tapeY = 14;

    ctx.fillStyle = 'rgba(10, 15, 30, 0.72)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(tapeX, tapeY, tapeW, tapeH, 6);
    else ctx.rect(tapeX, tapeY, tapeW, tapeH);
    ctx.fill();
    ctx.stroke();

    // Center indicator marker (triangle)
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath();
    ctx.moveTo(cx, tapeY + tapeH);
    ctx.lineTo(cx - 5, tapeY + tapeH + 5);
    ctx.lineTo(cx + 5, tapeY + tapeH + 5);
    ctx.closePath();
    ctx.fill();

    // Compass cardinal and degree ticks
    ctx.save();
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(tapeX + 2, tapeY + 2, tapeW - 4, tapeH - 4, 4);
    else ctx.rect(tapeX + 2, tapeY + 2, tapeW - 4, tapeH - 4);
    ctx.clip();

    const pixelsPerDeg = tapeW / 120; // 120° FOV window displayed in tape
    const currentYaw = ((this.yaw % 360) + 360) % 360;

    for (let deg = -180; deg <= 540; deg += 15) {
      const diff = deg - currentYaw;
      const x = cx + diff * pixelsPerDeg;
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
      ctx.strokeStyle = label ? '#22d3ee' : 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = label ? 1.5 : 1;
      ctx.stroke();

      if (label) {
        ctx.font = '700 9px "Roboto Mono", monospace';
        ctx.fillStyle = '#22d3ee';
        ctx.textAlign = 'center';
        ctx.fillText(label, x, tapeY + 20);
      } else if (normDeg % 30 === 0) {
        ctx.font = '500 8px "Roboto Mono", monospace';
        ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
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
    ctx.fillStyle = 'rgba(10, 15, 30, 0.85)';
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.3)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(radarX, radarY, radarR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Inner distance ring
    ctx.beginPath();
    ctx.arc(radarX, radarY, radarR * 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.15)';
    ctx.lineWidth = 0.8;
    ctx.stroke();

    // 45° View Frustum Wedge facing current Yaw
    const yawRad = (this.yaw * Math.PI) / 180;
    const fovHalfRad = (45 * Math.PI) / 360; // 22.5° half-angle
    // In radar: Top = Front (+Z), Right = +X
    // Yaw=0 points straight UP (-PI/2 in canvas 2D screen space)
    const baseAngle = -Math.PI / 2 + yawRad;

    ctx.fillStyle = 'rgba(34, 211, 238, 0.18)';
    ctx.beginPath();
    ctx.moveTo(radarX, radarY);
    ctx.arc(radarX, radarY, radarR * 0.95, baseAngle - fovHalfRad, baseAngle + fovHalfRad);
    ctx.closePath();
    ctx.fill();

    // Viewing cone boundary rays
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.6)';
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
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
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
    ctx.font      = '11px "Roboto Mono", monospace';
    ctx.textBaseline = 'alphabetic';

    // Orientation readout (bottom-left)
    ctx.fillStyle  = this.colors.compassText;
    ctx.textAlign  = 'left';
    const curDist = Math.hypot(this.listenerMX, this.listenerMZ);
    const outsideTag = (this.allowOutsideBoundary && curDist > this.roomRadius * 1.01) ? `  [OUTSIDE ${curDist.toFixed(1)}m]` : '';
    const modeTag = this.povFollowSensor ? '  [👁️ REAL POV 45°]' : '  [📐 ORBIT VIEW]';
    const rows = [
      `YAW   ${this._fmtDeg(this.yaw)}°`,
      `PITCH ${this._fmtDeg(this.pitch)}°`,
      `ROLL  ${this._fmtDeg(this.roll)}°`,
      `POS   X:${this._fmtM(this.listenerMX)}  Y:${this._fmtM(this.listenerMY || 0)}  Z:${this._fmtM(this.listenerMZ)}${outsideTag}${modeTag}`
    ];
    for (let i = 0; i < rows.length; i++) {
      ctx.fillText(rows[i], 12, this.height - 14 - (rows.length - 1 - i) * 16);
    }

    // Camera hint (bottom-right / bottom-center)
    if (!this.povFollowSensor) {
      ctx.textAlign = 'right';
      ctx.fillText('🔴 X  🟢 Y  🔵 Z  ·  WASD walk  ·  Scroll/+- zoom  ·  B boundary  ·  P Real POV', this.width - 12, this.height - 14);
    } else {
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(34, 211, 238, 0.85)';
      ctx.fillText('👁️ Real POV (45° Human Eye)  ·  Drag canvas to look  ·  WASD walk  ·  ↑↓ height  ·  P Orbit view', 12, this.height - 14 - rows.length * 16);
    }

    // Height label watermark (top-right, small)
    if (this.speakers.some(s => s.isHeight) && !this.povFollowSensor) {
      ctx.textAlign  = 'right';
      ctx.fillStyle  = this.colors.ceilRim;
      ctx.font       = '500 9px "Inter", sans-serif';
      ctx.fillText('◆ = Height speaker   ● = Floor speaker', this.width - 12, 18);
    }

    // Active spatial effect indicator (top-left)
    if (this.activeEffectName) {
      ctx.textAlign = 'left';
      ctx.fillStyle = this.colors.speakerActive || '#6366f1';
      ctx.font = '600 11px "Inter", sans-serif';
      ctx.fillText(`✨ EFFECT: ${this.activeEffectName.toUpperCase()}`, 12, 22);
    }

    // Real POV Top Badge
    if (this.povFollowSensor) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#22d3ee';
      ctx.font = '700 10.5px "Roboto Mono", monospace';
      if (this.activeGazeSpeaker) {
        const lvl = Math.round((this.channelLevels[this.activeGazeSpeaker.index] || 0) * 100);
        ctx.fillText(`🎯 TARGET: ${this.activeGazeSpeaker.name.toUpperCase()} (${this.activeGazeSpeaker.shortName}) · LEVEL ${lvl}%`, 12, this.activeEffectName ? 38 : 22);
      } else {
        ctx.fillText('👁️ REAL POV: 45° HUMAN EYE VIEW (FRONT EYE LOCKED)', 12, this.activeEffectName ? 38 : 22);
      }
    }
  }

  _fmtDeg(v) { return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`; }
  _fmtM(v)   { return `${v >= 0 ? '+' : ''}${v.toFixed(2)}m`; }
}

