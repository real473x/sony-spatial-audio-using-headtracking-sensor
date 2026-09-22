const express = require('express');
const { WebSocketServer } = require('ws');
const dgram = require('dgram');
const path = require('path');

// ─── Configuration ───────────────────────────────────────────────────────────
const HTTP_PORT = 3000;
const WS_PORT = 8080;
const UDP_PORT = 4242;
const UDP_HOST = '127.0.0.1';

const os = require('os');
const fs = require('fs');
const { pipeline } = require('stream/promises');
const { spawn, execSync } = require('child_process');

// ─── Check Decoders: FFmpeg, OpenJOC (Rust), and Cavernize ────────────────────
let ffmpegAvailable = false;
try {
  execSync('ffmpeg -version', { stdio: 'ignore' });
  ffmpegAvailable = true;
} catch (e) {
  ffmpegAvailable = false;
}

// OpenJOC (Rust Clean-Room E-AC-3 JOC Decoder by chyinan)
let openjocAvailable = false;
let openjocPath = 'openjoc';
const localOpenJOC = path.join(__dirname, 'tools', 'openjoc.exe');
const localOpenJOCNoExt = path.join(__dirname, 'tools', 'openjoc');
if (fs.existsSync(localOpenJOC)) {
  openjocAvailable = true;
  openjocPath = localOpenJOC;
} else if (fs.existsSync(localOpenJOCNoExt)) {
  openjocAvailable = true;
  openjocPath = localOpenJOCNoExt;
} else {
  try {
    execSync('where.exe openjoc', { stdio: 'ignore' });
    openjocAvailable = true;
    openjocPath = 'openjoc';
  } catch (e) {
    openjocAvailable = false;
  }
}

// Cavernize (C# / .NET Spatial Audio Engine by VoidXH)
let cavernAvailable = false;
let cavernPath = 'Cavernize';
const localCavern = path.join(__dirname, 'tools', 'Cavernize.exe');
const localCavernNoExt = path.join(__dirname, 'tools', 'Cavernize');
if (fs.existsSync(localCavern)) {
  cavernAvailable = true;
  cavernPath = localCavern;
} else if (fs.existsSync(localCavernNoExt)) {
  cavernAvailable = true;
  cavernPath = localCavernNoExt;
} else {
  try {
    execSync('where.exe Cavernize', { stdio: 'ignore' });
    cavernAvailable = true;
    cavernPath = 'Cavernize';
  } catch (e) {
    cavernAvailable = false;
  }
}

// Dolby AC-4 Native Decoder Module (using PotPlayer ffcodec64.dll)
let ac4Decoder = null;
let ac4Available = false;
let ac4Path = null;
try {
  ac4Decoder = require('./src/ac4-decoder.js');
  if (ac4Decoder.isAvailable()) {
    ac4Available = true;
    ac4Path = 'tools/ffcodec64.dll (PotPlayer AC-4 native)';
  }
} catch (e) {
  console.warn('  ⚠️ Could not initialize native AC-4 decoder:', e.message);
}

// Fallback CLI tools
if (!ac4Available) {
  const ac4Candidates = [
    path.join(__dirname, 'tools', 'ac4dec.exe'),
    path.join(__dirname, 'tools', 'ac4dec'),
    path.join(__dirname, 'tools', 'oxideav_ac4.exe'),
    path.join(__dirname, 'tools', 'oxideav-ac4.exe'),
    path.join(__dirname, 'tools', 'oxideav-ac4'),
    path.join(__dirname, 'tools', 'ffmpeg_ac4.exe'),
    path.join(__dirname, 'tools', 'ffmpeg-ac4.exe')
  ];
  for (const cand of ac4Candidates) {
    if (fs.existsSync(cand)) {
      ac4Available = true;
      ac4Path = cand;
      break;
    }
  }
  if (!ac4Available) {
    try {
      execSync('where.exe ac4dec', { stdio: 'ignore' });
      ac4Available = true;
      ac4Path = 'ac4dec';
    } catch (_) {}
  }
}

