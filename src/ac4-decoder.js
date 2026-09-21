/**
 * Dolby AC-4 & Immersive Audio Native Decoder Module
 * Uses PotPlayer's ffcodec64.dll via Koffi C-FFI for high-performance zero-dependency decoding
 */

const fs = require('fs');
const path = require('path');

let koffi = null;
let lib = null;
let isLoaded = false;
let loadError = null;

// Native function bindings
let avformat_open_input = null;
let avformat_find_stream_info = null;
let avformat_close_input = null;
let av_read_frame = null;

let avcodec_find_decoder = null;
let avcodec_find_decoder_by_name = null;
let avcodec_alloc_context3 = null;
let avcodec_parameters_to_context = null;
let avcodec_open2 = null;
let avcodec_send_packet = null;
let avcodec_receive_frame = null;
let avcodec_free_context = null;

let av_packet_alloc = null;
let av_packet_unref = null;
let av_packet_free = null;

let av_frame_alloc = null;
let av_frame_unref = null;
let av_frame_free = null;

// Channel layout speaker mask constants for WAVE_FORMAT_EXTENSIBLE
const SPEAKER_FRONT_LEFT            = 0x1;
const SPEAKER_FRONT_RIGHT           = 0x2;
const SPEAKER_FRONT_CENTER          = 0x4;
const SPEAKER_LOW_FREQUENCY         = 0x8;
const SPEAKER_BACK_LEFT             = 0x10;
const SPEAKER_BACK_RIGHT            = 0x20;
const SPEAKER_FRONT_LEFT_OF_CENTER  = 0x40;
const SPEAKER_FRONT_RIGHT_OF_CENTER = 0x80;
const SPEAKER_BACK_CENTER           = 0x100;
const SPEAKER_SIDE_LEFT             = 0x200;
const SPEAKER_SIDE_RIGHT            = 0x400;
const SPEAKER_TOP_CENTER            = 0x800;
const SPEAKER_TOP_FRONT_LEFT        = 0x1000;
const SPEAKER_TOP_FRONT_CENTER      = 0x2000;
const SPEAKER_TOP_FRONT_RIGHT       = 0x4000;
const SPEAKER_TOP_BACK_LEFT         = 0x8000;
const SPEAKER_TOP_BACK_CENTER       = 0x10000;
const SPEAKER_TOP_BACK_RIGHT        = 0x20000;

function getChannelMask(channels) {
  switch (channels) {
    case 1:  return SPEAKER_FRONT_CENTER;
    case 2:  return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT;
    case 4:  return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT | SPEAKER_BACK_LEFT | SPEAKER_BACK_RIGHT; // Quad
    case 6:  return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT | SPEAKER_FRONT_CENTER | SPEAKER_LOW_FREQUENCY | SPEAKER_SIDE_LEFT | SPEAKER_SIDE_RIGHT; // 5.1
    case 8:  return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT | SPEAKER_FRONT_CENTER | SPEAKER_LOW_FREQUENCY | SPEAKER_BACK_LEFT | SPEAKER_BACK_RIGHT | SPEAKER_SIDE_LEFT | SPEAKER_SIDE_RIGHT; // 7.1
    case 10: return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT | SPEAKER_FRONT_CENTER | SPEAKER_LOW_FREQUENCY | SPEAKER_BACK_LEFT | SPEAKER_BACK_RIGHT | SPEAKER_SIDE_LEFT | SPEAKER_SIDE_RIGHT | SPEAKER_TOP_FRONT_LEFT | SPEAKER_TOP_FRONT_RIGHT; // 7.1.2 or 5.1.4
    case 12: return SPEAKER_FRONT_LEFT | SPEAKER_FRONT_RIGHT | SPEAKER_FRONT_CENTER | SPEAKER_LOW_FREQUENCY | SPEAKER_BACK_LEFT | SPEAKER_BACK_RIGHT | SPEAKER_SIDE_LEFT | SPEAKER_SIDE_RIGHT | SPEAKER_TOP_FRONT_LEFT | SPEAKER_TOP_FRONT_RIGHT | SPEAKER_TOP_BACK_LEFT | SPEAKER_TOP_BACK_RIGHT; // 7.1.4
    case 14: return 0x3FFFF;
    case 16: return 0x3FFFF;
    default: return 0;
  }
}

