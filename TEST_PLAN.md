# Test Plan: Milestones 1, 2 and 3

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

### Milestone 2 unit tests (added)

Last full result: **19 files, 176 tests, all passing** (77 M1 + 99 M2).

| Area | File | What is verified |
| --- | --- | --- |
| Intersections | `tests/intersect.test.ts` | crossing / **parallel / collinear** / non-intersecting / **zero-length** segments; line–circle secant, tangent, miss; circle–circle two points, tangent, separate, concentric; perpendicular feet; tangent points are truly tangent; mirror reflection |
| Snap calculations | `tests/snap.test.ts` | each of the 7 object snaps gives the exact point; endpoint snap returns a link anchor; parallel / non-intersecting give no intersection; perpendicular/tangent need a base point; priority tiers; individual toggles; excluded shapes; zero-length geometry; grid fallback; **bit-exact snap at 5 zoom/scale combinations and no capture outside the aperture** |
| Grid | `tests/grid.test.ts` | configured spacing; automatic coarsening; grid snap rounding |
| Dimension values | `tests/dimensions.test.ts` | aligned / horizontal / vertical / radius / diameter / angular (both sides, lines meeting when extended); refusals (parallel, same line, coincident points, non-circle); formatting/precision/symbols; **associativity after move, length change, rotation, radius change, rectangle resize**; missing geometry → no value; dependent delete; duplicate re-links; layout geometry; paper-sized text at 1:50; extension lines toggle; grips; hit testing |
| Trim / extend / offset / mirror | `tests/modify.test.ts` | trim end, start, middle (split, linked dimension follows), against circles; **refusals for non-crossing / parallel / unsupported / zero-length**; extend both ends, nearest boundary incl. circles, refusals; offset of lines (both sides), circles (in/out/too large), rotated rectangles (in/out/too large), mitred polylines, invalid distances/sides; exact mirror of all shapes incl. rotated rectangles; copy vs replace; zero-length axis; empty selection |
| Grips | `tests/grips.test.ts` | every shape has endpoint/centre grips; centre grip snaps exactly; move grips; polyline end grips; **identical grip result at 4 zoom levels** |
| Undo / redo | `tests/undoRedo.test.ts` | one undo step + exact undo/redo for trim (end, split), extend, offset, mirror (copy, replace), add dimension, dimension grip/style; delete with dependents; long mixed sequence fully undone and redone; refused op leaves history untouched |
| Tool workflows | `tests/toolSession.test.ts` | click sequences with real snapping for every M2 tool; linked vs fixed anchors; wrong picks refused; previews never modify the document |
| Storage | `tests/storage.test.ts` | version 2 round trip of all dimension kinds; **version 1 files still open**; malformed dimensions rejected |

### Milestone 3 unit tests (added)

Last full result: **24 files, 243 tests, all passing**.

| Area | File | What is verified |
| --- | --- | --- |
| Constraints | `tests/constraints.test.ts` | every type solved exactly; minimum change; a closed rectangle system (11 constraints); conflicts refused with geometry untouched (H+V collapse, angle vs horizontal, two pins); duplicates, wrong kinds, same object twice, zero-length, zero value refused; redundant-consistent accepted; locked geometry never moved; status from geometry (unsatisfied after edit, broken when geometry missing); suppress/unsuppress; value edits; preferred objects stay put; radii held exactly unless required; untouched objects not re-created |
| Layers | `tests/layers.test.ts` | create/rename (unique, non-empty), reorder & paint order, assign incl. dimensions, "By layer" colour; hidden ⇒ not visible/editable; locked ⇒ visible not editable; default layer for legacy objects; `lockedViolation` blocks change/delete/re-layer; assign to/from locked refused; safe delete (empty, last layer, refuse non-empty, reassign, delete objects + dependents) |
| Store guards | `tests/editorM3.test.ts` | locked objects not selectable, not changeable by update/commit/drag; unlock; lock/hide drops selection; active layer; drawing on locked/hidden layer refused; constraints applied on edits and during drags (one undo step); dependent constraints deleted; settings saved/restored; dirty flag; migrated-file source version |
| Files | `tests/storage.test.ts` | v3 round trip of everything incl. settings; byte-identical re-save; **real v1 and v2 fixture files** migrate with geometry and linked dimension values intact; migrated re-save; empty / truncated / non-JSON / other format / newer version / bad units; exact error paths; structural errors; repaired-and-reported issues |
| Export | `tests/exportSvg.test.ts` | **hidden layers excluded**, locked layers included with layer colour, A3 size in mm and scale/Y-flip, dimension text, no constraint markers, all-hidden ⇒ empty |
| Atomic save | `tests/atomicWrite.test.ts` | create/replace; a failed save leaves the original untouched with no temp file; missing folder |
| Tools | `tests/toolSession.test.ts` | coincident and fixed-position point tools; modify tools refuse non-editable objects |

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

