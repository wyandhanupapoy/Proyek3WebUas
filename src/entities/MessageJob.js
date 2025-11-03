import { EntitySchema } from "typeorm";

const MessageJob = new EntitySchema({
  name: 'MessageJob',
  tableName: 'message_jobs',
  columns: {
    id: { type: Number, primary: true, generated: true },
    clientId: { type: String },
    to: { type: String },
    text: { type: 'text' },
    status: { type: String, default: 'queued' }, // queued|processing|sent|failed
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 8 },
    nextRunAt: { type: Date, nullable: true },
    lastError: { type: 'text', nullable: true },
    broadcastId: { type: Number, nullable: true },
    createdAt: { type: Date, createDate: true },
    updatedAt: { type: Date, updateDate: true },
  },
});

export default MessageJob;

