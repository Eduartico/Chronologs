// Chronologs as a window of its own rather than a browser tab, so it can sit
// pinned on the taskbar with its own icon.
//
// Still a browser underneath: this is Electron loading the same Express server
// and the same built frontend `npm start` serves. The server runs inside this
// process, so opening the window starts it and closing the window stops it —
// unless one is already listening (`npm run dev` / `npm start` in a terminal),
// in which case the window just points at that one.

import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import { spawn } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { connect } from 'net';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3001);
const ORIGIN = `http://localhost:${PORT}`;
const ICON = join(ROOT, 'desktop', 'icon.ico');
// The taskbar groups windows by this id and matches a pin to the Start Menu
// shortcut carrying the same one. Without it the window groups under
// electron.exe, and a pin relaunches bare Electron instead of Chronologs.
const APP_ID = 'com.chronologs.app';

app.setName('Chronologs');
app.setAppUserModelId(APP_ID);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(start).catch((err) => {
    dialog.showErrorBox('Chronologs failed to start', String(err?.stack || err));
    app.exit(1);
  });
}

async function start() {
  Menu.setApplicationMenu(null);
  ensureStartMenuShortcut();

  const win = createWindow();
  win.loadURL(splash('Starting…'));

  if (!(await portInUse(PORT))) {
    if (needsBuild()) {
      win.loadURL(splash('Building the interface…'));
      await buildFrontend();
    }
    process.env.PORT = String(PORT);
    // server/index.js listens on import. It is the same entry `npm start` runs.
    await import(pathToFileURL(join(ROOT, 'server', 'index.js')).href);
    await waitForPort(PORT);
  }

  win.loadURL(ORIGIN);
}

// ── Window ──────────────────────────────────────────────────────────────────

const STATE_FILE = () => join(app.getPath('userData'), 'window-state.json');

function readWindowState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE(), 'utf8'));
  } catch {
    return { width: 1440, height: 900 };
  }
}

function createWindow() {
  const state = readWindowState();
  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 720,
    minHeight: 480,
    title: 'Chronologs',
    icon: ICON,
    // Guardian's page colour, so the first frame is not white. The page's own
    // pre-paint script takes over from here with whatever theme was last chosen.
    backgroundColor: '#0c1016',
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (state.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());

  win.on('close', () => {
    try {
      const bounds = win.getNormalBounds();
      writeFileSync(STATE_FILE(), JSON.stringify({ ...bounds, maximized: win.isMaximized() }));
    } catch {}
  });

  // Anything that leaves the app — the Google sign-in, the Cloud console link —
  // opens in the real browser. Google refuses to sign in inside an embedded
  // one, and the OAuth callback lands on this same local server either way.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isExternal(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // With the menu bar gone, so are its accelerators. Put back the few a
  // browser tab had.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    const wc = win.webContents;
    if (input.key === 'F5' || (ctrl && input.key.toLowerCase() === 'r')) wc.reload();
    else if (input.key === 'F12' || (ctrl && input.shift && input.key.toLowerCase() === 'i')) wc.toggleDevTools();
    else if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    else if (ctrl && (input.key === '=' || input.key === '+')) wc.setZoomLevel(wc.getZoomLevel() + 0.5);
    else if (ctrl && input.key === '-') wc.setZoomLevel(wc.getZoomLevel() - 0.5);
    else if (ctrl && input.key === '0') wc.setZoomLevel(0);
    else return;
    event.preventDefault();
  });

  return win;
}

function isExternal(url) {
  return !url.startsWith(ORIGIN) && !url.startsWith('data:');
}

function splash(text) {
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:grid;place-items:center;background:#0c1016;color:#9aa4b2;font:14px system-ui,sans-serif">${text}</body>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

app.on('window-all-closed', () => app.quit());

// Same shutdown the server does on SIGINT: flush every browser-source session.
let closing = false;
app.on('before-quit', async (event) => {
  if (closing) return;
  closing = true;
  event.preventDefault();
  try {
    const { closeAllBrowsers } = await import(
      pathToFileURL(join(ROOT, 'server', 'framework', 'kits', 'browserSource.js')).href
    );
    await closeAllBrowsers();
  } catch {}
  app.exit(0);
});

// ── Frontend build ──────────────────────────────────────────────────────────

// Express serves web/dist. Rebuild when it is missing or older than anything
// that goes into it, so a `git pull` shows up the next time the window opens
// without anyone remembering `npm run build`.
function needsBuild() {
  const built = join(ROOT, 'web', 'dist', 'index.html');
  if (!existsSync(built)) return true;
  const builtAt = statSync(built).mtimeMs;
  const sources = [join(ROOT, 'web', 'src'), join(ROOT, 'web', 'public'), join(ROOT, 'modules'), join(ROOT, 'web', 'index.html')];
  return sources.some((p) => newerThan(p, builtAt));
}

function newerThan(path, time) {
  if (!existsSync(path)) return false;
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs > time;
  return readdirSync(path).some((name) => name !== 'node_modules' && newerThan(join(path, name), time));
}

function buildFrontend() {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['vite', 'build'], { cwd: join(ROOT, 'web'), shell: true, windowsHide: true });
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Frontend build failed:\n${output}`))));
  });
}

// ── Server ──────────────────────────────────────────────────────────────────

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

async function waitForPort(port, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await portInUse(port)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`The server did not start listening on port ${port}.`);
}

// ── Taskbar ─────────────────────────────────────────────────────────────────

// A Start Menu entry with the app id and icon. Windows pins the running window
// through it, so "Pin to taskbar" on the window's icon relaunches Chronologs
// rather than bare Electron. Rewritten every launch in case the repo moved.
function ensureStartMenuShortcut() {
  if (process.platform !== 'win32') return;
  const link = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Chronologs.lnk');
  try {
    shell.writeShortcutLink(link, existsSync(link) ? 'replace' : 'create', {
      target: process.execPath,
      args: `"${ROOT}"`,
      cwd: ROOT,
      icon: ICON,
      iconIndex: 0,
      appUserModelId: APP_ID,
      description: 'Chronologs',
    });
  } catch {}
}
