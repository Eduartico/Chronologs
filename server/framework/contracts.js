/**
 * What a module is allowed to be.
 *
 * This file is the contract, and it is deliberately the only place that knows
 * it: the registry validates against these functions, `contract.test.js` runs
 * them over every discovered module, and `docs/modules.md` documents them. A
 * module that satisfies `validateManifest` works; one that does not is rejected
 * at startup with a sentence saying which rule it broke, rather than failing
 * three screens later as an undefined property.
 *
 * Two kinds of module:
 *
 *   source — brings facts into the ledger. A bank, a broker, a crypto wallet, a
 *            marketplace. Declares capabilities; each one it declares is a thing
 *            the interface will offer to do.
 *   engine — reads what is already there. A scheduled job, an extra rule
 *            condition, a pass over the finished projection. Declares hooks.
 *
 * A source module may be configured more than once ("instances"): the same code
 * pointed at two different accounts. The instance id is what lands in every
 * event's `source` field, which is why it must never change once data exists
 * under it — see the note on renaming in docs/modules.md.
 */

/**
 * Event types the ledger knows how to project.
 *
 * A module emitting anything else is not wrong so much as invisible: the event
 * lands in the ledger and no projection ever reads it. Declaring `emits` lets
 * that be caught when the module is written rather than when its data is missed.
 */
export const KNOWN_EVENT_TYPES = new Set([
  'transaction',
  'transaction_void',
  'transaction_unvoid',
  'transaction_enrichment',
  'transaction_link',
  'category_assignment',
  'manual_override',
  'tag_assignment',
  'tag_removal',
  'investment_transaction',
  'security_order',
  'asset_snapshot',
  'price_update',
  'document_ingested',
]);

/** Capabilities a source module may declare. Declaring one means offering it. */
export const SOURCE_CAPABILITIES = {
  /** Pull whatever is new. What the scheduler runs, and the "sync now" button. */
  sync: 'async (ctx) => result',
  /** Take files handed over by the user. */
  upload: 'async (ctx, files) => result',
  /** Re-read documents already stored, through the current parsers. */
  reprocess: 'async (ctx) => result',
  /** Establish or refresh authentication. */
  connect: 'async (ctx, input) => result',
  /** What the connection card shows: connected, last sync, anything else. */
  status: 'async (ctx) => object',
  /**
   * Parse one stored document. Used by the duplicate checker and the account
   * backfill to re-read a document without knowing which institution wrote it.
   */
  parseDocument: 'async (ctx, { filename, buffer, date }) => { transactions, orders, kind, unparsedLines }',
};

/** Hooks an engine module may declare. */
export const ENGINE_HOOKS = {
  /** A job the scheduler can run on a cron, and the user can run by hand. */
  scheduledJob: 'async () => result',
  /** Runs after any source finishes ingesting, with that source's result. */
  afterIngest: 'async (ctx, result) => void',
  /** Runs over the finished projection, before any route sees it. */
  afterProjection: '(projections) => void',
  /** Extra fields the rules engine can match on. */
  ruleConditions: '[{ field, label, test(tx, value) }]',
  /** Extra things a rule can do when it matches. */
  ruleActions: '[{ action, label, apply(tx, value) }]',
};

const ID = /^[a-z][a-z0-9-]*$/;

function problem(id, message) {
  return `module "${id}": ${message}`;
}

/**
 * Every rule a manifest breaks, as sentences. Returns [] when the module is
 * fine.
 *
 * Collecting all the problems rather than throwing on the first one matters
 * when someone is writing their first module: being told about one missing
 * field per restart is how a ten-minute task becomes an afternoon.
 */
