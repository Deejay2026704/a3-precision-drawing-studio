import { isValidScale } from '../geometry/scale';
import type { Vec2 } from '../geometry/vec';
import { DEFAULT_SNAP_SETTINGS, OBJECT_SNAP_KINDS, type ObjectSnapKind } from '../model/snap';
import { constraintShapeIds } from '../model/layers';
import {
  DEFAULT_LAYER,
  DEFAULT_TITLE_BLOCK,
  TITLE_BLOCK_FIELDS,
  type TitleBlock,
  type ArrowheadStyle,
  type Constraint,
  type DimAnchor,
  type Dimension,
  type DimensionStyle,
  type DrawingDocument,
  type Layer,
  type PageOrientation,
  type PointRef,
  type Shape,
  type ShapeStyle,
} from '../model/types';

/**
 * Native project format (*.a3d): UTF-8 JSON.
 *
 *   v1 (Milestone 1)  page, scale, shapes
 *   v2 (Milestone 2)  + dimensions
 *   v3 (Milestone 3)  + layers, layerId on objects, constraints, page.orientation,
 *                       settings { activeLayerId, display preferences }
 *   v4 (Milestone 5)  + arc shapes, radius / line-angle constraints, title block
 *
 * Older files are MIGRATED in memory (the file on disk is not touched); files from a
 * newer version are refused. Validation reports the exact path of the first problem.
 * Problems that can be repaired without losing data (e.g. an object on an unknown
 * layer) are repaired and reported as warnings – never silently.
 * Pure functions – no file system access here (see fileService.ts).
 */
export const FILE_FORMAT_ID = 'a3-precision-drawing';
export const FILE_FORMAT_VERSION = 4;
export const SUPPORTED_FORMAT_VERSIONS: readonly number[] = [1, 2, 3, 4];
export const FILE_EXTENSION = 'a3d';

export class DocumentFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentFormatError';
  }
}

/** Display preferences saved with the project. */
export interface DisplayPrefs {
  readonly showGrid: boolean;
  readonly gridSpacingMm: number;
  readonly gridSnap: boolean;
  readonly gridSnapStepMm: number;
  readonly objectSnap: boolean;
  readonly osnap: Readonly<Record<ObjectSnapKind, boolean>>;
}

export interface ProjectSettings {
  readonly activeLayerId: string;
  readonly display: DisplayPrefs;
}

export const DEFAULT_DISPLAY: DisplayPrefs = {
  showGrid: true,
  gridSpacingMm: 10,
  gridSnap: true,
  gridSnapStepMm: 1,
  objectSnap: DEFAULT_SNAP_SETTINGS.objectSnap,
  osnap: DEFAULT_SNAP_SETTINGS.kinds,
};

export const defaultSettings = (doc: Pick<DrawingDocument, 'layers'>): ProjectSettings => ({
  activeLayerId: doc.layers[0]?.id ?? DEFAULT_LAYER.id,
  display: DEFAULT_DISPLAY,
});

export interface LoadedProject {
  readonly doc: DrawingDocument;
  readonly settings: ProjectSettings;
  /** Format version found in the file (< FILE_FORMAT_VERSION means it was migrated). */
  readonly sourceVersion: number;
  /** Non-fatal issues that were repaired or need the user's attention. */
  readonly warnings: readonly string[];
}

export const orientationOf = (page: { widthMm: number; heightMm: number }): PageOrientation =>
  page.widthMm >= page.heightMm ? 'landscape' : 'portrait';

// ---------------------------------------------------------------------------
// Serialise
// ---------------------------------------------------------------------------

