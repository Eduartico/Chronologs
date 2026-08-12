#!/usr/bin/env node
/**
 * Records what the system produces right now, so a later run can be proved
 * identical. Writes under user-data/snapshots/ — which is gitignored, because
 * this is a capture of real money.
 *
 *   node scripts/snapshot_baseline.js               → snapshots/baseline
 *   node scripts/snapshot_baseline.js --name after  → snapshots/after
 *
 * Take the baseline on an untouched tree, before the first line of a refactor
 * is written; run scripts/verify_baseline.js after every step of it.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { execFileSync } from 'child_process';
import { captureAll } from './lib/capture.js';
import { snapshotsPath } from '../server/lib/paths.js';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function gitRevision() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

const name = arg('name', 'baseline');
const root = snapshotsPath(name);

console.log(`\n  Capturing → ${root}\n`);
const started = Date.now();
const files = await captureAll();

if (existsSync(root)) rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

for (const [relative, value] of Object.entries(files)) {
  const target = join(root, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(value, null, 2), 'utf-8');
}

writeFileSync(
  join(root, 'manifest.json'),
  JSON.stringify(
    {
      capturedAt: new Date().toISOString(),
      revision: gitRevision(),
      files: Object.keys(files).sort(),
    },
    null,
    2
  ),
  'utf-8'
);

const apiCount = Object.keys(files).filter((f) => f.startsWith('api/')).length;
console.log(`  ${Object.keys(files).length} files (${apiCount} API responses) in ${Date.now() - started}ms`);
console.log(`  Verify later with: npm run snapshot:verify\n`);
process.exit(0);
