'use strict';

/**
 * logger.js — tiny file logger for the shell and for the spawned dsh process.
 * Writes to <userData>/logs/<name>.log; also mirrors to the console when the
 * app was started from a terminal (npm start).
 */

const fs = require('fs');
const path = require('path');

function createLogger(logDir, name) {
  fs.mkdirSync(logDir, { recursive: true });
  const file = path.join(logDir, `${name}.log`);
  const stream = fs.createWriteStream(file, { flags: 'a' });
  const stamp = () => new Date().toISOString();
  const write = (line) => {
    stream.write(`[${stamp()}] ${line}\n`);
    if (process.stdout.isTTY) process.stdout.write(`${line}\n`);
  };
  return {
    file,
    info: (msg) => write(msg),
    error: (msg) => write(`ERROR: ${msg}`),
    end: () => stream.end(),
  };
}

module.exports = { createLogger };
