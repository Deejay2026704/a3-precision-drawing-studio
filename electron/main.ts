import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './atomicWrite';

const APP_TITLE = 'A3 Precision Drawing Studio';
const FILE_FILTERS = [
  { name: 'A3 Drawing', extensions: ['a3d'] },
  { name: 'All files', extensions: ['*'] },
];

let mainWindow: BrowserWindow | null = null;
let documentDirty = false;

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

ipcMain.on('doc:dirty', (_e, dirty: boolean) => {
  documentDirty = Boolean(dirty);
});

ipcMain.on('app:quit', () => mainWindow?.close());

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
