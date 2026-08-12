/**
 * Captures everything the system currently produces, so a refactor can be shown
 * to have changed nothing.
 *
 * Three captures, because each one catches a different kind of regression:
 *
 *  1. `projections.json` — the replayed ledger. Catches a change in what the
 *     events *mean*: a movement that stopped being recognised as an internal
 *     transfer, a vault that reconciles differently, a category that moved.
 *  2. `api/*.json` — every read-only endpoint, including the parameterised ones
 *     fed with real ids taken from the projection. Catches a change in what the
 *     screens are *handed*, which is not the same thing: an engine can be
 *     correct and a route can still hand it over wrong.
 *  3. `documents.json` — every stored document re-parsed. Catches a parser that
 *     broke while being moved, which the two captures above cannot see, because
 *     the ledger already holds what the old parser produced.
 *
 * Run against real data the captures never leave `user-data/` (gitignored).
 */
import express from 'express';
import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { canonical } from './canonical.js';
import { documentsPath } from '../../server/lib/paths.js';
import { invalidateProjections } from '../../server/projections/cache.js';

// ---------- routes ----------

/**
 * Endpoints deliberately left out of the comparison, each for a reason that
 * would otherwise produce a false failure on every run.
 */
const SKIP = new Map([
  ['/notifications', 'grows on its own between two runs'],
  ['/llm/models', 'queries Ollama over the network'],
  ['/pricempire/portfolios', 'queries Pricempire over the network'],
  ['/google/auth-url', 'mints a new state parameter per call'],
  ['/google/callback', 'consumes a one-time OAuth code'],
]);

/**
 * Responses too large to store verbatim, reduced to something still sensitive to
 * change. `/events` is the whole ledger — 10.000 lines of the very input the
 * other captures are derived from.
 */
const DIGEST = new Set(['/events']);

/** Query strings worth capturing beyond the bare route. */
const QUERY_MATRIX = {
  '/transactions': [
    '',
    'status=pending',
    'status=categorized',
    'search=continente',
    'from=2025-01-01&to=2025-12-31',
  ],
  '/transactions/search': ['', 'search=mb way', 'category=groceries'],
  '/transactions/pending': ['', 'group=merchant', 'sort=amount_desc'],
  '/analytics': ['', 'granularity=week', 'from=2025-01-01&to=2025-12-31'],
  '/duplicates': ['', 'includeDismissed=true'],
  '/accounts/movements': [''],
  '/investments': ['', 'currency=EUR'],
};

/**
 * Real ids for the `:param` routes, read out of the projection.
 *
 * Capturing only the parameterless endpoints would leave the travel screens, the
 * per-category usage counts and the suggestion engine entirely unmeasured.
 */
async function parameterSamples(projections) {
  const [travels, categories, instances] = await Promise.all([
    import('../../server/engines/travel.js').then((m) => m.loadTravels()),
    import('../../server/engines/categorization.js').then((m) => m.getCategories()),
    import('../../server/framework/registry.js').then((m) => m.listInstances()),
  ]);
  // Pending rows are the interesting case for the suggestion engine, but a
  // fully categorised ledger has none — and leaving the sample list empty would
  // silently drop /suggestions from the capture altogether.
  const pending = projections.transactions.filter((t) => t.status === 'pending');
  const sampled = (pending.length > 0 ? pending : projections.transactions).slice(0, 5);
  return {
    id: [...travels.slice(0, 3).map((t) => t.id)],
    transactionId: sampled.map((t) => t.id),
    name: categories.slice(0, 5).map((c) => c.name),
    instance: instances.map((i) => i.id),
  };
}

/**
 * Every GET the router exposes, expanded over the query matrix and id samples.
 *
 * `mount` is the prefix the router sits behind, so a router mounted at
 * /api/modules reports the URLs it is actually reachable at rather than the
 * paths it declares internally.
 */
function enumerateRequests(router, samples, mount = '') {
  const requests = [];
  for (const layer of router.stack) {
    const route = layer.route;
    if (!route || !route.methods?.get) continue;
    const path = mount + (route.path === '/' ? '' : route.path);
    if (SKIP.has(path)) continue;

    const params = [...path.matchAll(/:(\w+)/g)].map((m) => m[1]);
    if (params.length === 0) {
      for (const query of QUERY_MATRIX[path] ?? ['']) {
        requests.push({ path, url: query ? `${path}?${query}` : path });
      }
      continue;
    }

    // One request per sampled value of the first parameter; routes with two
    // parameters are covered by pairing each sample with the first of the other.
    const [first, ...rest] = params;
    for (const value of samples[first] ?? []) {
      let url = path.replace(`:${first}`, encodeURIComponent(value));
      let resolved = true;
      for (const other of rest) {
        const alternative = samples[other]?.[0];
        if (alternative == null) {
          resolved = false;
          break;
        }
        url = url.replace(`:${other}`, encodeURIComponent(alternative));
      }
      if (resolved) requests.push({ path, url });
    }
  }
  return requests.sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0));
}

