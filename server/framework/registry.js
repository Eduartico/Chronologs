/**
 * Finds the modules, and turns them into configured instances.
 *
 * Discovery is a directory listing: every `modules/<id>/module.js` is a module.
 * There is no central list to add yourself to, because a central list is exactly
 * the file every fork conflicts on — the whole point of this shape is that
 * adding a bank means adding a folder.
 *
 * A *module* is code. An *instance* is that code pointed at one account, with
 * its own configuration, its own directories and its own `source` string in the
 * ledger. One module can back several instances; `multiInstance: false` says it
 * cannot, and then the single instance takes the module's own id.
 *
 * Built-in engines (the rules pass, correlations, quote refreshes) are registered
 * from `builtins.js` rather than from disk. They are not pluggable — they are
 * the app — but they are described through the same contract so the scheduler
 * and the settings screen have exactly one kind of thing to iterate over.
 */
import { readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { validateManifest, normaliseManifest } from './contracts.js';
import { createContext } from './context.js';
import { loadSettings } from '../lib/settings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Overridable so a test can point at a directory of fixture modules. */
export const MODULES_DIR = process.env.CHRONOLOGS_MODULES_DIR || join(__dirname, '..', '..', 'modules');

let registry = null;

/**
 * Every module, keyed by id, with the problems found while loading.
 *
 * A broken module is skipped and reported, never fatal: one fork's
 * half-finished crypto wallet must not stop the bank that pays the rent from
 * syncing.
 */
export async function loadRegistry({ reload = false } = {}) {
  if (registry && !reload) return registry;

  const modules = new Map();
  const problems = [];

  const { BUILTIN_MODULES } = await import('./builtins.js');
  for (const manifest of BUILTIN_MODULES) {
    register(modules, problems, manifest, null);
  }

  if (existsSync(MODULES_DIR)) {
    for (const entry of readdirSync(MODULES_DIR, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : 1
    )) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(MODULES_DIR, entry.name, 'module.js');
      if (!existsSync(manifestPath)) continue;
      try {
        const loaded = await import(pathToFileURL(manifestPath).href);
        register(modules, problems, loaded.default, entry.name);
      } catch (err) {
        problems.push(`module "${entry.name}": failed to load — ${err.message}`);
      }
    }
  }

  registry = { modules, problems };
  return registry;
}

function register(modules, problems, manifest, folder) {
  const found = validateManifest(manifest, { folder });
  if (found.length > 0) {
    problems.push(...found);
    return;
  }
  if (modules.has(manifest.id)) {
    problems.push(`module "${manifest.id}": declared twice`);
    return;
  }
  modules.set(manifest.id, { ...normaliseManifest(manifest), folder });
}

export async function listModules() {
  const { modules } = await loadRegistry();
  return [...modules.values()];
}

export async function getModule(id) {
  const { modules } = await loadRegistry();
  return modules.get(id) ?? null;
}

export async function registryProblems() {
  const { problems } = await loadRegistry();
  return problems;
}

// ---------- instances ----------

/**
 * Configured instances, in the order they are declared in settings.
 *
 * A settings entry naming a module that is not installed is reported rather than
 * dropped: its data is still in the ledger, and silently pretending the source
 * never existed is how a fork loses half a history.
 */
export async function listInstances({ includeDisabled = true } = {}) {
  const { modules } = await loadRegistry();
  const settings = loadSettings();
  const instances = [];
  const configured = Object.keys(settings.modules ?? {}).length > 0
    ? settings.modules
    : deriveInstances(modules, settings);

  for (const [id, entry] of Object.entries(configured)) {
    const manifest = modules.get(entry.module ?? id);
    const enabled = entry.enabled !== false;
    if (!includeDisabled && !enabled) continue;
    instances.push({
      id,
      module: entry.module ?? id,
      manifest: manifest ?? null,
      missing: !manifest,
      enabled,
      config: entry.config ?? {},
      schedule: entry.schedule ?? manifest?.schedule ?? null,
    });
  }

  // Engines are not configured per account, so they never appear in
  // settings.modules; they are instances of themselves.
  for (const manifest of modules.values()) {
    if (manifest.kind !== 'engine') continue;
    if (instances.some((i) => i.id === manifest.id)) continue;
    const stored = settings.schedules?.[manifest.id];
    instances.push({
      id: manifest.id,
      module: manifest.id,
      manifest,
      missing: false,
      enabled: true,
      config: {},
      schedule: stored ?? manifest.schedule ?? null,
    });
  }

  return instances;
}

