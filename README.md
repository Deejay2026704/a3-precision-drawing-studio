# A3 Precision Drawing Studio

A Windows desktop application for precise 2D drawing and editing on an A3 sheet.
It is a precision drawing tool (CAD-style), **not** a publishing application.

Current state: **Milestone 4** — Windows and macOS installers, true-scale PDF export
and autosave with crash recovery, on top of Milestones 1–3 (drawing, editing, snaps,
dimensions, constraints, layers, robust project files). See `DEVELOPMENT_STATUS.md`.

## Installing (end users)

Installers are produced by GitHub Actions on every push (workflow **Test and build
installers**): open the run, download **windows-installers** or **macos-installers**.
For a `v*` tag they are also attached to a GitHub Release.

* **Windows 10/11:** run `A3-Precision-Drawing-Studio-Setup-<version>-x64.exe`
  (`-arm64` for ARM PCs). The wizard lets you choose the folder and installs for the
  current user (no admin needed) with Start-menu and desktop shortcuts; `.a3d` files
  open in the app. The installer is **not code-signed** yet, so SmartScreen shows
  "Windows protected your PC" → *More info* → *Run anyway*. Uninstall from Settings ▸ Apps.
* **macOS 11+:** open `A3-Precision-Drawing-Studio-<version>-arm64.dmg` (Apple Silicon)
  or `-x64.dmg` (Intel) and drag the app to Applications. It is ad-hoc signed but **not
  notarised**, so the first time: right-click the app ▸ *Open* ▸ *Open* (or System
  Settings ▸ Privacy & Security ▸ *Open Anyway*).

Signing/notarisation is enabled automatically when certificates are provided as CI
secrets (see `electron-builder.config.cjs`).

---

## Quick start

Requirements: Node.js 20+ (developed on Node 22) and npm, on Windows 10/11
(Linux and macOS also work for development).

```bash
npm install
npm run dev        # launch the desktop app in development mode (Vite + Electron)
npm test           # run the automated geometry/model/storage tests (Vitest)
npm run typecheck  # TypeScript type check
npm run build      # production build of renderer (dist/) and main process (dist-electron/)
npm start          # launch the production build
npm run dist:win   # Windows NSIS installer (run on Windows)  → release/
npm run dist:mac   # macOS DMG + ZIP (run on a Mac)           → release/
npm run dist:dir   # unpacked app for the current OS (testing)
npm run e2e:packaged -- "<app executable>"   # smoke-test an installed/packaged app
npm run e2e        # all end-to-end suites (M1–M4) driving the real Electron window (needs `playwright`)
```

Screenshots taken from the real app during verification are in `docs/screenshots/`.

On Linux when running as root (e.g. in a container) Electron needs
`npm run dev -- --no-sandbox`. This is not needed on Windows.

---

## Using the application

