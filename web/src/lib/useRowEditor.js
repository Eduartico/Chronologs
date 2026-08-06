import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The state machine behind an editable row.
 *
 * Every list on the site had grown its own version of "which row is being
 * edited" — some with a draft object, some writing straight to the item, one
 * with a browser `confirm()`. They drifted, so the same gesture did slightly
 * different things on different pages.
 *
 * A row is in exactly one of three states: at rest, being edited, or armed for
 * deletion. Arming is what replaces the confirm dialog for everyday objects: a
 * first click on the bin turns it into a tick in the same spot, and a second
 * click there deletes — click-click, click-click, deleting several rows falls
 * into one rhythm instead of a click on the right followed by one on the left.
 * It disarms itself shortly after, because a control left loaded is a trap for
 * the next click that lands nearby; short enough that it never reads as a
 * standing option, long enough to be the deliberate second click rather than
 * a double-click artifact.
 */
const DISARM_MS = 1000;

export function useRowEditor({ onSave, onDelete } = {}) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);

  const disarm = useCallback(() => {
    clearTimeout(timer.current);
    setDeletingId(null);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const start = useCallback(
    (item, fields) => {
      disarm();
      setEditingId(item.id);
      setDraft(fields ?? { ...item });
    },
    [disarm]
  );

  const cancel = useCallback(() => {
    setEditingId(null);
    setDraft(null);
  }, []);

  /** Merges into the draft, so a field only has to know about itself. */
  const patch = useCallback((fields) => {
    setDraft((d) => ({ ...(d || {}), ...fields }));
  }, []);

  // A save that fails leaves the row open with what was typed still in it.
  // Closing the editor and dropping the draft would make the user retype work
  // the server merely refused.
  const commit = useCallback(async () => {
    if (!editingId || !draft) return;
    setBusy(true);
    try {
      await onSave?.(editingId, draft);
      setEditingId(null);
      setDraft(null);
    } catch {
      /* the handler has already said what went wrong */
    } finally {
      setBusy(false);
    }
  }, [editingId, draft, onSave]);

  const askDelete = useCallback(
    (id) => {
      clearTimeout(timer.current);
      setDeletingId(id);
      timer.current = setTimeout(() => setDeletingId(null), DISARM_MS);
    },
    []
  );

  const confirmDelete = useCallback(
    async (id) => {
      disarm();
      setBusy(true);
      try {
        await onDelete?.(id);
      } finally {
        setBusy(false);
      }
    },
    [disarm, onDelete]
  );

  return {
    editingId,
    draft,
    deletingId,
    busy,
    start,
    cancel,
    patch,
    commit,
    askDelete,
    confirmDelete,
    disarm,
    isEditing: (id) => editingId === id,
    isDeleting: (id) => deletingId === id,
  };
}
