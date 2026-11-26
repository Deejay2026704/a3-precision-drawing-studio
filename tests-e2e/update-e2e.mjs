// Auto-update end-to-end test for an INSTALLED app (run in CI on Windows and macOS).
//
//   node tests-e2e/update-e2e.mjs "<installed app executable>" <feed dir> <install|notify> <new version>
//
// <feed dir> holds a NEWER build (installer/zip + latest.yml / latest-mac.yml) made with
// -c.extraMetadata.version=<new version>. It is served from 127.0.0.1 and the app is pointed
// at it with A3_UPDATE_URL, so the real GitHub releases are never touched.
//
// install (Windows): the update is offered → nothing is downloaded until the user agrees →
//   "Download and install" → "Restart now" → the NEW version is installed in place and starts.
// notify (unsigned macOS): the update is offered with "Open download page" only (no download).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, statSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
delete process.env.ELECTRON_RUN_AS_NODE;
const { _electron: electron } = require('playwright');

const [exe, feedDir, mode, newVersion] = process.argv.slice(2);
if (!exe || !existsSync(exe) || !feedDir || !existsSync(feedDir) || !['install', 'notify'].includes(mode) || !newVersion) {
  console.error('Usage: node tests-e2e/update-e2e.mjs <app executable> <feed dir> <install|notify> <new version>');
  process.exit(2);
}
const OUT = process.env.E2E_OUT ?? 'test-results';
const tmp = mkdtempSync(path.join(os.tmpdir(), 'a3-update-'));
let failures = 0;
let passes = 0;
const check = (name, cond, detail = '') => {
  if (cond) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- local update server ----------
const requests = [];
const server = http.createServer((req, res) => {
  const name = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  requests.push(name);
  const file = path.join(feedDir, path.basename(name));
  if (!name || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'Content-Length': statSync(file).size, 'Content-Type': 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const feedUrl = `http://127.0.0.1:${server.address().port}/`;
console.log(`Update server ${feedUrl} serving ${feedDir}`);

const baseEnv = { ...process.env, A3_USER_DATA: path.join(tmp, 'profile') };
delete baseEnv.VITE_DEV_SERVER_URL;

async function launch(env) {
  const app = await electron.launch({ executablePath: exe, env, timeout: 60000 });
  const win = await app.firstWindow();
  win.setDefaultTimeout(15000);
  await win.waitForSelector('[data-testid=page-sheet]', { timeout: 30000 });
  return { app, win };
}
const versionOf = (win) => win.evaluate(() => window.a3Studio.config().then((c) => c.version));

let app;
try {
  console.log(`\nUpdate test – mode "${mode}", offering ${newVersion}`);
  ({ app } = await launch({ ...baseEnv, A3_UPDATE_URL: feedUrl, A3_UPDATE_CHECK_DELAY_MS: '1500' }));
  let win = await app.firstWindow();
  const oldVersion = await versionOf(win);
  check(`installed version (${oldVersion}) is older than ${newVersion}`, oldVersion !== newVersion);

  await win.waitForSelector('[data-testid=update-banner][data-state=available]', { timeout: 60000 });
  const text = (await win.textContent('[data-testid=update-text]')) ?? '';
  check('the automatic start-up check offers the new version', text.includes(newVersion) && text.includes(oldVersion), text);
  const downloadsBeforeConsent = requests.filter((r) => /\.(exe|zip|dmg)$/i.test(r));
  check('nothing is downloaded before the user agrees', downloadsBeforeConsent.length === 0, downloadsBeforeConsent.join(','));

  await win.click('[data-testid=update-later]');
  check('"Later" hides the notice', (await win.locator('[data-testid=update-banner]').count()) === 0);
  await win.click('[data-testid=file-menu-button]');
  await win.click('[data-testid=menu-check-updates]');
  await win.waitForSelector('[data-testid=update-banner][data-state=available]', { timeout: 30000 });
  check('File ▸ Check for updates finds it again', true);

  if (mode === 'notify') {
    check('unsigned macOS build offers the download page, not an in-place install', (await win.locator('[data-testid=update-open-page]').count()) === 1 && (await win.locator('[data-testid=update-download]').count()) === 0);
    await app.evaluate(({ shell }) => {
      shell.openExternal = async (u) => {
        globalThis.__opened = u;
      };
    });
    await win.click('[data-testid=update-open-page]');
    await sleep(500);
    const opened = await app.evaluate(() => globalThis.__opened);
    check('"Open download page" opens this project’s release page for that version', opened === `https://github.com/Deejay2026704/a3-precision-drawing-studio/releases/tag/v${newVersion}`, opened);
    await win.screenshot({ path: path.join(OUT, 'update-notify.png') }).catch(() => {});
    await app.close();
    app = null;
  } else {
    await win.click('[data-testid=update-download]');
    await win.waitForSelector('[data-testid=update-banner][data-state=downloaded]', { timeout: 300000 });
    check('after consent the update downloads (and passes its sha512 check)', requests.some((r) => /\.exe$/i.test(r)), requests.join(','));
    await win.screenshot({ path: path.join(OUT, 'update-downloaded.png') }).catch(() => {});
    const exited = new Promise((r) => app.process().once('exit', r));
    await win.click('[data-testid=update-restart]');
    await Promise.race([exited, sleep(60000)]);
    check('"Restart now" closes the app to install', app.process().exitCode !== null || app.process().signalCode !== null);
    app = null;

    // Wait for the silent installer to replace the files (the exe's version resource changes).
    const exeVersion = () => {
      try {
        return execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Item -LiteralPath '${exe}').VersionInfo.ProductVersion`], { encoding: 'utf8' }).trim();
      } catch {
        return '';
      }
    };
    let v = '';
    for (let i = 0; i < 180 && !(v = exeVersion()).startsWith(newVersion); i++) await sleep(1000);
    check(`the installed program is now version ${newVersion}`, v.startsWith(newVersion), v);
    await sleep(5000); // the installer starts the new version: close it before we launch our own
    try {
      execFileSync('taskkill', ['/IM', path.basename(exe), '/F', '/T'], { stdio: 'ignore' });
    } catch {
      /* not running */
    }
    await sleep(2000);
    ({ app } = await launch({ ...baseEnv, A3_DISABLE_UPDATE_CHECK: '1' }));
    win = await app.firstWindow();
    check('the updated app starts and reports the new version', (await versionOf(win)) === newVersion);
    await win.screenshot({ path: path.join(OUT, 'update-installed.png') }).catch(() => {});
    await app.close();
    app = null;
  }
} catch (e) {
  failures++;
  console.log(`  FAIL  script error: ${String(e?.message ?? e).split('\n').join(' | ')}`);
} finally {
  if (app) await app.close().catch(() => {});
  server.close();
}
console.log(`\nUpdate E2E result: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
