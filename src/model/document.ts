import { A3_LANDSCAPE } from '../geometry/page';
import { SCALE_1_1, isValidScale, type DrawingScale } from '../geometry/scale';
import { unionBounds, type Bounds } from '../geometry/bounds';
import type { Vec2 } from '../geometry/vec';
import { duplicateShape } from './operations';
import { shapeBounds } from './shapes';
import { copyDimensions, dimensionShapeIds } from './dimensions';
import { constraintShapeIds } from './layers';
import { DEFAULT_LAYER, DEFAULT_TITLE_BLOCK, type Dimension, type DrawingDocument, type Shape, type ShapeId } from './types';

export function createEmptyDocument(): DrawingDocument {
  return { page: A3_LANDSCAPE, scale: SCALE_1_1, shapes: [], dimensions: [], layers: [DEFAULT_LAYER], constraints: [], titleBlock: DEFAULT_TITLE_BLOCK };
}

export const findShape = (doc: DrawingDocument, id: ShapeId): Shape | undefined => doc.shapes.find((s) => s.id === id);

export function getShapes(doc: DrawingDocument, ids: readonly ShapeId[]): Shape[] {
  const set = new Set(ids);
  return doc.shapes.filter((s) => set.has(s.id));
}

export function addShapes(doc: DrawingDocument, shapes: readonly Shape[]): DrawingDocument {
  return { ...doc, shapes: [...doc.shapes, ...shapes] };
}

/** Replace shapes by id (keeps painting order). Unknown ids are ignored. */
export function replaceShapes(doc: DrawingDocument, updated: readonly Shape[]): DrawingDocument {
  if (updated.length === 0) return doc;
  const map = new Map(updated.map((s) => [s.id, s]));
  return { ...doc, shapes: doc.shapes.map((s) => map.get(s.id) ?? s) };
}

export function removeShapes(doc: DrawingDocument, ids: readonly ShapeId[]): DrawingDocument {
  const set = new Set(ids);
  return { ...doc, shapes: doc.shapes.filter((s) => !set.has(s.id)) };
}

/** Duplicates the given shapes with new ids, offset by `offset` (world mm). */
export function duplicateShapes(
  doc: DrawingDocument,
  ids: readonly ShapeId[],
  newId: () => ShapeId,
  offset: Vec2,
): { doc: DrawingDocument; newIds: ShapeId[] } {
  const copies = getShapes(doc, ids).map((s) => duplicateShape(s, newId(), offset));
  return { doc: addShapes(doc, copies), newIds: copies.map((s) => s.id) };
}

/**
 * Change the drawing scale. Geometry is stored in real-world units and is
 * intentionally NOT modified: only the representation on paper changes.
 */
export function setDocumentScale(doc: DrawingDocument, scale: DrawingScale): DrawingDocument {
  if (!isValidScale(scale)) throw new RangeError('Invalid drawing scale');
  return { ...doc, scale: { paper: scale.paper, real: scale.real } };
}

export function selectionBounds(doc: DrawingDocument, ids: readonly ShapeId[]): Bounds | null {
  const shapes = getShapes(doc, ids);
  return shapes.length ? unionBounds(shapes.map(shapeBounds)) : null;
}

// ---------------------------------------------------------------------------
// Milestone 2: dimensions and mixed selections
// ---------------------------------------------------------------------------

export function getDimensions(doc: DrawingDocument, ids: readonly ShapeId[]): Dimension[] {
  const set = new Set(ids);
  return doc.dimensions.filter((d) => set.has(d.id));
}

export const allItemIds = (doc: DrawingDocument): ShapeId[] => [
  ...doc.shapes.map((s) => s.id),
  ...doc.dimensions.map((d) => d.id),
  ...doc.constraints.map((c) => c.id),
];

export function addDimensions(doc: DrawingDocument, dims: readonly Dimension[]): DrawingDocument {
  return { ...doc, dimensions: [...doc.dimensions, ...dims] };
}

export function replaceDimensions(doc: DrawingDocument, updated: readonly Dimension[]): DrawingDocument {
  if (updated.length === 0) return doc;
  const map = new Map(updated.map((d) => [d.id, d]));
  return { ...doc, dimensions: doc.dimensions.map((d) => map.get(d.id) ?? d) };
}

export interface RemoveResult {
  doc: DrawingDocument;
  removedShapes: number;
  removedDimensions: number;
  /** Dimensions removed only because geometry they were linked to was deleted. */
  dependentDimensions: number;
  removedConstraints: number;
  /** Constraints removed only because geometry they referenced was deleted. */
  dependentConstraints: number;
}

/**
 * Delete shapes and/or dimensions by id. Dimensions linked to a deleted shape are
 * deleted too (they would have nothing to measure) and are counted separately so
 * the UI can say so – nothing is removed silently.
 */
export function removeItems(doc: DrawingDocument, ids: readonly ShapeId[]): RemoveResult {
  const set = new Set(ids);
  const shapes = doc.shapes.filter((s) => !set.has(s.id));
  const removedShapeIds = new Set(doc.shapes.filter((s) => set.has(s.id)).map((s) => s.id));
  let dependent = 0;
  let direct = 0;
  const dimensions = doc.dimensions.filter((d) => {
    if (set.has(d.id)) {
      direct++;
      return false;
    }
    if (dimensionShapeIds(d).some((id) => removedShapeIds.has(id))) {
      dependent++;
      return false;
    }
    return true;
  });
  let removedConstraints = 0;
  let dependentConstraints = 0;
  const constraints = doc.constraints.filter((c) => {
    if (set.has(c.id)) {
      removedConstraints++;
      return false;
    }
    if (constraintShapeIds(c).some((id) => removedShapeIds.has(id))) {
      dependentConstraints++;
      return false;
    }
    return true;
  });
  return {
    doc: { ...doc, shapes, dimensions, constraints },
    removedShapes: removedShapeIds.size,
    removedDimensions: direct + dependent,
    dependentDimensions: dependent,
    removedConstraints: removedConstraints + dependentConstraints,
    dependentConstraints,
  };
}

/** Duplicate shapes and dimensions in the selection; copied dimensions link to the copied shapes. */
export function duplicateItems(
  doc: DrawingDocument,
  ids: readonly ShapeId[],
  newId: () => ShapeId,
  offset: Vec2,
): { doc: DrawingDocument; newIds: ShapeId[] } {
  const idMap = new Map<ShapeId, ShapeId>();
  const shapeCopies = getShapes(doc, ids).map((s) => {
    const copy = duplicateShape(s, newId(), offset);
    idMap.set(s.id, copy.id);
    return copy;
  });
  const dimCopies = copyDimensions(getDimensions(doc, ids), idMap, newId, offset);
  return {
    doc: addDimensions(addShapes(doc, shapeCopies), dimCopies),
    newIds: [...shapeCopies.map((s) => s.id), ...dimCopies.map((d) => d.id)],
  };
}
