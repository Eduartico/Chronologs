import cron from 'node-cron';
import { loadSettings } from './settings.js';
import { notify } from './notify.js';

const running = new Map();
let jobs = [];

const REGISTRY = {
  activobank: async () =>
    (await import('../ingestion/activobank/index.js')).ingestActivobank({ origin: 'gmail' }),
  pricempire: async () => (await import('../ingestion/pricempire/index.js')).ingestPricempire(),
  correlations: async () => {
    const { runCorrelations } = await import('../engines/correlation.js');
    const result = await runCorrelations();
    if (result.proposals > 0) return result;
    return result;
  },
  rules: async () => {
    const { runRules } = await import('../engines/rules.js');
    const result = await runRules({});
    if (result.categorized > 0 || result.tagged > 0) {
      notify(
        'info',
        'Rules run complete',
        `${result.categorized} categorized, ${result.tagged} tagged`,
        { module: 'rules', ...result }
      );
    }
    return result;
  },
};

export async function runModule(module) {
  const job = REGISTRY[module];
  if (!job) throw new Error(`Unknown module: ${module}`);
  if (running.get(module)) return { skipped: true, reason: 'already running' };
  running.set(module, true);
  try {
    return await job();
  } catch (err) {
    notify('error', `Scheduled ${module} run failed`, err.message, { module });
    throw err;
  } finally {
    running.set(module, false);
  }
}

export function reloadScheduler() {
  for (const j of jobs) j.stop();
  jobs = [];
  const settings = loadSettings();
  const active = [];
  for (const [module, cfg] of Object.entries(settings.schedules || {})) {
    if (!cfg.enabled || !cfg.cron || !REGISTRY[module]) continue;
    if (!cron.validate(cfg.cron)) {
      notify('warning', `Invalid cron for ${module}`, `"${cfg.cron}" — schedule ignored`, { module });
      continue;
    }
    jobs.push(cron.schedule(cfg.cron, () => runModule(module).catch(() => {})));
    active.push(`${module} (${cfg.cron})`);
  }
  if (active.length > 0) console.log(`  Scheduler active: ${active.join(', ')}`);
  return active;
}

export function startScheduler() {
  return reloadScheduler();
}
