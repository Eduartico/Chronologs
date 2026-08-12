#!/usr/bin/env node
/**
 * Copies the template module under a new name.
 *
 *   npm run new:module my-bank
 *
 * A scaffolder rather than a generator: it copies `modules/example-bank/`, which
 * is a module that actually works and has its own passing tests, and renames the
 * handful of identifiers that have to change. What comes out is not a stub — it
 * parses statements, dedupes them and lands them in the ledger from the first
 * minute — so the first thing you do is replace a parser that works with one
 * that reads your bank, rather than assembling a module from an empty file.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODULES = join(__dirname, '..', 'modules');
const TEMPLATE = join(MODULES, 'example-bank');

const id = process.argv[2];

if (!id) {
  console.error('\n  Usage: npm run new:module <id>\n');
  console.error('  The id is permanent-ish: it names the folder and the module,');
  console.error('  and an instance of it writes its own id onto every event.\n');
  process.exit(2);
}

if (!/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error(`\n  "${id}" is not a valid id — lowercase letters, digits and hyphens, starting with a letter.\n`);
  process.exit(2);
}

const target = join(MODULES, id);
if (existsSync(target)) {
  console.error(`\n  modules/${id} already exists. Pick another id or delete it first.\n`);
  process.exit(2);
}

/** `my-bank` → `myBank`, for translation keys. */
const camel = id.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

function rename(text) {
  const renamed = text.replaceAll('example-bank', id).replaceAll('exampleBank', camel);

  // `enabledByDefault: false` is what keeps the *template* out of your
  // connections screen. A real module wants an instance, so the line and the
  // comment above it are dropped. Line-based rather than a regex over the whole
  // file: a pattern that silently stops matching would leave every scaffolded
  // module invisible, with nothing to indicate why.
  const lines = renamed.split('\n');
  const kept = [];
  for (const line of lines) {
    if (line.includes('enabledByDefault: false')) {
      if (kept[kept.length - 1]?.includes('Delete this line in a real module')) kept.pop();
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

function copy(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from)) {
    const source = join(from, entry);
    const destination = join(to, rename(entry));
    if (statSync(source).isDirectory()) copy(source, destination);
    else writeFileSync(destination, rename(readFileSync(source, 'utf-8')), 'utf-8');
  }
}

copy(TEMPLATE, target);

console.log(`\n  Created modules/${id}/\n`);
console.log('  Next:');
console.log(`    1. Replace parseStatement() in modules/${id}/ingest.js with a reader for your bank.`);
console.log(`    2. Say what it is called in modules/${id}/i18n/en.js and pt.js.`);
console.log(`    3. Set the institution profile — see "The institution profile" in docs/modules.md.`);
console.log(`       Getting this wrong counts every transfer between your own accounts as spending.`);
console.log(`    4. npm test\n`);
console.log('  Then create an instance of it:');
console.log(`    PUT /api/modules/<account-id>/config  { "module": "${id}" }\n`);
