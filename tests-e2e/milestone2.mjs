// Milestone 2 end-to-end test: drives the REAL Electron app to verify snapping,
// dimensions, trim/extend/offset/mirror, grips, numeric creation, undo/redo,
// keyboard safety in text fields, tooltips and file round-trip.
//
// Usage: npm run e2e   (headless Linux: E2E_ELECTRON_ARGS="--no-sandbox --disable-gpu" xvfb-run -a npm run e2e)
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
const app = await electron.launch({ executablePath: electronBinary, args: ['.', ...extraArgs], env: { ...process.env, VITE_DEV_SERVER_URL: url, ELECTRON_RUN_AS_NODE: '' } });

try {
  const win = await app.firstWindow();
  win.setDefaultTimeout(5000);
  const consoleErrors = [];
  win.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  win.on('pageerror', (e) => consoleErrors.push(String(e)));
  await win.waitForSelector('[data-testid=page-sheet]');
  await win.waitForTimeout(400);

  // ---------- helpers ----------
  let sheet, k;
  const measure = async () => {
    sheet = await win.locator('[data-testid=page-sheet]').boundingBox();
    k = sheet.width / 420;
  };
  await measure();
  const P = (x, y) => ({ x: sheet.x + x * k, y: sheet.y + sheet.height - y * k });
  const click = async (p, opts) => win.mouse.click(p.x, p.y, opts);
  const val = (id) => win.inputValue(`[data-testid=${id}]`);
  const setVal = async (id, v) => {
    await win.fill(`[data-testid=${id}]`, String(v));
    await win.press(`[data-testid=${id}]`, 'Enter');
  };
  const state = () => win.evaluate(() => window.__a3State());
  const counts = async () => {
    const s = await state();
    return { shapes: s.doc.shapes.length, dims: s.doc.dimensions.length, past: s.past.length };
  };
  const tool = async (id) => {
    await win.keyboard.press('Escape');
    await win.keyboard.press('Escape');
    const tab = id.startsWith('dim-') ? 'annotate' : ['trim', 'extend', 'offset', 'mirror', 'line', 'rect', 'circle'].includes(id) ? 'draw' : 'home';
    await win.click(`[data-testid=tab-${tab}]`);
    await win.click(`[data-testid=tool-${id}]`);
  };
  const createByNumbers = async (kind, values) => {
    await tool(kind);
    for (const [id, v] of Object.entries(values)) await setVal(id, v);
    await win.click('[data-testid=create-shape]');
    const s = await state();
    return s.doc.shapes[s.doc.shapes.length - 1];
  };
  const lastShape = async () => {
    const s = await state();
    return s.doc.shapes[s.doc.shapes.length - 1];
  };
  const shapeById = async (id) => (await state()).doc.shapes.find((s) => s.id === id);

  console.log('\nA. Exact numeric creation');
  const H = await createByNumbers('line', { 'new-x': 40, 'new-y': 60, 'new-length': 120, 'new-angle': 0 });
  check('line by numbers: start (40,60), length 120, angle 0', H.kind === 'line' && H.start.x === 40 && H.start.y === 60 && near(H.end.x, 160) && near(H.end.y, 60));
  const A30 = await createByNumbers('line', { 'new-x': 40, 'new-y': 60, 'new-length': 80, 'new-angle': 30 });
  check('line by numbers at 30°: end = (40+80cos30, 60+80sin30)', near(A30.end.x, 40 + 80 * Math.cos(Math.PI / 6), 1e-9) && near(A30.end.y, 100, 1e-9));
  const C = await createByNumbers('circle', { 'new-x': 250.25, 'new-y': 120.75, 'new-diameter': 50 });
  check('circle by numbers: centre (250.25,120.75), diameter 50 → radius 25', C.kind === 'circle' && C.center.x === 250.25 && C.center.y === 120.75 && C.radius === 25);
  const R = await createByNumbers('rect', { 'new-x': 300, 'new-y': 180, 'new-width': 60, 'new-height': 30, 'new-rotation': 0 });
  check('rectangle by numbers: 60 × 30 at (300,180)', R.kind === 'rect' && R.width === 60 && R.height === 30 && R.origin.x === 300);
  const bad = await counts();
  await tool('circle');
  await setVal('new-radius', 0);
  await win.click('[data-testid=create-shape]');
  check('invalid numeric creation (radius 0) is refused safely', (await counts()).shapes === bad.shapes);

  console.log('\nB. Snapping (object snaps use exact geometry)');
  // Grid snap off so only object snaps can produce exact non-integer coordinates.
  await win.click('[data-testid=status-gridsnap]');
  await tool('line');
  await win.mouse.move(P(250.25 + 0.9, 120.75 - 0.7).x, P(250.25 + 0.9, 120.75 - 0.7).y);
  await win.waitForTimeout(50);
  check('centre snap marker shown near the circle centre', (await win.getAttribute('[data-testid=snap-marker]', 'data-snap-kind')) === 'center');
  await click(P(250.25 + 0.9, 120.75 - 0.7));
  await win.mouse.move(P(160.7, 60.6).x, P(160.7, 60.6).y, { steps: 4 });
  check('live feedback shows length and angle while drawing', /L [\d.]+ mm\s+∠ [\d.]+°/.test((await win.textContent('[data-testid=cursor-feedback]')) ?? ''), await win.textContent('[data-testid=cursor-feedback]'));
  check('endpoint snap marker at the line end', (await win.getAttribute('[data-testid=snap-marker]', 'data-snap-kind')) === 'endpoint');
  await click(P(160.7, 60.6)); // click-click drawing: second click
  const snapped = await lastShape();
  check('click-click line: start snapped exactly to circle centre (250.25, 120.75)', snapped.start.x === 250.25 && snapped.start.y === 120.75, JSON.stringify(snapped.start));
  check('… and end snapped exactly to the endpoint (160, 60)', near(snapped.end.x, 160, 1e-9) && near(snapped.end.y, 60, 1e-9), JSON.stringify(snapped.end));

  await win.click('[data-testid=status-gridsnap]'); // grid snap back on (exact first points below)
  // Midpoint, perpendicular, tangent
  await tool('line');
  await win.mouse.move(P(100.6, 60.5).x, P(100.6, 60.5).y);
  await win.waitForTimeout(50);
  check('midpoint snap marker', (await win.getAttribute('[data-testid=snap-marker]', 'data-snap-kind')) === 'midpoint');
  await click(P(100.6, 60.5));
  await click(P(100.4, 20));
  const mid = await lastShape();
  check('midpoint snap: start exactly (100, 60)', near(mid.start.x, 100, 1e-9) && near(mid.start.y, 60, 1e-9));
  // perpendicular: from (100,20) base … draw a new line from (60, 20) and snap perpendicular onto H? Use base at (130,20) to H
  await tool('line');
  await click(P(130, 20));
  await win.mouse.move(P(130.6, 60.6).x, P(130.6, 60.6).y);
  await win.waitForTimeout(50);
  const perpKind = await win.getAttribute('[data-testid=snap-marker]', 'data-snap-kind');
  check('perpendicular snap from the first point onto a line', perpKind === 'perpendicular', perpKind);
  await click(P(130.6, 60.6));
  const perp = await lastShape();
  check('perpendicular result is exact (130, 60)', near(perp.end.x, 130, 1e-9) && near(perp.end.y, 60, 1e-9), JSON.stringify(perp.end));
  // tangent from (250.25, 200) to the circle
  await tool('line');
  await click(P(250.25, 200));
  const tx = 250.25 + 25 * Math.cos(Math.asin(25 / (200 - 120.75)));
  const ty = 120.75 + 25 * (25 / (200 - 120.75));
  await win.mouse.move(P(tx + 0.5, ty).x, P(tx + 0.5, ty).y);
  await win.waitForTimeout(50);
  check('tangent snap marker on the circle', (await win.getAttribute('[data-testid=snap-marker]', 'data-snap-kind')) === 'tangent');
  await click(P(tx + 0.5, ty));
  const tan = await lastShape();
  const radial = { x: tan.end.x - 250.25, y: tan.end.y - 120.75 };
  const along = { x: tan.end.x - tan.start.x, y: tan.end.y - tan.start.y };
  check('tangent result is exactly tangent (radius ⟂ line)', near(radial.x * along.x + radial.y * along.y, 0, 1e-6) && near(Math.hypot(radial.x, radial.y), 25, 1e-9));

  // Individual toggles
  await win.click('[data-testid=tab-draw]');
  await win.uncheck('[data-testid=osnap-center]');
  await tool('line');
  await win.mouse.move(P(250.25 + 0.9, 120.75 - 0.7).x, P(250.25 + 0.9, 120.75 - 0.7).y);
  await win.waitForTimeout(50);
  check('disabling the Centre snap stops centre snapping', (await win.locator('[data-testid=snap-marker][data-snap-kind=center]').count()) === 0);
  await win.click('[data-testid=tab-draw]');
  await win.check('[data-testid=osnap-center]');

  console.log('\nC. Snapping at high zoom');
  await win.keyboard.press('Escape');
  await win.click('[data-testid=tab-view]');
  const z0 = P(250.25, 120.75);
  await win.mouse.move(z0.x, z0.y);
  for (let i = 0; i < 5; i++) {
    await win.mouse.wheel(0, -300);
    await win.waitForTimeout(60);
  }
  await measure();
  const zoomPct = (await state()) && Math.round((sheet.width / 420 / (96 / 25.4)) * 100);
  check('zoomed in with the wheel (> 400 %)', zoomPct > 400, `${zoomPct} %`);
  await tool('line');
  await click(P(250.25 + 0.3, 120.75 + 0.2)); // 0.36 mm off = ~8 px at this zoom
  await click(P(250.25 + 15, 120.75 + 0.2));
  const z = await lastShape();
  check('at high zoom the centre snap is still exact', z.start.x === 250.25 && z.start.y === 120.75, JSON.stringify(z.start));
  await win.keyboard.press('Escape');
  await win.click('[data-testid=tab-view]');
  await win.click('[data-testid=cmd-fit-page]');
  await measure();

  console.log('\nD. Dimensions (driven, associative)');
  await win.keyboard.press('Escape');
  await win.keyboard.press('d'); // keyboard shortcut, then click at once (no wait)
  await click(P(380, 270));
  check('a click right after a tool shortcut is handled by the NEW tool', ((await win.textContent('[data-testid=status-message]')) ?? '').startsWith('Dimension: click the second point'), await win.textContent('[data-testid=status-message]'));
  await win.keyboard.press('Escape');
  await tool('dim-aligned');
  await click(P(40.5, 60.4));
  await click(P(159.6, 60.3));
  await click(P(100, 45));
  let s = await state();
  const dimA = s.doc.dimensions[s.doc.dimensions.length - 1];
  check('aligned dimension created, linked to the line endpoints', dimA && dimA.p1.kind === 'shape' && dimA.p1.shapeId === H.id && dimA.p2.key === 'end');
  const dimText = async (id) => win.textContent(`[data-dimension-id="${id}"] text`);
  check('dimension shows 120.00 (2 decimals default)', (await dimText(dimA.id)) === '120.00', await dimText(dimA.id));
  // edit the line length → dimension follows
  await tool('select');
  await click(P(70, 60));
  await setVal('prop-length', 135.5);
  check('after editing the line to 135.5 mm the dimension reads 135.50', (await dimText(dimA.id)) === '135.50', await dimText(dimA.id));
  await win.press('[data-testid=prop-length]', 'Escape');
  // move the line → dimension still correct
  await win.keyboard.press('ArrowUp');
  check('after nudging the line the dimension still reads 135.50', (await dimText(dimA.id)) === '135.50');
  await win.keyboard.press('Control+z');
  // select the dimension via its text
  const tb = await win.locator(`[data-dimension-id="${dimA.id}"] text`).boundingBox();
  await win.keyboard.press('Escape');
  await win.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
  check('clicking the dimension selects it and shows dimension properties', await win.isVisible('[data-testid=props-dim-aligned]'));
  check('dimension is clearly marked as driven', ((await win.textContent('[data-testid=dim-mode]')) ?? '').includes('Driven'));
  check('measured value is read-only', (await win.getAttribute('[data-testid=dim-value]', 'readonly')) !== null);
  await win.selectOption('[data-testid=prop-dim-decimals]', '3');
  check('precision 3 → 135.500', (await dimText(dimA.id)) === '135.500');
  await win.selectOption('[data-testid=prop-dim-text-height]', '5');
  const fontSize = Number(await win.getAttribute(`[data-dimension-id="${dimA.id}"] text`, 'font-size'));
  check('text height 5 mm renders at 5 paper-mm', near(fontSize, 5 * k, 0.05), `${fontSize} vs ${5 * k}`);
  await setVal('dim-offset', -25);
  s = await state();
  check('offset edited numerically', s.doc.dimensions.find((d) => d.id === dimA.id).offset === -25);
  await win.selectOption('[data-testid=prop-dim-arrowhead]', 'tick');
  await win.uncheck('[data-testid=prop-dim-ext]');
  s = await state();
  const st = s.doc.dimensions.find((d) => d.id === dimA.id).style;
  check('arrowhead and extension-line settings stored', st.arrowhead === 'tick' && st.showExtensionLines === false);
  // radius / diameter / angular
  await tool('dim-radius');
  await click(P(250.25 + 25, 120.75 + 0.3));
  s = await state();
  check('radius dimension R25.00', (await dimText(s.doc.dimensions.at(-1).id)) === 'R25.00');
  await tool('dim-diameter');
  await click(P(250.25, 120.75 - 25.3));
  s = await state();
  check('diameter dimension ⌀50.00', (await dimText(s.doc.dimensions.at(-1).id)) === '⌀50.00');
  await tool('dim-angular');
  await click(P(140, 60.2));
  const onA30 = { x: 40 + 60 * Math.cos(Math.PI / 6), y: 60 + 60 * Math.sin(Math.PI / 6) };
  await click(P(onA30.x, onA30.y + 0.2));
  await click(P(100, 70));
  s = await state();
  check('angular dimension 30.00°', (await dimText(s.doc.dimensions.at(-1).id)) === '30.00°', await dimText(s.doc.dimensions.at(-1).id));
  await tool('dim-angular');
  const before = await counts();
  await click(P(140, 60.2));
  await click(P(140, 60.2));
  check('picking the same line twice is refused with a message', (await counts()).dims === before.dims && ((await win.textContent('[data-testid=status-message]')) ?? '').includes('different'));
  await win.screenshot({ path: path.join(OUT, 'm2-01-dimensions.png') });

  console.log('\nE. Trim / extend / offset / mirror');
  const V = await createByNumbers('line', { 'new-x': 80, 'new-y': 230, 'new-length': 50, 'new-angle': 270 }); // vertical x=80, y 230→180
  const T = await createByNumbers('line', { 'new-x': 60, 'new-y': 200, 'new-length': 60, 'new-angle': 0 }); // y=200, x 60→120
  await tool('trim');
  await win.mouse.move(P(105, 200.3).x, P(105, 200.3).y);
  await win.waitForTimeout(50);
  check('trim preview highlights the part to be removed', (await win.locator('[data-testid=trim-preview]').count()) === 1);
  await click(P(105, 200.3));
  let t = await shapeById(T.id);
  check('trim removed the end portion: line now ends exactly at x = 80', near(t.end.x, 80, 1e-9) && near(t.start.x, 60, 1e-9), JSON.stringify(t));
  await win.keyboard.press('Control+z');
  t = await shapeById(T.id);
  check('undo restores the trimmed line', near(t.end.x, 120, 1e-9));
  await win.keyboard.press('Control+y');
  check('redo re-applies the trim', near((await shapeById(T.id)).end.x, 80, 1e-9));
  const n0 = await counts();
  await click(P(300, 270));
  check('trim on empty space is refused, nothing changes', (await counts()).past === n0.past);

  // extend T (now ending at x=80) to the rectangle edge at x = 300
  // y = 205: only the rectangle's left edge (x = 300, y 180..210) lies ahead of this line.
  const E = await createByNumbers('line', { 'new-x': 200, 'new-y': 205, 'new-length': 30, 'new-angle': 0 });
  await tool('extend');
  await click(P(229, 205.2));
  check('extend reaches the rectangle edge exactly (x = 300)', near((await shapeById(E.id)).end.x, 300, 1e-9), JSON.stringify((await shapeById(E.id)).end));
  await click(P(380, 30));
  check('extend with no boundary/empty pick changes nothing', near((await shapeById(E.id)).end.x, 300, 1e-9));

  // offset H by 15 upward
  await tool('offset');
  await setVal('offset-distance', 15);
  await win.click('[data-testid=tab-draw]');
  await click(P(70, 60.3));
  await click(P(70, 75));
  const off = await lastShape();
  check('offset creates a parallel line exactly 15 mm away', off.kind === 'line' && near(off.start.y, 75, 1e-9) && near(off.end.y, 75, 1e-9) && near(off.start.x, 40, 1e-9));

  // mirror the circle about x = 200 (Shift+click picks objects inside the Mirror tool)
  await tool('mirror');
  await click(P(250.25 - 25, 120.75), { modifiers: ['Shift'] });
  check('Shift+click in Mirror selects the object to mirror', ((await win.textContent('[data-testid=status-selection]')) ?? '').includes('1 selected'));
  await click(P(200, 20));
  await click(P(200, 250));
  const mir = await lastShape();
  check('mirror copy of the circle at (149.75, 120.75), radius 25', mir.kind === 'circle' && near(mir.center.x, 149.75, 1e-9) && near(mir.center.y, 120.75, 1e-9) && mir.radius === 25, JSON.stringify(mir));
  await win.screenshot({ path: path.join(OUT, 'm2-02-modify.png') });

  console.log('\nF. Grips');
  await tool('select');
  await click(P(250.25 + 25, 120.75));
  const grip = await win.locator('[data-handle=move]').boundingBox();
  // drag the circle centre grip onto the endpoint of line V (80, 180)
  await win.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await win.mouse.down();
  await win.mouse.move(P(80.6, 180.5).x, P(80.6, 180.5).y, { steps: 8 });
  await win.mouse.up();
  const moved = await shapeById(C.id);
  check('centre grip drag snaps the circle centre exactly onto a line endpoint (80, 180)', near(moved.center.x, 80, 1e-9) && near(moved.center.y, 180, 1e-9), JSON.stringify(moved.center));
  s = await state();
  const radDim = s.doc.dimensions.find((d) => d.kind === 'radius');
  check('the radius dimension followed the moved circle', (await dimText(radDim.id)) === 'R25.00');
  await win.keyboard.press('Control+z');
  check('undo restores the circle position', (await shapeById(C.id)).center.x === 250.25);

  console.log('\nG. Delete with dependent dimensions');
  await tool('select');
  await click(P(250.25 + 25, 120.75));
  const before2 = await counts();
  await win.keyboard.press('Delete');
  const after2 = await counts();
  check('deleting the circle also removes its 2 linked dimensions, and says so', after2.dims === before2.dims - 2 && ((await win.textContent('[data-testid=status-message]')) ?? '').includes('dependent'));
  await win.keyboard.press('Control+z');
  check('undo restores circle and dimensions together', (await counts()).dims === before2.dims && (await counts()).shapes === before2.shapes);

  console.log('\nH. Keyboard safety in text fields, tooltips, active tool');
  await tool('line');
  const toolBefore = (await state()).tool;
  await win.click('[data-testid=new-length]');
  await win.keyboard.type('trmedo');
  check('typing tool letters in a numeric field does not switch tools', (await state()).tool === toolBefore);
  check('… and the letters went into the field', (await val('new-length')).includes('trmedo'));
  const c3 = await counts();
  await win.keyboard.press('Delete');
  await win.keyboard.press('Control+z');
  check('Delete / Ctrl+Z inside a field do not touch the drawing', (await counts()).shapes === c3.shapes && (await counts()).past === c3.past);
  await win.press('[data-testid=new-length]', 'Escape');
  await win.keyboard.press('t');
  check('outside a field, T activates Trim', (await state()).tool === 'trim');
  check('active tool shown in the status bar', ((await win.textContent('[data-testid=status-tool]')) ?? '') === 'Trim');
  await win.click('[data-testid=tab-draw]');
  check('active tool highlighted on the ribbon', (await win.getAttribute('[data-testid=tool-trim]', 'aria-pressed')) === 'true');
  const tip = await win.getAttribute('[data-testid=tool-offset]', 'title');
  check('ribbon tools have descriptive tooltips', (tip ?? '').includes('Offset') && (tip ?? '').length > 20, tip);
  await win.keyboard.press('F3');
  check('F3 toggles object snap', (await state()).view.objectSnap === false);
  await win.keyboard.press('F3');

  console.log('\nI. Save / reopen with dimensions');
  const tmp = path.join(os.tmpdir(), `a3-m2-${process.pid}.a3d`);
  if (existsSync(tmp)) rmSync(tmp);
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, tmp);
  const final = await counts();
  await win.keyboard.press('Escape');
  await win.click('[data-testid=file-menu-button]');
  await win.click('[data-testid=menu-save-as]');
  await win.waitForTimeout(300);
  const saved = existsSync(tmp) ? JSON.parse(readFileSync(tmp, 'utf8')) : null;
  check('saved (current format version 3) with all dimensions', saved && saved.formatVersion === 3 && saved.dimensions.length === final.dims);
  await win.click('[data-testid=file-menu-button]');
  await win.click('[data-testid=menu-new]');
  await win.click('[data-testid=file-menu-button]');
  await win.click('[data-testid=menu-open]');
  await win.waitForTimeout(300);
  const re = await counts();
  check('reopened file has the same shapes and dimensions', re.shapes === final.shapes && re.dims === final.dims);
  check('reopened dimension still measures the edited line (135.500, 3 decimals)', (await dimText(dimA.id)) === '135.500', await dimText(dimA.id));
  rmSync(tmp, { force: true });
  await win.screenshot({ path: path.join(OUT, 'm2-03-reopened.png') });

  check('no renderer console errors', consoleErrors.length === 0, consoleErrors.join('\n'));
} catch (err) {
  failures++;
  console.log(`  FAIL  script error: ${err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err}`);
} finally {
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 0; }).catch(() => {});
  await app.close();
  await server.close();
}

console.log(`\nM2 E2E result: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
