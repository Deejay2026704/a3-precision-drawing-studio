import { isValidScale } from '../geometry/scale';
import type { Vec2 } from '../geometry/vec';
import type { ArrowheadStyle, DimAnchor, Dimension, DimensionStyle, DrawingDocument, Shape, ShapeStyle } from '../model/types';

/**
 * Document storage format (*.a3d): UTF-8 JSON.
 * Pure functions – no file system access here (see fileService.ts).
 */
export const FILE_FORMAT_ID = 'a3-precision-drawing';
/** Version 2 (Milestone 2) adds `dimensions`. Version 1 files are still read. */
export const FILE_FORMAT_VERSION = 2;
export const SUPPORTED_FORMAT_VERSIONS: readonly number[] = [1, 2];
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
  dimensions: Dimension[];
}

export function serializeDocument(doc: DrawingDocument): string {
  const file: StoredFile = {
    format: FILE_FORMAT_ID,
    formatVersion: FILE_FORMAT_VERSION,
    units: 'mm',
    page: { widthMm: doc.page.widthMm, heightMm: doc.page.heightMm },
    scale: { paper: doc.scale.paper, real: doc.scale.real },
    shapes: doc.shapes as Shape[],
    dimensions: doc.dimensions as Dimension[],
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

const ARROWHEADS: readonly ArrowheadStyle[] = ['closed', 'open', 'tick', 'dot', 'none'];

function dimStyle(v: unknown, where: string): DimensionStyle {
  if (!isObj(v)) throw new DocumentFormatError(`${where}: missing style`);
  if (typeof v.color !== 'string') throw new DocumentFormatError(`${where}: style.color must be a string`);
  if (!ARROWHEADS.includes(v.arrowhead as ArrowheadStyle)) throw new DocumentFormatError(`${where}: unknown arrowhead`);
  if (typeof v.showExtensionLines !== 'boolean') throw new DocumentFormatError(`${where}: showExtensionLines must be boolean`);
  const decimals = num(v, 'decimals', where, { min: 0 });
  if (!Number.isInteger(decimals) || decimals > 6) throw new DocumentFormatError(`${where}: decimals must be an integer 0–6`);
  return {
    color: v.color,
    textHeightMm: num(v, 'textHeightMm', where, { min: 0 }),
    decimals,
    arrowSizeMm: num(v, 'arrowSizeMm', where, { min: 0 }),
    arrowhead: v.arrowhead as ArrowheadStyle,
    showExtensionLines: v.showExtensionLines,
    extensionGapMm: num(v, 'extensionGapMm', where, { min: 0 }),
    extensionOvershootMm: num(v, 'extensionOvershootMm', where, { min: 0 }),
  };
}

function anchor(v: unknown, where: string): DimAnchor {
  if (!isObj(v)) throw new DocumentFormatError(`${where}: expected an anchor`);
  if (v.kind === 'point') return { kind: 'point', point: point(v.point, where) };
  if (v.kind === 'shape' && typeof v.shapeId === 'string' && typeof v.key === 'string') return { kind: 'shape', shapeId: v.shapeId, key: v.key };
  throw new DocumentFormatError(`${where}: invalid anchor`);
}

const str = (o: Obj, key: string, where: string): string => {
  if (typeof o[key] !== 'string' || o[key] === '') throw new DocumentFormatError(`${where}: "${key}" must be a non-empty string`);
  return o[key] as string;
};
const sign = (o: Obj, key: string, where: string): 1 | -1 => {
  if (o[key] !== 1 && o[key] !== -1) throw new DocumentFormatError(`${where}: "${key}" must be 1 or -1`);
  return o[key] as 1 | -1;
};

function dimension(v: unknown, index: number): Dimension {
  const where = `dimensions[${index}]`;
  if (!isObj(v)) throw new DocumentFormatError(`${where}: expected an object`);
  if (v.mode !== 'driven') throw new DocumentFormatError(`${where}: unsupported dimension mode "${String(v.mode)}"`);
  const base = { id: str(v, 'id', where), mode: 'driven' as const, style: dimStyle(v.style, where), textShift: num(v, 'textShift', where) };
  switch (v.kind) {
    case 'aligned':
    case 'horizontal':
    case 'vertical':
      return { ...base, kind: v.kind, p1: anchor(v.p1, where), p2: anchor(v.p2, where), offset: num(v, 'offset', where) };
    case 'radius':
    case 'diameter':
      return { ...base, kind: v.kind, circleId: str(v, 'circleId', where), angleDeg: num(v, 'angleDeg', where) };
    case 'angular':
      return {
        ...base,
        kind: 'angular',
        line1Id: str(v, 'line1Id', where),
        line2Id: str(v, 'line2Id', where),
        sign1: sign(v, 'sign1', where),
        sign2: sign(v, 'sign2', where),
        radius: num(v, 'radius', where, { min: 0 }),
      };
    default:
      throw new DocumentFormatError(`${where}: unknown dimension kind "${String(v.kind)}"`);
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
  if (!SUPPORTED_FORMAT_VERSIONS.includes(raw.formatVersion as number)) {
    throw new DocumentFormatError(`Unsupported file version ${String(raw.formatVersion)}`);
  }
  if (!isObj(raw.page)) throw new DocumentFormatError('Missing page');
  if (!isObj(raw.scale)) throw new DocumentFormatError('Missing scale');
  const page = { widthMm: num(raw.page, 'widthMm', 'page', { min: 1 }), heightMm: num(raw.page, 'heightMm', 'page', { min: 1 }) };
  const scale = { paper: num(raw.scale, 'paper', 'scale'), real: num(raw.scale, 'real', 'scale') };
  if (!isValidScale(scale)) throw new DocumentFormatError('Invalid drawing scale');
  if (!Array.isArray(raw.shapes)) throw new DocumentFormatError('Missing shapes');
  const shapes = raw.shapes.map(shape);
  let dimensions: Dimension[] = [];
  if (raw.formatVersion !== 1) {
    if (!Array.isArray(raw.dimensions)) throw new DocumentFormatError('Missing dimensions');
    dimensions = raw.dimensions.map(dimension);
  }
  const ids = new Set<string>();
  for (const s of [...shapes, ...dimensions]) {
    if (ids.has(s.id)) throw new DocumentFormatError(`Duplicate object id "${s.id}"`);
    ids.add(s.id);
  }
  return { page, scale, shapes, dimensions };
}
