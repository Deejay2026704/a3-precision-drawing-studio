// Milestone 4 end-to-end test (development build): PDF export from the UI, autosave
// toggle, crash recovery choices (recover / keep for later / discard / damaged backup),
// the save-over-original guard after recovery, and opening a .a3d passed by the OS.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { buildElectron } from '../scripts/electron-build.mjs';

const require = createRequire(import.meta.url);
// Must be REMOVED, not blanked: on Windows Electron treats an empty ELECTRON_RUN_AS_NODE as set.
delete process.env.ELECTRON_RUN_AS_NODE;
const { _electron: electron } = require('playwright');
const electronBinary = require('electron');
const OUT = process.env.E2E_OUT ?? 'test-results';
mkdirSync(OUT, { recursive: true });
const extraArgs = (process.env.E2E_ELECTRON_ARGS ?? '').split(' ').filter(Boolean);
const tmp = mkdtempSync(path.join(os.tmpdir(), 'a3-m4-'));
const userData = path.join(tmp, 'profile');
const autosaveDir = path.join(userData, 'autosave');

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
const autosaves = () => (existsSync(autosaveDir) ? readdirSync(autosaveDir).filter((f) => f.endsWith('.json')) : []);

await buildElectron({ dev: true });
const server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];

async function launch(fileArg) {
  const app = await electron.launch({
    executablePath: electronBinary,
    args: ['.', ...extraArgs, ...(fileArg ? [fileArg] : [])],
    env: { ...process.env, VITE_DEV_SERVER_URL: url, A3_USER_DATA: userData, A3_AUTOSAVE_INTERVAL_MS: '1000', A3_HEARTBEAT_STALE_MS: '4000' },
  });
  const win = await app.firstWindow();
  win.setDefaultTimeout(8000);
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
  return { app, win, errors, setPaths: (p) => app.evaluate((_e, v) => Object.assign(globalThis, v), p) };
}
const st = (win) => win.evaluate(() => window.__a3State());
async function drawLine(win, x, len) {
  await win.keyboard.press('Escape');
  await win.click('[data-testid=tab-draw]');
  await win.click('[data-testid=tool-line]');
  for (const [id, v] of Object.entries({ 'new-x': x, 'new-y': 40, 'new-length': len, 'new-angle': 0 })) {
    await win.fill(`[data-testid=${id}]`, String(v));
    await win.press(`[data-testid=${id}]`, 'Enter');
  }
  await win.click('[data-testid=create-shape]');
  await win.keyboard.press('Escape');
}
const menu = async (win, id) => {
  await win.click('[data-testid=file-menu-button]');
  await win.click(`[data-testid=${id}]`);
};

