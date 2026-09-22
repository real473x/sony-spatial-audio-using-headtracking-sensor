# 🚀 SpatialAudio — Architectural Roadmap & Next Improvements

This document outlines the architectural roadmap for **SpatialAudio**, categorizing current web application boundaries and detailing how future improvements can be achieved through a **native Windows application**.

---

## 📑 Table of Contents
1. [Status & Boundary Analysis: Web App vs. Windows Desktop](#-status--boundary-analysis-web-app-vs-windows-desktop)
   - [Current Web App: Feature-Complete Status](#current-web-app-feature-complete-status)
   - [Why Further Improvements Cannot Proceed in a Pure Web App](#why-further-improvements-cannot-proceed-in-a-pure-web-app)
2. [Category 1: Standalone Windows Desktop Application](#-category-1-standalone-windows-desktop-application)
   - [Web App Limitation Addressed](#web-app-limitation-addressed-1)
   - [Electron vs. Tauri Implementation Matrix](#electron-vs-tauri-implementation-matrix)
   - [Background Daemon Management (OpenTrack & Sony Tracker)](#background-daemon-management-opentrack--sony-tracker)
   - [Integration with Fraunhofer MPEG-H VVPlayer](#integration-with-fraunhofer-mpeg-h-vvplayer)
3. [Category 2: Real-Time Virtual Audio Cable & WASAPI Loopback Routing](#-category-2-real-time-virtual-audio-cable--wasapi-loopback-routing)
   - [Web App Limitation Addressed](#web-app-limitation-addressed-2)
   - [How It Can Be Done as a Windows Native Application](#how-it-can-be-done-as-a-windows-native-application)
   - [Architecture Pipeline](#architecture-pipeline)
   - [Latency Analysis (< 20ms End-to-End)](#latency-analysis--20ms-end-to-end)
   - [Key Advantages over File-Based Decoding](#key-advantages-over-file-based-decoding)

---

## 🧭 Status & Boundary Analysis: Web App vs. Windows Desktop

### Current Web App: Feature-Complete Status
The current web-based player (`server.js` + `index.html`) operates at the maximum theoretical capability allowable by the **W3C Web Audio API** and modern browser security models:
* ✅ **Multi-Tier Audio Decoders**: Native Dolby AC-4 (C-FFI via `ffcodec64.dll`), 7.1.4 Dolby Atmos (OpenJOC/Cavernize), 5.1/7.1 beds (FFmpeg), and Sony 360RA detection.
* ✅ **3D Perspective Visualizer**: 6-DoF Three.js canvas with camera orbiting, zoom controls, WASD walking, POV gaze targeting, and elevation stem.
* ✅ **Head Tracking**: OpenTrack UDP pipeline with Accela-style exponential smoothing, recentering, and inertial step detection (tested on Sony WF-1000XM5).
* ✅ **Mixing & Calibration Suite**: Multi-speaker soloing, spatial calibration chirps, bipolar channel faders, and anti-clipping limiter.

### Why Further Improvements Cannot Proceed in a Pure Web App
Attempting to build system-level features inside the browser hits hard architectural walls:
1. **Chromium's 2-Channel (Stereo) Input Ceiling**:
   Chromium's audio input architecture (`audio_input_controller.cc`) restricts both `getUserMedia()` and `getDisplayMedia()` to a maximum of **2 channels (stereo)**. Even if a 7.1 virtual cable is present in Windows, the browser downmixes or discards all surround channels (Center, Surrounds, Heights, LFE).
2. **Inability to Register Hardware / Kernel Drivers**:
   Web applications run in a strict sandbox and cannot register virtual sound cards, WDM/KS audio endpoints, or Windows Audio Processing Objects (APOs).
3. **Loopback Audio Feedback**:
   Browser audio capture cannot capture system output without creating an immediate acoustic/digital feedback loop unless an external virtual audio sink device is installed at the OS level.
4. **No Process Lifecycle Control**:
   A web browser tab cannot silently check, launch, or terminate background helper processes like `sony-head-tracker.exe` or `OpenTrack.exe`.

> 📌 **Engineering Verdict**: The web application phase is finalized. All future improvements listed below must be implemented as a **native Windows application** to access OS-level audio engines and Win32 process management APIs.

---

## 🖥️ Category 1: Standalone Windows Desktop Application

### Web App Limitation Addressed
Currently, running SpatialAudio requires opening a terminal, executing `npm start`, keeping the Node.js console open, opening a web browser, and manually launching `sony-head-tracker.exe` and `OpenTrack.exe`. 

### Windows Application Solution
A standalone Windows desktop application packages the entire stack into a single clickable executable (`SpatialAudio.exe`) with a system tray icon, window management, and native process supervision.

### Electron vs. Tauri Implementation Matrix

| Feature | Electron (Recommended for Rapid Transition) | Tauri (Recommended for Minimal Footprint) |
|---|---|---|
| **Core Architecture** | Chromium runtime + embedded Node.js | Windows WebView2 + Rust native backend |
| **Code Changes Required** | **Minimal**: Wraps existing `server.js` and `index.html` directly with zero UI refactoring. | Moderate: Port UDP socket listener and C-FFI decoders to Rust. |
| **Executable Size** | ~80 – 100 MB | ~10 – 15 MB |
| **RAM Usage** | ~120 – 180 MB | ~30 – 50 MB |
| **Win32 OS APIs** | Native Node.js C-FFI (`koffi`), Win32 window APIs. | Full Rust Windows API crates (`windows-rs`). |

### Background Daemon Management & Direct Sensor Access (Approach B & Approach A)
Unlike a browser tab, the native desktop application provides **direct sensor access** and automatic supervision:
* **Approach B (Primary — In-Process Win32 Direct HID Driver)**:
  - Connects directly to the Windows HID stack (`hid.dll`, `setupapi.dll`, `kernel32.dll`) via `koffi` running in a dedicated Node.js `worker_threads` worker.
  - Automatically identifies Sony WF-1000XM5 / WH-1000XM5 via Usage Page `0x0020` and Usage `0x00E1` (`#AndroidHeadTracker#1.0`).
  - Transmits the 40-byte wake Feature Report #1 (`HidP_SetScaledUsageValue` interval 40ms, `HidP_SetUsages` Full Power & All Events reporting).
  - Reads raw 14-byte input reports asynchronously, calculates normalized quaternions and Euler angles (yaw, pitch, roll), and streams them with zero external GUI windows.
* **Approach A (Fallback — Silent Headless Background Bridge)**:
  - If direct Win32 HID access encounters driver isolation, the desktop app automatically falls back to `sony-head-tracker.exe bridge --port 4242` with `windowsHide: true`.
  - Runs completely silent and invisible in the background with zero taskbar or window footprint.
* On SpatialAudio exit, cleanly terminates all workers, UDP handles, and child processes to release Bluetooth telemetry and system resources.

### Integration with Fraunhofer MPEG-H VVPlayer
Because Fraunhofer's MPEG-H 3D decoder is compiled statically inside `MPEG-H VVPlayer.exe` (without exposing an exportable C DLL API), running as a Windows desktop application provides Win32 window automation:
* **Docking / Embedding**: Using Win32 APIs (`SetParent`, `MoveWindow`), the desktop app can embed the external MPEG-H VVPlayer interface directly inside a docked sub-panel within the SpatialAudio window.
* **IPC Control**: Control playback, seek, and volume in VVPlayer using Windows message passing (`WM_COMMAND`, hotkeys, or named pipes).

---

## 🎛️ Category 2: Real-Time Virtual Audio Cable & WASAPI Loopback Routing

### Web App Limitation Addressed
A web app cannot act as a Windows audio output device. To listen to external media (games, Netflix, YouTube, media players), audio files must currently be manually imported into the web app's local playlist.

### How It Can Be Done as a Windows Native Application
In a native Windows desktop architecture, SpatialAudio can function as a **live spatial audio rendering endpoint** for any Windows software by pairing with a virtual audio cable driver and capturing multichannel audio directly via the **Windows Audio Session API (WASAPI)**.

### Architecture Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│  Source Player / OS (PotPlayer, VLC, Netflix, Games)        │
│  - Decodes Dolby Atmos, AC-4, MPEG-H 3D, 7.1 Surround       │
│  - Outputs discrete multichannel PCM (e.g., 7.1 / 8 channels) │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  Virtual Multichannel Audio Device                          │
│  - VB-Audio Hi-Fi Cable / VAC (configured as 7.1 Surround)  │
│  - Receives master system audio stream from Windows         │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  SpatialAudio Native WASAPI Capture Engine                  │
│  - Captures 8 discrete channels in real-time float32 PCM    │
│  - Avoids browser downmixing via native IAudioClient COM    │
│  - Streams discrete blocks to HRTF 3D spatializer           │
│  - Applies head tracking orientation (tested on Sony XM5)   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│  Physical Audio Output (Headphones / Earbuds)               │
│  - Real-time Apple Spatial Audio-like experience on Windows │
└─────────────────────────────────────────────────────────────┘
```

### Latency Analysis (< 20ms End-to-End)

When built as a native Windows service or application, WASAPI event-driven capture avoids browser buffering overhead:

| Pipeline Stage | Buffer / Processing Time | Notes |
|---|---|---|
| **WASAPI Event-Driven Loopback** | **~2.7 – 5.3 ms** | 128 to 256 sample buffer @ 48 kHz. |
| **Localhost Shared Memory / Native IPC** | **< 1.0 ms** | Direct buffer transfer between native processes. |
| **HRTF Spatial Convolver / Panner** | **~5.0 – 8.0 ms** | Native DSP convolution block size. |
| **Hardware Output Buffer** | **~3.0 – 5.0 ms** | Windows audio endpoint rendering buffer. |
| **Total End-to-End Latency** | **~12 – 19 ms** | **Well below human perceptual threshold** (~40ms lip-sync limit). |

### Key Advantages over File-Based Decoding
1. **Universal Format Support**: Any format external software can decode (Dolby Atmos TrueHD, AC-4, 360 Reality Audio, DTS:X, 7.1.4) is spatialized automatically without needing custom local decoders.
2. **Zero Reverse-Engineering Complexity**: Bypasses the need to extract proprietary DLLs or locate private decoder binaries.
3. **System-Wide Spatial Audio**: Provides head-tracked spatial audio for YouTube in 5.1, desktop Netflix, video games, and professional DAW mixing suites.
