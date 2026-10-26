// desktop/joc-decoder.js
// Isolated Dolby Atmos JOC (Joint Object Coding) Pre-Processor
// Runs OpenJOC and Cavernize CLI as standalone child processes
// NEVER imported by server.js or audio-engine.js — 100% isolated

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

class JOCDecoder {
  constructor() {
    this.activeProcess = null;
    this.lastOriginalFile = null;
    this.lastDecodedFile = null;
    this.onLog = null;
    this.onProgress = null;
  }

  // ─── Path Resolution & Status ──────────────────────────────────────────────

  _findTool(toolName) {
    const toolsDir = path.join(__dirname, '..', 'tools');
    const localExe = path.join(toolsDir, `${toolName}.exe`);
    const localNoExt = path.join(toolsDir, toolName);

    if (fs.existsSync(localExe)) return localExe;
    if (fs.existsSync(localNoExt)) return localNoExt;

    // Search immediate subdirectories (e.g. tools/openjoc-0.19.0-x86_64-pc-windows-msvc/bin/openjoc.exe)
    try {
      if (fs.existsSync(toolsDir)) {
        const entries = fs.readdirSync(toolsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const subDir = path.join(toolsDir, entry.name);
            const inSub = path.join(subDir, `${toolName}.exe`);
            if (fs.existsSync(inSub)) return inSub;

            const inBin = path.join(subDir, 'bin', `${toolName}.exe`);
            if (fs.existsSync(inBin)) return inBin;
          }
        }
      }
    } catch (_) {}

    // Check system PATH
    try {
      const cmd = process.platform === 'win32' ? `where.exe ${toolName}` : `which ${toolName}`;
      const found = execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim().split(/\r?\n/)[0];
      if (found && fs.existsSync(found)) return found;
    } catch (_) {}

