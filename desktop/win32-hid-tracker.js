// desktop/win32-hid-tracker.js
// Manager class for the in-process native Win32 HID driver (Approach B)
const { Worker } = require('worker_threads');
const { EventEmitter } = require('events');
const path = require('path');

class Win32SonyHidTracker extends EventEmitter {
  constructor() {
    super();
    this.worker = null;
    this.isConnected = false;
    this.lastPose = null;
    this.status = { state: 'idle', message: '' };
  }

  start() {
    if (this.worker) return;

    const workerPath = path.join(__dirname, 'hid-worker.js');
    this.worker = new Worker(workerPath);

    this.worker.on('message', (msg) => {
      if (msg.type === 'status') {
        this.status = msg;
        this.isConnected = msg.state === 'streaming';
        this.emit('status', msg);
      } else if (msg.type === 'pose') {
        this.lastPose = msg.pose;
        this.emit('pose', msg.pose);
      } else if (msg.type === 'log') {
        this.emit('log', msg.message);
      } else if (msg.type === 'error') {
        this.emit('error', new Error(msg.error));
      }
    });

    this.worker.on('error', (err) => {
      this.emit('error', err);
    });

    this.worker.on('exit', (code) => {
      this.worker = null;
      this.isConnected = false;
      this.emit('exit', code);
    });
  }

  recenter() {
    if (this.worker) {
      this.worker.postMessage('recenter');
    }
  }

  stop() {
    if (this.worker) {
      this.worker.postMessage('stop');
      setTimeout(() => {
        if (this.worker) {
          this.worker.terminate();
          this.worker = null;
        }
      }, 1000);
    }
  }
}

module.exports = Win32SonyHidTracker;
