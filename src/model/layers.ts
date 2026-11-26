import { dimensionShapeIds } from './dimensions';
import { BY_LAYER, DEFAULT_LAYER_ID, type Constraint, type Dimension, type DrawingDocument, type Layer, type LayerId, type Shape, type ShapeId } from './types';

/**
 * Layer operations (pure). Every function returns a new document or a refusal
 * with a reason – nothing is removed or reassigned implicitly.
 */
export type LayerResult = { ok: true; doc: DrawingDocument; message: string } | { ok: false; message: string };
const fail = (message: string): LayerResult => ({ ok: false, message });

type Item = Shape | Dimension;

/** The layer an object belongs to (objects without one belong to the first/default layer). */
export function layerOf(doc: Pick<DrawingDocument, 'layers'>, item: { layerId?: LayerId }): Layer {
  return doc.layers.find((l) => l.id === (item.layerId ?? DEFAULT_LAYER_ID)) ?? doc.layers[0];
}

export const isVisible = (doc: Pick<DrawingDocument, 'layers'>, item: { layerId?: LayerId }): boolean => layerOf(doc, item).visible;
/** Editable = visible AND unlocked. Only editable objects can be selected or changed. */
export const isEditable = (doc: Pick<DrawingDocument, 'layers'>, item: { layerId?: LayerId }): boolean => {
  const l = layerOf(doc, item);
  return l.visible && !l.locked;
};

/** Index of the item's layer in bottom-to-top order (for painting). */
const layerIndex = (doc: DrawingDocument, item: Item) => doc.layers.indexOf(layerOf(doc, item));

/** Visible shapes in painting order: by layer (bottom first), then document order. */
export function visibleShapes(doc: DrawingDocument): Shape[] {
  return doc.shapes
    .map((s, i) => ({ s, i, l: layerIndex(doc, s) }))
    .filter(({ s }) => isVisible(doc, s))
    .sort((a, b) => a.l - b.l || a.i - b.i)
    .map(({ s }) => s);
}

export function visibleDimensions(doc: DrawingDocument): Dimension[] {
  return doc.dimensions
    .map((d, i) => ({ d, i, l: layerIndex(doc, d) }))
    .filter(({ d }) => isVisible(doc, d))
    .sort((a, b) => a.l - b.l || a.i - b.i)
    .map(({ d }) => d);
}

export const editableShapes = (doc: DrawingDocument): Shape[] => doc.shapes.filter((s) => isEditable(doc, s));
export const editableDimensions = (doc: DrawingDocument): Dimension[] => doc.dimensions.filter((d) => isEditable(doc, d));

/** Resolved stroke colour for display/export. */
export function resolveStroke(doc: Pick<DrawingDocument, 'layers'>, s: Shape): string {
  return s.style.stroke === BY_LAYER ? layerOf(doc, s).color : s.style.stroke;
}

export function itemsOnLayer(doc: DrawingDocument, id: LayerId): { shapes: Shape[]; dimensions: Dimension[] } {
  const on = (x: Item) => layerOf(doc, x).id === id;
  return { shapes: doc.shapes.filter(on), dimensions: doc.dimensions.filter(on) };
}

const cleanName = (name: string) => name.trim().replace(/\s+/g, ' ');
const nameTaken = (doc: DrawingDocument, name: string, except?: LayerId) =>
  doc.layers.some((l) => l.id !== except && l.name.toLowerCase() === name.toLowerCase());

export function nextLayerName(doc: DrawingDocument): string {
  for (let i = doc.layers.length; ; i++) {
    const n = `Layer ${i}`;
    if (!nameTaken(doc, n)) return n;
  }
}

export function addLayer(doc: DrawingDocument, id: LayerId, name: string, color = '#000000'): LayerResult {
  const n = cleanName(name);
  if (!n) return fail('Layer name cannot be empty');
  if (nameTaken(doc, n)) return fail(`A layer called "${n}" already exists`);
  if (doc.layers.some((l) => l.id === id)) return fail('Duplicate layer id');
  return { ok: true, doc: { ...doc, layers: [...doc.layers, { id, name: n, visible: true, locked: false, color }] }, message: `Layer "${n}" created` };
}