export function validateManifest(manifest, { folder = null } = {}) {
  const problems = [];
  if (!manifest || typeof manifest !== 'object') return ['module: manifest is not an object'];

  const id = manifest.id ?? '(no id)';

  if (!manifest.id) problems.push(problem(id, 'has no id'));
  else if (!ID.test(manifest.id)) {
    problems.push(problem(id, 'id must be lowercase letters, digits and hyphens, starting with a letter'));
  } else if (folder && folder !== manifest.id) {
    // The folder name is what the user sees and what the docs tell them to
    // copy; a manifest disagreeing with it makes every error message point at
    // the wrong directory.
    problems.push(problem(id, `id does not match its folder "${folder}"`));
  }

  if (manifest.kind !== 'source' && manifest.kind !== 'engine') {
    problems.push(problem(id, `kind must be "source" or "engine", not ${JSON.stringify(manifest.kind)}`));
  }

  // Labels are translation keys, never sentences: a module's name shows up in
  // the sidebar, the schedules table and the connection card, all of which
  // repaint when the language changes.
  if (!manifest.label) problems.push(problem(id, 'has no label (an i18n key, not a sentence)'));
  else if (/\s/.test(manifest.label)) {
    problems.push(problem(id, `label "${manifest.label}" looks like a sentence; it must be an i18n key`));
  }

  if (manifest.kind === 'source') problems.push(...validateSource(manifest, id));
  if (manifest.kind === 'engine') problems.push(...validateEngine(manifest, id));

  for (const type of manifest.emits ?? []) {
    if (!KNOWN_EVENT_TYPES.has(type)) {
      problems.push(problem(id, `emits "${type}", which no projection reads`));
    }
  }

  if (manifest.schedule) {
    if (typeof manifest.schedule.cron !== 'string') {
      problems.push(problem(id, 'schedule needs a cron string'));
    }
  }

  return problems;
}

function validateSource(manifest, id) {
  const problems = [];
  const caps = manifest.capabilities;

  if (!caps || typeof caps !== 'object') {
    problems.push(problem(id, 'a source module needs a capabilities object'));
    return problems;
  }

  const declared = Object.keys(caps).filter((k) => k !== 'actions');
  if (declared.length === 0) {
    problems.push(problem(id, 'declares no capabilities, so nothing can ever be done with it'));
  }

  for (const name of declared) {
    if (!(name in SOURCE_CAPABILITIES)) {
      problems.push(
        problem(id, `capability "${name}" is not one of: ${Object.keys(SOURCE_CAPABILITIES).join(', ')}`)
      );
    } else if (typeof caps[name] !== 'function') {
      problems.push(problem(id, `capability "${name}" is not a function`));
    }
  }

  for (const [name, fn] of Object.entries(caps.actions ?? {})) {
    if (typeof fn !== 'function') problems.push(problem(id, `action "${name}" is not a function`));
  }

  for (const field of manifest.configSchema ?? []) {
    if (!field?.key) problems.push(problem(id, 'a configSchema field has no key'));
    if (field?.label && /\s/.test(field.label)) {
      problems.push(problem(id, `configSchema field "${field.key}" has a sentence for a label; use an i18n key`));
    }
  }

  return problems;
}

function validateEngine(manifest, id) {
  const problems = [];
  const hooks = manifest.hooks;

  if (!hooks || typeof hooks !== 'object') {
    problems.push(problem(id, 'an engine module needs a hooks object'));
    return problems;
  }

  for (const [name, value] of Object.entries(hooks)) {
    if (!(name in ENGINE_HOOKS)) {
      problems.push(problem(id, `hook "${name}" is not one of: ${Object.keys(ENGINE_HOOKS).join(', ')}`));
      continue;
    }
    const wantsArray = name === 'ruleConditions' || name === 'ruleActions';
    if (wantsArray && !Array.isArray(value)) problems.push(problem(id, `hook "${name}" must be an array`));
    if (!wantsArray && typeof value !== 'function') problems.push(problem(id, `hook "${name}" is not a function`));
  }

  return problems;
}

/**
 * The manifest with every optional field filled in, so nothing downstream has to
 * write `manifest.capabilities?.sync ?? null` twice.
 */
export function normaliseManifest(manifest) {
  return {
    icon: 'connections',
    family: manifest.kind === 'source' ? 'other' : null,
    multiInstance: false,
    configSchema: [],
    emits: [],
    schedule: null,
    i18n: {},
    ui: {},
    ...manifest,
    capabilities: { actions: {}, ...(manifest.capabilities ?? {}) },
    hooks: manifest.hooks ?? {},
  };
}