| Action | How |
| --- | --- |
| Select tool | Home ▸ Select, or `V` / `Esc` |
| Line / Rectangle / Circle / Freehand | Draw ribbon, or `L` / `R` / `C` / `F` |
| Draw | press, drag, release on the sheet. `Shift` = 15° angle steps for lines, square for rectangles |
| Select multiple | `Shift`/`Ctrl` + click, or drag a selection window over empty space |
| Move | drag a selected object; arrow keys nudge 1 mm (`Shift` = 10 mm) |
| Resize | drag the square handles (multi-selection scales proportionally) |
| Rotate | drag the round handle above the selection (`Shift` = 15° steps) |
| Delete / Duplicate | `Delete`, `Ctrl+D` (also on the Home ribbon) |
| Undo / Redo | `Ctrl+Z`, `Ctrl+Y` |
| Exact values | type into the Properties panel, press `Enter` (or Tab away). `Esc` reverts |
| Zoom | mouse wheel (about cursor), View ribbon, zoom box in the status bar |
| Pan | middle mouse drag, or hold `Space` and drag |
| Fit page / 100 % | View ▸ Fit Page, View ▸ 100 % (100 % = true paper size at 96 dpi) |
| Drawing scale | Home ▸ Drawing Scale (1:1 … 1:100, or Custom…, e.g. `1:25`, `2:1`) |
| Files | File ▸ New / Open / Save / Save As (`*.a3d`, JSON) |
| Click-click drawing | click once for the first point, move, click again (drag still works). Esc cancels |
| Draw by numbers | with Line / Rectangle / Circle active, type values in Properties ▸ "by numbers" and press **Create** |
| Object snaps | Draw ▸ Snap: Endpoint, Midpoint, Centre, Intersection, Perpendicular, Tangent, Nearest (each toggleable). `F3` or **OSNAP** in the status bar toggles all |
| Grid snap / grid | `F9` or **GRID** in the status bar; increment on Draw ▸ Snap ▸ Step. Grid spacing on View ▸ Show |
| Trim / Extend | `T` / `E`, then click the part of a line to remove / near the end to extend |
| Offset | `O`, set the distance on Draw ▸ Modify, click an object, then the side |
| Mirror | `M`; with objects selected (or Shift+click them in the tool) click two points on the mirror line. "Mirror keeps source" = copy |
| Grips | select an object: filled squares are grips — line ends, polyline ends, centre/midpoint (move). Grips snap |
| Dimensions | Annotate tab: Aligned (`D`), Horizontal, Vertical (3 clicks: point, point, placement), Angular (line, line, placement), Radius / Diameter (click a circle) |
| Layers | Layers panel (top right): **+** new, ✎ rename (or double-click a name), ▲▼ reorder, 🗑 delete; per layer 👁 show/hide, 🔒 lock, colour. Click a row to make it the **active layer** for new objects |
| Move objects to a layer | select them, Properties ▸ **Layer** |
| Driving constraints | **Constrain** tab. Select a line (Horizontal, Vertical, Fixed length, Fixed angle), two lines (Parallel, Perpendicular, Equal length) or a line + circle / two circles (Tangent); or use the Coincident / Fix Position tools and click points. Disabled buttons say what to select |
| Edit a constraint | click its purple marker: Properties shows status, value (fixed length/angle/position), Suppress, Delete |
| Export PDF | File ▸ Export PDF… (`Ctrl+P`): vector PDF, A3 at true scale, visible layers only (each a PDF layer). Print at **100 % / Actual size** |
| Export SVG | File ▸ Export SVG… (visible layers only, true scale in mm) |
| Autosave | on by default, every 2 minutes while there are unsaved changes; File ▸ *Autosave: On/Off*; status bar shows the last autosave |
| Crash recovery | after a crash, the next start offers **Recover / Keep for later / Discard**. A recovered drawing opens *unsaved*; the first Save asks before writing over the original |
| Edit a dimension | click its text/line: Properties shows the measured value (read-only, *driven*), precision, text height, arrowheads, extension lines, offset, text shift. Drag it or its grips to reposition |

---

## Technical architecture

Electron (main process) hosts a React + TypeScript renderer built by Vite.
Everything that matters for precision lives in plain, UI-free TypeScript
modules that are unit-tested with Vitest.

```
 ┌─────────────────────────── Renderer (React) ───────────────────────────┐
 │  ui/            components: Ribbon, FileMenu, PropertiesPanel,          │
 │                 DrawingCanvas (pointer interaction), StatusBar           │
 │  ui/state/      editorReducer – single store for document + selection,   │
 │                 undo/redo history (pure, tested)                        │
 │  render/        SVG rendering of shapes, page, grid, rulers, handles    │
 │                 (read-only: never mutates geometry)                     │
 │  model/         drawing model: shape types, document, editing           │
 │                 operations, hit testing, selection handles (pure)       │
 │  geometry/      vectors, angles, bounds, A3 page, drawing scale,        │
 │                 world ↔ page ↔ screen conversions (pure)                │
 │  storage/       document (de)serialisation + validation (pure) and a     │
 │                 file-service adapter (Electron IPC or browser fallback) │
 └──────────────────────────────────▲──────────────────────────────────────┘
                                    │ contextBridge (preload.ts): open/save/dirty/quit
 ┌──────────────────────────────────┴──────────────────────────────────────┐
 │  electron/main.ts  window, native file dialogs, unsaved-changes prompt  │
 └─────────────────────────────────────────────────────────────────────────┘
```

Dependency direction is strictly downward: `ui → render → model → geometry`,
`storage → model`. `geometry/` and `model/` import nothing from React,
the DOM or Electron.

**Single source of truth.** The `DrawingDocument` held in the editor store is the only
place geometry exists. Shapes store real-world millimetres. Rendering converts
geometry to screen pixels on every frame; pointer input is converted from screen
pixels back to world millimetres *once* at the input boundary, after which all
editing is done in world units. Dimensions are never measured from the screen.

### Coordinate systems

| System | Unit | Origin | Axes | Used for |
| --- | --- | --- | --- | --- |
| **Drawing (world)** | real-world mm | bottom-left corner of the sheet | +X right, +Y **up** | all stored geometry, Properties panel, rulers, status bar |
| **Page (paper)** | paper mm | bottom-left corner of the sheet | +X right, +Y **up** | the A3 sheet, 420 × 297 mm; line weights |
| **Screen** | CSS pixels | top-left of the canvas element | +X right, +Y **down** | SVG output, pointer events only |

Conversions (`src/geometry/scale.ts`, `src/geometry/viewport.ts`, `src/geometry/coords.ts`):

