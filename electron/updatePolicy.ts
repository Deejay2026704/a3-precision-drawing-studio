/**
 * Pure update policy (no Electron imports, unit-tested in tests/updatePolicy.test.ts).
 *
 *  - Windows (installed NSIS app): the update is downloaded ONLY after the user agrees, then
 *    installed when the user restarts (or quits) the app.
 *  - macOS: macOS only applies in-place updates to apps signed with an Apple Developer ID.
 *    Without one (the default build) the app only NOTIFIES and opens the release page.
 *  - Anything else (Linux test builds, `npm run dev`): no updates.
 */
export const REPO_OWNER = 'Deejay2026704';
export const REPO_NAME = 'a3-precision-drawing-studio';

export type UpdateMode = 'install' | 'notify' | 'unsupported';

export interface UpdateEnv {
  platform: string;
  isPackaged: boolean;
  /** true when the running macOS app carries a Developer ID signature (not ad-hoc). */
  macSigned?: boolean;
  /** A3_UPDATE_URL – test/portable override of the update server. */
  feedUrl?: string;
  /** Portable copy (no installer): it cannot install updates, so it only tells you about them. */
  portable?: boolean;
}

export function updateMode(env: UpdateEnv): UpdateMode {
  if (!env.isPackaged) return 'unsupported';
  if (env.portable) return 'notify';
  if (env.platform === 'win32') return 'install';
  if (env.platform === 'darwin') return env.macSigned ? 'install' : 'notify';
  return 'unsupported';
}

export function unsupportedReason(env: UpdateEnv): string {
  if (!env.isPackaged) return 'Updates are only available in the installed app.';
  return 'Automatic updates are available on Windows and macOS only.';
}

/** Release page for a version (never anything other than this project's GitHub releases). */
export function releasePageUrl(version?: string): string {
  const base = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;
  return version && /^\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$/.test(version) ? `${base}/tag/v${version}` : `${base}/latest`;
}

/** Only http(s) URLs are accepted as an update server override. */
export function validFeedUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Status sent to the renderer. */
export type UpdateStatus =
  | { state: 'idle' | 'checking'; mode: UpdateMode }
  | { state: 'unsupported'; mode: UpdateMode; message: string }
  | { state: 'not-available'; mode: UpdateMode; current: string }
  | { state: 'available'; mode: UpdateMode; current: string; version: string; releaseUrl: string }
  | { state: 'downloading'; mode: UpdateMode; version: string; percent: number }
  | { state: 'downloaded'; mode: UpdateMode; version: string }
  | { state: 'error'; mode: UpdateMode; message: string };

/** Short, user-facing error text (electron-updater errors can contain long HTTP dumps). */
export function friendlyUpdateError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (/404|Cannot find latest|No published versions|HttpError: 4\d\d/i.test(raw)) return 'No published release was found on the update server.';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|net::ERR_/i.test(raw)) return 'The update server could not be reached. Check the internet connection.';
  if (/sha512 checksum mismatch/i.test(raw)) return 'The downloaded update was damaged (checksum mismatch) and was discarded.';
  if (/not signed|publisherName|signature/i.test(raw)) return 'The downloaded update failed its code-signature check and was discarded.';
  const first = raw.split('\n')[0];
  return first.length > 160 ? first.slice(0, 157) + '…' : first;
}
