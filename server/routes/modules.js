/**
 * One set of endpoints for every module, whatever it is.
 *
 * Before this, each source had routes written by hand — `/ingest/activobank`,
 * `/ingest/activobank/upload`, `/pricempire/connect`, `/pricempire/portfolios`
 * — which meant adding a bank meant editing `api.js`, and the interface had to
 * know each provider's URLs by name. The routes below are derived from what a
 * module declares, so a new module is reachable the moment its folder exists.
 *
 * `GET /api/modules` is what the interface reads to know what to draw: the
 * manifest of each installed module, the configured instances, and which
 * capabilities each one offers. A card is rendered from that description, not
 * from a component written per provider.
 *
 * The hand-written routes in `api.js` still exist and now delegate here, so
 * nothing that already worked changed shape.
 */
import { Router } from 'express';
import multer from 'multer';
import { fail, failFrom } from '../lib/httpError.js';
import {
  listModules,
  listInstances,
  getInstance,
  invoke,
  invokeAction,
  supports,
  registryProblems,
  resetRegistry,
} from '../framework/registry.js';
import { saveSettings } from '../lib/settings.js';
import { reloadScheduler } from '../lib/scheduler.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

/**
 * What a module looks like from the outside.
 *
 * Capabilities are sent as a list of names rather than as functions, obviously,
 * but the shape matters: it is what lets the interface offer exactly the buttons
 * a module supports and no others, without a table of provider names anywhere in
 * the frontend.
 */
function describe(manifest) {
  return {
    id: manifest.id,
    kind: manifest.kind,
    family: manifest.family,
    label: manifest.label,
    icon: manifest.icon,
    multiInstance: manifest.multiInstance,
    configSchema: manifest.configSchema,
    emits: manifest.emits,
    schedule: manifest.schedule,
    capabilities: Object.keys(manifest.capabilities ?? {}).filter((k) => k !== 'actions'),
    actions: Object.keys(manifest.capabilities?.actions ?? {}),
    hooks: Object.keys(manifest.hooks ?? {}),
    // A custom card lives at modules/<id>/ui.jsx and is picked up by the
    // frontend's own glob; the server only says whether one is expected.
    ui: manifest.ui ?? {},
  };
}

router.get('/', async (req, res) => {
  try {
    const instances = await listInstances();
    res.json({
      modules: (await listModules()).map(describe),
      instances: instances.map((i) => ({
        id: i.id,
        module: i.module,
        enabled: i.enabled,
        missing: i.missing,
        kind: i.manifest?.kind ?? null,
        family: i.manifest?.family ?? null,
        label: i.manifest?.label ?? null,
        icon: i.manifest?.icon ?? null,
        schedule: i.schedule,
        config: i.config,
      })),
      // Surfaced rather than logged and forgotten: a module that failed to load
      // is invisible everywhere else, and "my bank disappeared" is a terrible
      // thing to have to debug from an empty screen.
      problems: await registryProblems(),
    });
  } catch (err) {
    failFrom(res, err);
  }
});

/**
 * Runs a capability, or explains why it cannot.
 *
 * A module that does not offer something is not a server fault — asking a
 * scheduled engine for its connection status is a perfectly ordinary thing for a
 * client to get wrong, and answering it with a 500 makes a missing feature look
 * like a crash.
 */
async function run(req, res, capability, ...args) {
  try {
    if (!(await supports(req.params.instance, capability))) {
      return fail(res, 404, 'api.error.moduleCapabilityNotFound');
    }
    res.json(await invoke(req.params.instance, capability, ...args));
  } catch (err) {
    failFrom(res, err);
  }
}

router.get('/:instance/status', (req, res) => run(req, res, 'status'));
router.post('/:instance/sync', (req, res) => run(req, res, 'sync'));
router.post('/:instance/reprocess', (req, res) => run(req, res, 'reprocess'));
router.post('/:instance/connect', (req, res) => run(req, res, 'connect', req.body ?? {}));

router.post('/:instance/upload', upload.array('documents', 20), async (req, res) => {
  if (!req.files || req.files.length === 0) return fail(res, 400, 'api.error.noFiles');
  const files = req.files.map((f) => ({ filename: f.originalname, buffer: f.buffer }));
  return run(req, res, 'upload', files);
});

/**
 * Anything else a module offers — listing the portfolios to choose from,
 * re-running a scrape for debugging. Declared under `capabilities.actions`, and
 * reached by name so the framework needs no opinion about what they are.
 */
router.post('/:instance/action/:name', async (req, res) => {
  try {
    res.json(await invokeAction(req.params.instance, req.params.name, req.body ?? {}));
  } catch (err) {
    failFrom(res, err);
  }
});

router.get('/:instance/config', async (req, res) => {
  try {
    const instance = await getInstance(req.params.instance);
    if (!instance) return fail(res, 404, 'api.error.moduleNotFound');
    res.json({
      id: instance.id,
      module: instance.module,
      enabled: instance.enabled,
      schedule: instance.schedule,
      config: instance.config,
      schema: instance.manifest?.configSchema ?? [],
    });
  } catch (err) {
    failFrom(res, err);
  }
});

/**
 * Writes one instance's configuration.
 *
 * This is also where an instance is *created*: a settings file that has never
 * named one has none, so the first write for an id brings it into being. Which
 * is what adding a second bank amounts to.
 *
 * The write starts from every instance that is currently in effect, not from
 * what happens to be written down. On an installation that predates modules,
 * ActivoBank and Pricempire are *derived* rather than stored — and building the
 * new settings from the stored map alone would have written a file naming only
 * the bank just added, silently taking the existing two out of the scheduler and
 * off the connections screen. Adding a second account must not cost you the
 * first.
 */
router.put('/:instance/config', async (req, res) => {
  try {
    const id = req.params.instance;
    const { module, enabled, schedule, config } = req.body ?? {};

    const effective = {};
    for (const instance of await listInstances()) {
      if (instance.manifest?.kind === 'engine') continue; // engines are not configured per account
      effective[instance.id] = {
        module: instance.module,
        enabled: instance.enabled,
        schedule: instance.schedule,
        config: instance.config,
      };
    }

    const existing = effective[id];
    if (!existing && !module) return fail(res, 400, 'api.error.moduleRequired');

    effective[id] = {
      module: module ?? existing.module,
      enabled: enabled ?? existing?.enabled ?? true,
      schedule: schedule ?? existing?.schedule ?? null,
      config: config ?? existing?.config ?? {},
    };

    saveSettings({ modules: effective });
    resetRegistry();
    await reloadScheduler();
    res.json(await getInstance(id));
  } catch (err) {
    failFrom(res, err);
  }
});

export default router;