export function serializeProject(doc: DrawingDocument, settings: ProjectSettings = defaultSettings(doc)): string {
  const fallback = doc.layers[0]?.id ?? DEFAULT_LAYER.id;
  const file = {
    format: FILE_FORMAT_ID,
    formatVersion: FILE_FORMAT_VERSION,
    units: 'mm',
    page: { widthMm: doc.page.widthMm, heightMm: doc.page.heightMm, orientation: orientationOf(doc.page) },
    scale: { paper: doc.scale.paper, real: doc.scale.real },
    layers: doc.layers,
    // Every object is written with an explicit layer.
    shapes: doc.shapes.map((s) => ({ ...s, layerId: s.layerId ?? fallback })),
    dimensions: doc.dimensions.map((d) => ({ ...d, layerId: d.layerId ?? fallback })),
    constraints: doc.constraints,
    titleBlock: doc.titleBlock,
    settings: {
      activeLayerId: doc.layers.some((l) => l.id === settings.activeLayerId) ? settings.activeLayerId : fallback,
      display: settings.display,
    },
  };
  return JSON.stringify(file, canonicalKeys, 2);
}

/**
 * JSON replacer: nested object keys in sorted order (top level keeps its header order),
 * so an unchanged project always saves byte-for-byte identically.
 */
function canonicalKeys(this: unknown, key: string, value: unknown): unknown {
  if (key === '' || !isObj(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, value[k]]));
}

/** Serialise with default settings (kept for callers that have no editor settings). */
export const serializeDocument = (doc: DrawingDocument): string => serializeProject(doc);

// ---------------------------------------------------------------------------
// Validation helpers (every error names the exact path)
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const err = (where: string, msg: string) => new DocumentFormatError(`${where}: ${msg}`);