* `page = world × (paper / real)` — e.g. at 1:50 a 5000 mm wall is 100 mm on paper.
* `screen.x = origin.x + page.x × k`, `screen.y = origin.y − page.y × k`
  where `k = zoom × 96 / 25.4` px per paper mm and `origin` is the screen position of
  the sheet's bottom-left corner. One uniform `k` for both axes keeps the page
  proportions exact at every zoom level.
* Angles are degrees, counter-clockwise positive, measured from +X (the usual
  mathematical convention in a Y-up system).

Changing the drawing scale changes only the world→page factor. Shape geometry is
never modified by a scale change (covered by tests).

### Milestone 2 modules

| Module | Responsibility |
| --- | --- |
| `geometry/intersect.ts` | line/segment/circle intersections, perpendicular feet, tangent points, nearest points, reflection; parallel / tangent / degenerate cases handled explicitly |
| `model/anchors.ts` | named points on shapes (`start`, `end`, `mid`, `c0..c3`, `m0..m3`, `center`, `v<i>`, `sm<i>`) and decomposition into primitives |
| `model/snap.ts` | `findSnap()`: exact candidate points from geometry; only the pick radius comes from the screen (10 px → drawing mm via zoom **and** drawing scale) |
| `model/dimensions.ts` | driven, associative dimensions: measure, layout, hit-test, grips, creation, copy/retarget |
| `model/modify.ts` | trim, extend, offset, mirror — each returns a complete new document or a refusal with a reason |
| `ui/interaction/toolSession.ts` | click-driven tool state machine (pure, unit-tested); the canvas only feeds it snapped clicks |

**Driven vs constraint dimensions.** Every dimension has `mode: 'driven'`: its value is
*measured* from the geometry it is linked to and cannot be typed. A future user-entered
constraint that drives geometry would be a different `mode`, rendered and labelled
differently. Dimension definition points are links (`{shapeId, key}`), so values update
when geometry is moved, resized, trimmed or edited. Deleting geometry deletes the
dimensions linked to it in the same undo step, and the status bar reports how many.

### Milestone 3 modules

| Module | Responsibility |
| --- | --- |
| `model/layers.ts` | layer create/rename/delete (reassign or delete objects)/reorder/visibility/lock/colour, visibility & editability rules, `lockedViolation` safety net |
| `model/constraints.ts` | driving constraints: validation, residuals, damped weighted least-squares solver, status, add/update |
| `storage/documentStorage.ts` | format v3 schema validation with exact error paths, v1→v2→v3 migration, settings, warnings |
| `storage/exportSvg.ts` | SVG export of visible layers |
| `electron/atomicWrite.ts` | atomic saves (temp file + fsync + rename) |
| `ui/LayersPanel.tsx`, `ui/ConstraintProperties.tsx`, `ui/Dialog.tsx` | layer panel, constraint editing, modal Save/Don't save/Cancel dialogs |

**Driving constraints vs reference dimensions.** Constraints (Constrain tab, purple
markers) *control* geometry: the solver moves objects to satisfy them. Dimensions
(Annotate tab) are *reference* (driven) dimensions: they only measure. The UI labels both.

**Constraint solver.** Unknowns are line endpoints and circle centres/radii of constrained
objects. A weighted minimum-change Levenberg–Marquardt step satisfies all active
constraints while moving geometry as little as possible; objects the user just edited are
preferred to stay put, circle radii are held exactly unless only a size change can work,
objects on locked/hidden layers never move, and results that collapse a line or circle are
rejected. If constraints cannot be met the geometry is left unchanged and the unmet
constraints are shown in red. Status is always computed from the actual geometry.

**Store guards.** Every commit passes through the editor store, which (1) refuses any
change to objects on a locked layer, (2) places new objects on the active layer (refused if
it is locked or hidden) and (3) re-applies driving constraints after geometry edits — in
one undo step.

### Milestone 4 modules

| Module | Responsibility |
| --- | --- |
| `storage/drawingPrimitives.ts` | device-independent export primitives (paper mm, Y up, visible layers only) shared by SVG and PDF |
| `storage/exportPdf.ts` | pure-TypeScript PDF 1.7 writer: true scale, Helvetica text, Bézier curves, one PDF layer per drawing layer |
| `storage/autosave.ts` | recovery record format + scheduling rule (pure) |
| `electron/autosaveStore.ts` | recovery files in `<userData>/autosave/` (one per session, atomic), orphan detection |
| `electron-builder.config.cjs`, `build/` | installer configuration, icon, macOS entitlements |
| `.github/workflows/installers.yml` | CI: tests, then build + install + smoke-test on Windows and macOS |
| `tests-e2e/packaged-smoke.mjs` | smoke test for an installed/packaged app (also used in CI) |