/**
 * Instances for a settings.json written before modules existed.
 *
 * Chronologs had exactly two sources, named in code, their schedules under
 * `schedules` and its one institution profile under `internal.profile`. That is
 * enough to reconstruct precisely the configuration an installation already
 * had — same ids, same crons, same profile — so nothing changes on the first
 * read after an upgrade.
 *
 * Derived on read rather than written on upgrade, deliberately. A migration
 * that rewrites the settings file the first time it is opened is a migration
 * that can run during a crash, on a half-written file, over someone's real
 * money. This is a pure function of what is already there; the new shape is
 * persisted only when the user next saves something.
 *
 * Only installed modules are derived, which is what makes deleting a module
 * folder a supported way to fork: no phantom instance is left behind naming
 * code that is gone.
 */
function deriveInstances(modules, settings) {
  const sources = [...modules.values()].filter((m) => m.kind === 'source');
  const banks = sources.filter((m) => m.family === 'bank');
  const derived = {};

  for (const manifest of sources) {
    // A template or demonstration module is installed but not *yours*. It gets
    // no instance until someone asks for one, so it neither appears on the
    // connections screen nor writes a `source` into anybody's ledger by
    // existing. Adding an instance is the same request as adding a second bank.
    if (manifest.enabledByDefault === false) continue;
    derived[manifest.id] = {
      module: manifest.id,
      enabled: true,
      schedule: settings.schedules?.[manifest.id] ?? manifest.schedule ?? null,
      config: {
        // The one global profile belonged to the one bank there was. With two
        // banks installed there is no way to say which it meant, and guessing
        // would apply one bank's wording to another's statements.
        ...(banks.length === 1 && banks[0].id === manifest.id
          ? { profile: settings.internal?.profile ?? null }
          : {}),
      },
    };
  }

  return derived;
}

export async function getInstance(id) {
  const instances = await listInstances();
  return instances.find((i) => i.id === id) ?? null;
}

/** Instances of source modules in one family — every bank, every wallet. */
export async function instancesOfFamily(family, { includeDisabled = false } = {}) {
  const instances = await listInstances({ includeDisabled });
  return instances.filter((i) => i.manifest?.kind === 'source' && i.manifest.family === family);
}

export async function sourceInstances({ includeDisabled = false } = {}) {
  const instances = await listInstances({ includeDisabled });
  return instances.filter((i) => i.manifest?.kind === 'source');
}

/**
 * The instance that wrote an event.
 *
 * `source` on an event *is* the instance id, which is what lets the duplicate
 * checker and the account backfill re-read a stored document through whichever
 * parser produced it, without either of them naming a bank.
 */
export async function moduleForSource(source) {
  return getInstance(source);
}

/** The bound context for an instance, or null when it is not configured. */
export async function contextFor(id) {
  const instance = await getInstance(id);
  if (!instance || instance.missing) return null;
  return createContext(instance);
}

/**
 * Runs one capability of one instance, with its context.
 *
 * Every call site — the scheduler, the routes, another module — goes through
 * here, so "is this instance configured, installed, enabled, and does it
 * actually offer this?" is answered once instead of at each of them.
 */
export async function invoke(instanceId, capability, ...args) {
  const instance = await getInstance(instanceId);
  if (!instance) throw new Error(`No module instance "${instanceId}"`);
  if (instance.missing) throw new Error(`Instance "${instanceId}" names module "${instance.module}", which is not installed`);

  const fn =
    instance.manifest.kind === 'engine'
      ? instance.manifest.hooks[capability]
      : instance.manifest.capabilities[capability];

  if (typeof fn !== 'function') {
    throw new Error(`Module "${instance.module}" does not support "${capability}"`);
  }
  return fn(createContext(instance), ...args);
}

/**
 * Runs one of a module's own declared actions.
 *
 * Kept apart from `invoke` because the two answer different questions.
 * Capabilities are the fixed vocabulary every source is measured against —
 * sync, upload, connect — and the interface knows what each one means.
 * Actions are whatever else a particular module offers, reached by name, and
 * the framework holds no opinion about them at all.
 */
export async function invokeAction(instanceId, name, input = {}) {
  const instance = await getInstance(instanceId);
  if (!instance?.manifest) throw new Error(`No module instance "${instanceId}"`);
  const action = instance.manifest.capabilities?.actions?.[name];
  if (!action) throw new Error(`Module "${instance.module}" has no action "${name}"`);
  return action(createContext(instance), input);
}

/** Whether an instance offers something, without throwing to find out. */
export async function supports(instanceId, capability) {
  const instance = await getInstance(instanceId);
  if (!instance?.manifest) return false;
  const table =
    instance.manifest.kind === 'engine' ? instance.manifest.hooks : instance.manifest.capabilities;
  return typeof table[capability] === 'function';
}

/** Every engine hook of one name, in module id order. */
export async function hooks(name) {
  const { modules } = await loadRegistry();
  const found = [];
  for (const manifest of [...modules.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (manifest.kind !== 'engine') continue;
    const hook = manifest.hooks[name];
    if (hook) found.push({ id: manifest.id, hook });
  }
  return found;
}

/** Forget everything, so a test can change settings and look again. */
export function resetRegistry() {
  registry = null;
}
