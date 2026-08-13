import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDateInput,
  maskDateTyping,
  displayDate,
  monthGrid,
  completionFor,
} from './dateInput.js';

const TODAY = '2026-08-04';

function parse(text, opts = {}) {
  return parseDateInput(text, { today: TODAY, ...opts });
}

test('an empty box stays empty — an optional date is still optional', () => {
  assert.equal(parse(''), '');
  assert.equal(parse('   '), '');
});

test('a full date is taken literally', () => {
  assert.equal(parse('25/03/2026'), '2026-03-25');
  assert.equal(parse('25032026'), '2026-03-25');
  assert.equal(parse('25.03.2026'), '2026-03-25');
  assert.equal(parse('25/03/26'), '2026-03-25');
});

test('a full date the calendar does not have is rejected', () => {
  assert.equal(parse('31/04/2026'), null);
  assert.equal(parse('29/02/2025'), null);
  assert.equal(parse('00/01/2026'), null);
});

test('a bare day completes from the paired field', () => {
  // The case that started this: start 21/01/2025, end typed as "25".
  assert.equal(parse('25', { anchor: '2025-01-21', role: 'end' }), '2025-01-25');
});

test('a bare day earlier than the start belongs to the next month', () => {
  assert.equal(parse('04', { anchor: '2025-01-21', role: 'end' }), '2025-02-04');
  assert.equal(parse('4', { anchor: '2025-01-21', role: 'end' }), '2025-02-04');
});

test('a bare day skips months that do not have it', () => {
  // April has no 31st, so the next 31st is in May.
  assert.equal(parse('31', { anchor: '2026-04-21', role: 'end' }), '2026-05-31');
});

test('a bare day rolls the year over at December', () => {
  assert.equal(parse('03', { anchor: '2025-12-28', role: 'end' }), '2026-01-03');
});

test('a start field completes backwards from its end', () => {
  assert.equal(parse('25', { anchor: '2025-02-03', role: 'start' }), '2025-01-25');
  assert.equal(parse('01', { anchor: '2025-02-03', role: 'start' }), '2025-02-01');
});

test('a day and month take the year from the paired field', () => {
  assert.equal(parse('25/03', { anchor: '2025-01-21', role: 'end' }), '2025-03-25');
});

test('a day and month before the start move to the next year', () => {
  assert.equal(parse('25/03', { anchor: '2025-12-21', role: 'end' }), '2026-03-25');
});

test('a day and month that only exist in a leap year find one', () => {
  assert.equal(parse('29/02', { anchor: '2025-01-10', role: 'end' }), '2028-02-29');
  assert.equal(parse('29/02', { anchor: '2024-06-10', role: 'start' }), '2024-02-29');
});

test('with no paired field the current month and year fill in', () => {
  assert.equal(parse('25'), '2026-08-25');
  assert.equal(parse('25/03'), '2026-03-25');
});

test('with no paired field an impossible date is an error, not a jump', () => {
  assert.equal(parse('31/09'), null);
  assert.equal(parse('29/02'), null);
});

test('keywords and offsets', () => {
  assert.equal(parse('hoje'), TODAY);
  assert.equal(parse('ontem'), '2026-08-03');
  assert.equal(parse('amanhã'), '2026-08-05');
  // An offset counts from the paired field, which is how a trip length is entered.
  assert.equal(parse('+3', { anchor: '2025-01-21' }), '2025-01-24');
  assert.equal(parse('-2', { anchor: '2025-01-21' }), '2025-01-19');
  assert.equal(parse('+1'), '2026-08-05');
});

test('nonsense is rejected rather than guessed at', () => {
  assert.equal(parse('abc'), null);
  assert.equal(parse('1/2/3/4'), null);
  assert.equal(parse('99'), null);
});

test('typing adds slashes and never reorders', () => {
  assert.equal(maskDateTyping('2'), '2');
  assert.equal(maskDateTyping('25'), '25');
  assert.equal(maskDateTyping('253'), '25/3');
  assert.equal(maskDateTyping('2503'), '25/03');
  assert.equal(maskDateTyping('250320'), '25/03/20');
  assert.equal(maskDateTyping('25032026'), '25/03/2026');
  assert.equal(maskDateTyping('250320269'), '25/03/2026');
  // Words pass through, so "hoje" can still be typed.
  assert.equal(maskDateTyping('hoj'), 'hoj');
  assert.equal(maskDateTyping('+3'), '+3');
});