    return null;
  }

  getStatus() {
    const openjocPath = this._findTool('openjoc');
    const cavernizePath = this._findTool('Cavernize') || this._findTool('cavernize');

    return {
      openjoc: {
        available: !!openjocPath,
        path: openjocPath,
        name: 'OpenJOC (Rust)'
      },
      cavernize: {
        available: !!cavernizePath,
        path: cavernizePath,
        name: 'Cavernize (.NET)'
      },
      toolsDir: path.join(__dirname, '..', 'tools')
    };
  }

  // ─── Decoding Methods ───────────────────────────────────────────────────────

  async decodeWithOpenJOC(inputFile, targetLayout = '7.1.4') {
    if (!inputFile || !fs.existsSync(inputFile)) {
      throw new Error(`Input file does not exist: ${inputFile || 'none'}`);
    }

    const status = this.getStatus();
    if (!status.openjoc.available) {
      throw new Error('openjoc.exe not found. Please place openjoc.exe into the tools/ folder.');
    }

    const id = `joc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const outputFile = path.join(os.tmpdir(), `${id}_${targetLayout.replace(/\./g, '_')}.wav`);

    // OpenJOC 0.19.x syntax: openjoc render-joc <FILE> --layout <PRESET> --output <OUTPUT.wav> --overwrite
    const args = ['render-joc', inputFile, '--layout', targetLayout, '--output', outputFile, '--overwrite'];

    return this._runDecoder(status.openjoc.path, args, inputFile, outputFile, 'OpenJOC');
  }

  async decodeWithCavernize(inputFile, targetLayout = '7.1.4') {
    if (!inputFile || !fs.existsSync(inputFile)) {
      throw new Error(`Input file does not exist: ${inputFile || 'none'}`);
    }

    const status = this.getStatus();
    if (!status.cavernize.available) {
      throw new Error('Cavernize.exe not found. Please place Cavernize.exe into the tools/ folder.');
    }

    const id = `cavern_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const outputFile = path.join(os.tmpdir(), `${id}_${targetLayout.replace(/\./g, '_')}.wav`);

    // Cavernize standard CLI:
    // -i <inputFile> -o <outputFile> -t <targetLayout> -f PCM_LE
    const args = ['-i', inputFile, '-o', outputFile, '-t', targetLayout, '-f', 'PCM_LE'];

    return this._runDecoder(status.cavernize.path, args, inputFile, outputFile, 'Cavernize');
  }

  // ─── Process Runner ────────────────────────────────────────────────────────

  async _runDecoder(exePath, args, originalFile, outputFile, engineName) {
    if (this.activeProcess) {
      throw new Error('Another decode job is already in progress. Please cancel it or wait.');
    }

    this.lastOriginalFile = originalFile;

    return new Promise((resolve, reject) => {
      this._log(`[${engineName}] Starting decoder...`);
      this._log(`[${engineName}] Binary: ${exePath}`);
      this._log(`[${engineName}] Arguments: ${args.join(' ')}`);
      this._log(`[${engineName}] Output target: ${outputFile}`);

      try {
        const proc = spawn(exePath, args, {
          cwd: path.dirname(exePath),
          windowsHide: true
        });

        this.activeProcess = proc;
        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (data) => {
          const str = data.toString();
          stdout += str;
          str.split(/\r?\n/).forEach(line => {
            if (line.trim()) this._log(`[${engineName}] ${line.trim()}`);
          });
        });

        proc.stderr?.on('data', (data) => {
          const str = data.toString();
          stderr += str;
          str.split(/\r?\n/).forEach(line => {
            if (line.trim()) this._log(`[${engineName} stderr] ${line.trim()}`);
          });
        });

        proc.on('error', (err) => {
          this.activeProcess = null;
          this._log(`❌ [${engineName}] Process error: ${err.message}`);
          reject(new Error(`Failed to launch ${engineName}: ${err.message}`));
        });

        proc.on('close', (code) => {
          this.activeProcess = null;

          if (code === 0 && fs.existsSync(outputFile)) {
            const stat = fs.statSync(outputFile);
            if (stat.size > 1000) {
              this.lastDecodedFile = outputFile;
              this._log(`✅ [${engineName}] Decode successful! (${(stat.size / (1024 * 1024)).toFixed(2)} MB)`);
              resolve({
                success: true,
                engine: engineName,
                outputFile,
                originalFile,
                sizeBytes: stat.size,
                filename: path.basename(outputFile)
              });
              return;
            }
          }

          // If standard exit was not 0 or output file is empty
          const errDetail = stderr.slice(-400) || stdout.slice(-400) || `Process exited with code ${code}`;
          this._log(`❌ [${engineName}] Decode failed with exit code ${code}`);
          reject(new Error(`${engineName} failed (code ${code}): ${errDetail}`));
        });

      } catch (err) {
        this.activeProcess = null;
        reject(err);
      }
    });
  }

  // ─── Lifecycle & Control ───────────────────────────────────────────────────

  cancel() {
    if (this.activeProcess) {
      try {
        if (process.platform === 'win32') {
          const { exec } = require('child_process');
          exec(`taskkill /pid ${this.activeProcess.pid} /f /t`);
        } else {
          this.activeProcess.kill('SIGKILL');
        }
      } catch (_) {
        try { this.activeProcess.kill(); } catch (_) {}
      }
      this.activeProcess = null;
      this._log('⚠️ Decode cancelled by user');
      return true;
    }
    return false;
  }

  getRestoreInfo() {
    return {
      hasOriginal: !!(this.lastOriginalFile && fs.existsSync(this.lastOriginalFile)),
      originalFile: this.lastOriginalFile,
      hasDecoded: !!(this.lastDecodedFile && fs.existsSync(this.lastDecodedFile)),
      decodedFile: this.lastDecodedFile
    };
  }

  cleanup() {
    if (this.lastDecodedFile && fs.existsSync(this.lastDecodedFile)) {
      try {
        fs.unlinkSync(this.lastDecodedFile);
        this._log(`🧹 Cleaned up temporary decoded file: ${path.basename(this.lastDecodedFile)}`);
      } catch (e) {
        console.warn('[JOCDecoder] Cleanup error:', e.message);
      }
    }
    this.lastDecodedFile = null;
  }

  async readFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    return await fs.promises.readFile(filePath);
  }

  _log(msg) {
    if (this.onLog) {
      try { this.onLog(msg); } catch (_) {}
    }
    console.log(`[JOCDecoder] ${msg}`);
  }
}

module.exports = JOCDecoder;
