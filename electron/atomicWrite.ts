import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Atomic write: the content goes to a temporary file in the same folder, is flushed to
 * disk, and only then renamed over the target. If anything fails, the original file is
 * untouched and the temporary file is removed – a failed save can never leave a
 * half-written project behind.
 */
export async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    const handle = await fs.open(tmp, 'w');
    try {
      await handle.writeFile(content, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw err;
  }
}
