import { createApp } from './app.js';
import { config } from './config/env.js';
import { migrate } from './db/migrate.js';
import { pool, query } from './db/pool.js';
import { runDecision } from './services/ai/engine.js';

const DAILY_MS = 24 * 60 * 60 * 1000;

async function dailyJob() {
  // Refresh data and regenerate decisions for every field once a day.
  const { rows } = await query('SELECT * FROM fields');
  for (const f of rows) {
    try { await runDecision(f); } catch (e) { console.warn(`[scheduler] field ${f.id}: ${e.message}`); }
  }
  console.log(`[scheduler] refreshed ${rows.length} field(s)`);
}

async function start() {
  await migrate();
  const app = createApp();
  const server = app.listen(config.port, () => console.log(`🌱 AgriSense API listening on http://localhost:${config.port}`));
  if (process.env.DISABLE_SCHEDULER !== 'true') {
    setInterval(() => dailyJob().catch((e) => console.error('[scheduler]', e)), DAILY_MS).unref();
  }
  const shutdown = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

start().catch((err) => { console.error('Failed to start:', err); process.exit(1); });
