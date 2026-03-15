import { WEBUI_API_PORT } from './config.js';
import { initDatabase } from './db.js';
import { logger } from './logger.js';
import { startWebuiApiServer } from './webui-api.js';

async function main(): Promise<void> {
  initDatabase();
  await startWebuiApiServer(WEBUI_API_PORT, '0.0.0.0');
  logger.info(
    { url: `http://localhost:${WEBUI_API_PORT}/r3-acceptance` },
    'R3 acceptance server is running',
  );
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start R3 acceptance server');
  process.exit(1);
});
