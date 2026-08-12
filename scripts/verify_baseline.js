#!/usr/bin/env node
/**
 * Re-runs the capture and compares it against a recorded baseline.
 *
 *   node scripts/verify_baseline.js                 → against snapshots/baseline
 *   node scripts/verify_baseline.js --name after
 *
 * Reports the first differing JSON path per file rather than a whole diff: on a
 * 2900-movement projection every later difference is a consequence of the first,
 * and a wall of output is how a real regression gets scrolled past.
 *
 * Exits non-zero on any difference, so it can gate a commit.
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { captureAll } from './lib/capture.js';
import { firstDifference } from './lib/canonical.js';
import { snapshotsPath } from '../server/lib/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Differences someone decided were correct, with the reason next to each.
 *
 * Without this the only way to keep a long refactor verifiable would be to
 * re-take the baseline after every intended change, which resets the comparison
 * and hides whatever drifted since. Accepting a specific path instead keeps the
 * baseline anchored to the state before any of it started.
 */
const ACCEPTED = JSON.parse(readFileSync(join(__dirname, 'accepted-diffs.json'), 'utf-8')).accepted;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const name = arg('name', 'baseline');
const root = snapshotsPath(name);

if (!existsSync(join(root, 'manifest.json'))) {
  console.error(`\n  No baseline at ${root}`);
  console.error(`  Take one first: npm run snapshot:baseline\n`);
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf-8'));
console.log(`\n  Baseline ${manifest.revision ?? '(unknown revision)'} of ${manifest.capturedAt}`);
console.log(`  Recapturing…\n`);

const captured = await captureAll();
const expectedFiles = new Set(manifest.files);
const actualFiles = new Set(Object.keys(captured));

const problems = [];

/**
 * An accepted entry with no `path` accepts the file appearing or disappearing.
 * A trailing `*` on the filename accepts a whole group of them — a new endpoint
 * is captured once per instance, and listing each is noise around the reason.
 */
const wholeFileAccepted = (file) =>
  ACCEPTED.some(
    (a) => !a.path && (a.file.endsWith('*') ? file.startsWith(a.file.slice(0, -1)) : a.file === file)
  );

for (const file of expectedFiles) {
  if (!actualFiles.has(file) && !wholeFileAccepted(file)) {
    problems.push({ file, note: 'gone — the route or capture no longer exists' });
  }
}
for (const file of actualFiles) {
  if (!expectedFiles.has(file) && !wholeFileAccepted(file)) {
    problems.push({ file, note: 'new — not present in the baseline' });
  }
}

/**
 * Splits `$.body.modules` and `$['a.file.csv'].rows` into their steps.
 *
 * Bracket notation is not decoration: plenty of the captured keys are filenames,
 * and a dotted split alone turns `report.csv` into two steps and silently
 * matches nothing.
 */
function steps(path) {
  const out = [];
  const pattern = /\['([^']+)'\]|\.?([^.[\]]+)/g;
  for (const match of path.replace(/^\$/, '').matchAll(pattern)) {
    out.push(match[1] ?? match[2]);
  }
  return out;
}

/**
 * Removes an accepted path from a capture so the rest can still be compared.
 *
 * The last step may end in `*`, which accepts every key beginning with what
 * comes before it. One capture holds a key per stored document, and listing a
 * hundred filenames one at a time would bury the reason they are accepted.
 */
function prune(value, path) {
  const parts = steps(path);
  let node = value;
  for (const step of parts.slice(0, -1)) {
    if (node == null || typeof node !== 'object') return;
    node = node[step];
  }
  if (!node || typeof node !== 'object') return;

  const last = parts[parts.length - 1];
  if (last.endsWith('*')) {
    const prefix = last.slice(0, -1);
    for (const key of Object.keys(node)) if (key.startsWith(prefix)) delete node[key];
    return;
  }
  delete node[last];
}

let compared = 0;
const accepted = [];
for (const file of [...expectedFiles].filter((f) => actualFiles.has(f)).sort()) {
  const expected = JSON.parse(readFileSync(join(root, file), 'utf-8'));
  const actual = JSON.parse(JSON.stringify(captured[file]));

  for (const entry of ACCEPTED.filter((a) => a.file === file)) {
    prune(expected, entry.path);
    prune(actual, entry.path);
    accepted.push(`${file} ${entry.path} — ${entry.why}`);
  }

  const diff = firstDifference(expected, actual);
  compared++;
  if (diff) {
    problems.push({
      file,
      note: `${diff.path}\n      baseline: ${diff.expected}\n      now:      ${diff.actual}`,
    });
  }
}

if (accepted.length > 0) {
  console.log(`  ${accepted.length} accepted difference(s), from scripts/accepted-diffs.json:`);
  for (const note of accepted) console.log(`    · ${note.split(' — ')[0]}`);
  console.log('');
}

if (problems.length === 0) {
  console.log(`  ✓ ${compared} files identical to the baseline\n`);
  process.exit(0);
}

console.error(`  ✗ ${problems.length} of ${compared} files differ\n`);
for (const { file, note } of problems) {
  console.error(`    ${file}`);
  console.error(`      ${note}\n`);
}
process.exit(1);
