// Checks a PORTABLE copy of the app (portable-mode.txt next to the program):
//   node tests-e2e/portable-check.mjs "<folder>/A3 Precision Drawing Studio.exe"
// All app data must go to <folder>/data (not the user profile); updates are notify-only.
import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
delete process.env.ELECTRON_RUN_AS_NODE;
const { _electron: electron } = require('playwright');
const exe = process.argv[2];
const dir = path.dirname(exe ?? '');
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
if (!exe || !existsSync(exe)) {
  console.error(`Usage: node tests-e2e/portable-check.mjs <app executable>  (not found: ${exe})`);
  process.exit(2);
}
const env = { ...process.env, A3_AUTOSAVE_INTERVAL_MS: '1000', A3_DISABLE_UPDATE_CHECK: '1' };
delete env.A3_USER_DATA; // portable mode must decide by itself
delete env.VITE_DEV_SERVER_URL;
const extraArgs = (process.env.E2E_ELECTRON_ARGS ?? '').split(' ').filter(Boolean);

console.log('\nPortable copy');
check('the portable marker file is next to the program', existsSync(path.join(dir, 'portable-mode.txt')));
const app = await electron.launch({ executablePath: exe, args: extraArgs, env, timeout: 60000 });
try {
  const win = await app.firstWindow();
  win.setDefaultTimeout(15000);
  await win.waitForSelector('[data-testid=page-sheet]', { timeout: 30000 });
  const userData = await app.evaluate(({ app }) => app.getPath('userData'));
  check('app data goes to the "data" folder beside the program', path.resolve(userData) === path.resolve(dir, 'data'), userData);
  // draw something so an autosave copy is written
  await win.click('[data-testid=tab-draw]');
  await win.click('[data-testid=tool-line]');
  for (const [id, v] of Object.entries({ 'new-x': 10, 'new-y': 10, 'new-length': 50, 'new-angle': 0 })) {
    await win.fill(`[data-testid=${id}]`, String(v));
    await win.press(`[data-testid=${id}]`, 'Enter');
  }
  await win.click('[data-testid=create-shape]');
  await win.waitForTimeout(2500);
  const auto = path.join(dir, 'data', 'autosave');
  check('autosave/recovery copies are written beside the program', existsSync(auto) && readdirSync(auto).some((f) => f.endsWith('.json')));
  check('logs are written beside the program', existsSync(path.join(dir, 'data', 'logs', 'main.log')));
  const st = await win.evaluate(() => window.a3Studio.updates.status());
  check('updates: notify only (a portable copy cannot install them)', st.mode === 'notify', JSON.stringify(st));
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBoxSync = () => 0; // "Close without saving"
  });
} catch (e) {
  failures++;
  console.log(`  FAIL  script error: ${String(e?.message ?? e).split('\n').join(' | ')}`);
} finally {
  await app.close().catch(() => {});
}
console.log(`\nPortable check result: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
