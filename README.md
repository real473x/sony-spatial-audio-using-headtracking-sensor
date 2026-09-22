# 🎧 SpatialAudio — Head-Tracked Spatial Audio Player for Windows

[![Node.js](https://img.shields.io/badge/Node.js-v18+-68a063.svg?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Web Audio API](https://img.shields.io/badge/Web%20Audio-HRTF%20Spatial-blue.svg?style=flat-square)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
[![OpenTrack](https://img.shields.io/badge/OpenTrack-UDP%204242-ff6b6b.svg?style=flat-square)](https://github.com/opentrack/opentrack)
[![Built with AI](https://img.shields.io/badge/Built%20with-Gemini%20%7C%20Claude%20AI-orange.svg?style=flat-square)](#-ai--vibe-coding)
[![Vibe Coded](https://img.shields.io/badge/Vibe%20Coding-Active-ff69b4.svg?style=flat-square)](#-ai--vibe-coding)
[![References](https://img.shields.io/badge/References-Credits%20%26%20Attributions-brightgreen.svg?style=flat-square)](REFERENCES.md)
[![License](https://img.shields.io/badge/License-MIT-purple.svg?style=flat-square)](LICENSE)

A universal spatial audio player for Windows with real-time head tracking via UDP (OpenTrack protocol) — engineered and verified with the **Sony WF-1000XM5** head tracking sensor (supports direct UDP streaming with no OpenTrack software required), and compatible with any OpenTrack-supported tracking source or IMU — bringing Apple Spatial Audio-like experiences to Windows with full multichannel, surround sound, Dolby Atmos, Dolby AC-4, and 360 Reality Audio support.

---

## 🌟 Features

### 🌌 Dolby Atmos & Multichannel Decoding
- **Automatic Multi-Tier Decoder Pipeline**:
  - **Native Dolby AC-4 Atmos (C-FFI Engine)**: High-speed native decoding via `tools/ffcodec64.dll` using Koffi C-FFI. Seamlessly unpacks Dolby AC-4 bitstreams (`.m4a`, `.ac4`) directly into 12-channel / 32-bit float multichannel PCM WAV buffers.
  - **7.1.4 Object-Based Spatial Audio (OpenJOC & Cavernize)**: When [OpenJOC](https://github.com/chyinan/OpenJOC) (Rust) or [Cavernize](https://github.com/VoidXH/Cavern) (C#) is present in `tools/` or PATH, Atmos `.m4a` files with E-AC-3 JOC metadata are rendered into full **7.1.4 discrete channels (12 channels)** with 4 overhead height speakers.
  - **5.1 / 7.1 Surround Bed (FFmpeg Fallback)**: Automatically extracts discrete 6 or 8 channel beds using local FFmpeg in fractions of a second (< 0.2s).
- **Dedicated Overhead Height Layer**: 7.1.4 layouts render an elevated ceiling ring in 3D isometric perspective with diamond-shaped speaker nodes (`TFL`, `TFR`, `TRL`, `TRR`) on vertical connecting stems.
- **Top Speaker Height Slider**: Dynamically adjust the ceiling speaker elevation height from 0% (ear-level) to 150% in real time.

### ⚙️ Custom Decoders (Advanced & Hidden by Default)
- **Collapsible Drawer**: Tucked neatly below the *Credits & Open Source* section in the sidebar. Click **⚙️ Custom Decoders (Advanced)** to expand or collapse.
- **Master Safety Toggle**: **Use Custom Decoders** is disabled and hidden by default. Once turned on, users can independently toggle:
  - **Dolby AC-4 Atmos**: Native decoder engine (`🟢 Active` by default when custom decoders are on).
  - **360 RA & MPEG-H 3D**: Spatial engine toggle (`⚪ Disabled` by default) with quick-launch button for external 360 RA / MPEG-H 3D player.

### 🎯 Speaker Solo & Multi-Axis Calibration Suite
- **Interactive Multi-Speaker Soloing**: Isolate individual channels or speaker groups simultaneously for precise axis verification and soundstage alignment.
- **Quick Layer Presets**:
  - 🎛️ **Bed Layer**: Solos all ear-level surround and front channels.
  - ☁️ **Height Layer**: Solos all overhead Atmos ceiling channels (`TFL`, `TFR`, `TRL`, `TRR`).
  - ↔️ **Surrounds**: Solos side and rear surround speakers.
- **Auto-Cycle Speakers**: Automatically steps through all surround speakers sequentially (2.5s per speaker) for completely hands-free physical axis calibration.
- **Spatial Test Tone**: Emits a periodic binaural calibration chirp anchored directly at the soloed speaker's 3D spatial position.
- **Route Track Audio to Solo**: Optionally routes full music mix into the active solo channel(s) instead of silence on other channels.

### 🎛️ Sensor Axes & Mapping (OpenTrack)
- **Flexible Rotation Order**: Choose between `YXZ` (standard in OpenTrack; tested on Sony WF-1000XM5), `XYZ`, `XZY`, `YZX`, `ZXY`, and `ZYX` coordinate conventions.
- **Per-Axis Toggle & Invert**:
  - 🟢 **Yaw (Y)**: Turn left / right (with Invert toggle).
  - 🔴 **Pitch (X)**: Nod up / down (with Invert toggle).
  - 🔵 **Roll (Z)**: Tilt head left / right (with Invert toggle).

### 🎨 3D Isometric Perspective Visualizer
- **True 3D Spatial Canvas**: Real-time perspective showing floor ring with grid, cardinal compass markers, speaker elevations, and central LFE subwoofer.
- **3D Camera Orbiting**: Click and drag anywhere outside the listener avatar to rotate camera azimuth and tilt in 3D space.
- **Interactive 3D Draggable Listener**: Drag the listener avatar along the floor plane or along specific 3D axes (X, Y, Z).
- **Speaker Activity Glow**: Dynamic real-time glow reflecting instantaneous audio amplitude per channel.
- **Real-Time Spectrum Waveform**: Ambient frequency waveform ring drawn on the floor soundfield.

### 🔍 3D Plane Zoom Controls
- **Mouse Wheel Zoom**: Smoothly zoom in and out of the 3D visualizer canvas using the mouse scroll wheel.
- **On-Screen Zoom Buttons**: Direct `➕` (Zoom In) and `➖` (Zoom Out) buttons in the visualizer overlay.
- **Touch / Trackpad Pinch-to-Zoom**: Supports dual-touch pinch gestures on touchscreens and trackpads.
- **Reset View**: Instant `📐 Reset View` button (or `V` key) to restore default camera angles and 1.0x zoom.

### ⭕ Circle Boundary Limit Toggle (Move Outside Boundary)
- **On/Off Boundary Restriction**: Choose whether the listener is confined within the 2.0m speaker circle or free to explore outside.
  - **Clamped (Default)**: Keeps listener strictly inside the speaker perimeter sweet spot. Snaps back to boundary perimeter if toggled while outside.
  - **Free**: Allows moving and walking outside the circle boundary (up to 10m, fully supported by the Web Audio HRTF distance model).
- **Synchronized UI**: Toggle via the 3D plane overlay button (`⭕ Boundary: Clamped` / `🔓 Boundary: Free`), the sidebar switch (`Move Outside Circle`), or the `B` keyboard shortcut.
- **Visual Aids**: Faint extended concentric range circles (3.0m, 4.5m, 6.0m), dotted tether line back to center, and live `[OUTSIDE X.Xm]` HUD readout.

### 🎯 POV Gaze Focus & Active Speaker Highlight
- **Stable World Orientation**: The 3D virtual room, compass directions (`FRONT`, `BACK`, `LEFT`, `RIGHT`), and speaker layout remain stably positioned and easy to read.
- **Dynamic Gaze & Hearing Coverage**: As you turn your head, only your POV hearing cone and gaze beam sweep smoothly across the soundstage.
- **Active Speaker Targeting**: Highlights the speaker currently in your direct line of sight with a luminous gaze beam, target reticle, focus percentage badge, and live HUD level readout.
- **Convenient Controls**: Toggle via the 3D plane overlay button (`🎯 POV Focus: ON/Off`), the sidebar switch (`POV Gaze Focus`), or the `P` key shortcut.

### 🚶 3D Walking & POV Height Control
- **WASD Keyboard Walking**: Walk freely through the virtual room soundfield in real time. Coordinates automatically adjust relative to your head orientation.
- **Invert WASD Keys**: Option to reverse forward/backward or lateral walking controls.
- **POV Height (Y-Axis) Adjustment**: Use `↑` (Arrow Up) and `↓` (Arrow Down) keys or UI buttons to elevate or lower listener perspective height (from -1.5m to +2.5m).
- **Height Visualizer**: Displays a vertical connecting stem and floor shadow to indicate listener elevation relative to speakers.

### ✨ Spatial Movement Effects Suite
Automated listener POV trajectories that animate your position continuously throughout playback:
- 🌀 **Floor Orbit**: Sweeps the listener around the perimeter of all ear-level surround speakers (bypassing height channels).
- 🛸 **Mid-Air Orbit**: Sweeps in a circle centered midway between floor and height speakers.
- ☁️ **Height Orbit**: Sweeps through overhead height channels at the ceiling level.
- 🚀 **Height Elevator**: 3D vertical corkscrew ascending from floor to ceiling and swooping back down.
- 🌌 **Cosmic Vortex**: Breathing radial expansion in and out from center.
- 🛶 **Binaural Swing**: Soothing harmonic pendulum hammock sway across the soundfield.
- ♾️ **Infinity Loop**: Figure-8 diagonal crossfade sweep.
- 🌊 **Serpentine Wave**: Undulating 3D ribbon wave traversing room corners.
- 📍 **Speaker Tour**: Sequentially glides to each active speaker channel position.
- **Pace & Direction Controls**: Adjustable movement pace slider (0.2x to 3.0x), quick presets (0.5x, 1.0x, 2.0x), and orbit direction flip toggle (CW / CCW).

### 🔁 Queue & Loop Transport
- **Queue Management**: Add multiple audio files to a playlist queue; click any track to jump to it, drag to reorder, or remove tracks.
- **Loop Modes**:
  - **Loop Off**: Plays queue once and stops.
  - **Loop Track (🔂)**: Continuously repeats the current track.
  - **Loop All (🔁)**: Seamlessly loops the entire playlist.

### 🎯 Real-Time Head Tracking (Tested on Sony WF-1000XM5)
- **Anchored Soundstage**: Audio stays fixed in space as you turn your head (Yaw, Pitch, Roll), creating the illusion of sitting in a room with physical surround speakers.
- **Earphone Inertial Walking & 6-DoF Positional Tracking**: Since standard Bluetooth earphone sensors (tested with Sony WF-1000XM5) only stream 3-axis orientation angles (`yaw, pitch, roll`), SpatialAudio features a built-in **Inertial Gait & Step Detection Engine**. As you walk around your room, the player detects real-time head-bob dynamics and strides, smoothly translating your virtual POV in 3D (`x, y, z`) in the direction you are walking! Full direct 6-DoF translation (`tx, ty, tz`) from OpenTrack trackers is also seamlessly supported.
- **Ultra-Low Latency Pipeline**: OpenTrack UDP (48-byte stream @ 50–100 Hz) → Node.js bridge → WebSocket → Web Audio HRTF `AudioListener`.
- **Exponential Smoothing & Recentering**: Adjustable jitter reduction filter (5%–100%) and instant 1-key recentering (`R`).
- **Standard Headphones Mode**: Dedicated toggle to disable head tracking when using regular earbuds or headphones without sensors.

### 🔊 Surround Sound Gain Boost & Anti-Clipping
- **Multichannel Level Compensation**: Multichannel 5.1/7.1/Atmos mixes leave extra headroom. Toggle **Surround Gain Boost (+6 dB)** to match standard stereo loudness.
- **Built-in Soft Limiter**: Integrated `DynamicsCompressorNode` brickwall limiter prevents digital distortion and clipping.

### ⚙️ Expandable Channel Mixing Console
- **Per-Channel Volume**: Independent volume faders (0%–100%) for every active channel.
- **Per-Channel Mute/Solo**: Mute or isolate specific speakers on the fly.
- **Bipolar Channel Gain**: Fine-tune any channel's level from **-12 dB to +12 dB** in 0.5 dB precision steps.
- **Anti-Clipping Mutex**: Locks individual gain boost sliders when master boost is active to prevent clipping.

### 🎛️ Multichannel & Dolby Atmos Layout Selection
Supports dynamic layout selection and re-rendering:
- **Auto (Native)**: Automatically matches file channel count.
- **7.1.4 Dolby Atmos** (12ch: 7 Bed + LFE + 4 Heights)
- **7.1.2 Dolby Atmos** (10ch: 7 Bed + LFE + 2 Heights)
- **5.1.4 Dolby Atmos** (10ch: 5 Bed + LFE + 4 Heights)
- **5.1.2 Dolby Atmos** (8ch: 5 Bed + LFE + 2 Heights)
- **7.1 Surround** (8ch: 7 Bed + LFE)
- **5.1 Surround** (6ch: 5 Bed + LFE)
- **9.1.6 Dolby Atmos** (16ch: 9 Bed + LFE + 6 Heights)
- **9.1.4 Dolby Atmos** (14ch: 9 Bed + LFE + 4 Heights)
- **4.0 Quadraphonic** (4ch: Quad Bed)
- **2.0 Stereo** (2ch: Binaural Front L/R)

### 🌓 Dark & Light Mode Theme Switcher
- Crisp light mode and cyber-dark glassmorphism mode with persistent `localStorage` preference.

---

## 📡 Pipeline Architecture

SpatialAudio accepts the standardized 48-byte UDP telemetry stream (`127.0.0.1:4242`) either **directly** from `sony-head-tracker` or via **OpenTrack**:

```
┌───────────────────────────────────────┐
│       Sony WF-1000XM5 / WH-1000XM5    │
└───────────────────┬───────────────────┘
                    │ Bluetooth IMU Sensor Data
                    ▼
┌───────────────────────────────────────┐
│          sony-head-tracker            │
└───────────────────┬───────────────────┘
                    │
        ┌───────────┴────────────────────────┐
        │ Direct UDP (Default)               │ Optional Routing
        ▼                                    ▼
        │                         ┌───────────────────────┐
        │                         │       OpenTrack       │
        │                         │ (Custom Curves / Inp) │
        │                         └──────────┬────────────┘
        │                                    │ UDP (Port 4242)
        ▼                                    ▼
┌─────────────────────────────────────────────────────────┐
│    SpatialAudio Node.js Bridge (server.js UDP 4242)     │
└───────────────────────────┬─────────────────────────────┘
                            │ WebSocket (ws://localhost:8080)
                            ▼
┌─────────────────────────────────────────────────────────┐
│     SpatialAudio Browser Engine (Web Audio API HRTF)    │
└─────────────────────────────────────────────────────────┘
```

---

## 📦 Prerequisites

1. **Node.js** (v18 or higher) — [nodejs.org](https://nodejs.org)
2. **FFmpeg** — Required for automated multichannel decoding:
   ```powershell
   winget install Gyan.FFmpeg
   ```
   *Or install via Chocolatey (`choco install ffmpeg`) or download from [ffmpeg.org](https://ffmpeg.org/download.html).*
3. **Dolby AC-4 Decoder (Included via C-FFI)**:
   - Native decoding via `tools/ffcodec64.dll` is handled automatically through Koffi C-FFI when Custom Decoders are toggled on.
4. **OpenJOC or Cavernize (Optional — Unlocks 7.1.4 Object-Based Atmos)**:
   - **[OpenJOC](https://github.com/chyinan/OpenJOC)** (Recommended): Clean-room Rust decoder. Place `openjoc.exe` from [OpenJOC Releases](https://github.com/chyinan/OpenJOC/releases/latest) into `tools/` or your system `PATH`.
   - **[Cavernize](https://github.com/VoidXH/Cavern)**: C# spatial engine. Place `Cavernize.exe` from [Cavern Releases](https://github.com/VoidXH/Cavern/releases) into `tools/`.
5. **Head Tracking Device**:
   - **For Sony WF-1000XM5 / WH-1000XM5**: [NicholasSlattery/sony-head-tracker](https://github.com/NicholasSlattery/sony-head-tracker). *(OpenTrack is NOT required — streams directly over UDP 4242).*
   - **For Other Trackers (Webcam face-tracking, Phone IMU, TrackIR)**: [OpenTrack](https://github.com/opentrack/opentrack) + your tracker of choice (e.g. [AITrack](https://github.com/AIRLegend/aitrack)).

---

## 🚀 Quickstart Guide

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/your-username/spatial-audio-player.git
cd spatial-audio-player
npm install
```

### 2. Start Head Tracking

Choose your preferred tracker method:

* **Option A — Sony Headphones (Direct & Simplest — No OpenTrack required!)**:
  1. Pair your **WF-1000XM5** (or compatible Sony headphones) to Windows via Bluetooth.
  2. Launch **`sony-head-tracker.exe`**.
  3. That's it! `sony-head-tracker` detects your earbuds and streams orientation data directly over UDP (`127.0.0.1:4242`).

* **Option B — Other Trackers via OpenTrack (Webcam, Phone IMU, TrackIR)**:
  1. Launch **OpenTrack**.
  2. Set **Input** to your tracker (e.g., AITrack for webcam face tracking, or phone sensor).
  3. Set **Output** to **UDP over network** (Remote IP: `127.0.0.1`, Port: `4242`).
  4. Click **Start** in OpenTrack.

### 3. Start the Player
```bash
npm start
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser (Chrome, Edge, or Firefox). The indicator in the top header will turn green: **● Head Tracking Active**.

---

## 🎵 Supported Audio Formats

| Format | Extension | Channel Layouts | Description |
|--------|-----------|-----------------|-------------|
| **Dolby AC-4 Atmos** | `.m4a`, `.ac4` | **Up to 7.1.4 (12 Channels)** | Native bitstream decoding via `tools/ffcodec64.dll` with multichannel float PCM output |
| **Dolby Atmos 7.1.4 (Objects)** | `.m4a`, `.mp4` | **7.1.4 (12 Channels)** | Full object audio rendered via **OpenJOC** or **Cavernize** (8 surround + 4 height speakers) |
| **Dolby Atmos 5.1/7.1 (Bed)** | `.m4a`, `.mp4` | 5.1, 7.1 Surround Bed | Fast discrete surround bed decoding via **FFmpeg** |
| **Sony 360 Reality Audio** | `.mp4`, `.m4a` | MPEG-H 3D Audio | Stream detection with direct routing to 360 RA & MPEG-H 3D standalone player |
| WAV | `.wav` | Mono, Stereo, 5.1, 7.1, 7.1.4 | Uncompressed PCM, highest spatial fidelity |
| FLAC | `.flac` | Mono, Stereo, 5.1, 7.1 | Lossless compression |
| MP3 | `.mp3` | Stereo | Standard compressed audio |
| AAC / Apple Music | `.m4a`, `.aac` | Stereo, 5.1, 7.1 | Native AAC / multichannel Apple Music |
| OGG / Opus | `.ogg`, `.opus` | Stereo, 5.1 | Ogg Vorbis & Opus multichannel |
| WebM | `.webm`, `.weba`| Stereo, Multichannel | Web audio container |

---

## 🧭 7.1.4 Virtual Speaker Spatial Coordinates

SpatialAudio positions each channel in true 3D Euclidean space around the listener using Web Audio API HRTF:

| Channel Index | Channel Name | Short Tag | Azimuth | Elevation | Distance | Layer |
|:-------------:|:-------------|:---------:|:-------:|:---------:|:--------:|:------|
| 1 | Front Left | `FL` | -30° | 0° (Ear-level) | 2.0m | Bed Surround |
| 2 | Front Right | `FR` | +30° | 0° (Ear-level) | 2.0m | Bed Surround |
| 3 | Center | `C` | 0° | 0° (Ear-level) | 2.0m | Bed Surround |
| 4 | LFE (Subwoofer) | `LFE` | 0° | 0° (Ear-level) | 1.1m | Subwoofer (Inside Ring) |
| 5 | Back Left | `BL` | -150° | 0° (Ear-level) | 2.0m | Bed Surround |
| 6 | Back Right | `BR` | +150° | 0° (Ear-level) | 2.0m | Bed Surround |
| 7 | Side Left | `SL` | -90° | 0° (Ear-level) | 2.0m | Bed Surround |
| 8 | Side Right | `SR` | +90° | 0° (Ear-level) | 2.0m | Bed Surround |
| 9 | Top Front Left | `TFL` | -35° | +45° (Overhead) | 2.2m | **7.1.4 Height Layer** |
| 10 | Top Front Right | `TFR` | +35° | +45° (Overhead) | 2.2m | **7.1.4 Height Layer** |
| 11 | Top Rear Left | `TRL` | -145° | +45° (Overhead) | 2.2m | **7.1.4 Height Layer** |
| 12 | Top Rear Right | `TRR` | +145° | +45° (Overhead) | 2.2m | **7.1.4 Height Layer** |

---

## 🎧 Head Tracking Setup Guide (Tested on Sony WF-1000XM5)

> 💡 **Direct Streaming vs. OpenTrack**:
> - **Sony WF-1000XM5 / WH-1000XM5**: `sony-head-tracker.exe` streams **directly** to SpatialAudio on UDP port 4242. You do **not** need OpenTrack running at all!
> - **Other Trackers (Webcam, Phone IMU, TrackIR)**: Use **OpenTrack** to translate your tracker's movement into UDP port 4242.

### Method 1: Direct Streaming with Sony Headphones (Recommended & Easiest)
1. **Pair Headphones**: Turn on Bluetooth on Windows and pair your **WF-1000XM5** earbuds (or WH-1000XM5 headphones).
2. **Run `sony-head-tracker.exe`**: Download and launch [sony-head-tracker.exe](https://github.com/NicholasSlattery/sony-head-tracker). It will detect your headphones and immediately stream 48-byte UDP packets to `127.0.0.1:4242`.
3. **Launch SpatialAudio**:
   ```bash
   npm start
   ```
   Open **[http://localhost:3000](http://localhost:3000)**. The header indicator will instantly turn green: **● Head Tracking Active**.

### Method 2: Setup via OpenTrack (For Other Trackers or Custom Curves)
1. Launch **OpenTrack**.
2. **Input**: Select your tracking input (e.g. AITrack for webcam face tracking, TrackIR, or phone IMU).
3. **Output**: Select **UDP over network**. In settings, ensure Port is `4242` and IP is `127.0.0.1`.
4. Click **Start** in OpenTrack.
5. Launch SpatialAudio with `npm start` and open **[http://localhost:3000](http://localhost:3000)**.

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Space`  | Play / Pause audio playback |
| `R`      | Recenter head tracking orientation and listener position |
| `V`      | Reset 3D camera view and zoom to default |
| `B`      | Toggle Circle Boundary Limit (Free / Clamped) |
| `P`      | Toggle POV Gaze Focus & active speaker targeting |
| `+` / `=`| Zoom In 3D plane |
| `-` / `_`| Zoom Out 3D plane |
| `W`, `A`, `S`, `D` | Walk through virtual soundfield in 3D |
| `↑` (Arrow Up) | Elevate POV height (+Y axis) |
| `↓` (Arrow Down) | Lower POV height (-Y axis) |
| `Mouse Scroll` | Smooth zoom in / out on visualizer plane |
| `Mouse Drag` | Drag listener head (inside head) or rotate camera (outside head) |

---

## 🛠️ Troubleshooting & FAQ

### Q: Head Tracking status shows "Disconnected" in red.
- Ensure `npm start` is running in your terminal.
- Check that OpenTrack is running and that you clicked **Start**.
- Verify OpenTrack output is set to **UDP over network** on `127.0.0.1` port `4242`.
- Check if your firewall is blocking UDP port 4242 or WebSocket port 8080 on localhost.

### Q: How do I enable Dolby AC-4 decoding?
- Expand **⚙️ Custom Decoders (Advanced)** at the bottom of the sidebar (under *Credits & Open Source*).
- Switch on **Use Custom Decoders**. The **Dolby AC-4 Atmos** engine will turn `🟢 Active`.
- When loading any `.m4a` or `.ac4` track with Dolby AC-4 streams, the native C-FFI decoder (`tools/ffcodec64.dll`) will decode the file directly into multichannel PCM.

### Q: What happens with Sony 360 Reality Audio (.mp4 / .m4a)?
- Sony 360 Reality Audio files use the MPEG-H 3D audio format (`mhm1`).
- When detected, SpatialAudio automatically preserves the stream and launches the installed **360 RA & MPEG-H 3D Player** so you can hear the dedicated 3D mix.

### Q: Why does my Atmos .m4a show 5.1/7.1 instead of 7.1.4?
- By default, standard FFmpeg decodes the discrete 5.1 or 7.1 surround bed channels.
- To unlock full **7.1.4 object audio rendering with overhead height channels**:
  1. Download **`openjoc.exe`** from [OpenJOC Releases](https://github.com/chyinan/OpenJOC/releases/latest) (Recommended) or **`Cavernize.exe`** from [Cavern Releases](https://github.com/VoidXH/Cavern/releases).
  2. Drop `openjoc.exe` or `Cavernize.exe` into the `tools/` folder in this repository (or add to your Windows `PATH`).
  3. Restart `npm start`. The server will print `OpenJOC: ✅ Available` and the web UI will display `Active (7.1.4)`.

### Q: Multichannel audio sounds too quiet compared to regular music.
- Multichannel master recordings leave extra headroom (typically -6 dB to -10 dB) across channels to prevent clipping during summing.
- Turn on the **Surround Gain Boost (+6 dB)** toggle in the sidebar. An integrated brickwall limiter (`DynamicsCompressorNode`) prevents any digital distortion.

### Q: Can I use regular wired headphones or standard Bluetooth earbuds?
- **Yes!** Toggle off **Head Tracking** in the sidebar. SpatialAudio will render full binaural 3D surround sound with the fixed soundstage centered in front of you.

---

## 🗂️ Project Structure

```
├── index.html              # Modern, accessible player interface with 3D overlay controls
├── index.css               # Premium dark & light themes, animations, glassmorphism
├── server.js               # UDP bridge, WebSocket streamer, C-FFI decoders, and audio API
├── package.json            # Node.js project manifest and scripts
├── README.md               # Complete documentation
├── REFERENCES.md           # Comprehensive references, citations, and upstream credits
├── tools/
│   ├── ffcodec64.dll       # Native Dolby AC-4 & multichannel decoder engine
│   ├── openjoc.exe         # (Optional) OpenJOC 7.1.4 Atmos object audio renderer
│   └── Cavernize.exe       # (Optional) Cavernize 7.1.4 Atmos object audio renderer
└── src/
    ├── app.js              # Application controller, keyboard shortcuts, effects, queue, decoders UI
    ├── audio-engine.js     # Web Audio API HRTF virtual speaker ring (up to 7.1.4)
    ├── ac4-decoder.js      # Koffi C-FFI wrapper around ffcodec64.dll
    ├── head-tracker.js     # WebSocket client, smoothing filter, recenter offset, 6-DoF gait engine
    └── visualizer.js       # 3D isometric perspective canvas visualizer, zoom, & effects HUD
```

---

## 🙌 Credits & Acknowledgements

> 📖 **Full Attribution Details**: For an exhaustive, in-depth breakdown of all upstream projects, reverse-engineering papers, research code, specifications, and third-party references, please read **[REFERENCES.md](REFERENCES.md)**.
>
> *(Note: A direct in-browser Web Bluetooth / WebHID sensor client was evaluated but removed because Windows pairs the Sony XM5 strictly as an audio device and isolates the HID sensor from browser pickers without native driver rebinding. The reliable OpenTrack + sony-head-tracker UDP pipeline is the supported standard).*

SpatialAudio is built on the shoulders of brilliant researchers, audio engineers, and open-source developers:

- **[NicholasSlattery/sony-head-tracker](https://github.com/NicholasSlattery/sony-head-tracker)** by Nicholas Slattery — Reverse-engineered Sony WF-1000XM5 / WH-1000XM5 Bluetooth LE telemetry and discovered the Android Head Tracker HID protocol implementation on Windows. Essential foundation for reading the Sony IMU stream.
- **[opentrack/opentrack](https://github.com/opentrack/opentrack)** — The standard open-source head tracking suite, providing the UDP 4242 floating-point orientation protocol and Accela filter reference.
- **[chyinan/OpenJOC](https://github.com/chyinan/OpenJOC)** by chyinan — Clean-room E-AC-3 JOC decoder in Rust with OAMD metadata parsing and 12-channel 7.1.4 Dolby Atmos reconstruction.
- **[VoidXH/Cavern](https://github.com/VoidXH/Cavern)** by VoidXH — Pioneering reverse-engineering of Dolby Digital Plus with Joint Object Coding (E-AC-3 JOC) on Windows.
- **[FFmpeg](https://ffmpeg.org)** — The Swiss Army knife of multimedia for high-performance multichannel bed extraction and container demuxing.
- **[koffi](https://koffi.dev)** by Damian Stewart — Fast C-FFI for Node.js powering our native AC-4 decoder integration.
- **[websockets/ws](https://github.com/websockets/ws)** — Ultra-low-latency WebSocket server streaming 100 Hz sensor packets to the browser.
- **[expressjs/express](https://github.com/expressjs/express)** — High-reliability web server for local player delivery.
- **[W3C Web Audio API](https://www.w3.org/TR/webaudio/)** — Standard HRTF binaural spatialization and dynamics processing.
- **[Android Open Source Project (AOSP)](https://source.android.com/docs/core/audio/spatial-audio#head-tracking)** — Standard spatial audio head tracking HID descriptor specification.

### 🤖 AI & Vibe Coding

This project was built and vibe coded using Gemini and Claude AI.

---

## 📄 License

MIT License — free for personal and commercial use.
