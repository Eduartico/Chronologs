/**
 * The colours a category or tag can be given.
 *
 * A free `<input type="color">` opens the operating system's picker, which is a
 * different dialog on every machine and quite happy to hand back something
 * unreadable. These are one family, picked to sit on the app's surfaces.
 *
 * They live in a plain module rather than next to the picker component because
 * they are *data*: they are persisted in the ledger, they are checked by
 * `web/src/lib/contrastInk.test.js` for having a readable ink, and
 * `scripts/validate_palette.js` reads them from Node, where JSX will not load.
 *
 * Changing a value here does not change already-saved categories — those store the
 * literal string. Removing one leaves existing rows pointing at a colour the picker
 * no longer offers, which renders fine but cannot be re-selected.
 */
export const PALETTE = [
  'hsl(25, 70%, 55%)', 'hsl(205, 65%, 55%)', 'hsl(30, 45%, 50%)', 'hsl(50, 65%, 50%)',
  'hsl(280, 55%, 60%)', 'hsl(330, 60%, 58%)', 'hsl(0, 60%, 58%)', 'hsl(230, 55%, 60%)',
  'hsl(180, 45%, 45%)', 'hsl(140, 55%, 45%)', 'hsl(160, 50%, 40%)', 'hsl(210, 15%, 55%)',
  'hsl(260, 60%, 62%)', 'hsl(190, 65%, 50%)', 'hsl(80, 50%, 60%)', 'hsl(15, 65%, 55%)',
  'hsl(45, 60%, 48%)', 'hsl(215, 50%, 45%)', 'hsl(350, 55%, 52%)', 'hsl(100, 40%, 45%)',
  'hsl(300, 45%, 55%)', 'hsl(10, 70%, 62%)', 'hsl(170, 55%, 40%)', 'hsl(245, 50%, 58%)',
  'hsl(60, 55%, 45%)', 'hsl(320, 50%, 60%)', 'hsl(200, 40%, 40%)', 'hsl(120, 45%, 50%)',
  'hsl(270, 40%, 50%)', 'hsl(35, 65%, 60%)', 'hsl(150, 45%, 55%)', 'hsl(0, 0%, 45%)',
];
