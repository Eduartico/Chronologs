import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import Icon from '../components/Icon.jsx';
import DashboardNode from './DashboardNode.jsx';
import { resolveNode } from './catalogue.js';
import { useDashboardLayout } from './useDashboardLayout.js';
import { useT } from '../i18n/index.js';

const FLIP_MS = 240;
const FLIP_EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/**
 * The dashboard itself: a two-column grid of cards the reader arranged.
 *
 * Three things about the layout are worth stating, because each replaced
 * something that did not work.
 *
 * **Cards are dragged by their header, never by their body.** Making a whole
 * card a drag source fights every interaction inside it — clicking a legend
 * entry to hide a series, hovering to isolate one, selecting a figure out of a
 * table. The header is the one strip of a card that does nothing else.
 *
 * **Reflow is animated with FLIP, not with a CSS transition.** Grid items do not
 * transition when their track assignment changes underneath them; the browser
 * simply paints them in the new place. So the old rectangles are measured before
 * the change and the new ones after, and each card is played back from where it
 * was. Decoration, so it is dropped entirely under `prefers-reduced-motion` —
 * the cards still land in the right place, they just get there instantly.
 *
 * **The add button is a node-shaped hole, always last.** Half the height of a
 * real card and spanning the full row, so it reads as "a card could go here"
 * rather than as a toolbar button that happens to be at the bottom of a page.
 */
export default function DashboardGrid(widgetProps) {
  const { t } = useT();
  const { nodes, add, remove, setWidget, setView, setSize, move, nudge } = useDashboardLayout();
  const [editingId, setEditingId] = useState(null);
  const [dragging, setDragging] = useState(null);
  const [dropAt, setDropAt] = useState(null);

  const grid = useRef(null);
  const rects = useRef(new Map());

  // Measured after the DOM has the new arrangement but before the browser paints
  // it, so a card is never seen in two places.
  useLayoutEffect(() => {
    const el = grid.current;
    if (!el) return;
    const cells = [...el.querySelectorAll('[data-node]')];
    const next = new Map(cells.map((cell) => [cell.dataset.node, cell.getBoundingClientRect()]));
    const still = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (!still) {
      for (const cell of cells) {
        const before = rects.current.get(cell.dataset.node);
        const after = next.get(cell.dataset.node);
        if (!before) continue;
        const dx = before.left - after.left;
        const dy = before.top - after.top;
        if (!dx && !dy) continue;
        cell.animate(
          [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
          { duration: FLIP_MS, easing: FLIP_EASING },
        );
      }
    }
    rects.current = next;
  }, [nodes]);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      if (dragging != null && dropAt != null) move(dragging, dropAt);
      setDragging(null);
      setDropAt(null);
    },
    [dragging, dropAt, move],
  );

  // `null` is "the layout has not arrived yet", which is not the same as `[]` —
  // an empty dashboard is one someone emptied, and drawing the add button over a
  // layout that is still in flight would flash it on every load.
  if (!nodes) return null;

  const resolved = nodes.map((node) => ({ stored: node, view: resolveNode(node) })).filter((n) => n.view);

  return (
    <div className="dash-grid" ref={grid} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      {resolved.map(({ stored, view }, index) => (
        <div
          key={stored.id}
          data-node={stored.id}
          className={`dash-cell dash-size-${view.size}${dragging === stored.id ? ' is-dragging' : ''}${
            dropAt === index ? ' is-drop-before' : ''
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            // Left half means "before this card", right half "after it" — the
            // insertion point the gap is drawn at, so what is shown is what
            // happens.
            const box = e.currentTarget.getBoundingClientRect();
            setDropAt(e.clientX < box.left + box.width / 2 ? index : index + 1);
          }}
        >
          <DashboardNode
            {...widgetProps}
            node={view}
            index={index}
            count={resolved.length}
            editing={editingId === stored.id}
            onEdit={() => setEditingId(stored.id)}
            onDone={() => setEditingId(null)}
            onSetWidget={(id) => setWidget(stored.id, id)}
            onSetView={(v) => setView(stored.id, v)}
            onSetSize={(s) => setSize(stored.id, s)}
            onNudge={(delta) => nudge(stored.id, delta)}
            onRemove={() => {
              setEditingId(null);
              remove(stored.id);
            }}
            dragProps={{
              draggable: true,
              onDragStart: (e) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', stored.id);
                setDragging(stored.id);
              },
              onDragEnd: () => {
                setDragging(null);
                setDropAt(null);
              },
            }}
          />
        </div>
      ))}

      <button
        type="button"
        className={`dash-add${dropAt === resolved.length ? ' is-drop-before' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDropAt(resolved.length);
        }}
        onClick={() => {
          // Straight into edit mode with the widget picker one click away: a
          // card added and then left to be configured somewhere else is a card
          // nobody asked for. It is added as a real widget rather than as an
          // unconfigured placeholder, so no invalid node ever reaches settings.
          const id = add();
          setEditingId(id);
        }}
      >
        <Icon name="plus" size={20} />
        <span>{t('dashboard.edit.add')}</span>
      </button>
    </div>
  );
}
