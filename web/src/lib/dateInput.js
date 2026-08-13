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
import { firstDayOfWeek, dateFieldOrder, currentLocale } from './locale.js';

/**
 * Words that mean a date.
 *
 * English and Portuguese are accepted whatever the interface is showing, and
 * they always have been — someone who types `hoje` out of habit should not be
 * told it is unreadable because the app is in English that day. The active
 * language's own three words are added on top.
 *
 * These live here rather than in the catalogues because this module is pure and
 * has no React around it, and because they are parser input rather than copy:
 * nothing here is ever displayed, accents are optional on the way in, and a
 * translator improving the wording of a *label* must not silently change what
 * the field will accept.
 */
const ALWAYS = {
  hoje: 0,
  today: 0,
  ontem: -1,
  yesterday: -1,
  amanha: 1,
  'amanhã': 1,
  tomorrow: 1,
};

/** [today, yesterday, tomorrow] per locale, unaccented spellings included. */
const KEYWORDS_BY_LOCALE = {
  es: [['hoy'], ['ayer'], ['manana', 'mañana']],
  fr: [["aujourd'hui", 'aujourdhui'], ['hier'], ['demain']],
  de: [['heute'], ['gestern'], ['morgen']],
  it: [['oggi'], ['ieri'], ['domani']],
  nl: [['vandaag'], ['gisteren'], ['morgen']],
  pl: [['dzis', 'dziś'], ['wczoraj'], ['jutro']],
  ru: [['сегодня'], ['вчера'], ['завтра']],
  tr: [['bugun', 'bugün'], ['dun', 'dün'], ['yarin', 'yarın']],
  // Hindi uses कल for both yesterday and tomorrow — the tense of the verb
  // decides, and there is no verb in a date box. Only "today" is unambiguous;
  // the relative `+1` / `-1` form covers the other two in every language.
  hi: [['आज'], [], []],
  ja: [['今日', 'きょう'], ['昨日', 'きのう'], ['明日', 'あした']],
  ko: [['오늘'], ['어제'], ['내일']],
  'zh-CN': [['今天'], ['昨天'], ['明天']],
};

function keywords(locale = currentLocale()) {
  const table = { ...ALWAYS };
  const entry = KEYWORDS_BY_LOCALE[locale];
  if (entry) {
    entry[0].forEach((w) => (table[w] = 0));
    entry[1].forEach((w) => (table[w] = -1));
    entry[2].forEach((w) => (table[w] = 1));
  }
  return table;
}

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
 * Splits what was typed into the fields it contains, in this locale's order.
 *
 * With separators the parts are whatever the person typed. Without them the
 * digits are cut by length, the way a keypad user expects: in Lisbon `25` is a
 * day, `2503` is a day and a month, `25032026` is the lot; in Tokyo the same
 * three inputs are a month, a month and a day, and a full year-first date.
 *
 * Two orders are in play, and that is deliberate. A *complete* date follows the
 * locale exactly — `20261122` in Japanese is 2026-11-22. A *partial* one drops
 * the year and keeps only the day and month in their relative order, because
 * the whole point of typing two digits is that the field completes the rest
 * from its neighbour, and a year cannot be completed from anything.
 *
 * Returns `{ day, month, year }` with the parts that were supplied, or null.
 */