/**
 * Initialize the Koffi C-FFI loader with ffcodec64.dll
 */
function initFFmpeg() {
  if (isLoaded) return true;
  if (loadError) return false;

  try {
    koffi = require('koffi');
    const dllPath = path.join(__dirname, '..', 'tools', 'ffcodec64.dll');
    if (!fs.existsSync(dllPath)) {
      throw new Error(`ffcodec64.dll not found at ${dllPath}`);
    }

    lib = koffi.load(dllPath);

    avformat_open_input = lib.func('int avformat_open_input(_Out_ void **ps, const char *url, void *fmt, void **options)');
    avformat_find_stream_info = lib.func('int avformat_find_stream_info(void *ic, void **options)');
    avformat_close_input = lib.func('void avformat_close_input(_Inout_ void **s)');
    av_read_frame = lib.func('int av_read_frame(void *s, void *pkt)');

    avcodec_find_decoder = lib.func('void* avcodec_find_decoder(int id)');
    avcodec_find_decoder_by_name = lib.func('void* avcodec_find_decoder_by_name(const char *name)');
    avcodec_alloc_context3 = lib.func('void* avcodec_alloc_context3(void *codec)');
    avcodec_parameters_to_context = lib.func('int avcodec_parameters_to_context(void *codecCtx, void *par)');
    avcodec_open2 = lib.func('int avcodec_open2(void *avctx, void *codec, void **options)');
    avcodec_send_packet = lib.func('int avcodec_send_packet(void *avctx, void *avpkt)');
    avcodec_receive_frame = lib.func('int avcodec_receive_frame(void *avctx, void *frame)');
    avcodec_free_context = lib.func('void avcodec_free_context(_Inout_ void **avctx)');

    av_packet_alloc = lib.func('void* av_packet_alloc()');
    av_packet_unref = lib.func('void av_packet_unref(void *pkt)');
    av_packet_free = lib.func('void av_packet_free(_Inout_ void **pkt)');

    av_frame_alloc = lib.func('void* av_frame_alloc()');
    av_frame_unref = lib.func('void av_frame_unref(void *frame)');
    av_frame_free = lib.func('void av_frame_free(_Inout_ void **frame)');

    isLoaded = true;
    console.log('  ✅ Dolby AC-4 & Multichannel Engine loaded successfully from tools/ffcodec64.dll');
    return true;
  } catch (err) {
    loadError = err;
    console.warn('  ⚠️ Could not load ffcodec64.dll:', err.message);
    return false;
  }
}

/**
 * Builds a valid Multichannel 32-bit Float or 24-bit PCM WAV file header and payload
 */
