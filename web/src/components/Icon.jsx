/**
 * Inline SVG icon set.
 *
 * Emoji were being used as navigation and category glyphs, which never match a
 * theme: they carry their own colours, their own weight, and they render
 * differently on every platform. These are stroke-only paths that inherit
 * `currentColor`, so they take the colour of whatever they sit in.
 *
 * Everything is inline — no icon package, no network fetch, nothing to keep in
 * sync with a CDN.
 */

// 24x24 viewBox paths. Keep them stroke-based (no fills) so weight stays even
// with the surrounding text.
const PATHS = {
  // --- navigation ---
  dashboard: 'M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z',
  transactions: 'M3 6h18M3 12h18M3 18h12',
  pending: 'M12 3l9 16H3zM12 9v5M12 17h.01',
  investments: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  // A folder with a divider. It was a 2×2 grid of squares, which at 20px in the
  // rail was all but indistinguishable from `dashboard` right above it — two
  // four-panel grids stacked on top of each other. Silhouette is what tells
  // navigation icons apart, so this one needed a different one, not a nicer grid.
  categories: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2zM3 11h18',
  // The four-pointed sparkle that has come to mean "the machine worked this out".
  insights: 'M11 3l1.8 4.7L17.5 9.5 12.8 11.3 11 16l-1.8-4.7L4.5 9.5l4.7-1.8zM18 15l.8 2.2 2.2.8-2.2.8L18 21l-.8-2.2-2.2-.8 2.2-.8z',
  // A ruled sheet: rows with a condition on the left and an outcome on the right.
  rules: 'M5 3h14v18H5zM8 8h3M8 12h3M8 16h3M14 8h2M14 12h2M14 16h2',
  // Two nodes joined by a link, which is what a connection to a provider is.
  connections: 'M7.5 9a3 3 0 100 6 3 3 0 000-6zM16.5 9a3 3 0 100 6 3 3 0 000-6zM10.5 12h3',
  settings: 'M12 9a3 3 0 100 6 3 3 0 000-6zM19.4 15a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z',
  duplicates: 'M8 8h12v12H8zM4 16V4h12',
  // Navigation "Viagens": an airliner seen from above, nose up. It was a
  // suitcase, chosen only so it would not collide with the `plane` category
  // glyph — but a suitcase is luggage, not travel. The two are still told apart
  // by silhouette: this one is symmetric and vertical, `plane` is a tilted jet.
  travel: 'M12 2c1.2 0 2 1.7 2 4.2V9l7 4.2v2L14 13v3.8l2.5 1.9V21L12 19.8 7.5 21v-2.3L10 16.8V13l-7 2.2v-2L10 9V6.2C10 3.7 10.8 2 12 2z',
  accounts: 'M3 7l9-4 9 4v2H3zM5 9v8M10 9v8M14 9v8M19 9v8M3 20h18',

  // --- money shapes ---
  // A piggy bank: what ActivoBank calls a "mealheiro".
  vault: 'M4 12a6 5 0 016-5h3a6 5 0 015.8 4.4l1.7 1.1-1.7 1.1A6 5 0 0113 18h-1l-1 3H9l-.5-3.3A6 5 0 014 12zM8 6.5A2.5 2.5 0 0111 5M15.5 11h.01M4.5 15L3 16v-3z',
  cash: 'M2 6h20v12H2zM12 9a3 3 0 100 6 3 3 0 000-6zM5 9h.01M19 15h.01',

  // --- ui affordances ---
  bell: 'M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 01-3.4 0',
  menu: 'M3 6h18M3 12h18M3 18h18',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  check: 'M4 12l5 5L20 6',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 11a8 8 0 10-2.3 5.7M20 5v6h-6',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  // Row controls. These are the interface's own verbs — edit, delete, sort —
  // and they carry no meaning as a category, so they stay out of the picker.
  pencil: 'M4 20h4L19.5 8.5a2.8 2.8 0 00-4-4L4 16zM14.5 6l3.5 3.5',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
  arrowUp: 'M12 20V4M6 10l6-6 6 6',
  arrowDown: 'M12 4v16M6 14l6 6 6-6',
  // Chart shapes, for the toggle that lets a series be read as bars, as a line,
  // as a filled area or as a share of the whole.
  chartBar: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  chartLine: 'M3 20h18M4 16l5-6 4 3 6-8',
  chartArea: 'M3 20h18M4 17l5-6 4 3 6-8v11z',
  chartPie: 'M12 3a9 9 0 109 9h-9z',
  // The experimental shapes. Each one draws its own diagram rather than a
  // generic graph glyph, because the switch that turns it on is the only place
  // the reader sees the shape before deciding whether to try it.
  chartSankey: 'M3 5h3c4 0 4 6 8 6h7M3 12h3c4 0 4 7 8 7h7M3 19h3',
  chartTreemap: 'M3 4h18v16H3zM3 13h11M14 4v16M14 9h7M3 17h11',
  chartSunburst: 'M12 12a4 4 0 100-.01zM12 3a9 9 0 019 9M12 12V3M12 12h9M12 12l6 6M12 8a4 4 0 000 8',
  chartStream: 'M3 12c3-5 6 5 9 0s6-5 9 0M3 16c3-4 6 4 9 0s6-4 9 0M3 8c3-4 6 4 9 0s6-4 9 0',
  chartWaterfall: 'M3 6h4v5H3zM8 11h4v4H8zM13 15h4v3h-4zM18 9h3v9h-3M3 20h18',
  chartCalendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4M7 13h2v2H7zM11 13h2v2h-2zM15 13h2v2h-2zM7 17h2v2H7z',
  chartChord: 'M12 3a9 9 0 100 18 9 9 0 000-18zM6 7c5 3 7 8 12 10M6 17c5-3 7-8 12-10',
  // The other half of the chart/table switch: every chart can be read as rows.
  table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14',
  // The two Settings tabs added with the theme engine.
  palette: 'M12 3a9 9 0 000 18 2 2 0 001.6-3.2 2 2 0 011.6-3.2H18a3 3 0 003-3 9 9 0 00-9-8.6zM7.5 12.5h.01M9.5 8.5h.01M14 7.5h.01',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zM12 9a3 3 0 100 6 3 3 0 000-6z',
  link: 'M10 13a4 4 0 005.7 0l3-3a4 4 0 10-5.7-5.7L11.5 6M14 11a4 4 0 00-5.7 0l-3 3a4 4 0 105.7 5.7L12.5 18',
  brain: 'M9 4a3 3 0 00-3 3 3 3 0 00-2 5 3 3 0 002 5 3 3 0 003 3V4zM15 4a3 3 0 013 3 3 3 0 012 5 3 3 0 01-2 5 3 3 0 01-3 3V4z',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  tag: 'M3 12V4h8l9 9-8 8zM7.5 7.5h.01',
  lightbulb: 'M9 18h6M10 21h4M8 14a5 5 0 116 0c-.7.9-1 1.6-1 3H9c0-1.4-.3-2.1-1-3zM12 2v1.5M4 7l1.2.9M20 7l-1.2.9',
  play: 'M6 4l14 8-14 8z',
  hourglass: 'M6 3h12M6 21h12M7 3c0 5 4 6 5 9-1 3-5 4-5 9M17 3c0 5-4 6-5 9 1 3 5 4 5 9',
  sparkles: 'M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5zM19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8zM4 14l.6 1.7L6.5 16l-1.9.6L4 18.5l-.6-1.9L1.5 16l1.9-.3z',
  alert: 'M12 3l10 18H2zM12 9v5M12 17h.01',

  // --- categories ---
  food: 'M5 3v8a3 3 0 006 0V3M8 11v10M17 3c-1.5 2-2 4-2 6s.5 3 2 3 2-1 2-3-.5-4-2-6zM17 12v9',
  // A tram carriage in profile: rounded nose leading right, a band of windows,
  // wheels under the floor. It used to be drawn nose-on, which read as a blunt
  // box rather than as something that goes somewhere.
  transport: 'M2 7h13a6 6 0 016 6v3H2zM5 10.5h9M2 16h19M6.5 21a1.6 1.6 0 110-3.2 1.6 1.6 0 010 3.2M17.5 21a1.6 1.6 0 110-3.2 1.6 1.6 0 010 3.2',
  housing: 'M3 11l9-7 9 7M6 10v10h12V10',
  utilities: 'M13 2L5 14h6l-2 8 8-12h-6z',
  entertainment: 'M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M16 9h4M4 15h4M16 15h4',
  subscriptions: 'M4 6h16v12H4zM4 10h16M8 14h4',
  health: 'M12 21s-8-5-8-11a4.5 4.5 0 018-2.8A4.5 4.5 0 0120 10c0 6-8 11-8 11z',
  education: 'M2 8l10-4 10 4-10 4zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5',
  shopping: 'M6 7h12l-1 13H7zM9 7a3 3 0 016 0',
  income: 'M12 20V4M6 10l6-6 6 6',
  gaming: 'M7 8h10a5 5 0 010 10c-2 0-2.5-2-5-2s-3 2-5 2a5 5 0 010-10zM9 12H7M8 11v2M16 12h.01M14 13h.01',
  transfers: 'M4 8h14l-3-3M20 16H6l3 3',
  uncategorized: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9.5 9a2.5 2.5 0 015 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01',
  // The plane the navigation icon used to steal.
  plane: 'M2 16l20-7-6 12-3-4-4-1z',
  coffee: 'M4 8h13v6a4 4 0 01-4 4H8a4 4 0 01-4-4zM17 9h2a2.5 2.5 0 010 5h-2M6 2v3M10 2v3M14 2v3',
  fitness: 'M4 9v6M7 7v10M17 7v10M20 9v6M7 12h10',
  pets: 'M6 8a1.6 2 0 100 4 1.6 2 0 000-4zM18 8a1.6 2 0 100 4 1.6 2 0 000-4zM9.5 4a1.6 2 0 100 4 1.6 2 0 000-4zM14.5 4a1.6 2 0 100 4 1.6 2 0 000-4zM12 12c-2.5 0-4.5 2-4.5 4.5S9 21 12 21s4.5-2 4.5-4.5S14.5 12 12 12z',
  gift: 'M3 11h18v10H3zM3 7h18v4H3zM12 7v14M12 7S9.5 3 7.5 4.5 9 7 12 7zM12 7s2.5-4 4.5-2.5S15 7 12 7z',
  insurance: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  taxes: 'M6 3h12v18H6zM9 7h6M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h8',
  beauty: 'M12 3c-2 3-3 5-3 7a3 3 0 006 0c0-2-1-4-3-7zM8 15c1 1 2.5 1.5 4 1.5s3-.5 4-1.5M9 21h6',
  tools: 'M14 4a4 4 0 015.5 5.2L21 11l-2 2-1.8-1.5A4 4 0 0112 6.5V4zM10 10l-7 7 3 3 7-7',
  phone: 'M7 2h10v20H7zM11 18h2',
  streaming: 'M4 5h16v11H4zM8 20h8M10 9l4 2.5-4 2.5z',
  parking: 'M4 3h16v18H4zM10 17V8h3.5a2.75 2.75 0 010 5.5H10',
  fuel: 'M4 21V5a2 2 0 012-2h5a2 2 0 012 2v16M3 21h12M6 8h5M16 8l3 2v8a1.5 1.5 0 003 0v-7l-2-2',

  // --- more categories ---
  // Spending is not only groceries and rent, and a category the user cannot
  // find a glyph for ends up wearing the generic tag. These cover the hobbies,
  // services and one-off errands the original dozen had no answer for.

  // A posable figure — collectibles, toys, the shelf of action figures.
  actionFigure:
    'M12 2a2.2 2.2 0 110 4.4 2.2 2.2 0 010-4.4M12 6.6v7M12 8.6L7.2 11M12 8.6l4.8 2.4M7.2 11L5.5 14.5M16.8 11l1.7 3.5M12 13.6L9.2 17.2 8.2 22M12 13.6l2.8 3.6 1 4.8',
  book: 'M4 4h6.5a2 2 0 012 2v14a2 2 0 00-2-1.7H4zM20 4h-6.5a2 2 0 00-2 2v14a2 2 0 012-1.7H20z',
  music: 'M9 18V5l11-2v13M9 18a3 3 0 11-6 0 3 3 0 016 0M20 16a3 3 0 11-6 0 3 3 0 016 0M9 9l11-2',
  camera: 'M3 8h4l2-3h6l2 3h4v12H3zM12 10.5a3.5 3.5 0 110 7 3.5 3.5 0 010-7',
  bike: 'M5.5 18a3.5 3.5 0 110-7 3.5 3.5 0 010 7M18.5 18a3.5 3.5 0 110-7 3.5 3.5 0 010 7M5.5 14.5L10 8h4.5M10 8l4.5 6.5M14.5 8l4 6.5M13 5h3',
  boat: 'M3 17h18l-2.5 4h-13zM12 3v11M12 5.5l6.5 8.5H12M10.5 6.5L5 14h5.5',
  hotel: 'M3 21V4h18v17M7 8h.01M11 8h.01M15 8h.01M7 12h.01M11 12h.01M15 12h.01M10 21v-4.5h4V21',
  bar: 'M4 4h16l-8 8.5zM12 12.5V19M8.5 19h7M18.5 4l-2 4.5',
  pharmacy: 'M9.5 3h5v5.5H20v5h-5.5V19h-5v-5.5H4v-5h5.5z',
  baby: 'M12 3a8.5 8.5 0 018.5 8.5H3.5A8.5 8.5 0 0112 3M2.5 11.5h19M8.5 11.5L6 17.5M15.5 11.5l2.5 6M6.5 21a1.6 1.6 0 110-3.2 1.6 1.6 0 010 3.2M17.5 21a1.6 1.6 0 110-3.2 1.6 1.6 0 010 3.2',
  plant: 'M12 21v-8.5M12 12.5c0-3.3 2.2-5.5 5.5-5.5 0 3.3-2.2 5.5-5.5 5.5M12 12.5C12 9.2 9.8 7 6.5 7c0 3.3 2.2 5.5 5.5 5.5M8 21h8',
  laundry: 'M4 3h16v18H4zM4 8h16M7 5.5h.01M10.5 5.5h.01M12 10a4.5 4.5 0 110 9 4.5 4.5 0 010-9',
  paint: 'M3 4h12v5H3zM15 6.5h4v4.5h-7V15M10 15h4v6h-4z',
  // An open hand — giving, donations, anything that is money handed over.
  hand: 'M7 11.5V4.5a1.5 1.5 0 013 0v5.5M10 10V3.5a1.5 1.5 0 013 0V10M13 10.5V5.5a1.5 1.5 0 013 0V12M16 12.5v-2a1.5 1.5 0 013 0V16a5.5 5.5 0 01-5.5 5.5h-2A5.5 5.5 0 016 16v-4a1.5 1.5 0 013 0',
  church: 'M12 2v5.5M9.5 4.5h5M6 22V9.5l6-4 6 4V22M10 22v-5.5h4V22',
  sports: 'M12 3a9 9 0 110 18 9 9 0 010-18M12 7l4.2 3.1-1.6 5H9.4l-1.6-5zM12 3v4M16.2 10.1L20.5 8.7M14.6 15.1l2.7 3.6M9.4 15.1l-2.7 3.6M7.8 10.1L3.5 8.7',
  cinema: 'M3 8.5h18V21H3zM3 8.5l3-5.5h3.2l-3 5.5M9.2 8.5l3-5.5h3.2l-3 5.5M15.4 8.5l3-5.5h3.2l-3 5.5',
  tv: 'M2 5h20v12H2zM8 21h8M12 17v4',
  computer: 'M3 4h18v12H3zM8 20h8M10.2 16L9.5 20M13.8 16l.7 4',
  sofa: 'M3 11.5V8.5a2 2 0 014 0v3M17 11.5v-3a2 2 0 014 0v3M3 11.5h18V18H3zM5.5 18v2.5M18.5 18v2.5',
  clothes: 'M8.5 3L4 5.8 6 10.2l2.2-1.1V21h7.6V9.1l2.2 1.1 2-4.4L15.5 3a3.6 3.6 0 01-7 0z',
  shoes: 'M2.5 17v-6.5h4.2l3 2h6.3a5.5 5.5 0 015.5 5.5V19h-19zM2.5 17h19',
  jewelry: 'M6.5 3h11l3.5 5.5-9 12.5-9-12.5zM2 8.5h20M9 3L6.5 8.5 12 21M15 3l2.5 5.5L12 21',
  scissors: 'M8.5 3.5a2.6 2.6 0 110 5.2 2.6 2.6 0 010-5.2M8.5 15.3a2.6 2.6 0 110 5.2 2.6 2.6 0 010-5.2M10.8 7.5L20 19.5M10.8 16.5L20 4.5',
  tooth: 'M7 3c-2.2 0-3.6 1.6-3.6 4 0 3 1 4.2 1.6 7.2S6 21 8 21s2-2 2-4.2.9-3 2-3 2 .8 2 3S14 21 16 21s2.4-3.8 3-6.8 1.6-4.2 1.6-7.2c0-2.4-1.4-4-3.6-4-1.6 0-2.6 1-5 1s-3.4-1-5-1z',
  stethoscope: 'M6 3v5.5a4 4 0 008 0V3M4 3h3M13 3h3M10 12.5V15a5 5 0 0010 0v-.8M20 10.6a1.9 1.9 0 110 3.8 1.9 1.9 0 010-3.8',
  wallet: 'M3 7a2 2 0 012-2h12v3M3 7v11a2 2 0 002 2h14a2 2 0 002-2v-3M21 10h-4.5a2.5 2.5 0 000 5H21zM17 12.5h.01',
  crypto: 'M12 3a9 9 0 110 18 9 9 0 010-18M9.5 8h4.2a2.2 2.2 0 010 4.4H9.5h4.7a2.2 2.2 0 010 4.6H9.5zM9.5 8v9M11.2 6v2M13.4 6v2M11.2 17v2M13.4 17v2',
  ticket: 'M3 8a2 2 0 012-2h14a2 2 0 012 2 2 2 0 000 4 2 2 0 000 4 2 2 0 01-2 2H5a2 2 0 01-2-2 2 2 0 000-4 2 2 0 000-4M10 6.5v2M10 11v2M10 15.5v2',
  taxi: 'M3 15v-3l2-4h10l3 4h3v3zM2 15h20M7 18.5a1.8 1.8 0 110-3.6 1.8 1.8 0 010 3.6M17 18.5a1.8 1.8 0 110-3.6 1.8 1.8 0 010 3.6M9 8V5h6v3',
  delivery: 'M2 6h11v9H2zM13 9h4l3 3v3h-7zM2 15h18M6.5 18.5a1.8 1.8 0 110-3.6 1.8 1.8 0 010 3.6M16.5 18.5a1.8 1.8 0 110-3.6 1.8 1.8 0 010 3.6',
  art: 'M12 3a9 9 0 000 18c1.4 0 2-.9 2-1.9s-.5-1.4-.5-2.4.8-1.4 1.9-1.4H18a3 3 0 003-3c0-5-4-9.3-9-9.3M7.5 10h.01M10 6.5h.01M14.5 6.5h.01M17 10h.01',
};