function digitGroups(text, locale) {
  const { order } = dateFieldOrder(locale);
  const short = order.filter((f) => f !== 'year');
  const assign = (fields, values) => {
    const out = {};
    fields.forEach((f, i) => {
      if (values[i] !== undefined) out[f] = values[i];
    });
    return out;
  };

  const raw = text.trim();
  if (/[^\d]/.test(raw)) {
    const parts = raw.split(/[^\d]+/).filter(Boolean).map(Number);
    if (parts.length < 1 || parts.length > 3) return null;
    // Typed separators mean the reader is spelling the date out, so the full
    // locale order applies — except for two parts, which is still the shorthand.
    if (parts.length === 1) return { day: parts[0] };
    return assign(parts.length === 3 ? order : short, parts);
  }

  const d = raw;
  const cut = (widths) => {
    const values = [];
    let at = 0;
    for (const w of widths) {
      values.push(Number(d.slice(at, at + w)));
      at += w;
    }
    return values;
  };

  // One number on its own is always a day, in every locale. The shorthand's
  // whole purpose is "complete the rest from the field next door", and a bare
  // month has nothing to complete — so month-first order applies from two
  // numbers upward, not from one.
  if (d.length <= 2) return { day: Number(d) };
  if (d.length === 3) return assign(short, [Number(d.slice(0, 1)), Number(d.slice(1))]);
  if (d.length === 4) return assign(short, [Number(d.slice(0, 2)), Number(d.slice(2))]);
  if (d.length === 6) return assign(order, cut(order.map(() => 2)));
  if (d.length === 8) return assign(order, cut(order.map((f) => (f === 'year' ? 4 : 2))));
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
 * @param locale injectable, so the tests can walk every field order
 * @returns ISO string, `''` for an empty box, or `null` when it cannot be read
 */
export function parseDateInput(
  text,
  { anchor = '', role = 'end', today = todayIso(), locale = currentLocale() } = {},
) {
  const input = String(text ?? '').trim().toLowerCase();
  if (!input) return '';

  const base = partsOf(anchor) ? anchor : today;

  const words = keywords(locale);
  if (input in words) {
    return words[input] === 0 ? today : shiftDays(today, words[input]);
  }

  // `+3` / `-2`: relative to the paired field when there is one, otherwise to
  // today. This is how a three-night trip gets entered without arithmetic, and
  // it is the only shorthand that reads the same in every language.
  const relative = /^([+-])(\d{1,3})$/.exec(input);
  if (relative) {
    const n = Number(relative[2]) * (relative[1] === '-' ? -1 : 1);
    return shiftDays(base, n);
  }

  const groups = digitGroups(input, locale);
  if (!groups) return null;
  const { day, month, year } = groups;
  const supplied = Object.keys(groups).length;
  if (!Number.isFinite(day) || day < 1 || day > 31) return null;

  if (supplied === 3) {
    const y = fullYear(year);
    return isRealDate(y, month, day) ? isoOf(y, month, day) : null;
  }

  const ref = partsOf(base);
  const forward = role !== 'start';

  if (supplied === 2) {
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
  // A leading sign is the relative form, and anything that is not a digit or a
  // separator is a keyword. Neither has a tail to complete. `.` and `-` are
  // separators in half the shipped locales, so they can no longer be read as
  // "this is not a date".
  if (!typed.trim() || /^[+-]/.test(typed) || /[^\d\s./-]/.test(typed)) return '';

  const iso = parseDateInput(typed, options);
  if (!iso) return '';

  const full = displayDate(iso, options.locale);
  // Only ever an extension of what is on screen, never a correction of it.
  return full.startsWith(typed) ? full.slice(typed.length) : '';
}

/** ISO → what the box shows, in this locale's order and with its separator. */
export function displayDate(iso, locale) {
  const p = partsOf(iso);
  if (!p) return '';
  const { order, separator } = dateFieldOrder(locale);
  const width = { day: 2, month: 2, year: 4 };
  return order.map((f) => String(p[f]).padStart(width[f], '0')).join(separator);
}

/**
 * Separators typed for you, while you type.
 *
 * Only ever adds — never removes and never reorders — so backspacing through
 * the field behaves the way it looks like it should. Keywords and `+3` pass
 * through untouched.
 *
 * Follows the full locale order, including the year's position and width, so
 * what the mask builds is what `displayDate` would have rendered. In a
 * day-first locale that is byte-for-byte the `dd/mm/yyyy` this used to hardcode.
 */
export function maskDateTyping(text, locale) {
  const raw = String(text ?? '');
  if (/^[+-]/.test(raw) || /[^\d\s./-]/.test(raw)) return raw;
  const { order, separator } = dateFieldOrder(locale);
  const widths = order.map((f) => (f === 'year' ? 4 : 2));
  const digits = raw.replace(/\D/g, '').slice(0, 8);

  const out = [];
  let at = 0;
  for (const w of widths) {
    if (at >= digits.length) break;
    out.push(digits.slice(at, at + w));
    at += w;
  }
  return out.join(separator);
}

/** The days a month grid needs, Monday first, with the neighbours it borrows. */
export function monthGrid(year, month, firstDay = firstDayOfWeek()) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  // The lead-in used to be hardcoded to Monday, which is right for both locales
  // the app ships and wrong the moment en-US is added. `firstDayOfWeek()` is a
  // data lookup, so adding a locale that starts on Sunday becomes a one-line
  // change rather than a hunt through calendar maths.
  const lead = (first.getUTCDay() - firstDay + 7) % 7;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push({ iso: null, day: null, outside: true });
  for (let d = 1; d <= days; d += 1) cells.push({ iso: isoOf(year, month, d), day: d, outside: false });
  while (cells.length % 7 !== 0) cells.push({ iso: null, day: null, outside: true });
  return cells;
}
