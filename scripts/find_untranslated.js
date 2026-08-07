/**
 * Find user-visible strings that never became translation keys.
 *
 * There was no codemod for the extraction: the app's copy was roughly half
 * Portuguese and half English, per page, and *both* halves had to become both
 * languages. That is a judgement call per string, so it was done by hand — which
 * means the interesting question is not "did the codemod work" but "what did I
 * miss". This answers that.
 *
 *     node scripts/find_untranslated.js          all findings
 *     node scripts/find_untranslated.js Rules    one file
 *
 * It rewrites nothing. Heuristics, so expect some noise: a `title="EUR"` is not
 * copy, and neither is a CSS class that happens to contain a space.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../web/src', import.meta.url));
const filter = process.argv[2];

/** Attributes whose value is read by a person. */
const ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'alt', 'label', 'emptyMessage', 'confirmLabel'];

const PATTERNS = [
  // >Some words< between JSX tags
  { what: 'text', re: />\s*([A-Za-zÀ-ÿ][^<>{}\n]{2,80}?)\s*</g },
  // attr="Some words"
  { what: 'attribute', re: new RegExp(`(?:${ATTRIBUTES.join('|')})=["']([^"']{2,80})["']`, 'g') },
  // toast('Some words')
  { what: 'toast', re: /(?:toast|setToast|alert|confirm)\(\s*[`'"]([^`'"]{3,90})[`'"]/g },
];

/** Things that look like copy but are not. */
const IGNORE = [
  /^[\s\d.,:;/€$%+\-–—×·|()[\]]+$/, // punctuation and numbers
  /^[a-z][a-zA-Z]*$/, // a bare identifier: className, iconName
  /^[A-Z]{2,5}$/, // EUR, USD, CSV, PDF
  /^\w+([-.]\w+)+$/, // dotted or dashed identifiers
  /^(px|rem|em|auto|none|flex|grid|true|false|null)$/i,
];

const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.jsx?$/.test(entry) && !/\.test\.jsx?$/.test(entry)) files.push(full);
  }
})(ROOT);

let total = 0;
const perFile = [];

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  if (rel.startsWith('i18n/')) continue;
  if (filter && !rel.toLowerCase().includes(filter.toLowerCase())) continue;

  const source = readFileSync(file, 'utf8');
  const lines = source.split('\n');
  const hits = [];

  for (const { what, re } of PATTERNS) {
    for (const match of source.matchAll(re)) {
      const text = match[1].trim();
      if (!text || IGNORE.some((r) => r.test(text))) continue;
      if (!/[A-Za-zÀ-ÿ]{3}/.test(text)) continue;
      const line = source.slice(0, match.index).split('\n').length;
      hits.push({ what, text, line });
    }
  }

  if (hits.length) {
    perFile.push({ rel, hits });
    total += hits.length;
  }
}

perFile.sort((a, b) => b.hits.length - a.hits.length);

for (const { rel, hits } of perFile) {
  console.log(`\n${rel}  (${hits.length})`);
  for (const h of hits.slice(0, 40)) console.log(`  ${String(h.line).padStart(4)}  ${h.what.padEnd(9)} ${JSON.stringify(h.text)}`);
  if (hits.length > 40) console.log(`  … ${hits.length - 40} more`);
}

console.log(`\n${total} candidate string(s) across ${perFile.length} file(s).`);
console.log('A checklist, not a test — some of these are identifiers rather than copy.');
