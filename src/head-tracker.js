/**
 * Head Tracker
 * 
 * Connects to the Node.js WebSocket bridge to receive head tracking data
 * from OpenTrack (yaw, pitch, roll). Applies exponential smoothing to
 * reduce jitter, and supports recentering.
 */

export class HeadTracker {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.reconnectTimer = null;
    
    // Raw orientation from OpenTrack
    this.rawYaw = 0;
    this.rawPitch = 0;
    this.rawRoll = 0;
    
    // Smoothed orientation
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    
    // Recenter offset
    this.yawOffset = 0;
    this.pitchOffset = 0;
    this.rollOffset = 0;
    
    // Smoothing factor (0-1, lower = more smoothing)
    this.smoothing = 0.35;
    
    // Callbacks
    this._onUpdate = null;
    this._onStatusChange = null;
    
    // Stats
    this.lastPacketTime = 0;
    this.packetsPerSecond = 0;
    this._ppsCounter = 0;
    this._ppsTimer = null;
    
    // Tracking enabled toggle (for standard earbuds/headphones)
    this.enabled = true;

    // Positional / Walking tracking (6-DoF X/Y/Z translation)
    this.positionalEnabled = false;
    this.rawTx = 0;
    this.rawTy = 0;
    this.rawTz = 0;
    this.tx = 0;
    this.ty = 0;
    this.tz = 0;
    this.txOffset = 0;
    this.tyOffset = 0;
    this.tzOffset = 0;

    // Position scale multiplier: amplifies sensor translation for audible spatial effect.
    // OpenTrack sends cm-scale head movements; multiply to room-scale virtual meters.
    // Higher = more sensitive (small real movement → large virtual movement)
    this.positionScale = 15.0;

    // Sensor axis inversion / mirroring — applies to Yaw, Pitch, Roll orientation
    this.invertYaw   = true;
    this.invertPitch = false;
    this.invertRoll  = false;

    // Per-axis enable/disable (lets user ignore a noisy or unwanted axis)
    this.enableYaw   = true;
    this.enablePitch = true;
    this.enableRoll  = true;

    // Axis mapping / Euler rotation order (Default: YXZ for Sony WF-1000XM5 / OpenTrack)
    // In Sony IMU / OpenTrack convention:
    // Yaw rotates around Y (vertical heading), Pitch rotates around X (lateral elevation), Roll rotates around Z (forward bank)
    this.axisOrder = 'YXZ';
    this.axisSourceYaw   = 'yaw';
    this.axisSourcePitch = 'pitch';
    this.axisSourceRoll  = 'roll';

    // Inertial Step / Walking Detection Engine (for earphone IMUs)
    this.stepDetectionEnabled = true;
    this.walkX = 0;
    this.walkY = 0;
    this.walkZ = 0;
    this.walkTargetX = 0;
    this.walkTargetZ = 0;
    this.stepCount = 0;
    this.lastStepTime = 0;
    this._pitchBaseline = 0;
    this._stepPeak = 0;
    this._inStepCycle = false;
    this._isWalking = false;
    this._neckModelEnabled = true;
    this._onStep = null;

