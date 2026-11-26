import { describe, expect, it } from 'vitest';
import { friendlyUpdateError, releasePageUrl, updateMode, validFeedUrl } from '../electron/updatePolicy';

describe('update policy', () => {
  it('installs on Windows, notifies on unsigned macOS, nothing elsewhere or in development', () => {
    expect(updateMode({ platform: 'win32', isPackaged: true })).toBe('install');
    expect(updateMode({ platform: 'darwin', isPackaged: true })).toBe('notify');
    expect(updateMode({ platform: 'darwin', isPackaged: true, macSigned: true })).toBe('install');
    expect(updateMode({ platform: 'linux', isPackaged: true })).toBe('unsupported');
    expect(updateMode({ platform: 'win32', isPackaged: false })).toBe('unsupported');
  });
  it('only links to this project’s release pages', () => {
    expect(releasePageUrl('0.6.0')).toBe('https://github.com/Deejay2026704/a3-precision-drawing-studio/releases/tag/v0.6.0');
    expect(releasePageUrl('../../evil')).toBe('https://github.com/Deejay2026704/a3-precision-drawing-studio/releases/latest');
    expect(releasePageUrl()).toMatch(/releases\/latest$/);
  });
  it('accepts only http(s) update server overrides', () => {
    expect(validFeedUrl('http://127.0.0.1:8123/')).toBe('http://127.0.0.1:8123/');
    expect(validFeedUrl('file:///C:/x')).toBeNull();
    expect(validFeedUrl('not a url')).toBeNull();
    expect(validFeedUrl(undefined)).toBeNull();
  });
  it('turns updater errors into short messages', () => {
    expect(friendlyUpdateError(new Error('HttpError: 404 \n"method: GET url: https://github.com/…"'))).toMatch(/No published release/);
    expect(friendlyUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toMatch(/could not be reached/);
    expect(friendlyUpdateError(new Error('sha512 checksum mismatch, expected x, got y'))).toMatch(/checksum mismatch/);
    expect(friendlyUpdateError('x'.repeat(300)).length).toBeLessThanOrEqual(160);
  });
});
