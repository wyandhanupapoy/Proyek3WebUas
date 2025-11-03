import wwebjs from 'whatsapp-web.js';
import fs from 'fs';
import path from 'path';
const { Client, LocalAuth } = wwebjs;
import { AppDataSource } from '../data-source.js';
import { log, error } from '../utils/logger.js';
import { normalizeWaId } from '../utils/formating.js';
import { sendAutomationInbound } from '../utils/automation.js';

const clients = new Map();

const SESSIONS_DIR = process.env.WWEBJS_DATA_PATH || process.env.SESSIONS_DIR || null;
const PUPPETEER_EXEC_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || null;
const PUPPETEER_LAUNCH_TIMEOUT = Number(process.env.PUPPETEER_LAUNCH_TIMEOUT_MS || 60000);

async function ensureAccountRow(clientId) {
  const repo = AppDataSource.getRepository('WhatsAppAccount');
  let acc = await repo.findOne({ where: { clientId } });
  if (!acc) {
    acc = repo.create({ clientId, status: 'INITIALIZING' });
    await repo.save(acc);
  }
  return acc;
}

export async function startClient(clientId, options = {}) {
  if (clients.has(clientId)) {
    if (options.forceReconnect) {
      try {
        const old = clients.get(clientId);
        if (old && old.destroy) await old.destroy();
      } catch (e) {
        error(`[${clientId}] error destroying old client before reconnect:`, e && e.message ? e.message : e);
      }
      clients.delete(clientId);
    } else {
      return clients.get(clientId);
    }
  }
  await ensureAccountRow(clientId);

  const accRepo = AppDataSource.getRepository('WhatsAppAccount');
  const existing = await accRepo.findOne({ where: { clientId } });
  const forceReconnect = !!options.forceReconnect;
  if (existing && existing.status === 'DISCONNECTED' && !forceReconnect) {
    throw new Error('Session is DISCONNECTED. Use reconnect to generate QR.');
  }

  const puppeteerOpts = {
    headless: true,
    timeout: PUPPETEER_LAUNCH_TIMEOUT,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-gpu',
    ],
    ...(PUPPETEER_EXEC_PATH ? { executablePath: PUPPETEER_EXEC_PATH } : {}),
    ...(options.puppeteer || {}),
  };

  const client = new Client({
    authStrategy: new LocalAuth({ clientId, dataPath: options.dataPath || SESSIONS_DIR || undefined }),
    puppeteer: puppeteerOpts,
  });

  const repo = accRepo;

  client.on('qr', async (qr) => {
    const acc = await repo.findOne({ where: { clientId } });
    if (acc) {
      acc.status = 'QR';
      acc.lastQr = qr;
      await repo.save(acc);
    }
    log(`[${clientId}] QR received. Scan with your phone.`);
  });

  client.on('loading_screen', (percent, message) => {
    log(`[${clientId}] Loading`, percent, message);
  });

  client.on('authenticated', async () => {
    const acc = await repo.findOne({ where: { clientId } });
    if (acc) {
      acc.status = 'AUTHENTICATED';
      await repo.save(acc);
    }
    log(`[${clientId}] Authenticated.`);
  });

  client.on('ready', async () => {
    const acc = await repo.findOne({ where: { clientId } });
    if (acc) {
      acc.status = 'READY';
      acc.lastConnectedAt = new Date();
      acc.lastQr = null;
      await repo.save(acc);
    }
    log(`[${clientId}] Ready.`);
  });

  client.on('disconnected', async (reason) => {
    error(`[${clientId}] Disconnected:`, reason);
    try {
      await purgeSession(clientId);
      log(`[${clientId}] Session purged after disconnect.`);
    } catch (e) {
      error(`[${clientId}] Failed to purge after disconnect:`, e && e.message ? e.message : e);
    }
  });

  client.on('auth_failure', async (msg) => {
    const acc = await repo.findOne({ where: { clientId } });
    if (acc) {
      acc.status = 'AUTH_FAILURE';
      await repo.save(acc);
    }
    error(`[${clientId}] Authentication failure:`, msg);
  });

  // Inbound messages listener for connection health and auditing
  client.on('message', async (message) => {
    try {
      const acc = await repo.findOne({ where: { clientId } });
      if (acc) {
        acc.lastMessageAt = new Date();
        if (acc.status !== 'READY') acc.status = 'READY';
        await repo.save(acc);
      }

      const mRepo = AppDataSource.getRepository('InboundMessage');
      const row = mRepo.create({
        clientId,
        from: normalizeWaId(message.from),
        to: message.to ? normalizeWaId(message.to) : null,
        body: message.body || '',
        fromMe: !!message.fromMe,
        ts: message.timestamp || null,
      });
      await mRepo.save(row);

      // Simple ping/pong for connectivity check
      const text = (message.body || '').trim().toLowerCase();
      if (!message.fromMe && (text === 'ping' || text === '!ping')) {
        await client.sendMessage(message.from, 'pong');
      }

      // Forward only real inbound messages (not fromMe) to automation webhook if configured
      if (!message.fromMe) {
        try {
          await sendAutomationInbound(clientId, {
            event: 'wa.inbound',
            clientId,
            message: {
              from: normalizeWaId(message.from),
              to: message.to ? normalizeWaId(message.to) : null,
              body: message.body || '',
              fromMe: !!message.fromMe,
              ts: message.timestamp || null,
            },
          });
        } catch (e) {
          // log inside util already; ignore
        }
      }
    } catch (e) {
      error(`[${clientId}] inbound message error:`, e && e.message ? e.message : e);
    }
  });

  await client.initialize();
  clients.set(clientId, client);
  return client;
}

