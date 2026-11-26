# Development Status

## Milestone 4 — Installers, PDF export, autosave (26 Nov 2026)

### PDF export — complete
File ▸ Export PDF… (`Ctrl+P`). A pure-TypeScript vector PDF writer (no print engine):
one page the size of the sheet (A3 landscape 1190.55 × 841.89 pt), paper mm → pt by
72/25.4 so printing at **100 % / Actual size** gives true scale; only visible layers, each
as a toggleable PDF layer; standard Helvetica text (⌀ is printed as Ø); circles and arcs as
≤ 22.5° cubic Béziers (radial error < 1e-4 mm, tested). Shares one primitives layer with
SVG export. Verified by unit tests, by poppler (`pdfinfo`/`pdftotext`/`pdftoppm`), and
visually.

### Autosave and crash recovery — complete
Every 2 minutes while there are unsaved changes (File ▸ Autosave On/Off; status bar
shows the last autosave). Recovery copies are kept **separate** from projects in the app
data folder, one per session, written atomically, deleted after Save / Don't save / normal
quit. After a crash the next start offers Recover / Keep for later / Discard (confirmed);
damaged backups are reported and only deleted on request; a recovered drawing opens
*unsaved* and the first Save asks before writing over the original. Verified with a real
`SIGKILL` crash in both the development and the packaged app.

### Installers — see "CI verification" below
* `electron-builder.config.cjs`: Windows NSIS (x64 + arm64; wizard with folder choice,
  per-user install without admin, Start-menu/desktop shortcuts, `.a3d` association,
  uninstaller keeps recovery data) and macOS DMG + ZIP (x64 + arm64, hardened runtime,
  ad-hoc signed unless a certificate is supplied, notarised when Apple credentials are
  supplied, `.a3d` document type). App icon in `build/`.
* `.a3d` files passed by the OS (double-click, "Open with", second launch, macOS
  open-file) open in the running app; only one instance runs.
* React moved to devDependencies (it is bundled by Vite): the installed app contains only
  `dist/`, `dist-electron/` and `package.json` (no `node_modules`, no source maps).
* `.github/workflows/installers.yml`: tests on Linux, then builds the installers on
  `windows-latest` and `macos-latest`, **installs them** (silent NSIS install / DMG copy),
  runs `tests-e2e/packaged-smoke.mjs` against the installed app (incl. crash recovery and
  PDF export), uninstalls on Windows, and uploads the installers as artifacts (attached to
  a GitHub Release for `v*` tags).

**Built and tested in this (Linux) environment:** the packaged app (`--linux dir`,
identical app contents to the Windows/macOS builds): 18/18 packaged smoke checks. The
Windows installer could *not* be finished here: NSIS needs Wine to generate the
uninstaller and Wine crashes in this sandbox (`free(): invalid pointer` on a trivial
command); macOS DMGs can only be built on macOS. Both are therefore built and tested in CI.

