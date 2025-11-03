import { Queue, Worker, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import { AppDataSource } from '../data-source.js';
import { fibonacci } from './fibonacci.js';
import { getNumberConfig } from '../config/configService.js';
import { log, error } from '../utils/logger.js';
import { getClient } from '../whatsapp/clientManager.js';
import { normalizeWaId } from '../utils/formating.js';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
export const connection = new IORedis(redisUrl, {
  // BullMQ requires this to be null for blocking commands
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const sendMessageQueue = new Queue('sendMessage', { connection });
export const sendMessageEvents = new QueueEvents('sendMessage', { connection });

// Processor
export const sendMessageWorker = new Worker('sendMessage', async (job) => {
  const repo = AppDataSource.getRepository('MessageJob');
  const jobRow = await repo.findOne({ where: { id: job.data.dbId } });
  if (!jobRow) {
    log('Job row not found for job', job.id);
    return;
  }
  jobRow.status = 'processing';
  await repo.save(jobRow);

  try {
    const client = await getClient(jobRow.clientId);
    await client.sendMessage(normalizeWaId(jobRow.to), jobRow.text);

    jobRow.status = 'sent';
    jobRow.lastError = null;
    await repo.save(jobRow);
    log('Message sent', jobRow.id, normalizeWaId(jobRow.to));
  } catch (e) {
    const baseDelay = await getNumberConfig('SCHEDULER_BASE_DELAY_MS', Number(process.env.SCHEDULER_BASE_DELAY_MS || 1000));
    const maxAttempts = await getNumberConfig('SCHEDULER_MAX_ATTEMPTS', Number(process.env.SCHEDULER_MAX_ATTEMPTS || 3));

    jobRow.attempts += 1;
    jobRow.lastError = String(e && e.message ? e.message : e);

    if (jobRow.attempts < maxAttempts) {
      const delay = fibonacci(jobRow.attempts) * baseDelay;
      jobRow.status = 'queued';
      jobRow.nextRunAt = new Date(Date.now() + delay);
      await repo.save(jobRow);
      await sendMessageQueue.add('send', { dbId: jobRow.id }, { delay });
      log(`Retry scheduled (attempt ${jobRow.attempts}/${maxAttempts}) in ${delay}ms for job ${jobRow.id}`);
    } else {
      jobRow.status = 'failed';
      await repo.save(jobRow);
      error('Message failed after max attempts', jobRow.id, jobRow.to, jobRow.lastError);
    }
  }
}, { connection });

sendMessageWorker.on('failed', (job, err) => {
  // Note: we handle retries manually; this is for logging
  error('Worker error for job', job && job.id, err && err.message);
});

export async function enqueueMessage(dbId, delay = 0) {
  await sendMessageQueue.add('send', { dbId }, { delay });
}
