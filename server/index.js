import express from 'express';
import cors from 'cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import apiRouter from './routes/api.js';
import modulesRouter from './routes/modules.js';
import { ensureDefaultCategories } from './engines/categorization.js';
import { bootstrapUserData, ensureInstanceDirectories, USER_DATA_DIR } from './lib/paths.js';
import { startScheduler } from './lib/scheduler.js';
import { listInstances, listModules, registryProblems } from './framework/registry.js';
import { registerModuleCatalogues } from './framework/i18n.js';
import { registerRuleContributions } from './engines/rules.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

bootstrapUserData();
ensureDefaultCategories();

// A module that fails to load is reported and skipped, never fatal: one fork's
// half-finished wallet must not stop the bank that pays the rent from syncing.
for (const problem of await registryProblems()) console.warn(`  ⚠ ${problem}`);

// Module-supplied strings, so a fork's own bank can name its notifications
// without editing a shipped catalogue. See framework/i18n.js for why this is a
// registration rather than an import.
const installed = await listModules();
registerModuleCatalogues(installed);

// Extra rule conditions and actions an engine module contributes. Registered
// rather than imported: the rules engine is evaluated once per rule per
// transaction over the whole ledger, and cannot afford an async lookup inside
// that loop.
registerRuleContributions(installed);

const instances = await listInstances();
ensureInstanceDirectories(instances.filter((i) => i.manifest?.kind === 'source').map((i) => i.id));

await startScheduler();

const app = express();
app.use(cors());
app.use(express.json());

// API routes. Modules first: its paths all sit under /api/modules, and mounting
// it ahead of the general router keeps them out of reach of any future
// catch-all there.
app.use('/api/modules', modulesRouter);
app.use('/api', apiRouter);

// Serve web frontend in production
const webDist = join(__dirname, '..', 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res) => {
    res.sendFile(join(webDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`\n  Chronologs server running on http://localhost:${PORT}`);
  console.log(`  API: http://localhost:${PORT}/api\n`);
  console.log(`  User data directory: ${USER_DATA_DIR}\n`);
});

// Close every browser context cleanly so the session state is flushed. Named no
// module in particular: any source read through a browser registers its session
// with the kit, and all of them need the same shutdown.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    try {
      const { closeAllBrowsers } = await import('./framework/kits/browserSource.js');
      await closeAllBrowsers();
    } catch {}
    process.exit(0);
  });
}
