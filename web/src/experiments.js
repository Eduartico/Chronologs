/**
 * Chart shapes that are being tried out.
 *
 * One list, iterated by the settings panel and by the pages that host them, in
 * the spirit of `server/framework/builtins.js`: the scheduler and the settings
 * table there iterate one kind of thing rather than each holding their own copy
 * of the same five names.
 *
 * The point of a flag here is not configurability. It is that "does a Sankey
 * actually help you see where the money went, or does it just look impressive?"
 * is a question you answer by living with one for a fortnight, not by arguing
 * about it — and that a chart that loses the argument can then be deleted
 * without an archaeology dig through six pages.
 *
 * Nothing user-visible lives in this file. The label and the sentence under each
 * switch are `settings.experimental.<id>.label` / `.help` in the catalogues, and
 * `web/src/lib/experiments.test.js` fails if an entry here has no text, no
 * server-side default, or an icon that Icon.jsx does not draw.
 */

export const EXPERIMENTS = [
  {
    id: 'sankey',
    icon: 'chartSankey',
    surface: 'dashboard',
  },
  {
    id: 'treemap',
    icon: 'chartTreemap',
    surface: 'dashboard',
  },
  {
    id: 'sunburst',
    icon: 'chartSunburst',
    surface: 'dashboard',
  },
  {
    id: 'streamgraph',
    icon: 'chartStream',
    surface: 'dashboard',
  },
  {
    id: 'waterfall',
    icon: 'chartWaterfall',
    surface: 'dashboard',
  },
  {
    id: 'calendar',
    icon: 'chartCalendar',
    surface: 'dashboard',
  },
  {
    id: 'chord',
    icon: 'chartChord',
    surface: 'accounts',
  },
];

export const EXPERIMENT_IDS = EXPERIMENTS.map((e) => e.id);

/** Every flag on, for the "turn everything on" row and for seeding an install
    that wants to see the lot. */
export function allOn(value = true) {
  return Object.fromEntries(EXPERIMENT_IDS.map((id) => [id, value]));
}
