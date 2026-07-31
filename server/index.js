import express from 'express';
import cors from 'cors';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import apiRouter from './routes/api.js';
import { ensureDefaultCategories } from './engines/categorization.js';
import { bootstrapUserData, USER_DATA_DIR } from './lib/paths.js';
import { startScheduler } from './lib/scheduler.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

bootstrapUserData();
ensureDefaultCategories();
startScheduler();

const app = express();
app.use(cors());
app.use(express.json());

// API routes
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

// Close the Pricempire browser context cleanly so the session state is flushed.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    try {
      const { closeBrowser } = await import('./ingestion/pricempire/browser.js');
      await closeBrowser();
    } catch {}
    process.exit(0);
  });
}