export function renameLayer(doc: DrawingDocument, id: LayerId, name: string): LayerResult {
  const n = cleanName(name);
  if (!doc.layers.some((l) => l.id === id)) return fail('Layer not found');
  if (!n) return fail('Layer name cannot be empty');
  if (nameTaken(doc, n, id)) return fail(`A layer called "${n}" already exists`);
  return { ok: true, doc: { ...doc, layers: doc.layers.map((l) => (l.id === id ? { ...l, name: n } : l)) }, message: `Layer renamed to "${n}"` };
}

export function setLayerProps(doc: DrawingDocument, id: LayerId, patch: Partial<Pick<Layer, 'visible' | 'locked' | 'color'>>): LayerResult {
  const l = doc.layers.find((x) => x.id === id);
  if (!l) return fail('Layer not found');
  if (patch.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(patch.color)) return fail('Colour must be #RRGGBB');
  const parts = [
    patch.visible !== undefined ? (patch.visible ? 'shown' : 'hidden') : '',
    patch.locked !== undefined ? (patch.locked ? 'locked' : 'unlocked') : '',
    patch.color !== undefined ? 'colour changed' : '',
  ].filter(Boolean);
  return { ok: true, doc: { ...doc, layers: doc.layers.map((x) => (x.id === id ? { ...x, ...patch } : x)) }, message: `Layer "${l.name}" ${parts.join(', ')}` };
}

/** Move a layer up (towards the top of the drawing order) or down. */
export function moveLayer(doc: DrawingDocument, id: LayerId, direction: 'up' | 'down'): LayerResult {
  const i = doc.layers.findIndex((l) => l.id === id);
  if (i < 0) return fail('Layer not found');
  const j = direction === 'up' ? i + 1 : i - 1;
  if (j < 0 || j >= doc.layers.length) return fail(`Layer is already at the ${direction === 'up' ? 'top' : 'bottom'}`);
  const layers = [...doc.layers];
  [layers[i], layers[j]] = [layers[j], layers[i]];
  return { ok: true, doc: { ...doc, layers }, message: `Layer "${doc.layers[i].name}" moved ${direction}` };
}

export type DeleteLayerMode = { kind: 'only-if-empty' } | { kind: 'reassign'; to: LayerId } | { kind: 'delete-objects' };

/**
 * Delete a layer. A layer that contains objects is only deleted when the caller
 * explicitly chooses to reassign them to another layer or to delete them.
 * The last remaining layer can never be deleted.
 */
export function deleteLayer(doc: DrawingDocument, id: LayerId, mode: DeleteLayerMode): LayerResult {
  const layer = doc.layers.find((l) => l.id === id);
  if (!layer) return fail('Layer not found');
  if (doc.layers.length <= 1) return fail('A drawing must keep at least one layer');
  const items = itemsOnLayer(doc, id);
  const count = items.shapes.length + items.dimensions.length;
  const layers = doc.layers.filter((l) => l.id !== id);
  if (count === 0) return { ok: true, doc: { ...doc, layers }, message: `Layer "${layer.name}" deleted` };
  if (mode.kind === 'only-if-empty') return fail(`Layer "${layer.name}" contains ${count} object${count === 1 ? '' : 's'}`);
  if (mode.kind === 'reassign') {
    const target = doc.layers.find((l) => l.id === mode.to);
    if (!target || target.id === id) return fail('Choose a different layer to receive the objects');
    if (target.locked) return fail(`Layer "${target.name}" is locked – unlock it first`);
    const move = <T extends Item>(x: T): T => (layerOf(doc, x).id === id ? { ...x, layerId: target.id } : x);
    return {
      ok: true,
      doc: { ...doc, layers, shapes: doc.shapes.map(move), dimensions: doc.dimensions.map(move) },
      message: `Layer "${layer.name}" deleted; ${count} object${count === 1 ? '' : 's'} moved to "${target.name}"`,
    };
  }
  // delete-objects: also removes dimensions/constraints that depended on the deleted shapes.
  const gone = new Set<ShapeId>(items.shapes.map((s) => s.id));
  const dimGone = new Set(items.dimensions.map((d) => d.id));
  const dimensions = doc.dimensions.filter((d) => !dimGone.has(d.id) && !dimensionShapeIds(d).some((x) => gone.has(x)));
  const constraints = doc.constraints.filter((c) => !constraintShapeIdsLocal(c).some((x) => gone.has(x)));
  const extra = doc.dimensions.length - dimGone.size - dimensions.length + (doc.constraints.length - constraints.length);
  return {
    ok: true,
    doc: { ...doc, layers, shapes: doc.shapes.filter((s) => !gone.has(s.id)), dimensions, constraints },
    message: `Layer "${layer.name}" and its ${count} object${count === 1 ? '' : 's'} deleted${extra ? ` (+${extra} dependent dimension/constraint${extra === 1 ? '' : 's'})` : ''}`,
  };
}

