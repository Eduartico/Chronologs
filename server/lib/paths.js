import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

// All user data (ledger, secrets, documents, browser sessions) lives under this
// root, which is gitignored. Override with CHRONOLOGS_DATA_DIR to relocate it.
export const USER_DATA_DIR = process.env.CHRONOLOGS_DATA_DIR || join(REPO_ROOT, 'user-data');

export function ledgerPath() {
  return join(USER_DATA_DIR, 'ledger', 'events.ndjson');
}

export function statePath(name) {
  return join(USER_DATA_DIR, 'state', name);
}

export function secretsPath(...parts) {
  return join(USER_DATA_DIR, 'secrets', ...parts);
}

export function documentsPath(...parts) {
  return join(USER_DATA_DIR, 'documents', ...parts);
}

export function browserPath(...parts) {
  return join(USER_DATA_DIR, 'browser', ...parts);
}

export function snapshotsPath(...parts) {
  return join(USER_DATA_DIR, 'snapshots', ...parts);
}

const TREE = [
  'ledger',
  'state',
  join('secrets', 'google'),
  join('documents', 'activobank', 'inbox'),
  join('documents', 'activobank', 'processed'),
  join('browser', 'pricempire'),
  'snapshots',
];

export function bootstrapUserData() {
  for (const dir of TREE) {
    const p = join(USER_DATA_DIR, dir);
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  }
  migrateLegacyData();
}

// One-time migration from the pre-user-data layout (repo-root data/ folder).
function migrateLegacyData() {
  const legacyDir = join(REPO_ROOT, 'data');
  const legacyLedger = join(legacyDir, 'events.ndjson');
  if (!existsSync(legacyLedger) || existsSync(ledgerPath())) return;

  copyFileSync(legacyLedger, ledgerPath());
  for (const name of ['assets.json', 'categories.json', 'rules.json']) {
    const src = join(legacyDir, name);
    if (existsSync(src)) copyFileSync(src, statePath(name));
  }
  const legacySnapshots = join(legacyDir, 'snapshots');
  if (existsSync(legacySnapshots)) {
    for (const f of readdirSync(legacySnapshots)) {
      copyFileSync(join(legacySnapshots, f), snapshotsPath(f));
    }
  }
  console.log(`  Migrated legacy data/ into ${USER_DATA_DIR}`);
}
