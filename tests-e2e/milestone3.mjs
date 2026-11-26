// Milestone 3 end-to-end test: drives the REAL Electron app to verify layers,
// driving constraints and robust project-file handling.
// Usage: npm run e2e   (headless Linux: E2E_ELECTRON_ARGS="--no-sandbox --disable-gpu" xvfb-run -a npm run e2e)
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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
const TMP = path.join(os.tmpdir(), `a3-m3-${process.pid}`);
mkdirSync(TMP, { recursive: true });

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
/** Key-order-independent JSON (objects read from a file have a different key order). */
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));

await buildElectron({ dev: true });
const server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error' });
await server.listen();
const app = await electron.launch({ executablePath: electronBinary, args: ['.', ...extraArgs], env: { ...process.env, VITE_DEV_SERVER_URL: server.resolvedUrls.local[0] } });

try {
  const win = await app.firstWindow();
  win.setDefaultTimeout(5000);
  const consoleErrors = [];
  win.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
  win.on('pageerror', (e) => consoleErrors.push(String(e)));
  await win.waitForSelector('[data-testid=page-sheet]');
  await win.waitForFunction(() => {
    const c = document.querySelector('[data-testid=canvas]')?.getBoundingClientRect();
    const p = document.querySelector('[data-testid=page-sheet]')?.getBoundingClientRect();
    return !!c && !!p && c.width > 200 && p.width > 200; // laid out and fitted (slow CI machines)
  }, undefined, { timeout: 30000 });
  await win.waitForTimeout(400);

  // Native dialogs are answered by the main process from these globals.
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.__savePath });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__openPath] });
  });
  const setPaths = (p) => app.evaluate((_e, v) => Object.assign(globalThis, v), p);

  let sheet, k;
  const measure = async () => {
    sheet = await win.locator('[data-testid=page-sheet]').boundingBox();
    k = sheet.width / 420;
  };
  await measure();
  const P = (x, y) => ({ x: sheet.x + x * k, y: sheet.y + sheet.height - y * k });
  // NB: mouse.click() ignores `modifiers`, so Shift is held explicitly.
  const click = async (p, opts = {}) => {
    if (opts.shift) await win.keyboard.down('Shift');
    await win.mouse.click(p.x, p.y);
    if (opts.shift) await win.keyboard.up('Shift');
  };
  const val = (id) => win.inputValue(`[data-testid=${id}]`);
  const setVal = async (id, v) => {
    await win.fill(`[data-testid=${id}]`, String(v));
    await win.press(`[data-testid=${id}]`, 'Enter');
  };
  const st = () => win.evaluate(() => window.__a3State());
  const shape = async (id) => (await st()).doc.shapes.find((s) => s.id === id);
  const msg = async () => (await win.textContent('[data-testid=status-message]')) ?? '';
  const escape = async () => {
    await win.keyboard.press('Escape');
    await win.keyboard.press('Escape');
  };
  const tool = async (id) => {
    await escape();
    const tab = id.startsWith('dim-') ? 'annotate' : id.startsWith('con-') ? 'constrain' : ['line', 'rect', 'circle', 'trim', 'extend', 'offset', 'mirror'].includes(id) ? 'draw' : 'home';
    await win.click(`[data-testid=tab-${tab}]`);
    await win.click(`[data-testid=tool-${id}]`);
  };
  const create = async (kind, values) => {
    await tool(kind);
    for (const [id, v] of Object.entries(values)) await setVal(id, v);
    await win.click('[data-testid=create-shape]');
    const s = await st();
    return s.doc.shapes[s.doc.shapes.length - 1];
  };
  const select = async (...pts) => {
    await tool('select');
    await click(pts[0]);
    for (const p of pts.slice(1)) await click(p, { shift: true });
  };
  const constrainBtn = (kind) => `[data-testid=con-${kind}]`;

  // Layout: the canvas must never overlap the sidebar, whichever ribbon tab has been shown.
  for (const t of ['home', 'draw', 'annotate', 'constrain', 'view', 'home']) await win.click(`[data-testid=tab-${t}]`);
  await win.waitForTimeout(150);
  const cv = await win.locator('[data-testid=canvas]').boundingBox();
  const sb = await win.locator('.sidebar').boundingBox();
  check('layout: canvas stays left of the sidebar after visiting every ribbon tab', cv.x + cv.width <= sb.x + 1, `${cv.x + cv.width} > ${sb.x}`);
  await measure();

  // =====================================================================
  console.log('\nA. Layers');
  check('layers panel shows the Default layer', ((await win.textContent('[data-testid=layers-panel]')) ?? '').includes('Default'));
  await win.click('[data-testid=layer-new]');
  let s = await st();
  const walls = s.doc.layers[s.doc.layers.length - 1];
  check('new layer created and made active', s.doc.layers.length === 2 && s.activeLayerId === walls.id);
  await win.click('[data-testid=layer-rename]');
  await win.fill('[data-testid=layer-rename-input]', 'Walls');
  await win.press('[data-testid=layer-rename-input]', 'Enter');
  check('layer renamed to "Walls"', (await win.textContent(`[data-testid=layer-name-${walls.id}]`)) === 'Walls');
  const W1 = await create('line', { 'new-x': 40, 'new-y': 40, 'new-length': 100, 'new-angle': 0 });
  check('new line is on the active layer (Walls)', W1.layerId === walls.id);
  await win.locator(`[data-testid=layer-color-${walls.id}]`).evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(el, '#ff0000');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await win.waitForTimeout(100);
  await escape(); // selected objects are highlighted while a draw tool is active
  check('"By layer" line is drawn in the layer colour', (await win.getAttribute(`[data-testid=shapes] [data-shape-id="${W1.id}"]`, 'stroke')) === '#ff0000');

  await win.click('[data-testid=layer-row-layer-0]');
  const D1 = await create('circle', { 'new-x': 250, 'new-y': 150, 'new-radius': 30 });
  check('after clicking Default, new objects go on Default', D1.layerId === 'layer-0');

  // hide
  await win.click(`[data-testid=layer-visible-${walls.id}]`);
  check('hidden layer: its line is not drawn', (await win.locator(`[data-testid=shapes] [data-shape-id="${W1.id}"]`).count()) === 0);
  await escape();
  await win.keyboard.press('Control+a');
  check('hidden layer: Select All does not include its objects', !(await st()).selection.includes(W1.id));
  await win.click(`[data-testid=layer-visible-${walls.id}]`);
  check('shown again', (await win.locator(`[data-testid=shapes] [data-shape-id="${W1.id}"]`).count()) === 1);

  // lock
  await win.click(`[data-testid=layer-lock-${walls.id}]`);
  await select(P(90, 40));
  check('locked layer: clicking its line does not select it', !(await st()).selection.includes(W1.id));
  await win.keyboard.press('Control+a');
  check('locked layer: Select All excludes it', !(await st()).selection.includes(W1.id));
  await escape();
  await win.click(`[data-testid=layer-row-${walls.id}]`);
  const before = (await st()).doc.shapes.length;
  await create('line', { 'new-x': 10, 'new-y': 10, 'new-length': 10, 'new-angle': 0 });
  check('drawing on a locked active layer is refused with a message', (await st()).doc.shapes.length === before && /locked/.test(await msg()));
  await win.click('[data-testid=layer-row-layer-0]');
  // trim cannot change locked geometry
  const X1 = await create('line', { 'new-x': 90, 'new-y': 20, 'new-length': 40, 'new-angle': 90 }); // crosses W1 at (90,40)
  await tool('trim');
  await click(P(120, 40.2));
  check('trim cannot change a line on a locked layer', near((await shape(W1.id)).end.x, 140));
  await win.click(`[data-testid=layer-lock-${walls.id}]`);
  await tool('trim');
  await click(P(120, 40.2));
  check('after unlocking, trim works on it', near((await shape(W1.id)).end.x, 90, 1e-9));
  await win.keyboard.press('Control+z');

  // move between layers via Properties
  await select(P(250 + 30, 150));
  await win.selectOption('[data-testid=prop-layer]', walls.id);
  check('Properties ▸ Layer moves the circle to Walls', (await shape(D1.id)).layerId === walls.id);
  // reorder
  await win.click(`[data-testid=layer-row-${walls.id}]`);
  await win.click('[data-testid=layer-down]');
  check('reorder: Walls moved below Default', (await st()).doc.layers[0].id === walls.id);
  await win.click('[data-testid=layer-up]');

  // delete layer with objects → dialog
  await win.click(`[data-testid=layer-row-${walls.id}]`);
  await win.click('[data-testid=layer-delete]');
  check('deleting a non-empty layer asks first', await win.isVisible('[data-testid=dialog-delete-layer]'));
  check('… and states how many objects it contains', /contains 2 objects/.test((await win.textContent('[data-testid=dialog-message]')) ?? ''));
  await win.click('[data-testid=dialog-cancel]');
  check('Cancel keeps the layer and its objects', (await st()).doc.layers.length === 2);
  await win.click('[data-testid=layer-delete]');
  await win.selectOption('[data-testid=dialog-choice]', 'layer-0');
  await win.click('[data-testid=dialog-reassign]');
  s = await st();
  check('"Move objects" deletes the layer and reassigns all its objects', s.doc.layers.length === 1 && s.doc.shapes.every((x) => x.layerId === 'layer-0') && s.doc.shapes.length === 3);
  await win.keyboard.press('Control+z');
  s = await st();
  check('undo restores the layer and assignments', s.doc.layers.length === 2 && (await shape(W1.id)).layerId === walls.id);
  await win.click(`[data-testid=layer-row-${walls.id}]`);
  await win.click('[data-testid=layer-delete]');
  await win.click('[data-testid=dialog-delete]');
  s = await st();
  check('"Delete layer and objects" removes exactly its objects', s.doc.shapes.length === 1 && s.doc.shapes[0].id === X1.id);
  await win.keyboard.press('Control+z');
  check('undo brings them back', (await st()).doc.shapes.length === 3);

  // export with a hidden layer
  await win.click(`[data-testid=layer-visible-${walls.id}]`);
  const svgPath = path.join(TMP, 'export.svg');
  await setPaths({ __savePath: svgPath });
  await win.click('[data-testid=file-menu-button]');
  await win.click('[data-testid=menu-export-svg]');
  await win.waitForTimeout(300);
  const svg = existsSync(svgPath) ? readFileSync(svgPath, 'utf8') : '';
  check('SVG export written', svg.startsWith('<?xml') && svg.includes('width="420mm"'));
  check('SVG export excludes the hidden layer’s objects', !svg.includes(W1.id) && !svg.includes(D1.id) && svg.includes(X1.id));
  await win.click(`[data-testid=layer-visible-${walls.id}]`);
  await win.screenshot({ path: path.join(OUT, 'm3-01-layers.png') });

  // =====================================================================
  console.log('\nB. Driving constraints');
  await win.click('[data-testid=layer-row-layer-0]');
  const A = await create('line', { 'new-x': 60, 'new-y': 200, 'new-length': 100, 'new-angle': 5 });
  const B = await create('line', { 'new-x': 60, 'new-y': 240, 'new-length': 80, 'new-angle': 20 });
  await select(P(110, 204.4));
  check('selecting line A', (await st()).selection.join() === A.id);
  await win.click('[data-testid=tab-constrain]');
  check('Parallel is disabled with one line selected, and says why', (await win.isDisabled(constrainBtn('parallel'))) && /two lines/.test((await win.getAttribute(constrainBtn('parallel'), 'title')) ?? ''));
  await win.click(constrainBtn('horizontal'));
  let a = await shape(A.id);
  check('Horizontal makes line A exactly horizontal', near(a.start.y, a.end.y, 1e-9), JSON.stringify(a));
  check('a constraint marker appears, status satisfied', (await win.getAttribute(`[data-constraint-kind=horizontal]`, 'data-status')) === 'satisfied');
  await select(P((a.start.x + a.end.x) / 2, a.start.y), P(60 + 40 * Math.cos(0.349), 240 + 40 * Math.sin(0.349)));
  check('two lines selected', (await st()).selection.length === 2);
  await win.click('[data-testid=tab-constrain]');
  await win.click(constrainBtn('parallel'));
  let b = await shape(B.id);
  check('Parallel makes B parallel to the horizontal A', near(b.start.y, b.end.y, 1e-6), JSON.stringify(b));
  await select(P((a.start.x + a.end.x) / 2, a.start.y));
  await win.click('[data-testid=tab-constrain]');
  await win.click(constrainBtn('fixed-length'));
  check('Fixed length shows a driving marker with its value', ((await win.textContent('[data-constraint-kind=fixed-length] text')) ?? '').startsWith('L 150') || ((await win.textContent('[data-constraint-kind=fixed-length] text')) ?? '').startsWith('L '));
  // select the marker → properties
  const fl = await win.locator('[data-constraint-kind=fixed-length] rect').first().boundingBox();
  await escape();
  await win.mouse.click(fl.x + fl.width / 2, fl.y + fl.height / 2);
  check('clicking a marker selects the constraint', await win.isVisible('[data-testid=props-constraint-fixed-length]'));
  check('it is labelled as a DRIVING constraint', ((await win.textContent('[data-testid=constraint-mode]')) ?? '').includes('Driving'));
  await setVal('constraint-value', 150);
  a = await shape(A.id);
  check('editing the driving value to 150 changes the line to exactly 150 mm', near(Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y), 150, 1e-6));
  check('… and it stays horizontal', near(a.start.y, a.end.y, 1e-9));
  await win.check('[data-testid=constraint-suppress]');
  check('suppress: marker shows suppressed', (await win.getAttribute('[data-constraint-kind=fixed-length]', 'data-status')) === 'suppressed');
  await win.uncheck('[data-testid=constraint-suppress]');
  check('unsuppress: satisfied again', (await win.getAttribute('[data-constraint-kind=fixed-length]', 'data-status')) === 'satisfied');
  await win.press('[data-testid=constraint-value]', 'Escape').catch(() => {});

  // conflict: fixed angle 30 on a horizontal line
  await select(P((a.start.x + a.end.x) / 2, a.start.y));
  await win.click('[data-testid=tab-constrain]');
  await win.click(constrainBtn('fixed-angle')); // current angle 0 → consistent
  const fa = await win.locator('[data-constraint-kind=fixed-angle] rect').first().boundingBox();
  await escape();
  await win.mouse.click(fa.x + fa.width / 2, fa.y + fa.height / 2);
  const geomBefore = JSON.stringify((await st()).doc.shapes);
  await setVal('constraint-value', 30);
  check('a conflicting value (30° on a horizontal line) is refused with a message', /Not applied/.test(await msg()), await msg());
  check('… and the geometry is not distorted', JSON.stringify((await st()).doc.shapes) === geomBefore);
  check('… and the stored value is unchanged', (await st()).doc.constraints.find((c) => c.kind === 'fixed-angle').value === 0);
  await win.press('[data-testid=constraint-value]', 'Escape').catch(() => {});

  // coincident & fixed position tools
  a = await shape(A.id);
  b = await shape(B.id);
  await tool('con-coincident');
  await click(P(a.end.x, a.end.y));
  await click(P(b.start.x, b.start.y));
  a = await shape(A.id);
  b = await shape(B.id);
  check('Coincident joins A’s end and B’s start exactly', near(a.end.x, b.start.x, 1e-6) && near(a.end.y, b.start.y, 1e-6), `${JSON.stringify(a.end)} ${JSON.stringify(b.start)}`);
  check('… without breaking the others (A still 150 mm, horizontal)', near(Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y), 150, 1e-6) && near(a.start.y, a.end.y, 1e-6));
  await tool('con-fixed-position');
  await click(P(a.start.x, a.start.y));
  const pinned = { x: a.start.x, y: a.start.y };
  check('Fixed position pins A’s start', (await st()).doc.constraints.some((c) => c.kind === 'fixed-position' && near(c.x, pinned.x) && near(c.y, pinned.y)));

  // edit that violates: try to set A length to 120 in Properties → constraint wins
  await select(P((a.start.x + a.end.x) / 2 - 20, a.start.y));
  await setVal('prop-length', 120);
  a = await shape(A.id);
  check('an edit that breaks a driving constraint is corrected (length stays 150)', near(Math.hypot(a.end.x - a.start.x, a.end.y - a.start.y), 150, 1e-6));
  check('… and the user is told constraints were applied', /constraints applied/.test(await msg()), await msg());
  await win.press('[data-testid=prop-length]', 'Escape');

  // drag B's end grip: B stays parallel (horizontal), A's start stays pinned
  b = await shape(B.id);
  await select(P((b.start.x + b.end.x) / 2, b.start.y));
  const endGrip = await win.locator('[data-handle=end]').boundingBox();
  await win.mouse.move(endGrip.x + endGrip.width / 2, endGrip.y + endGrip.height / 2);
  await win.mouse.down();
  await win.mouse.move(endGrip.x + 40, endGrip.y - 50, { steps: 6 });
  await win.mouse.up();
  b = await shape(B.id);
  a = await shape(A.id);
  check('grip drag: B is kept parallel (horizontal) during/after the drag', near(b.start.y, b.end.y, 1e-6), JSON.stringify(b));
  check('grip drag: pinned point did not move', near(a.start.x, pinned.x, 1e-6) && near(a.start.y, pinned.y, 1e-6));
  check('status bar: all constraints satisfied', (await win.getAttribute('[data-testid=status-constraints]', 'data-unsatisfied')) === '0');

  // tangent
  const T = await create('circle', { 'new-x': 330, 'new-y': 80, 'new-radius': 20 });
  const TL = await create('line', { 'new-x': 280, 'new-y': 40, 'new-length': 120, 'new-angle': 0 });
  await select(P(330 + 20, 80), P(330, 40));
  await win.click('[data-testid=tab-constrain]');
  await win.click(constrainBtn('tangent'));
  const tc = await shape(T.id);
  const tl = await shape(TL.id);
  const dist = Math.abs((tl.end.x - tl.start.x) * (tc.center.y - tl.start.y) - (tl.end.y - tl.start.y) * (tc.center.x - tl.start.x)) / Math.hypot(tl.end.x - tl.start.x, tl.end.y - tl.start.y);
  check('Tangent: line touches the circle exactly; radius unchanged', near(dist, tc.radius, 1e-6) && tc.radius === 20, `dist ${dist} r ${tc.radius}`);
  check('… and the message counts only the objects that really moved', /2 objects adjusted/.test(await msg()), await msg());

  // delete a constraint (geometry stays)
  const nBefore = (await st()).doc.constraints.length;
  const tg = await win.locator('[data-constraint-kind=tangent] rect').first().boundingBox();
  await escape();
  await win.mouse.click(tg.x + tg.width / 2, tg.y + tg.height / 2);
  const g2 = JSON.stringify((await st()).doc.shapes);
  await win.click('[data-testid=constraint-delete]');
  check('Delete constraint removes it and leaves geometry as is', (await st()).doc.constraints.length === nBefore - 1 && JSON.stringify((await st()).doc.shapes) === g2);
  await win.keyboard.press('Control+z');
  check('undo restores it', (await st()).doc.constraints.length === nBefore);
  // reference dimension label
  await tool('dim-aligned');
  await click(P(a.start.x, a.start.y));
  await click(P(a.end.x, a.end.y));
  await click(P(a.start.x + 50, a.start.y - 15));
  const dims = (await st()).doc.dimensions;
  const dt = await win.locator(`[data-dimension-id="${dims[dims.length - 1].id}"] text`).boundingBox();
  await escape();
  await win.mouse.click(dt.x + dt.width / 2, dt.y + dt.height / 2);
  check('dimensions are labelled REFERENCE (they do not control geometry)', ((await win.textContent('[data-testid=dim-mode]')) ?? '').includes('Reference'));
  await win.screenshot({ path: path.join(OUT, 'm3-02-constraints.png') });

  // =====================================================================
  console.log('\nC. Project files');
  check('unsaved-changes indicator is shown', await win.isVisible('[data-testid=unsaved-indicator]'));
  await win.click('[data-testid=tab-view]');
  await win.selectOption('[data-testid=grid-spacing]', '25');
  await win.click(`[data-testid=layer-row-${walls.id}]`);
  await win.click(`[data-testid=layer-lock-${walls.id}]`);
  const proj = path.join(TMP, 'project.a3d');
  await setPaths({ __savePath: proj });
  await escape();
  await win.click('[data-testid=file-menu-button]');
  await win.click('[data-testid=menu-save-as]');
  await win.waitForTimeout(300);
  check('after Save As the unsaved indicator disappears', (await win.locator('[data-testid=unsaved-indicator]').count()) === 0);
  const saved = JSON.parse(readFileSync(proj, 'utf8'));
  const live = await st();
  check('saved file: current format (5) with layers, constraints, dimensions, orientation', saved.formatVersion === 5 && saved.layers.length === 2 && saved.constraints.length === live.doc.constraints.length && saved.dimensions.length === live.doc.dimensions.length && saved.page.orientation === 'landscape');
  check('saved file: layer properties and display preferences', saved.layers[1].name === 'Walls' && saved.layers[1].locked === true && saved.layers[1].color === '#ff0000' && saved.settings.display.gridSpacingMm === 25 && saved.settings.activeLayerId === walls.id);

  // replacing a modified drawing asks first
  await win.click('[data-testid=layer-row-layer-0]');
  await create('line', { 'new-x': 5, 'new-y': 5, 'new-length': 10, 'new-angle': 0 });
  await escape();
  await win.click('[data-testid=file-menu-button]');
  await win.click('[data-testid=menu-new]');
  check('File ▸ New on a modified drawing asks Save / Don’t save / Cancel', await win.isVisible('[data-testid=dialog-unsaved]'));
  await win.click('[data-testid=dialog-cancel]');
  check('Cancel keeps the drawing', (await st()).doc.shapes.length === live.doc.shapes.length + 1);
  await win.click('[data-testid=file-menu-button]');
  await win.click('[data-testid=menu-new]');
  await win.click('[data-testid=dialog-discard]');
  check('Don’t save → new empty drawing', (await st()).doc.shapes.length === 0);

  // reopen
  await setPaths({ __openPath: proj });
  await win.click('[data-testid=file-menu-button]');
  await win.click('[data-testid=menu-open]');
  await win.waitForTimeout(300);
  const re = await st();
  check('reopened: identical geometry, dimensions, constraints and layers', canon(re.doc) === canon(live.doc));
  check('reopened: display preferences and active layer restored', re.view.gridSpacingMm === 25 && re.activeLayerId === walls.id);
  check('reopened: not marked modified', (await win.locator('[data-testid=unsaved-indicator]').count()) === 0);
  check('reopened: all constraints still satisfied', (await win.getAttribute('[data-testid=status-constraints]', 'data-unsatisfied')) === '0');
  // save again: byte-identical
  const bytes1 = readFileSync(proj, 'utf8');
  await win.keyboard.press('Control+s');
  await win.waitForTimeout(300);
  check('Save without changes rewrites a byte-identical file', readFileSync(proj, 'utf8') === bytes1);

  // older file: upgrade notice + confirmation before overwriting
  const old = path.join(TMP, 'old-m1.a3d');
  copyFileSync('tests/fixtures/milestone1-v1.a3d', old);
  const oldBytes = readFileSync(old, 'utf8');
  await setPaths({ __openPath: old });
  await win.click('[data-testid=file-menu-button]');
  await win.click('[data-testid=menu-open]');
  await win.waitForSelector('[data-testid=dialog-warnings]');
  check('opening a Milestone 1 file reports the upgrade', /Upgraded from format version 1/.test((await win.textContent('[data-testid=dialog-detail]')) ?? ''));
  await win.click('[data-testid=dialog-ok]');
  check('… with all 4 objects', (await st()).doc.shapes.length === 4);
  await win.keyboard.press('Control+s');
  await win.waitForSelector('[data-testid=dialog-upgrade]');
  check('saving over an older-format file asks before upgrading it', true);
  await win.click('[data-testid=dialog-cancel]');
  check('Cancel leaves the old file byte-for-byte unchanged', readFileSync(old, 'utf8') === oldBytes);
  await win.keyboard.press('Control+s');
  await win.click('[data-testid=dialog-upgrade-save]');
  await win.waitForTimeout(300);
  check('"Upgrade and save" writes the current format (5)', JSON.parse(readFileSync(old, 'utf8')).formatVersion === 5);

  // malformed / newer files: useful error, current drawing untouched
  const keep = JSON.stringify((await st()).doc);
  const bad = path.join(TMP, 'bad.a3d');
  writeFileSync(bad, JSON.stringify({ ...saved, shapes: [{ ...saved.shapes[0], radius: -1, kind: 'circle', center: { x: 0, y: 0 } }] }));
  await setPaths({ __openPath: bad });
  await win.click('[data-testid=file-menu-button]');
  await win.click('[data-testid=menu-open]');
  await win.waitForSelector('[data-testid=dialog-error]');
  check('malformed file: error names the exact problem', /shapes\[0\]\.radius/.test((await win.textContent('[data-testid=dialog-detail]')) ?? ''));
  await win.click('[data-testid=dialog-ok]');
  check('… and the open drawing is untouched', JSON.stringify((await st()).doc) === keep);
  writeFileSync(bad, JSON.stringify({ ...saved, formatVersion: 7 }));
  await win.click('[data-testid=file-menu-button]');
  await win.click('[data-testid=menu-open]');
  await win.waitForSelector('[data-testid=dialog-error]');
  check('newer-version file: refused with an explanation', /newer version/.test((await win.textContent('[data-testid=dialog-detail]')) ?? ''));
  await win.click('[data-testid=dialog-ok]');
  writeFileSync(bad, '{"format":"a3-precision-drawing","formatVersion":3,"page":');
  await win.click('[data-testid=file-menu-button]');
  await win.click('[data-testid=menu-open]');
  await win.waitForSelector('[data-testid=dialog-error]');
  check('truncated file: refused as damaged', /truncated or damaged/.test((await win.textContent('[data-testid=dialog-detail]')) ?? ''));
  await win.click('[data-testid=dialog-ok]');
  check('the bad file itself was never modified', statSync(bad).size < 100);
  await win.screenshot({ path: path.join(OUT, 'm3-03-files.png') });

  check('no renderer console errors', consoleErrors.length === 0, consoleErrors.join('\n'));
} catch (err) {
  failures++;
  await (await app.firstWindow()).screenshot({ path: path.join(OUT, 'm3-failure.png') }).catch(() => {});
  console.log(`  FAIL  script error: ${err && err.stack ? err.stack.split('\n').slice(0, 14).join(' | ') : err}`);
} finally {
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 0; }).catch(() => {});
  await app.close();
  await server.close();
  rmSync(TMP, { recursive: true, force: true });
}

console.log(`\nM3 E2E result: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
