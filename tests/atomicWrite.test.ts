import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { writeFileAtomic } from '../electron/atomicWrite';

describe('atomic project saving', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'a3-atomic-'));

  it('writes a new file and replaces an existing one completely', async () => {
    const f = path.join(dir, 'p.a3d');
    await writeFileAtomic(f, 'first version');
    expect(readFileSync(f, 'utf8')).toBe('first version');
    await writeFileAtomic(f, 'second');
    expect(readFileSync(f, 'utf8')).toBe('second');
    expect(readdirSync(dir).filter((x) => x.endsWith('.tmp'))).toEqual([]);
  });

  it('a failed save leaves the original untouched and no temporary file behind', async () => {
    const sub = path.join(dir, 'case2');
    mkdirSync(sub);
    const target = path.join(sub, 'drawing.a3d');
    mkdirSync(target); // rename onto a non-empty directory fails
    writeFileSync(path.join(target, 'keep.txt'), 'precious');
    await expect(writeFileAtomic(target, 'new content')).rejects.toThrow();
    expect(readFileSync(path.join(target, 'keep.txt'), 'utf8')).toBe('precious');
    expect(readdirSync(sub)).toEqual(['drawing.a3d']);
  });

  it('a save into a folder that does not exist fails without creating anything', async () => {
    await expect(writeFileAtomic(path.join(dir, 'missing', 'x.a3d'), 'x')).rejects.toThrow();
  });
});
