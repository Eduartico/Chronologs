/**
 * Deterministic JSON, for comparing one run of the system against another.
 *
 * `JSON.stringify` is not stable enough to diff two captures with: object key
 * order follows insertion order, so a refactor that builds the same object in a
 * different order produces a different string for identical data — a false
 * alarm on every line. Worse, `JSON.stringify(new Set())` is `{}`, and the
 * projection returns Sets (`tagsByTransaction`), so a real change inside one
 * would be invisible.
 *
 * Everything here therefore sorts keys, renders Sets as sorted arrays and Maps
 * as sorted entry pairs, and leaves arrays in their own order — array order is
 * data (the transactions list is sorted on purpose) and must be compared as
 * given.
 */

function normalise(value, seen) {
  if (value === null || typeof value !== 'object') {
    // Infinity and NaN both stringify to `null`, which would make two different
    // broken numbers compare equal. Tag them instead.
    if (typeof value === 'number' && !Number.isFinite(value)) return `«${String(value)}»`;
    return value;
  }

  if (seen.has(value)) return '«circular»';
  seen.add(value);

  let out;
  if (Array.isArray(value)) {
    out = value.map((v) => normalise(v, seen));
  } else if (value instanceof Set) {
    out = [...value].map((v) => normalise(v, seen)).sort(compare);
  } else if (value instanceof Map) {
    out = [...value.entries()]
      .map(([k, v]) => [normalise(k, seen), normalise(v, seen)])
      .sort((a, b) => compare(a[0], b[0]));
  } else if (value instanceof Date) {
    out = value.toISOString();
  } else if (Buffer.isBuffer(value)) {
    out = `«buffer:${value.length}»`;
  } else {
    out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = normalise(value[key], seen);
    }
  }

  seen.delete(value);
  return out;
}

function compare(a, b) {
  const sa = typeof a === 'string' ? a : JSON.stringify(a);
  const sb = typeof b === 'string' ? b : JSON.stringify(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** The value with every key ordered, ready to stringify or walk. */
export function canonical(value) {
  return normalise(value, new Set());
}

export function stringify(value) {
  return JSON.stringify(canonical(value), null, 2);
}

/**
 * The first place two canonical values differ, as a JSON path.
 *
 * A whole-file diff of a 2900-movement projection is unreadable, and the second
 * difference is almost always a consequence of the first. This reports one
 * location, with both sides truncated to something a terminal can show.
 */
export function firstDifference(expected, actual, path = '$') {
  if (Object.is(expected, actual)) return null;

  const bothArrays = Array.isArray(expected) && Array.isArray(actual);
  const bothObjects =
    !bothArrays &&
    expected !== null &&
    actual !== null &&
    typeof expected === 'object' &&
    typeof actual === 'object';

  if (bothArrays) {
    if (expected.length !== actual.length) {
      return { path, expected: `array(${expected.length})`, actual: `array(${actual.length})` };
    }
    for (let i = 0; i < expected.length; i++) {
      const diff = firstDifference(expected[i], actual[i], `${path}[${i}]`);
      if (diff) return diff;
    }
    return null;
  }

  if (bothObjects) {
    const keys = [...new Set([...Object.keys(expected), ...Object.keys(actual)])].sort();
    for (const key of keys) {
      if (!(key in expected)) return { path: `${path}.${key}`, expected: '«missing»', actual: preview(actual[key]) };
      if (!(key in actual)) return { path: `${path}.${key}`, expected: preview(expected[key]), actual: '«missing»' };
      const diff = firstDifference(expected[key], actual[key], `${path}.${key}`);
      if (diff) return diff;
    }
    return null;
  }

  if (expected === actual) return null;
  return { path, expected: preview(expected), actual: preview(actual) };
}

function preview(value, max = 120) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text == null) return String(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
