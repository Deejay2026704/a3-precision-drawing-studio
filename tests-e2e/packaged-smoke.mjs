// Smoke test for a PACKAGED / INSTALLED app (Windows, macOS or Linux build).
//
//   node tests-e2e/packaged-smoke.mjs "<path to the app executable>"
//
// Windows: C:\...\A3 Precision Drawing Studio\A3 Precision Drawing Studio.exe
// macOS:   .../A3 Precision Drawing Studio.app/Contents/MacOS/A3 Precision Drawing Studio
// Linux:   release/linux-unpacked/a3-precision-drawing-studio   (add E2E_ELECTRON_ARGS=--no-sandbox when root)
//
// Uses a temporary profile (A3_USER_DATA) so the real user profile is never touched.
// Checks: launch from the package (file://, CSP), drawing, PDF export at A3 true size,
// autosave to the separate recovery folder, CRASH + recovery, save/reopen, clean quit.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
// Must be REMOVED, not blanked: on Windows Electron treats an empty ELECTRON_RUN_AS_NODE as set.
delete process.env.ELECTRON_RUN_AS_NODE;
const { _electron: electron } = require('playwright');

const exe = process.argv[2];
if (!exe || !existsSync(exe)) {
  console.error(`Usage: node tests-e2e/packaged-smoke.mjs <app executable>  (not found: ${exe})`);
  process.exit(2);
}
const extraArgs = (process.env.E2E_ELECTRON_ARGS ?? '').split(' ').filter(Boolean);
const OUT = process.env.E2E_OUT ?? 'test-results';
const tmp = mkdtempSync(path.join(os.tmpdir(), 'a3-packaged-'));
const userData = path.join(tmp, 'profile');
const autosaveDir = path.join(userData, 'autosave');
const env = { ...process.env, A3_USER_DATA: userData, A3_AUTOSAVE_INTERVAL_MS: '1000', A3_HEARTBEAT_STALE_MS: '4000' };
delete env.VITE_DEV_SERVER_URL;

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

async function launch() {
  const app = await electron.launch({ executablePath: exe, args: extraArgs, env, timeout: 60000 });
  const win = await app.firstWindow();
  win.setDefaultTimeout(10000);
  const errors = [];
  win.on('pageerror', (e) => errors.push(String(e)));
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await win.waitForSelector('[data-testid=page-sheet]');
  await win.waitForFunction(() => {
    const c = document.querySelector('[data-testid=canvas]')?.getBoundingClientRect();
    const p = document.querySelector('[data-testid=page-sheet]')?.getBoundingClientRect();
    return !!c && !!p && c.width > 200 && p.width > 200; // laid out and fitted (slow CI machines)
  }, undefined, { timeout: 30000 });
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.__savePath });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__openPath] });
    dialog.showMessageBoxSync = () => 0;
  });
  const setPaths = (p) => app.evaluate((_e, v) => Object.assign(globalThis, v), p);
  return { app, win, errors, setPaths };
}

/** After a forced kill, wait until every process of the app is gone (Windows keeps helper
 *  processes alive for a few seconds; relaunching earlier hits the single-instance lock). */
async function waitForAllProcessesToExit() {
  if (process.platform !== 'win32') return sleep(2500);
  const image = path.basename(exe).toLowerCase();
  for (let i = 0; i < 60; i++) {
    // CSV output: the table format truncates long image names.
    const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' }).toLowerCase();
    if (!out.includes(`"${image}"`)) return;
    await sleep(500);
  }
  console.log('  note: app processes still running after 30 s');
}

/** Simulate a crash: kill the whole process tree, like Task Manager's "End task". */
async function crash(app) {
  const pid = app.process().pid;
  if (process.platform === 'win32') execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
  else app.process().kill('SIGKILL');
  await waitForAllProcessesToExit();
  await sleep(5000); // longer than the 4 s heartbeat staleness used in this test
}

/** Launch, retrying once if the new process closes immediately. */
const mainLog = () => {
  const f = path.join(userData, 'logs', 'main.log');
  return existsSync(f) ? readFileSync(f, 'utf8') : '(no main.log)';
};

async function relaunch() {
  try {
    return await launch();
  } catch (e) {
    console.log(`  note: relaunch failed (${String(e).split('\n')[0]})`);
    console.log('  ---- app log (main.log) ----\n' + mainLog().split('\n').slice(-25).map((l) => '    ' + l).join('\n'));
    console.log('  ---- profile folder ----\n    ' + readdirSync(userData).join(', '));
    await waitForAllProcessesToExit();
    await sleep(2000);
    try {
      return await launch();
    } catch (e2) {
      console.log('  note: second attempt failed too; diagnostic retry with the single-instance lock disabled');
      env.A3_ALLOW_MULTIPLE = '1';
      const r = await launch();
      check('DIAGNOSTIC: relaunch works without the single-instance lock (lock is the cause)', false, 'see log above');
      return r;
    }
  }
}