let cur = null;
try {
  // ---------------------------------------------------------------- PDF export
  console.log('\nA. PDF export');
  cur = await launch();
  let { app, win, errors, setPaths } = cur;
  await drawLine(win, 20, 100);
  await win.click('[data-testid=layer-new]');
  await drawLine(win, 20, 250); // on the new layer
  const s0 = await st(win);
  await win.click(`[data-testid=layer-visible-${s0.activeLayerId}]`); // hide it
  const pdfPath = path.join(tmp, 'drawing.pdf');
  await setPaths({ __savePath: pdfPath });
  await win.keyboard.press('Control+p');
  await sleep(700);
  check('Ctrl+P exports a PDF', existsSync(pdfPath));
  const pdf = readFileSync(pdfPath, 'latin1');
  check('… one A3 landscape page at true size', pdf.includes('/MediaBox [0 0 1190.5512 841.8898]'));
  check('… the 100 mm line is exactly 283.4646 pt long', pdf.includes('56.6929 113.3858 m 340.1575 113.3858 l S'));
  check('… the hidden layer’s 250 mm line is not exported', !pdf.includes(`${(270 * 72 / 25.4).toFixed(4)} 113.3858 l`));
  check('status message explains printing at 100 %', /true scale/.test((await win.textContent('[data-testid=status-message]')) ?? ''));
  await win.click('[data-testid=layer-row-layer-0]'); // draw on the visible Default layer from here on
  let poppler = true;
  try {
    execFileSync('pdfinfo', ['-v'], { stdio: 'ignore' });
  } catch {
    poppler = false;
  }
  if (poppler) {
    const info = execFileSync('pdfinfo', [pdfPath], { encoding: 'utf8' });
    check('an independent PDF reader (poppler) reads it as A3', /Page size:\s+1190\.55 x 841\.89 pts \(A3\)/.test(info), info);
  }

  // ---------------------------------------------------------------- autosave toggle
  console.log('\nB. Autosave');
  await sleep(2500);
  check('autosave writes a recovery copy while there are unsaved changes', autosaves().length === 1);
  check('… outside the project (in the app data folder)', !existsSync(path.join(tmp, 'drawing.a3d')));
  await menu(win, 'menu-autosave');
  check('turning autosave off removes the recovery copy', autosaves().length === 0 && /off/.test((await win.textContent('[data-testid=status-autosave]')) ?? ''));
  await menu(win, 'menu-autosave');
  check('the status bar no longer shows a stale autosave time', (await win.textContent('[data-testid=status-autosave]')) === 'Autosave on');
  await drawLine(win, 30, 10);
  await sleep(2500);
  check('turning it on again resumes autosaving', autosaves().length === 1);
  const proj = path.join(tmp, 'drawing.a3d');
  await setPaths({ __savePath: proj });
  await menu(win, 'menu-save-as');
  await sleep(600);
  check('saving removes the recovery copy', autosaves().length === 0);
  await drawLine(win, 40, 20);
  await sleep(2500);
  check('a new change after saving is autosaved again', autosaves().length === 1);
  check('no renderer errors (first session)', errors.length === 0, errors.join('\n'));

  // ---------------------------------------------------------------- crash → keep for later
  console.log('\nC. Crash recovery');
  const projBytes = readFileSync(proj, 'utf8');
  app.process().kill('SIGKILL');
  await sleep(5000); // past the 4 s heartbeat staleness
  cur = await launch();
  ({ app, win, errors, setPaths } = cur);
  await win.waitForSelector('[data-testid=dialog-recovery]');
  const detail = (await win.textContent('[data-testid=dialog-detail]')) ?? '';
  check('recovery dialog names the original file and what it contains', detail.includes('drawing.a3d') && /objects/.test(detail));
  await win.click('[data-testid=dialog-later]');
  check('"Keep for later" leaves the backup and opens an empty drawing', autosaves().length === 1 && (await st(win)).doc.shapes.length === 0);
  await app.close();
  cur = null;

  // ---------------------------------------------------------------- discard (with confirmation)
  cur = await launch();
  ({ app, win, errors, setPaths } = cur);
  await win.waitForSelector('[data-testid=dialog-recovery]');
  await win.click('[data-testid=dialog-discard]');
  await win.waitForSelector('[data-testid=dialog-recovery-confirm]');
  check('"Discard backup" asks for confirmation', true);
  await win.click('[data-testid=dialog-cancel]');
  check('… cancelling keeps the backup', autosaves().length === 1);
  await app.close();
  cur = null;

  // ---------------------------------------------------------------- recover → save guard
  cur = await launch();
  ({ app, win, errors, setPaths } = cur);
  await win.waitForSelector('[data-testid=dialog-recovery]');
  await win.click('[data-testid=dialog-recover]');
  await sleep(400);
  let s = await st(win);
  check('Recover restores the unsaved work (4 lines)', s.doc.shapes.length === 4, String(s.doc.shapes.length));
  check('… marked unsaved and linked to the original file', (await win.isVisible('[data-testid=unsaved-indicator]')) && s.filePath === proj && s.recovered === true);
  check('the original project file was not touched by recovery', readFileSync(proj, 'utf8') === projBytes);
  check('the old backup was handed over to this session (exactly one copy)', autosaves().length === 1);
  await win.keyboard.press('Control+s');
  await win.waitForSelector('[data-testid=dialog-save-recovered]');
  check('saving a recovered drawing asks before writing over the original', true);
  await win.click('[data-testid=dialog-cancel]');
  check('… Cancel leaves the original byte-for-byte unchanged', readFileSync(proj, 'utf8') === projBytes);
  await win.keyboard.press('Control+s');
  await win.click('[data-testid=dialog-overwrite]');
  await sleep(600);
  check('"Save over original" writes the recovered drawing', JSON.parse(readFileSync(proj, 'utf8')).shapes.length === 4);
  check('… and the drawing is now saved with no backup left', !(await win.isVisible('[data-testid=unsaved-indicator]')) && autosaves().length === 0);
  check('no renderer errors (recovery session)', errors.length === 0, errors.join('\n'));
  await app.close();
  cur = null;

  // ---------------------------------------------------------------- damaged backup
  mkdirSync(autosaveDir, { recursive: true });
  writeFileSync(path.join(autosaveDir, 'session-999999-1.json'), '{"format":"a3-precision-drawing-autosave","version":1,');
  cur = await launch();
  ({ app, win } = cur);
  await win.waitForSelector('[data-testid=dialog-recovery-damaged]');
  check('a damaged backup is reported, not silently deleted', autosaves().includes('session-999999-1.json'));
  await win.click('[data-testid=dialog-delete]');
  check('… and can be deleted on request', !autosaves().includes('session-999999-1.json'));
  await app.close();
  cur = null;

  // ---------------------------------------------------------------- file association
  console.log('\nD. Opening a project passed by the OS (file association)');
  const old = path.join(tmp, 'from-explorer.a3d');
  copyFileSync('tests/fixtures/milestone1-v1.a3d', old);
  cur = await launch(old);
  ({ app, win } = cur);
  await win.waitForSelector('[data-testid=dialog-warnings]');
  await win.click('[data-testid=dialog-ok]');
  s = await st(win);
  check('a .a3d passed on the command line opens at start-up', s.fileName === 'from-explorer.a3d' && s.doc.shapes.length === 4);
  await app.close();
  cur = null;
  check('after all sessions end normally, no recovery copies remain', autosaves().length === 0, JSON.stringify(autosaves()));
} catch (err) {
  failures++;
  console.log(`  FAIL  script error: ${err && err.stack ? err.stack.split('\n').slice(0, 10).join(' | ') : err}`);
} finally {
  if (cur) await cur.app.close().catch(() => {});
  await server.close();
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`\nM4 E2E result: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
