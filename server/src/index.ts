import { createApp } from './app.ts';
import { config } from './config.ts';
import { db } from './db/database.ts';

const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`[freshtrack] API listening on http://localhost:${config.port}`);
  console.log(`[freshtrack] environment: ${config.env} | AI (${config.ai.provider}): ${config.ai.enabled ? 'enabled' : 'disabled (heuristic fallback)'}`);
});

function shutdown(signal: string): void {
  console.log(`\n[freshtrack] ${signal} received - shutting down`);
  server.close(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    process.exit(0);
  });
  // Force-exit if connections linger.
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