function createWavFile(channelDataArray, sampleRate, numChannels) {
  // channelDataArray is an array of Float32Array per channel
  const numSamples = channelDataArray[0].length;
  const bytesPerSample = 4; // 32-bit float
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  
  // Use WAVE_FORMAT_EXTENSIBLE header (40 bytes fmt chunk) for full surround speaker mask support
  const useExtensible = numChannels > 2;
  const fmtChunkSize = useExtensible ? 40 : 16;
  const headerSize = 12 + (8 + fmtChunkSize) + 8; // RIFF + fmt + data
  const totalFileSize = headerSize + dataSize;

  const buffer = Buffer.alloc(headerSize + dataSize);
  let offset = 0;

  // RIFF header
  buffer.write('RIFF', offset, 4, 'ascii'); offset += 4;
  buffer.writeUInt32LE(totalFileSize - 8, offset); offset += 4;
  buffer.write('WAVE', offset, 4, 'ascii'); offset += 4;

  // FMT chunk
  buffer.write('fmt ', offset, 4, 'ascii'); offset += 4;
  buffer.writeUInt32LE(fmtChunkSize, offset); offset += 4;

  if (useExtensible) {
    buffer.writeUInt16LE(0xFFFE, offset); offset += 2; // WAVE_FORMAT_EXTENSIBLE
    buffer.writeUInt16LE(numChannels, offset); offset += 2;
    buffer.writeUInt32LE(sampleRate, offset); offset += 4;
    buffer.writeUInt32LE(byteRate, offset); offset += 4;
    buffer.writeUInt16LE(blockAlign, offset); offset += 2;
    buffer.writeUInt16LE(32, offset); offset += 2; // bits per sample
    buffer.writeUInt16LE(22, offset); offset += 2; // cbSize (extra format bytes)
    buffer.writeUInt16LE(32, offset); offset += 2; // valid bits per sample
    buffer.writeUInt32LE(getChannelMask(numChannels), offset); offset += 4; // dwChannelMask
    
    // SubFormat GUID for KSDATAFORMAT_SUBTYPE_IEEE_FLOAT (00000003-0000-0010-8000-00AA00389B71)
    buffer.writeUInt32LE(0x00000003, offset); offset += 4;
    buffer.writeUInt16LE(0x0000, offset); offset += 2;
    buffer.writeUInt16LE(0x0010, offset); offset += 2;
    buffer.write('800000aa00389b71', offset, 8, 'hex'); offset += 8;
  } else {
    buffer.writeUInt16LE(3, offset); offset += 2; // 3 = IEEE FLOAT
    buffer.writeUInt16LE(numChannels, offset); offset += 2;
    buffer.writeUInt32LE(sampleRate, offset); offset += 4;
    buffer.writeUInt32LE(byteRate, offset); offset += 4;
    buffer.writeUInt16LE(blockAlign, offset); offset += 2;
    buffer.writeUInt16LE(32, offset); offset += 2; // bits per sample
  }

  // DATA chunk
  buffer.write('data', offset, 4, 'ascii'); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;

  // Interleave planar channels into buffer
  for (let s = 0; s < numSamples; s++) {
    for (let c = 0; c < numChannels; c++) {
      buffer.writeFloatLE(channelDataArray[c][s] || 0, offset);
      offset += 4;
    }
  }

  return buffer;
}

/**
 * Decode audio file using ffcodec64.dll into a multichannel WAV file
 * @param {string} inputPath Path to the input media file (.m4a, .mp4, .ac4, etc.)
 * @param {string} outputPath Path to save decoded .wav
 * @param {object} options Optional settings { targetLayout }
 * @returns {Promise<{ channels: number, sampleRate: number, duration: number, codecName: string }>}
 */