// Fraunhofer IIS MPEG-H / Sony 360 Reality Audio Detection
const mpeghCandidates = [
  'C:\\Program Files\\Fraunhofer IIS\\MPEG-H VVPlayer\\MPEG-H VVPlayer.exe',
  'C:\\Program Files (x86)\\Fraunhofer IIS\\MPEG-H VVPlayer\\MPEG-H VVPlayer.exe',
  path.join(__dirname, 'tools', 'MPEG-H VVPlayer.exe'),
  path.join(__dirname, 'tools', 'mpegh_dec.exe')
];
let mpeghAvailable = false;
let mpeghPath = null;
for (const cand of mpeghCandidates) {
  if (fs.existsSync(cand)) {
    mpeghAvailable = true;
    mpeghPath = cand;
    break;
  }
}

/** Probe media file streams and container information via ffprobe */
function probeMedia(filePath) {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v', 'error',
      '-show_streams',
      '-show_format',
      '-of', 'json',
      filePath
    ]);
    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0 && stdout) {
        try {
          resolve(JSON.parse(stdout));
        } catch (_) {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    });
    proc.on('error', () => resolve(null));
  });
}

// ─── HTTP Server (serves static files & Atmos decoder API) ───────────────────
const app = express();
app.use(express.json());

// Health / status endpoint
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    ffmpegAvailable,
    openjocAvailable: false,
    openjocPath: null,
    cavernAvailable: false,
    cavernPath: null,
    ac4Available,
    ac4Path,
    ffcodecAvailable: ac4Available,
    ffcodecPath: ac4Path,
    mpeghAvailable,
    mpeghPath,
    decoderMode: 'FFmpeg & AC-4 / MPEG-H Multichannel Engine',
    supportedLayouts: [
      { id: '7.1.4', name: '7.1.4 Dolby Atmos (12ch: 7 Bed + LFE + 4 Heights)', channels: 12 },
      { id: '7.1.2', name: '7.1.2 Dolby Atmos (10ch: 7 Bed + LFE + 2 Heights)', channels: 10 },
      { id: '5.1.4', name: '5.1.4 Dolby Atmos (10ch: 5 Bed + LFE + 4 Heights)', channels: 10 },
      { id: '5.1.2', name: '5.1.2 Dolby Atmos (8ch: 5 Bed + LFE + 2 Heights)', channels: 8 },
      { id: '7.1',   name: '7.1 Surround (8ch: 7 Bed + LFE)', channels: 8 },
      { id: '5.1',   name: '5.1 Surround (6ch: 5 Bed + LFE)', channels: 6 },
      { id: '9.1.6', name: '9.1.6 Dolby Atmos (16ch: 9 Bed + LFE + 6 Heights)', channels: 16 },
      { id: '9.1.4', name: '9.1.4 Dolby Atmos (14ch: 9 Bed + LFE + 4 Heights)', channels: 14 },
      { id: '4.0',   name: '4.0 Quadraphonic (4ch: Quad Bed)', channels: 4 },
      { id: 'stereo',name: '2.0 Stereo (2ch: Binaural L/R)', channels: 2 }
    ],
    wsPort: WS_PORT,
    udpPort: UDP_PORT
  });
});

