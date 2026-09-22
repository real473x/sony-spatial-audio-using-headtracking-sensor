/**
 * SpatialAudio Engine
 * 
 * Creates a virtual speaker ring using Web Audio API's HRTF PannerNodes.
 * Each channel of a multichannel audio file is routed to a virtual speaker
 * at the correct azimuth position. The AudioListener's orientation is updated
 * from head tracking data, so the sound field stays anchored in space.
 * 
 * Architecture is designed to be pluggable — the decoder can be swapped
 * for a Dolby Atmos decoder in the future without changing the renderer.
 */

// ─── Speaker Layouts ────────────────────────────────────────────────────────
// Azimuth in degrees (0 = front, negative = left, positive = right)
// Elevation in degrees (0 = ear level, positive = above)
// Distance in meters from listener

const SPEAKER_LAYOUTS = {
  'mono': [
    { name: 'Center', azimuth: 0, elevation: 0, distance: 2, shortName: 'C' }
  ],
  'stereo': [
    { name: 'Left',  azimuth: -30, elevation: 0, distance: 2, shortName: 'L' },
    { name: 'Right', azimuth:  30, elevation: 0, distance: 2, shortName: 'R' }
  ],
  '4.0': [
    { name: 'Front Left',  azimuth: -45,  elevation: 0, distance: 2, shortName: 'FL' },
    { name: 'Front Right', azimuth:  45,  elevation: 0, distance: 2, shortName: 'FR' },
    { name: 'Back Left',   azimuth: -135, elevation: 0, distance: 2, shortName: 'BL' },
    { name: 'Back Right',  azimuth:  135, elevation: 0, distance: 2, shortName: 'BR' }
  ],
  '5.1': [
    { name: 'Front Left',     azimuth: -30,  elevation: 0, distance: 2,   shortName: 'FL' },
    { name: 'Front Right',    azimuth:  30,  elevation: 0, distance: 2,   shortName: 'FR' },
    { name: 'Center',         azimuth:   0,  elevation: 0, distance: 2,   shortName: 'C' },
    { name: 'LFE',            azimuth:   0,  elevation: 0, distance: 1.1, shortName: 'LFE', isLFE: true },  // Subwoofer inside ring
    { name: 'Surround Left',  azimuth: -110, elevation: 0, distance: 2,   shortName: 'SL' },
    { name: 'Surround Right', azimuth:  110, elevation: 0, distance: 2,   shortName: 'SR' }
  ],
  '5.1.2': [
    { name: 'Front Left',       azimuth: -30,  elevation: 0,  distance: 2,   shortName: 'FL' },
    { name: 'Front Right',      azimuth:  30,  elevation: 0,  distance: 2,   shortName: 'FR' },
    { name: 'Center',           azimuth:   0,  elevation: 0,  distance: 2,   shortName: 'C' },
    { name: 'LFE',              azimuth:   0,  elevation: 0,  distance: 1.1, shortName: 'LFE', isLFE: true },
    { name: 'Surround Left',    azimuth: -110, elevation: 0,  distance: 2,   shortName: 'SL' },
    { name: 'Surround Right',   azimuth:  110, elevation: 0,  distance: 2,   shortName: 'SR' },
    { name: 'Top Front Left',   azimuth: -35,  elevation: 45, distance: 2.2, shortName: 'TFL', isHeight: true },
    { name: 'Top Front Right',  azimuth:  35,  elevation: 45, distance: 2.2, shortName: 'TFR', isHeight: true }
  ],
  '5.1.4': [
    { name: 'Front Left',       azimuth: -30,  elevation: 0,  distance: 2,   shortName: 'FL' },
    { name: 'Front Right',      azimuth:  30,  elevation: 0,  distance: 2,   shortName: 'FR' },
    { name: 'Center',           azimuth:   0,  elevation: 0,  distance: 2,   shortName: 'C' },
    { name: 'LFE',              azimuth:   0,  elevation: 0,  distance: 1.1, shortName: 'LFE', isLFE: true },
    { name: 'Surround Left',    azimuth: -110, elevation: 0,  distance: 2,   shortName: 'SL' },
    { name: 'Surround Right',   azimuth:  110, elevation: 0,  distance: 2,   shortName: 'SR' },
    { name: 'Top Front Left',   azimuth: -35,  elevation: 45, distance: 2.2, shortName: 'TFL', isHeight: true },
    { name: 'Top Front Right',  azimuth:  35,  elevation: 45, distance: 2.2, shortName: 'TFR', isHeight: true },
    { name: 'Top Rear Left',    azimuth: -145, elevation: 45, distance: 2.2, shortName: 'TRL', isHeight: true },
    { name: 'Top Rear Right',   azimuth:  145, elevation: 45, distance: 2.2, shortName: 'TRR', isHeight: true }
  ],
  '7.1': [
    { name: 'Front Left',   azimuth: -30,  elevation: 0, distance: 2,   shortName: 'FL' },
    { name: 'Front Right',  azimuth:  30,  elevation: 0, distance: 2,   shortName: 'FR' },
    { name: 'Center',       azimuth:   0,  elevation: 0, distance: 2,   shortName: 'C' },
    { name: 'LFE',          azimuth:   0,  elevation: 0, distance: 1.1, shortName: 'LFE', isLFE: true },  // Subwoofer inside ring
    { name: 'Back Left',    azimuth: -150, elevation: 0, distance: 2,   shortName: 'BL' },
    { name: 'Back Right',   azimuth:  150, elevation: 0, distance: 2,   shortName: 'BR' },
    { name: 'Side Left',    azimuth: -90,  elevation: 0, distance: 2,   shortName: 'SL' },
    { name: 'Side Right',   azimuth:  90,  elevation: 0, distance: 2,   shortName: 'SR' }
  ],
  '7.1.2': [
    { name: 'Front Left',       azimuth: -30,  elevation: 0,  distance: 2,   shortName: 'FL' },
    { name: 'Front Right',      azimuth:  30,  elevation: 0,  distance: 2,   shortName: 'FR' },
    { name: 'Center',           azimuth:   0,  elevation: 0,  distance: 2,   shortName: 'C' },
    { name: 'LFE',              azimuth:   0,  elevation: 0,  distance: 1.1, shortName: 'LFE', isLFE: true },
    { name: 'Back Left',        azimuth: -150, elevation: 0,  distance: 2,   shortName: 'BL' },
    { name: 'Back Right',       azimuth:  150, elevation: 0,  distance: 2,   shortName: 'BR' },
    { name: 'Side Left',        azimuth: -90,  elevation: 0,  distance: 2,   shortName: 'SL' },
    { name: 'Side Right',       azimuth:  90,  elevation: 0,  distance: 2,   shortName: 'SR' },
    { name: 'Top Front Left',   azimuth: -35,  elevation: 45, distance: 2.2, shortName: 'TFL', isHeight: true },
    { name: 'Top Front Right',  azimuth:  35,  elevation: 45, distance: 2.2, shortName: 'TFR', isHeight: true }
  ],
  '7.1.4': [
    // 8 Ear-Level Surround Channels (Elevation 0°)
    { name: 'Front Left',       azimuth: -30,  elevation: 0,  distance: 2,   shortName: 'FL' },
    { name: 'Front Right',      azimuth:  30,  elevation: 0,  distance: 2,   shortName: 'FR' },
    { name: 'Center',           azimuth:   0,  elevation: 0,  distance: 2,   shortName: 'C' },
    { name: 'LFE',              azimuth:   0,  elevation: 0,  distance: 1.1, shortName: 'LFE', isLFE: true },
    { name: 'Back Left',        azimuth: -150, elevation: 0,  distance: 2,   shortName: 'BL' },
    { name: 'Back Right',       azimuth:  150, elevation: 0,  distance: 2,   shortName: 'BR' },
    { name: 'Side Left',        azimuth: -90,  elevation: 0,  distance: 2,   shortName: 'SL' },
    { name: 'Side Right',       azimuth:  90,  elevation: 0,  distance: 2,   shortName: 'SR' },
    // 4 Overhead Height Channels (Elevation +45°, Y = +1.55m)
    { name: 'Top Front Left',   azimuth: -35,  elevation: 45, distance: 2.2, shortName: 'TFL', isHeight: true },
    { name: 'Top Front Right',  azimuth:  35,  elevation: 45, distance: 2.2, shortName: 'TFR', isHeight: true },
    { name: 'Top Rear Left',    azimuth: -145, elevation: 45, distance: 2.2, shortName: 'TRL', isHeight: true },
    { name: 'Top Rear Right',   azimuth:  145, elevation: 45, distance: 2.2, shortName: 'TRR', isHeight: true }
  ],
  '9.1.4': [
    { name: 'Front Left',        azimuth: -30,  elevation: 0,  distance: 2,   shortName: 'FL' },
    { name: 'Front Right',       azimuth:  30,  elevation: 0,  distance: 2,   shortName: 'FR' },
    { name: 'Center',            azimuth:   0,  elevation: 0,  distance: 2,   shortName: 'C' },
    { name: 'LFE',               azimuth:   0,  elevation: 0,  distance: 1.1, shortName: 'LFE', isLFE: true },
    { name: 'Back Left',         azimuth: -150, elevation: 0,  distance: 2,   shortName: 'BL' },
    { name: 'Back Right',        azimuth:  150, elevation: 0,  distance: 2,   shortName: 'BR' },
    { name: 'Front Left Center', azimuth: -15,  elevation: 0,  distance: 2,   shortName: 'FLC' },
    { name: 'Front Right Center',azimuth:  15,  elevation: 0,  distance: 2,   shortName: 'FRC' },
    { name: 'Side Left',         azimuth: -90,  elevation: 0,  distance: 2,   shortName: 'SL' },
    { name: 'Side Right',        azimuth:  90,  elevation: 0,  distance: 2,   shortName: 'SR' },
    { name: 'Top Front Left',    azimuth: -35,  elevation: 45, distance: 2.2, shortName: 'TFL', isHeight: true },
    { name: 'Top Front Right',   azimuth:  35,  elevation: 45, distance: 2.2, shortName: 'TFR', isHeight: true },
    { name: 'Top Rear Left',     azimuth: -145, elevation: 45, distance: 2.2, shortName: 'TRL', isHeight: true },
    { name: 'Top Rear Right',    azimuth:  145, elevation: 45, distance: 2.2, shortName: 'TRR', isHeight: true }
  ],
  '9.1.6': [
    { name: 'Front Left',        azimuth: -30,  elevation: 0,  distance: 2,   shortName: 'FL' },
    { name: 'Front Right',       azimuth:  30,  elevation: 0,  distance: 2,   shortName: 'FR' },
    { name: 'Center',            azimuth:   0,  elevation: 0,  distance: 2,   shortName: 'C' },
    { name: 'LFE',               azimuth:   0,  elevation: 0,  distance: 1.1, shortName: 'LFE', isLFE: true },
    { name: 'Back Left',         azimuth: -150, elevation: 0,  distance: 2,   shortName: 'BL' },
    { name: 'Back Right',        azimuth:  150, elevation: 0,  distance: 2,   shortName: 'BR' },
    { name: 'Front Left Center', azimuth: -15,  elevation: 0,  distance: 2,   shortName: 'FLC' },
    { name: 'Front Right Center',azimuth:  15,  elevation: 0,  distance: 2,   shortName: 'FRC' },
    { name: 'Side Left',         azimuth: -90,  elevation: 0,  distance: 2,   shortName: 'SL' },
    { name: 'Side Right',        azimuth:  90,  elevation: 0,  distance: 2,   shortName: 'SR' },
    { name: 'Top Front Left',    azimuth: -35,  elevation: 45, distance: 2.2, shortName: 'TFL', isHeight: true },
    { name: 'Top Front Right',   azimuth:  35,  elevation: 45, distance: 2.2, shortName: 'TFR', isHeight: true },
    { name: 'Top Rear Left',     azimuth: -145, elevation: 45, distance: 2.2, shortName: 'TRL', isHeight: true },
    { name: 'Top Rear Right',    azimuth:  145, elevation: 45, distance: 2.2, shortName: 'TRR', isHeight: true },
    { name: 'Top Middle Left',   azimuth: -90,  elevation: 55, distance: 2.2, shortName: 'TML', isHeight: true },
    { name: 'Top Middle Right',  azimuth:  90,  elevation: 55, distance: 2.2, shortName: 'TMR', isHeight: true }
  ],
  // ─── Ultra-High-Definition Layout: 22.2 (NHK / SMPTE 2036-2 UHD Audio) ────
  '22.2': [
    // Bottom / Floor Layer (Elevation -25°, 3 channels)
    { name: 'Bottom Front Left',    azimuth: -30,  elevation: -25, distance: 2.0, shortName: 'BFL', isBottom: true },
    { name: 'Bottom Front Center',  azimuth:   0,  elevation: -25, distance: 2.0, shortName: 'BFC', isBottom: true },
    { name: 'Bottom Front Right',   azimuth:  30,  elevation: -25, distance: 2.0, shortName: 'BFR', isBottom: true },
    // Middle / Ear-Level Layer (Elevation 0°, 10 channels)
    { name: 'Front Left',           azimuth: -30,  elevation: 0,   distance: 2.0, shortName: 'FL' },
    { name: 'Front Right',          azimuth:  30,  elevation: 0,   distance: 2.0, shortName: 'FR' },
    { name: 'Center',               azimuth:   0,  elevation: 0,   distance: 2.0, shortName: 'C' },
    { name: 'Front Left Center',    azimuth: -15,  elevation: 0,   distance: 2.0, shortName: 'FLC' },
    { name: 'Front Right Center',   azimuth:  15,  elevation: 0,   distance: 2.0, shortName: 'FRC' },
    { name: 'Side Left',            azimuth: -90,  elevation: 0,   distance: 2.0, shortName: 'SL' },
    { name: 'Side Right',           azimuth:  90,  elevation: 0,   distance: 2.0, shortName: 'SR' },
    { name: 'Back Left',            azimuth: -150, elevation: 0,   distance: 2.0, shortName: 'BL' },
    { name: 'Back Center',          azimuth:  180, elevation: 0,   distance: 2.0, shortName: 'BC' },
    { name: 'Back Right',           azimuth:  150, elevation: 0,   distance: 2.0, shortName: 'BR' },
    // Top / Ceiling Layer (Elevation +40° to +85°, 9 channels)
    { name: 'Top Front Left',       azimuth: -35,  elevation: 40,  distance: 2.2, shortName: 'TFL', isHeight: true },
    { name: 'Top Front Center',     azimuth:   0,  elevation: 40,  distance: 2.2, shortName: 'TFC', isHeight: true },
    { name: 'Top Front Right',      azimuth:  35,  elevation: 40,  distance: 2.2, shortName: 'TFR', isHeight: true },
    { name: 'Top Side Left',        azimuth: -90,  elevation: 40,  distance: 2.2, shortName: 'TSL', isHeight: true },
    { name: 'Top Side Right',       azimuth:  90,  elevation: 40,  distance: 2.2, shortName: 'TSR', isHeight: true },
    { name: 'Top Back Left',        azimuth: -145, elevation: 40,  distance: 2.2, shortName: 'TBL', isHeight: true },
    { name: 'Top Back Center',      azimuth:  180, elevation: 40,  distance: 2.2, shortName: 'TBC', isHeight: true },
    { name: 'Top Back Right',       azimuth:  145, elevation: 40,  distance: 2.2, shortName: 'TBR', isHeight: true },
    { name: 'Top Center (Zenith)',  azimuth:   0,  elevation: 85,  distance: 2.2, shortName: 'TC',  isHeight: true },
    // Subwoofer LFE Layer (2 Subwoofers)
    { name: 'LFE 1 (Front Sub)',    azimuth: -15,  elevation: 0,   distance: 1.1, shortName: 'LFE1', isLFE: true },
    { name: 'LFE 2 (Rear Sub)',     azimuth: 165,  elevation: 0,   distance: 1.1, shortName: 'LFE2', isLFE: true }
  ],
  // ─── Dolby AC-4 Object-Based Configurations ────────────────────────────────
  'ac4-core-objects': [
    { name: 'Dialog / Speech (Center)',   azimuth:   0, elevation: 0,  distance: 2.0, shortName: 'OBJ-DIA', isObject: true },
    { name: 'Dynamic Object 1 (Front L)', azimuth: -45, elevation: 15, distance: 2.1, shortName: 'OBJ-1',   isObject: true },
    { name: 'Dynamic Object 2 (Front R)', azimuth:  45, elevation: 15, distance: 2.1, shortName: 'OBJ-2',   isObject: true },
    { name: 'Dynamic Object 3 (Side L)',  azimuth: -105,elevation: 0,  distance: 2.2, shortName: 'OBJ-3',   isObject: true },
    { name: 'Dynamic Object 4 (Side R)',  azimuth:  105,elevation: 0,  distance: 2.2, shortName: 'OBJ-4',   isObject: true },
    { name: 'Dynamic Object 5 (Top L)',   azimuth: -40, elevation: 50, distance: 2.3, shortName: 'OBJ-5',   isHeight: true, isObject: true },
    { name: 'Dynamic Object 6 (Top R)',   azimuth:  40, elevation: 50, distance: 2.3, shortName: 'OBJ-6',   isHeight: true, isObject: true }
  ],
  'ac4-advanced-objects': [
    // 7.1.4 Bed (12 channels)
    { name: 'Front Left',                 azimuth: -30,  elevation: 0,  distance: 2.0, shortName: 'FL' },
    { name: 'Front Right',                azimuth:  30,  elevation: 0,  distance: 2.0, shortName: 'FR' },
    { name: 'Center',                     azimuth:   0,  elevation: 0,  distance: 2.0, shortName: 'C' },
    { name: 'LFE',                        azimuth:   0,  elevation: 0,  distance: 1.1, shortName: 'LFE', isLFE: true },
    { name: 'Back Left',                  azimuth: -150, elevation: 0,  distance: 2.0, shortName: 'BL' },
    { name: 'Back Right',                 azimuth:  150, elevation: 0,  distance: 2.0, shortName: 'BR' },
    { name: 'Side Left',                  azimuth: -90,  elevation: 0,  distance: 2.0, shortName: 'SL' },
    { name: 'Side Right',                 azimuth:  90,  elevation: 0,  distance: 2.0, shortName: 'SR' },
    { name: 'Top Front Left',             azimuth: -35,  elevation: 45, distance: 2.2, shortName: 'TFL', isHeight: true },
    { name: 'Top Front Right',            azimuth:  35,  elevation: 45, distance: 2.2, shortName: 'TFR', isHeight: true },
    { name: 'Top Rear Left',              azimuth: -145, elevation: 45, distance: 2.2, shortName: 'TRL', isHeight: true },
    { name: 'Top Rear Right',             azimuth:  145, elevation: 45, distance: 2.2, shortName: 'TRR', isHeight: true },
    // 4 Dynamic 3D Objects
    { name: 'Dynamic Object A (Free 3D)', azimuth: -60,  elevation: 25, distance: 2.3, shortName: 'DYN-A', isObject: true },
    { name: 'Dynamic Object B (Free 3D)', azimuth:  60,  elevation: 25, distance: 2.3, shortName: 'DYN-B', isObject: true },
    { name: 'Dynamic Object C (Zenith)',  azimuth:   0,  elevation: 75, distance: 2.4, shortName: 'DYN-C', isHeight: true, isObject: true },
    { name: 'Dynamic Object D (Flyby)',   azimuth: 180,  elevation: 35, distance: 2.4, shortName: 'DYN-D', isHeight: true, isObject: true }
  ],
  // ─── Dolby AC-4 Headphone / Portable Configuration (AC-4 IMS) ──────────────
  'ac4-ims': [
    { name: 'IMS Left Binaural Space',    azimuth: -75,  elevation: 0,  distance: 1.8, shortName: 'IMS-L', isVirtual: true },
    { name: 'IMS Right Binaural Space',   azimuth:  75,  elevation: 0,  distance: 1.8, shortName: 'IMS-R', isVirtual: true }
  ]
};

