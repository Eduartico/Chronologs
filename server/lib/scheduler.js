/**
 * Cron jobs, one per configured module instance.
 *
 * This file used to hold a literal registry of five entries — two banks-and-a-
 * marketplace by name, three engines — which meant that adding a source meant
 * editing it, and that the settings screen kept its own copy of the same five
 * names to render a table from. Both lists now come from the module registry:
 * a source instance is schedulable when its module declares `sync`, an engine
 * when it declares `scheduledJob`.
 *
 * What each job actually does is unchanged; see framework/builtins.js for the
 * engines and modules/<id>/module.js for the sources.
 */
import cron from 'node-cron';
import { loadSettings } from './settings.js';
import { notify } from './notify.js';
import { listInstances, invoke, supports } from '../framework/registry.js';

const running = new Map();
let jobs = [];

/** The capability the scheduler calls for a given instance. */
async function jobCapability(instanceId) {
  if (await supports(instanceId, 'scheduledJob')) return 'scheduledJob';
  if (await supports(instanceId, 'sync')) return 'sync';
  return null;
}

/**
 * Runs one module by id, guarding against a second run while the first is in
 * flight — a six-hourly scrape that takes longer than six hours would otherwise
 * pile up browsers until the machine gave out.
 */
export async function runModule(module) {
  const capability = await jobCapability(module);
  if (!capability) throw new Error(`Unknown module: ${module}`);
  if (running.get(module)) return { skipped: true, reason: 'already running' };
  running.set(module, true);
  try {
    return await invoke(module, capability);
  } catch (err) {
    notify('error', 'notify.schedule.failed', { module, detail: err.message }, { module });
    throw err;
  } finally {
    running.set(module, false);
  }
}

/**
 * Where an instance's schedule is configured.
 *
 * Source instances carry their own, so two banks can sync at different times.
 * Engines are single and keep theirs under `settings.schedules`, which is where
 * a settings.json written before modules existed already has them.
 */
function scheduleFor(instance, settings) {
  return instance.manifest?.kind === 'source'
    ? instance.schedule ?? settings.schedules?.[instance.module] ?? null
    : settings.schedules?.[instance.id] ?? instance.schedule ?? null;
}

export async function reloadScheduler() {
  for (const j of jobs) j.stop();
  jobs = [];

  const settings = loadSettings();
  const active = [];

  for (const instance of await listInstances({ includeDisabled: false })) {
    if (instance.missing) continue;
    const cfg = scheduleFor(instance, settings);
    if (!cfg?.enabled || !cfg.cron) continue;
    if (!(await jobCapability(instance.id))) continue;

    if (!cron.validate(cfg.cron)) {
      notify('warning', 'notify.schedule.invalidCron', { module: instance.id, cron: cfg.cron }, { module: instance.id });
      continue;
    }
    jobs.push(cron.schedule(cfg.cron, () => runModule(instance.id).catch(() => {})));
    active.push(`${instance.id} (${cfg.cron})`);
  }

  if (active.length > 0) console.log(`  Scheduler active: ${active.join(', ')}`);
  return active;
}

export function startScheduler() {
  return reloadScheduler();
}