const listAutosaves = () => (existsSync(autosaveDir) ? readdirSync(autosaveDir).filter((f) => f.endsWith('.json')) : []);
let current = null;

try {
  console.log(`\nPackaged app: ${exe}\n`);
  // ------------------------------------------------------------------ first run
  current = await launch();
  let { app, win, errors, setPaths } = current;
  const url = win.url();
  check('runs from the packaged files (file://, not a dev server)', url.startsWith('file://'), url);
  check('window title', (await win.title()).includes('A3 Precision Drawing Studio'));
  check('production CSP is active', await win.evaluate(() => !!document.querySelector('meta[http-equiv=Content-Security-Policy]')));
  const version = await app.evaluate(({ app: a }) => a.getVersion());
  check('reports its version', /^\d+\.\d+\.\d+/.test(version), version);

  await win.click('[data-testid=tab-draw]');
  await win.click('[data-testid=tool-line]');
  for (const [id, v] of Object.entries({ 'new-x': 50, 'new-y': 60, 'new-length': 123.45, 'new-angle': 30 })) {
    await win.fill(`[data-testid=${id}]`, String(v));
    await win.press(`[data-testid=${id}]`, 'Enter');
  }
  await win.click('[data-testid=create-shape]');
  check('a line can be drawn by numbers', (await win.locator('[data-testid=shapes] line').count()) === 1);

  // PDF export at true scale
  const pdfPath = path.join(tmp, 'out.pdf');
  await setPaths({ __savePath: pdfPath });
  await win.keyboard.press('Escape');
  await win.click('[data-testid=file-menu-button]');
  await win.click('[data-testid=menu-export-pdf]');
  await sleep(800);
  const pdf = existsSync(pdfPath) ? readFileSync(pdfPath, 'latin1') : '';
  check('PDF export writes a PDF', pdf.startsWith('%PDF-1.7') && pdf.trimEnd().endsWith('%%EOF'));
  check('PDF page is A3 landscape at true size', pdf.includes('/MediaBox [0 0 1190.5512 841.8898]'));

  // Autosave (1 s interval in this test) → separate recovery folder, never the project
  await sleep(3000);
  const autos = listAutosaves();
  check('autosave wrote a recovery copy to the app data folder', autos.length === 1, JSON.stringify(autos));
  check('status bar shows the autosave', /Autosaved/.test((await win.textContent('[data-testid=status-autosave]')) ?? ''));

  // ------------------------------------------------------------------ crash
  await crash(app);
  check('after a crash the recovery copy is still there', listAutosaves().length === 1);

  // ------------------------------------------------------------------ restart → recover
  current = await relaunch();
  ({ app, win, errors, setPaths } = current);
  await win.waitForSelector('[data-testid=dialog-recovery]', { timeout: 15000 });
  check('on restart the app offers to recover the unsaved drawing', true);
  await win.click('[data-testid=dialog-recover]'); // the Recover button
  await sleep(500);
  const st = await win.evaluate(() => {
    const lines = document.querySelectorAll('[data-testid=shapes] line').length;
    return { lines, unsaved: !!document.querySelector('[data-testid=unsaved-indicator]') };
  });
  check('the drawing is recovered', st.lines === 1);
  check('… and marked as unsaved (nothing was written to a project file)', st.unsaved);

  // save → reopen
  const proj = path.join(tmp, 'recovered.a3d');
  await setPaths({ __savePath: proj, __openPath: proj });
  await win.click('[data-testid=file-menu-button]');
  await win.click('[data-testid=menu-save-as]');
  await sleep(800);
  check('Save As writes the project file', existsSync(proj) && JSON.parse(readFileSync(proj, 'utf8')).formatVersion === 4);
  check('after saving, no recovery copy is left', listAutosaves().length === 0, JSON.stringify(listAutosaves()));
  await win.click('[data-testid=file-menu-button]');
  await win.click('[data-testid=menu-new]');
  await win.click('[data-testid=file-menu-button]');
  await win.click('[data-testid=menu-open]');
  await sleep(800);
  check('the saved project reopens', (await win.locator('[data-testid=shapes] line').count()) === 1);
  await win.screenshot({ path: path.join(OUT, `packaged-${process.platform}.png`) }).catch(() => {});
  check('no renderer errors', errors.length === 0, errors.join('\n'));

  await app.close();
  current = null;
  await sleep(500);
  check('a normal quit leaves no recovery copy', listAutosaves().length === 0);
} catch (err) {
  failures++;
  console.log(`  FAIL  script error: ${err && err.stack ? err.stack.split('\n').slice(0, 8).join(' | ') : err}`);
} finally {
  if (current) await current.app.close().catch(() => {});
  try {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  } catch (e) {
    console.log(`  note: could not remove ${tmp}: ${e.message}`);
  }
}
console.log(`\nPackaged smoke result: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
