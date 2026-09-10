import { useCallback, useEffect, useRef, useState } from 'react';

import { useDashboardSettings } from '../state/SettingsProvider.jsx';
import { WIDGETS, SIZE_VALUES, widgetById, resolveView } from './catalogue.js';

/**
 * The node list, and the six things that can happen to it.
 *
 * Optimistic, like every other write on the Settings page: the grid moves first
 * and the `PUT /settings` follows. A card that waited on a round trip before it
 * appeared under the cursor would feel broken mid-drag, and a drag is the one
 * gesture here that is continuous.
 *
 * Writes are debounced, because the gestures come in bursts — dragging a card
 * three positions is three reorders, and resizing while deciding is four clicks
 * on the size control. One write at the end of the burst is what should reach
 * the disk.
 *
 * The local list wins over the stored one for as long as a write is outstanding.
 * Without that, the response to save number one arrives holding the layout as it
 * was *before* saves two and three, and the cards snap back to where they were a
 * moment ago — the specific bug that makes optimistic UI feel haunted.
 */
const WRITE_DELAY_MS = 600;

/** Short enough to read in a URL bar, long enough that a dozen cards will not
    collide. Node ids only have to be unique within one layout. */
function newId() {
  return globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
}

export function useDashboardLayout() {
  const { nodes: stored, setNodes } = useDashboardSettings();
  const [nodes, setLocal] = useState(stored);
  const pending = useRef(null);
  const timer = useRef(null);

  // The stored list is the source of truth right up until the first local edit,
  // and again once the last write has landed.
  useEffect(() => {
    if (pending.current) return;
    setLocal(stored);
  }, [stored]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const commit = useCallback(
    (next) => {
      setLocal(next);
      pending.current = next;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        const write = pending.current;
        // Cleared before the request, not after: a failed write must not leave
        // the local list permanently pinned over whatever the server holds.
        pending.current = null;
        Promise.resolve(setNodes(write)).catch(() => {});
      }, WRITE_DELAY_MS);
    },
    [setNodes],
  );

  /** Replaces one node, leaving every other identical — so React only re-renders
      the card that changed rather than every chart on the page. */
  const patch = useCallback(
    (id, fields) => {
      commit((nodes ?? []).map((n) => (n.id === id ? { ...n, ...fields } : n)));
    },
    [nodes, commit],
  );

  const add = useCallback(() => {
    const widget = WIDGETS[0];
    const node = { id: newId(), widget: widget.id, view: widget.defaultView, size: widget.defaultSize };
    commit([...(nodes ?? []), node]);
    return node.id;
  }, [nodes, commit]);

  const remove = useCallback(
    (id) => commit((nodes ?? []).filter((n) => n.id !== id)),
    [nodes, commit],
  );

  /**
   * Changing what a card *is* has to re-check what it is showing: a node set to
   * `treemap` and then switched to the merchants widget would otherwise keep a
   * view that widget cannot draw. `resolveView` answers that, and a size the new
   * widget has no opinion about is left exactly as the reader set it.
   */
  const setWidget = useCallback(
    (id, widgetId) => {
      const widget = widgetById(widgetId);
      if (!widget) return;
      const current = (nodes ?? []).find((n) => n.id === id);
      patch(id, { widget: widget.id, view: resolveView(widget, current?.view) });
    },
    [nodes, patch],
  );

  const setView = useCallback((id, view) => patch(id, { view }), [patch]);

  const setSize = useCallback(
    (id, size) => SIZE_VALUES.includes(size) && patch(id, { size }),
    [patch],
  );

  /**
   * Lifts one node out and drops it back in at `to`.
   *
   * Splice-then-insert on the list with the node already removed, so `to` means
   * the same thing whether the card moved left or right. Computing the target
   * against the original list is the classic off-by-one here: dragging a card
   * one place to the right lands it exactly where it started.
   */
  const move = useCallback(
    (id, to) => {
      const list = nodes ?? [];
      const from = list.findIndex((n) => n.id === id);
      if (from < 0) return;
      const rest = list.filter((n) => n.id !== id);
      const target = Math.max(0, Math.min(rest.length, to > from ? to - 1 : to));
      rest.splice(target, 0, list[from]);
      commit(rest);
    },
    [nodes, commit],
  );

  /** The keyboard path. Drag-and-drop alone would put reordering out of reach of
      anyone not using a mouse, which is not a trade this project makes. */
  const nudge = useCallback(
    (id, delta) => {
      const list = nodes ?? [];
      const from = list.findIndex((n) => n.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= list.length) return;
      const next = list.slice();
      [next[from], next[to]] = [next[to], next[from]];
      commit(next);
    },
    [nodes, commit],
  );

  return { nodes, add, remove, setWidget, setView, setSize, move, nudge };
}
