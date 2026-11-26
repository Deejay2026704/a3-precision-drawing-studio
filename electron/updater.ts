import { app, ipcMain, shell, type BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { execFileSync } from 'node:child_process';
import { friendlyUpdateError, releasePageUrl, unsupportedReason, updateMode, validFeedUrl, type UpdateEnv, type UpdateStatus } from './updatePolicy';

/** macOS: is the running app signed with a real (Developer ID) certificate rather than ad-hoc? */
function macDeveloperSigned(): boolean {
  if (process.platform !== 'darwin' || !app.isPackaged) return false;
  try {
    const bundle = app.getPath('exe').replace(/\/Contents\/MacOS\/[^/]+$/, '');
    const out = execFileSync('codesign', ['-dv', '--verbose=2', bundle], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return /Authority=Developer ID Application/.test(out);
  } catch (e) {
    // codesign writes its report to stderr
    return /Authority=Developer ID Application/.test(String((e as { stderr?: string }).stderr ?? ''));
  }
}

/**
 * Auto-update through GitHub Releases (electron-updater). Nothing is downloaded or installed
 * without the user's consent; see updatePolicy.ts for the per-platform behaviour.
 */
export function setupUpdater(getWindow: () => BrowserWindow | null, log: (m: string) => void): void {
  const feedUrl = validFeedUrl(process.env.A3_UPDATE_URL);
  const env: UpdateEnv = { platform: process.platform, isPackaged: app.isPackaged, macSigned: macDeveloperSigned(), feedUrl: feedUrl ?? undefined };
  const mode = updateMode(env);
  let status: UpdateStatus = mode === 'unsupported' ? { state: 'unsupported', mode, message: unsupportedReason(env) } : { state: 'idle', mode };
  let manual = false;

  const send = (s: UpdateStatus) => {
    status = s;
    getWindow()?.webContents.send('update:status', { ...s, manual });
  };

  autoUpdater.autoDownload = false; // consent first
  autoUpdater.autoInstallOnAppQuit = false; // only after the user agreed to download
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = { info: (m: unknown) => log(`updater: ${m}`), warn: (m: unknown) => log(`updater warn: ${m}`), error: (m: unknown) => log(`updater error: ${m}`), debug: () => {} };
  if (feedUrl) {
    autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
    log(`updater: using update server ${feedUrl}`);
  }

  autoUpdater.on('checking-for-update', () => send({ state: 'checking', mode }));
  autoUpdater.on('update-not-available', () => send({ state: 'not-available', mode, current: app.getVersion() }));
  autoUpdater.on('update-available', (info) =>
    send({ state: 'available', mode, current: app.getVersion(), version: info.version, releaseUrl: releasePageUrl(info.version) }),
  );
  autoUpdater.on('download-progress', (p) => {
    if (status.state === 'downloading' || status.state === 'available')
      send({ state: 'downloading', mode, version: 'version' in status ? status.version : '', percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    autoUpdater.autoInstallOnAppQuit = true; // the user asked for it: install at the latest on the next quit
    send({ state: 'downloaded', mode, version: info.version });
  });
  autoUpdater.on('error', (err) => {
    log(`updater error: ${err?.stack ?? err}`);
    send({ state: 'error', mode, message: friendlyUpdateError(err) });
  });

  const check = async (isManual: boolean): Promise<UpdateStatus> => {
    manual = isManual;
    if (mode === 'unsupported') {
      send(status);
      return status;
    }
    if (status.state === 'checking' || status.state === 'downloading' || status.state === 'downloaded') {
      send(status);
      return status;
    }
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      send({ state: 'error', mode, message: friendlyUpdateError(err) });
    }
    return status;
  };

  ipcMain.handle('update:check', (_e, isManual: boolean) => check(Boolean(isManual)));
  ipcMain.handle('update:status', () => status);
  ipcMain.handle('update:download', async () => {
    if (mode !== 'install' || status.state !== 'available') return status;
    manual = true; // the user started this: report any failure
    send({ state: 'downloading', mode, version: status.version, percent: 0 });
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      send({ state: 'error', mode, message: friendlyUpdateError(err) });
    }
    return status;
  });
  ipcMain.handle('update:install', () => {
    if (status.state !== 'downloaded') return false;
    log(`updater: restarting to install ${status.version}`);
    // Windows: silent NSIS update into the same folder, then start the new version.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return true;
  });
  ipcMain.handle('update:openReleasePage', () => {
    const url = status.state === 'available' ? status.releaseUrl : releasePageUrl();
    return shell.openExternal(url);
  });

  // Automatic check shortly after start (silent unless an update is found).
  if (mode !== 'unsupported' && !process.env.A3_DISABLE_UPDATE_CHECK) {
    setTimeout(() => void check(false), Number(process.env.A3_UPDATE_CHECK_DELAY_MS) || 8000).unref();
  }
}
