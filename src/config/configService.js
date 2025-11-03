import { AppDataSource } from '../data-source.js';
import { log } from '../utils/logger.js';

export async function getConfig(key, defaultValue = null) {
  const repo = AppDataSource.getRepository('Config');
  let row = await repo.findOne({ where: { key } });
  if (!row) return defaultValue;
  return row.value ?? defaultValue;
}

export async function setConfig(key, value) {
  const repo = AppDataSource.getRepository('Config');
  let row = await repo.findOne({ where: { key } });
  if (!row) row = repo.create({ key, value });
  else row.value = value;
  await repo.save(row);
  log('Config set', key, '=>', value);
  return row;
}

export async function getNumberConfig(key, defaultValue) {
  const val = await getConfig(key, null);
  if (val === null || val === undefined) return defaultValue;
  const num = Number(val);
  return Number.isFinite(num) ? num : defaultValue;
}

