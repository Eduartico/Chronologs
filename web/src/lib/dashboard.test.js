import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import {
  WIDGETS,
  WIDGET_IDS,
  VIEW_ICONS,
  SIZES,
  SIZE_VALUES,
  CHART_HEIGHT,
  widgetById,
  resolveView,
  resolveNode,
} from '../dashboard/catalogue.js';
import { DEFAULT_SETTINGS } from '../../../server/lib/settings.js';

/*
 * Five lists that have to agree and that nothing in the running app forces to.
 *
 * The catalogue names what a card can be; the catalogues name it on screen;
 * `Icon.jsx` draws it; `DashboardNode` mounts a component for it; and the
 * server's shipped layout references it. A widget added to one of those alone
 * fails differently each time — a picker tile with a raw dotted key on it, an
 * icon that renders as nothing at all, or a stored node that silently disappears
 * on next load. This is the test that ties them together.
 *
 * It replaced `experiments.test.js`, which did the same job for the flags this
 * catalogue made redundant.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

const catalogues = {};
for (const file of readdirSync(join(SRC, 'i18n', 'locales')).filter((f) => f.endsWith('.js'))) {
  catalogues[file.replace(/\.js$/, '')] = (await import(pathToFileURL(join(SRC, 'i18n', 'locales', file)).href)).default;
}

const icons = readFileSync(join(SRC, 'components', 'Icon.jsx'), 'utf-8');
const nodeSource = readFileSync(join(SRC, 'dashboard', 'DashboardNode.jsx'), 'utf-8');

test('widget ids are unique', () => {
  assert.equal(new Set(WIDGET_IDS).size, WIDGET_IDS.length);
});

test('every widget has a name and a description in every language', () => {
  for (const [code, cat] of Object.entries(catalogues)) {
    for (const id of WIDGET_IDS) {
      assert.ok(cat[`widget.${id}.name`], `${code} has no name for the "${id}" card`);
      assert.ok(cat[`widget.${id}.desc`], `${code} has no description for the "${id}" card`);
    }
  }
});

test('every view a widget offers has a label in every language', () => {
  const views = new Set(WIDGETS.flatMap((w) => w.views));
  for (const [code, cat] of Object.entries(catalogues)) {
    for (const view of views) {
      assert.ok(cat[`view.${view}`], `${code} has no label for the "${view}" view`);
    }
  }
});

test('every widget and every view picks an icon Icon.jsx actually draws', () => {
  // A name Icon.jsx does not know renders as nothing at all, which reads on
  // screen as a broken layout rather than as a missing icon.
  const drawn = (name) => new RegExp(`\\b${name}:`).test(icons);
  for (const widget of WIDGETS) {
    assert.ok(drawn(widget.icon), `Icon.jsx has no "${widget.icon}" for the ${widget.id} card`);
    for (const view of widget.views) {
      assert.ok(VIEW_ICONS[view], `no icon is mapped for the "${view}" view`);
      assert.ok(drawn(VIEW_ICONS[view]), `Icon.jsx has no "${VIEW_ICONS[view]}" for the "${view}" view`);
    }
  }
  for (const size of SIZES) {
    assert.ok(drawn(size.icon), `Icon.jsx has no "${size.icon}" for size ${size.value}`);
  }
});

test('every size has a label in every language, and a height', () => {
  for (const value of SIZE_VALUES) {
    assert.ok(Number.isFinite(CHART_HEIGHT[value]), `size ${value} has no chart height`);
    for (const [code, cat] of Object.entries(catalogues)) {
      assert.ok(cat[`dashboard.size.${value}`], `${code} does not name size ${value}`);
    }
  }
});

test('every widget has a component mounted for it', () => {
  // The map in DashboardNode is the one place a widget id becomes something that
  // renders. A catalogue entry with no line there is a card that can be picked
  // from the tile grid and then draws nothing.
  for (const id of WIDGET_IDS) {
    assert.match(nodeSource, new RegExp(`\\n\\s+${id}:`), `DashboardNode has no component for "${id}"`);
  }
});

test('a widget’s default view is one of its own views', () => {
  for (const widget of WIDGETS) {
    assert.ok(widget.views.includes(widget.defaultView), `${widget.id} defaults to a view it does not offer`);
    assert.ok(SIZE_VALUES.includes(widget.defaultSize), `${widget.id} defaults to an impossible size`);
    assert.ok(widget.views.includes('table'), `${widget.id} has no table view, so it has no accessible fallback`);
  }
});

test('every shipped node names a widget and a view that exist', () => {
  for (const node of DEFAULT_SETTINGS.dashboard.nodes) {
    const widget = widgetById(node.widget);
    assert.ok(widget, `the shipped layout names "${node.widget}", which the catalogue does not define`);
    assert.ok(widget.views.includes(node.view), `the shipped "${node.widget}" node opens in a view it cannot draw`);
  }
});

/* ---- tolerance for a layout this build does not fully understand -----------
   A settings file is a user's file. It can be hand-edited, and it can have been
   written by a version carrying a card this one has since dropped. Neither may
   take the whole dashboard down. */

test('an unknown widget is skipped, not thrown on', () => {
  assert.equal(widgetById('does-not-exist'), undefined);
  assert.equal(resolveNode({ id: 'x', widget: 'does-not-exist', view: 'pie', size: 1 }), null);
  assert.equal(resolveNode(undefined), null);
});

test('an unknown view falls back to the widget’s default', () => {
  const breakdown = widgetById('breakdown');
  assert.equal(resolveView(breakdown, 'sankey'), breakdown.defaultView);
  assert.equal(resolveView(breakdown, 'pie'), 'pie');
  assert.equal(resolveView(null, 'pie'), null);
});

test('an impossible size falls back to the widget’s default', () => {
  const resolved = resolveNode({ id: 'x', widget: 'cashflow', view: 'line', size: 'enormous' });
  assert.equal(resolved.size, widgetById('cashflow').defaultSize);
  assert.equal(resolveNode({ id: 'x', widget: 'cashflow', view: 'line', size: 'tall' }).size, 'tall');
});

/* A layout written under the old numbering is a file someone already has. The
   widths used to be 1, 2 and 4 — half, full, and full at double height — and a
   reader who arranged their dashboard before this build must not open it to six
   cards that have all reverted to their defaults. */
test('a layout written under the old numbering still means what it meant', () => {
  assert.equal(resolveNode({ id: 'x', widget: 'cashflow', view: 'line', size: 1 }).size, 'half');
  assert.equal(resolveNode({ id: 'x', widget: 'cashflow', view: 'line', size: 2 }).size, 'full');
  assert.equal(resolveNode({ id: 'x', widget: 'cashflow', view: 'line', size: 4 }).size, 'tall');
});

test('every width has a column span, a height and a label', () => {
  for (const size of SIZES) {
    assert.ok(size.columns >= 1 && size.columns <= 12, `${size.value} spans ${size.columns} of 12`);
    assert.ok(Number.isFinite(CHART_HEIGHT[size.value]), `${size.value} has no chart height`);
  }
});
