/**
 * Installer configuration (electron-builder).
 *
 *   npm run dist:win   → Windows NSIS installer  (release/A3-Precision-Drawing-Studio-Setup-<ver>-<arch>.exe)
 *   npm run dist:mac   → macOS DMG + ZIP         (release/A3-Precision-Drawing-Studio-<ver>-<arch>.dmg/.zip)
 *   npm run dist:dir   → unpacked app for the current OS (used to test the packaged app)
 *
 * Code signing is optional and driven by environment variables (never stored here):
 *   Windows: CSC_LINK / CSC_KEY_PASSWORD (or WIN_CSC_LINK)   macOS: CSC_LINK / CSC_KEY_PASSWORD,
 *   notarisation: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID.
 * Without them, unsigned installers are produced (Windows SmartScreen / macOS Gatekeeper warn).
 */
const macCert = Boolean(process.env.CSC_LINK || process.env.CSC_NAME);
const notarize = Boolean(process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID);

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'com.a3precisiondrawing.studio',
  productName: 'A3 Precision Drawing Studio',
  copyright: 'Copyright © 2026 A3 Precision Drawing Studio',
  directories: { output: 'release', buildResources: 'build' },
  files: ['dist/**/*', 'dist-electron/**/*', 'package.json', '!**/*.map'],
  asar: true,
  npmRebuild: false, // no native modules
  // Double-clicking a .a3d project opens it in the app (Windows registry / macOS Info.plist).
  fileAssociations: [
    {
      ext: 'a3d',
      name: 'A3 Drawing',
      description: 'A3 Precision Drawing Studio project',
      mimeType: 'application/x-a3-precision-drawing',
      role: 'Editor',
    },
  ],

  win: {
    target: [{ target: 'nsis', arch: ['x64', 'arm64'] }],
    icon: 'build/icon.png',
    artifactName: 'A3-Precision-Drawing-Studio-Setup-${version}-${arch}.${ext}',
    // Embedding the icon/version info into the .exe needs Windows (installers are built on Windows in CI).
    signAndEditExecutable: process.platform === 'win32',
  },
  nsis: {
    oneClick: false, // a normal wizard
    perMachine: false, // per-user by default (no admin needed) …
    allowElevation: true, // … but "all users" can be chosen
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'A3 Precision Drawing Studio',
    uninstallDisplayName: 'A3 Precision Drawing Studio',
    deleteAppDataOnUninstall: false, // keep autosave recovery files and settings
    installerIcon: undefined,
  },

  mac: {
    target: [
      { target: 'dmg', arch: ['x64', 'arm64'] },
      { target: 'zip', arch: ['x64', 'arm64'] },
    ],
    category: 'public.app-category.graphics-design',
    icon: 'build/icon.png',
    artifactName: 'A3-Precision-Drawing-Studio-${version}-${arch}.${ext}',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',
    // No certificate → ad-hoc signed ("-") so Apple Silicon can run it; Gatekeeper will still ask.
    identity: macCert ? undefined : '-',
    notarize,
    minimumSystemVersion: '11.0',
  },
  dmg: {
    title: 'A3 Precision Drawing Studio ${version}',
    contents: [
      { x: 130, y: 220 },
      { x: 410, y: 220, type: 'link', path: '/Applications' },
    ],
  },

  linux: {
    // Not a supported release platform; used only to test the packaged app in CI/containers.
    target: ['dir'],
    icon: 'build/icon.png',
    category: 'Graphics',
  },
};
