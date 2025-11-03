import express from 'express';
import swaggerUi from 'swagger-ui-express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { AppDataSource } from './data-source.js';
import { enqueueMessage } from './queue/queues.js';
import { startClient, createWhatsAppSession, reconnectSession, purgeSession, validateWhatsAppNumber } from './whatsapp/clientManager.js';
import { setConfig, getConfig } from './config/configService.js';
import { ok, created, badRequest, unauthorized, notFound, conflict } from './utils/response.js';
import { setAutomationConfig, getAutomationConfig } from './utils/automation.js';

export function createServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (req, res) => ok(res, { ok: true }, 'Service healthy'));

  // Swagger/OpenAPI
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  let spec;
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'docs', 'openapi.json'), 'utf8');
    spec = JSON.parse(raw);
  } catch (e) {
    spec = { openapi: '3.0.3', info: { title: 'WA Service API', version: '0.1.0' }, paths: {} };
  }
  app.get('/openapi.json', (req, res) => res.json(spec));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));

  // API key protection for all routes except health/docs/openapi
  let cachedApiKey = process.env.API_KEY || null;
  const ensureApiKeyLoaded = async () => {
    if (!cachedApiKey) {
      try { cachedApiKey = await getConfig('API_KEY', null); } catch { }
    }
  };
  app.use(async (req, res, next) => {
    const p = req.path || '';
    // Allow docs/health, and let /automation/reply do its own auth via secret
    if (p === '/health' || p === '/openapi.json' || p.startsWith('/docs') || p === '/automation/reply') return next();
    await ensureApiKeyLoaded();
    const expected = cachedApiKey;
    if (!expected) return unauthorized(res, 'Missing API key configuration');
    const provided = req.header('x-api-key');
    if (provided !== expected) return unauthorized(res, 'Invalid API key');
    next();
  });

  app.get('/accounts', async (req, res) => {
    const repo = AppDataSource.getRepository('WhatsAppAccount');
    const rows = await repo.find({ order: { id: 'ASC' } });
    ok(res, rows, 'Accounts');
  });

  app.post('/accounts/:clientId/start', async (req, res) => {
    const { clientId } = req.params;
    const repo = AppDataSource.getRepository('WhatsAppAccount');
    const row = await repo.findOne({ where: { clientId } });
    if (row && row.status === 'DISCONNECTED') {
      return conflict(res, 'Session is DISCONNECTED. Use /accounts/{clientId}/reconnect to generate QR.');
    }
    try {
      await startClient(clientId);
    } catch (e) {
      return badRequest(res, String(e && e.message ? e.message : e));
    }
    const updated = await repo.findOne({ where: { clientId } });
    ok(res, updated, 'Client started');
  });

  // Explicit reconnect trigger to generate QR even if previously DISCONNECTED
  app.post('/accounts/:clientId/reconnect', async (req, res) => {
    const { clientId } = req.params;
    try {
      const updated = await reconnectSession(clientId, {});
      ok(res, updated, 'Reconnected');
    } catch (e) {
      return badRequest(res, String(e && e.message ? e.message : e));
    }
  });

  // Create a session (alias): body can include puppeteer/dataPath overrides
  app.post('/sessions', async (req, res) => {
    const { clientId, dataPath, puppeteer } = req.body || {};
    if (!clientId) return badRequest(res, 'clientId required');
    const repo = AppDataSource.getRepository('WhatsAppAccount');
    const existing = await repo.findOne({ where: { clientId } });
    if (existing && existing.status === 'DISCONNECTED') {
      return conflict(res, 'Session is DISCONNECTED. Use /accounts/{clientId}/reconnect to generate QR.');
    }
    const row = await createWhatsAppSession(clientId, { dataPath, puppeteer });
    created(res, row, 'Session created');
  });

  // Alias reconnect under /sessions for convenience
  app.post('/sessions/:clientId/reconnect', async (req, res) => {
    const { clientId } = req.params;
    const { dataPath, puppeteer } = req.body || {};
    try {
      const updated = await reconnectSession(clientId, { dataPath, puppeteer });
      ok(res, updated, 'Reconnected');
    } catch (e) {
      return badRequest(res, String(e && e.message ? e.message : e));
    }
  });

  app.get('/accounts/:clientId/qr', async (req, res) => {
    const { clientId } = req.params;
    const repo = AppDataSource.getRepository('WhatsAppAccount');
    const row = await repo.findOne({ where: { clientId } });
    if (!row || !row.lastQr) return notFound(res, 'No QR yet');
    ok(res, { clientId, qr: row.lastQr }, 'QR found');
  });

  // Validate whether a number is registered on WhatsApp
  app.get('/accounts/:clientId/validate-number', async (req, res) => {
    const { clientId } = req.params;
    const input = String(req.query.number || req.query.phone || req.query.to || '').trim();
    if (!input) return badRequest(res, 'Query param number/phone/to is required');
    try {
      await startClient(clientId);
      const result = await validateWhatsAppNumber(clientId, input);
      ok(res, result, 'Validation result');
    } catch (e) {
      return badRequest(res, String(e && e.message ? e.message : e));
    }
  });

  // Set config key/value in DB
  app.post('/config', async (req, res) => {
    const { key, value } = req.body || {};
    if (!key) return badRequest(res, 'key required');
    const row = await setConfig(key, String(value));
    ok(res, row, 'Config saved');
  });

  app.get('/config/:key', async (req, res) => {
    const value = await getConfig(req.params.key, null);
    if (value === null) return notFound(res, 'not found');
    ok(res, { key: req.params.key, value }, 'Config');
  });

  // Schedule single message
  app.post('/messages', async (req, res) => {
    const { clientId, to, text, maxAttempts } = req.body || {};
    if (!clientId || !to || !text) return badRequest(res, 'clientId, to, text required');
    await startClient(clientId);

    const repo = AppDataSource.getRepository('MessageJob');
    const jobRow = repo.create({ clientId, to, text, status: 'queued', attempts: 0, maxAttempts: maxAttempts || undefined });
    await repo.save(jobRow);
    await enqueueMessage(jobRow.id, 0);
    created(res, { id: jobRow.id, status: jobRow.status }, 'Message queued');
  });

  app.get('/jobs/:id', async (req, res) => {
    const repo = AppDataSource.getRepository('MessageJob');
    const jobRow = await repo.findOne({ where: { id: Number(req.params.id) } });
    if (!jobRow) return notFound(res, 'not found');
    ok(res, jobRow, 'Job');
  });

  // Automation settings (protected by API key)
  app.get('/automation/config/:clientId', async (req, res) => {
    const { clientId } = req.params;
    const cfg = await getAutomationConfig(clientId);
    ok(res, { clientId, ...cfg }, 'Automation config');
  });

  app.post('/automation/config', async (req, res) => {
    const { clientId, webhookUrl, secret } = req.body || {};
    if (!clientId && webhookUrl === undefined && secret === undefined) {
      return badRequest(res, 'Provide clientId (optional) and at least one of webhookUrl/secret');
    }
    const cfg = await setAutomationConfig(clientId || null, { webhookUrl, secret });
    ok(res, { clientId: clientId || null, ...cfg }, 'Automation config saved');
  });

  // Automation reply webhook (protected by x-automation-secret)
  app.post('/automation/reply', async (req, res) => {
    const { clientId, to, text, maxAttempts } = req.body || {};
    if (!clientId || !to || !text) return badRequest(res, 'clientId, to, text required');

    const { secret } = await getAutomationConfig(clientId);
    const provided = req.header('x-automation-secret');
    if (!secret || provided !== String(secret)) return unauthorized(res, 'Invalid automation secret');

    try {
      await startClient(clientId);
      const repo = AppDataSource.getRepository('MessageJob');
      const jobRow = repo.create({ clientId, to, text, status: 'queued', attempts: 0, maxAttempts: maxAttempts || undefined });
      await repo.save(jobRow);
      await enqueueMessage(jobRow.id, 0);
      created(res, { id: jobRow.id, status: jobRow.status }, 'Automation reply queued');
    } catch (e) {
      return badRequest(res, String(e && e.message ? e.message : e));
    }
  });

  // Inbound messages viewer (for debugging/monitoring)
  app.get('/inbound', async (req, res) => {
    const { clientId, limit } = req.query;
    const repo = AppDataSource.getRepository('InboundMessage');
    const take = Math.min(Number(limit || 50), 200);
    const where = clientId ? { clientId: String(clientId) } : {};
    const rows = await repo.find({ where, order: { id: 'DESC' }, take });
    ok(res, rows, 'Inbound messages');
  });

  // Broadcast: create campaign and enqueue per-recipient jobs
  app.post('/broadcasts', async (req, res) => {
    const { clientId, name, text, recipients } = req.body || {};
    if (!clientId || !text || !Array.isArray(recipients) || recipients.length === 0) {
      return badRequest(res, 'clientId, text, recipients[] required');
    }
    await startClient(clientId);

    const bRepo = AppDataSource.getRepository('Broadcast');
    const mRepo = AppDataSource.getRepository('MessageJob');
    const broadcast = bRepo.create({ clientId, name: name || `Broadcast ${new Date().toISOString()}`, text, status: 'queued' });
    await bRepo.save(broadcast);

    for (const to of recipients) {
      const jobRow = mRepo.create({ clientId, to, text, status: 'queued', attempts: 0, broadcastId: broadcast.id });
      await mRepo.save(jobRow);
      await enqueueMessage(jobRow.id, 0);
    }

    broadcast.status = 'sending';
    await bRepo.save(broadcast);
    created(res, { id: broadcast.id, status: broadcast.status, recipients: recipients.length }, 'Broadcast created');
  });

  app.get('/broadcasts/:id', async (req, res) => {
    const id = Number(req.params.id);
    const bRepo = AppDataSource.getRepository('Broadcast');
    const mRepo = AppDataSource.getRepository('MessageJob');
    const broadcast = await bRepo.findOne({ where: { id } });
    if (!broadcast) return notFound(res, 'not found');
    const jobs = await mRepo.find({ where: { broadcastId: id } });
    const sent = jobs.filter(j => j.status === 'sent').length;
    const failed = jobs.filter(j => j.status === 'failed').length;
    const processing = jobs.filter(j => j.status === 'processing').length;
    const queued = jobs.filter(j => j.status === 'queued').length;
    ok(res, { ...broadcast, stats: { queued, processing, sent, failed } }, 'Broadcast');
  });

  // Delete a session entirely: stop client, remove LocalAuth, and remove DB row
  app.delete('/accounts/:clientId', async (req, res) => {
    const { clientId } = req.params;
    try {
      await purgeSession(clientId);
      ok(res, { ok: true }, 'Session purged');
    } catch (e) {
      badRequest(res, String(e && e.message ? e.message : e));
    }
  });

  // Alias endpoint under /sessions for clarity
  app.delete('/sessions/:clientId', async (req, res) => {
    const { clientId } = req.params;
    try {
      await purgeSession(clientId);
      ok(res, { ok: true }, 'Session purged');
    } catch (e) {
      badRequest(res, String(e && e.message ? e.message : e));
    }
  });

  return app;
}
