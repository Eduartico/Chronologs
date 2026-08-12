/**
 * The generic module endpoints, against invented modules.
 *
 * These are the routes a fork's new bank is reached through, so they are tested
 * without either of the two providers this app happens to ship — if anything
 * here only works for ActivoBank, the framework has not done its job.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import express from 'express';

const DATA_DIR = mkdtempSync(join(tmpdir(), 'chronologs-routes-'));
const MODULES_DIR = mkdtempSync(join(tmpdir(), 'chronologs-routemods-'));
mkdirSync(join(DATA_DIR, 'ledger'), { recursive: true });
mkdirSync(join(DATA_DIR, 'state'), { recursive: true });
process.env.CHRONOLOGS_DATA_DIR = DATA_DIR;
process.env.CHRONOLOGS_MODULES_DIR = MODULES_DIR;

mkdirSync(join(MODULES_DIR, 'demo-bank'), { recursive: true });
writeFileSync(
  join(MODULES_DIR, 'demo-bank', 'module.js'),
  `export default {
    id: 'demo-bank',
    kind: 'source',
    family: 'bank',
    label: 'module.demo.label',
    icon: 'accounts',
    multiInstance: true,
    configSchema: [{ key: 'profile', type: 'institutionProfile', label: 'module.demo.profile' }],
    schedule: { preset: 'daily', cron: '0 8 * * *' },
    capabilities: {
      sync: async (ctx) => ({ ranAs: ctx.instanceId, config: ctx.config }),
      status: async (ctx) => ({ connected: true, instance: ctx.instanceId }),
      actions: {
        echo: async (ctx, input) => ({ heard: input, from: ctx.instanceId }),
      },
    },
  };`,
  'utf-8'
);

const { default: modulesRouter } = await import('./modules.js');
const { resetRegistry } = await import('../framework/registry.js');

let server;
let base;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/modules', modulesRouter);
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}/api/modules`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const get = (path) => fetch(`${base}${path}`).then(async (r) => ({ status: r.status, body: await r.json() }));
const send = (method, path, body) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

test('the listing describes what a module offers, not who it is', async () => {
  const { body } = await get('/');
  const demo = body.modules.find((m) => m.id === 'demo-bank');

  assert.ok(demo, 'the discovered module is missing from the listing');
  assert.equal(demo.family, 'bank');
  assert.equal(demo.label, 'module.demo.label');
  // The interface draws its buttons from exactly this, which is why it is a
  // list of names and not a boolean per known provider.
  assert.deepEqual(demo.capabilities.sort(), ['status', 'sync']);
  assert.deepEqual(demo.actions, ['echo']);
  assert.deepEqual(body.problems, []);
});

test('an instance exists for a discovered module without anyone configuring it', async () => {
  const { body } = await get('/');
  const instance = body.instances.find((i) => i.id === 'demo-bank');
  assert.ok(instance, 'a module with no settings entry should still be usable');
  assert.equal(instance.missing, false);
  assert.equal(instance.enabled, true);
});

test('a capability runs with its own instance context', async () => {
  const { status, body } = await send('POST', '/demo-bank/sync');
  assert.equal(status, 200);
  assert.equal(body.ranAs, 'demo-bank');
});

test('a declared action is reached by name', async () => {
  const { status, body } = await send('POST', '/demo-bank/action/echo', { hello: 'world' });
  assert.equal(status, 200);
  assert.deepEqual(body.heard, { hello: 'world' });
  assert.equal(body.from, 'demo-bank');
});

test('a capability the module does not offer is a client error, not a crash', async () => {
  const { status } = await send('POST', '/demo-bank/reprocess');
  assert.equal(status, 404);
});

test('an action the module does not have is refused', async () => {
  const { status } = await send('POST', '/demo-bank/action/nonsense');
  assert.notEqual(status, 200);
});

test('an unknown instance is refused rather than silently doing nothing', async () => {
  const { status } = await send('POST', '/no-such-bank/sync');
  assert.notEqual(status, 200);
});

test('writing a config creates a second instance of the same module', async () => {
  // This is the whole multi-account story in one request: the same code,
  // configured twice, with its own id and its own institution wording.
  const created = await send('PUT', '/second-bank/config', {
    module: 'demo-bank',
    config: { profile: { transferOut: '^ENVIO PARA ' } },
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.module, 'demo-bank');

  resetRegistry();
  const { body } = await get('/');
  const ids = body.instances.map((i) => i.id).sort();
  assert.ok(ids.includes('demo-bank'), 'the original instance was lost');
  assert.ok(ids.includes('second-bank'), 'the new instance is missing');

  // …and it runs as itself, with its own configuration.
  const ran = await send('POST', '/second-bank/sync');
  assert.equal(ran.body.ranAs, 'second-bank');
  assert.equal(ran.body.config.profile.transferOut, '^ENVIO PARA ');

  // The first instance is untouched by the second existing.
  const first = await send('POST', '/demo-bank/sync');
  assert.equal(first.body.ranAs, 'demo-bank');
});

test('a new instance must say which module it is', async () => {
  const { status } = await send('PUT', '/mystery/config', { config: {} });
  assert.equal(status, 400);
});

test('an instance naming a module that is not installed is reported, not hidden', async () => {
  const file = join(DATA_DIR, 'state', 'settings.json');
  const settings = JSON.parse(readFileSync(file, 'utf-8'));
  settings.modules['ghost-bank'] = { module: 'not-installed', enabled: true, config: {} };
  writeFileSync(file, JSON.stringify(settings), 'utf-8');
  resetRegistry();

  const { body } = await get('/');
  const ghost = body.instances.find((i) => i.id === 'ghost-bank');
  // Its data is still in the ledger under that source. Dropping the instance
  // would make a history look like it never happened.
  assert.ok(ghost, 'an instance whose module is missing must still be listed');
  assert.equal(ghost.missing, true);
});
