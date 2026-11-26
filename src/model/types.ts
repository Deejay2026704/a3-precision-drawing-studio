import type { DrawingScale } from '../geometry/scale';
import type { PageSize } from '../geometry/page';
import type { Vec2 } from '../geometry/vec';

export type ShapeId = string;
export type LayerId = string;

/** Stroke value meaning "use the layer's display colour". */
export const BY_LAYER = 'bylayer';

export type FillPattern = 'solid' | 'hatch' | 'crosshatch';

/** Area fill of a closed shape (Milestone 6). Spacing is PAPER mm. */
export interface FillStyle {
  readonly pattern: FillPattern;
  /** '#rrggbb' or BY_LAYER. */
  readonly color: string;
  /** Hatch direction, degrees counter-clockwise from +X. */
  readonly angleDeg: number;
  /** Distance between hatch lines on paper (mm). */
  readonly spacingMm: number;
}

export const DEFAULT_FILL: FillStyle = Object.freeze({ pattern: 'hatch', color: BY_LAYER, angleDeg: 45, spacingMm: 3 });
export const FILL_PATTERN_LABELS: Record<FillPattern, string> = { solid: 'Solid', hatch: 'Hatch', crosshatch: 'Cross-hatch' };

/** Visual style. Line weight is in PAPER millimetres (it does not scale with the drawing). */
export interface ShapeStyle {
  readonly stroke: string;
  readonly strokeWidthMm: number;
  /** Only on closed shapes (rectangle, circle, closed polyline). Absent = no fill. */
  readonly fill?: FillStyle;
}

interface ShapeBase {
  readonly id: ShapeId;
  readonly style: ShapeStyle;
  /** Owning layer (Milestone 3). Absent only on objects created before layers existed → default layer. */
  readonly layerId?: LayerId;
}

/** All geometry below is in drawing (real-world) millimetres, origin bottom-left, Y up. */
export interface LineShape extends ShapeBase {
  readonly kind: 'line';
  readonly start: Vec2;
  readonly end: Vec2;
}

/**
 * Rectangle defined by a base corner, a size along its own axes and a rotation
 * (degrees CCW) about the base corner. Unrotated, `origin` is the bottom-left corner.
 * width and height are always >= 0.
 */
export interface RectShape extends ShapeBase {
  readonly kind: 'rect';
  readonly origin: Vec2;
  readonly width: number;
  readonly height: number;
  readonly rotationDeg: number;
}

export interface CircleShape extends ShapeBase {
  readonly kind: 'circle';
  readonly center: Vec2;
  readonly radius: number;
}

/**
 * Circular arc: the part of circle (center, radius) swept COUNTER-CLOCKWISE from startDeg
 * through sweepDeg (0 < sweepDeg < 360). Angles in degrees from +X.
 */
export interface ArcShape extends ShapeBase {
  readonly kind: 'arc';
  readonly center: Vec2;
  readonly radius: number;
  readonly startDeg: number;
  readonly sweepDeg: number;
}

/** Polyline: freehand or clicked vertices. `closed` joins the last vertex back to the first (polygon). */
export interface PolylineShape extends ShapeBase {
  readonly kind: 'polyline';
  readonly points: readonly Vec2[];
  /** Absent/false = open (all files before format 5). */
  readonly closed?: boolean;
}

/**
 * Text note (Milestone 6). `position` is the left end of the FIRST line's baseline;
 * further lines (separated by "\n") go downwards in the text's own direction.
 * `height` is the font size in DRAWING mm (like the geometry; scales with Scale);
 * the text tool converts the pen's paper height using the drawing scale.
 * The colour is style.stroke.
 */
export interface TextShape extends ShapeBase {
  readonly kind: 'text';
  readonly position: Vec2;
  readonly text: string;
  readonly height: number;
  readonly rotationDeg: number;
}

export const MAX_TEXT_LENGTH = 2000;

export type Shape = LineShape | RectShape | CircleShape | ArcShape | PolylineShape | TextShape;
export type ShapeKind = Shape['kind'];

// ---------------------------------------------------------------------------
// Dimensions (Milestone 2)
// ---------------------------------------------------------------------------

export type ArrowheadStyle = 'closed' | 'open' | 'tick' | 'dot' | 'none';