**Autosave is separate from the project.** Recovery copies live in the application data
folder (`%APPDATA%\A3 Precision Drawing Studio\autosave` on Windows,
`~/Library/Application Support/A3 Precision Drawing Studio/autosave` on macOS), never next
to or over the user's `.a3d`. They are written atomically, removed after Save, after
*Don't save*/New/Open, and on a normal quit; a crash leaves them for recovery. A recovered
backup is handed to the new session *before* the old copy is deleted, so a copy always exists.

### Drawing objects (all in world mm)

| Kind | Stored geometry |
| --- | --- |
| Line | `start`, `end` |
| Rectangle | `origin` (base corner), `width`, `height`, `rotationDeg` (about `origin`) |
| Circle | `center`, `radius` |
| Freehand polyline | `points[]` |

Each object also has a style: stroke colour and line weight in **paper** mm
(line weights are a property of the printed sheet and do not scale with the drawing).

### Project folder structure

```
electron/            main.ts (window, dialogs, IPC, file association), preload.ts, atomicWrite.ts, autosaveStore.ts
build/               installer resources: icon.svg/png, entitlements.mac.plist
.github/workflows/   installers.yml (CI build, install and smoke test on Windows + macOS)
scripts/             dev.mjs (Vite + Electron dev runner), build-electron.mjs, electron-build.mjs
src/
  geometry/          vec, angles, bounds, page (A3), scale, viewport, coords, intersect
  model/             types, shapes, operations, handles, hitTest, document,
                     anchors, snap, dimensions, modify, layers, constraints
  storage/           documentStorage (schema, migration, validation), drawingPrimitives, exportSvg,
                     exportPdf, autosave, fileService (IPC adapter)
  render/            ShapeView, PageView, GridView, Rulers, SelectionOverlay, rulerTicks
  ui/                App, FileMenu, Ribbon, PropertiesPanel, DrawingCanvas, StatusBar, controls
  ui/state/          editorReducer (store + undo/redo)
  ui/interaction/    toolSession (click-driven modify/dimension tools)
  main.tsx           renderer entry
tests/               Vitest unit tests (no UI, no DOM); tests/fixtures: real M1 (v1) and M2 (v2) files
tests-e2e/           Playwright scripts that drive the real Electron window (M1–M4) + packaged-app smoke test
docs/screenshots/    screenshots captured by the end-to-end run
```

### File format

`*.a3d` — UTF-8 JSON, format version 3:

```
{ format: "a3-precision-drawing", formatVersion: 3, units: "mm",
  page: { widthMm, heightMm, orientation }, scale: { paper, real },
  layers: [{ id, name, visible, locked, color }],
  shapes: [... each with layerId], dimensions: [... each with layerId], constraints: [...],
  settings: { activeLayerId, display: { showGrid, gridSpacingMm, gridSnap, gridSnapStepMm, objectSnap, osnap } } }
```

* **Migration:** v1 (M1) and v2 (M2) files open and are migrated in memory (default layer,
  no constraints, default display settings); the user is told, and saving over an older
  file asks before upgrading it. Files from a newer version are refused.
* **Validation:** every field is checked; errors name the exact path (e.g.
  `shapes[2].radius: must be ≥ 0`). Repairable issues (object on an unknown layer, missing
  display setting, constraint referring to a missing object) are repaired **and listed**.
* **Saving:** atomic (temporary file, flush, rename) — a failed save never damages the
  existing file. An unchanged project saves byte-for-byte identically (canonical key order).
* **Unsaved changes:** "Unsaved changes" badge in the title bar; New/Open ask Save /
  Don't save / Cancel; closing the window asks too. There is no autosave yet.

### Technical risks identified (and mitigations)

| Risk | Mitigation |
| --- | --- |
| Floating-point drift from repeated transforms (e.g. rotate many times) | Interactive drags always transform from the *original* geometry captured at drag start, not incrementally; values displayed rounded to 0.001 mm |
| Y-up model vs Y-down SVG/screen causing sign errors | One conversion module, round-trip tests, no Y flipping anywhere else |
| Screen-derived dimensions creeping into the model | Pointer positions are converted to world mm at a single boundary; numeric entry edits the model directly |
| Rotated rectangles under non-uniform scaling are no longer rectangles | Single rectangles resize in their own local frame; multi-selection scales proportionally only |
| Scale change accidentally rescaling geometry | Scale stored separately; `setScale` only touches `doc.scale` (tested) |
| Electron security (renderer with Node access) | `contextIsolation`, `sandbox`, no `nodeIntegration`; narrow preload API |
| Windows packaging/signing not verifiable in a Linux CI container | Milestone 1 targets `npm run dev`; installer packaging is a later milestone |
| Very thin lines invisible at low zoom | Rendered stroke clamped to ≥ 0.5 px on screen only; stored weight unchanged |
