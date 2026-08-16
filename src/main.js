'use strict';

/**
 * main.js — the dsh-desktop Electron shell.
 *
 * Boot flow:
 *   1. probe 127.0.0.1:<port> for a running dsh web
 *   2. found  -> reuse it (never spawned by us; not killed on quit)
 *   3. absent -> spawn `npx --yes --prefer-online @deepseek-ai/dsh web`
 *                through the user's login shell, poll until ready
 *   4. load http://127.0.0.1:<port> in the window
 *
 * On quit, only a process we spawned is terminated.
 */

const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const {
  DEFAULT_PORT,
  probe,
  startDsh,
  stopDsh,
  waitUntilReady,
} = require('./server-manager');
const { createLogger } = require('./logger');

const APP_TITLE = 'DeepSeek Harness';

let win = null;
let dshChild = null; // set only when we spawned the server ourselves
let managed = false; // true when dshChild is the process we must clean up
let booting = false;
let quitting = false;
let logger = null;
let dshLogger = null;

function sendStatus(phase, detail) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('shell:status', { phase, detail });
  }
}

function portFromEnv() {
  const raw = process.env.DSH_DESKTOP_PORT;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : DEFAULT_PORT;
}

function isLocalUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost');
  } catch {
    return false;
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 480,
    title: APP_TITLE,
    backgroundColor: '#0d1117',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalUrl(url)) {
      // In-app navigation: open in the same window.
      win.loadURL(url);
      return { action: 'deny' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (!isLocalUrl(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    // The only content is the local dsh web server; grant its requests.
    callback(true);
  });

  win.on('closed', () => {
    win = null;
  });

  win.loadFile(path.join(__dirname, 'pages', 'shell.html'));
  boot(portFromEnv());
  return win;
}

async function boot(port) {
  if (booting) return;
  booting = true;
  sendStatus('starting', '正在检测 dsh web 服务…');

  const state = await probe(port);
  if (state === 'dsh') {
    logger.info(`port ${port}: existing dsh web found, reusing (external, not managed)`);
    managed = false;
    loadApp(port);
    return;
  }
  if (state === 'other') {
    const msg = `端口 ${port} 已被其他服务占用，且不是 dsh web。\n请设置 DSH_DESKTOP_PORT 环境变量换一个端口后重试。`;
    logger.error(msg);
    sendStatus('error', msg);
    booting = false;
    return;
  }

  logger.info(`port ${port}: no dsh web, spawning: ${process.env.SHELL || 'sh'} -lc 'npx @deepseek-ai/dsh web'`);
  sendStatus('spawning', '正在通过 npx 启动 dsh web（首次会下载最新版本，请稍候）…');

  const env = {};
  if (process.env.DSH_NPM_CACHE) env.npm_config_cache = process.env.DSH_NPM_CACHE;

  dshChild = startDsh({
    port,
    env,
    onLog: (line) => dshLogger.info(line),
  });
  managed = true;

  const result = await waitUntilReady(port, {
    timeoutMs: 300000, // npx may download the latest package on first launch
    onAttempt: (attempt) => {
      sendStatus('waiting', `正在等待 dsh web 就绪…（第 ${attempt} 次探测）`);
    },
  });

  if (result.ok) {
    logger.info(`port ${port}: dsh web ready after ${result.attempts} probes`);
    loadApp(port);
    return;
  }
  if (result.reason === 'occupied') {
    const msg = `端口 ${port} 被其他服务占用（非 dsh web）。请设置 DSH_DESKTOP_PORT 换端口后重试。`;
    logger.error(msg);
    sendStatus('error', msg);
    booting = false;
    return;
  }

  const msg =
    `等待 dsh web 启动超时（${result.attempts} 次探测后仍未就绪）。\n` +
    `请查看日志文件了解原因：\n${dshLogger.file}`;
  logger.error(msg);
  sendStatus('error', msg);
  booting = false;
}

function loadApp(port) {
  const url = `http://127.0.0.1:${port}`;
  logger.info(`loading ${url}`);
  sendStatus('ready', `正在打开 ${url}`);
  if (win && !win.isDestroyed()) {
    win.loadURL(url);
    if (process.env.DSH_DESKTOP_AUTOCLOSE) {
      win.webContents.once('did-finish-load', () => {
        logger.info('AUTOCLOSE: app page loaded, quitting');
        setTimeout(() => app.quit(), 1500);
      });
    }
    if (process.env.DSH_DESKTOP_CLOSE_TEST) {
      // Test hook: close the window, verify the app survives (macOS
      // convention), then quit to exercise the real cleanup path.
      win.webContents.once('did-finish-load', () => {
        logger.info('CLOSE_TEST: closing window (app must NOT quit)');
        win.close();
        setTimeout(() => {
          const marker = path.join(app.getPath('userData'), 'close-test-ok');
          fs.writeFileSync(marker, 'app survived window close\n');
          logger.info('CLOSE_TEST: app alive after window close, quitting now');
          app.quit();
        }, 3000);
      });
    }
  }
  booting = false;
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        }]
      : []),
    {
      label: '编辑',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize' },
        ...(isMac ? [{ role: 'zoom' }, { type: 'separator' }, { role: 'front' }] : [{ role: 'close' }]),
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '打开日志目录',
          click: () => shell.openPath(path.join(app.getPath('userData'), 'logs')),
        },
        {
          label: 'DeepSeek Harness 仓库',
          click: () => shell.openExternal('https://github.com/deepseek-ai/deepseek-harness'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- lifecycle ----

process.on('unhandledRejection', (reason) => {
  if (logger) {
    logger.error(`unhandled rejection: ${reason && reason.stack ? reason.stack : String(reason)}`);
  }
});

app.whenReady().then(() => {
  const logDir = path.join(app.getPath('userData'), 'logs');
  logger = createLogger(logDir, 'shell');
  dshLogger = createLogger(logDir, 'dsh');
  logger.info(`dsh-desktop ${app.getVersion()} starting (electron ${process.versions.electron})`);
  logger.info(`userData: ${app.getPath('userData')}`);

  buildMenu();
  createWindow();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// macOS convention: closing the window keeps the app (and the dsh web it
// manages) running in the Dock; quit with Cmd+Q / menu Quit, which reaps the
// spawned dsh process. Other platforms keep window-close-quits-app behavior.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

let cleanupDone = false;
async function cleanup() {
  if (cleanupDone) return;
  cleanupDone = true;
  if (managed && dshChild) {
    logger.info('stopping spawned dsh web process tree');
    await stopDsh(dshChild);
  } else if (dshChild) {
    logger.info('dsh web was external; leaving it running');
  }
  if (logger) logger.end();
  if (dshLogger) dshLogger.end();
}

app.on('will-quit', (event) => {
  if (quitting) return;
  quitting = true;
  event.preventDefault();
  cleanup().finally(() => {
    app.exit(0);
  });
});

ipcMain.on('shell:retry', async () => {
  if (managed && dshChild) {
    logger.info('retry: stopping previous spawned dsh process first');
    await stopDsh(dshChild);
    dshChild = null;
    managed = false;
  }
  if (win && !win.isDestroyed()) {
    win.loadFile(path.join(__dirname, 'pages', 'shell.html'));
  }
  boot(portFromEnv());
});
