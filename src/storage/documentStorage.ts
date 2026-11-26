import { isValidScale } from '../geometry/scale';
import type { Vec2 } from '../geometry/vec';
import type { DrawingDocument, Shape, ShapeStyle } from '../model/types';

/**
 * Document storage format (*.a3d): UTF-8 JSON.
 * Pure functions – no file system access here (see fileService.ts).
 */
export const FILE_FORMAT_ID = 'a3-precision-drawing';
export const FILE_FORMAT_VERSION = 1;
export const FILE_EXTENSION = 'a3d';

export class DocumentFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentFormatError';
  }
}

interface StoredFile {
  format: string;
  formatVersion: number;
  units: 'mm';
  page: { widthMm: number; heightMm: number };
  scale: { paper: number; real: number };
  shapes: Shape[];
}

export function serializeDocument(doc: DrawingDocument): string {
  const file: StoredFile = {
    format: FILE_FORMAT_ID,
    formatVersion: FILE_FORMAT_VERSION,
    units: 'mm',
    page: { widthMm: doc.page.widthMm, heightMm: doc.page.heightMm },
    scale: { paper: doc.scale.paper, real: doc.scale.real },
    shapes: doc.shapes as Shape[],
  };
  return JSON.stringify(file, null, 2);
}

// ---------- validation helpers ----------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(o: Obj, key: string, where: string, opts: { min?: number } = {}): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new DocumentFormatError(`${where}: "${key}" must be a finite number`);
  if (opts.min !== undefined && v < opts.min) throw new DocumentFormatError(`${where}: "${key}" must be >= ${opts.min}`);
  return v;
}

function point(v: unknown, where: string): Vec2 {
  if (!isObj(v)) throw new DocumentFormatError(`${where}: expected a point {x, y}`);
  return { x: num(v, 'x', where), y: num(v, 'y', where) };
}

function style(v: unknown, where: string): ShapeStyle {
  if (!isObj(v)) throw new DocumentFormatError(`${where}: missing style`);
  if (typeof v.stroke !== 'string') throw new DocumentFormatError(`${where}: style.stroke must be a string`);
  return { stroke: v.stroke, strokeWidthMm: num(v, 'strokeWidthMm', `${where} style`, { min: 0 }) };
}

function shape(v: unknown, index: number): Shape {
  const where = `shapes[${index}]`;
  if (!isObj(v)) throw new DocumentFormatError(`${where}: expected an object`);
  if (typeof v.id !== 'string' || v.id === '') throw new DocumentFormatError(`${where}: missing id`);
  const base = { id: v.id, style: style(v.style, where) };
  switch (v.kind) {
    case 'line':
      return { ...base, kind: 'line', start: point(v.start, where), end: point(v.end, where) };
    case 'rect':
      return {
        ...base,
        kind: 'rect',
        origin: point(v.origin, where),
        width: num(v, 'width', where, { min: 0 }),
        height: num(v, 'height', where, { min: 0 }),
        rotationDeg: num(v, 'rotationDeg', where),
      };
    case 'circle':
      return { ...base, kind: 'circle', center: point(v.center, where), radius: num(v, 'radius', where, { min: 0 }) };
    case 'polyline': {
      if (!Array.isArray(v.points) || v.points.length < 1) throw new DocumentFormatError(`${where}: points must be a non-empty array`);
      return { ...base, kind: 'polyline', points: v.points.map((p, i) => point(p, `${where}.points[${i}]`)) };
    }
    default:
      throw new DocumentFormatError(`${where}: unknown shape kind "${String(v.kind)}"`);
  }
}

/** Parse and validate a stored document. Throws DocumentFormatError on any problem. */
export function parseDocument(text: string): DrawingDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DocumentFormatError('File is not valid JSON');
  }
  if (!isObj(raw) || raw.format !== FILE_FORMAT_ID) throw new DocumentFormatError('Not an A3 Precision Drawing Studio file');
  if (raw.formatVersion !== FILE_FORMAT_VERSION) {
    throw new DocumentFormatError(`Unsupported file version ${String(raw.formatVersion)}`);
  }
  if (!isObj(raw.page)) throw new DocumentFormatError('Missing page');
  if (!isObj(raw.scale)) throw new DocumentFormatError('Missing scale');
  const page = { widthMm: num(raw.page, 'widthMm', 'page', { min: 1 }), heightMm: num(raw.page, 'heightMm', 'page', { min: 1 }) };
  const scale = { paper: num(raw.scale, 'paper', 'scale'), real: num(raw.scale, 'real', 'scale') };
  if (!isValidScale(scale)) throw new DocumentFormatError('Invalid drawing scale');
  if (!Array.isArray(raw.shapes)) throw new DocumentFormatError('Missing shapes');
  const shapes = raw.shapes.map(shape);
  const ids = new Set<string>();
  for (const s of shapes) {
    if (ids.has(s.id)) throw new DocumentFormatError(`Duplicate shape id "${s.id}"`);
    ids.add(s.id);
  }
  return { page, scale, shapes };
}