/** Dimension appearance. Sizes are PAPER millimetres (like line weights), so text stays legible at any drawing scale. */
export interface DimensionStyle {
  readonly color: string;
  readonly textHeightMm: number;
  readonly decimals: number;
  readonly arrowSizeMm: number;
  readonly arrowhead: ArrowheadStyle;
  readonly showExtensionLines: boolean;
  /** Gap between the measured point and the start of the extension line. */
  readonly extensionGapMm: number;
  /** How far extension lines run past the dimension line. */
  readonly extensionOvershootMm: number;
}

/**
 * A definition point of a dimension. `shape` anchors are LINKED to a named point
 * of a shape (see model/anchors.ts) and follow it when the geometry changes;
 * `point` anchors are fixed drawing coordinates.
 */
export type DimAnchor =
  | { readonly kind: 'shape'; readonly shapeId: ShapeId; readonly key: string }
  | { readonly kind: 'point'; readonly point: Vec2 };

/**
 * 'driven': the value is MEASURED from geometry and can never be typed in.
 * (A future 'constraint' mode — a user-entered value that drives geometry — is
 * deliberately a different mode so the two can never be confused.)
 */
export type DimensionMode = 'driven';

interface DimensionBase {
  readonly id: ShapeId;
  readonly layerId?: LayerId;
  readonly mode: DimensionMode;
  readonly style: DimensionStyle;
  /** Text displacement along the dimension line / arc (drawing mm). */
  readonly textShift: number;
}

export interface LinearDimension extends DimensionBase {
  readonly kind: 'aligned' | 'horizontal' | 'vertical';
  readonly p1: DimAnchor;
  readonly p2: DimAnchor;
  /** Signed distance (drawing mm) of the dimension line from p1, measured along the dimension's normal. */
  readonly offset: number;
}

export interface RadialDimension extends DimensionBase {
  readonly kind: 'radius' | 'diameter';
  readonly circleId: ShapeId;
  /** Direction of the dimension line from the centre, degrees CCW. */
  readonly angleDeg: number;
}

export interface AngularDimension extends DimensionBase {
  readonly kind: 'angular';
  readonly line1Id: ShapeId;
  readonly line2Id: ShapeId;
  /** Which ray of each line bounds the measured angle (+1 = towards the line's end point). */
  readonly sign1: 1 | -1;
  readonly sign2: 1 | -1;
  /** Arc radius from the vertex (drawing mm). */
  readonly radius: number;
}

export type Dimension = LinearDimension | RadialDimension | AngularDimension;
export type DimensionKind = Dimension['kind'];

export const DIMENSION_KIND_LABELS: Record<DimensionKind, string> = {
  aligned: 'Aligned dimension',
  horizontal: 'Horizontal dimension',
  vertical: 'Vertical dimension',
  angular: 'Angular dimension',
  radius: 'Radius dimension',
  diameter: 'Diameter dimension',
};

export const DEFAULT_DIMENSION_STYLE: DimensionStyle = Object.freeze({
  color: '#0b6e75',
  textHeightMm: 2.5,
  decimals: 2,
  arrowSizeMm: 2.5,
  arrowhead: 'closed',
  showExtensionLines: true,
  extensionGapMm: 1,
  extensionOvershootMm: 1.5,
});

// ---------------------------------------------------------------------------
// Layers (Milestone 3)
// ---------------------------------------------------------------------------

export interface Layer {
  readonly id: LayerId;
  readonly name: string;
  readonly visible: boolean;
  readonly locked: boolean;
  /** Display colour used by objects whose stroke is "By layer". */
  readonly color: string;
}

export const DEFAULT_LAYER_ID: LayerId = 'layer-0';
export const DEFAULT_LAYER: Layer = Object.freeze({ id: DEFAULT_LAYER_ID, name: 'Default', visible: true, locked: false, color: '#000000' });

// ---------------------------------------------------------------------------
// Geometric constraints (Milestone 3) – DRIVING: they control geometry.
// ---------------------------------------------------------------------------

/** A constrainable point: line or arc start/end/mid, or circle/arc centre. */
export interface PointRef {
  readonly shapeId: ShapeId;
  readonly key: 'start' | 'end' | 'mid' | 'center';
}

interface ConstraintBase {
  readonly id: ShapeId;
  /** Suppressed constraints are kept but ignored by the solver. */
  readonly suppressed: boolean;
}