export const ICON_NAMES = Object.keys(PATHS);

// Category icons the picker offers, grouped by theme so the grid reads as
// sections rather than as one undifferentiated wall of glyphs.
export const CATEGORY_ICON_NAMES = [
  // eating and drinking
  'food', 'coffee', 'bar',
  // getting around
  'transport', 'taxi', 'bike', 'fuel', 'parking', 'plane', 'boat', 'hotel', 'delivery',
  // home and bills
  'housing', 'utilities', 'phone', 'sofa', 'laundry', 'paint', 'tools', 'plant',
  // leisure
  'entertainment', 'streaming', 'tv', 'cinema', 'music', 'gaming', 'sports', 'art',
  'book', 'camera', 'ticket', 'actionFigure',
  // looking after yourself
  'health', 'pharmacy', 'stethoscope', 'tooth', 'fitness', 'beauty', 'scissors',
  // people and pets
  'education', 'baby', 'pets', 'gift', 'hand', 'church',
  // buying things
  'shopping', 'clothes', 'shoes', 'jewelry', 'computer',
  // money
  'income', 'investments', 'crypto', 'transfers', 'cash', 'wallet', 'vault',
  'insurance', 'taxes',
  // fallbacks
  'tag', 'uncategorized',
];

export default function Icon({ name, size = 18, strokeWidth = 1.75, style, className, title }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      style={{ flexShrink: 0, display: 'block', ...style }}
    >
      {title && <title>{title}</title>}
      <path d={d} />
    </svg>
  );
}
