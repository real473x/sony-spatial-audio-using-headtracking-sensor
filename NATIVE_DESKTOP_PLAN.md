# Native Desktop App Plan

## Goal

Create a compiled desktop application that has its own native window and UI,
without Electron or a webview, starting with Windows. Keep the current web app
and Electron app available during the transition. Design the new app so macOS
and Linux can be added without replacing the UI, renderer, or audio architecture.

This is a planning document only. Do not start the native implementation until
the stack and the initial proof-of-concept are agreed.

## Recommended direction

Prototype **Rust + egui/eframe + wgpu** before committing to a full rewrite.

- **Rust** provides a compiled application and a strong fit for a responsive
  renderer, audio processing, and a small native runtime.
- **egui/eframe** can provide the native application window and a fully
  custom-designed control UI without HTML, CSS, Chromium, or a webview. It is
  not the same as using each operating system's standard widgets; verify that
  its look and accessibility meet expectations in the prototype.
- **wgpu** provides one rendering interface with platform backends: Direct3D 12
  on Windows, Metal on macOS, and Vulkan on Linux. The application can select a
  suitable backend at runtime rather than tying the renderer to DirectX or
  Vulkan alone. Keep a software/low-capability fallback in scope.
- Keep audio and tracking independent of the graphics API. A dropped render
  frame must not block or interrupt audio.

This is a recommendation to test, not a final lock-in. If standard OS-native
widgets are more important than a custom GPU-driven UI, compare Qt 6/C++ in the
initial spike. Qt is a mature cross-platform desktop toolkit, but its packaging
and dependency footprint may be larger. Do not use Unity or Unreal for this
application: they add game-engine machinery and distribution size without
solving the audio-player requirements.

## Graphics API choice

| Option | Assessment |
| --- | --- |
| DirectX 12 | Good Windows backend, but Windows-only as the application's direct API. |
| Vulkan | High-performance cross-platform API, but macOS generally needs a translation layer and driver support varies. |
| wgpu | Recommended abstraction for this project: use Direct3D 12 on Windows, Metal on macOS, and Vulkan on Linux where available. |
| Unity / Unreal | Not recommended; their engine/runtime footprint is excessive for a native audio player and speaker-scene visualizer. |

Do not expect a graphics API change alone to eliminate stutter. The current
POV renderer should first be profiled to establish whether the bottleneck is
projection/drawing, allocation/garbage collection, UI event work, audio
contention, or frame scheduling. Use those measurements to set comparable
native acceptance criteria.

## Proposed architecture

- **Window and controls:** egui/eframe, with playback, queue, soundstage,
  tracking, and advanced settings implemented as native Rust UI.
- **Scene renderer:** wgpu, with a clear boundary between scene state and
  rendering. Keep scene updates allocation-light; avoid blocking work in the
  render loop.
- **Audio output and spatialization:** a dedicated real-time audio path, likely
  using a Rust audio backend such as `cpal` with platform output APIs. The audio
  callback must avoid locks, file I/O, allocations, and UI work.
- **Decoding:** preserve the current decoder capabilities through an explicit
  compatibility layer. Evaluate FFmpeg library bindings versus a bundled
  FFmpeg process during the spike; do not silently drop multichannel, AC-4,
  Atmos/JOC, or MPEG-H-related workflows. Proprietary or optional decoders may
  remain optional integrations if a direct port is impractical.
- **Head tracking:** keep the OpenTrack UDP protocol as a portable first
  tracking source. Treat direct Sony/Windows HID support as a Windows-specific
  module, separate from the shared tracking interface.
- **Platform boundary:** isolate Windows-only device and packaging code behind
  platform modules. Keep the core UI, renderer, audio model, and UDP tracking
  portable.
- **Existing app:** leave the web and Electron applications intact until the
  native build passes feature-parity gates. Avoid making the native app depend
  on Electron, a browser, or the existing Express UI server in its target
  architecture.

## Migration phases

### 0. Baseline and technology spike

1. Profile POV movement and panning in the current desktop app on the target
   Windows machine. Record resolution, scene, speaker count, GPU, frame-time
   distribution, and audio dropouts.
2. Build a small native window that draws the POV scene and supports camera
   movement using egui/eframe + wgpu.
3. Compare it with a Qt 6/C++ spike only if the Rust UI's native feel,
   accessibility, or packaging is unsatisfactory.
4. Measure startup time, idle/active memory, packaged size, and frame pacing.
   Confirm that the selected backend runs on the user's Windows GPU.
5. Agree on the stack and feature-parity scope before beginning a larger port.

### 1. Native application foundation

- Add the native app as a separate project/directory and build target.
- Establish window lifecycle, settings persistence, logging, error reporting,
  and GPU/backend selection.
- Port the current POV scene and walking/panning controls, with deterministic
  frame scheduling and no audio dependency.

### 2. Playback and spatial audio

- Add device discovery, playback controls, multichannel output, listener
  orientation/position, and HRTF spatialization.
- Port common file decoding and verify channel order/layout behavior.
- Add optional decoder integrations only after documenting their supported
  platforms, licensing, and packaging constraints.

### 3. Tracking and remaining core features

- Implement OpenTrack UDP input and recentering.
- Port Windows Sony HID support behind the platform boundary.
- Add the high-priority settings and workflows, then compare against the
  existing application feature by feature.

### 4. Windows release candidate

- Package and run on a clean Windows installation without requiring the
  development environment.
- Validate GPU fallback, audio device changes, tracker failure/recovery,
  settings migration, and long playback sessions.
- Keep the existing Electron app available as a fallback until the user accepts
  the native version.

### 5. macOS and Linux enablement

- Bring up Metal on macOS and Vulkan on Linux through wgpu.
- Implement and test each platform's audio output, packaging, permissions,
  signing, and tracker support separately.
- Describe unsupported platform-specific features clearly instead of implying
  full feature parity.

## Initial quality gates

Set final numbers after collecting the baseline in phase 0. Suggested checks:

- Smooth, repeatable camera pan/walk in every scene, with frame times recorded
  at the same resolution and speaker count as the Electron baseline.
- No audio callback work waits on rendering, UI updates, decoding, or tracking.
- No audible dropouts during a sustained playback-and-pan session.
- No regression in required channel layouts or decoder workflows before
  replacing the current desktop app.
- Successful Windows packaging and operation on a clean machine; separately
  validated builds before claiming macOS or Linux support.
- Record packaged size, startup time, and memory usage against the current
  Electron build instead of assuming a native implementation will be smaller.

## Risks and decisions to resolve

- Native audio and decoder parity is a larger task than replacing the
  visualizer; proprietary/optional decoder integrations may limit portability.
- A custom GPU UI is not automatically equivalent to familiar native OS
  widgets. Confirm the desired visual style and accessibility in the spike.
- GPU drivers, hybrid graphics, remote desktop, and software rendering can all
  affect frame pacing; provide a fallback and useful diagnostics.
- Confirm distribution/licensing requirements for FFmpeg and optional decoder
  binaries before bundling them.
- Decide the minimum supported Windows version and the first required audio
  formats/layouts before estimating implementation effort.

## Branch and working-tree note

Git branch names cannot contain spaces. Use `desktop-mode-native` for the
requested “desktop mode native” branch. The current checkout has uncommitted
changes from earlier work; preserve them and do not commit or discard them as
part of this planning step.
