# Test Plan: Milestone 1

There are three levels of testing:

1. **Unit tests (Vitest)** check the geometry engine, drawing model, storage and editor
   state with no UI, DOM or Electron. This is the main proof of precision.
2. **End-to-end smoke test (Playwright + real Electron)** launches the actual desktop app
   and drives it with mouse and keyboard.
3. **Manual checklist** is for a person on Windows.

## 1. Unit tests: `npm test`

Last result: **11 files, 77 tests, all passing.**

| Requirement area | File | What is verified |
| --- | --- | --- |
| A3 page dimensions | `tests/page.test.ts` | 420 × 297 mm; new documents use A3 landscape; √2 aspect; 100 % zoom = 96/25.4 px/mm; proportions exact at 5 zoom levels; fit-page centres and contains the sheet |
| Coordinate conversion | `tests/coordinates.test.ts` | Page origin maps to the sheet's bottom-left; +Y goes up the screen; screen↔page inverse; world↔page under scale; world→screen→world round trip for 5 scales × 3 zooms; screen length → world length; zoom-about-anchor keeps the point fixed; pan |
| Line length | `tests/line.test.ts` | Horizontal, vertical and 3-4-5 lengths; angle convention (0/90/180/270/45°, CCW); set length keeps start and direction; set angle keeps start and length; negative length rejected |
| Rectangle dimensions | `tests/rectangle.test.ts` | From corners in any order; exact corners, area and bounds; set size keeps the base corner; rotated rectangle keeps W/H; negative sizes rejected |
| Rotation | `tests/rotation.test.ts` | CCW point rotation; angle normalisation; line about its midpoint; rectangle about its centre (size and centre kept); rectangle rotation field about the base corner; 12 × 30° returns to the start (no drift); circle about an external pivot; rotate-handle drag with 15° snap |
| Scale conversion | `tests/scale.test.ts` | Standard list 1:1…1:100; 1000 mm on paper at each standard scale; custom parsing (`1:25`, `1/250`, `2:1`, `75`, invalid inputs); A3 at 1:50 = 21 000 × 14 850 mm; **changing scale leaves geometry identical**; invalid scales rejected |
| Object movement | `tests/movement.test.ts` | Exact delta for all 4 kinds; size kept; inputs not mutated; move bounding box to an exact position; duplicate with new ids and offset; replace/remove keeps painting order |
| Object resizing | `tests/resize.test.ts` | NE handle (opposite corner fixed); edge handle; flip past the opposite side; rotated rectangle resized in its own frame; polyline bounding-box handles; exact polyline size; line endpoint handle; circle radius handle; proportional multi-selection; scale-factor projection; non-uniform axis-aligned rectangle |
| Storage | `tests/storage.test.ts` | Exact round trip; header and units; malformed JSON, wrong format, negative radius, duplicate ids and bad scale all rejected |
| Editor state / undo | `tests/editorReducer.test.ts` | Add selects and marks dirty; a whole drag = one undo step; cancel drag restores; delete and undo; scale change undoable without touching shapes; save clears dirty |
| Rulers | `tests/rulerTicks.test.ts` | 1-2-5 step selection; major ticks on multiples |

## 2. End-to-end smoke test: `npm run e2e`

`tests-e2e/electron-smoke.mjs` starts the Vite dev server, builds the main process and
launches **the real Electron app**. It then works only through mouse and keyboard
input and reads the DOM. Positions are computed from the rendered sheet using page
millimetres, with the origin at the bottom-left and Y pointing up. Native file dialogs
are stubbed in the main process so Save As and Open run unattended.

Headless Linux: `E2E_ELECTRON_ARGS="--no-sandbox --disable-gpu" xvfb-run -a npm run e2e`.
The test needs the `playwright` package, which is resolved from the environment and is
not a project dependency.

Last result: **64 checks passed, 0 failed.** It passed 5 consecutive runs after the
final fixes. Screenshots are in `docs/screenshots/`.

Checks performed:

* **Shell:** window title; title text, File button, 3 ribbon tabs, canvas, properties
  panel, status bar and both rulers are visible.
* **Page:** rendered sheet ratio is 420:297 (±0.2 %); sheet reports 420 × 297 mm; the
  panel shows A3 landscape.
* **Drawing:** a line drawn by drag is 100 mm from (50, 50); a rectangle is 100 × 60
  at (200, 100); a circle has radius 30 at (100, 200); freehand has more than 10
  vertices; there are 4 SVG vector elements.
* **Precision input:**
  * Typing length 120 makes the rendered line exactly 120 page-mm.
  * Angle 90° puts the end directly above the start.
  * Start X changes only the start point.
  * Rectangle X, Y, W and H are applied (80.5 × 40.25).
  * Rotation 30° is rendered at 30° CCW, 80.5 mm long.
  * Invalid input is rejected.
  * One numeric entry adds exactly one undo step.
  * Esc discards the typed value.
* **Editing:**
  * Drag-move by (10, 5) mm is exact.
  * Dragging the NE handle gives 100 × 50 with the base corner fixed.
  * Rotate handle with Shift gives exactly 45° with the size kept.
  * Undo works.
  * Clicking empty space clears the selection.
  * Ctrl+A selects 4 objects; Ctrl+D gives 8; Delete gives 4.
  * Shift+click multi-select works.
  * The selection window selects only enclosed objects.
  * Multi-selection X entry moves the group, and undo restores it.
* **Scale:**
  * At 1:50 the geometry stays 120 mm, the on-paper value shows 2.4 mm, and the
    rendered line is 1/50 of its length.
  * Custom 1:25 is applied with the geometry unchanged.
* **Zoom:**
  * Zoom in enlarges the sheet with proportions kept.
  * 100 % = 1587.4 px for 420 mm.
  * Fit page restores the view.
  * Mouse-wheel zoom keeps proportions.
* **Files:**
  * Save As writes `.a3d` JSON in mm with exact geometry.
  * The title shows the file name.
  * New clears the drawing; Open restores 4 objects.
  * No renderer console errors.

### Additional one-off checks performed

* `npm run dev` starts Vite and Electron and the window stays up.
* `npm run build` (typecheck + Vite + esbuild) succeeds.
* The production build (`npm start` / `file://`) loads with the strict CSP, has no
  console errors, draws a 100 × 50 mm rectangle correctly, and does not expose the
  dev-only debug hook.
* Exit with unsaved changes shows the native prompt. "Cancel" keeps the window open
  and "Close without saving" closes the app.
* `npm run typecheck` passes for both renderer and Electron code.

## 3. Manual checklist (Windows)

Run `npm install` and then `npm run dev`, and check each item:

- [ ] Window opens titled "Untitled.a3d – A3 Precision Drawing Studio" with File, Home, Draw and View
- [ ] The sheet is white on grey with rulers; the bottom-left corner reads X 0, Y 0 in the status bar
- [ ] At View ▸ 100 % a physical ruler held to the screen measures ~420 mm across the sheet (only exact on a 96 dpi / 100 % display-scaling monitor)
- [ ] Draw one object of each kind; each is selected after drawing and shows exact values
- [ ] Type values in every Properties field; Enter applies, Esc reverts, letters are rejected
- [ ] Move, resize (all 8 handles) and rotate (handle, Shift = 15°); Ctrl+Z / Ctrl+Y
- [ ] Ctrl+A, Ctrl+D, Delete, arrow-key nudge (1 mm, Shift 10 mm)
- [ ] Change scale to 1:50 and back: object values are unchanged and the on-paper hint updates
- [ ] Save, close the app, reopen, and Open the file: identical drawing
- [ ] Close with unsaved changes: a prompt appears