// Launch 360 RA & MPEG-H 3D Player endpoint
app.post('/api/open-mpegh-player', (req, res) => {
  if (!mpeghAvailable || !mpeghPath) {
    return res.status(404).json({ error: '360 RA & MPEG-H 3D Player not found on system.' });
  }
  const targetFile = req.body?.filePath || '';
  try {
    const args = targetFile && fs.existsSync(targetFile) ? [targetFile] : [];
    spawn(mpeghPath, args, { detached: true, stdio: 'ignore' }).unref();
    res.json({ success: true, message: '360 RA & MPEG-H 3D Player launched', path: mpeghPath });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Dolby Atmos M4A / AC-4 / Multichannel Decoder Endpoint
app.post('/api/decode-atmos', async (req, res) => {
  if (!ffmpegAvailable && !cavernAvailable && !openjocAvailable && !ac4Available) {
    return res.status(503).json({
      error: 'No multichannel decoder is installed. Please install FFmpeg, or place ac4dec.exe / openjoc.exe into the tools/ folder.'
    });
  }

  const rawFilename = decodeURIComponent(req.headers['x-filename'] || 'audio.m4a');
  const ext = path.extname(rawFilename) || '.m4a';
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tempIn = path.join(os.tmpdir(), `spatial_in_${id}${ext}`);
  const tempOut = path.join(os.tmpdir(), `spatial_out_${id}.wav`);

  try {
    // Stream incoming request directly to disk in 64KB chunks — zero RAM consumption!
    await pipeline(req, fs.createWriteStream(tempIn));

    if (!fs.existsSync(tempIn) || fs.statSync(tempIn).size === 0) {
      return res.status(400).json({ error: 'No audio data received' });
    }

    if (!ffmpegAvailable && !ac4Available) {
      throw new Error('FFmpeg is not installed or not found in system PATH.');
    }

    const targetLayout = req.headers['x-target-layout'] || 'auto';
    console.log(`  🎬 Decoding audio file "${rawFilename}" (target layout: ${targetLayout})...`);

    // Probe stream information via ffprobe
    const probe = await probeMedia(tempIn);
    const audioStreams = (probe?.streams || []).filter(s => s.codec_type === 'audio');
    const primaryStream = audioStreams[0] || {};
    const isAC4 = primaryStream.codec_name === 'ac4' ||
                  primaryStream.codec_tag_string === 'ac-4' ||
                  primaryStream.codec_tag_string === 'ac4 ' ||
                  (primaryStream.codec_long_name && primaryStream.codec_long_name.toLowerCase().includes('ac-4'));

    if (isAC4) {
      console.log(`  🎧 Detected Dolby AC-4 format in ${rawFilename} (codec: ${primaryStream.codec_name || 'ac-4'}, channels: ${primaryStream.channels || 'immersive'})`);
    }

    // Map UI layout IDs to FFmpeg channel_layout names and channel counts
    const LAYOUT_MAP = {
      'mono':                 { ffmpegLayout: 'mono',   channels: 1  },
      'stereo':               { ffmpegLayout: 'stereo', channels: 2  },
      'ac4-ims':              { ffmpegLayout: 'stereo', channels: 2  },
      '4.0':                  { ffmpegLayout: 'quad',   channels: 4  },
      '5.1':                  { ffmpegLayout: '5.1',    channels: 6  },
      'ac4-core-objects':     { ffmpegLayout: null,     channels: 7  },
      '7.1':                  { ffmpegLayout: '7.1',    channels: 8  },
      '5.1.2':                { ffmpegLayout: '5.1.2',  channels: 8  },
      '5.1.4':                { ffmpegLayout: '5.1.4',  channels: 10 },
      '7.1.2':                { ffmpegLayout: '7.1.2',  channels: 10 },
      '7.1.4':                { ffmpegLayout: '7.1.4',  channels: 12 },
      '9.1.4':                { ffmpegLayout: '9.1.4',  channels: 14 },
      '9.1.6':                { ffmpegLayout: '9.1.6',  channels: 16 },
      'ac4-advanced-objects': { ffmpegLayout: null,     channels: 16 },
      '22.2':                 { ffmpegLayout: '22.2',   channels: 24 },
    };

    const runCustomAC4 = (args) => new Promise((resolve, reject) => {
      const proc = spawn(ac4Path, args);
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(tempOut) && fs.statSync(tempOut).size > 1000) {
          resolve(stderr);
        } else {
          reject(new Error(`AC-4 decoder error (code ${code}): ${stderr.slice(-300)}`));
        }
      });
    });

    const runFFmpeg = (args) => new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args);
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(tempOut) && fs.statSync(tempOut).size > 1000) {
          resolve(stderr);
        } else {
          reject(new Error(`FFmpeg error (code ${code}): ${stderr.slice(-300)}`));
        }
      });
    });

    const useFFCodec = req.headers['x-use-ffcodec'] !== 'false';
    const useMPEGH = req.headers['x-use-mpegh'] !== 'false';

    const isMPEGH = primaryStream.codec_name === 'mhm1' ||
                    primaryStream.codec_name === 'mha1' ||
                    primaryStream.codec_tag_string === 'mhm1' ||
                    primaryStream.codec_tag_string === 'mha1' ||
                    primaryStream.codec_tag_string === 'mp4a.20.d' ||
                    (primaryStream.codec_long_name && primaryStream.codec_long_name.toLowerCase().includes('mpeg-h'));

    if (isMPEGH) {
      console.log(`  🎧 Detected Sony 360 Reality Audio / MPEG-H stream in "${rawFilename}" (codec: ${primaryStream.codec_name || 'mhm1'})`);
    }

    let stderr = '';
    let usedLayout = targetLayout;
    let decodedBy = 'FFmpeg';

    // 1. Try native AC-4 decoder (ffcodec64.dll) if enabled by toggle
    let ac4Success = false;
    if (isAC4 && ac4Available) {
      if (useFFCodec && ac4Decoder && ac4Decoder.isAvailable()) {
        try {
          console.log(`  🦀 Executing native Dolby AC-4 Atmos decoder via tools/ffcodec64.dll...`);
          const decResult = await ac4Decoder.decodeFile(tempIn, tempOut, { targetLayout });
          ac4Success = true;
          decodedBy = decResult.decoder || 'Dolby AC-4 Atmos native decoder';
          console.log(`  ✅ Native Dolby AC-4 Atmos decode successful! ${decResult.channels}ch @ ${decResult.sampleRate}Hz (${decResult.duration.toFixed(2)}s)`);
        } catch (ac4Err) {
          console.warn(`  ⚠️ Native Dolby AC-4 Atmos decoder failed, trying CLI fallback:`, ac4Err.message);
        }
      } else if (!useFFCodec) {
        console.log(`  ⚪ Dolby AC-4 Atmos decoder is toggled OFF by user.`);
      }
      
      if (!ac4Success && ac4Path && !ac4Path.includes('ffcodec64.dll')) {
        try {
          console.log(`  🦀 Executing dedicated AC-4 decoder: ${ac4Path}...`);
          stderr = await runCustomAC4(['-i', tempIn, '-o', tempOut]);
          ac4Success = true;
          decodedBy = path.basename(ac4Path);
        } catch (ac4Err) {
          console.warn(`  ⚠️ Dedicated CLI AC-4 decoder failed:`, ac4Err.message);
        }
      }
    }

    if (!ac4Success) {
      // 2. Try FFmpeg decode
      let ffmpegSuccess = false;
      const layoutInfo = (targetLayout && targetLayout !== 'auto' && targetLayout !== 'native') ? LAYOUT_MAP[targetLayout] : null;

      try {
        if (layoutInfo && layoutInfo.ffmpegLayout) {
          stderr = await runFFmpeg([
            '-y', '-i', tempIn,
            '-strict', '-2',
            '-channel_layout', layoutInfo.ffmpegLayout,
            '-acodec', 'pcm_s24le',
            tempOut
          ]);
        } else if (layoutInfo && layoutInfo.channels) {
          stderr = await runFFmpeg([
            '-y', '-i', tempIn,
            '-strict', '-2',
            '-ac', String(layoutInfo.channels),
            '-acodec', 'pcm_s24le',
            tempOut
          ]);
        } else {
          stderr = await runFFmpeg([
            '-y', '-i', tempIn,
            '-strict', '-2',
            '-acodec', 'pcm_s24le',
            tempOut
          ]);
        }
        ffmpegSuccess = true;
      } catch (mainErr) {
        // If primary stream was AC-4 or failed, check for companion/alternate audio stream in container
        if (audioStreams.length > 1) {
          for (let sIdx = 1; sIdx < audioStreams.length; sIdx++) {
            const altStream = audioStreams[sIdx];
            console.log(`  🔄 Trying alternate audio stream #${sIdx} (${altStream.codec_name || 'audio'})...`);
            try {
              stderr = await runFFmpeg([
                '-y', '-i', tempIn,
                '-map', `0:a:${sIdx}`,
                '-acodec', 'pcm_s24le',
                tempOut
              ]);
              ffmpegSuccess = true;
              console.log(`  ✅ Successfully decoded companion stream #${sIdx}!`);
              break;
            } catch (_) {}
          }
        }

        if (!ffmpegSuccess) {
          if (isMPEGH) {
            let savedPath = null;
            if (mpeghAvailable && mpeghPath) {
              const uploadDir = path.join(__dirname, 'tools', 'mpegh_cache');
              if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
              savedPath = path.join(uploadDir, `${path.parse(rawFilename).name}_${id}${ext}`);
              try {
                fs.copyFileSync(tempIn, savedPath);
                if (useMPEGH) {
                  console.log(`  🚀 Launching 360 RA & MPEG-H 3D player with: ${savedPath}`);
                  spawn(mpeghPath, [savedPath], { detached: true, stdio: 'ignore' }).unref();
                }
              } catch (_) {}
            }
            const msg = mpeghAvailable
              ? `360 RA & MPEG-H 3D audio detected in "${rawFilename}". 360 RA & MPEG-H 3D player has been launched to play this track.`
              : `360 RA & MPEG-H 3D audio detected in "${rawFilename}". Standard FFmpeg does not contain an MPEG-H 3D decoder. Place "mpegh_dec.exe" in tools/ or install MPEG-H 3D Player.`;
            const mErr = new Error(msg);
            mErr.isMPEGH = true;
            mErr.mpeghAvailable = mpeghAvailable;
            mErr.savedPath = savedPath;
            throw mErr;
          }
          if (isAC4) {
            throw new Error(`Dolby AC-4 stream detected in "${rawFilename}". Enable Custom Decoders -> Dolby AC-4 Atmos in the Advanced menu.`);
          }
          throw mainErr;
        }
      }
    }

    let detectedCodec = 'Dolby Atmos (FFmpeg)';
    if (isAC4) {
      detectedCodec = `Dolby AC-4 Atmos (${usedLayout})`;
    } else if (stderr.includes('eac3') || primaryStream.codec_name === 'eac3') {
      detectedCodec = `Dolby Atmos E-AC-3 (${usedLayout})`;
    } else if (stderr.includes('truehd') || primaryStream.codec_name === 'truehd') {
      detectedCodec = `Dolby TrueHD Atmos (${usedLayout})`;
    } else if (stderr.includes('aac') || primaryStream.codec_name === 'aac') {
      detectedCodec = `Multichannel AAC (${usedLayout})`;
    } else if (primaryStream.codec_name) {
      detectedCodec = `${primaryStream.codec_name.toUpperCase()} (${usedLayout})`;
    } else {
      detectedCodec = `Multichannel Audio (${usedLayout})`;
    }

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('X-Audio-Codec', encodeURIComponent(detectedCodec));
    res.setHeader('X-Decoded-By', decodedBy);
    res.setHeader('X-Rendered-Layout', usedLayout);
    res.sendFile(tempOut, (err) => {
      fs.promises.unlink(tempIn).catch(() => {});
      fs.promises.unlink(tempOut).catch(() => {});
    });

  } catch (err) {
    console.error('  ⚠️  Decode error:', err.message);
    fs.promises.unlink(tempIn).catch(() => {});
    fs.promises.unlink(tempOut).catch(() => {});
    if (!res.headersSent) {
      res.status(err.isMPEGH ? 422 : 500).json({
        error: err.message,
        isMPEGH: !!err.isMPEGH,
        mpeghAvailable: !!err.mpeghAvailable,
        savedPath: err.savedPath || null
      });
    }
  }
});

