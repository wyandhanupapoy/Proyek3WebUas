import { AppDataSource } from '../data-source.js';
import { log, error } from './logger.js';

const WEBHOOK_PREFIX = 'AUTO_WEBHOOK_';
const SECRET_PREFIX = 'AUTO_SECRET_';
const GLOBAL_WEBHOOK = 'AUTO_WEBHOOK';
const GLOBAL_SECRET = 'AUTO_SECRET';

async function getConfigRepo() {
  return AppDataSource.getRepository('Config');
}

export async function setAutomationConfig(clientId, { webhookUrl, secret }) {
  const repo = await getConfigRepo();
  const saves = [];
  if (webhookUrl !== undefined) {
    let row = await repo.findOne({ where: { key: clientId ? WEBHOOK_PREFIX + clientId : GLOBAL_WEBHOOK } });
    if (!row) row = repo.create({ key: clientId ? WEBHOOK_PREFIX + clientId : GLOBAL_WEBHOOK, value: webhookUrl });
    else row.value = webhookUrl;
    saves.push(repo.save(row));
  }
  if (secret !== undefined) {
    let row = await repo.findOne({ where: { key: clientId ? SECRET_PREFIX + clientId : GLOBAL_SECRET } });
    if (!row) row = repo.create({ key: clientId ? SECRET_PREFIX + clientId : GLOBAL_SECRET, value: secret });
    else row.value = secret;
    saves.push(repo.save(row));
  }
  await Promise.all(saves);
  return getAutomationConfig(clientId);
}

export async function getAutomationConfig(clientId) {
  const repo = await getConfigRepo();
  const keys = [
    { k: clientId ? WEBHOOK_PREFIX + clientId : GLOBAL_WEBHOOK, type: 'webhook' },
    { k: clientId ? SECRET_PREFIX + clientId : GLOBAL_SECRET, type: 'secret' },
  ];
  const out = { webhookUrl: null, secret: null };
  for (const { k, type } of keys) {
    const row = await repo.findOne({ where: { key: k } });
    if (row && row.value) out[type === 'webhook' ? 'webhookUrl' : 'secret'] = row.value;
  }
  // fallback to global if per-client not found
  if (clientId && !out.webhookUrl) {
    const row = await repo.findOne({ where: { key: GLOBAL_WEBHOOK } });
    if (row && row.value) out.webhookUrl = row.value;
  }
  if (clientId && !out.secret) {
    const row = await repo.findOne({ where: { key: GLOBAL_SECRET } });
    if (row && row.value) out.secret = row.value;
  }
  return out;
}

export async function sendAutomationInbound(clientId, payload) {
  try {
    const { webhookUrl, secret } = await getAutomationConfig(clientId);
    if (!webhookUrl) return false;

    const headers = { 'content-type': 'application/json' };
    if (secret) headers['x-automation-secret'] = String(secret);

    if (typeof fetch !== 'function') {
      error('fetch is not available in this Node.js runtime');
      return false;
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    const ok = res.ok;
    if (!ok) {
      const text = await res.text().catch(() => '');
      error('Automation webhook responded non-2xx', res.status, text);
    }
    return ok;
  } catch (e) {
    error('Failed sending to automation webhook:', e && e.message ? e.message : e);
    return false;
  }
}

