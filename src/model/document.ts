import { A3_LANDSCAPE } from '../geometry/page';
import { SCALE_1_1, isValidScale, type DrawingScale } from '../geometry/scale';
import { unionBounds, type Bounds } from '../geometry/bounds';
import type { Vec2 } from '../geometry/vec';
import { duplicateShape } from './operations';
import { shapeBounds } from './shapes';
import type { DrawingDocument, Shape, ShapeId } from './types';

export function createEmptyDocument(): DrawingDocument {
  return { page: A3_LANDSCAPE, scale: SCALE_1_1, shapes: [] };
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
