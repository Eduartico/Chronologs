import { Fragment } from 'react';

/**
 * A small Markdown renderer for the assistant's answers.
 *
 * The model is asked for short paragraphs, lists and the occasional small
 * table, and that is the whole of what this reads: headings, paragraphs,
 * bullet and numbered lists, pipe tables, fenced code, blockquotes, and inline
 * bold / italic / code. No HTML passthrough, no links to the outside, no
 * `dangerouslySetInnerHTML` — everything is built as elements, so a model that
 * writes `<script>` gets its angle brackets printed back at it.
 *
 * Deliberately not a library: markdown-it is 80 kB for a feature whose input
 * is produced by a prompt this app controls.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*|_[^_\n]+_)/g;

function inline(text, keyBase = 'i') {
  const parts = String(text).split(INLINE);
  return parts.map((part, i) => {
    const key = `${keyBase}${i}`;
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={key}>{part.slice(1, -1)}</code>;
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

const isTableRow = (line) => /^\s*\|.*\|\s*$/.test(line);
const isDivider = (line) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const cells = (line) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

export function parseBlocks(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const code = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const header = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      blocks.push({ type: 'table', header, rows });
      continue;
    }
    if (/^\s*[-*•]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•]\s+/, ''));
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''));
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      blocks.push({ type: 'quote', text: quote.join(' ') });
      continue;
    }
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith('```') &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*[-*•]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !(isTableRow(lines[i]) && isDivider(lines[i + 1] || ''))
    ) {
      para.push(lines[i++]);
    }
    blocks.push({ type: 'paragraph', text: para.join(' ') });
  }
  return blocks;
}

export default function Markdown({ text }) {
  const blocks = parseBlocks(text);
  return (
    <div className="md">
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'heading': {
            const Tag = `h${Math.min(b.level + 2, 6)}`;
            return <Tag key={i}>{inline(b.text, `h${i}`)}</Tag>;
          }
          case 'code':
            return (
              <pre key={i}>
                <code>{b.text}</code>
              </pre>
            );
          case 'list': {
            const Tag = b.ordered ? 'ol' : 'ul';
            return (
              <Tag key={i}>
                {b.items.map((item, j) => (
                  <li key={j}>{inline(item, `l${i}-${j}`)}</li>
                ))}
              </Tag>
            );
          }
          case 'table':
            return (
              <div key={i} className="md-table-wrap">
                <table>
                  <thead>
                    <tr>
                      {b.header.map((h, j) => (
                        <th key={j}>{inline(h, `th${i}-${j}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((c, j) => (
                          <td key={j} className={/^[-+−]?[\d.,\s]+(€|%|[A-Z]{3})?$/.test(c) ? 'num' : undefined}>
                            {inline(c, `td${i}-${r}-${j}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'quote':
            return <blockquote key={i}>{inline(b.text, `q${i}`)}</blockquote>;
          default:
            return <p key={i}>{inline(b.text, `p${i}`)}</p>;
        }
      })}
    </div>
  );
}
