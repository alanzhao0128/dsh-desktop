'use strict';

/**
 * preload.js — minimal bridge for the shell's own local pages (loading/error).
 * Exposes read-only status updates and a retry trigger. The remote dsh web
 * page never uses these APIs.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  /** @param {(status: {phase: string, detail?: string}) => void} cb */
  onStatus(cb) {
    ipcRenderer.on('shell:status', (_event, status) => cb(status));
  },
  /** Ask the main process to retry booting dsh web. */
  retry() {
    ipcRenderer.send('shell:retry');
  },
});
