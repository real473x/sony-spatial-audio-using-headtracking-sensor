# 📚 References, Credits & Third-Party Attributions

This document provides a comprehensive record of all open-source projects, research papers, specifications, reverse-engineering efforts, libraries, and developer tools that are used, referenced, adapted, or studied within the **SpatialAudio** player.

We believe in full transparency and honoring the groundbreaking work of the open-source and audio-engineering communities. Without their research and contributions, this project would not be possible.

---

## 📑 Table of Contents

1. [Head Tracking & Hardware Telemetry](#1-head-tracking--hardware-telemetry)
2. [Dolby Atmos, Spatial Audio & Object Decoders](#2-dolby-atmos-spatial-audio--object-decoders)
3. [Spatial Audio Standards & Binaural Synthesis](#3-spatial-audio-standards--binaural-synthesis)
4. [Backend, Native C-FFI & Web Infrastructure](#4-backend-native-c-ffi--web-infrastructure)
5. [AI Engineering & Vibe Coding](#5-ai-engineering--vibe-coding)
6. [Summary of Intellectual Property & Licenses](#6-summary-of-intellectual-property--licenses)

---

## 1. Head Tracking & Hardware Telemetry

### 🔹 [sony-head-tracker](https://github.com/NicholasSlattery/sony-head-tracker)
- **Author**: Nicholas Slattery ([@NicholasSlattery](https://github.com/NicholasSlattery))
- **Repository**: [https://github.com/NicholasSlattery/sony-head-tracker](https://github.com/NicholasSlattery/sony-head-tracker)
- **License**: MIT License
- **Usage & Contributions Referenced**:
  - Pioneered the reverse-engineering of the Bluetooth Low Energy telemetry stream on Sony WF-1000XM5 and WH-1000XM5 headphones for Windows.
  - Identified the **Android Head Tracker HID protocol** implementation (Usage Page `0x0020`, Sensor Usage `0x00E1`).
  - Documented the Little-Endian 16-bit signed integer quaternion packet layout and normalization scaling factors ($1/16384$ and $1/32768$).
  - Serves as the active, supported driver bridge connecting Sony earbuds to OpenTrack and our UDP WebSocket server.

### 🔹 [opentrack](https://github.com/opentrack/opentrack)
- **Maintainers**: OpenTrack Development Team ([@opentrack](https://github.com/opentrack))
- **Repository**: [https://github.com/opentrack/opentrack](https://github.com/opentrack/opentrack)
- **License**: ISC License
- **Usage & Contributions Referenced**:
  - Provided the industry-standard UDP network tracking protocol used across flight simulators, VR, and accessibility tools.
  - Standardized the 48-byte double-precision floating-point packet format (`[x, y, z, yaw, pitch, roll]` in IEEE-754 64-bit float format) transmitted over UDP port `4242`.
  - OpenTrack's Accela filter and exponential curve behaviors inspired the smoothing filter implemented in [`src/head-tracker.js`](src/head-tracker.js).

### 🔹 [Android Open Source Project (AOSP) — Head Tracking Protocol](https://source.android.com/docs/core/audio/spatial-audio#head-tracking)
- **Organization**: Google / Open Handset Alliance
- **Specification**: [AOSP Spatial Audio & Head Tracking Specification](https://source.android.com/docs/core/audio/spatial-audio#head-tracking)
- **Usage & Contributions Referenced**:
  - Defines the sensor coordinate system (right-handed convention: X-right, Y-forward, Z-up / NED aerospace frames).
  - Specifies standard HID Report Descriptors for rotational vector sensors and angular velocity (rad/s) payloads used by Sony and Android spatial audio devices.

### 🔹 [W3C WebHID & Web Bluetooth API Specifications](https://wicg.github.io/webhid/)
- **Standard**: W3C Web Incubator Community Group (WICG) & Web Bluetooth CG
- **Specifications**: [W3C WebHID](https://wicg.github.io/webhid/) · [W3C Web Bluetooth](https://webbluetoothcg.github.io/web-bluetooth/)
- **Status / Findings Note**:
  - *Direct in-browser integration was evaluated and prototype-tested, but removed from the player.*
  - Live hardware testing revealed that Windows Bluetooth pairs the Sony XM5 strictly as an Audio sink (A2DP) without attaching Microsoft's generic HID driver to the sensor SDP record unless re-bound at the OS driver level. Furthermore, Sony does not broadcast sensor telemetry over public BLE GATT characteristics on Windows.
  - Because browser sandboxes cannot perform OS driver rebinding without native desktop tools, the feature was removed as it did not function as intended. The OpenTrack + `sony-head-tracker` UDP pipeline remains the active, reliable standard.

---

## 2. Dolby Atmos, Spatial Audio & Object Decoders

### 🔹 [OpenJOC](https://github.com/chyinan/OpenJOC)
- **Author**: chyinan ([@chyinan](https://github.com/chyinan))
- **Repository**: [https://github.com/chyinan/OpenJOC](https://github.com/chyinan/OpenJOC)
- **License**: GPL-3.0 License
- **Usage & Contributions Referenced**:
  - Clean-room Rust implementation of Dolby E-AC-3 JOC (Joint Object Coding) bitstream parsing.
  - Implements decoding of Object Audio Metadata (OAMD) and the reconstruction of 12-channel discrete **7.1.4 Dolby Atmos** audio (7 bed surround + LFE + 4 ceiling height channels) from consumer streaming bitstreams.
  - Integrated into the multi-tier decoder engine (`tools/openjoc.exe`).

### 🔹 [Cavern & Cavernize](https://github.com/VoidXH/Cavern)
- **Author**: VoidXH ([@VoidXH](https://github.com/VoidXH))
- **Repository**: [https://github.com/VoidXH/Cavern](https://github.com/VoidXH/Cavern)
- **License**: MIT License
- **Usage & Contributions Referenced**:
  - Groundbreaking reverse-engineering of Dolby Digital Plus with Joint Object Coding (E-AC-3 JOC) on Windows (.NET).
  - Provided deep technical insights into object position rendering, height speaker assignments, and spatial soundstage translation.
  - Integrated into the multi-tier decoder engine (`tools/Cavernize.exe`).

### 🔹 [FFmpeg](https://ffmpeg.org)
- **Organization**: The FFmpeg Project
- **Website / Source**: [https://ffmpeg.org](https://ffmpeg.org)
- **License**: LGPL-2.1+ / GPL-2.0+
- **Usage & Contributions Referenced**:
  - Primary media extraction, container demuxing, and discrete multichannel PCM audio decoding engine.
  - Powers extraction of 5.1/7.1 audio tracks from video containers (`.mp4`, `.mkv`, `.mov`, `.ts`), Dolby Digital Plus downmixing, and channel layout matrix mapping.

### 🔹 [Dolby AC-4 Standards (ETSI TS 103 190)](https://www.etsi.org/)
- **Standard**: European Telecommunications Standards Institute (ETSI)
  - *ETSI TS 103 190-1*: Digital Audio Compression (AC-4) Standard; Part 1: Single Stream.
  - *ETSI TS 103 190-2*: Digital Audio Compression (AC-4) Standard; Part 2: Immersive and personalized audio.
- **Usage & Contributions Referenced**:
  - Specification of AC-4 bitstream syntax, framing, dialogue enhancement metadata, and bed/object channel layouts.
  - Handled via native C-FFI decoding using `tools/ffcodec64.dll`.

### 🔹 [Fraunhofer MPEG-H 3D Audio & Sony 360 Reality Audio](https://www.mpegh.com/)
- **Standard**: ISO/IEC 23008-3 (MPEG-H 3D Audio)
- **Organization**: Fraunhofer Institute for Integrated Circuits IIS & Sony Corporation
- **Usage & Contributions Referenced**:
  - Specification of the 360 Reality Audio container format (`mhm1` codec encapsulation within MP4/M4A).
  - SpatialAudio inspects audio streams, identifies 360 RA tracks, and interfaces with installed players.

---

## 3. Spatial Audio Standards & Binaural Synthesis

### 🔹 [W3C Web Audio API Specification](https://www.w3.org/TR/webaudio/)
- **Organization**: World Wide Web Consortium (W3C) Audio Working Group
- **Specification**: [https://www.w3.org/TR/webaudio/](https://www.w3.org/TR/webaudio/)
- **Usage & Contributions Referenced**:
  - Provides the core audio rendering graph: `AudioContext`, `ChannelSplitterNode`, `ChannelMergerNode`, `GainNode`, and `DynamicsCompressorNode`.
  - Standardized Head-Related Transfer Function (HRTF) binaural spatialization via `PannerNode` and `AudioListener.forwardX / forwardY / forwardZ / upX / upY / upZ`.

### 🔹 [ITU-R BS.775 & ITU-R BS.2051 Multi-Channel Sound Systems](https://www.itu.int/rec/R-REC-BS.2051/en)
- **Standard**: International Telecommunication Union (ITU)
- **Specification**: Advanced sound system with and without accompanied picture (Layouts 4.0, 5.1, 7.1, 7.1.4, 9.1.6).
- **Usage & Contributions Referenced**:
  - Standardized azimuth and elevation speaker angles implemented in [`src/audio-engine.js`](src/audio-engine.js) and rendered in 3D perspective in [`src/visualizer.js`](src/visualizer.js).

---

## 4. Backend, Native C-FFI & Web Infrastructure

### 🔹 [koffi](https://koffi.dev)
- **Author**: Damian Stewart / Koromix ([@Koromix](https://github.com/Koromix))
- **Repository**: [https://github.com/Koromix/koffi](https://github.com/Koromix/koffi)
- **License**: MIT License
- **Usage & Contributions Referenced**:
  - High-performance, fast C-FFI for Node.js used in [`src/ac4-decoder.js`](src/ac4-decoder.js) to load native Windows C DLLs (`tools/ffcodec64.dll`).

### 🔹 [ws (Node.js WebSocket Library)](https://github.com/websockets/ws)
- **Maintainers**: WebSockets Community
- **Repository**: [https://github.com/websockets/ws](https://github.com/websockets/ws)
- **License**: MIT License
- **Usage & Contributions Referenced**:
  - High-speed WebSocket server on port `8080` bridging UDP OpenTrack packets to the browser UI with sub-millisecond overhead.

### 🔹 [Express](https://expressjs.com)
- **Maintainers**: OpenJS Foundation / Express Technical Committee
- **Repository**: [https://github.com/expressjs/express](https://github.com/expressjs/express)
- **License**: MIT License
- **Usage & Contributions Referenced**:
  - Serves the player web application and handles local media upload/transcoding endpoints on port `3000`.

---

## 5. AI Engineering & Vibe Coding

This project was built and vibe coded using Gemini and Claude AI.

---

## 6. Summary of Intellectual Property & Licenses

| Project / Reference | Primary Authors | License | Purpose / Role |
| :--- | :--- | :--- | :--- |
| **sony-head-tracker** | Nicholas Slattery | MIT | Sony BLE IMU protocol reverse engineering |
| **OpenTrack** | OpenTrack Contributors | ISC | Universal head tracking UDP pipeline & filtering |
| **OpenJOC** | chyinan | GPL-3.0 | Dolby E-AC-3 JOC object audio decoding |
| **Cavern / Cavernize** | VoidXH | MIT | Dolby Atmos reverse engineering research |
| **FFmpeg** | FFmpeg Developers | LGPL-2.1+ / GPL-2.0+ | Multichannel demuxing & PCM audio processing |
| **koffi** | Damian Stewart | MIT | Fast C-FFI native DLL loader for Node.js |
| **ws** | WebSockets Contributors | MIT | Real-time WebSocket telemetry bridge |
| **Express** | Express Contributors | MIT | Local HTTP web application server |
| **Web Audio API** | W3C Audio Working Group | W3C Software Notice | Browser HRTF binaural 3D spatializer |
| **Android Head Tracker** | AOSP / Google | Apache 2.0 | Standard Android IMU HID protocol format |
| **Gemini & Claude AI** | Google / Anthropic | Terms of Service | AI tools used for building & vibe coding |

All trademarks, service marks, trade names, and product names (including *Dolby Atmos*, *Dolby Digital Plus*, *Sony 360 Reality Audio*, *Apple Spatial Audio*, *Windows*) are the property of their respective owners and are mentioned strictly for compatibility, technical description, and interoperability purposes.
