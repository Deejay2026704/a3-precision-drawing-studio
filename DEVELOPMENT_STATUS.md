# Development Status

## Milestone 7 — Installable Windows and Mac builds (26 Nov 2026)

No app changes (version 0.6.0). CI now publishes **one download per installer**
(`INSTALL-Windows-x64 (most PCs)`, `INSTALL-Windows-ARM64`,
`INSTALL-macOS-Apple-Silicon (M1-M4)`, `INSTALL-macOS-Intel`) and `INSTALL.md` explains, for
non-developers, which file to pick and how to get past the unsigned-app warnings.
By your choice, nothing is published as a GitHub Release; installers come from the CI run.

GitHub's Apple Silicon (arm64) Mac runners were unavailable three times in a row
("capacity constraints"), so the Mac job now runs on an **Intel** Mac runner, which builds
both Mac installers. CI run
[45794297641](https://github.com/Deejay2026704/a3-precision-drawing-studio/actions/runs/45794297641)
(commit `42c1116`): all jobs green – Windows x64 installed, smoke 18/18, auto-update 9/9,
uninstalled; macOS Intel build installed from the DMG, `codesign` valid, smoke 18/18,
update check 7/7. **The Apple Silicon DMG from this run was built but not installed on an
Apple Silicon machine** (earlier runs, e.g. 45784398087, installed and tested the arm64
build on Apple Silicon).

---

## Milestone 6 — Polylines, fill/hatch, text, fillets with curves, Letter printing (26 Nov 2026)

Built on Milestone 5 without removing or redesigning anything. Project format **5**
(text, closed polylines, fills – additive; v1–v4 files are migrated on open, and older
app versions refuse v5 files rather than silently dropping fills). App version 0.6.0.

### Polylines and polygons — complete
Polyline tool (`P`): click points; Enter or double-click finishes, clicking the first
point closes, Backspace removes the last point. Polygon tool (`G`): centre + corner, or by
numbers (3–64 sides, radius to corners or across flats, first-corner angle). Polylines can
be closed/opened in Properties (perimeter and area shown); every vertex has a grip;
offsetting a closed polyline gives a closed, mitred result. **Trim** now works on
polylines: open ones lose an end or split in two; a closed one crossed at least twice
opens up. (Dimensions attached to a trimmed polyline's vertices are fixed in place,
because the vertex numbering changes.)

### Fill and hatch — complete
Rectangles, circles and closed polylines: Solid, Hatch or Cross-hatch, with colour
(By layer or a pen colour), angle and spacing. Spacing is in paper mm (same look at every
scale) and hatch lines are anchored to the drawing origin so neighbouring areas line up.
Drawn on the canvas, in SVG and PDF (vector lines, 0.18 mm). A filled shape can be
selected by clicking anywhere inside it. Hatches needing more than 2,000 lines per
direction are not drawn and Properties says so.

### Text notes — complete
Text tool (`X`, Annotate tab): click to place, type in Properties (multi-line). Height
(drawing mm, or on paper), rotation and position editable; move, rotate, scale and mirror
(mirrored text stays readable). Rendered and exported as real Helvetica text (selectable
in the PDF), with the same font metrics everywhere.

### Fillet with arcs and circles — complete
Fillet now works line–arc, line–circle, arc–arc, arc–circle and circle–circle, with exact
tangency; the picks choose which of the possible fillets is made. Lines and arcs are
trimmed/extended to the tangent points; full circles are left whole. Chamfer remains
line–line.

### US Letter printing — complete
File ▸ Export PDF for an A4 / Letter printer: A4 or US Letter, tiled at true scale (4
pages) or fitted (NOT TO SCALE).

### Verification
* Unit tests: **35 files, 358 tests passing**; typecheck clean.
* End-to-end (local, real Electron): M1 64, M2 62, M3 78, M4 31, M5 53, **M6 32** – all
  passing; packaged Linux build 18/18. Hatch/fill/text output also checked visually from a
  PDF rendered with poppler.
* CI run [45784398087](https://github.com/Deejay2026704/a3-precision-drawing-studio/actions/runs/45784398087)
  (commit `d1cac32`), all jobs green: Linux 355 unit tests (3 poppler tests skipped – not on
  the runner) and E2E 64 + 62 + 78 + 30 + 47 + 30 (poppler checks skipped); **Windows**
  installed-app smoke 18/18 and auto-update 9/9; **macOS** installed-app smoke 18/18 and
  update check 7/7.

### Defects found and fixed during Milestone 6
1. A newly placed text's input box lost keyboard focus to the click that placed it, so
   typing went to the tool shortcuts (found by the M6 end-to-end suite) – focus is now set
   after the click completes.

### Not done in Milestone 6 (needs you)
* **Code signing** – still needs your certificates (README ▸ Code signing).
* **A first real release** – pushing a tag such as `v0.6.0` publishes a public GitHub
  Release with the installers and the auto-update feed. I have not done this without your
  go-ahead.

### Known limitations (Milestone 6)
* Polyline segments are straight (no arc segments); no splines or ellipses.
* Hatch patterns are lines only (no ANSI/ISO material patterns, no islands/holes);
  rectangles are filled but cannot be trimmed.
* Text uses Helvetica only; no text styles, alignment options or in-place editing on the
  canvas (editing is in Properties).
* Chamfer works only between lines; fillet leaves full circles untrimmed.
* Installers are still unsigned.

---

## Milestone 5 — Arcs, fillet/chamfer, new constraints, title block, A4 printing, auto-update (26 Nov 2026)

Built on Milestone 4 without removing or redesigning anything. The project format moved
to **version 4** additively (arcs, two constraint kinds, `titleBlock`); v1–v3 files are
migrated on open. App version 0.5.0.

### Arcs — complete
New object kind (centre, radius, start angle, counter-clockwise sweep). Arc tool (`A`):
3 clicks (start, a point on the arc, end) with live preview; collinear points are
refused. Arc by numbers (centre, radius, start, sweep). Properties: centre, radius,
sweep, start/end angle, arc length. Grips: ends, radius, centre, rotate. Snaps: end,
midpoint, centre, tangent, intersections (clipped to the sweep). Move/rotate/scale/
mirror/offset, radius/diameter dimensions, SVG and PDF export as true arcs.

### Trim circles and arcs, fillet, chamfer — complete
Trim works on circles (a circle crossed at two or more points becomes the arc you did not
click; the same object, so its dimensions/constraints stay attached) and arcs (trim an
end or split the middle). The piece to be removed is previewed dashed red. Fillet
(radius) and Chamfer (distance) between two lines: lines are trimmed/extended to the
tangent points and an arc/line is added, in one undo step; 0 = sharp corner; parallel
lines, the same line twice and radii that do not fit are refused with a message. The
radius/distance is set in Properties while the tool is active.

### Radius and angle constraints — complete
**Fixed radius** (circle or arc) and **Angle between lines** (0–180°, created at the
current angle). Both are driving, editable in Properties, shown with markers (R, ∡), and
solved by the existing solver (arcs take part in tangent/coincident/fixed-position too).

### Title block and print layouts — complete
Properties (nothing selected) ▸ Title block: frame 10 mm inside the sheet and a
180 × 40 mm block (title, drawing number, revision, scale and sheet size filled in
automatically, drawn/checked by, date — today's when first shown — company). Undoable,
saved in the project, drawn on the canvas, in SVG and in PDF. File ▸ **Export PDF for an
A4 printer**: *Tiled* = 4 A4 landscape pages at true scale (10 mm overlap, corner marks,
page labels) or *Fit* = 1 page marked NOT TO SCALE. Ctrl+P is still the A3 export.
PDF text now uses the full Windows-1252 set (– × ± µ € … no longer print as `?`).

### Auto-update — complete (Windows in-place; macOS notify until signed)
electron-updater against this repository's GitHub Releases. Check a few seconds after
start (silent unless there is an update) and File ▸ Check for updates. A non-modal notice
offers the update; nothing is downloaded without consent. Windows: download (SHA-512
checked) → *Restart now* (or install on next quit), silent in-place install. macOS:
Apple only allows in-place updates of Developer-ID-signed apps, so the unsigned build
offers *Open download page*; once signed, in-place updates switch on automatically.
The development build and Linux never update. The CI release job now also publishes the
update feed (`latest.yml`, `latest-mac.yml`, `.blockmap`).

### Code signing — prepared, needs your certificates
Nothing can be signed without real certificates, so none are faked. The workflow reads
`WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD` and `MAC_CSC_LINK`/`MAC_CSC_KEY_PASSWORD`/
`APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` as repository secrets and stays
unsigned while they are absent (README ▸ Code signing). The signed paths are **untested**.

### Verification
* Unit tests: **30 files, 315 tests passing**; typecheck clean (renderer + Electron).
* End-to-end (local, real Electron): M1 64, M2 62, M3 78, M4 31, **M5 53** — all passing;
  packaged Linux build smoke test 18/18.
* CI run [45780810378](https://github.com/Deejay2026704/a3-precision-drawing-studio/actions/runs/45780810378)
  (commit `c72d8c2`), all jobs green:

  | Job | Result |
  | --- | --- |
  | Linux | typecheck; 313 unit tests (2 poppler tests skipped – not on the runner); E2E 64 + 62 + 78 + 30 + 47 (poppler checks skipped) |
  | **Windows** | NSIS build; silent install; 18/18 smoke checks on the installed app; **auto-update 9/9**: the installed 0.5.0 found 99.0.0 on a local update server, downloaded it only after consent (SHA-512 checked), *Restart now* installed it silently in place, the relaunched app reported 99.0.0; silent uninstall |
  | **macOS** (Apple Silicon) | DMG + ZIP; install from DMG; codesign verify; 18/18 smoke checks; **update check 7/7**: unsigned build offers the update with *Open download page* (correct release URL), no in-place install |

### Defects found and fixed during Milestone 5
1. **Ribbon grew taller** on the Draw tab (new buttons and fields overflowed at 1440 px),
   moving the drawing area when switching tabs – found by the M2/M3 end-to-end suites.
   Fillet/chamfer values moved to Properties, buttons tightened, and the ribbon now has a
   fixed height and scrolls sideways if it ever overflows (CI runner fonts are wider).
2. Fillet between lines that cross (rather than meet) trimmed the wrong ends.
3. PDF text printed `–` and `×` as `?` (only Latin-1 was mapped) – full WinAnsi mapping.
4. File-format reference checks did not know the new constraint kinds.
5. Test harness: Playwright's `mouse.click` ignores modifier keys (shift-click helper).

### Known limitations (Milestone 5)
* Installers are still **unsigned** until certificates are added; signed builds,
  notarisation and macOS in-place updates are not yet exercised.
* Auto-update has been tested against a local update server in CI, not yet against a
  real published GitHub Release (that needs a `v*` tag push).
* Fillet/chamfer work between two lines only (not line–arc or arc–arc); no ellipses or
  splines; trim of rectangles and freehand polylines is still refused.
* Title block has a fixed layout; A4 tiling is fixed at 2 × 2 landscape pages.
* PDF text: characters outside Windows-1252 still print as `?`.
* Not yet tested by a person on physical Windows/macOS hardware.

---

## Milestone 4 — Installers, PDF export, autosave: **complete** (26 Nov 2026)

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

**Built and tested in the Linux development environment:** the packaged app (`--linux dir`,
identical app contents to the Windows/macOS builds): 18/18 packaged smoke checks. The
Windows installer could *not* be finished here: NSIS needs Wine to generate the
uninstaller and Wine crashes in this sandbox (`free(): invalid pointer` on a trivial
command); macOS DMGs can only be built on macOS. Both are therefore built and tested in CI.

### CI verification — passed
CI run [45773715800](https://github.com/Deejay2026704/a3-precision-drawing-studio/actions/runs/45773715800)
(commit `ce1bd74`), all jobs green:

| Job | Result |
| --- | --- |
| Linux: typecheck, unit, end-to-end | 263 unit tests (1 poppler test skipped – not installed on the runner); E2E 64 + 62 + 78 + 30 |
| **Windows** (`windows-latest`) | NSIS installers built (x64 116 MB, arm64); **silent install** to a chosen folder; **18/18 smoke checks on the installed app** (incl. PDF export, autosave, crash via `taskkill /F /T` and recovery); **silent uninstall** removed the app |
| **macOS** (`macos-latest`, Apple Silicon) | DMG + ZIP built for arm64 and x64; `hdiutil verify` on both DMGs; installed from the DMG; `codesign --verify --deep --strict` valid; `.a3d` document type registered; **18/18 smoke checks on the installed app** |

Installers are downloadable from that run's artifacts (`windows-installers`,
`macos-installers`); tagging `v0.4.0` would also publish them to a GitHub Release.

### Defects found and fixed during Milestone 4
1. **Crash recovery on Windows** (found through CI diagnostics): Windows reports a
   terminated process as existing while handles to it are open, so the PID check could
   hide a crashed session's backup. Sessions now keep a heartbeat file; a backup is
   recoverable when its process is gone *or* its heartbeat is stale (30 s).
2. An app instance that lost the single-instance lock still created a window while
   quitting; it now never opens one.
3. macOS: ad-hoc signing with the hardened runtime needs the
   `disable-library-validation` entitlement or the app may not launch – added.
4. CI builds tried to publish implicitly (no token) – builds now use `--publish never`.
5. Stale "Autosaved hh:mm" shown after turning autosave off and on.
6. Test-harness issues: dialog test-id collision; fixed 0.5 s start-up wait (now waits for
   layout); `ELECTRON_RUN_AS_NODE=''` counts as *set* on Windows (now removed instead);
   `tasklist` truncates image names (now CSV); crash simulated like Task Manager.
7. Added main-process diagnostics (`<userData>/logs/main.log`, stderr) – they pinpointed #1.

### Known limitations (Milestone 4)
* **Unsigned installers**: SmartScreen (Windows) and Gatekeeper (macOS) warn until code-
  signing certificates / Apple notarisation credentials are added as CI secrets.
* No auto-update (electron-updater) yet; no Linux installer (not a target platform).
* PDF: one page (the sheet), standard Helvetica only (characters outside Latin-1 print
  as `?`); no print dialog integration – print the PDF at 100 %.
* Autosave interval is fixed at 2 minutes (on/off only).
* The Windows ARM64 installer and the macOS Intel build are built but only the Windows
  x64 and macOS Apple Silicon builds are installed and smoke-tested in CI.
* Not yet tested by a person on physical Windows/macOS hardware (only CI runners).

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

## Recommended Milestone 7

First signed public release (`v0.6.0`) and a live auto-update from it; DXF import/export
for exchange with other CAD software; arc segments in polylines; hatch islands (holes)
and standard material patterns; text styles and alignment; blocks/symbols (reusable
grouped objects).