async function decodeFile(inputPath, outputPath, options = {}) {
  if (!initFFmpeg()) {
    throw new Error(`Dolby AC-4 decoder is not initialized: ${loadError ? loadError.message : 'Unknown error'}`);
  }

  return new Promise((resolve, reject) => {
    let fmtCtx = [null];
    let codecCtx = null;
    let pkt = null;
    let frame = null;

    try {
      const retOpen = avformat_open_input(fmtCtx, inputPath, null, null);
      if (retOpen !== 0 || !fmtCtx[0]) {
        throw new Error(`avformat_open_input failed (error code ${retOpen}) for ${path.basename(inputPath)}`);
      }

      const retInfo = avformat_find_stream_info(fmtCtx[0], null);
      if (retInfo < 0) {
        throw new Error(`avformat_find_stream_info failed (error code ${retInfo})`);
      }

      const fmtBuf = Buffer.from(koffi.decode(fmtCtx[0], 'uint8_t', 64));
      const nbStreams = fmtBuf.readUInt32LE(44);
      const streamsPtr = fmtBuf.readBigUInt64LE(48);

      let audioStreamIdx = -1;
      let audioCodecId = 0;
      let audioCodecParPtr = null;
      let isAC4 = false;

      // Find the best audio stream (favor AC-4 if present)
      for (let i = 0; i < nbStreams; i++) {
        const streamPtr = Buffer.from(koffi.decode(streamsPtr + BigInt(i * 8), 'uint8_t', 8)).readBigUInt64LE(0);
        if (!streamPtr) continue;

        const streamBuf = Buffer.from(koffi.decode(streamPtr, 'uint8_t', 64));
        const codecparPtr = streamBuf.readBigUInt64LE(16);
        if (!codecparPtr) continue;

        const codecparBuf = Buffer.from(koffi.decode(codecparPtr, 'uint8_t', 64));
        const cType = codecparBuf.readInt32LE(0);
        const cId = codecparBuf.readInt32LE(4);

        if (cType === 1) { // AVMEDIA_TYPE_AUDIO
          if (cId === 86119) { // AV_CODEC_ID_AC4
            audioStreamIdx = i;
            audioCodecId = cId;
            audioCodecParPtr = codecparPtr;
            isAC4 = true;
            break;
          } else if (audioStreamIdx === -1) {
            audioStreamIdx = i;
            audioCodecId = cId;
            audioCodecParPtr = codecparPtr;
          }
        }
      }

      if (audioStreamIdx === -1 || !audioCodecParPtr) {
        throw new Error(`No compatible audio stream found in ${path.basename(inputPath)}`);
      }

      let decoder = null;
      if (isAC4 || audioCodecId === 86119) {
        decoder = avcodec_find_decoder_by_name('ac4') || avcodec_find_decoder(86119);
      } else {
        decoder = avcodec_find_decoder(audioCodecId);
      }

      if (!decoder) {
        throw new Error(`Decoder not found in ffcodec64.dll for codec ID ${audioCodecId}`);
      }

      codecCtx = avcodec_alloc_context3(decoder);
      if (!codecCtx) {
        throw new Error(`Failed to allocate AVCodecContext`);
      }

      avcodec_parameters_to_context(codecCtx, audioCodecParPtr);

      const retCodecOpen = avcodec_open2(codecCtx, decoder, null);
      if (retCodecOpen < 0) {
        throw new Error(`Failed to open codec (error code ${retCodecOpen})`);
      }

      pkt = av_packet_alloc();
      frame = av_frame_alloc();

      let detectedChannels = 0;
      let detectedSampleRate = 48000;
      const channelBuffers = []; // Array of arrays of Float32Array per channel

      while (av_read_frame(fmtCtx[0], pkt) >= 0) {
        const pktBuf = Buffer.from(koffi.decode(pkt, 'uint8_t', 48));
        const sIdx = pktBuf.readInt32LE(36);

        if (sIdx === audioStreamIdx) {
          let sendRet = avcodec_send_packet(codecCtx, pkt);
          while (sendRet >= 0) {
            sendRet = avcodec_receive_frame(codecCtx, frame);
            if (sendRet >= 0) {
              const frameBuf = Buffer.from(koffi.decode(frame, 'uint8_t', 512));
              const nbSamples = frameBuf.readInt32LE(112);
              const format = frameBuf.readInt32LE(116);
              detectedSampleRate = frameBuf.readInt32LE(180) || 48000;

              let chs = frameBuf.readInt32LE(184);
              if (chs <= 0 || chs > 32) chs = 6;
              detectedChannels = chs;

              // Ensure channelBuffers has slots for each channel
              while (channelBuffers.length < detectedChannels) {
                channelBuffers.push([]);
              }

              const extDataPtr = frameBuf.readBigUInt64LE(96);
              const chanPointersBuf = Buffer.from(koffi.decode(extDataPtr, 'uint8_t', detectedChannels * 8));

              for (let c = 0; c < detectedChannels; c++) {
                const chPtr = chanPointersBuf.readBigUInt64LE(c * 8);
                if (!chPtr) continue;

                if (format === 8) { // AV_SAMPLE_FMT_FLTP (Planar Float)
                  const rawBytes = Buffer.from(koffi.decode(chPtr, 'uint8_t', nbSamples * 4));
                  const f32 = new Float32Array(rawBytes.buffer, rawBytes.byteOffset, nbSamples);
                  channelBuffers[c].push(new Float32Array(f32));
                } else if (format === 6) { // AV_SAMPLE_FMT_S16P (Planar Int16)
                  const rawBytes = Buffer.from(koffi.decode(chPtr, 'uint8_t', nbSamples * 2));
                  const i16 = new Int16Array(rawBytes.buffer, rawBytes.byteOffset, nbSamples);
                  const f32 = new Float32Array(nbSamples);
                  for (let s = 0; s < nbSamples; s++) f32[s] = i16[s] / 32768.0;
                  channelBuffers[c].push(f32);
                } else if (format === 7) { // AV_SAMPLE_FMT_S32P (Planar Int32)
                  const rawBytes = Buffer.from(koffi.decode(chPtr, 'uint8_t', nbSamples * 4));
                  const i32 = new Int32Array(rawBytes.buffer, rawBytes.byteOffset, nbSamples);
                  const f32 = new Float32Array(nbSamples);
                  for (let s = 0; s < nbSamples; s++) f32[s] = i32[s] / 2147483648.0;
                  channelBuffers[c].push(f32);
                } else if (format === 3) { // AV_SAMPLE_FMT_FLT (Packed Float)
                  const rawBytes = Buffer.from(koffi.decode(chPtr, 'uint8_t', nbSamples * detectedChannels * 4));
                  const packedF32 = new Float32Array(rawBytes.buffer, rawBytes.byteOffset, nbSamples * detectedChannels);
                  for (let chIdx = 0; chIdx < detectedChannels; chIdx++) {
                    const f32 = new Float32Array(nbSamples);
                    for (let s = 0; s < nbSamples; s++) {
                      f32[s] = packedF32[s * detectedChannels + chIdx];
                    }
                    channelBuffers[chIdx].push(f32);
                  }
                  break;
                } else if (format === 1) { // AV_SAMPLE_FMT_S16 (Packed Int16)
                  const rawBytes = Buffer.from(koffi.decode(chPtr, 'uint8_t', nbSamples * detectedChannels * 2));
                  const packedI16 = new Int16Array(rawBytes.buffer, rawBytes.byteOffset, nbSamples * detectedChannels);
                  for (let chIdx = 0; chIdx < detectedChannels; chIdx++) {
                    const f32 = new Float32Array(nbSamples);
                    for (let s = 0; s < nbSamples; s++) {
                      f32[s] = packedI16[s * detectedChannels + chIdx] / 32768.0;
                    }
                    channelBuffers[chIdx].push(f32);
                  }
                  break;
                }
              }
              av_frame_unref(frame);
            }
          }
        }
        av_packet_unref(pkt);
      }

      if (channelBuffers.length === 0 || channelBuffers[0].length === 0) {
        throw new Error(`No audio frames could be decoded from ${path.basename(inputPath)}`);
      }

      // Concatenate all chunks for each channel
      const finalChannelData = [];
      for (let c = 0; c < detectedChannels; c++) {
        const totalSamples = channelBuffers[c].reduce((sum, chunk) => sum + chunk.length, 0);
        const merged = new Float32Array(totalSamples);
        let curOffset = 0;
        for (const chunk of channelBuffers[c]) {
          merged.set(chunk, curOffset);
          curOffset += chunk.length;
        }
        finalChannelData.push(merged);
      }

      const totalSamples = finalChannelData[0].length;
      const duration = totalSamples / detectedSampleRate;

      // Generate multichannel WAV file buffer
      const wavBuffer = createWavFile(finalChannelData, detectedSampleRate, detectedChannels);
      fs.writeFileSync(outputPath, wavBuffer);

      resolve({
        channels: detectedChannels,
        sampleRate: detectedSampleRate,
        duration,
        codecName: isAC4 ? 'Dolby AC-4 Atmos' : 'Multichannel Audio',
        decoder: 'PotPlayer ffcodec64 (AC-4 native)'
      });

    } catch (err) {
      reject(err);
    } finally {
      // Free all native memory
      if (frame) {
        const pF = [frame];
        av_frame_free(pF);
      }
      if (pkt) {
        const pP = [pkt];
        av_packet_free(pP);
      }
      if (codecCtx) {
        const pC = [codecCtx];
        avcodec_free_context(pC);
      }
      if (fmtCtx && fmtCtx[0]) {
        avformat_close_input(fmtCtx);
      }
    }
  });
}

module.exports = {
  initFFmpeg,
  decodeFile,
  isAvailable: () => {
    try {
      return initFFmpeg();
    } catch (_) {
      return false;
    }
  }
};
