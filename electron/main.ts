import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './atomicWrite';
import { AutosaveStore, DEFAULT_STALE_MS, sessionId } from './autosaveStore';
import { appendFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';

const APP_TITLE = 'A3 Precision Drawing Studio';
const FILE_FILTERS = [
  { name: 'A3 Drawing', extensions: ['a3d'] },
  { name: 'All files', extensions: ['*'] },
];

let mainWindow: BrowserWindow | null = null;
let documentDirty = false;

/**
 * Lifecycle diagnostics: stderr (terminal / test harness) and, synchronously, a small log
 * file in the app data folder (logs/main.log, reset above 512 KB) so nothing is lost when
 * the process exits early.
 */
function log(msg: string): void {
  const line = `${new Date().toISOString()} [a3 pid ${process.pid}] ${msg}\n`;
  process.stderr.write(line);
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'main.log');
    if (existsSync(file) && statSync(file).size > 512 * 1024) writeFileSync(file, '');
    appendFileSync(file, line);
  } catch {
    /* logging must never break the app */
  }
}

// Tests (and portable setups) can redirect all app data, including autosave, away from the real profile.
if (process.env.A3_USER_DATA) app.setPath('userData', process.env.A3_USER_DATA);

log(`starting – argv: ${JSON.stringify(process.argv.slice(1))}`);
const SESSION = sessionId(process.pid, Date.now());
let autosave: AutosaveStore | null = null;
const STALE_MS = Number(process.env.A3_HEARTBEAT_STALE_MS) || DEFAULT_STALE_MS; // test hook
const autosaveStore = () =>
  (autosave ??= new AutosaveStore(path.join(app.getPath('userData'), 'autosave'), SESSION, undefined, STALE_MS));

/** A .a3d file the OS asked us to open (double-click / "Open with" / macOS open-file). */
let pendingOpenPath: string | null = null;
const projectArg = (argv: readonly string[]) => argv.slice(1).find((a) => /\.a3d$/i.test(a) && existsSync(a)) ?? null;
pendingOpenPath = projectArg(process.argv);

function requestOpen(filePath: string) {
  if (mainWindow) mainWindow.webContents.send('app:openFile', filePath);
  else pendingOpenPath = filePath;
}