app.use(express.static(path.join(__dirname)));
app.listen(HTTP_PORT, () => {
  console.log(`\n  🎧 SpatialAudio Player`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  🌐 Web UI:      http://localhost:${HTTP_PORT}`);
  console.log(`  📡 WebSocket:   ws://localhost:${WS_PORT}`);
  console.log(`  🎯 UDP Listen:  ${UDP_HOST}:${UDP_PORT}`);
  console.log(`  🎬 FFmpeg:      ${ffmpegAvailable ? '✅ Available (multichannel bed decoder active)' : '❌ Not found (Install via: winget install Gyan.FFmpeg)'}`);
  console.log(`  🦀 OpenJOC:     ${openjocAvailable ? `✅ Available (${openjocPath} - 7.1.4 Rust objects active)` : '⚪ Not found (Optional: Place openjoc.exe in tools/)'}`);
  console.log(`  🌌 Cavernize:   ${cavernAvailable ? `✅ Available (${cavernPath} - 7.1.4 objects active)` : '⚪ Not found (Optional: Place Cavernize.exe in tools/)'}`);
  console.log(`  ─────────────────────────────────────\n`);
});

// ─── WebSocket Server (sends head tracking data to browser) ─────────────────
const wss = new WebSocketServer({ port: WS_PORT });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`  ✅ Browser connected (${clients.size} client(s))`);
  
  ws.on('close', () => {
    clients.delete(ws);
    console.log(`  ❌ Browser disconnected (${clients.size} client(s))`);
  });
  
  ws.on('error', (err) => {
    console.error('  ⚠️  WebSocket error:', err.message);
    clients.delete(ws);
  });
});

