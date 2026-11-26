# Development Status

## Milestone 2 — Precision drafting tools: **complete** (26 Nov 2026)

All Milestone 1 features, UI layout, coordinate system (origin bottom-left, +X right,
+Y up, real-world mm) and file format were preserved; the format was extended
additively to version 2 and still opens version 1 files.

| Requirement | Status | Where / notes |
| --- | --- | --- |
| Object snaps: endpoint, midpoint, centre, intersection, perpendicular, tangent, nearest | Done | `model/snap.ts`. Individually toggleable (Draw ▸ Snap), master toggle F3 / OSNAP. Nearest is off by default |
| Grid snap + configurable grid spacing (mm) | Done | Grid snap increment (F9 / GRID) and visible grid spacing (View ▸ Show) are separate settings, both in drawing mm |
| Snap indicator at the cursor | Done | Glyph per snap type + label (`render/SnapMarker.tsx`) |
| Snapping from geometry, not pixels; correct for zoom and scale | Done | Snap points are computed exactly from geometry; only the 10 px aperture is converted to drawing mm through zoom **and** scale. Tested bit-exact at 5 zoom/scale combinations and in the real app at > 400 % |
| Aligned, horizontal, vertical, angular, radius, diameter dimensions | Done | Annotate tab |
| Editable, linked to geometry, accurate after edits | Done | Linked anchors; values recomputed every render. Tested after move, length change, rotate, resize, trim-split, save/reopen |
| Precision and text height configurable | Done | Ribbon (defaults for new) and Properties (selected) |
| Text placement, extension lines, arrowheads, offset adjustable | Done | Properties + drag/grips |
| Driven vs future constraints clearly distinguished | Done | `mode: 'driven'` in the model and file; "Driven · measured from geometry" badge; value read-only |
| Trim, extend, offset, mirror | Done | `model/modify.ts`. Trim/extend: lines (any object is a boundary). Offset: lines, circles, rectangles, polylines. Mirror: all shapes |
| Endpoint and centre grips | Done | Line ends + midpoint, polyline ends, rectangle/circle centre. Grips snap |
| Numeric entry: line length/angle, rectangle W/H, circle radius/diameter | Done | Editing (M1) **and** new "by numbers" creation in Properties |
| Undo/redo for every operation | Done | Every operation is one atomic `commitDocument` / edit transaction |
| Invalid/ambiguous operations handled safely | Done | Refusals return a reason; document untouched (tests). Deleting geometry removes linked dimensions *with a message* |
| Live coordinate/length/angle feedback | Done | Cursor tooltip + status bar (snapped X/Y and live readout) |
| Shortcuts don't interfere with text fields | Done | Tested: letters, Delete, Ctrl+Z typed in a field don't affect the drawing |
| Tooltips and active-tool indicators | Done | Descriptive tooltips on all new tools; active tool highlighted on ribbon and in status bar; prompts for each step |

### Defects found and fixed during Milestone 2 verification

1. **Tool-switch race** (real bug): the click tools' state was created in a React effect,
   so a click made immediately after switching tools (e.g. `D` then click) could be
   handled by the previous tool. The session is now derived synchronously from the
   active tool, and pending click-click drawings are tagged with the tool that started
   them. Regression check in the M2 E2E suite.
2. **Select-tool priority**: dimensions always won the hit test, so clicking a circle where
   its radius-dimension arrow touches it selected the dimension. The closest item now wins,
   geometry on ties.
3. Test-harness: closing the app with unsaved changes opened the (correct) native prompt and
   blocked the run; the harness now answers it.

### Known limitations (Milestone 2)

* **Trim and extend work on lines only.** Rectangles, circles and polylines act as cutting
  edges/boundaries but cannot themselves be trimmed: trimming a circle needs an arc
  entity, which does not exist yet. The tools refuse with an explanation.
* Trimming a line that **nothing crosses** is refused (it does not delete the line).
* Splitting a line by trimming its middle: dimensions linked to the line's end follow the
  new far piece; a dimension linked to the line's *midpoint* stays on the first piece.
* **Angular dimensions** measure between two *lines* only (not rectangle edges or
  polyline segments) and have no text-flip/outside-arrow logic for very small angles.
* Dimensions are not copied by **Mirror** (they are copied by Duplicate when their
  geometry is copied too). Dimension text is not user-overridable (by design: driven).
* Very short dimensions place arrows inside the extension lines even when they overlap.
* Snap candidates are searched among all shapes each pointer move — fine for hundreds of
  objects; a spatial index will be needed for very large drawings.
* Still **not verified on Windows hardware** and no installer (unchanged from M1).

---

## Milestone 1 (complete, 26 Nov 2026)

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
* ~~Snapping is to an increment only~~ — **resolved in Milestone 2** (object snaps).
  Freehand input is still never snapped (by design).
* **Pen colour list is fixed.** A file containing a colour outside the six listed shows
  the first entry in the colour drop-down. The stored colour is kept.
* **No printing or export** (PDF, SVG or DXF) yet.
* **Electron binary download.** In the build container, `npm install` did not fetch
  the Electron binary through its postinstall step. Running
  `node node_modules/electron/install.js` fixed it. A normal Windows `npm install`
  is expected to fetch it automatically.

## Suggested next milestone (not started)

*(Superseded – see the Milestone 3 recommendation in the final report / below.)*

Windows packaging (electron-builder NSIS), snapping to object points, a coordinate
command line (e.g. `@100<30`), dimensions, layers, print or PDF export at true scale,
and filled shapes with inside hit-testing.

## Recommended Milestone 3

Arcs (needed for trimming circles and fillets), fillet/chamfer, layers with line types,
print / PDF export at true scale, a coordinate command line (`@100<30`), and Windows
packaging (electron-builder NSIS) with a first run on real Windows hardware.
