import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeFileAtomic } from './atomicWrite';

/**
 * Crash-recovery storage, kept SEPARATE from the user's project files:
 * <userData>/autosave/session-<pid>-<startMs>.json – one file per running app session.
 * A running session also keeps <id>.alive fresh (heartbeat). A backup whose process is gone,
 * or whose heartbeat is stale, is an "orphan": the app crashed or was killed before the
 * drawing was saved, and it is offered for recovery at the next start.
 */
export interface AutosaveEntry {
  readonly id: string;
  readonly pid: number;
  readonly modifiedMs: number;
  readonly sizeBytes: number;
}

const NAME = /^session-(\d+)-(\d+)\.json$/;

export const sessionId = (pid: number, startMs: number) => `session-${pid}-${startMs}`;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'; // exists but not ours
  }
}

/** A session whose heartbeat is older than this is treated as dead even if its PID looks alive. */
export const DEFAULT_STALE_MS = 30_000;

export class AutosaveStore {
  constructor(
    private readonly dir: string,
    private readonly ownId: string,
    private readonly alive: (pid: number) => boolean = isAlive,
    private readonly staleMs: number = DEFAULT_STALE_MS,
    private readonly now: () => number = Date.now,
  ) {}

  private heartbeatFile(id: string): string {
    return path.join(this.dir, `${id}.alive`);
  }

  /**
   * Mark this session as running. Called periodically by the main process. PIDs alone are not
   * reliable (Windows reports a terminated process as existing while any handle to it is open,
   * and PIDs are reused), so a backup is only "owned" while its heartbeat is fresh.
   */
  async heartbeat(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.heartbeatFile(this.ownId), String(this.now()));
  }

  private async isRunning(id: string, pid: number): Promise<boolean> {
    if (!this.alive(pid)) return false;
    try {
      const st = await fs.stat(this.heartbeatFile(id));
      return this.now() - st.mtimeMs <= this.staleMs;
    } catch {
      return true; // no heartbeat file (older version): trust the PID check
    }
  }

  private file(id: string): string {
    if (!NAME.test(`${id}.json`)) throw new Error('Invalid autosave id');
    return path.join(this.dir, `${id}.json`);
  }

  /** Write (atomically) this session's recovery copy. */
  async write(content: string): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    await writeFileAtomic(this.file(this.ownId), content);
  }

  /** Remove this session's recovery copy (after a save, discard or normal quit). */
  async clear(): Promise<void> {
    await fs.rm(this.file(this.ownId), { force: true });
  }

  /** On a normal quit: no backup and no heartbeat left behind. */
  async dispose(): Promise<void> {
    await fs.rm(this.file(this.ownId), { force: true });
    await fs.rm(this.heartbeatFile(this.ownId), { force: true });
  }

  /** Recovery copies left by sessions that are no longer running, newest first. */
  async orphans(): Promise<AutosaveEntry[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch {
      return [];
    }
    const out: AutosaveEntry[] = [];
    for (const n of names) {
      const m = NAME.exec(n);
      if (!m) continue;
      const id = n.slice(0, -5);
      const pid = Number(m[1]);
      if (id === this.ownId || (await this.isRunning(id, pid))) continue;
      const st = await fs.stat(path.join(this.dir, n));
      out.push({ id, pid, modifiedMs: st.mtimeMs, sizeBytes: st.size });
    }
    return out.sort((a, b) => b.modifiedMs - a.modifiedMs);
  }

  async read(id: string): Promise<string> {
    return fs.readFile(this.file(id), 'utf8');
  }

  /** Delete a recovery copy that the user chose to discard (or has recovered). */
  async remove(id: string): Promise<void> {
    if (id === this.ownId) return;
    await fs.rm(this.file(id), { force: true });
    await fs.rm(this.heartbeatFile(id), { force: true });
  }
}
