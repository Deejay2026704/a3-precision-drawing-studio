// Milestone 6 end-to-end test (development build): Polyline and Polygon tools, trimming
// polylines, fill and hatch, text notes, fillet with circles, US Letter printing and
// file format 5 – all driven through the REAL Electron window.
//
// Usage: npm run e2e:m6   (headless Linux: E2E_ELECTRON_ARGS=--no-sandbox xvfb-run -a npm run e2e:m6)
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
const tmp = mkdtempSync(path.join(os.tmpdir(), 'a3-m6-'));

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
  const TAB = { select: 'home', text: 'annotate' };
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
  console.log('\nA. Ribbon');
  const layout = [];
  for (const t of ['home', 'draw', 'annotate', 'constrain', 'view']) {
    await win.click(`[data-testid=tab-${t}]`);
    await win.waitForTimeout(80);
    layout.push(await win.evaluate(() => [document.querySelector('.ribbon').getBoundingClientRect().height, document.querySelector('[data-testid=canvas]').getBoundingClientRect().y]));
  }
  check('the drawing area does not move between ribbon tabs', layout.every((l) => l[0] === layout[0][0] && l[1] === layout[0][1]), JSON.stringify(layout));
  await win.click('[data-testid=tab-draw]');
  check('Draw has Polyline and Polygon; Annotate has Text', (await win.locator('[data-testid=tool-polyline]').count()) === 1 && (await win.locator('[data-testid=tool-polygon]').count()) === 1);
  await win.click('[data-testid=tab-home]');
  await measure();

  // =====================================================================
  console.log('\nB. Polyline tool');
  await tool('polyline');
  for (const [x, y] of [[40, 200], [80, 200], [80, 240], [99, 260]]) await click(P(x, y));
  await win.keyboard.press('Backspace');
  check('Backspace removes the last clicked point (not the selection)', (await st()).doc.shapes.length === 0);
  await win.keyboard.press('Enter');
  let s = await st();
  const PL = s.doc.shapes[s.doc.shapes.length - 1];
  check('Enter finishes an open polyline with exactly the clicked points', PL?.kind === 'polyline' && !PL.closed && JSON.stringify(PL.points) === JSON.stringify([{ x: 40, y: 200 }, { x: 80, y: 200 }, { x: 80, y: 240 }]), JSON.stringify(PL));
  await tool('polyline');
  for (const [x, y] of [[120, 200], [160, 200], [160, 240], [120, 240]]) await click(P(x, y));
  await click(P(120.3, 200.2)); // back on the first point
  const SQ = await lastShape();
  check('clicking the first point again closes it', SQ.kind === 'polyline' && SQ.closed === true && SQ.points.length === 4, JSON.stringify(SQ));
  await tool('polyline');
  await click(P(40, 150));
  await win.mouse.dblclick(P(70, 150).x, P(70, 150).y);
  const DC = await lastShape();
  check('a double-click finishes the polyline', DC.kind === 'polyline' && DC.points.length === 2 && DC.points[1].x === 70, JSON.stringify(DC));
  await escape();
  await select(P(140, 240));
  check('Properties shows a closed polyline’s perimeter and area', ((await win.textContent('[data-testid=prop-area]')) ?? '').includes('1600') && ((await win.textContent('[data-testid=prop-path-length]')) ?? '').includes('160'));

  // =====================================================================
  console.log('\nC. Polygon tool');
  await tool('polygon');
  await setVal('new-sides', 6);
  await setVal('new-x', 250);
  await setVal('new-y', 200);
  await setVal('new-radius', 20);
  await win.click('[data-testid=create-shape]');
  const HEX = await lastShape();
  check('polygon by numbers: 6 corners exactly 20 mm from the centre', HEX.kind === 'polyline' && HEX.closed && HEX.points.length === 6 && HEX.points.every((p) => near(Math.hypot(p.x - 250, p.y - 200), 20, 1e-9)));
  await tool('polygon');
  await click(P(320, 200));
  await click(P(320, 220));
  const PENT = await lastShape();
  check('polygon by clicking centre and a corner (6 sides – the setting is kept)', PENT.points.length === 6 && near(PENT.points[0].x, 320, 1e-9) && near(PENT.points[0].y, 220, 1e-9));

  // =====================================================================
  console.log('\nD. Fill and hatch');
  await select(P(140, 240));
  check('closed shapes offer a Fill section; open ones do not', (await win.locator('[data-testid=fill-panel]').count()) === 1);
  await win.selectOption('[data-testid=prop-fill]', 'hatch');
  check('hatch is applied and drawn', (await shapeById(SQ.id)).style.fill?.pattern === 'hatch' && (await win.locator(`[data-fill-of="${SQ.id}"] .hatch line`).count()) > 5);
  await setVal('prop-hatch-spacing', 5);
  await setVal('prop-hatch-angle', 0);
  const lines = await win.locator(`[data-fill-of="${SQ.id}"] .hatch line`).count();
  check('hatch spacing 5 mm, angle 0° over a 40 mm square → 8 lines', lines === 8, String(lines));
  await win.selectOption('[data-testid=prop-fill]', 'solid');
  check('solid fill', (await shapeById(SQ.id)).style.fill?.pattern === 'solid');
  await escape();
  await select(P(140, 220)); // inside, away from the outline
  check('a filled shape is selected by clicking inside it', JSON.stringify((await st()).selection) === JSON.stringify([SQ.id]));
  await escape();
  await select(P(80, 230));
  check('an open polyline has no Fill section', (await win.locator('[data-testid=fill-panel]').count()) === 0);

  // =====================================================================
  console.log('\nE. Text');
  await tool('text');
  await setVal('text-height', 5);
  await click(P(40, 100));
  const T = await lastShape();
  check('one click places text at the snapped point', T.kind === 'text' && T.position.x === 40 && T.position.y === 100 && near(T.height, 5));
  check('… and the text box is ready for typing', await win.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'prop-text'));
  await win.keyboard.type('Bracket');
  await win.keyboard.press('Enter');
  await win.keyboard.type('2 off – Ø 6');
  await win.keyboard.press('Control+Enter');
  check('typed multi-line text is applied', (await shapeById(T.id)).text === 'Bracket\n2 off – Ø 6', JSON.stringify((await shapeById(T.id)).text));
  check('both lines are drawn on the canvas', (await win.locator(`[data-shape-id="${T.id}"] tspan`).count()) === 2);
  await setVal('prop-rotation', 30);
  check('rotation is applied', (await shapeById(T.id)).rotationDeg === 30);
  await win.click('[data-testid=tab-home]');
  await win.click('[data-testid=cmd-undo]');
  check('undo', (await shapeById(T.id)).rotationDeg === 0);
  await escape();

  // =====================================================================
  console.log('\nF. Trimming a polyline');
  await create('line', { 'new-x': 60, 'new-y': 190, 'new-length': 20, 'new-angle': 90 });
  await tool('trim');
  await win.mouse.move(P(50, 200).x, P(50, 200).y);
  await win.waitForTimeout(80);
  check('the piece to remove is previewed', (await win.locator('[data-testid=trim-preview]').count()) > 0);
  await click(P(50, 200));
  const PLt = await shapeById(PL.id);
  check('trimmed polyline now starts exactly at the cutting line (60, 200)', PLt.points[0].x === 60 && PLt.points[0].y === 200 && PLt.points.length === 3, JSON.stringify(PLt.points));

  // =====================================================================
  console.log('\nG. Fillet between a line and a circle');
  const L = await create('line', { 'new-x': 250, 'new-y': 40, 'new-length': 100, 'new-angle': 0 });
  await create('circle', { 'new-x': 300, 'new-y': 60, 'new-diameter': 20 });
  await tool('fillet');
  await setVal('fillet-radius', 8);
  await click(P(330, 40));
  await click(P(310, 60));
  const F = await lastShape();
  check('fillet R8 between the line and the circle', F.kind === 'arc' && near(F.radius, 8, 1e-12) && near(F.center.y, 48, 1e-9) && near(Math.hypot(F.center.x - 300, F.center.y - 60), 18, 1e-9), JSON.stringify(F));
  check('… the line is trimmed to the tangent point', near((await shapeById(L.id)).start.x, F.center.x, 1e-9));

  // =====================================================================
  console.log('\nH. US Letter PDF and SVG');
  const letter = path.join(tmp, 'letter.pdf');
  await setPaths({ __savePath: letter });
  await menu('menu-export-pdf-a4');
  await win.selectOption('[data-testid=dialog-choice]', 'letter-tiled');
  await win.click('[data-testid=dialog-export]');
  await sleep(700);
  check('Letter tiled: 4 pages', existsSync(letter) && pdfPages(letter) === 4);
  if (poppler) {
    const info = execFileSync('pdfinfo', [letter], { encoding: 'utf8' });
    check('poppler: US Letter landscape pages', /Page size:\s+792 x 612 pts \(letter\)/.test(info), info);
    const a3 = path.join(tmp, 'a3.pdf');
    await setPaths({ __savePath: a3 });
    await win.keyboard.press('Control+p');
    await sleep(700);
    const txt = execFileSync('pdftotext', [a3, '-'], { encoding: 'utf8' });
    check('poppler: the text note is in the A3 PDF as real text', txt.includes('Bracket') && txt.includes('2 off – Ø 6'), txt.slice(0, 200));
  }
  const svg = path.join(tmp, 'm6.svg');
  await setPaths({ __savePath: svg });
  await menu('menu-export-svg');
  await sleep(500);
  const svgText = readFileSync(svg, 'utf8');
  check('SVG: solid fill, closed polygon and text', svgText.includes('<polygon fill=') && svgText.includes('>Bracket</text>'));

  // =====================================================================
  console.log('\nI. Save / reopen (format 5)');
  const proj = path.join(tmp, 'm6.a3d');
  await setPaths({ __savePath: proj, __openPath: proj });
  await menu('menu-save-as');
  await sleep(500);
  const saved = JSON.parse(readFileSync(proj, 'utf8'));
  check('saved as format 5 with text, fill and closed polylines', saved.formatVersion === 5 && saved.shapes.some((x) => x.kind === 'text') && saved.shapes.some((x) => x.style.fill) && saved.shapes.some((x) => x.closed === true));
  const before = await st();
  await menu('menu-new');
  await sleep(300);
  await menu('menu-open');
  await sleep(500);
  check('reopened identically', same((await st()).doc.shapes, before.doc.shapes));

  await win.click('[data-testid=tab-view]');
  await win.click('[data-testid=cmd-fit-page]');
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, 'm6-final.png') });
  check('no renderer errors', errors.length === 0, errors.join(' | '));
} catch (e) {
  failures++;
  console.log(`  FAIL  script error: ${String(e?.message ?? e).split('\n').join(' | ')}`);
} finally {
  await app.close().catch(() => {});
  await server.close();
}
console.log(`\nM6 E2E result: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
