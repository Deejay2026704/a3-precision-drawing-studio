import path from 'node:path';

/**
 * Portable mode (no installer): the portable zip ships this marker file next to the
 * program. When it is present, ALL app data (settings, autosave/recovery copies, logs)
 * lives in a `data` folder beside the program – e.g. on a USB/SSD drive – and nothing is
 * written to the computer's user profile. Pure, unit-tested (tests/portable.test.ts).
 */
export const PORTABLE_MARKER = 'portable-mode.txt';

export function portableDataDir(exePath: string, exists: (p: string) => boolean): string | null {
  const dir = path.dirname(exePath);
  return exists(path.join(dir, PORTABLE_MARKER)) ? path.join(dir, 'data') : null;
}
