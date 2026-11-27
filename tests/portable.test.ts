import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PORTABLE_MARKER, portableDataDir } from '../electron/portable';
import { updateMode } from '../electron/updatePolicy';

describe('portable mode', () => {
  const exe = path.join('E:', 'Apps', 'A3 Precision Drawing Studio', 'A3 Precision Drawing Studio.exe');
  const dir = path.dirname(exe);
  it('uses a data folder next to the program only when the marker file is there', () => {
    expect(portableDataDir(exe, (p) => p === path.join(dir, PORTABLE_MARKER))).toBe(path.join(dir, 'data'));
    expect(portableDataDir(exe, () => false)).toBeNull();
  });
  it('a portable copy only notifies about updates (it has no installer to update)', () => {
    expect(updateMode({ platform: 'win32', isPackaged: true, portable: true })).toBe('notify');
    expect(updateMode({ platform: 'win32', isPackaged: true })).toBe('install');
  });
});