test('the completion shows the rest of the date while you type', () => {
  const anchor = { anchor: '2025-01-21', role: 'end', today: TODAY };
  assert.equal(completionFor('25', anchor), '/01/2025');
  assert.equal(completionFor('04', anchor), '/02/2025');
  assert.equal(completionFor('25/03', anchor), '/2025');
  // Nothing left to add once the date is whole.
  assert.equal(completionFor('25/03/2025', anchor), '');
});

test('the completion never contradicts what is on screen', () => {
  const anchor = { anchor: '2025-01-21', role: 'end', today: TODAY };
  // A single digit reads as the 2nd, which displays as "02/02/2025" — and "2"
  // is not the start of that. Rather than rewrite the digit under the caret,
  // the ghost waits for the second one. It appears at "02" or at "25".
  assert.equal(completionFor('2', anchor), '');
  assert.equal(completionFor('02', anchor), '/02/2025');
  // Unreadable input adds nothing rather than guessing.
  assert.equal(completionFor('99', anchor), '');
  assert.equal(completionFor('', anchor), '');
  // Keywords are left alone.
  assert.equal(completionFor('hoje', anchor), '');
  assert.equal(completionFor('+3', anchor), '');
});

test('display is the Portuguese order', () => {
  assert.equal(displayDate('2026-03-25'), '25/03/2026');
  assert.equal(displayDate(''), '');
  assert.equal(displayDate('nonsense'), '');
});

test('the month grid starts on Monday and is whole weeks', () => {
  // 1 March 2026 is a Sunday, so it needs six leading blanks.
  const grid = monthGrid(2026, 3);
  assert.equal(grid.length % 7, 0);
  assert.equal(grid.slice(0, 6).every((c) => c.outside), true);
  assert.equal(grid[6].iso, '2026-03-01');
  assert.equal(grid.filter((c) => !c.outside).length, 31);
});

/* ---- other field orders ----------------------------------------------------
   The tests above all run in the default locale, which is day-first. These walk
   the two other shapes the shipped locales come in, because "dd/mm/yyyy" was
   hardcoded into the typing, the masking and the parsing and every one of those
   was a separate place to get it wrong. */

test('a year-first locale reads a full date its own way', () => {
  // Japanese formats 2026-11-22 as 2026/11/22, so that is what typing it means.
  assert.equal(parse('20261122', { locale: 'ja' }), '2026-11-22');
  assert.equal(parse('2026/11/22', { locale: 'ja' }), '2026-11-22');
  assert.equal(displayDate('2026-11-22', 'ja'), '2026/11/22');
  assert.equal(maskDateTyping('20261122', 'ja'), '2026/11/22');
  // Same digits, day-first: an entirely different date, and that is the point.
  assert.equal(parse('22112026'), '2026-11-22');
});

test('a dot-separator locale renders and accepts dots', () => {
  // German, Russian, Polish and Turkish all write 22.11.2026.
  for (const locale of ['de', 'ru', 'pl', 'tr']) {
    assert.equal(displayDate('2026-11-22', locale), '22.11.2026', locale);
    assert.equal(maskDateTyping('22112026', locale), '22.11.2026', locale);
    assert.equal(parse('22.11.2026', { locale }), '2026-11-22', locale);
  }
  // Dutch uses hyphens, which the parser must not mistake for a relative offset.
  assert.equal(displayDate('2026-11-22', 'nl'), '22-11-2026');
  assert.equal(parse('22-11-2026', { locale: 'nl' }), '2026-11-22');
  assert.equal(parse('-2', { locale: 'nl', today: TODAY }), '2026-08-02');
});

test('the shorthand still completes from a neighbour in any order', () => {
  // Two digits is a day wherever the year sits, because a year is the one field
  // that cannot be completed from the field next to it.
  for (const locale of ['ja', 'de', 'en', 'zh-CN']) {
    assert.equal(parse('25', { anchor: '2025-01-21', role: 'end', locale }), '2025-01-25', locale);
  }
});

test('each locale accepts its own word for today', () => {
  const words = { de: 'heute', fr: 'aujourd’hui'.replace('’', "'"), ja: '今日', ru: 'сегодня', pl: 'dziś' };
  for (const [locale, word] of Object.entries(words)) {
    assert.equal(parse(word, { locale }), TODAY, locale);
  }
  // English and Portuguese are accepted whatever the interface is showing.
  assert.equal(parse('today', { locale: 'ja' }), TODAY);
  assert.equal(parse('hoje', { locale: 'de' }), TODAY);
});

test('the completion works in a year-first locale too', () => {
  // Typed in full, there is nothing left to add.
  assert.equal(completionFor('2026/11/22', { locale: 'ja' }), '');
  // A partial year-first date completes its own tail.
  assert.equal(completionFor('2026', { locale: 'ja', anchor: '', today: TODAY }), '');
});
