/**
 * Position-aware text extraction for ActivoBank PDFs.
 *
 * pdf-parse's default renderer concatenates text items in document order, which
 * for these statements interleaves the rotated legal boilerplate printed in the
 * margin with the transaction table and loses the column layout entirely. Since
 * ActivoBank encodes debit-vs-credit purely by which column an amount sits in,
 * the x coordinate is data, not presentation — so we rebuild rows ourselves.
 *
 * Each row keeps a character-index → x-coordinate map, because the text a row
 * reads as and the geometry it sits at are both needed: pre-2022 statements
 * split words into 2-4 character runs ("EXT RATO COMB INAD O"), so no single
 * item can be matched against a column header or an amount on its own.
 */
// Deep import dodges pdf-parse's index.js debug block, which runs test code
// when the package is loaded from ESM.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

// Rows are bucketed by y. ActivoBank statement leading is ~8pt, so 2pt buckets
// keep separate rows apart while tolerating sub-pixel baseline drift.
const Y_BUCKET = 2;

function buildRow(items) {
  items.sort((a, b) => a.x - b.x);

  let text = '';
  const spans = [];
  let prev = null;

  for (const item of items) {
    if (prev) {
      const gap = item.x - (prev.x + prev.width);
      // A gap wider than a third of the font size is a real space; anything
      // tighter is one word split across text runs.
      const spaceWidth = Math.max(prev.height, item.height) * 0.33;
      if (gap > spaceWidth) text += ' ';
    }
    const start = text.length;
    text += item.str;
    spans.push({ start, end: text.length, item });
    prev = item;
  }

  return { text, spans, items };
}

/**
 * Right-hand x coordinate of the character range [start, end) of a row's text.
 * Amounts and column headers are right-aligned, so this is what identifies a
 * statement column.
 */
export function rightEdgeOf(row, start, end) {
  let edge = null;
  for (const span of row.spans) {
    if (span.start >= end || span.end <= start) continue;
    const { item } = span;
    const perChar = item.width / Math.max(span.end - span.start, 1);
    // Clip the item to the requested range so partially covered runs still
    // report the correct edge.
    const covered = Math.min(span.end, end) - span.start;
    const itemEdge = item.x + perChar * covered;
    if (edge == null || itemEdge > edge) edge = itemEdge;
  }
  return edge;
}

/** Left-hand x coordinate of the character range [start, end) of a row's text. */
export function leftEdgeOf(row, start, end) {
  let edge = null;
  for (const span of row.spans) {
    if (span.start >= end || span.end <= start) continue;
    const { item } = span;
    const perChar = item.width / Math.max(span.end - span.start, 1);
    const offset = Math.max(start - span.start, 0);
    const itemEdge = item.x + perChar * offset;
    if (edge == null || itemEdge < edge) edge = itemEdge;
  }
  return edge;
}

function pageRenderer(pagesOut) {
  return async function render(pageData) {
    const content = await pageData.getTextContent({
      normalizeWhitespace: false,
      disableCombineTextItems: false,
    });

    const buckets = new Map();
    for (const item of content.items) {
      if (!item.str || !item.str.trim()) continue;
      const [, skewB, skewC, , x, y] = item.transform;
      // Rotated text is the vertical legal notice down the page margin.
      if (Math.abs(skewB) > 0.01 || Math.abs(skewC) > 0.01) continue;
      const key = Math.round(y / Y_BUCKET);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({
        x,
        y,
        str: item.str,
        width: item.width || 0,
        height: item.height || 8,
      });
    }

    const rows = [...buckets.entries()]
      .sort((a, b) => b[0] - a[0]) // PDF y grows upwards; top of page first
      .map(([, items]) => buildRow(items))
      .filter((r) => r.text.trim());

    pagesOut.push(rows);
    return '\n' + rows.map((r) => r.text).join('\n');
  };
}

/**
 * Extracts a PDF as pages of positioned rows.
 * Returns { pages, text } where each row is { text, spans, items }.
 */
export async function extractRows(buffer) {
  const pages = [];
  const { text } = await pdfParse(buffer, { pagerender: pageRenderer(pages) });
  return { pages, text };
}