// ─── UDP Listener (receives OpenTrack data) ─────────────────────────────────
// OpenTrack "UDP over network" protocol:
// 48 bytes = 6 × float64 (little-endian)
// [tx, ty, tz, yaw, pitch, roll]
// Translation in cm, rotation in degrees

const udpSocket = dgram.createSocket('udp4');
let lastPacketTime = 0;
let packetCount = 0;

udpSocket.on('message', (msg, rinfo) => {
  if (msg.length < 48) return; // Invalid packet
  
  // Parse 6 × float64 little-endian
  const tx    = msg.readDoubleLE(0);
  const ty    = msg.readDoubleLE(8);
  const tz    = msg.readDoubleLE(16);
  const yaw   = msg.readDoubleLE(24);
  const pitch = msg.readDoubleLE(32);
  const roll  = msg.readDoubleLE(40);
  
  const data = JSON.stringify({
    type: 'headtracking',
    tx, ty, tz,
    yaw, pitch, roll,
    timestamp: Date.now()
  });
  
  // Broadcast to all connected browser clients
  // Only send latest data — drop if buffer is full
  for (const client of clients) {
    if (client.readyState === 1) { // OPEN
      client.send(data);
    }
  }
  
  // Log occasionally
  packetCount++;
  const now = Date.now();
  if (now - lastPacketTime > 2000) {
    console.log(`  📦 Head tracking: yaw=${yaw.toFixed(1)}° pitch=${pitch.toFixed(1)}° roll=${roll.toFixed(1)}° | pos: tx=${tx.toFixed(2)} ty=${ty.toFixed(2)} tz=${tz.toFixed(2)} (${packetCount} pkts)`);
    packetCount = 0;
    lastPacketTime = now;
  }
});

udpSocket.on('error', (err) => {
  console.error(`  ⚠️  UDP error: ${err.message}`);
  if (err.code === 'EADDRINUSE') {
    console.error(`  ❗ Port ${UDP_PORT} is already in use. Is OpenTrack sending to a different port?`);
  }
});

udpSocket.on('listening', () => {
  const addr = udpSocket.address();
  console.log(`  📡 Listening for OpenTrack UDP on ${addr.address}:${addr.port}`);
});

udpSocket.bind(UDP_PORT, UDP_HOST);
