import type { ShapeId } from './types';

/** Creates unique shape ids for this session (prefix + counter + random suffix). */
export function createIdGenerator(prefix = 'shp'): () => ShapeId {
  let n = 0;
  const session = Math.random().toString(36).slice(2, 7);
  return () => `${prefix}-${session}-${(++n).toString(36)}`;
}
