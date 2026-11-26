import type { DrawingDocument } from '../model/types';
import { parseProject, type LoadedProject } from './documentStorage';

/**
 * Autosave record format and scheduling rules (pure). The record wraps the normal
 * project text plus where it came from, so recovery never needs the original file.
 */
export const AUTOSAVE_FORMAT = 'a3-precision-drawing-autosave';
export const DEFAULT_AUTOSAVE_INTERVAL_MS = 2 * 60 * 1000;

export interface AutosaveRecord {
  readonly format: typeof AUTOSAVE_FORMAT;
  readonly version: 1;
  readonly savedAt: string;
  readonly fileName: string;
  /** Project file the drawing belongs to (null = never saved). Never written by autosave. */
  readonly filePath: string | null;
  /** Complete project text (native .a3d format). */
  readonly project: string;
}

export function makeAutosaveRecord(project: string, fileName: string, filePath: string | null, now: Date): string {
  const rec: AutosaveRecord = { format: AUTOSAVE_FORMAT, version: 1, savedAt: now.toISOString(), fileName, filePath, project };
  return JSON.stringify(rec);
}

export interface RecoveredDrawing {
  readonly record: AutosaveRecord;
  readonly loaded: LoadedProject;
}

/** Parse and fully validate a recovery file (record AND the project inside it). */
export function parseAutosaveRecord(text: string): RecoveredDrawing {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('The recovery file is damaged (not valid JSON)');
  }
  const r = raw as Partial<AutosaveRecord>;
  if (!r || r.format !== AUTOSAVE_FORMAT || r.version !== 1) throw new Error('Not an autosave recovery file');
  if (typeof r.project !== 'string' || typeof r.fileName !== 'string' || typeof r.savedAt !== 'string') throw new Error('The recovery file is incomplete');
  if (r.filePath !== null && typeof r.filePath !== 'string') throw new Error('The recovery file is incomplete');
  return { record: r as AutosaveRecord, loaded: parseProject(r.project) };
}

export interface AutosaveState {
  readonly enabled: boolean;
  readonly dirty: boolean;
  readonly doc: DrawingDocument;
  /** Document captured by the last successful autosave (null = none this session). */
  readonly lastDoc: DrawingDocument | null;
  readonly lastAtMs: number;
  readonly nowMs: number;
  readonly intervalMs: number;
  /** True while a drag/edit is in progress (never autosave a half-finished gesture). */
  readonly editing: boolean;
}

/** Autosave when enabled, modified since the last save AND since the last autosave, and the interval has passed. */
export function autosaveDue(s: AutosaveState): boolean {
  return s.enabled && s.dirty && !s.editing && s.doc !== s.lastDoc && s.nowMs - s.lastAtMs >= s.intervalMs;
}
