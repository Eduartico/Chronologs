import { useState, useEffect, useRef } from 'react';

/**
 * `useState` that survives leaving the page.
 *
 * Every screen kept its filters in plain component state, so stepping over to
 * the positions table and back threw away whatever search, filter and sort were
 * in place — which is infuriating precisely because the work of setting them up
 * is what you were in the middle of.
 *
 * Backed by sessionStorage rather than localStorage on purpose: a filter is
 * scoped to the sitting, not to the machine. It outlives navigation and a
 * refresh, and is gone when the tab closes, which is the behaviour people
 * already expect from a search box.
 *
 * Storage failures are never fatal — private-mode browsers throw on write, and
 * a lost filter is not worth a broken page.
 */
export function usePersistentState(key, initial) {
  const storageKey = `chronologs.ui.${key}`;

  const [value, setValue] = useState(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      if (stored != null) return JSON.parse(stored);
    } catch {}
    return typeof initial === 'function' ? initial() : initial;
  });

  // Skips the write on mount: reading a value and immediately storing it back
  // is pure churn.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {}
  }, [storageKey, value]);

  return [value, setValue];
}

/** Forgets everything this module has stored — used by "clear filters". */
export function clearPersistedState(prefix = '') {
  try {
    const full = `chronologs.ui.${prefix}`;
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(full)) sessionStorage.removeItem(key);
    }
  } catch {}
}