export type Constraint = ConstraintBase &
  (
    | { readonly kind: 'horizontal' | 'vertical'; readonly line: ShapeId }
    | { readonly kind: 'parallel' | 'perpendicular' | 'equal-length'; readonly a: ShapeId; readonly b: ShapeId }
    /** a: line or circle, b: circle. internal: circle-circle tangency on the inside. */
    | { readonly kind: 'tangent'; readonly a: ShapeId; readonly b: ShapeId; readonly internal: boolean }
    | { readonly kind: 'coincident'; readonly p: PointRef; readonly q: PointRef }
    | { readonly kind: 'fixed-length'; readonly line: ShapeId; readonly value: number }
    /** Absolute direction of the line, degrees CCW from +X. */
    | { readonly kind: 'fixed-angle'; readonly line: ShapeId; readonly value: number }
    | { readonly kind: 'fixed-position'; readonly p: PointRef; readonly x: number; readonly y: number }
    /** Radius of a circle or arc (drawing mm). */
    | { readonly kind: 'fixed-radius'; readonly shape: ShapeId; readonly value: number }
    /** Angle between the directions of two lines, 0–180° (as drawn: start → end). */
    | { readonly kind: 'angle'; readonly a: ShapeId; readonly b: ShapeId; readonly value: number }
  );

export type ConstraintKind = Constraint['kind'];

export const CONSTRAINT_LABELS: Record<ConstraintKind, string> = {
  horizontal: 'Horizontal',
  vertical: 'Vertical',
  coincident: 'Coincident',
  parallel: 'Parallel',
  perpendicular: 'Perpendicular',
  tangent: 'Tangent',
  'equal-length': 'Equal length',
  'fixed-length': 'Fixed length',
  'fixed-angle': 'Fixed angle',
  'fixed-position': 'Fixed position',
  'fixed-radius': 'Fixed radius',
  angle: 'Angle between lines',
};

export type PageOrientation = 'landscape' | 'portrait';

/** Title block and drawing frame (Milestone 5). Laid out in PAPER millimetres. */
export interface TitleBlock {
  readonly visible: boolean;
  readonly title: string;
  readonly drawingNumber: string;
  readonly revision: string;
  readonly drawnBy: string;
  readonly checkedBy: string;
  /** Free text, normally ISO date (YYYY-MM-DD). */
  readonly date: string;
  readonly company: string;
}

export const TITLE_BLOCK_FIELDS: readonly { key: Exclude<keyof TitleBlock, 'visible'>; label: string; max: number }[] = [
  { key: 'title', label: 'Title', max: 80 },
  { key: 'drawingNumber', label: 'Drawing no.', max: 40 },
  { key: 'revision', label: 'Revision', max: 10 },
  { key: 'drawnBy', label: 'Drawn by', max: 40 },
  { key: 'checkedBy', label: 'Checked by', max: 40 },
  { key: 'date', label: 'Date', max: 20 },
  { key: 'company', label: 'Company', max: 60 },
];

export const DEFAULT_TITLE_BLOCK: TitleBlock = Object.freeze({
  visible: false,
  title: '',
  drawingNumber: '',
  revision: 'A',
  drawnBy: '',
  checkedBy: '',
  date: '',
  company: '',
});

export interface DrawingDocument {
  readonly page: PageSize;
  readonly scale: DrawingScale;
  /** Painting order: later shapes are drawn on top (within their layer). */
  readonly shapes: readonly Shape[];
  /** Annotation objects, drawn above shapes. */
  readonly dimensions: readonly Dimension[];
  /** Bottom-to-top order. Always at least one layer. */
  readonly layers: readonly Layer[];
  readonly constraints: readonly Constraint[];
  /** Drawing frame + title block on the sheet. */
  readonly titleBlock: TitleBlock;
}

export const DEFAULT_STYLE: ShapeStyle = Object.freeze({ stroke: '#000000', strokeWidthMm: 0.35 });

/** Standard ISO pen weights (paper mm). */
export const LINE_WEIGHTS = [0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1.0] as const;

export const SHAPE_KIND_LABELS: Record<ShapeKind, string> = {
  line: 'Line',
  rect: 'Rectangle',
  circle: 'Circle',
  arc: 'Arc',
  polyline: 'Polyline',
  text: 'Text',
};