// ─── Helper: Convert azimuth/elevation/distance to 3D Cartesian ─────────────
function speakerToCartesian(azimuthDeg, elevationDeg, distance) {
  const azRad = (azimuthDeg * Math.PI) / 180;
  const elRad = (elevationDeg * Math.PI) / 180;
  return {
    x: distance * Math.sin(azRad) * Math.cos(elRad),
    y: distance * Math.sin(elRad),
    z: -distance * Math.cos(azRad) * Math.cos(elRad)  // Negative Z = forward
  };
}

// ─── Audio Engine Class ─────────────────────────────────────────────────────
export class AudioEngine {
  constructor() {
    this.audioContext = null;
    this.sourceNode = null;
    this.audioBuffer = null;
    this.splitter = null;
    this.panners = [];
    this.gains = [];
    this.masterGain = null;
    this.analyser = null;
    this.isPlaying = false;
    this.startTime = 0;
    this.pauseOffset = 0;
    this.duration = 0;
    this.layout = null;
    this.channelLevels = [];
    this.channelConfigs = []; // Per-channel volume, enabled, and gainDb
    this._onEndedCallback = null;
    this._seekUpdateInterval = null;

    this.targetLayout = 'auto';
    this.lastLoadedFile = null;
    this.topSpeakerHeightScale = 1.0;
    this.speakerScale = 1.0;         // room size multiplier (1.0 = default 2m radius)
    this.loopMode = 'none'; // 'none' | 'single' | 'all'
    this._onLoopCallback = null;

    // Custom Decoder Engine Toggles (Default: disabled unless user explicitly enables master toggle)
    this.useCustomDecoders = localStorage.getItem('spatial_use_custom_decoders') === 'true';
    this.useFFCodec = this.useCustomDecoders && (localStorage.getItem('spatial_use_ffcodec') !== 'false');
    this.useMPEGH = this.useCustomDecoders && (localStorage.getItem('spatial_use_mpegh') === 'true');

    // Solo & Axis Calibration State (supports multi-channel solo selection)
    this.soloedChannels = new Set(); // Set of active solo channel indices
    this.soloRouteAll = true;  // Route all audio channels into soloed speakers for testing
    this._testToneActive = false;
    this._testToneInterval = null;
    this._testTonePanner = null;

    // Smart Universal Decoder: Try native browser first, then server FFmpeg for anything else
    this.decoder = {
      name: 'smart-universal',
      decode: async (arrayBuffer, audioContext, fileName) => {
        const ext = (fileName || '').toLowerCase().split('?')[0];

        // Files browsers can natively decode (pure audio containers, no video mux)
        const nativeAudio = ext.endsWith('.wav')  || ext.endsWith('.flac') ||
                            ext.endsWith('.mp3')  || ext.endsWith('.ogg')  ||
                            ext.endsWith('.opus') || ext.endsWith('.weba') ||
                            ext.endsWith('.aac')  || ext.endsWith('.caf');

        // 1. Try native browser decode first for pure audio formats
        if (nativeAudio) {
          try {
            const nativeBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
            const ch = nativeBuffer.numberOfChannels;
            return {
              buffer: nativeBuffer,
              codec: ch > 2 ? `${ch}-Channel PCM/Audio` : (ch === 2 ? 'Stereo Audio' : 'Mono Audio'),
              isAtmos: ch >= 6
            };
          } catch (nativeErr) {
            console.warn('[AudioEngine] Native decode failed, trying FFmpeg:', nativeErr.message);
          }
        }

        // 2. All other files go through server FFmpeg.
        // Handles: .mp4, .mkv, .mov, .avi, .ts, .m2ts, .mts, .m4a, .wmv, .webm,
        //          .eac3, .ec3, .ac3, .dts, .thd, .truehd, .mka, .flv, .f4v ...
        let serverErrMsg = '';
        try {
          const res = await fetch('/api/decode-atmos', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'X-Filename': encodeURIComponent(fileName || 'audio.m4a'),
              'X-Target-Layout': this.targetLayout || 'auto',
              'X-Use-FFCodec': String(this.useFFCodec),
              'X-Use-MPEGH': String(this.useMPEGH)
            },
            body: arrayBuffer
          });

          if (res.ok) {
            const detectedCodec = decodeURIComponent(res.headers.get('X-Audio-Codec') || 'Decoded Audio');
            const wavData = await res.arrayBuffer();
            const decodedBuffer = await audioContext.decodeAudioData(wavData);
            const ch = decodedBuffer.numberOfChannels;
            return {
              buffer: decodedBuffer,
              codec: detectedCodec,
              isAtmos: ch >= 6
            };
          } else {
            try {
              const errObj = await res.json();
              if (errObj && errObj.isMPEGH) {
                const sampleRate = audioContext.sampleRate || 48000;
                const virtualBuffer = audioContext.createBuffer(12, sampleRate * 180, sampleRate);
                return {
                  buffer: virtualBuffer,
                  codec: 'Sony 360 Reality Audio (MPEG-H 3D)',
                  isAtmos: true,
                  isMPEGH: true,
                  mpeghAvailable: !!errObj.mpeghAvailable,
                  savedPath: errObj.savedPath,
                  channels: 12
                };
              }
              serverErrMsg = errObj.error || `HTTP ${res.status}`;
            } catch (_) {
              serverErrMsg = await res.text().catch(() => `HTTP ${res.status}`);
            }
            console.warn('[AudioEngine] Multichannel decoder error:', res.status, serverErrMsg);
          }
        } catch (serverErr) {
          serverErrMsg = serverErr.message;
          console.warn('[AudioEngine] Decoder server request failed:', serverErr.message);
        }

        // 3. Last resort: try native decode on anything
        try {
          const fallbackBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
          const ch = fallbackBuffer.numberOfChannels;
          return {
            buffer: fallbackBuffer,
            codec: ch > 2 ? 'Multichannel Audio' : 'Stereo Audio',
            isAtmos: ch >= 6
          };
        } catch {
          throw new Error(serverErrMsg || 'Unable to decode this file. Ensure FFmpeg is installed and the codec is supported.');
        }
      }
    };
    this.currentCodec = '';
    this.isAtmos = false;
  }

  async init() {
    if (this.audioContext) return;
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Master gain
    this.masterGain = this.audioContext.createGain();
    this.masterGain.gain.value = 0.8;
    
    // Gain Boost node for surround sound volume compensation
    this.boostGain = this.audioContext.createGain();
    this.boostGain.gain.value = 1.0;
    this.gainBoostEnabled = false;
    this.gainBoostDb = 6;

    // Soft limiter (DynamicsCompressor) to prevent clipping when boost is active
    this.limiter = this.audioContext.createDynamicsCompressor();
    this.limiter.threshold.setValueAtTime(-1.0, this.audioContext.currentTime);
    this.limiter.knee.setValueAtTime(0.0, this.audioContext.currentTime);
    this.limiter.ratio.setValueAtTime(20.0, this.audioContext.currentTime);
    this.limiter.attack.setValueAtTime(0.003, this.audioContext.currentTime);
    this.limiter.release.setValueAtTime(0.1, this.audioContext.currentTime);

    // Analyser for visualization
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    
    // Audio chain: masterGain -> boostGain -> limiter -> analyser -> destination
    this.masterGain.connect(this.boostGain);
    this.boostGain.connect(this.limiter);
    this.limiter.connect(this.analyser);
    this.analyser.connect(this.audioContext.destination);

    // Initial listener position
    this.listenerPos = { x: 0, z: 0 };
  }

  setCustomDecodersMaster(enabled) {
    this.useCustomDecoders = !!enabled;
    localStorage.setItem('spatial_use_custom_decoders', String(this.useCustomDecoders));
    this.useFFCodec = this.useCustomDecoders && (localStorage.getItem('spatial_use_ffcodec') !== 'false');
    this.useMPEGH = this.useCustomDecoders && (localStorage.getItem('spatial_use_mpegh') === 'true');
  }

  setDecoderEngineToggle(engineName, enabled) {
    if (engineName === 'ffcodec') {
      localStorage.setItem('spatial_use_ffcodec', String(enabled));
      this.useFFCodec = this.useCustomDecoders && enabled;
    } else if (engineName === 'mpegh') {
      localStorage.setItem('spatial_use_mpegh', String(enabled));
      this.useMPEGH = this.useCustomDecoders && enabled;
    }
  }

  /**
   * Register a custom decoder (for future Atmos support)
   * Decoder must implement: { name: string, decode(arrayBuffer, audioContext) => AudioBuffer }
   */
  setDecoder(decoder) {
    this.decoder = decoder;
    console.log(`[AudioEngine] Decoder set to: ${decoder.name}`);
  }

  async loadFile(file) {
    await this.init();
    this.stop();
    // Explicitly release previous AudioBuffer so GC can free memory before reading new file
    this.audioBuffer = null;

    const arrayBuffer = await file.arrayBuffer();
    
    try {
      const decodedResult = await this.decoder.decode(arrayBuffer, this.audioContext, file.name);
      if (decodedResult instanceof AudioBuffer) {
        this.audioBuffer = decodedResult;
        this.currentCodec = 'Native Audio';
        this.isAtmos = false;
      } else {
        this.audioBuffer = decodedResult.buffer;
        this.currentCodec = decodedResult.codec || 'Decoded Audio';
        this.isAtmos = !!decodedResult.isAtmos;
      }
    } catch (e) {
      console.error('[AudioEngine] Decode failed:', e);
      throw new Error(`Could not decode "${file.name}". ${e.message}`);
    }

    this.lastLoadedFile = file;
    this.duration = this.audioBuffer.duration;
    this.pauseOffset = 0;

    // Detect layout from channel count and targetLayout preference
    const channels = this.audioBuffer.numberOfChannels;
    if (this.targetLayout && SPEAKER_LAYOUTS[this.targetLayout] && SPEAKER_LAYOUTS[this.targetLayout].length === channels) {
      this.layout = SPEAKER_LAYOUTS[this.targetLayout];
    } else if (channels === 1) {
      this.layout = SPEAKER_LAYOUTS['mono'];
    } else if (channels === 2) {
      this.layout = (this.targetLayout === 'ac4-ims') ? SPEAKER_LAYOUTS['ac4-ims'] : SPEAKER_LAYOUTS['stereo'];
    } else if (channels === 4) {
      this.layout = SPEAKER_LAYOUTS['4.0'];
    } else if (channels === 6) {
      this.layout = SPEAKER_LAYOUTS['5.1'];
    } else if (channels === 7) {
      this.layout = SPEAKER_LAYOUTS['ac4-core-objects'];
    } else if (channels === 8) {
      this.layout = (this.targetLayout === '5.1.2') ? SPEAKER_LAYOUTS['5.1.2'] : SPEAKER_LAYOUTS['7.1'];
    } else if (channels === 10) {
      this.layout = (this.targetLayout === '5.1.4') ? SPEAKER_LAYOUTS['5.1.4'] : SPEAKER_LAYOUTS['7.1.2'];
    } else if (channels === 12) {
      this.layout = SPEAKER_LAYOUTS['7.1.4'];
    } else if (channels === 14) {
      this.layout = SPEAKER_LAYOUTS['9.1.4'];
    } else if (channels === 16) {
      this.layout = (this.targetLayout === 'ac4-advanced-objects') ? SPEAKER_LAYOUTS['ac4-advanced-objects'] : SPEAKER_LAYOUTS['9.1.6'];
    } else if (channels === 24) {
      this.layout = SPEAKER_LAYOUTS['22.2'];
    } else {
      // Fallback: distribute channels evenly
      this.layout = [];
      for (let i = 0; i < channels; i++) {
        const azimuth = -180 + (360 * i) / channels;
        this.layout.push({ name: `Ch ${i + 1}`, azimuth, elevation: 0, distance: 2 });
      }
    }

    // Initialize default channel configurations
    this.channelConfigs = this.layout.map(sp => ({
      name: sp.name,
      volume: 1.0,
      enabled: true,
      gainDb: 0
    }));

    console.log(`[AudioEngine] Loaded: ${file.name} (${channels}ch, ${this.audioBuffer.sampleRate}Hz, ${this.duration.toFixed(1)}s, ${this.currentCodec})`);
    console.log(`[AudioEngine] Layout: ${this.layout.map(s => s.name).join(', ')}`);
    
    return {
      channels,
      sampleRate: this.audioBuffer.sampleRate,
      duration: this.duration,
      layout: this.layout,
      channelConfigs: this.channelConfigs,
      codec: this.currentCodec,
      isAtmos: this.isAtmos
    };
  }

  /**
   * Set target layout for decoding and rendering
   */
  setTargetLayout(layoutName) {
    this.targetLayout = layoutName;
  }

  /**
   * Override the auto-detected layout
   */
  setLayout(layoutName) {
    if (SPEAKER_LAYOUTS[layoutName]) {
      this.layout = SPEAKER_LAYOUTS[layoutName];
      console.log(`[AudioEngine] Layout overridden to: ${layoutName}`);
    }
  }

  play() {
    if (!this.audioBuffer || this.isPlaying) return;
    
    this._buildAudioGraph();
    
    this.sourceNode.start(0, this.pauseOffset);
    this.startTime = this.audioContext.currentTime - this.pauseOffset;
    this.isPlaying = true;
    
    // Track seek position
    this._seekUpdateInterval = setInterval(() => {
      if (this._onSeekUpdate) {
        this._onSeekUpdate(this.getCurrentTime());
      }
    }, 100);
  }

  pause() {
    if (!this.isPlaying) return;
    
    this.pauseOffset = this.audioContext.currentTime - this.startTime;
    this.sourceNode.stop();
    this.isPlaying = false;
    this._cleanup();
  }

  stop() {
    if (this.sourceNode && this.isPlaying) {
      try { this.sourceNode.stop(); } catch(e) { /* ignore */ }
    }
    if (this.liveMediaStream) {
      try { this.liveMediaStream.getTracks().forEach(t => t.stop()); } catch(_) {}
      this.liveMediaStream = null;
    }
    this.isLiveStream = false;
    this.isPlaying = false;
    this.pauseOffset = 0;
    this._cleanup();
  }

  /**
   * Connect a live external audio stream (e.g. from Fraunhofer MPEG-H VVPlayer via desktop audio capture)
   * into the spatial audio engine, routing channels through the virtual speaker ring and analyser.
   * @param {MediaStream} mediaStream
   * @param {string} [preferredLayout='stereo']
   */
  connectLiveMediaStream(mediaStream, preferredLayout = 'stereo') {
    this.stop();
    this._initAudioContext();
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }
    
    this.liveMediaStream = mediaStream;
    this.isLiveStream = true;
    const ctx = this.audioContext;
    
    this.sourceNode = ctx.createMediaStreamSource(mediaStream);
    
    const target = (this.targetLayout && this.targetLayout !== 'auto' && SPEAKER_LAYOUTS[this.targetLayout])
      ? this.targetLayout 
      : (preferredLayout || 'stereo');
    this.layout = SPEAKER_LAYOUTS[target] || SPEAKER_LAYOUTS['stereo'];
    const layoutChannels = this.layout.length;
    
    this.channelConfigs = this.layout.map(sp => ({
      name: sp.name,
      volume: 1.0,
      enabled: true,
      gainDb: 0
    }));
    
    this.splitter = ctx.createChannelSplitter(Math.max(2, layoutChannels));
    this.sourceNode.connect(this.splitter);
    
    this.panners = [];
    this.gains = [];
    this.channelLevels = new Array(layoutChannels).fill(0);
    this._channelAnalysers = [];
    
    for (let i = 0; i < layoutChannels; i++) {
      const speaker = this.layout[i];
      if (speaker.isHeight) {
        if (speaker.baseElevation === undefined) speaker.baseElevation = speaker.elevation;
        speaker.elevation = speaker.baseElevation * this.topSpeakerHeightScale;
      }
      if (speaker.baseDistance === undefined) speaker.baseDistance = speaker.distance;
      speaker.distance = speaker.baseDistance * this.speakerScale;
      const pos = speakerToCartesian(speaker.azimuth, speaker.elevation, speaker.distance);
      
      const gain = ctx.createGain();
      gain.gain.value = 1.0;
      
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1;
      panner.maxDistance = 10;
      panner.rolloffFactor = 1;
      panner.coneInnerAngle = 360;
      panner.coneOuterAngle = 0;
      panner.coneOuterGain = 0;
      panner.positionX.setValueAtTime(pos.x, ctx.currentTime);
      panner.positionY.setValueAtTime(pos.y, ctx.currentTime);
      panner.positionZ.setValueAtTime(pos.z, ctx.currentTime);
      
      const channelAnalyser = ctx.createAnalyser();
      channelAnalyser.fftSize = 256;
      
      gain.connect(channelAnalyser);
      if (speaker.name === 'LFE' || speaker.isLFE) {
        channelAnalyser.connect(this.masterGain);
      } else {
        channelAnalyser.connect(panner);
        panner.connect(this.masterGain);
      }
      
      this.panners.push(panner);
      this.gains.push(gain);
      this._channelAnalysers.push(channelAnalyser);
      
      try {
        this.splitter.connect(gain, i % 2);
      } catch (_) {}
    }
    
    this.isPlaying = true;
    this.duration = Infinity;
    this.pauseOffset = 0;
    
    if (this._levelInterval) clearInterval(this._levelInterval);
    this._levelInterval = setInterval(() => this._updateLevels(), 50);
    console.log(`[AudioEngine] Live media stream hooked into layout: ${target} (${layoutChannels} channels)`);
  }

  disconnectLiveStream() {
    this.stop();
  }

  seek(time) {
    const wasPlaying = this.isPlaying;
    if (this.isPlaying) {
      try { this.sourceNode.stop(); } catch(e) { /* ignore */ }
      this.isPlaying = false;
      this._cleanup();
    }
    this.pauseOffset = Math.max(0, Math.min(time, this.duration));
    if (wasPlaying) {
      this.play();
    }
  }

  setVolume(value) {
    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(value, this.audioContext.currentTime, 0.02);
    }
  }

  /**
   * Set gain boost to compensate for lower surround sound track volume
   * @param {boolean} enabled
   * @param {number} db - Gain in decibels (e.g. 6 dB = ~2.0x amplitude)
   */
  setGainBoost(enabled, db = 6) {
    this.gainBoostEnabled = enabled;
    this.gainBoostDb = db;
    if (this.boostGain && this.audioContext) {
      const multiplier = enabled ? Math.pow(10, db / 20) : 1.0;
      this.boostGain.gain.setTargetAtTime(multiplier, this.audioContext.currentTime, 0.03);
    }
    // Update per-channel gains to apply or bypass per-channel gain boost
    this._updateAllChannelGains();
  }

  /**
   * Calculate effective channel gain combining volume, mute, and per-channel gain
   */
  _calculateEffectiveGain(channelIndex) {
    const cfg = this.channelConfigs[channelIndex];
    if (!cfg || !cfg.enabled) return 0;
    
    // Mutex: if global gainBoost is enabled, per-channel gain boost is bypassed (0 dB) to prevent clipping
    const boostDb = this.gainBoostEnabled ? 0 : (cfg.gainDb || 0);
    const multiplier = Math.pow(10, boostDb / 20);
    return Math.max(0, cfg.volume * multiplier);
  }

  _applyChannelGain(channelIndex) {
    if (this.gains && this.gains[channelIndex] && this.audioContext) {
      const target = this._calculateEffectiveGain(channelIndex);
      this.gains[channelIndex].gain.setTargetAtTime(target, this.audioContext.currentTime, 0.02);
    }
  }

  _updateAllChannelGains() {
    if (!this.gains) return;
    for (let i = 0; i < this.gains.length; i++) {
      this._applyChannelGain(i);
    }
  }

  setChannelVolume(channelIndex, volume) {
    if (!this.channelConfigs[channelIndex]) return;
    this.channelConfigs[channelIndex].volume = Math.max(0, Math.min(1, volume));
    this._applyChannelGain(channelIndex);
  }

  setChannelEnabled(channelIndex, enabled) {
    if (!this.channelConfigs[channelIndex]) return;
    this.channelConfigs[channelIndex].enabled = !!enabled;
    this._applyChannelGain(channelIndex);
  }

  setChannelGain(channelIndex, gainDb) {
    if (!this.channelConfigs[channelIndex]) return;
    this.channelConfigs[channelIndex].gainDb = Math.max(-24, Math.min(12, gainDb));
    this._applyChannelGain(channelIndex);
  }

  resetAllChannels() {
    this.soloedChannels.clear();
    for (let i = 0; i < this.channelConfigs.length; i++) {
      this.channelConfigs[i].volume = 1.0;
      this.channelConfigs[i].enabled = true;
      this.channelConfigs[i].gainDb = 0;
    }
    this._reconnectSplitter();
    this._updateAllChannelGains();
  }

  getChannelConfigs() {
    return this.channelConfigs;
  }

  /**
   * Toggle a channel's solo state (allowing multiple channels to be soloed simultaneously)
   * @param {number} channelIndex - Channel index (0..N-1)
   * @returns {number[]} Array of currently soloed channel indices
   */
  toggleSoloChannel(channelIndex) {
    if (channelIndex === undefined || channelIndex === null || channelIndex < 0) {
      return this.unsoloAll();
    }
    if (this.soloedChannels.has(channelIndex)) {
      this.soloedChannels.delete(channelIndex);
    } else {
      this.soloedChannels.add(channelIndex);
    }

    if (this.soloedChannels.size === 0) {
      for (let i = 0; i < this.channelConfigs.length; i++) {
        this.channelConfigs[i].enabled = true;
      }
    } else {
      for (let i = 0; i < this.channelConfigs.length; i++) {
        this.channelConfigs[i].enabled = this.soloedChannels.has(i);
      }
    }

    this._reconnectSplitter();
    this._updateAllChannelGains();
    return Array.from(this.soloedChannels);
  }

  /**
   * Set multiple channels to solo simultaneously
   * @param {number[]} channelIndices - Array of channel indices to solo, or [] to unsolo all
   * @returns {number[]} Array of currently soloed channel indices
   */
  setSoloChannels(channelIndices) {
    const valid = (channelIndices || []).filter(i => i >= 0 && i < this.channelConfigs.length);
    this.soloedChannels = new Set(valid);

    if (this.soloedChannels.size === 0) {
      for (let i = 0; i < this.channelConfigs.length; i++) {
        this.channelConfigs[i].enabled = true;
      }
    } else {
      for (let i = 0; i < this.channelConfigs.length; i++) {
        this.channelConfigs[i].enabled = this.soloedChannels.has(i);
      }
    }

    this._reconnectSplitter();
    this._updateAllChannelGains();
    return Array.from(this.soloedChannels);
  }

  /** Alias for toggleSoloChannel */
  soloChannel(channelIndex) {
    return this.toggleSoloChannel(channelIndex);
  }

  /**
   * Restore all channels to enabled (unsolo all)
   * @returns {number[]} Empty array
   */
  unsoloAll() {
    this.soloedChannels.clear();
    for (let i = 0; i < this.channelConfigs.length; i++) {
      this.channelConfigs[i].enabled = true;
    }
    this._reconnectSplitter();
    this._updateAllChannelGains();
    return [];
  }

  getSoloedChannels() {
    return Array.from(this.soloedChannels);
  }

  isChannelSoloed(channelIndex) {
    return this.soloedChannels.has(channelIndex);
  }

  hasActiveSolo() {
    return this.soloedChannels.size > 0;
  }

  /**
   * Enable/disable downmixing all audio channels into the soloed speaker's 3D position
   * Allows testing surround speaker positions with any audio file (even stereo).
   */
  setSoloRouteAll(enabled) {
    this.soloRouteAll = !!enabled;
    this._reconnectSplitter();
  }

  /**
   * Reconnect splitter outputs to channel gains according to multi-solo and routing mode
   */
  _reconnectSplitter() {
    if (!this.splitter || !this.gains || !this.audioBuffer) return;
    try {
      this.splitter.disconnect();
    } catch (_) {}

    const numChannels = this.audioBuffer.numberOfChannels;
    const layoutChannels = Math.min(numChannels, this.layout.length);

    if (this.hasActiveSolo() && this.soloRouteAll) {
      // Connect source channels into ALL active soloed channels' gain nodes
      for (const soloIdx of this.soloedChannels) {
        const targetGain = this.gains[soloIdx];
        if (targetGain) {
          for (let ch = 0; ch < numChannels; ch++) {
            try {
              this.splitter.connect(targetGain, ch);
            } catch (_) {}
          }
        }
      }
    } else {
      // Standard 1-to-1 channel mapping
      for (let i = 0; i < layoutChannels; i++) {
        if (this.gains[i]) {
          try {
            this.splitter.connect(this.gains[i], i);
          } catch (_) {}
        }
      }
    }
  }

  /**
   * Built-in Calibration Tone / Chirp generator for testing surround speaker positions and axes
   * @param {number} [channelIndex] - Speaker channel index (defaults to currently soloed or 0)
   */
  playTestTone(channelIndex) {
    this.stopTestTone();
    if (!this.audioContext) return;
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    const idx = (channelIndex !== undefined && channelIndex >= 0) ? channelIndex : (this.soloedChannel ?? 0);
    const speaker = this.layout ? (this.layout[idx] || this.layout[0]) : null;
    if (!speaker) return;

    const pos = speakerToCartesian(speaker.azimuth, speaker.elevation, speaker.distance || 2);
    
    // Create dedicated panner for calibration tone
    const panner = this.audioContext.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.positionX.setValueAtTime(pos.x, this.audioContext.currentTime);
    panner.positionY.setValueAtTime(pos.y, this.audioContext.currentTime);
    panner.positionZ.setValueAtTime(pos.z, this.audioContext.currentTime);

    const toneGain = this.audioContext.createGain();
    toneGain.gain.setValueAtTime(1.0, this.audioContext.currentTime);
    toneGain.connect(panner);
    panner.connect(this.masterGain);

    this._testToneActive = true;
    this._testTonePanner = panner;

    // Periodic pleasant spatial chirp (harmonics 440Hz + 880Hz)
    const playChirp = () => {
      if (!this._testToneActive || !this.audioContext) return;
      const t0 = this.audioContext.currentTime;
      const osc1 = this.audioContext.createOscillator();
      const osc2 = this.audioContext.createOscillator();
      const burstGain = this.audioContext.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, t0); // C5
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(1046.5, t0); // C6

      burstGain.gain.setValueAtTime(0.001, t0);
      burstGain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.04);
      burstGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.32);

      osc1.connect(burstGain);
      osc2.connect(burstGain);
      burstGain.connect(toneGain);

      osc1.start(t0);
      osc2.start(t0);
      osc1.stop(t0 + 0.35);
      osc2.stop(t0 + 0.35);
    };

    playChirp();
    this._testToneInterval = setInterval(playChirp, 750);
  }

  stopTestTone() {
    this._testToneActive = false;
    if (this._testToneInterval) {
      clearInterval(this._testToneInterval);
      this._testToneInterval = null;
    }
    if (this._testTonePanner) {
      try { this._testTonePanner.disconnect(); } catch (_) {}
      this._testTonePanner = null;
    }
  }

  /**
   * Set listener 3D Cartesian position (x: left/right, y: height, z: forward/back)
   * @param {number} x - meters (-X is left, +X is right)
   * @param {number} y - meters (+Y is up/height, -Y is down)
   * @param {number} z - meters (-Z is forward, +Z is back)
   */
  setListenerPosition(x, y, z) {
    if (z === undefined) {
      z = y;
      y = 0;
    }
    this.listenerPos = { x, y, z };
    if (!this.audioContext) return;
    const listener = this.audioContext.listener;
    const t = this.audioContext.currentTime;
    // In Web Audio API, listener forward is (0,0,-1), and speakers in front have negative Z.
    // In our visualizer/app coordinate space, forward is +Z.
    // Therefore, audio listener position Z must be negated (-z) so moving forward moves closer to front speakers.
    const audioZ = -z;
    if (listener.positionX) {
      listener.positionX.setValueAtTime(x, t);
      listener.positionY.setValueAtTime(y, t);
      listener.positionZ.setValueAtTime(audioZ, t);
    } else if (listener.setPosition) {
      listener.setPosition(x, y, audioZ);
    }
  }

  resetListenerPosition() {
    this.setListenerPosition(0, 0, 0);
  }

  /**
   * Set height scale for top / ceiling Atmos speakers (0.0 = floor level, 1.0 = normal 45° elevation)
   * @param {number} scale - Multiplier (0.0 to 1.5)
   */
  setTopSpeakerHeightScale(scale) {
    this.topSpeakerHeightScale = Math.max(0.0, Math.min(1.5, scale));
    if (!this.layout) return;
    this.layout.forEach((sp, i) => {
      if (sp.isHeight) {
        if (sp.baseElevation === undefined) sp.baseElevation = sp.elevation;
        sp.elevation = sp.baseElevation * this.topSpeakerHeightScale;
        if (this.panners && this.panners[i] && this.audioContext) {
          const pos = speakerToCartesian(sp.azimuth, sp.elevation, sp.distance);
          const t = this.audioContext.currentTime;
          this.panners[i].positionX.setValueAtTime(pos.x, t);
          this.panners[i].positionY.setValueAtTime(pos.y, t);
          this.panners[i].positionZ.setValueAtTime(pos.z, t);
        }
      }
    });
  }

  /**
   * Scale all speaker distances by a multiplier relative to their original layout distance.
   * Used to resize the virtual room — speakers move proportionally to the room radius.
   * @param {number} scale - Multiplier relative to default 2m radius (e.g. 2 = 4m radius, 0.5 = 1m radius)
   */
  setSpeakerScale(scale) {
    this.speakerScale = Math.max(0.1, scale);
    if (!this.layout) return;
    this.layout.forEach((sp, i) => {
      // Store the original layout distance once so we always scale from the source
      if (sp.baseDistance === undefined) sp.baseDistance = sp.distance;
      // Scale distance relative to original
      sp.distance = sp.baseDistance * this.speakerScale;
      if (this.panners && this.panners[i] && this.audioContext) {
        const pos = speakerToCartesian(sp.azimuth, sp.elevation, sp.distance);
        const t = this.audioContext.currentTime;
        this.panners[i].positionX.setValueAtTime(pos.x, t);
        this.panners[i].positionY.setValueAtTime(pos.y, t);
        this.panners[i].positionZ.setValueAtTime(pos.z, t);
      }
    });
    console.log(`[AudioEngine] Speaker scale set to ${this.speakerScale.toFixed(2)}x (distance: ~${(2 * this.speakerScale).toFixed(1)}m)`);
  }

  getCurrentTime() {
    if (!this.isPlaying) return this.pauseOffset;
    return this.audioContext.currentTime - this.startTime;
  }

  getChannelLevels() {
    return this.channelLevels;
  }

  getAnalyserData() {
    if (!this.analyser) return null;
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);
    return data;
  }

  /**
   * Update the AudioListener orientation from head tracking data
   * @param {number} yaw - Rotation around Y axis (left/right) in degrees
   * @param {number} pitch - Rotation around X axis (up/down) in degrees  
   * @param {number} roll - Rotation around Z axis (tilt) in degrees
   */
  updateListenerOrientation(yaw, pitch, roll) {
    if (!this.audioContext) return;
    
    const listener = this.audioContext.listener;
    
    // Convert degrees to radians
    const yawRad = (yaw * Math.PI) / 180;
    const pitchRad = (pitch * Math.PI) / 180;
    const rollRad = (roll * Math.PI) / 180;
    
    // Calculate forward vector (where the listener is facing)
    // Default forward is (0, 0, -1) in Web Audio convention
    const fx = Math.sin(yawRad) * Math.cos(pitchRad);
    const fy = -Math.sin(pitchRad);
    const fz = -Math.cos(yawRad) * Math.cos(pitchRad);
    
    // Calculate up vector
    // Default up is (0, 1, 0), rotated by roll around the forward axis
    const ux = -Math.sin(rollRad) * Math.cos(yawRad) + Math.cos(rollRad) * Math.sin(pitchRad) * Math.sin(yawRad);
    const uy = Math.cos(rollRad) * Math.cos(pitchRad);
    const uz = Math.sin(rollRad) * Math.sin(yawRad) + Math.cos(rollRad) * Math.sin(pitchRad) * Math.cos(yawRad);
    
    const t = this.audioContext.currentTime;
    
    // Use setValueAtTime for immediate update (lowest latency)
    if (listener.forwardX) {
      // Modern AudioListener API (AudioParam-based)
      listener.forwardX.setValueAtTime(fx, t);
      listener.forwardY.setValueAtTime(fy, t);
      listener.forwardZ.setValueAtTime(fz, t);
      listener.upX.setValueAtTime(ux, t);
      listener.upY.setValueAtTime(uy, t);
      listener.upZ.setValueAtTime(uz, t);
    } else {
      // Legacy API fallback
      listener.setOrientation(fx, fy, fz, ux, uy, uz);
    }
  }

  // ─── Private Methods ─────────────────────────────────────────────────────
  
  _buildAudioGraph() {
    const ctx = this.audioContext;
    const numChannels = this.audioBuffer.numberOfChannels;
    const layoutChannels = Math.min(numChannels, this.layout.length);
    
    // Source
    this.sourceNode = ctx.createBufferSource();
    this.sourceNode.buffer = this.audioBuffer;
    this.sourceNode.onended = () => {
      if (this.isPlaying) {
        if (this.loopMode === 'single') {
          // Seamless single-track repeat
          this.isPlaying = false;
          this.pauseOffset = 0;
          this._cleanup();
          this.play();
          if (this._onLoopCallback) this._onLoopCallback();
          return;
        }

        this.isPlaying = false;
        this.pauseOffset = 0;
        this._cleanup();
        if (this._onEndedCallback) this._onEndedCallback();
      }
    };
    
    // Split channels
    this.splitter = ctx.createChannelSplitter(numChannels);
    this.sourceNode.connect(this.splitter);
    
    // Create a panner + gain for each channel
    this.panners = [];
    this.gains = [];
    this.channelLevels = new Array(layoutChannels).fill(0);
    
    // Per-channel analysers for level metering
    this._channelAnalysers = [];
    
    for (let i = 0; i < layoutChannels; i++) {
      const speaker = this.layout[i];
      if (speaker.isHeight) {
        if (speaker.baseElevation === undefined) speaker.baseElevation = speaker.elevation;
        speaker.elevation = speaker.baseElevation * this.topSpeakerHeightScale;
      }
      // Apply current speaker scale (room size) – store baseDistance once per speaker
      if (speaker.baseDistance === undefined) speaker.baseDistance = speaker.distance;
      speaker.distance = speaker.baseDistance * this.speakerScale;
      const pos = speakerToCartesian(speaker.azimuth, speaker.elevation, speaker.distance);
      
      // Gain node for individual channel volume
      const gain = ctx.createGain();
      gain.gain.value = this._calculateEffectiveGain(i);
      
      // Panner node with HRTF
      const panner = ctx.createPanner();
      panner.panningModel = 'HRTF';
      panner.distanceModel = 'inverse';
      panner.refDistance = 1;
      panner.maxDistance = 10;
      panner.rolloffFactor = 1;
      panner.coneInnerAngle = 360;
      panner.coneOuterAngle = 0;
      panner.coneOuterGain = 0;
      panner.positionX.setValueAtTime(pos.x, ctx.currentTime);
      panner.positionY.setValueAtTime(pos.y, ctx.currentTime);
      panner.positionZ.setValueAtTime(pos.z, ctx.currentTime);
      
      // LFE channel: bypass HRTF (just send to center at full volume)
      // LFE is channel 3 in 5.1/7.1 layouts
      const isLFE = speaker.name === 'LFE';
      
      // Per-channel analyser for level metering
      const channelAnalyser = ctx.createAnalyser();
      channelAnalyser.fftSize = 256;
      
      // Wire: gain → analyser → panner → masterGain
      gain.connect(channelAnalyser);
      
      if (isLFE) {
        // LFE: skip HRTF, connect directly
        channelAnalyser.connect(this.masterGain);
      } else {
        channelAnalyser.connect(panner);
        panner.connect(this.masterGain);
      }
      
      this.panners.push(panner);
      this.gains.push(gain);
      this._channelAnalysers.push(channelAnalyser);
    }
    
    // Connect splitter outputs to gains (respecting solo and routing mode)
    this._reconnectSplitter();
    
    // Start level metering
    this._levelInterval = setInterval(() => this._updateLevels(), 50);
  }

  _updateLevels() {
    if (!this._channelAnalysers) return;
    for (let i = 0; i < this._channelAnalysers.length; i++) {
      const data = new Uint8Array(this._channelAnalysers[i].frequencyBinCount);
      this._channelAnalysers[i].getByteFrequencyData(data);
      // RMS-like average
      let sum = 0;
      for (let j = 0; j < data.length; j++) sum += data[j];
      this.channelLevels[i] = sum / (data.length * 255);
    }
  }

  _cleanup() {
    if (this._levelInterval) {
      clearInterval(this._levelInterval);
      this._levelInterval = null;
    }
    if (this._seekUpdateInterval) {
      clearInterval(this._seekUpdateInterval);
      this._seekUpdateInterval = null;
    }
    // Disconnect all audio nodes to allow browser WebAudio engine and GC to free memory
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch (_) {}
      this.sourceNode = null;
    }
    if (this.splitter) {
      try { this.splitter.disconnect(); } catch (_) {}
      this.splitter = null;
    }
    if (this.gains) {
      this.gains.forEach(g => { try { g.disconnect(); } catch (_) {} });
      this.gains = [];
    }
    if (this.panners) {
      this.panners.forEach(p => { try { p.disconnect(); } catch (_) {} });
      this.panners = [];
    }
    if (this._channelAnalysers) {
      this._channelAnalysers.forEach(a => { try { a.disconnect(); } catch (_) {} });
      this._channelAnalysers = [];
    }
  }

  setLoopMode(mode) {
    this.loopMode = mode; // 'none', 'single', 'all'
  }

  onLoop(callback) {
    this._onLoopCallback = callback;
  }

  onEnded(callback) {
    this._onEndedCallback = callback;
  }

  onSeekUpdate(callback) {
    this._onSeekUpdate = callback;
  }
}

export { SPEAKER_LAYOUTS, speakerToCartesian };
