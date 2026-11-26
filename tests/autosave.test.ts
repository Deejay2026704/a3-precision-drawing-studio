import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AutosaveStore, sessionId } from '../electron/autosaveStore';
import { vec } from '../src/geometry/vec';
import { createEmptyDocument } from '../src/model/document';
import { createLine } from '../src/model/shapes';
import { autosaveDue, makeAutosaveRecord, parseAutosaveRecord } from '../src/storage/autosave';
import { serializeProject } from '../src/storage/documentStorage';

const doc = { ...createEmptyDocument(), shapes: [{ ...createLine('a', vec(0, 0), vec(10, 0)), layerId: 'layer-0' }] };

describe('autosave record', () => {
  it('round-trips the drawing and where it came from', () => {
    const text = makeAutosaveRecord(serializeProject(doc), 'plan.a3d', 'C:\\work\\plan.a3d', new Date('2026-11-26T10:00:00Z'));
    const r = parseAutosaveRecord(text);
    expect(r.loaded.doc).toEqual(doc);
    expect(r.record).toMatchObject({ fileName: 'plan.a3d', filePath: 'C:\\work\\plan.a3d', savedAt: '2026-11-26T10:00:00.000Z' });
  });

  it('rejects damaged, foreign and incomplete recovery files (and invalid projects inside)', () => {
    expect(() => parseAutosaveRecord('{')).toThrow(/damaged/);
    expect(() => parseAutosaveRecord('{"format":"x"}')).toThrow(/Not an autosave/);
    expect(() => parseAutosaveRecord(JSON.stringify({ format: 'a3-precision-drawing-autosave', version: 1, fileName: 'x' }))).toThrow(/incomplete/);
    const bad = makeAutosaveRecord('{"format":"a3-precision-drawing","formatVersion":3}', 'x', null, new Date());
    expect(() => parseAutosaveRecord(bad)).toThrow();
  });
});

describe('autosave scheduling', () => {
  const base = { enabled: true, dirty: true, doc, lastDoc: null, lastAtMs: 0, nowMs: 200_000, intervalMs: 120_000, editing: false };
  it('saves a modified drawing once the interval has passed', () => expect(autosaveDue(base)).toBe(true));
  it('not when disabled, unmodified, unchanged since the last autosave, mid-drag, or too soon', () => {
    expect(autosaveDue({ ...base, enabled: false })).toBe(false);
    expect(autosaveDue({ ...base, dirty: false })).toBe(false);
    expect(autosaveDue({ ...base, lastDoc: doc })).toBe(false);
    expect(autosaveDue({ ...base, editing: true })).toBe(false);
    expect(autosaveDue({ ...base, lastAtMs: 150_000 })).toBe(false);
  });
});

describe('autosave store (separate recovery folder)', () => {
  const mk = () => mkdtempSync(path.join(tmpdir(), 'a3-autosave-'));

  it('writes and clears only its own session file, never anything else', async () => {
    const dir = mk();
    writeFileSync(path.join(dir, 'unrelated.a3d'), 'user project');
    const own = sessionId(123, 1000);
    const s = new AutosaveStore(dir, own, () => false);
    await s.write('A');
    await s.write('B');
    expect(readdirSync(dir).sort()).toEqual(['session-123-1000.json', 'unrelated.a3d']);
    await s.clear();
    expect(readdirSync(dir)).toEqual(['unrelated.a3d']);
  });

  it('offers files from sessions that are no longer running, newest first; never its own or a live one', async () => {
    const dir = mk();
    const alive = new Set([222]);
    const s = new AutosaveStore(dir, sessionId(999, 1), (pid) => alive.has(pid));
    await s.write('own');
    writeFileSync(path.join(dir, 'session-111-5.json'), 'crashed older');
    writeFileSync(path.join(dir, 'session-333-6.json'), 'crashed newer');
    writeFileSync(path.join(dir, 'session-222-7.json'), 'other running instance');
    utimesSync(path.join(dir, 'session-111-5.json'), 1000, 1000);
    utimesSync(path.join(dir, 'session-333-6.json'), 2000, 2000);
    const o = await s.orphans();
    expect(o.map((x) => x.id)).toEqual(['session-333-6', 'session-111-5']);
    expect(await s.read('session-111-5')).toBe('crashed older');
    await s.remove('session-111-5');
    expect((await s.orphans()).map((x) => x.id)).toEqual(['session-333-6']);
  });

  it('a missing folder means no orphans; ids cannot escape the folder', async () => {
    const s = new AutosaveStore(path.join(mk(), 'nope'), sessionId(1, 1));
    expect(await s.orphans()).toEqual([]);
    await expect(s.read('../../etc/passwd')).rejects.toThrow(/Invalid autosave id/);
  });
});

import { createInitialState, editorReducer, isDirty } from '../src/ui/state/editorReducer';

describe('recovered drawings in the editor store', () => {
  it('a recovered drawing opens as MODIFIED, keeps its original path, and is clean only after saving', () => {
    let s = editorReducer(createInitialState(), { type: 'loadDocument', doc, path: '/p/plan.a3d', name: 'plan.a3d', recovered: true });
    expect(s.recovered).toBe(true);
    expect(isDirty(s)).toBe(true);
    expect(s.filePath).toBe('/p/plan.a3d');
    s = editorReducer(s, { type: 'markSaved', path: '/p/plan.a3d', name: 'plan.a3d' });
    expect(s.recovered).toBe(false);
    expect(isDirty(s)).toBe(false);
  });
  it('a normally opened drawing is not marked recovered or modified', () => {
    const s = editorReducer(createInitialState(), { type: 'loadDocument', doc, path: '/p/x.a3d', name: 'x.a3d' });
    expect(s.recovered).toBe(false);
    expect(isDirty(s)).toBe(false);
  });
});
