import { AppDataSource } from '../data-source.js';
import { listClients, getClient } from '../whatsapp/clientManager.js';
import { log, error } from '../utils/logger.js';

const INTERVAL_MS = Number(process.env.SCHEDULER_CONNECTION_CHECK_MS || 30000);

export function startConnectionMonitor() {
  const tick = async () => {
    const ids = listClients();
    const repo = AppDataSource.getRepository('WhatsAppAccount');
    for (const clientId of ids) {
      try {
        const client = await getClient(clientId);
        if (!client || !client.getState) continue;
        const state = await client.getState(); // CONNECTED, TIMEOUT, UNLAUNCHED, etc.
        const acc = await repo.findOne({ where: { clientId } });
        if (!acc) continue;
        if (state === 'CONNECTED') {
          if (acc.status !== 'READY') { acc.status = 'READY'; }
        } else {
          acc.status = 'DISCONNECTED';
        }
        await repo.save(acc);
      } catch (e) {
        const msg = e && e.message ? e.message : String(e);
        error('Connection monitor error for', clientId, msg);

        // If Chromium session/page has been closed, force a service restart
        // Example message:
        // "Protocol error (Runtime.callFunctionOn): Session closed. Most likely the page has been closed."
        if (msg.includes('Protocol error') && msg.includes('Runtime.callFunctionOn') && msg.includes('Session closed')) {
          error('Detected closed browser session. Restarting service...');
          // Small delay to flush logs before exit; rely on supervisor (pm2/systemd/docker) to restart
          setTimeout(() => process.exit(1), 500);
        }
      }
    }
  };

  // First run soon after start
  setTimeout(tick, 5000);
  // Periodic
  setInterval(tick, INTERVAL_MS);
  log(`Connection monitor started (every ${INTERVAL_MS} ms)`);
}
