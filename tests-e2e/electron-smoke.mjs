// End-to-end smoke test: launches the REAL Electron app (dev server + main process)
// and drives it with Playwright to verify the milestone-1 core functions.
//
// Usage:  npm run e2e                (Windows / desktop)
//         xvfb-run -a npm run e2e    (headless Linux; add E2E_ELECTRON_ARGS=--no-sandbox when root)
// Requires the `playwright` package to be resolvable (not a project dependency).
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'vite';
import { buildElectron } from '../scripts/electron-build.mjs';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const electronBinary = require('electron');

const OUT = process.env.E2E_OUT ?? 'test-results';
mkdirSync(OUT, { recursive: true });
const extraArgs = (process.env.E2E_ELECTRON_ARGS ?? '').split(' ').filter(Boolean);

let failures = 0;
let passes = 0;
function check(name, cond, detail = '') {
  if (cond) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

await buildElectron({ dev: true });
const server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];

const app = await electron.launch({
  executablePath: electronBinary,
  args: ['.', ...extraArgs],
  env: { ...process.env, VITE_DEV_SERVER_URL: url, ELECTRON_RUN_AS_NODE: '' },
});

try {
  const win = await app.firstWindow();
  win.setDefaultTimeout(5000);
  const consoleErrors = [];
  win.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  win.on('pageerror', (e) => consoleErrors.push(String(e)));
  await win.waitForSelector('[data-testid=page-sheet]');
  await win.waitForTimeout(500);

  console.log('\n1. Application shell');
  const title = await win.title();
  check('window title contains application name', title.includes('A3 Precision Drawing Studio'), title);
  for (const id of ['app-title', 'file-menu-button', 'tab-home', 'tab-draw', 'tab-view', 'canvas', 'properties-panel', 'status-bar', 'ruler-horizontal', 'ruler-vertical']) {
    check(`element ${id} visible`, await win.isVisible(`[data-testid=${id}]`));
  }
  await win.screenshot({ path: path.join(OUT, '01-startup.png') });

  console.log('\n2. A3 page');
  const sheetBox = async () => win.locator('[data-testid=page-sheet]').boundingBox();
  let sheet = await sheetBox();
  check('sheet aspect ratio = 420:297', near(sheet.width / sheet.height, 420 / 297, 0.002), `${sheet.width}x${sheet.height}`);
  check('sheet declares 420 × 297 mm', (await win.getAttribute('[data-testid=page-sheet]', 'data-width-mm')) === '420' && (await win.getAttribute('[data-testid=page-sheet]', 'data-height-mm')) === '297');
  const docSheet = await win.textContent('[data-testid=doc-sheet]');
  check('properties panel shows A3 landscape 420 × 297 mm', docSheet.includes('420 × 297'), docSheet);

  // Map page millimetres (origin bottom-left, Y up) to window pixels using the rendered sheet.
  let k = sheet.width / 420;
  const P = (x, y) => ({ x: sheet.x + x * k, y: sheet.y + sheet.height - y * k });
  const drag = async (a, b, steps = 8) => {
    await win.mouse.move(a.x, a.y);
    await win.mouse.down();
    await win.mouse.move(b.x, b.y, { steps });
    await win.mouse.up();
  };
  const val = (id) => win.inputValue(`[data-testid=${id}]`);
  const setVal = async (id, v) => {
    await win.fill(`[data-testid=${id}]`, String(v));
    await win.press(`[data-testid=${id}]`, 'Enter');
  };
  const shapeCount = () => win.locator('[data-testid=shapes] [data-shape-id]').count();

  console.log('\n3. Drawing objects');
  await win.keyboard.press('l');
  await drag(P(50, 50), P(150, 50));
  check('line drawn', (await win.locator('[data-testid=shapes] line').count()) === 1);
  check('line length = 100 mm (snap 1 mm)', (await val('prop-length')) === '100', await val('prop-length'));
  check('line start = (50, 50) – Y measured upwards from bottom-left', (await val('prop-x1')) === '50' && (await val('prop-y1')) === '50');

  await win.keyboard.press('r');
  await drag(P(200, 100), P(300, 160));
  check('rectangle drawn', (await win.locator('[data-testid=shapes] polygon').count()) === 1);
  check('rectangle 100 × 60 at (200, 100)', (await val('prop-width')) === '100' && (await val('prop-height')) === '60' && (await val('prop-x')) === '200' && (await val('prop-y')) === '100');

  await win.keyboard.press('c');
  await drag(P(100, 200), P(130, 200));
  check('circle drawn with radius 30', (await val('prop-radius')) === '30' && (await val('prop-cx')) === '100' && (await val('prop-cy')) === '200');

  await win.keyboard.press('f');
  await win.mouse.move(...Object.values(P(300, 220)));
  await win.mouse.down();
  for (let i = 1; i <= 20; i++) await win.mouse.move(P(300 + i * 4, 220 + 15 * Math.sin(i / 3)).x, P(300 + i * 4, 220 + 15 * Math.sin(i / 3)).y);
  await win.mouse.up();
  const polyPoints = (await win.getAttribute('[data-testid=shapes] polyline', 'points')) ?? '';
  check('freehand polyline drawn with many vertices', polyPoints.split(' ').length > 10, `${polyPoints.split(' ').length} points`);
  check('4 objects exist as SVG vector elements', (await shapeCount()) === 4);
  await win.screenshot({ path: path.join(OUT, '02-drawn.png') });

  console.log('\n4/5. Precision input');
  await win.keyboard.press('Escape'); // back to select tool
  await win.mouse.click(P(100, 50).x, P(100, 50).y); // click on the line
  check('clicking the line selects it', await win.isVisible('[data-testid=props-line]'));
  await setVal('prop-length', 120);
  const lineEl = win.locator('[data-testid=shapes] line');
  const lx = async () => (Number(await lineEl.getAttribute('x2')) - Number(await lineEl.getAttribute('x1'))) / k;
  check('typed length 120 mm → rendered line is 120 page-mm long', near(await lx(), 120, 0.01), String(await lx()));
  await setVal('prop-angle', 90);
  check('typed angle 90° → end point straight above start', (await val('prop-x2')) === '50' && (await val('prop-y2')) === '170', `${await val('prop-x2')},${await val('prop-y2')}`);
  await setVal('prop-angle', 0);
  await setVal('prop-x1', 40);
  check('typed start X moves start point only', (await val('prop-x1')) === '40' && (await val('prop-x2')) === '170' && (await val('prop-length')) === '130');
  await setVal('prop-x1', 50);

  await win.mouse.click(P(250, 100).x, P(250, 100).y); // bottom edge of rectangle
  check('clicking rectangle edge selects it', await win.isVisible('[data-testid=props-rect]'));
  await setVal('prop-width', 80.5);
  await setVal('prop-height', 40.25);
  await setVal('prop-x', 210);
  await setVal('prop-y', 110);
  check('typed rectangle X/Y/width/height applied', (await val('prop-width')) === '80.5' && (await val('prop-height')) === '40.25' && (await val('prop-x')) === '210' && (await val('prop-y')) === '110');
  await setVal('prop-rotation', 30);
  check('typed rectangle rotation 30°', (await val('prop-rotation')) === '30');
  const poly = await win.getAttribute('[data-testid=shapes] polygon', 'points');
  const [p0, p1] = poly.split(' ').map((s) => s.split(',').map(Number));
  const renderedAngle = (Math.atan2(-(p1[1] - p0[1]), p1[0] - p0[0]) * 180) / Math.PI;
  const renderedWidth = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / k;
  check('rendered rectangle edge is at 30° CCW and 80.5 mm long', near(renderedAngle, 30, 0.01) && near(renderedWidth, 80.5, 0.01), `${renderedAngle} ${renderedWidth}`);
  await setVal('prop-rotation', 0);
  const badBefore = await val('prop-width');
  await setVal('prop-width', 'abc');
  check('invalid numeric input is rejected', (await val('prop-width')) === badBefore);

  console.log('\n4. Object editing');
  // Move the rectangle by dragging its edge 10 mm right and 5 mm up
  // (grab away from the edge midpoint, where the S resize handle sits).
  await drag(P(230, 110), P(240, 115));
  check('drag moves rectangle by (10, 5) mm', (await val('prop-x')) === '220' && (await val('prop-y')) === '115', `${await val('prop-x')},${await val('prop-y')}`);

  // Resize by dragging the NE handle.
  const neHandle = await win.locator('[data-handle=ne]').boundingBox();
  const ne = { x: neHandle.x + neHandle.width / 2, y: neHandle.y + neHandle.height / 2 };
  await drag(ne, { x: ne.x + 19.5 * k, y: ne.y - 9.75 * k });
  check('NE handle resize → 100 × 50 mm, base corner fixed', (await val('prop-width')) === '100' && (await val('prop-height')) === '50' && (await val('prop-x')) === '220', `${await val('prop-width')}x${await val('prop-height')}`);

  // Rotate via the rotate handle with Shift (15° steps).
  const rot = await win.locator('[data-handle=rotate]').boundingBox();
  const centre = P(270, 140);
  const rc = { x: rot.x + rot.width / 2, y: rot.y + rot.height / 2 };
  const r = Math.hypot(rc.x - centre.x, rc.y - centre.y);
  const a = (Math.PI / 2) + (45 * Math.PI) / 180; // target 45° CCW from the handle position
  await win.mouse.move(rc.x, rc.y);
  await win.mouse.down();
  await win.keyboard.down('Shift');
  await win.mouse.move(centre.x + r * Math.cos(a), centre.y - r * Math.sin(a), { steps: 10 });
  await win.mouse.up();
  await win.keyboard.up('Shift');
  check('rotate handle (Shift) rotates rectangle 45°', (await val('prop-rotation')) === '45', await val('prop-rotation'));
  check('rotation keeps size', (await val('prop-width')) === '100' && (await val('prop-height')) === '50');
  await win.screenshot({ path: path.join(OUT, '03-edited.png') });

  // Undo the rotation.
  await win.keyboard.press('Control+z');
  check('Ctrl+Z undoes rotation', (await val('prop-rotation')) === '0');

  // Multi-select: Ctrl+A, duplicate, delete.
  await win.mouse.click(P(400, 20).x, P(400, 20).y); // empty area clears selection
  check('clicking empty space clears selection', (await win.textContent('[data-testid=status-selection]')).includes('No selection'));
  await win.keyboard.press('Control+a');
  check('Ctrl+A selects all 4 objects', (await win.textContent('[data-testid=status-selection]')).includes('4 selected'));
  check('multi-selection properties shown', await win.isVisible('[data-testid=props-multi]'));
  await win.keyboard.press('Control+d');
  check('Ctrl+D duplicates selection (8 objects)', (await shapeCount()) === 8);
  await win.keyboard.press('Delete');
  check('Delete removes the duplicated objects (4 objects)', (await shapeCount()) === 4);

  // Shift+click to build a multi-selection, then marquee selection.
  await win.mouse.click(P(100, 50).x, P(100, 50).y);
  await win.keyboard.down('Shift');
  await win.mouse.click(P(130, 200).x, P(130, 200).y);
  await win.keyboard.up('Shift');
  check('Shift+click adds to selection (2 selected)', (await win.textContent('[data-testid=status-selection]')).includes('2 selected'));
  await win.mouse.click(P(400, 20).x, P(400, 20).y);
  await drag(P(20, 30), P(190, 280));
  check('selection window selects enclosed line + circle', (await win.textContent('[data-testid=status-selection]')).includes('2 selected'));
  const hist = () => win.evaluate(() => window.__a3State().past.length);
  const h0 = await hist();
  await setVal('prop-x', 0);
  check('typed X moves the whole multi-selection', (await val('prop-x')) === '0');
  await win.press('[data-testid=prop-x]', 'Escape'); // leave the field so shortcuts go to the drawing
  check('one numeric entry (Enter, then leave field) = exactly one undo step', (await hist()) === h0 + 1, `${h0} -> ${await hist()}`);
  await win.keyboard.press('Control+z');
  check('Ctrl+Z restores the multi-selection position', (await val('prop-x')) === '50', await val('prop-x'));
  await win.fill('[data-testid=prop-x]', '999');
  await win.press('[data-testid=prop-x]', 'Escape');
  check('Escape discards typed value without committing', (await val('prop-x')) === '50' && (await hist()) === h0, `${await val('prop-x')} hist=${await hist()}`);
  console.log('\n6. Drawing scale');
  await win.mouse.click(P(400, 20).x, P(400, 20).y); // clear the multi-selection first
  await win.mouse.click(P(100, 50).x, P(100, 50).y);
  const lenBefore = await lx();
  await win.click('[data-testid=tab-home]');
  await win.selectOption('[data-testid=scale-select]', '1:50');
  check('scale shown as 1:50', (await win.textContent('[data-testid=status-scale]')).includes('1:50'));
  check('actual line length unchanged after scale change (120 mm)', (await val('prop-length')) === '120', await val('prop-length'));
  check('on-paper length shown as 2.4 mm', (await win.textContent('[data-testid=on-paper]')).includes('2.4 mm'));
  check('rendered line is 1/50 of its 1:1 length', near((await lx()) * 50, lenBefore, 0.05), `${await lx()}`);
  await win.selectOption('[data-testid=scale-select]', 'custom');
  await win.fill('[data-testid=scale-custom-input]', '1:25');
  await win.click('[data-testid=scale-custom-apply]');
  check('custom scale 1:25 applied', (await win.textContent('[data-testid=status-scale]')).includes('1:25'));
  check('geometry still 120 mm at 1:25', (await val('prop-length')) === '120');
  await win.selectOption('[data-testid=scale-select]', '1:1');

  console.log('\n2. Zoom');
  await win.click('[data-testid=tab-view]');
  const before = await sheetBox();
  await win.click('[data-testid=cmd-zoom-in]');
  await win.click('[data-testid=cmd-zoom-in]');
  const zin = await sheetBox();
  check('zoom in enlarges the sheet', zin.width > before.width * 1.5);
  check('proportions preserved when zoomed in', near(zin.width / zin.height, 420 / 297, 0.002));
  await win.click('[data-testid=cmd-zoom-100]');
  const z100 = await sheetBox();
  check('100 % zoom = true size at 96 dpi (420 mm = 1587.4 px)', near(z100.width, (420 * 96) / 25.4, 1), String(z100.width));
  await win.screenshot({ path: path.join(OUT, '04-zoom-100.png') });
  await win.click('[data-testid=cmd-fit-page]');
  const fitBox = await sheetBox();
  check('fit page restores whole-sheet view', near(fitBox.width, before.width, 1));
  // Wheel zoom about cursor
  await win.mouse.move(P(210, 150).x, P(210, 150).y);
  await win.mouse.wheel(0, -300);
  await win.waitForTimeout(100);
  const wz = await sheetBox();
  check('mouse wheel zooms with proportions preserved', wz.width > fitBox.width && near(wz.width / wz.height, 420 / 297, 0.002));
  await win.click('[data-testid=cmd-fit-page]');
  sheet = await sheetBox();
  k = sheet.width / 420;

  console.log('\nFile save / open (native dialogs stubbed in the main process)');
  const tmp = path.join(os.tmpdir(), `a3-e2e-${process.pid}.a3d`);
  if (existsSync(tmp)) rmSync(tmp);
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, tmp);
  await win.click('[data-testid=file-menu-button]');
  await win.click('[data-testid=menu-save-as]');
  await win.waitForTimeout(300);
  const saved = existsSync(tmp) ? JSON.parse(readFileSync(tmp, 'utf8')) : null;
  check('Save As writes an .a3d file with 4 shapes in mm', saved && saved.shapes.length === 4 && saved.units === 'mm');
  check('saved line geometry is exact (length 120 mm)', saved && near(Math.hypot(saved.shapes[0].end.x - saved.shapes[0].start.x, saved.shapes[0].end.y - saved.shapes[0].start.y), 120, 1e-9));
  check('title shows saved file name', (await win.textContent('[data-testid=doc-title]')).includes(path.basename(tmp)));
  await win.click('[data-testid=file-menu-button]');
  await win.click('[data-testid=menu-new]');
  check('File ▸ New clears the drawing', (await shapeCount()) === 0);
  await win.click('[data-testid=file-menu-button]');
  await win.click('[data-testid=menu-open]');
  await win.waitForTimeout(300);
  check('File ▸ Open restores the 4 objects', (await shapeCount()) === 4);
  rmSync(tmp, { force: true });
  await win.screenshot({ path: path.join(OUT, '05-reopened.png') });

  check('no renderer console errors', consoleErrors.length === 0, consoleErrors.join('\n'));
} finally {
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 0; }).catch(() => {});
  await app.close();
  await server.close();
}

console.log(`\nE2E result: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
