'use strict';

/**
 * server-manager.js — spawns and supervises the `dsh web` process.
 *
 * Pure Node (no Electron imports) so the same module powers the Electron
 * shell and headless smoke tests. Responsibilities:
 *
 *   - probe(port): detect whether a dsh web instance is already listening
 *     (fingerprint: /manifest.webmanifest contains "DeepSeek Harness")
 *   - startDsh(port): spawn `npx @deepseek-ai/dsh web` through the user's
 *     login shell so PATH (nvm, homebrew, ...) resolves; detached so the
 *     whole process group can be reaped on quit
 *   - waitUntilReady(port): poll until the fingerprint appears
 *   - stopDsh(child): terminate the spawned process tree
 */

const http = require('http');
const { spawn } = require('child_process');

const DEFAULT_PORT = 3080;
const FINGERPRINT = 'DeepSeek Harness';
const PROBE_PATH = '/manifest.webmanifest';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Ask whether a dsh web instance answers on `port`.
 * @returns {Promise<'dsh'|'other'|'down'>}
 *   'dsh'   — fingerprint matches, a dsh web is serving here
 *   'other' — something answers but it is not dsh web
 *   'down'  — nothing reachable (connection refused / timeout)
 */
function probe(port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: PROBE_PATH, timeout: timeoutMs },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 8192) req.destroy(); // fingerprint is near the top
        });
        res.on('end', () => {
          const ok = res.statusCode === 200 && body.includes(FINGERPRINT);
          resolve(ok ? 'dsh' : 'other');
        });
        res.on('error', () => resolve('down'));
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve('down');
    });
    req.on('error', () => resolve('down'));
  });
}

/**
 * Build the shell invocation that runs the dsh web command.
 * The command string keeps the user's own command: `npx @deepseek-ai/dsh web`.
 * `--yes` keeps npx non-interactive; `--prefer-online` forces npx to consult
 * the registry every launch so the latest published version is used.
 * `--no-open` stops dsh web from opening the default browser: the shell
 * renders the UI in its embedded window, so a second browser tab is unwanted.
 * A non-default port is forwarded as `--port N`, which the dsh web app itself
 * understands (launcher flags come first, the rest belongs to the app).
 */
function shellCommand(command) {
  if (process.platform === 'win32') {
    return { file: process.env.COMSPEC || 'cmd.exe', args: ['/d', '/s', '/c', command] };
  }
  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh');
  return { file: shell, args: ['-lc', command] };
}

function buildDshCommand(port) {
  // `--no-open` stops dsh web from opening the default browser — the shell
  // renders the UI in its embedded window, so a browser tab is unwanted.
  const base = 'npx --yes --prefer-online @deepseek-ai/dsh web --no-open';
  return port === DEFAULT_PORT ? base : `${base} --port ${port}`;
}

/**
 * Spawn the dsh web process.
 * @param {object} options
 * @param {number} [options.port]
 * @param {(line: string) => void} [options.onLog]  dsh stdout/stderr line sink
 * @param {object} [options.env]  extra environment for the child (merged over process.env)
 * @returns {import('child_process').ChildProcess}
 */
function startDsh({ port = DEFAULT_PORT, onLog, env = {} } = {}) {
  const { file, args } = shellCommand(buildDshCommand(port));
  const child = spawn(file, args, {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  });
  const sink = (streamName) => (chunk) => {
    const text = chunk.toString();
    for (const line of text.split(/\r?\n/)) {
      if (line.length > 0 && onLog) onLog(`[dsh] ${line}`);
    }
  };
  child.stdout.on('data', sink('stdout'));
  child.stderr.on('data', sink('stderr'));
  child.on('error', (err) => {
    if (onLog) onLog(`[dsh] spawn error: ${err.message}`);
  });
  child.on('exit', (code, signal) => {
    if (onLog) onLog(`[dsh] exited (code=${code}, signal=${signal})`);
  });
  return child;
}

/**
 * Poll until the dsh web fingerprint answers on `port`.
 * @returns {Promise<{ok: boolean, reason?: 'timeout'|'occupied', attempts: number}>}
 */
async function waitUntilReady(port, { timeoutMs = 240000, intervalMs = 800, onAttempt } = {}) {
  const deadline = Date.now() + timeoutMs;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    const state = await probe(port);
    if (state === 'dsh') return { ok: true, attempts };
    if (state === 'other') return { ok: false, reason: 'occupied', attempts };
    if (onAttempt) onAttempt(attempts, state);
    await sleep(intervalMs);
  }
  return { ok: false, reason: 'timeout', attempts };
}

/**
 * Terminate the spawned dsh process tree.
 * POSIX: negative pid kills the whole detached process group.
 * Windows: taskkill /T /F walks the tree.
 * @returns {Promise<void>}
 */
function stopDsh(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) {
      resolve();
      return;
    }
    const pid = child.pid;
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
      resolve();
      return;
    }
    let killed = false;
    try {
      process.kill(-pid, 'SIGTERM');
      killed = true;
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
        killed = true;
      } catch {
        resolve(); // already gone
        return;
      }
    }
    const timer = setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
      resolve();
    }, 3000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

module.exports = {
  DEFAULT_PORT,
  FINGERPRINT,
  probe,
  startDsh,
  stopDsh,
  waitUntilReady,
  buildDshCommand,
  shellCommand,
};
