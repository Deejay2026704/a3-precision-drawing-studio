// Milestone 5 end-to-end test (development build): arcs, trimming circles, fillet and
// chamfer, radius / angle constraints, the title block, A4 print layouts and the
// "Check for updates" command – all driven through the REAL Electron window.
//
// Usage: npm run e2e:m5   (headless Linux: E2E_ELECTRON_ARGS=--no-sandbox xvfb-run -a npm run e2e:m5)
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
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
const tmp = mkdtempSync(path.join(os.tmpdir(), 'a3-m5-'));

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
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;
const nearPt = (p, x, y, tol = 1e-6) => !!p && near(p.x, x, tol) && near(p.y, y, tol);
const canon = (v) => (Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let poppler = true;
try {
  execFileSync('pdfinfo', ['-v'], { stdio: 'ignore' });
} catch {
  poppler = false;
}
const pdfPages = (file) => (readFileSync(file, 'latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;

await buildElectron({ dev: true });
const server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const app = await electron.launch({
  executablePath: electronBinary,
  args: ['.', ...extraArgs],
  env: { ...process.env, VITE_DEV_SERVER_URL: url, A3_USER_DATA: path.join(tmp, 'profile') },
});

try {
  const win = await app.firstWindow();
  win.setDefaultTimeout(8000);
  const errors = [];
  win.on('pageerror', (e) => errors.push(String(e)));
  win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await win.waitForSelector('[data-testid=page-sheet]');
  await win.waitForFunction(() => {
    const c = document.querySelector('[data-testid=canvas]')?.getBoundingClientRect();
    const p = document.querySelector('[data-testid=page-sheet]')?.getBoundingClientRect();
    return !!c && !!p && c.width > 200 && p.width > 200;
  }, undefined, { timeout: 30000 });
  await win.waitForTimeout(400);
  await app.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: globalThis.__savePath });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__openPath] });
    dialog.showMessageBoxSync = () => 0;
  });
  const setPaths = (p) => app.evaluate((_e, v) => Object.assign(globalThis, v), p);

  // ---------- helpers ----------
  let sheet, k;
  const measure = async () => {
    sheet = await win.locator('[data-testid=page-sheet]').boundingBox();
    k = sheet.width / 420;
  };
  const P = (x, y) => ({ x: sheet.x + x * k, y: sheet.y + sheet.height - y * k });
  const click = async (p, opts = {}) => {
    if (opts.shift) await win.keyboard.down('Shift');
    await win.mouse.click(p.x, p.y);
    if (opts.shift) await win.keyboard.up('Shift');
  };
  const setVal = async (id, v) => {
    await win.fill(`[data-testid=${id}]`, String(v));
    await win.press(`[data-testid=${id}]`, 'Enter');
  };
  const st = () => win.evaluate(() => window.__a3State());
  const shapeById = async (id) => (await st()).doc.shapes.find((s) => s.id === id);
  const lastShape = async () => {
    const s = await st();
    return s.doc.shapes[s.doc.shapes.length - 1];
  };
  const escape = async () => {
    await win.keyboard.press('Escape');
    await win.keyboard.press('Escape');
  };
  const TAB = { select: 'home' };
  const tool = async (id) => {
    await escape();
    await win.click(`[data-testid=tab-${TAB[id] ?? 'draw'}]`);
    await win.click(`[data-testid=tool-${id}]`);
  };
  const create = async (kind, values) => {
    await tool(kind);
    for (const [id, v] of Object.entries(values)) await setVal(id, v);
    await win.click('[data-testid=create-shape]');
    const s = await lastShape();
    await escape();
    return s;
  };
  const select = async (...pts) => {
    await tool('select');
    await click(pts[0]);
    for (const p of pts.slice(1)) await click(p, { shift: true });
  };
  const menu = async (id) => {
    await win.click('[data-testid=file-menu-button]');
    await win.click(`[data-testid=${id}]`);
  };
  const message = async () => (await win.textContent('[data-testid=status-message]')) ?? '';
  const angleBetween = (a, b) => {
    const u = { x: a.end.x - a.start.x, y: a.end.y - a.start.y };
    const v = { x: b.end.x - b.start.x, y: b.end.y - b.start.y };
    return (Math.atan2(Math.abs(u.x * v.y - u.y * v.x), u.x * v.x + u.y * v.y) * 180) / Math.PI;
  };

  // =====================================================================
  console.log('\nA. Ribbon layout (the new tools must not push the drawing area around)');
  const tabsLayout = async () => {
    const out = [];
    for (const t of ['home', 'draw', 'annotate', 'constrain', 'view']) {
      await win.click(`[data-testid=tab-${t}]`);
      await win.waitForTimeout(80);
      out.push({ t, ...(await win.evaluate(() => { const r = document.querySelector('.ribbon'); return { h: r.getBoundingClientRect().height, canvasY: document.querySelector('[data-testid=canvas]').getBoundingClientRect().y, over: r.scrollWidth - r.clientWidth }; })) });
    }
    return out;
  };
  const steady = (l) => l.every((r) => r.h === l[0].h && r.canvasY === l[0].canvasY);
  let layout = await tabsLayout();
  check('the drawing area does not move when switching ribbon tabs', steady(layout), JSON.stringify(layout));
  console.log(`        (horizontal overflow per tab at this window size: ${layout.map((r) => `${r.t} ${Math.max(0, r.over)} px`).join(', ')})`);
  const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 700));
  await win.waitForTimeout(300);
  layout = await tabsLayout();
  check('… nor on a narrow window, where the ribbon scrolls sideways instead', steady(layout) && layout.some((r) => r.over > 0), JSON.stringify(layout));
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), size);
  await win.waitForTimeout(300);
  await win.click('[data-testid=tab-view]');
  await win.click('[data-testid=cmd-fit-page]');
  await win.click('[data-testid=tab-home]');
  await measure();

  // =====================================================================
  console.log('\nB. Arcs');
  await tool('arc');
  await click(P(40, 200));
  await click(P(70, 230));
  await click(P(100, 200));
  const A3 = await lastShape();
  check('3-point arc: start, point on arc, end → an arc', A3?.kind === 'arc', JSON.stringify(A3));
  check('… exact centre (70, 200) and radius 30', nearPt(A3.center, 70, 200, 1e-9) && near(A3.radius, 30, 1e-9), JSON.stringify(A3));
  check('… through the picked point (top half: start 0°, sweep 180°)', near(A3.startDeg, 0, 1e-9) && near(A3.sweepDeg, 180, 1e-9), `${A3.startDeg} ${A3.sweepDeg}`);
  await tool('arc');
  await click(P(140, 200));
  await click(P(160, 200));
  await click(P(180, 200));
  check('collinear points are refused with a message', /straight line|collinear/i.test(await message()), await message());
  const AN = await create('arc', { 'new-x': 200, 'new-y': 200, 'new-radius': 25, 'new-start': 30, 'new-sweep': 120 });
  check('arc by numbers: centre (200,200), R25, start 30°, sweep 120°', AN.kind === 'arc' && AN.radius === 25 && AN.startDeg === 30 && AN.sweepDeg === 120);
  await select(P(200, 225));
  check('Properties shows the arc length (25 × 120° = 52.36 mm)', ((await win.textContent('[data-testid=prop-arc-length]')) ?? '').includes('52.36'));
  check('arcs are drawn on the canvas', (await win.locator(`[data-testid=shapes] [data-shape-id="${AN.id}"]`).count()) > 0);

  // =====================================================================
  console.log('\nC. Trimming a circle');
  const C = await create('circle', { 'new-x': 100, 'new-y': 100, 'new-diameter': 60 });
  await create('line', { 'new-x': 50, 'new-y': 100, 'new-length': 100, 'new-angle': 0 });
  await tool('trim');
  await win.mouse.move(P(100, 130).x, P(100, 130).y);
  await win.waitForTimeout(80);
  check('hovering shows the part that will be removed', (await win.locator('[data-testid=trim-preview]').count()) > 0);
  await click(P(100, 130));
  const CT = await shapeById(C.id);
  check('clicking the top of the circle leaves the bottom half as an arc (same object)', CT?.kind === 'arc' && near(CT.startDeg, 180, 1e-9) && near(CT.sweepDeg, 180, 1e-9), JSON.stringify(CT));
  check('… centre and radius unchanged', nearPt(CT.center, 100, 100, 1e-12) && CT.radius === 30);
  await win.keyboard.press('Control+z');
  check('undo turns it back into the full circle', (await shapeById(C.id))?.kind === 'circle');
  await win.keyboard.press('Control+y');
  check('redo trims it again', (await shapeById(C.id))?.kind === 'arc');

  // =====================================================================
  console.log('\nD. Fillet and chamfer');
  const L1 = await create('line', { 'new-x': 250, 'new-y': 40, 'new-length': 100, 'new-angle': 0 });
  const L2 = await create('line', { 'new-x': 350, 'new-y': 40, 'new-length': 80, 'new-angle': 90 });
  await tool('fillet');
  check('the fillet radius is set in Properties while the tool is active', (await win.locator('[data-testid=fillet-radius]').count()) === 1);
  await setVal('fillet-radius', 10);
  const before = (await st()).doc.shapes.length;
  await click(P(300, 40));
  await click(P(350, 80));
  let s = await st();
  const F = s.doc.shapes[s.doc.shapes.length - 1];
  check('fillet R10 adds a tangent arc', s.doc.shapes.length === before + 1 && F.kind === 'arc' && near(F.radius, 10, 1e-9), JSON.stringify(F));
  check('… centred exactly at (340, 50)', nearPt(F.center, 340, 50, 1e-9), JSON.stringify(F.center));
  check('… and both lines end exactly at the tangent points', nearPt((await shapeById(L1.id)).end, 340, 40, 1e-9) && nearPt((await shapeById(L2.id)).start, 350, 50, 1e-9));
  await win.keyboard.press('Control+z');
  s = await st();
  check('one undo removes the arc and restores both lines', s.doc.shapes.length === before && nearPt((await shapeById(L1.id)).end, 350, 40) && nearPt((await shapeById(L2.id)).start, 350, 40));
  await tool('chamfer');
  await setVal('chamfer-distance', 5);
  await click(P(300, 40));
  await click(P(350, 80));
  const CH = await lastShape();
  check('chamfer 5 adds the corner line (345,40)–(350,45)', CH.kind === 'line' && nearPt(CH.start, 345, 40, 1e-9) && nearPt(CH.end, 350, 45, 1e-9), JSON.stringify(CH));
  await win.keyboard.press('Control+z');
  await tool('fillet');
  await click(P(300, 40));
  await click(P(300, 41)); // the same line twice
  check('picking the same line twice is refused with a message', /two different lines|different/i.test(await message()), await message());

  // =====================================================================
  console.log('\nE. Radius and angle constraints');
  await select(P(300, 40), P(350, 80));
  await win.click('[data-testid=tab-constrain]');
  await win.click('[data-testid=con-angle]');
  s = await st();
  const ang = s.doc.constraints.find((c) => c.kind === 'angle');
  check('angle constraint between two lines records the current angle (90°)', ang && near(ang.value, 90, 1e-9), JSON.stringify(ang));
  const mk = await win.locator('[data-constraint-kind=angle] rect').first().boundingBox();
  await escape();
  await win.mouse.click(mk.x + mk.width / 2, mk.y + mk.height / 2);
  check('clicking the ∡ marker selects the angle constraint', await win.isVisible('[data-testid=props-constraint-angle]'));
  if ((await win.locator('[data-testid=constraint-value]').count()) > 0) {
    await setVal('constraint-value', 60);
    const a = await shapeById(L1.id);
    const b = await shapeById(L2.id);
    check('changing it to 60° drives the geometry to exactly 60°', near(angleBetween(a, b), 60, 1e-6), angleBetween(a, b));
    await win.press('[data-testid=constraint-value]', 'Escape').catch(() => {});
  }
  await select(P(200, 225));
  await win.click('[data-testid=tab-constrain]');
  await win.click('[data-testid=con-fixed-radius]');
  s = await st();
  const rad = s.doc.constraints.find((c) => c.kind === 'fixed-radius');
  check('fixed-radius constraint on the arc records R25', rad && near(rad.value, 25, 1e-12), JSON.stringify(rad));
  await win.click('[data-testid=tab-home]');

  // =====================================================================
  console.log('\nF. Title block');
  await escape();
  check('with nothing selected, Properties offers the title block', (await win.locator('[data-testid=title-block-panel]').count()) === 1);
  check('it is off by default (no frame on the sheet)', (await win.locator('[data-testid=title-block]').count()) === 0);
  await win.check('[data-testid=title-block-visible]');
  check('turning it on draws the frame and title block on the sheet', (await win.locator('[data-testid=title-block]').count()) === 1);
  s = await st();
  check('… and fills in today’s date', /^\d{4}-\d{2}-\d{2}$/.test(s.doc.titleBlock.date), s.doc.titleBlock.date);
  await setVal('tb-title', 'Mounting bracket');
  await setVal('tb-drawingNumber', 'MB-001');
  const sheetText = (await win.textContent('[data-testid=title-block]')) ?? '';
  check('typed title and number appear in the title block', sheetText.includes('Mounting bracket') && sheetText.includes('MB-001'));
  check('scale and sheet size are filled in automatically', sheetText.includes('1:1') && /A3/.test(sheetText), sheetText.slice(0, 200));
  await win.click('[data-testid=tb-revision]');
  await win.fill('[data-testid=tb-revision]', 'ZZZ');
  await win.press('[data-testid=tb-revision]', 'Escape');
  check('Escape in a title-block field reverts the edit', (await st()).doc.titleBlock.revision === 'A');
  await win.keyboard.press('Control+z');
  check('title-block edits are undoable', (await st()).doc.titleBlock.drawingNumber === '');
  await win.keyboard.press('Control+y');

  // =====================================================================
  console.log('\nG. PDF print layouts');
  const a3 = path.join(tmp, 'sheet-a3.pdf');
  await setPaths({ __savePath: a3 });
  await win.keyboard.press('Control+p');
  await sleep(700);
  check('Ctrl+P still exports one A3 page', existsSync(a3) && pdfPages(a3) === 1);
  const tiled = path.join(tmp, 'sheet-tiled.pdf');
  await setPaths({ __savePath: tiled });
  await menu('menu-export-pdf-a4');
  check('"Export PDF for an A4 printer" asks how to print', (await win.locator('[data-testid=dialog-pdf-layout]').count()) === 1);
  await win.selectOption('[data-testid=dialog-choice]', 'a4-tiled');
  await win.click('[data-testid=dialog-export]');
  await sleep(700);
  check('tiled: 4 A4 pages written', existsSync(tiled) && pdfPages(tiled) === 4);
  check('status says true scale / print at 100 %', /true scale/.test(await message()), await message());
  const fit = path.join(tmp, 'sheet-fit.pdf');
  await setPaths({ __savePath: fit });
  await menu('menu-export-pdf-a4');
  await win.selectOption('[data-testid=dialog-choice]', 'a4-fit');
  await win.click('[data-testid=dialog-export]');
  await sleep(700);
  check('fit: one page', existsSync(fit) && pdfPages(fit) === 1);
  check('status warns it is NOT to scale', /NOT to scale/.test(await message()), await message());
  await setPaths({ __savePath: path.join(tmp, 'never.pdf') });
  await menu('menu-export-pdf-a4');
  await win.click('[data-testid=dialog-cancel]');
  await sleep(300);
  check('Cancel writes nothing', !existsSync(path.join(tmp, 'never.pdf')));
  if (poppler) {
    const i3 = execFileSync('pdfinfo', [a3], { encoding: 'utf8' });
    const it = execFileSync('pdfinfo', [tiled], { encoding: 'utf8' });
    const ifit = execFileSync('pdfinfo', [fit], { encoding: 'utf8' });
    check('poppler: A3 file is A3', /Page size:\s+1190\.55 x 841\.89 pts \(A3\)/.test(i3), i3);
    check('poppler: tiled file is 4 × A4 landscape', /Pages:\s+4/.test(it) && /Page size:\s+841\.89 x 595\.27/.test(it), it);
    check('poppler: fit file is 1 × A4 landscape', /Pages:\s+1/.test(ifit) && /Page size:\s+841\.89 x 595\.27/.test(ifit), ifit);
    const t3 = execFileSync('pdftotext', [a3, '-'], { encoding: 'utf8' });
    check('poppler: the A3 PDF contains the title-block text', t3.includes('Mounting bracket') && t3.includes('MB-001'), t3.slice(0, 300));
    const tt = execFileSync('pdftotext', [tiled, '-'], { encoding: 'utf8' });
    check('poppler: every tile is labelled "Page i of 4"', [1, 2, 3, 4].every((n) => tt.includes(`Page ${n} of 4`)), tt.slice(0, 300));
    const tf = execFileSync('pdftotext', [fit, '-'], { encoding: 'utf8' });
    check('poppler: the fitted page says NOT TO SCALE (– and × print correctly)', /NOT TO SCALE – sheet reduced/.test(tf), tf.slice(0, 300));
  }
  const svg = path.join(tmp, 'sheet.svg');
  await setPaths({ __savePath: svg });
  await menu('menu-export-svg');
  await sleep(500);
  check('SVG export contains the title block group', existsSync(svg) && readFileSync(svg, 'utf8').includes('<g id="title-block">'));

  // =====================================================================
  console.log('\nH. Save / reopen (current file format)');
  const proj = path.join(tmp, 'bracket.a3d');
  await setPaths({ __savePath: proj, __openPath: proj });
  await menu('menu-save-as');
  await sleep(500);
  const saved = JSON.parse(readFileSync(proj, 'utf8'));
  check('saved in the current format (5)', saved.formatVersion === 5, JSON.stringify(Object.keys(saved)));
  const doc = saved.document ?? saved.doc ?? saved;
  check('… with arcs, the new constraints and the title block', doc.shapes.some((x) => x.kind === 'arc') && doc.constraints.some((c) => c.kind === 'angle') && doc.constraints.some((c) => c.kind === 'fixed-radius') && doc.titleBlock?.title === 'Mounting bracket');
  const beforeOpen = await st();
  await menu('menu-new');
  await sleep(300);
  await menu('menu-open');
  await sleep(500);
  const after = await st();
  check('reopening restores the same shapes, constraints and title block', same(after.doc.shapes, beforeOpen.doc.shapes) && same(after.doc.constraints, beforeOpen.doc.constraints) && same(after.doc.titleBlock, beforeOpen.doc.titleBlock), [after.doc.shapes.length, beforeOpen.doc.shapes.length, JSON.stringify(canon(after.doc.titleBlock)), JSON.stringify(canon(beforeOpen.doc.titleBlock))].join(' '));

  // =====================================================================
  console.log('\nI. Updates');
  await menu('menu-check-updates');
  await sleep(300);
  check('File ▸ Check for updates explains that the development build does not update', /only available in the installed app/.test(await message()), await message());
  check('no update notice is shown', (await win.locator('[data-testid=update-banner]').count()) === 0);

  await win.screenshot({ path: path.join(OUT, 'm5-final.png') });
  check('no renderer errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  failures++;
  console.log(`  FAIL  script error: ${String(e?.message ?? e).split('\n').join(' | ')}`);
} finally {
  await app.close().catch(() => {});
  await server.close();
}
console.log(`\nM5 E2E result: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
