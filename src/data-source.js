import 'reflect-metadata';
import { DataSource } from 'typeorm';
import path from 'path';
import { fileURLToPath } from 'url';
import Config from './entities/Config.js';
import WhatsAppAccount from './entities/WhatsAppAccount.js';
import MessageJob from './entities/MessageJob.js';
import Broadcast from './entities/Broadcast.js';
import InboundMessage from './entities/InboundMessage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.SQLITE_PATH && process.env.SQLITE_PATH.trim().length
  ? process.env.SQLITE_PATH
  : path.join(__dirname, '..', 'data', 'db.sqlite');

export const AppDataSource = new DataSource({
  type: 'sqlite',
  database: dbPath,
  entities: [Config, WhatsAppAccount, MessageJob, Broadcast, InboundMessage],
  synchronize: true,
  logging: false,
});
