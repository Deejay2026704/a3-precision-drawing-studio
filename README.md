# A3 Precision Drawing Studio

A Windows desktop application for precise 2D drawing and editing on an A3 sheet.
It is a precision drawing tool (CAD-style), **not** a publishing application.

Current state: **Milestone 1** (application shell, A3 page, basic drawing objects,
object editing, exact numeric input, drawing scale). See `DEVELOPMENT_STATUS.md`.

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
npm run e2e        # end-to-end test that drives the real Electron window (needs `playwright`)
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
electron/            main.ts (window, dialogs, IPC), preload.ts (contextBridge API)
scripts/             dev.mjs (Vite + Electron dev runner), build-electron.mjs, electron-build.mjs
src/
  geometry/          vec, angles, bounds, page (A3), scale, viewport, coords
  model/             types, shapes, operations, handles, hitTest, document
  storage/           documentStorage (serialise/validate), fileService (IPC adapter)
  render/            ShapeView, PageView, GridView, Rulers, SelectionOverlay, rulerTicks
  ui/                App, FileMenu, Ribbon, PropertiesPanel, DrawingCanvas, StatusBar, controls
  ui/state/          editorReducer (store + undo/redo)
  main.tsx           renderer entry
tests/               Vitest unit tests (no UI, no DOM)
tests-e2e/           Playwright script that drives the real Electron window
docs/screenshots/    screenshots captured by the end-to-end run
```

### File format

`*.a3d` — UTF-8 JSON: `{ format: "a3-precision-drawing", formatVersion: 1, page, scale, shapes }`.
Loading validates every field and rejects malformed files with a clear message.

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
