import { useMemo } from 'react';
import { usePersistentState } from './usePersistentState.js';
import { intlLocale } from './locale.js';

/**
 * Sorting a table by clicking its own headers.
 *
 * Three pages asked "ordenar por…" through a dropdown, which is a menu that
 * exists only to name columns that are already on screen. Clicking the column
 * is the gesture everyone tries first; the second click reverses it.
 *
 * The logic is the one `Transactions.jsx` already used, lifted out so the rest
 * of the site behaves identically — including remembering the choice, which is
 * what `usePersistentState` is for.
 *
 * `columns` is the same array the table renders from: each sortable entry needs
 * a `key` and a `get(row)` returning something comparable.
 */
export function useSortableRows(rows, columns, storageKey, initial = null) {
  const first = columns.find((c) => c.sortable !== false && typeof c.get === 'function');
  const [sort, setSort] = usePersistentState(
    storageKey,
    initial || { key: first?.key ?? null, dir: 'desc' }
  );

  function toggleSort(key) {
    setSort((prev) =>
      prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }
    );
  }

  const sorted = useMemo(() => {
    const column = columns.find((c) => c.key === sort.key);
    if (typeof column?.get !== 'function') return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = column.get(a);
      const y = column.get(b);
      // Missing values sink to the bottom whichever way the column points —
      // a blank is never the most interesting row in the table.
      const xEmpty = x == null || x === '';
      const yEmpty = y == null || y === '';
      if (xEmpty && yEmpty) return 0;
      if (xEmpty) return 1;
      if (yEmpty) return -1;
      if (typeof x === 'string' && typeof y === 'string') {
        // Collation is language-specific — 'ä' sorts differently in Swedish than
        // in German — so it follows the reader's locale rather than being pinned.
        return x.localeCompare(y, intlLocale()) * dir;
      }
      if (x < y) return -1 * dir;
      if (x > y) return 1 * dir;
      return 0;
    });
  }, [rows, columns, sort]);

  return { rows: sorted, sort, toggleSort };
}
