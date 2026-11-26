import { useState, type Dispatch } from 'react';
import { addLayer, deleteLayer, itemsOnLayer, moveLayer, nextLayerName, renameLayer, setLayerProps, type LayerResult } from '../model/layers';
import type { Layer, ShapeId } from '../model/types';
import type { DialogAnswer, DialogSpec } from './Dialog';
import type { EditorAction, EditorState } from './state/editorReducer';

interface Props {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
  ask: (spec: DialogSpec) => Promise<DialogAnswer>;
  newId: () => ShapeId;
}

const LAYER_COLOURS = ['#000000', '#c5221f', '#1a73e8', '#188038', '#e37400', '#8e24aa', '#5f6368'];

/** Layer list (top of list = drawn on top). Click a row to make it the active layer for new objects. */
export function LayersPanel({ state, dispatch, ask, newId }: Props) {
  const { doc, activeLayerId } = state;
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
  const apply = (r: LayerResult, after?: () => void) => {
    if (!r.ok) return dispatch({ type: 'setMessage', message: `⚠ ${r.message}` });
    dispatch({ type: 'commitDocument', doc: r.doc, message: r.message });
    after?.();
  };
  const active = doc.layers.find((l) => l.id === activeLayerId) ?? doc.layers[0];
  const ordered = [...doc.layers].reverse();

  const create = () => {
    const id = `layer-${newId()}`;
    apply(addLayer(doc, id, nextLayerName(doc), LAYER_COLOURS[doc.layers.length % LAYER_COLOURS.length]), () => dispatch({ type: 'setActiveLayer', id }));
  };

  const commitRename = () => {
    if (!renaming) return;
    const r = renameLayer(doc, renaming.id, renaming.text);
    setRenaming(null);
    apply(r);
  };

  const remove = async (layer: Layer) => {
    const items = itemsOnLayer(doc, layer.id);
    const count = items.shapes.length + items.dimensions.length;
    let result: LayerResult;
    if (doc.layers.length <= 1) return dispatch({ type: 'setMessage', message: '⚠ A drawing must keep at least one layer' });
    if (count === 0) {
      result = deleteLayer(doc, layer.id, { kind: 'only-if-empty' });
    } else {
      const others = doc.layers.filter((l) => l.id !== layer.id);
      const a = await ask({
        title: `Delete layer "${layer.name}"?`,
        message: `This layer contains ${count} object${count === 1 ? '' : 's'} (${items.shapes.length} shape${items.shapes.length === 1 ? '' : 's'}, ${items.dimensions.length} dimension${items.dimensions.length === 1 ? '' : 's'}). Choose what happens to them:`,
        choice: { label: 'Move them to layer', options: others.map((l) => ({ value: l.id, label: `${l.name}${l.locked ? ' (locked)' : ''}` })) },
        buttons: [
          { id: 'reassign', label: 'Move objects, delete layer', kind: 'primary' },
          { id: 'delete', label: `Delete layer and ${count} object${count === 1 ? '' : 's'}`, kind: 'danger' },
          { id: 'cancel', label: 'Cancel' },
        ],
        cancelId: 'cancel',
        testId: 'dialog-delete-layer',
      });
      if (a.button === 'cancel') return;
      result = a.button === 'reassign' ? deleteLayer(doc, layer.id, { kind: 'reassign', to: a.choice! }) : deleteLayer(doc, layer.id, { kind: 'delete-objects' });
    }
    apply(result, () => {
      if (layer.id === activeLayerId && result.ok) dispatch({ type: 'setActiveLayer', id: result.doc.layers[result.doc.layers.length - 1].id });
    });
  };

  return (
    <section className="layers-panel" data-testid="layers-panel">
      <div className="layers-header">
        <h2 className="panel-title">Layers</h2>
        <div className="layers-actions">
          <button data-testid="layer-new" title="New layer" onClick={create}>
            +
          </button>
          <button data-testid="layer-rename" title="Rename the active layer (or double-click its name)" onClick={() => setRenaming({ id: active.id, text: active.name })}>
            ✎
          </button>
          <button data-testid="layer-up" title="Move the active layer up (drawn on top)" onClick={() => apply(moveLayer(doc, active.id, 'up'))}>
            ▲
          </button>
          <button data-testid="layer-down" title="Move the active layer down" onClick={() => apply(moveLayer(doc, active.id, 'down'))}>
            ▼
          </button>
          <button data-testid="layer-delete" title="Delete the active layer" onClick={() => void remove(active)} disabled={doc.layers.length <= 1}>
            🗑
          </button>
        </div>
      </div>
      <ul className="layer-list" role="listbox" aria-label="Layers">
        {ordered.map((l) => {
          const n = itemsOnLayer(doc, l.id);
          const count = n.shapes.length + n.dimensions.length;
          return (
            <li
              key={l.id}
              role="option"
              aria-selected={l.id === active.id}
              className={`layer-row${l.id === active.id ? ' active' : ''}${l.visible ? '' : ' hidden-layer'}`}
              data-testid={`layer-row-${l.id}`}
              onClick={() => dispatch({ type: 'setActiveLayer', id: l.id })}
              title={l.id === active.id ? 'Active layer: new objects are created here' : 'Click to make this the active layer'}
            >
              <button
                className={`layer-toggle${l.visible ? ' on' : ''}`}
                data-testid={`layer-visible-${l.id}`}
                aria-pressed={l.visible}
                title={l.visible ? 'Visible – click to hide' : 'Hidden – click to show'}
                onClick={(e) => {
                  e.stopPropagation();
                  apply(setLayerProps(doc, l.id, { visible: !l.visible }));
                }}
              >
                {l.visible ? '👁' : '—'}
              </button>
              <button
                className={`layer-toggle${l.locked ? ' on locked' : ''}`}
                data-testid={`layer-lock-${l.id}`}
                aria-pressed={l.locked}
                title={l.locked ? 'Locked: objects cannot be selected or edited – click to unlock' : 'Unlocked – click to lock'}
                onClick={(e) => {
                  e.stopPropagation();
                  apply(setLayerProps(doc, l.id, { locked: !l.locked }));
                }}
              >
                {l.locked ? '🔒' : '🔓'}
              </button>
              <input
                type="color"
                className="layer-color"
                data-testid={`layer-color-${l.id}`}
                value={l.color}
                title="Layer display colour (used by “By layer” objects)"
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => apply(setLayerProps(doc, l.id, { color: e.target.value }))}
              />
              {renaming?.id === l.id ? (
                <input
                  className="layer-rename-input"
                  data-testid="layer-rename-input"
                  autoFocus
                  value={renaming.text}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setRenaming({ id: l.id, text: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setRenaming(null);
                    }
                  }}
                  onBlur={commitRename}
                />
              ) : (
                <span className="layer-name" data-testid={`layer-name-${l.id}`} onDoubleClick={() => setRenaming({ id: l.id, text: l.name })}>
                  {l.name}
                </span>
              )}
              <span className="layer-count" title={`${count} object${count === 1 ? '' : 's'}`}>
                {count}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