// One window: a second launch (e.g. double-clicking another drawing) hands its file to this instance.
const gotLock = Boolean(process.env.A3_ALLOW_MULTIPLE) || app.requestSingleInstanceLock();
if (!gotLock) {
  log('another instance holds the single-instance lock – handing over and quitting');
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const f = projectArg(argv);
    if (f) requestOpen(f);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
app.on('open-file', (e, filePath) => {
  e.preventDefault();
  requestOpen(filePath);
});

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: APP_TITLE,
    backgroundColor: '#7d8085',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The application provides its own File menu and ribbon.
  Menu.setApplicationMenu(null);

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.on('render-process-gone', (_e, d) => log(`renderer gone: ${d.reason} (exit ${d.exitCode})`));
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => log(`load failed: ${code} ${desc} ${url}`));
  mainWindow.webContents.on('preload-error', (_e, p, err) => log(`preload error in ${p}: ${err.message}`));

  mainWindow.on('close', (event) => {
    if (!documentDirty || !mainWindow) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      title: APP_TITLE,
      message: 'The drawing has unsaved changes.',
      detail: 'Close without saving?',
      buttons: ['Close without saving', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    if (choice !== 0) event.preventDefault();
  });
  mainWindow.on('closed', () => {
    log('main window closed');
    mainWindow = null;
  });

  // Never open new windows from renderer content.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

// ---------- IPC: file access is performed only in the main process ----------

ipcMain.handle('file:open', async () => {
  if (!mainWindow) return null;
  const res = await dialog.showOpenDialog(mainWindow, { title: 'Open drawing', filters: FILE_FILTERS, properties: ['openFile'] });
  if (res.canceled || res.filePaths.length === 0) return null;
  const filePath = res.filePaths[0];
  return { path: filePath, content: await fs.readFile(filePath, 'utf8') };
});

ipcMain.handle('file:save', async (_e, filePath: string, content: string) => {
  await writeFileAtomic(filePath, content);
  return filePath;
});

ipcMain.handle('file:exportPdf', async (_e, bytes: Uint8Array, suggestedName: string) => {
  if (!mainWindow) return null;
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Export PDF',
    defaultPath: suggestedName,
    filters: [{ name: 'PDF document', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return null;
  await writeFileAtomic(res.filePath, Buffer.from(bytes));
  return res.filePath;
});

ipcMain.handle('file:exportSvg', async (_e, content: string, suggestedName: string) => {
  if (!mainWindow) return null;
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Export SVG',
    defaultPath: suggestedName,
    filters: [{ name: 'SVG image', extensions: ['svg'] }],
  });
  if (res.canceled || !res.filePath) return null;
  await writeFileAtomic(res.filePath, content);
  return res.filePath;
});

ipcMain.handle('file:saveAs', async (_e, content: string, suggestedName: string) => {
  if (!mainWindow) return null;
  const res = await dialog.showSaveDialog(mainWindow, { title: 'Save drawing as', defaultPath: suggestedName, filters: FILE_FILTERS });
  if (res.canceled || !res.filePath) return null;
  await writeFileAtomic(res.filePath, content);
  return res.filePath;
});

ipcMain.handle('file:readPath', async (_e, filePath: string) => {
  if (!/\.a3d$/i.test(filePath)) throw new Error('Only .a3d project files can be opened');
  return { path: filePath, content: await fs.readFile(filePath, 'utf8') };
});
ipcMain.handle('app:takePendingOpen', () => {
  const p = pendingOpenPath;
  pendingOpenPath = null;
  return p;
});
ipcMain.handle('app:config', () => ({
  version: app.getVersion(),
  platform: process.platform,
  autosaveIntervalMs: Number(process.env.A3_AUTOSAVE_INTERVAL_MS) || null,
}));

// ---------- autosave (crash recovery) – separate from project files ----------
ipcMain.handle('autosave:write', (_e, content: string) => autosaveStore().write(content));
ipcMain.handle('autosave:clear', () => autosaveStore().clear());
ipcMain.handle('autosave:orphans', () => autosaveStore().orphans());
ipcMain.handle('autosave:read', (_e, id: string) => autosaveStore().read(id));
ipcMain.handle('autosave:remove', (_e, id: string) => autosaveStore().remove(id));

// A normal quit (the user saved, or chose to discard) leaves no recovery copy behind.
// A crash or forced kill skips this, so the copy survives for recovery.
app.on('will-quit', () => {
  for (const ext of ['json', 'alive']) rmSync(path.join(app.getPath('userData'), 'autosave', `${SESSION}.${ext}`), { force: true });
});

ipcMain.on('doc:dirty', (_e, dirty: boolean) => {
  documentDirty = Boolean(dirty);
});

ipcMain.on('app:quit', () => mainWindow?.close());

app.on('child-process-gone', (_e, d) => log(`child process gone: ${d.type} ${d.reason} (exit ${d.exitCode})`));
app.on('quit', (_e, code) => log(`quit (exit code ${code})`));
process.on('uncaughtException', (err) => log(`uncaught exception: ${err.stack ?? err}`));

app.whenReady().then(() => {
  if (!gotLock) return; // handing over to the running instance: never open a second window
  log(`ready – version ${app.getVersion()}, userData ${app.getPath('userData')}`);
  const beat = () => void autosaveStore().heartbeat().catch((e: Error) => log(`heartbeat failed: ${e.message}`));
  beat();
  setInterval(beat, Math.max(1000, Math.min(10_000, STALE_MS / 3))).unref();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