function num(o: Obj, key: string, where: string, opts: { min?: number; gt?: number } = {}): number {
  const v = o[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw err(`${where}.${key}`, 'must be a finite number');
  if (opts.min !== undefined && v < opts.min) throw err(`${where}.${key}`, `must be ≥ ${opts.min}`);
  if (opts.gt !== undefined && v <= opts.gt) throw err(`${where}.${key}`, `must be > ${opts.gt}`);
  return v;
}
const str = (o: Obj, key: string, where: string): string => {
  if (typeof o[key] !== 'string' || o[key] === '') throw err(`${where}.${key}`, 'must be a non-empty string');
  return o[key] as string;
};
const bool = (o: Obj, key: string, where: string): boolean => {
  if (typeof o[key] !== 'boolean') throw err(`${where}.${key}`, 'must be true or false');
  return o[key] as boolean;
};
const obj = (v: unknown, where: string): Obj => {
  if (!isObj(v)) throw err(where, 'must be an object');
  return v;
};
const arr = (v: unknown, where: string): unknown[] => {
  if (!Array.isArray(v)) throw err(where, 'must be an array');
  return v;
};
const color = (o: Obj, key: string, where: string): string => {
  const c = str(o, key, where);
  if (!/^#[0-9a-fA-F]{6}$/.test(c)) throw err(`${where}.${key}`, 'must be a colour like #1A2B3C');
  return c;
};

function point(v: unknown, where: string): Vec2 {
  const o = obj(v, where);
  return { x: num(o, 'x', where), y: num(o, 'y', where) };
}

function style(v: unknown, where: string): ShapeStyle {
  const o = obj(v, `${where}.style`);
  return { stroke: str(o, 'stroke', `${where}.style`), strokeWidthMm: num(o, 'strokeWidthMm', `${where}.style`, { min: 0 }) };
}

const layerIdOf = (o: Obj, where: string): { layerId?: string } => {
  if (o.layerId === undefined) return {};
  return { layerId: str(o, 'layerId', where) };
};

function shape(v: unknown, index: number): Shape {
  const where = `shapes[${index}]`;
  const o = obj(v, where);
  const base = { id: str(o, 'id', where), style: style(o.style, where), ...layerIdOf(o, where) };
  switch (o.kind) {
    case 'line':
      return { ...base, kind: 'line', start: point(o.start, `${where}.start`), end: point(o.end, `${where}.end`) };
    case 'rect':
      return {
        ...base,
        kind: 'rect',
        origin: point(o.origin, `${where}.origin`),
        width: num(o, 'width', where, { min: 0 }),
        height: num(o, 'height', where, { min: 0 }),
        rotationDeg: num(o, 'rotationDeg', where),
      };
    case 'circle':
      return { ...base, kind: 'circle', center: point(o.center, `${where}.center`), radius: num(o, 'radius', where, { min: 0 }) };
    case 'arc': {
      const sweepDeg = num(o, 'sweepDeg', where, { gt: 0 });
      if (sweepDeg >= 360) throw err(`${where}.sweepDeg`, 'must be less than 360');
      return {
        ...base,
        kind: 'arc',
        center: point(o.center, `${where}.center`),
        radius: num(o, 'radius', where, { gt: 0 }),
        startDeg: num(o, 'startDeg', where),
        sweepDeg,
      };
    }
    case 'polyline': {
      const pts = arr(o.points, `${where}.points`);
      if (pts.length < 1) throw err(`${where}.points`, 'must contain at least one point');
      return { ...base, kind: 'polyline', points: pts.map((p, i) => point(p, `${where}.points[${i}]`)) };
    }
    default:
      throw err(`${where}.kind`, `unknown shape kind "${String(o.kind)}"`);
  }
}

const ARROWHEADS: readonly ArrowheadStyle[] = ['closed', 'open', 'tick', 'dot', 'none'];

function dimStyle(v: unknown, where: string): DimensionStyle {
  const w = `${where}.style`;
  const o = obj(v, w);
  if (typeof o.color !== 'string') throw err(`${w}.color`, 'must be a string');
  if (!ARROWHEADS.includes(o.arrowhead as ArrowheadStyle)) throw err(`${w}.arrowhead`, `must be one of ${ARROWHEADS.join(', ')}`);
  const decimals = num(o, 'decimals', w, { min: 0 });
  if (!Number.isInteger(decimals) || decimals > 6) throw err(`${w}.decimals`, 'must be an integer 0–6');
  return {
    color: o.color,
    textHeightMm: num(o, 'textHeightMm', w, { min: 0 }),
    decimals,
    arrowSizeMm: num(o, 'arrowSizeMm', w, { min: 0 }),
    arrowhead: o.arrowhead as ArrowheadStyle,
    showExtensionLines: bool(o, 'showExtensionLines', w),
    extensionGapMm: num(o, 'extensionGapMm', w, { min: 0 }),
    extensionOvershootMm: num(o, 'extensionOvershootMm', w, { min: 0 }),
  };
}

function anchor(v: unknown, where: string): DimAnchor {
  const o = obj(v, where);
  if (o.kind === 'point') return { kind: 'point', point: point(o.point, `${where}.point`) };
  if (o.kind === 'shape') return { kind: 'shape', shapeId: str(o, 'shapeId', where), key: str(o, 'key', where) };
  throw err(`${where}.kind`, 'must be "point" or "shape"');
}

const sign = (o: Obj, key: string, where: string): 1 | -1 => {
  if (o[key] !== 1 && o[key] !== -1) throw err(`${where}.${key}`, 'must be 1 or -1');
  return o[key] as 1 | -1;
};

function dimension(v: unknown, index: number): Dimension {
  const where = `dimensions[${index}]`;
  const o = obj(v, where);
  if (o.mode !== 'driven') throw err(`${where}.mode`, `unsupported dimension mode "${String(o.mode)}"`);
  const base = { id: str(o, 'id', where), mode: 'driven' as const, style: dimStyle(o.style, where), textShift: num(o, 'textShift', where), ...layerIdOf(o, where) };
  switch (o.kind) {
    case 'aligned':
    case 'horizontal':
    case 'vertical':
      return { ...base, kind: o.kind, p1: anchor(o.p1, `${where}.p1`), p2: anchor(o.p2, `${where}.p2`), offset: num(o, 'offset', where) };
    case 'radius':
    case 'diameter':
      return { ...base, kind: o.kind, circleId: str(o, 'circleId', where), angleDeg: num(o, 'angleDeg', where) };
    case 'angular':
      return {
        ...base,
        kind: 'angular',
        line1Id: str(o, 'line1Id', where),
        line2Id: str(o, 'line2Id', where),
        sign1: sign(o, 'sign1', where),
        sign2: sign(o, 'sign2', where),
        radius: num(o, 'radius', where, { min: 0 }),
      };
    default:
      throw err(`${where}.kind`, `unknown dimension kind "${String(o.kind)}"`);
  }
}

function layer(v: unknown, index: number): Layer {
  const where = `layers[${index}]`;
  const o = obj(v, where);
  const name = str(o, 'name', where).trim();
  if (!name) throw err(`${where}.name`, 'must not be blank');
  return { id: str(o, 'id', where), name, visible: bool(o, 'visible', where), locked: bool(o, 'locked', where), color: color(o, 'color', where) };
}

const POINT_KEYS = ['start', 'end', 'mid', 'center'] as const;
function pointRef(v: unknown, where: string): PointRef {
  const o = obj(v, where);
  if (!POINT_KEYS.includes(o.key as (typeof POINT_KEYS)[number])) throw err(`${where}.key`, `must be one of ${POINT_KEYS.join(', ')}`);
  return { shapeId: str(o, 'shapeId', where), key: o.key as PointRef['key'] };
}

function constraint(v: unknown, index: number): Constraint {
  const where = `constraints[${index}]`;
  const o = obj(v, where);
  const base = { id: str(o, 'id', where), suppressed: bool(o, 'suppressed', where) };
  switch (o.kind) {
    case 'horizontal':
    case 'vertical':
      return { ...base, kind: o.kind, line: str(o, 'line', where) };
    case 'parallel':
    case 'perpendicular':
    case 'equal-length':
      return { ...base, kind: o.kind, a: str(o, 'a', where), b: str(o, 'b', where) };
    case 'tangent':
      return { ...base, kind: 'tangent', a: str(o, 'a', where), b: str(o, 'b', where), internal: bool(o, 'internal', where) };
    case 'coincident':
      return { ...base, kind: 'coincident', p: pointRef(o.p, `${where}.p`), q: pointRef(o.q, `${where}.q`) };
    case 'fixed-length':
      return { ...base, kind: 'fixed-length', line: str(o, 'line', where), value: num(o, 'value', where, { gt: 0 }) };
    case 'fixed-angle':
      return { ...base, kind: 'fixed-angle', line: str(o, 'line', where), value: num(o, 'value', where) };
    case 'fixed-position':
      return { ...base, kind: 'fixed-position', p: pointRef(o.p, `${where}.p`), x: num(o, 'x', where), y: num(o, 'y', where) };
    case 'fixed-radius':
      return { ...base, kind: 'fixed-radius', shape: str(o, 'shape', where), value: num(o, 'value', where, { gt: 0 }) };
    case 'angle': {
      const value = num(o, 'value', where, { min: 0 });
      if (value > 180) throw err(`${where}.value`, 'must be between 0 and 180');
      return { ...base, kind: 'angle', a: str(o, 'a', where), b: str(o, 'b', where), value };
    }
    default:
      throw err(`${where}.kind`, `unknown constraint kind "${String(o.kind)}"`);
  }
}

function display(v: unknown, warnings: string[]): DisplayPrefs {
  if (v === undefined) return DEFAULT_DISPLAY;
  const where = 'settings.display';
  const o = obj(v, where);
  const osnapIn = o.osnap === undefined ? {} : obj(o.osnap, `${where}.osnap`);
  const osnap = Object.fromEntries(
    OBJECT_SNAP_KINDS.map((k) => {
      if (osnapIn[k] === undefined) return [k, DEFAULT_DISPLAY.osnap[k]];
      if (typeof osnapIn[k] !== 'boolean') throw err(`${where}.osnap.${k}`, 'must be true or false');
      return [k, osnapIn[k]];
    }),
  ) as Record<ObjectSnapKind, boolean>;
  const pick = <T>(key: keyof DisplayPrefs, read: () => T, fallback: T): T => {
    if (o[key] === undefined) {
      warnings.push(`Display setting "${key}" missing – default used`);
      return fallback;
    }
    return read();
  };
  return {
    showGrid: pick('showGrid', () => bool(o, 'showGrid', where), DEFAULT_DISPLAY.showGrid),
    gridSpacingMm: pick('gridSpacingMm', () => num(o, 'gridSpacingMm', where, { gt: 0 }), DEFAULT_DISPLAY.gridSpacingMm),
    gridSnap: pick('gridSnap', () => bool(o, 'gridSnap', where), DEFAULT_DISPLAY.gridSnap),
    gridSnapStepMm: pick('gridSnapStepMm', () => num(o, 'gridSnapStepMm', where, { gt: 0 }), DEFAULT_DISPLAY.gridSnapStepMm),
    objectSnap: pick('objectSnap', () => bool(o, 'objectSnap', where), DEFAULT_DISPLAY.objectSnap),
    osnap,
  };
}

// ---------------------------------------------------------------------------
// Migration (raw JSON, version by version)
// ---------------------------------------------------------------------------

/** v1 → v2: dimensions were introduced. */
function migrate1to2(raw: Obj): Obj {
  return { ...raw, formatVersion: 2, dimensions: [] };
}

/** v2 → v3: everything goes onto one default layer; no constraints; orientation derived. */
function migrate2to3(raw: Obj): Obj {
  const page = isObj(raw.page) ? raw.page : {};
  const withLayer = (items: unknown) =>
    Array.isArray(items) ? items.map((x) => (isObj(x) && x.layerId === undefined ? { ...x, layerId: DEFAULT_LAYER.id } : x)) : items;
  return {
    ...raw,
    formatVersion: 3,
    page: typeof page.widthMm === 'number' && typeof page.heightMm === 'number' ? { ...page, orientation: orientationOf(page as { widthMm: number; heightMm: number }) } : page,
    layers: [DEFAULT_LAYER],
    shapes: withLayer(raw.shapes),
    dimensions: withLayer(raw.dimensions),
    constraints: [],
    settings: { activeLayerId: DEFAULT_LAYER.id, display: DEFAULT_DISPLAY },
  };
}

/** v3 → v4: arcs and new constraint kinds are additive; the (hidden) title block is added. */
function migrate3to4(raw: Obj): Obj {
  return { ...raw, formatVersion: 4, titleBlock: DEFAULT_TITLE_BLOCK };
}

function titleBlock(v: unknown): TitleBlock {
  const where = 'titleBlock';
  const o = obj(v, where);
  const out: Record<string, unknown> = { visible: bool(o, 'visible', where) };
  for (const f of TITLE_BLOCK_FIELDS) {
    const val = o[f.key];
    if (typeof val !== 'string') throw err(`${where}.${f.key}`, 'must be text');
    if (val.length > f.max) throw err(`${where}.${f.key}`, `must be at most ${f.max} characters`);
    out[f.key] = val;
  }
  return out as unknown as TitleBlock;
}

const MIGRATIONS: Record<number, (raw: Obj) => Obj> = { 1: migrate1to2, 2: migrate2to3, 3: migrate3to4 };

export function migrateRaw(raw: Obj): Obj {
  let cur = raw;
  while ((cur.formatVersion as number) < FILE_FORMAT_VERSION) {
    const step = MIGRATIONS[cur.formatVersion as number];
    if (!step) throw new DocumentFormatError(`No migration from format version ${String(cur.formatVersion)}`);
    cur = step(cur);
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/** Parse, migrate and validate a project. Throws DocumentFormatError with a useful message. */
export function parseProject(text: string): LoadedProject {
  if (text.trim() === '') throw new DocumentFormatError('The file is empty');
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new DocumentFormatError(`The file is not valid JSON (it may be truncated or damaged): ${(e as Error).message}`);
  }
  if (!isObj(raw) || raw.format !== FILE_FORMAT_ID) throw new DocumentFormatError('Not an A3 Precision Drawing Studio file');
  const version = raw.formatVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw new DocumentFormatError('formatVersion: missing or invalid');
  if (version > FILE_FORMAT_VERSION) {
    throw new DocumentFormatError(
      `This file was saved by a newer version of the application (format ${version}). This version can open formats up to ${FILE_FORMAT_VERSION}. The file was not changed.`,
    );
  }
  if (!SUPPORTED_FORMAT_VERSIONS.includes(version)) throw new DocumentFormatError(`Unsupported file version ${version}`);
  if (raw.units !== undefined && raw.units !== 'mm') throw err('units', `unsupported unit "${String(raw.units)}" (only mm)`);

  const warnings: string[] = [];
  const m = migrateRaw(raw);
  if (version < FILE_FORMAT_VERSION) warnings.push(`Upgraded from format version ${version} to ${FILE_FORMAT_VERSION}. The original file is unchanged until you save.`);

  const pageO = obj(m.page, 'page');
  const page = { widthMm: num(pageO, 'widthMm', 'page', { min: 1 }), heightMm: num(pageO, 'heightMm', 'page', { min: 1 }) };
  if (pageO.orientation !== undefined && pageO.orientation !== orientationOf(page)) {
    throw err('page.orientation', `"${String(pageO.orientation)}" does not match the page size ${page.widthMm} × ${page.heightMm} mm`);
  }
  const scaleO = obj(m.scale, 'scale');
  const scale = { paper: num(scaleO, 'paper', 'scale'), real: num(scaleO, 'real', 'scale') };
  if (!isValidScale(scale)) throw err('scale', 'paper and real must both be greater than zero');

  const layers = arr(m.layers, 'layers').map(layer);
  if (layers.length === 0) throw err('layers', 'must contain at least one layer');
  const layerIds = new Set<string>();
  const layerNames = new Set<string>();
  layers.forEach((l, i) => {
    if (layerIds.has(l.id)) throw err(`layers[${i}].id`, `duplicate layer id "${l.id}"`);
    if (layerNames.has(l.name.toLowerCase())) throw err(`layers[${i}].name`, `duplicate layer name "${l.name}"`);
    layerIds.add(l.id);
    layerNames.add(l.name.toLowerCase());
  });

  const fixLayer = <T extends { id: string; layerId?: string }>(x: T, what: string): T => {
    if (x.layerId !== undefined && layerIds.has(x.layerId)) return x;
    warnings.push(`${what} "${x.id}" was on unknown layer "${String(x.layerId)}" – moved to "${layers[0].name}"`);
    return { ...x, layerId: layers[0].id };
  };
  const shapes = arr(m.shapes, 'shapes').map(shape).map((s) => fixLayer(s, 'Object'));
  const dimensions = arr(m.dimensions, 'dimensions').map(dimension).map((d) => fixLayer(d, 'Dimension'));
  const constraints = arr(m.constraints, 'constraints').map(constraint);

  const ids = new Set<string>();
  for (const x of [...shapes, ...dimensions, ...constraints]) {
    if (ids.has(x.id)) throw new DocumentFormatError(`Duplicate object id "${x.id}"`);
    ids.add(x.id);
  }
  const shapeIds = new Set(shapes.map((s) => s.id));
  const refsOf = (c: Constraint): string[] => constraintShapeIds(c);
  for (const c of constraints) {
    const missing = refsOf(c).filter((id) => !shapeIds.has(id));
    if (missing.length) warnings.push(`Constraint "${c.id}" refers to missing object(s) ${missing.join(', ')} – shown as broken`);
  }

  const settingsO = m.settings === undefined ? {} : obj(m.settings, 'settings');
  let activeLayerId = typeof settingsO.activeLayerId === 'string' ? settingsO.activeLayerId : layers[0].id;
  if (!layerIds.has(activeLayerId)) {
    warnings.push(`Active layer "${activeLayerId}" not found – using "${layers[0].name}"`);
    activeLayerId = layers[0].id;
  }
  const settings: ProjectSettings = { activeLayerId, display: display(settingsO.display, warnings) };

  return { doc: { page, scale, layers, shapes, dimensions, constraints, titleBlock: titleBlock(m.titleBlock) }, settings, sourceVersion: version, warnings };
}

/** Parse and return only the document (compatibility helper). */
export const parseDocument = (text: string): DrawingDocument => parseProject(text).doc;
