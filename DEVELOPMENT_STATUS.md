# Development Status

**Milestone 1: complete.** Verified on 26 Nov 2026. The verification is described
in `TEST_PLAN.md`. Advanced CAD features have not been started.

## Environment used

| Item | Version |
| --- | --- |
| Node.js / npm | 22.23 / 10.9 |
| Electron | 45.5 |
| React | 19.3 |
| Vite / Vitest | 8.3 / 5.1 |
| TypeScript | 7.0 |
| Verification host | Ubuntu 24.04 container, Xvfb virtual display (see "Not verified" below) |

## Requirement checklist

| # | Requirement | Status | Notes |
| --- | --- | --- | --- |
| 1 | Application shell: window, title, File menu, Home/Draw/View ribbons, workspace, properties panel, status bar | Done | Launches with `npm run dev`. File menu: New, Open, Save, Save As, Exit |
| 2 | A3 landscape page 420 × 297 mm, white sheet on grey workspace, rulers, boundary, zoom, fit page, mm | Done | One uniform px/mm factor keeps proportions exact. 100 % = true size at 96 dpi. Wheel zoom about cursor; pan with middle button or Space+drag |
| 3 | Lines, rectangles, circles, freehand polylines | Done | Stored as vector geometry and rendered as SVG elements. No bitmaps |
| 4 | Select, move, resize, rotate, delete, duplicate, multi-select, handles, properties panel | Done | Click, Shift/Ctrl+click and selection window. 8 resize handles plus a rotate handle. Undo/redo added |
| 5 | Exact entry of X, Y, width, height, line length, rotation angle (mm) | Done | Per-object fields. Enter or Tab commits, Esc reverts, invalid input is rejected |
| 6 | Scales 1:1 … 1:100 plus custom; world ↔ page conversion; geometry not changed by scale | Done | Custom entries such as `1:25`, `1/250`, `2:1`. Properties show the on-paper size |
| 7 | Separated layers, single source of truth, bottom-left origin with Y up, conversion functions | Done | See README "Technical architecture" |
| 8 | Automated tests | Done | 77 Vitest unit tests plus a 64-check Electron end-to-end script |
| 9 | README, DEVELOPMENT_STATUS, TEST_PLAN | Done | |

## Defects found and fixed during verification

1. **Floating-point error in proportional resize.** Scaling a selection 2× produced
   19.999999999999996 mm instead of 20 mm, because the code squared the result of `Math.hypot`.
   It now uses the exact dot product. Caught by a unit test.
2. **Esc did not revert numeric entry.** The blur that followed Esc committed the
   typed text. Esc now discards the typed value. Covered by an E2E check.
3. **Duplicate undo entries from numeric entry.** Pressing Enter and then leaving the field
   quickly could commit the same edit twice, so one Ctrl+Z appeared not to work.
   The field now uses a pending-commit guard and reads the latest values. Covered by an E2E check.
4. **Property fields could show a stale value for one frame** after undo.
   The fields now read the displayed value straight from the model when they are not being edited.
5. **Clipped ruler labels.** A partly visible "-50" label looked like "0". Labels are now drawn only when they fit.

## Known limitations and remaining defects

None of these block the milestone. All of them are candidates for later milestones.

* **Not verified on Windows hardware.** All runs (dev, production build, unit tests and
  E2E) were done on Linux under a virtual display. The code has no platform-specific
  paths except Electron's own dialogs. Running `npm install` and `npm run dev` on a
  Windows machine is the first check for the next milestone.
* **No Windows installer yet.** There is no `electron-builder` or packaging step. The
  app is launched with `npm run dev`, or `npm run build` followed by `npm start`.
* **Selection is by outline only.** Shapes have no fill, so clicking inside a rectangle
  or circle does not select it (the usual CAD behaviour). Click the outline or use a
  selection window.
* **Freehand polylines have no stored rotation.** Rotation is applied with
  "Rotate by" or the rotate handle, which transforms the points.
* **Multi-selection resize is proportional only**, so rotated rectangles and circles
  stay true rectangles and circles.
* **Two pivots for rectangle rotation.** The Rotation field turns a rectangle about its
  base corner (X, Y) so the entered X and Y stay fixed. The rotate handle turns about
  the centre. This is deliberate and documented in the panel, but users may need to learn it.
* **Snapping is to an increment only** (default 1 mm). There is no snapping to object
  points such as endpoints, midpoints or centres yet. Freehand input is never snapped.
* **Pen colour list is fixed.** A file containing a colour outside the six listed shows
  the first entry in the colour drop-down. The stored colour is kept.
* **No printing or export** (PDF, SVG or DXF) yet.
* **Electron binary download.** In the build container, `npm install` did not fetch
  the Electron binary through its postinstall step. Running
  `node node_modules/electron/install.js` fixed it. A normal Windows `npm install`
  is expected to fetch it automatically.

## Suggested next milestone (not started)

Windows packaging (electron-builder NSIS), snapping to object points, a coordinate
command line (e.g. `@100<30`), dimensions, layers, print or PDF export at true scale,
and filled shapes with inside hit-testing.
