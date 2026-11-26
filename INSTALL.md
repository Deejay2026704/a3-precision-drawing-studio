# Installing A3 Precision Drawing Studio

These installers are built and tested automatically by GitHub Actions. They are **not yet
code-signed**, so Windows and macOS show a warning the first time. That is expected; the
steps below get past it safely.

## 1. Download

1. Open the repository on GitHub ▸ **Actions** ▸ workflow **Test and build installers**,
   and click the newest run with a green tick (you must be signed in to GitHub).
2. Scroll down to **Artifacts** and download the one for your computer:

| Your computer | Download |
| --- | --- |
| Windows 10 / 11 (almost all PCs) | **INSTALL-Windows-x64 (most PCs)** |
| Windows on ARM (e.g. Surface Pro X, Snapdragon laptops) | INSTALL-Windows-ARM64 |
| Mac with Apple M1, M2, M3 or M4 chip ( ▸ About This Mac shows "Chip: Apple …") | **INSTALL-macOS-Apple-Silicon (M1-M4)** |
| Older Mac with an Intel processor | INSTALL-macOS-Intel |

3. GitHub always delivers artifacts as a **.zip** — double-click it to get the installer
   (`.exe` on Windows, `.dmg` on Mac).

Artifacts are kept for 90 days after each build.

## 2. Install on Windows

1. Double-click `A3-Precision-Drawing-Studio-Setup-<version>-x64.exe`.
2. If **"Windows protected your PC"** appears: click **More info** ▸ **Run anyway**.
3. Follow the wizard (you can choose the folder; no administrator rights needed).
   It adds Start-menu and desktop shortcuts, and `.a3d` drawings open in the app.

Uninstall: Settings ▸ Apps ▸ A3 Precision Drawing Studio ▸ Uninstall. Your drawings and
recovery files are kept.

## 3. Install on macOS (11 Big Sur or later)

1. Double-click the `.dmg` and drag **A3 Precision Drawing Studio** into **Applications**.
2. Open it from Applications. macOS will say it cannot verify the app. Click **Done**
   (not "Move to Bin").
3. Open **System Settings ▸ Privacy & Security**, scroll down to the message about
   A3 Precision Drawing Studio and click **Open Anyway**, then confirm with your password.
   (On macOS 14 and earlier you can instead right-click the app ▸ **Open** ▸ **Open**.)
4. From then on it opens normally.

If macOS says the app **"is damaged and can't be opened"** (this can happen with
downloaded unsigned apps), open **Terminal** and run this once, then open the app again:

```bash
xattr -dr com.apple.quarantine "/Applications/A3 Precision Drawing Studio.app"
```

Uninstall: drag the app from Applications to the Bin.

## 4. First steps

* **File ▸ New**, then draw on the Draw tab (Line `L`, Rectangle `R`, Circle `C`, Arc `A`,
  Polyline `P`, Polygon `G`; Text `X` is on the Annotate tab).
* Select an object to type exact values in **Properties** on the right.
* **File ▸ Save** stores a `.a3d` drawing; **Ctrl+P** (⌘P on Mac) exports a true-scale A3
  PDF — print it at **100 % / Actual size**.
* The full list of tools and shortcuts is in the [README](README.md#using-the-application).

## 5. Updates

Builds downloaded from Actions do not update themselves (updates come from published
Releases, and none is published yet). To get a newer build, download and install it the
same way — it installs over the old one and keeps your settings.
