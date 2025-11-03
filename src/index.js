import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { AppDataSource } from './data-source.js';
import { createServer } from './server.js';
import { log, error } from './utils/logger.js';
import { startClient, reconnectStoredSessions, allowAutoStart } from './whatsapp/clientManager.js';
import './queue/queues.js';
import { startConnectionMonitor } from './monitor/connectionMonitor.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure data dir exists for sqlite
const dataDir = path.join(__dirname, 'data');
try { fs.mkdirSync(dataDir, { recursive: true }); } catch { }

async function bootstrap() {
  try {
    await AppDataSource.initialize();
    log('DB initialized at', AppDataSource.options.database);

    // Reconnect stored sessions on disk
    const discovered = await reconnectStoredSessions();

    // Auto-start additional clients from env (dedup)
    const envIds = (process.env.WA_CLIENT_IDS || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    for (const id of envIds) {
      if (discovered.includes(id)) continue;
      // respect DISCONNECTED status
      if (!(await allowAutoStart(id))) {
        log('Skipping env auto-start for DISCONNECTED session', id);
        continue;
      }
      startClient(id).catch((e) => error('Failed to start client', id, e));
    }

    const app = createServer();
    const port = Number(process.env.PORT || 3030);
    app.listen(port, () => log(`HTTP server running on :${port}`));

    startConnectionMonitor();
  } catch (e) {
    error('Bootstrap error', e);
    process.exit(1);
  }
}

bootstrap();
