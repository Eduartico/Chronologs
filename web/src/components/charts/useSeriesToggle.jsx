import { useCallback, useMemo, useRef, useState } from 'react';
import { usePersistentState } from '../../lib/usePersistentState.js';

// A click has to wait this long to see if a second one is coming before it
// commits to a plain toggle — long enough for a real double-click, short
// enough that a single click still feels immediate.
const DBLCLICK_MS = 220;

/**
 * The legend is the filter.
 *
 * A stacked chart with eight bands invites a click on the legend; doing nothing
 * was the surprise, and the alternative on offer — a "categorias" dropdown
 * above the card — asks you to name a series you are already pointing at.
 *
 * The one rule worth keeping: hiding the last visible series shows everything
 * again, so nobody is left staring at an empty chart wondering how to undo it.
 *
 * A double-click isolates instead — hide everyone else, keep only this one —
 * and a second double-click on the same entry reverses it. Comparing "just
 * this category" against the rest used to mean clicking every other legend
 * entry one at a time.
 *
 * Lifted out of Dashboard so every chart with a legend behaves the same.
 */
export function useSeriesToggle(storageKey, allKeys) {
  const [hiddenList, setHiddenList] = usePersistentState(storageKey, []);
  const hidden = useMemo(() => new Set(hiddenList), [hiddenList]);
  const pendingClick = useRef(null);
  const lastIsolated = useRef(null);

  const toggle = useCallback(
    (key) => {
      if (!key) return;
      setHiddenList((prev) => {
        if (prev.includes(key)) return prev.filter((k) => k !== key);
        const next = [...prev, key];
        return next.length >= (allKeys?.length ?? 0) ? [] : next;
      });
    },
    [setHiddenList, allKeys]
  );

  const reset = useCallback(() => setHiddenList([]), [setHiddenList]);

  const isolate = useCallback(
    (key) => {
      if (!key || !allKeys?.length) return;
      if (lastIsolated.current === key) {
        lastIsolated.current = null;
        setHiddenList([]);
        return;
      }
      lastIsolated.current = key;
      setHiddenList(allKeys.filter((k) => k !== key));
    },
    [setHiddenList, allKeys]
  );

  // `value` — the legend's own label — is what `allKeys`, `hidden`, and the
  // `formatter` below all key on everywhere this hook is used. `dataKey` is
  // the same string for charts where the series key and its display name are
  // identical (the category-trend area, the pie breakdowns), which is what
  // let this go unnoticed — but the cashflow chart names its lines "Receitas"
  // /"Despesas" while their `dataKey`s are "income"/"expense", so preferring
  // `dataKey` there silently toggled a key nothing was ever checking against.
  const keyFor = (entry) => entry?.value || entry?.dataKey;

  const handleClick = useCallback(
    (entry) => {
      const key = keyFor(entry);
      if (!key) return;
      clearTimeout(pendingClick.current);
      pendingClick.current = setTimeout(() => toggle(key), DBLCLICK_MS);
    },
    [toggle]
  );

  const handleDoubleClick = useCallback(
    (entry) => {
      const key = keyFor(entry);
      if (!key) return;
      clearTimeout(pendingClick.current);
      isolate(key);
    },
    [isolate]
  );

  /*
   * Hover isolation.
   *
   * On a chart with six or eight series, "which one is this" is answered today by
   * moving the pointer down to the legend and reading a colour swatch. Dropping
   * everything else to 15% and thickening the one under the pointer answers it
   * where the eye already is.
   *
   * It lives here rather than in a second hook because this one is already
   * imported at every chart site — a separate `useHoverIsolate` would mean adding
   * an import and a state variable to a dozen files to get behaviour that belongs
   * to the same interaction as the click and the double-click.
   *
   * Focus is not persisted. Unlike the hidden set, it is a pointer position, and
   * restoring it on reload would leave a chart mysteriously dimmed.
   */
  const [focused, setFocused] = useState(null);

  const focusProps = useMemo(
    () => ({
      onMouseEnter: (entry) => setFocused(keyFor(entry) ?? null),
      onMouseLeave: () => setFocused(null),
    }),
    [],
  );

  /** Opacity for series `key`, given what the pointer is over. */
  const dimOf = useCallback((key) => (!focused || focused === key ? 1 : 0.15), [focused]);

  /** Stroke width for series `key` — the second, non-colour half of isolation. */
  const widthOf = useCallback((key, base = 2) => (focused === key ? base + 1 : base), [focused]);

  /** Spread onto a recharts `<Legend>` to make it clickable and to dim what is off. */
  const legendProps = useMemo(
    () => ({
      wrapperStyle: { fontSize: 12, cursor: 'pointer' },
      onClick: handleClick,
      onDoubleClick: handleDoubleClick,
      onMouseEnter: focusProps.onMouseEnter,
      onMouseLeave: focusProps.onMouseLeave,
      formatter: (value) => (
        <span style={{ opacity: hidden.has(value) ? 0.35 : dimOf(value) }}>{value}</span>
      ),
    }),
    [handleClick, handleDoubleClick, hidden, focusProps, dimOf],
  );

  return { hidden, toggle, reset, isolate, legendProps, focused, focusProps, dimOf, widthOf };
}