### CI verification
*Pending:* CI run [45769466723](https://github.com/Deejay2026704/a3-precision-drawing-studio/actions/runs/45769466723)
(build, install and smoke-test on Windows and macOS) was still running when this was written.
This section will be updated with its result.

### Defects found and fixed during Milestone 4
1. Dialog test-id collision (recovery dialog container vs its Recover button).
2. Stale "Autosaved hh:mm" shown after turning autosave off and on.
3. E2E suites assumed the window was laid out 0.5 s after start; slower CI machines
   failed the first visibility checks. All suites now wait for real layout.

### Known limitations (Milestone 4)
* **Unsigned installers**: SmartScreen (Windows) and Gatekeeper (macOS) warn until code-
  signing certificates / Apple notarisation credentials are added as CI secrets.
* No auto-update (electron-updater) yet; no Linux installer (not a target platform).
* PDF: one page (the sheet), standard Helvetica only (characters outside Latin-1 print
  as `?`); no print dialog integration – print the PDF at 100 %.
* Autosave interval is fixed at 2 minutes (on/off only).
* The Windows ARM64 installer is built but only the x64 one is installed/tested in CI.

---

## Milestone 3 — Constraints, layers, robust project files (complete)

Built on Milestone 2 without removing or redesigning anything. The project format moved
to version 3 *additively*; versions 1 and 2 are migrated on open.

### Constraints

| Type | Supported on | Notes |
| --- | --- | --- |
| Horizontal, Vertical | 1 line | |
| Coincident | line start/end/midpoint, circle centre (2 points on different objects) | point-pick tool |
| Parallel, Perpendicular, Equal length | 2 lines | |
| Tangent | line + circle, or 2 circles | circle–circle inside/outside chosen from the current layout |
| Fixed length | 1 line | driving value, editable |
| Fixed angle | 1 line (absolute angle from +X) | driving value, editable |
| Fixed position | line end/midpoint or circle centre | x, y editable |

**Not supported (no UI is shown for them):** constraints on rectangles and freehand
polylines (they have no constrainable points in the solver); a fixed *radius/diameter*
constraint; angle *between two lines*; symmetric, midpoint-on-line and point-on-curve
constraints; converting a reference dimension into a driving one. Buttons are disabled
with an explanation when the selection is not supported.

Behaviour guarantees (all tested): add/edit/suppress/delete; markers coloured by
status (satisfied / not satisfied / suppressed / broken) computed from real geometry;
conflicting constraints or values are **refused** with the conflicting constraints named
and the geometry untouched; a result that would collapse a line or circle is rejected;
circle radii are held exactly unless only a size change can satisfy the constraints;
locked/hidden geometry is never moved; edits that break constraints are re-solved with the
edited object preferred to stay put (the user is told), or, if impossible, the edit is kept
and the constraints are flagged red.

### Layers

Create, rename, delete, reorder, select (active layer), visibility, lock, display colour
("By layer" colour for objects); assign objects/dimensions to layers. Hidden layers are not
drawn, snapped to, selectable or exported. Locked layers are drawn and can be snapped to,
but their objects cannot be selected or changed by any tool, numeric entry, solver or
undoable action (enforced centrally by the store). Deleting a non-empty layer requires an
explicit choice: move the objects to another layer, or delete them (with their dependent
dimensions/constraints); the last layer cannot be deleted. All layer operations undo.

### Project files

Review of the M2 format before changing it: JSON, versions 1–2, hand-written
validation, no migration step, direct overwrite on save, no orientation or display
preferences stored. Milestone 3 adds: v3 schema with path-specific validation;
v1→v2→v3 migration in memory (file untouched); refusal of newer versions; warnings for
repaired issues (never silent); explicit page orientation, active layer and display
preferences; **atomic saves**; confirmation before upgrading an older file on save;
Save / Don't save / Cancel before New/Open on a modified drawing (close already
confirms); "Unsaved changes" badge; byte-identical re-saves; SVG export (visible layers).

### Defects found and fixed during Milestone 3 verification

1. **Canvas overlapped the sidebar** after a wider ribbon tab had been shown: the rulers'
   width stopped the workspace grid from shrinking, so the canvas covered the Properties
   panel and intercepted its clicks. Fixed with `minmax(0, 1fr)` tracks and clipping;
   regression check added (E2E).
2. **Tangent changed circle sizes slightly** (radius 20 → 20.000013): the solver now holds
   radii exactly in a first pass and only frees them if needed.
3. **Floating-point noise counted as edits**: the solver re-wrote unrelated objects by
   ~1e-15 mm and over-reported "objects adjusted"; sub-nanometre changes are now discarded.
4. Test-harness issues (Playwright `mouse.click` ignores modifiers; key-order-sensitive
   comparison; a duplicated test id between a dialog and its button) – fixed in the tests.

### Known limitations (Milestone 3)

* **No autosave / crash recovery** yet (optional in the brief; deliberately not half-built).
* Constraint solving is numerical (damped least squares). It is robust for drawings of
  tens of constrained objects; it has no symbolic degree-of-freedom analysis, so
  *under*-constrained geometry is simply moved minimally and *redundant but consistent*
  constraints are accepted silently.
* When constraints cannot be met after a user edit, the edit is kept and the constraints
  are flagged (rather than refusing the edit); the user resolves it (undo, suppress, delete).
* Trim/extend still treat hidden objects as cutting edges/boundaries.
* Constraints are not copied by Duplicate or Mirror; a trimmed (split) line keeps its
  constraints on the first piece.
* Display preferences are saved with the project but changing them alone does not mark
  the project modified.
* SVG is the only export; PDF/print is not implemented.
* Still not verified on Windows hardware; no installer.

---

## Milestone 2 — Precision drafting tools (complete)

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

## Recommended Milestone 5

Code signing + notarisation and auto-update; arcs (enabling trimming of circles,
fillet/chamfer and arc constraints); radius and two-line angle constraints; multi-page /
title-block print layouts.