/** Assign objects (shapes and/or dimensions) to a layer. Locked source or target layers are refused. */
export function assignToLayer(doc: DrawingDocument, ids: readonly ShapeId[], to: LayerId): LayerResult {
  const target = doc.layers.find((l) => l.id === to);
  if (!target) return fail('Layer not found');
  if (target.locked) return fail(`Layer "${target.name}" is locked`);
  const set = new Set(ids);
  const items: Item[] = [...doc.shapes, ...doc.dimensions].filter((x) => set.has(x.id));
  if (items.length === 0) return fail('Nothing selected');
  const locked = items.filter((x) => layerOf(doc, x).locked);
  if (locked.length) return fail(`${locked.length} object${locked.length === 1 ? ' is' : 's are'} on a locked layer`);
  const move = <T extends Item>(x: T): T => (set.has(x.id) ? { ...x, layerId: to } : x);
  return {
    ok: true,
    doc: { ...doc, shapes: doc.shapes.map(move), dimensions: doc.dimensions.map(move) },
    message: `${items.length} object${items.length === 1 ? '' : 's'} moved to layer "${target.name}"`,
  };
}

/**
 * Safety net used by the editor store: returns a reason if `next` changes, removes or
 * re-layers any object that is on a layer locked in BOTH documents. (Unlocking or
 * deleting the layer itself is an explicit layer operation and is allowed.)
 */
export function lockedViolation(prev: DrawingDocument, next: DrawingDocument): string | null {
  const lockedIn = (d: DrawingDocument) => new Set(d.layers.filter((l) => l.locked).map((l) => l.id));
  const a = lockedIn(prev);
  const b = lockedIn(next);
  const both = new Set([...a].filter((id) => b.has(id)));
  if (both.size === 0) return null;
  const check = <T extends Item>(before: readonly T[], after: readonly T[]): string | null => {
    const map = new Map(after.map((x) => [x.id, x]));
    for (const x of before) {
      if (!both.has(layerOf(prev, x).id)) continue;
      const y = map.get(x.id);
      if (!y) return `Cannot delete objects on locked layer "${layerOf(prev, x).name}"`;
      if (y !== x && JSON.stringify(y) !== JSON.stringify(x)) return `Objects on locked layer "${layerOf(prev, x).name}" cannot be changed`;
    }
    return null;
  };
  return check(prev.shapes, next.shapes) ?? check(prev.dimensions, next.dimensions);
}

// Local copy to avoid an import cycle with constraints.ts (which imports layers.ts).
function constraintShapeIdsLocal(c: Constraint): ShapeId[] {
  switch (c.kind) {
    case 'horizontal':
    case 'vertical':
    case 'fixed-length':
    case 'fixed-angle':
      return [c.line];
    case 'parallel':
    case 'perpendicular':
    case 'equal-length':
    case 'tangent':
      return [c.a, c.b];
    case 'coincident':
      return [c.p.shapeId, c.q.shapeId];
    case 'fixed-position':
      return [c.p.shapeId];
  }
}
export { constraintShapeIdsLocal as constraintShapeIds };
