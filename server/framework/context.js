/**
 * The single argument every module capability receives.
 *
 * A module never imports `paths.js`, `eventStore.js` or `notify.js`, and never
 * writes its own `source` string. It gets a context bound to one configured
 * instance of itself, and everything it can touch hangs off that. Two
 * consequences, both of them the point:
 *
 *  - The same module code can be configured twice — two banks, two wallets —
 *    without a line of it knowing. `ctx.instanceId` is what separates them, and
 *    it is stamped onto every event as `source`, which is how the ledger has
 *    always told data apart.
 *  - A module cannot reach outside its own instance by accident. Its documents,
 *    its browser profile, its state and its secrets are all under paths derived
 *    from the same id.
 *
 * The instance id is permanent. Events already in the ledger carry it, and the
 * ledger is append-only, so renaming an instance orphans its history. This is
 * also why Eduardo's ActivoBank instance is called `activobank` and his
 * Pricempire one `pricempire`: those are the strings already written into 10.000
 * events, and the framework was shaped to fit them rather than the reverse.
 */
import {
  createEvent,
  appendEvent,
  appendIfNew as appendIfNewGlobal,
  loadLedgerIndex,
  appendIfNewIndexed,
} from '../ledger/eventStore.js';
import { documentsPath, browserPath, statePath, secretsPath } from '../lib/paths.js';
import { notify as notifyGlobal } from '../lib/notify.js';
import { loadSettings } from '../lib/settings.js';

/**
 * Paths scoped to one instance.
 *
 * `stateFile` is the exception that proves the rule: it takes a bare filename
 * and is only for state files that existed before modules did. Everything new
 * uses `state`, which cannot collide between two instances of the same module.
 */
function pathsFor(instanceId) {
  return {
    /** documents/<instance>/… — raw statements, exports, receipts. */
    documents: (...parts) => documentsPath(instanceId, ...parts),
    /**
     * browser/<instance>[-<suffix>] — a persistent browser profile. Suffixed
     * siblings rather than nested directories, because a Playwright profile
     * directory has to be a leaf.
     */
    browser: (suffix = null) => browserPath(suffix ? `${instanceId}-${suffix}` : instanceId),
    /** state/<instance>-<name>.json — small mutable state, safe to lose. */
    state: (name) => statePath(`${instanceId}-${name}.json`),
    /** A state file whose name predates this framework. New modules: use `state`. */
    stateFile: (filename) => statePath(filename),
    /** secrets/<instance>/… — tokens and credentials. Never logged. */
    secrets: (...parts) => secretsPath(instanceId, ...parts),
  };
}

/**
 * Ledger access with the source already decided.
 *
 * `open()` is the batch form: scanning the whole ledger once per event turns a
 * mailbox import into an O(n²) crawl, which is a mistake worth making
 * structurally hard rather than documenting.
 */
function ledgerFor(instanceId) {
  const build = (type, payload, linked = []) => createEvent(type, instanceId, payload, linked);

  return {
    createEvent: build,
    append: (type, payload, linked) => appendEvent(build(type, payload, linked)),
    appendIfNew: (type, payload, linked) => appendIfNewGlobal(build(type, payload, linked)),
    async open() {
      const index = await loadLedgerIndex();
      return {
        events: index.events,
        appendIfNew: (type, payload, linked) => appendIfNewIndexed(build(type, payload, linked), index),
      };
    },
  };
}

/**
 * Builds the context for one configured instance.
 *
 * `instance` is the resolved settings entry: `{ id, module, config, … }`.
 */
export function createContext(instance) {
  const { id } = instance;
  return {
    instanceId: id,
    module: instance.module,
    config: instance.config ?? {},
    enabled: instance.enabled !== false,
    paths: pathsFor(id),
    ledger: ledgerFor(id),
    /**
     * `key` is a translation key, never a sentence — a notification is read
     * whenever it is opened, in whatever language is current then.
     */
    notify: (level, key, params, meta = {}) => notifyGlobal(level, key, params, { module: id, ...meta }),
    settings: () => loadSettings(),
    log: (...args) => console.log(`  [${id}]`, ...args),
  };
}
