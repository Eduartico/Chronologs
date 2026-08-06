/**
 * Typing a date.
 *
 * Every date on the site was an `<input type="date">`, which means three
 * separate spinners, a fixed order that ignores the locale you set, and no
 * memory of anything you already told it. Entering a trip that ran from the
 * 21st to the 25th of the same month meant picking the year and the month a
 * second time for no reason.
 *
 * So the field became a text box, and this is the part that reads what was
 * typed. The rule is that whatever the field already knows, you should not
 * have to repeat: with a start of 21/01/2025, typing `25` in the end field is
 * the 25th of January, and typing `04` is the 4th of February — because a trip
 * cannot end before it began, a day earlier than the start must belong to the
 * next month.
 *
 * Pure functions, no React, so the rules can be tested on their own.
 */

const KEYWORDS = ['hoje', 'ontem', 'amanha', 'amanhã'];

/** Today, as the ISO day the rest of the app speaks. */
export function todayIso(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isoOf(y, m, d) {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function partsOf(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').slice(0, 10));
  return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null;
}

/** Whether the calendar actually has this day — 31/04 and 29/02/2025 do not. */
function isRealDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

function shiftDays(iso, days) {
  const p = partsOf(iso);
  if (!p) return null;
  const t = Date.UTC(p.year, p.month - 1, p.day) + days * 86400000;
  const d = new Date(t);
  return isoOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Splits what was typed into the numbers it contains.
 *
 * With separators the parts are whatever the person typed. Without them the
 * digits are cut by length, the way a keypad user expects: `25` is a day,
 * `2503` is a day and a month, `25032026` is the lot.
 */
function digitGroups(text) {
  const raw = text.trim();
  if (/[^\d]/.test(raw)) {
    const parts = raw.split(/[^\d]+/).filter(Boolean).map(Number);
    return parts.length >= 1 && parts.length <= 3 ? parts : null;
  }
  const d = raw;
  if (d.length <= 2) return [Number(d)];
  if (d.length === 3) return [Number(d.slice(0, 1)), Number(d.slice(1))];
  if (d.length === 4) return [Number(d.slice(0, 2)), Number(d.slice(2))];
  if (d.length === 6) return [Number(d.slice(0, 2)), Number(d.slice(2, 4)), Number(d.slice(4))];
  if (d.length === 8) return [Number(d.slice(0, 2)), Number(d.slice(2, 4)), Number(d.slice(4))];
  return null;
}

/** `26` → 2026. Two-digit years are this century; nobody is typing 1926 here. */
function fullYear(y) {
  return y < 100 ? 2000 + y : y;
}

/**
 * The first real date with this day-of-month, walking away from the reference
 * in the direction the field points. `end` looks forward, `start` looks back,
 * and both start at the reference's own month — so a day that still fits the
 * current month never jumps.
 */
function scanByDay(ref, day, forward) {
  let { year, month } = ref;
  for (let i = 0; i < 14; i += 1) {
    if (isRealDate(year, month, day)) {
      const cmp = isoOf(year, month, day);
      const inOrder = forward ? cmp >= isoOf(ref.year, ref.month, ref.day) : cmp <= isoOf(ref.year, ref.month, ref.day);
      if (inOrder) return cmp;
    }
    month += forward ? 1 : -1;
    if (month > 12) {
      month = 1;
      year += 1;
    } else if (month < 1) {
      month = 12;
      year -= 1;
    }
  }
  return null;
}

/** Same idea one level up: the year is what is missing. */
function scanByYear(ref, day, month, forward) {
  const refIso = isoOf(ref.year, ref.month, ref.day);
  for (let i = 0; i < 8; i += 1) {
    const year = ref.year + (forward ? i : -i);
    if (isRealDate(year, month, day)) {
      const cmp = isoOf(year, month, day);
      if (forward ? cmp >= refIso : cmp <= refIso) return cmp;
    }
  }
  return null;
}

/**
 * Reads a typed date into ISO.
 *
 * @param text   what is in the box
 * @param anchor the ISO date of the field this one is paired with, if any
 * @param role   `end` completes forward from the anchor, `start` backwards
 * @param today  injectable, so the tests do not depend on the clock
 * @returns ISO string, `''` for an empty box, or `null` when it cannot be read
 */
export function parseDateInput(text, { anchor = '', role = 'end', today = todayIso() } = {}) {
  const input = String(text ?? '').trim().toLowerCase();
  if (!input) return '';

  const base = partsOf(anchor) ? anchor : today;

  if (KEYWORDS.includes(input)) {
    if (input === 'hoje') return today;
    if (input === 'ontem') return shiftDays(today, -1);
    return shiftDays(today, 1);
  }

  // `+3` / `-2`: relative to the paired field when there is one, otherwise to
  // today. This is how a three-night trip gets entered without arithmetic.
  const relative = /^([+-])(\d{1,3})$/.exec(input);
  if (relative) {
    const n = Number(relative[2]) * (relative[1] === '-' ? -1 : 1);
    return shiftDays(base, n);
  }

  const groups = digitGroups(input);
  if (!groups) return null;
  const [day, month, year] = groups;
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;

  if (groups.length === 3) {
    const y = fullYear(year);
    return isRealDate(y, month, day) ? isoOf(y, month, day) : null;
  }

  const ref = partsOf(base);
  const forward = role !== 'start';

  if (groups.length === 2) {
    if (month < 1 || month > 12) return null;
    // With no paired field there is nothing to complete from, so the current
    // year is the answer and a date that does not exist is an error, not an
    // invitation to jump to some other year.
    if (!partsOf(anchor)) {
      return isRealDate(ref.year, month, day) ? isoOf(ref.year, month, day) : null;
    }
    return scanByYear(ref, day, month, forward);
  }

  if (!partsOf(anchor)) {
    return isRealDate(ref.year, ref.month, day) ? isoOf(ref.year, ref.month, day) : null;
  }
  return scanByDay(ref, day, forward);
}

/**
 * What the field is about to become, drawn as ghost text behind the caret.
 *
 * Waiting for the field to lose focus before showing the inference means the
 * clever part is invisible exactly when it would help: you type `25` and stare
 * at `25`, with no sign that the app already knows it means the 25th of January.
 * Completing *while* typing has to be done without touching the text — moving
 * the caret out from under someone mid-keystroke is worse than not helping — so
 * the completion is only the tail, and only when it agrees with what is typed.
 *
 * Returns '' when there is nothing to add: the input is already complete,
 * unreadable, or a keyword.
 */
export function completionFor(text, options = {}) {
  const typed = String(text ?? '');
  if (!typed.trim() || /[a-z+\-]/i.test(typed)) return '';

  const iso = parseDateInput(typed, options);
  if (!iso) return '';

  const full = displayDate(iso);
  // Only ever an extension of what is on screen, never a correction of it.
  return full.startsWith(typed) ? full.slice(typed.length) : '';
}

/** ISO → what the box shows. */
export function displayDate(iso) {
  const p = partsOf(iso);
  if (!p) return '';
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}/${p.year}`;
}

/**
 * Slashes typed for you, while you type.
 *
 * Only ever adds — never removes and never reorders — so backspacing through
 * the field behaves the way it looks like it should. Keywords and `+3` pass
 * through untouched.
 */
export function maskDateTyping(text) {
  const raw = String(text ?? '');
  if (/[a-z+\-]/i.test(raw)) return raw;
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/** The days a month grid needs, Monday first, with the neighbours it borrows. */
export function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday = 0
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push({ iso: null, day: null, outside: true });
  for (let d = 1; d <= days; d += 1) cells.push({ iso: isoOf(year, month, d), day: d, outside: false });
  while (cells.length % 7 !== 0) cells.push({ iso: null, day: null, outside: true });
  return cells;
}