export async function getClient(clientId) {
  if (!clients.has(clientId)) {
    await startClient(clientId);
  }
  return clients.get(clientId);
}

export function listClients() {
  return Array.from(clients.keys());
}

// Helper untuk membuat session baru dan mengembalikan status/QR terkini dari DB
export async function createWhatsAppSession(clientId, options = {}) {
  await startClient(clientId, options);
  const repo = AppDataSource.getRepository('WhatsAppAccount');
  const row = await repo.findOne({ where: { clientId } });
  return row;
}

// Validate whether a phone number is registered on WhatsApp
export async function validateWhatsAppNumber(clientId, input) {
  const client = await getClient(clientId);
  const waId = normalizeWaId(input);
  const number = String(waId).split('@')[0];

  // Prefer getNumberId (returns null if not registered)
  try {
    const result = await client.getNumberId(number);
    if (result) {
      const wid = result._serialized || `${result.user}@${result.server}`;
      return { input: String(input), number, waId, isRegistered: true, wid };
    }
    return { input: String(input), number, waId, isRegistered: false, wid: null };
  } catch (e) {
    // Fallback to isRegisteredUser if available on this version
    try {
      if (typeof client.isRegisteredUser === 'function') {
        const ok = await client.isRegisteredUser(waId);
        return { input: String(input), number, waId, isRegistered: !!ok, wid: ok ? waId : null };
      }
    } catch (_) { /* ignore */ }
    throw e;
  }
}

// Discover stored LocalAuth sessions on disk and return clientIds
export function discoverStoredSessions() {
  const base = SESSIONS_DIR || path.join(process.cwd(), '.wwebjs_auth');
  try {
    if (!fs.existsSync(base)) return [];
    const entries = fs.readdirSync(base, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && e.name.startsWith('session-'))
      .map((e) => e.name.replace(/^session-/, ''))
      .filter(Boolean);
  } catch (e) {
    error('discoverStoredSessions error:', e && e.message ? e.message : e);
    return [];
  }
}

// Start clients for all discovered sessions; returns list of started clientIds
export async function reconnectStoredSessions() {
  const ids = discoverStoredSessions();
  const repo = AppDataSource.getRepository('WhatsAppAccount');
  const started = [];
  for (const id of ids) {
    try {
      // If there is no DB row (purged), skip auto-start.
      const row = await repo.findOne({ where: { clientId: id } });
      if (!row) continue;
      await startClient(id);
      started.push(id);
    } catch (e) {
      error('Failed to reconnect session', id, e && e.message ? e.message : e);
    }
  }
  return started;
}

export async function allowAutoStart(clientId) {
  const repo = AppDataSource.getRepository('WhatsAppAccount');
  const row = await repo.findOne({ where: { clientId } });
  if (!row) return true;
  return row.status !== 'DISCONNECTED';
}

// Explicit reconnect helper that resets state and forces a new client instance.
export async function reconnectSession(clientId, options = {}) {
  const repo = AppDataSource.getRepository('WhatsAppAccount');
  let row = await repo.findOne({ where: { clientId } });
  if (!row) {
    row = repo.create({ clientId, status: 'INITIALIZING' });
  } else {
    row.status = 'INITIALIZING';
    row.lastQr = null;
  }
  await repo.save(row);
  await startClient(clientId, { ...options, forceReconnect: true });
  const updated = await repo.findOne({ where: { clientId } });
  return updated;
}

function getSessionPath(clientId) {
  const base = SESSIONS_DIR || path.join(process.cwd(), '.wwebjs_auth');
  return path.join(base, `session-${clientId}`);
}

export async function purgeSession(clientId) {
  // destroy running client if exists
  try {
    const existing = clients.get(clientId);
    if (existing && existing.destroy) {
      await existing.destroy();
    }
  } catch (e) {
    // ignore
  }
  clients.delete(clientId);

  // remove session folder
  try {
    const sessionPath = getSessionPath(clientId);
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }
  } catch (e) {
    error(`[${clientId}] Failed to remove session folder:`, e && e.message ? e.message : e);
  }

  // delete DB row
  const repo = AppDataSource.getRepository('WhatsAppAccount');
  const row = await repo.findOne({ where: { clientId } });
  if (row) {
    await repo.delete({ clientId });
  }

  return true;
}