/** A filename-safe key for a request, so a capture is one file per request. */
function fileKeyFor(url) {
  return url.replace(/^\//, '').replace(/[^\w.=&-]+/g, '_') || 'root';
}

async function captureApi(projections) {
  const { default: apiRouter } = await import('../../server/routes/api.js');
  const { default: modulesRouter } = await import('../../server/routes/modules.js');
  const app = express();
  app.use(express.json());
  // Mounted exactly as server/index.js mounts them, or the capture would be of
  // a different application than the one that runs.
  app.use('/api/modules', modulesRouter);
  app.use('/api', apiRouter);

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = server.address().port;

  const out = {};
  try {
    const samples = await parameterSamples(projections);
    const requests = [
      ...enumerateRequests(apiRouter, samples),
      ...enumerateRequests(modulesRouter, samples, '/modules'),
    ];
    for (const { path, url } of requests) {
      const response = await fetch(`http://127.0.0.1:${port}/api${url}`);
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = { '«unparseable»': text.slice(0, 500) };
      }
      out[fileKeyFor(url)] = {
        url,
        status: response.status,
        body: DIGEST.has(path) ? digest(body) : canonical(body),
      };
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  return out;
}

function digest(body) {
  const text = JSON.stringify(canonical(body));
  return {
    '«digest»': createHash('sha256').update(text).digest('hex'),
    bytes: text.length,
    count: Array.isArray(body) ? body.length : Array.isArray(body?.events) ? body.events.length : null,
  };
}

// ---------- documents ----------

/**
 * Re-parses every stored document and records what came out.
 *
 * Each document is read by whichever module instance owns the directory it sits
 * in, exactly as the duplicate checker and the account backfill read it. That is
 * the point of the capture: a baseline taken while the parsers lived in
 * `server/ingestion/activobank/` and compared after they moved to
 * `modules/activobank/` is direct proof the move changed nothing.
 */
function storedDocuments() {
  const files = [];
  const root = documentsPath();
  if (!existsSync(root)) return files;
  // Walk whatever institution folders exist rather than naming one, so this
  // keeps working once documents are stored per module instance.
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  walk(root);
  return files.sort();
}

async function captureDocuments() {
  const { invoke, supports } = await import('../../server/framework/registry.js');
  const out = {};

  for (const path of storedDocuments()) {
    const relative = path.slice(documentsPath().length + 1).replace(/\\/g, '/');
    // documents/<instance>/<stage>/<batch>/<file> — the first segment is the
    // instance that ingested it.
    const owner = relative.split('/')[0];
    if (!(await supports(owner, 'parseDocument'))) continue;

    try {
      const parsed = await invoke(owner, 'parseDocument', {
        filename: basename(path),
        buffer: readFileSync(path),
        date: null,
      });
      const transactions = parsed.transactions || [];
      out[relative] = {
        kind: parsed.kind ?? null,
        transactionIds: transactions.map((t) => t.transaction_id).sort(),
        // Amounts and dates too: an id is derived from them, but a parser could
        // still get an account label or a balance wrong without moving the id.
        rows: transactions
          .map((t) => `${t.date}|${t.amount}|${t.account ?? ''}|${t.account_id ?? ''}|${t.balance ?? ''}`)
          .sort(),
        orders: (parsed.orders || []).length,
        unparsedLines: (parsed.unparsedLines || []).length,
      };
    } catch (err) {
      out[relative] = { error: err.message };
    }
  }
  return out;
}

// ---------- entry point ----------

/**
 * Everything, as a flat map of relative file path to value. The caller either
 * writes it (baseline) or diffs it against what was written (verify).
 */
export async function captureAll({ skipDocuments = false } = {}) {
  invalidateProjections();
  const { buildProjections } = await import('../../server/projections/rebuild.js');
  const projections = await buildProjections();

  // The ledger itself is the input, not a projection of it; storing 10.000
  // events would double the capture and diff noisily on a single new movement.
  const { events, ...rest } = projections;
  const files = {
    'projections.json': {
      ...canonical(rest),
      '«ledger»': digest(events),
    },
  };

  for (const [key, value] of Object.entries(await captureApi(projections))) {
    files[`api/${key}.json`] = value;
  }

  if (!skipDocuments) files['documents.json'] = canonical(await captureDocuments());

  return files;
}
