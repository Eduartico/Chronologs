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
 *
 * ## Two things a debounce gets wrong unless it is told not to
 *
 * **A pending write must be flushed on the way out, never cancelled.** The usual
 * `useEffect(() => () => clearTimeout(t))` cleanup is right for a timer that
 * only ever produces UI, and wrong for one that produces the save: dragging a
 * card and then clicking Transactions inside the debounce window threw the move
 * away with no error anywhere, and the layout was simply back to its old shape
 * on the next visit. Leaving the tab is the same thing, so `visibilitychange`
 * flushes too.
 *
 * **The mutations must not read the node list out of a closure.** `nodes` is
 * state, so it is stale between a commit and the render that follows it, and two
 * gestures inside one frame — the second half of a double click, a drop landing
 * on the same tick as a size change — would build the second list from the list
 * as it was before the first. `latest` is updated synchronously by `commit`, so
 * every mutation composes on what was actually last committed.
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
  /** What the last mutation produced, available before React has re-rendered. */
  const latest = useRef(stored);
  const pending = useRef(null);
  const timer = useRef(null);
  const write = useRef(setNodes);
  write.current = setNodes;

  // The stored list is the source of truth right up until the first local edit,
  // and again once the last write has landed.
  useEffect(() => {
    if (pending.current) return;
    latest.current = stored;
    setLocal(stored);
  }, [stored]);

  /** Sends whatever is outstanding now, rather than when the timer says. */
  const flush = useCallback(() => {
    if (!pending.current) return;
    clearTimeout(timer.current);
    const outstanding = pending.current;
    // Cleared before the request, not after: a failed write must not leave the
    // local list permanently pinned over whatever the server holds.
    pending.current = null;
    Promise.resolve(write.current(outstanding)).catch(() => {});
  }, []);

  useEffect(() => {
    // Both directions of leaving: unmounting the page, and hiding the tab.
    // `visibilitychange` is the one the browser guarantees on a close, where a
    // late `unload` is not run at all.
    const onHide = () => document.visibilityState === 'hidden' && flush();
    document.addEventListener('visibilitychange', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [flush]);

  const commit = useCallback(
    (next) => {
      latest.current = next;
      setLocal(next);
      pending.current = next;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, WRITE_DELAY_MS);
    },
    [flush],
  );

  const list = useCallback(() => latest.current ?? [], []);

  /** Replaces one node, leaving every other identical — so React only re-renders
      the card that changed rather than every chart on the page. */
  const patch = useCallback(
    (id, fields) => commit(list().map((n) => (n.id === id ? { ...n, ...fields } : n))),
    [list, commit],
  );

  const add = useCallback(() => {
    const widget = WIDGETS[0];
    // A full row, not `widget.defaultSize` — that field is the catalogue's own
    // fallback for a *stored* node with an invalid size (see `resolveNode`),
    // an unrelated question from "what size should a brand-new card open at."
    // A fresh card starts as a full row: the add button itself is drawn full
    // width, and a half-width card is a smaller target to then resize.
    const node = { id: newId(), widget: widget.id, view: widget.defaultView, size: 'full' };
    commit([...list(), node]);
    return node.id;
  }, [list, commit]);

  const remove = useCallback(
    (id) => commit(list().filter((n) => n.id !== id)),
    [list, commit],
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
      const current = list().find((n) => n.id === id);
      patch(id, { widget: widget.id, view: resolveView(widget, current?.view) });
    },
    [list, patch],
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
      const current = list();
      const from = current.findIndex((n) => n.id === id);
      if (from < 0) return;
      const rest = current.filter((n) => n.id !== id);
      const target = Math.max(0, Math.min(rest.length, to > from ? to - 1 : to));
      rest.splice(target, 0, current[from]);
      commit(rest);
    },
    [list, commit],
  );

  /** The keyboard path. Drag-and-drop alone would put reordering out of reach of
      anyone not using a mouse, which is not a trade this project makes. */
  const nudge = useCallback(
    (id, delta) => {
      const current = list();
      const from = current.findIndex((n) => n.id === id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= current.length) return;
      const next = current.slice();
      [next[from], next[to]] = [next[to], next[from]];
      commit(next);
    },
    [list, commit],
  );

  return { nodes, add, remove, setWidget, setView, setSize, move, nudge };
}