### Milestone 2 end-to-end suite: `tests-e2e/milestone2.mjs`

Last result: **62 checks passed, 0 failed** — 3 consecutive runs, together with the
unchanged Milestone 1 suite (64/64) each time. Screenshots `docs/screenshots/m2-*.png`.

* **Numeric creation:** line (start, length, angle incl. 30°), circle by diameter, rectangle; radius 0 refused.
* **Snapping (grid snap off, so results can only come from object snaps):** centre, endpoint,
  midpoint, perpendicular, tangent markers appear and give **exact** coordinates
  (e.g. 250.25, 120.75); live L/∠ feedback while drawing; click-click drawing; turning
  the Centre snap off stops centre snapping; **snap still exact after zooming > 400 %**.
* **Tool switching:** a click immediately after a tool shortcut is handled by the new tool.
* **Dimensions:** aligned dimension linked to line endpoints; reads 120.00 → 135.50 after
  editing the line, unchanged after nudging; select by clicking its text; "Driven" badge;
  read-only value; precision 3 → 135.500; text height 5 mm renders at 5 paper-mm;
  numeric offset; arrowhead + extension-line settings; R25.00, ⌀50.00, 30.00°; same line
  twice refused with a message.
* **Modify:** trim preview shown; trim exact to the crossing (x = 80); undo/redo; empty pick
  refused without changing history; extend exactly to a rectangle edge (x = 300); offset
  exactly 15 mm; Shift+click selection inside Mirror; mirrored circle at (149.75, 120.75).
* **Grips:** centre grip snaps a circle exactly onto a line endpoint; its radius dimension
  follows; undo.
* **Delete:** deleting a circle removes its 2 dimensions with a message; undo restores all.
* **Keyboard/UI:** letters, Delete, Ctrl+Z typed in a field don't affect tools/drawing; `T`
  activates Trim outside fields; status bar + ribbon show the active tool; tooltips; F3.
* **Files:** saved as version 2 with all dimensions; reopened with identical counts and
  the linked dimension still measuring the edited line.
* No renderer console errors.

### Milestone 3 end-to-end suite: `tests-e2e/milestone3.mjs`

Last result: **78 checks passed, 0 failed** — 3 consecutive runs, together with the M1
(64/64) and M2 (62/62) suites each time. Screenshots `docs/screenshots/m3-*.png`.

* **Layout:** the canvas never overlaps the sidebar after visiting every ribbon tab.
* **Layers:** create, rename, active layer receives new objects, layer colour drives "By
  layer" objects, hide (not drawn, not selectable by Select All), lock (not clickable,
  excluded from Select All, drawing on it refused, trim cannot change it; works after
  unlocking), move objects via Properties, reorder, delete with dialog (Cancel / move
  objects / delete objects) and undo, **SVG export excludes the hidden layer**.
* **Constraints:** buttons disabled with reasons; Horizontal, Parallel, Fixed length
  (marker with value, select marker, labelled *Driving*, edit to 150 mm exactly, suppress/
  unsuppress), conflicting Fixed angle value refused with geometry and value unchanged,
  Coincident and Fixed position tools, an edit breaking a constraint is corrected with a
  message, grip drag keeps constraints and the pinned point, Tangent exact with radius
  unchanged, delete constraint + undo, dimensions labelled *Reference*.
* **Files:** unsaved badge; Save As writes v3 with layers (name/lock/colour), constraints,
  dimensions, orientation and display preferences; New on a modified drawing asks
  (Cancel keeps it, Don't save clears); reopen restores everything incl. preferences and
  active layer, unmodified, constraints satisfied; re-save byte-identical; a **Milestone 1
  file** opens with an upgrade notice, Save asks before upgrading (Cancel leaves the file
  byte-identical; Upgrade writes v3); malformed (exact path in the error), newer-version
  and truncated files are refused with the open drawing untouched and the bad file
  unmodified; no console errors.

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
- [ ] (M2) Hover near ends/midpoints/centres/crossings: the orange snap marker names the snap; F3/F9 toggle
- [ ] (M2) Draw a line by clicking two points; draw one "by numbers"
- [ ] (M2) Dimension a line, then change the line length: the dimension updates
- [ ] (M2) Trim, extend, offset and mirror; Ctrl+Z / Ctrl+Y after each
- [ ] (M3) Create layers, hide/lock them; locked objects cannot be clicked; delete a layer with objects (both options)
- [ ] (M3) Constrain two lines parallel, then drag one: the other follows; try a conflicting value: refused
- [ ] (M3) Open a Milestone 1/2 file: upgrade notice; Save asks before upgrading
- [ ] (M3) Export SVG and open it in a browser: hidden layers absent, true size in mm