    // WebSocket URL
    this.wsUrl = 'ws://localhost:8080';
  }

  /**
   * Register callback when a physical walking step is detected from earphones
   */
  onStep(callback) {
    this._onStep = callback;
  }

  /**
   * Set Axis mapping matching the 6 Axis options in Sony Head Tracker / Spatial Audio Tracker software
   * @param {'YXZ' | 'XYZ' | 'XZY' | 'YZX' | 'ZXY' | 'ZYX'} order
   */
  setAxisOrder(order) {
    this.axisOrder = order || 'YXZ';
    switch (this.axisOrder) {
      case 'YXZ': // 1st=Y (Yaw), 2nd=X (Pitch), 3rd=Z (Roll) — Sony WF-1000XM5 Default
        this.axisSourceYaw = 'yaw';
        this.axisSourcePitch = 'pitch';
        this.axisSourceRoll = 'roll';
        break;
      case 'XYZ': // 1st=X (Pitch), 2nd=Y (Yaw), 3rd=Z (Roll)
        this.axisSourceYaw = 'pitch';
        this.axisSourcePitch = 'yaw';
        this.axisSourceRoll = 'roll';
        break;
      case 'XZY': // 1st=X (Pitch), 2nd=Z (Roll), 3rd=Y (Yaw)
        this.axisSourceYaw = 'roll';
        this.axisSourcePitch = 'yaw';
        this.axisSourceRoll = 'pitch';
        break;
      case 'YZX': // 1st=Y (Yaw), 2nd=Z (Roll), 3rd=X (Pitch)
        this.axisSourceYaw = 'yaw';
        this.axisSourcePitch = 'roll';
        this.axisSourceRoll = 'pitch';
        break;
      case 'ZXY': // 1st=Z (Roll), 2nd=X (Pitch), 3rd=Y (Yaw)
        this.axisSourceYaw = 'roll';
        this.axisSourcePitch = 'pitch';
        this.axisSourceRoll = 'yaw';
        break;
      case 'ZYX': // 1st=Z (Roll), 2nd=Y (Yaw), 3rd=X (Pitch)
        this.axisSourceYaw = 'pitch';
        this.axisSourcePitch = 'roll';
        this.axisSourceRoll = 'yaw';
        break;
      default:
        this.axisSourceYaw = 'yaw';
        this.axisSourcePitch = 'pitch';
        this.axisSourceRoll = 'roll';
        break;
    }
    console.log(`[HeadTracker] Axis Order set to ${this.axisOrder} (Yaw←${this.axisSourceYaw}, Pitch←${this.axisSourcePitch}, Roll←${this.axisSourceRoll})`);
  }

  setAxisSources(yawSrc, pitchSrc, rollSrc) {
    if (yawSrc)   this.axisSourceYaw   = yawSrc;
    if (pitchSrc) this.axisSourcePitch = pitchSrc;
    if (rollSrc)  this.axisSourceRoll  = rollSrc;
    console.log(`[HeadTracker] Custom Axis Sources: Yaw←${this.axisSourceYaw}, Pitch←${this.axisSourcePitch}, Roll←${this.axisSourceRoll}`);
  }

  /**
   * Set sensor axis inversion / mirroring (Yaw = left/right turn, Pitch = nod up/down, Roll = tilt)
   */
  setInvertYaw(inverted) {
    this.invertYaw = !!inverted;
    console.log(`[HeadTracker] Invert Yaw: ${this.invertYaw}`);
  }

  setInvertPitch(inverted) {
    this.invertPitch = !!inverted;
    console.log(`[HeadTracker] Invert Pitch: ${this.invertPitch}`);
  }

  setInvertRoll(inverted) {
    this.invertRoll = !!inverted;
    console.log(`[HeadTracker] Invert Roll: ${this.invertRoll}`);
  }

  /**
   * Enable or disable individual sensor axes
   */
  setEnableYaw(enabled) {
    this.enableYaw = !!enabled;
    if (!this.enableYaw) this.yaw = 0;
    console.log(`[HeadTracker] Yaw axis: ${enabled ? 'enabled' : 'disabled'}`);
  }

  setEnablePitch(enabled) {
    this.enablePitch = !!enabled;
    if (!this.enablePitch) this.pitch = 0;
    console.log(`[HeadTracker] Pitch axis: ${enabled ? 'enabled' : 'disabled'}`);
  }

  setEnableRoll(enabled) {
    this.enableRoll = !!enabled;
    if (!this.enableRoll) this.roll = 0;
    console.log(`[HeadTracker] Roll axis: ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Enable or disable head tracking (rotation)
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.enabled = !!enabled;
    if (!this.enabled) {
      // Reset orientation to 0
      this.yaw = 0;
      this.pitch = 0;
      this.roll = 0;
      if (this._onUpdate) {
        this._onUpdate(0, 0, 0, null);
      }
    }
    this._notifyStatus();
    console.log(`[HeadTracker] Tracking ${this.enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Enable or disable 6-DoF positional tracking (walking around virtual space)
   * @param {boolean} enabled
   */
  setPositionalEnabled(enabled) {
    this.positionalEnabled = !!enabled;
    this.tx = 0;
    this.ty = 0;
    this.tz = 0;
    this.walkX = 0;
    this.walkY = 0;
    this.walkZ = 0;
    this.walkTargetX = 0;
    this.walkTargetZ = 0;
    if (this.positionalEnabled) {
      this.txOffset = this.rawTx;
      this.tyOffset = this.rawTy;
      this.tzOffset = this.rawTz;
    }
    console.log(`[HeadTracker] Positional / walking tracking ${this.positionalEnabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Set position scale multiplier. Amplifies raw sensor translation into virtual space meters.
   * @param {number} scale - Multiplier (e.g. 5.0 = 5x amplification; 1.0 = raw 1cm→0.01m)
   */
  setPositionScale(scale) {
    this.positionScale = Math.max(0.1, Math.min(200, scale));
    console.log(`[HeadTracker] Position scale set to ${this.positionScale.toFixed(1)}x`);
  }

  /**
   * Start listening for head tracking data
   */
  connect(url) {
    if (url) this.wsUrl = url;
    this._connect();
    
    // PPS counter
    this._ppsTimer = setInterval(() => {
      this.packetsPerSecond = this._ppsCounter;
      this._ppsCounter = 0;
    }, 1000);
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this._ppsTimer) {
      clearInterval(this._ppsTimer);
      this._ppsTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this._notifyStatus();
  }

  /**
   * Set current orientation and position as the new "forward" / "center" reference
   */
  recenter() {
    this.yawOffset = this.rawYaw;
    this.pitchOffset = this.rawPitch;
    this.rollOffset = this.rawRoll;
    this.txOffset = this.rawTx;
    this.tyOffset = this.rawTy;
    this.tzOffset = this.rawTz;
    this.tx = 0;
    this.ty = 0;
    this.tz = 0;
    this.walkX = 0;
    this.walkY = 0;
    this.walkZ = 0;
    this.walkTargetX = 0;
    this.walkTargetZ = 0;
    this.stepCount = 0;
    this._pitchBaseline = this.rawPitch;
    this._stepPeak = 0;
    this._inStepCycle = false;
    this._isWalking = false;
    console.log(`[HeadTracker] Recentered at yaw=${this.rawYaw.toFixed(1)}° pitch=${this.rawPitch.toFixed(1)}° roll=${this.rawRoll.toFixed(1)}°`);
  }

  /**
   * Set smoothing factor (0 = maximum smoothing, 1 = no smoothing)
   */
  setSmoothing(value) {
    this.smoothing = Math.max(0.01, Math.min(1.0, value));
  }

  /**
   * Register callback for orientation updates
   * @param {function} callback - (yaw, pitch, roll) in degrees
   */
  onUpdate(callback) {
    this._onUpdate = callback;
  }

  /**
   * Register callback for connection status changes
   * @param {function} callback - (connected: boolean, info: string)
   */
  onStatusChange(callback) {
    this._onStatusChange = callback;
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  _connect() {
    try {
      this.ws = new WebSocket(this.wsUrl);
    } catch (e) {
      this._scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.connected = true;
      console.log(`[HeadTracker] Connected to ${this.wsUrl}`);
      this._notifyStatus();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'headtracking') {
          this._handleTrackingData(data);
        }
      } catch (e) {
        // Ignore parse errors
      }
    };

    this.ws.onclose = () => {
      this.connected = false;
      this._notifyStatus();
      this._scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after this
    };
  }

  _handleTrackingData(data) {
    if (!this.enabled) return;

    this.lastPacketTime = Date.now();
    this._ppsCounter++;
    
    // Store raw values based on configured axis mapping
    this.rawYaw   = data[this.axisSourceYaw] !== undefined ? data[this.axisSourceYaw] : (data.yaw || 0);
    this.rawPitch = data[this.axisSourcePitch] !== undefined ? data[this.axisSourcePitch] : (data.pitch || 0);
    this.rawRoll  = data[this.axisSourceRoll] !== undefined ? data[this.axisSourceRoll] : (data.roll || 0);
    this.rawTx = data.tx || 0;
    this.rawTy = data.ty || 0;
    this.rawTz = data.tz || 0;
    
    // Apply recenter offset
    let yaw = this.rawYaw - this.yawOffset;
    let pitch = this.rawPitch - this.pitchOffset;
    let roll = this.rawRoll - this.rollOffset;
    
    // Normalize yaw to [-180, 180]
    while (yaw > 180) yaw -= 360;
    while (yaw < -180) yaw += 360;

    // Apply per-axis inversion (flip the sign of the orientation value)
    if (this.invertYaw)   yaw   = -yaw;
    if (this.invertPitch) pitch = -pitch;
    if (this.invertRoll)  roll  = -roll;
    
    // Apply exponential moving average smoothing
    const s = this.smoothing;
    if (this.enableYaw)   this.yaw   = this.yaw   + s * (yaw   - this.yaw);
    else                  this.yaw   = this.yaw   + s * (0     - this.yaw);   // drift to 0 if disabled
    if (this.enablePitch) this.pitch = this.pitch + s * (pitch - this.pitch);
    else                  this.pitch = this.pitch + s * (0     - this.pitch);
    if (this.enableRoll)  this.roll  = this.roll  + s * (roll  - this.roll);
    else                  this.roll  = this.roll  + s * (0     - this.roll);

    // Positional / walking tracking (6-DoF translation in space)
    let pos = null;
    if (this.positionalEnabled) {
      const now = Date.now();
      // For positional/walking, use yaw invert to also flip walk direction
      const signX = this.invertYaw   ? -1 : 1;
      const signY = this.invertPitch ? -1 : 1;
      const signZ = this.invertRoll  ? -1 : 1;

      // 1. Direct OpenTrack translation (if OpenTrack transmits translation > 0.05cm)
      const hasDirectTranslation = Math.hypot(
        this.rawTx - this.txOffset,
        this.rawTy - this.tyOffset,
        this.rawTz - this.tzOffset
      ) > 0.05;

      let directX = 0, directY = 0, directZ = 0;
      if (hasDirectTranslation) {
        const scale = this.positionScale / 100;
        directX = (this.rawTx - this.txOffset) * scale * signX;
        directY = (this.rawTy - this.tyOffset) * scale * signY;
        directZ = (this.rawTz - this.tzOffset) * scale * signZ;
      }

      // 2. Earphone Inertial Step / Walking Detection Engine
      if (this.stepDetectionEnabled) {
        // High-pass filter: track slow posture baseline to isolate rhythmic step bounce
        this._pitchBaseline += 0.06 * (this.pitch - this._pitchBaseline);
        const bob = this.pitch - this._pitchBaseline;
        
        // Dynamic threshold scaled by Walking Sensitivity slider
        const threshold = Math.max(0.35, 3.2 / (this.positionScale || 5.0));
        const dtSinceLastStep = now - this.lastStepTime;

        // Step cycle: detect positive peak (head spring) followed by downward footstrike
        if (bob > threshold * 0.65) {
          this._stepPeak = Math.max(this._stepPeak, bob);
          this._inStepCycle = true;
        } else if (this._inStepCycle && bob < -threshold * 0.45) {
          // Footstep impact detected!
          if (dtSinceLastStep > 220 && dtSinceLastStep < 1300) {
            this.stepCount++;
            this.lastStepTime = now;
            this._isWalking = true;

            // Advance target walking position in direction of head yaw
            const yawRad = (this.yaw * Math.PI) / 180;
            const strideMeters = 0.30 * (this.positionScale / 5.0);
            const stepDeltaX = Math.sin(yawRad) * strideMeters * signX;
            const stepDeltaZ = Math.cos(yawRad) * strideMeters * signZ;

            this.walkTargetX += stepDeltaX;
            this.walkTargetZ += stepDeltaZ;

            if (this._onStep) {
              this._onStep(this.stepCount, this.walkTargetX, this.walkTargetZ);
            }
          }
          this._inStepCycle = false;
          this._stepPeak = 0;
        }

        // Reset step cycle if stalled
        if (dtSinceLastStep > 1500) {
          this._isWalking = false;
          this._inStepCycle = false;
        }

        // Smoothly interpolate current walk position toward target
        this.walkX += 0.16 * (this.walkTargetX - this.walkX);
        this.walkZ += 0.16 * (this.walkTargetZ - this.walkZ);

        // Natural vertical gait bounce on Y axis
        if (this._isWalking && dtSinceLastStep < 600) {
          const gaitProgress = Math.min(1, dtSinceLastStep / 400);
          this.walkY = Math.sin(gaitProgress * Math.PI * 2) * 0.04 * signY;
        } else {
          this.walkY += 0.15 * (0 - this.walkY);
        }
      }

      // 3. Neck Pivot Model (subtle ear translation when rotating head)
      let neckX = 0, neckZ = 0;
      if (this._neckModelEnabled) {
        const yawRad = (this.yaw * Math.PI) / 180;
        const neckRadius = 0.10 * (this.positionScale / 5.0);
        neckX = -Math.sin(yawRad) * neckRadius * signX;
        neckZ = (1 - Math.cos(yawRad)) * neckRadius * signZ;
      }

      // Combine all position components
      const combinedX = directX + this.walkX + neckX;
      const combinedY = directY + this.walkY;
      const combinedZ = directZ + this.walkZ + neckZ;

      // Smooth final position
      this.tx = this.tx + s * (combinedX - this.tx);
      this.ty = this.ty + s * (combinedY - this.ty);
      this.tz = this.tz + s * (combinedZ - this.tz);

      pos = { x: this.tx, y: this.ty, z: this.tz };
    }
    
    // Notify listener
    if (this._onUpdate) {
      this._onUpdate(this.yaw, this.pitch, this.roll, pos);
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, 2000);
  }

  _notifyStatus() {
    if (this._onStatusChange) {
      if (!this.enabled) {
        this._onStatusChange(false, 'Tracking Disabled (Standard Earbuds)');
        return;
      }
      const info = this.connected 
        ? `Connected (${this.packetsPerSecond} Hz)`
        : 'Disconnected — waiting for OpenTrack...';
      this._onStatusChange(this.connected, info);
    }
  }
}
