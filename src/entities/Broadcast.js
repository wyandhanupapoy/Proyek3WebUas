import { EntitySchema } from "typeorm";

const Broadcast = new EntitySchema({
  name: 'Broadcast',
  tableName: 'broadcasts',
  columns: {
    id: { type: Number, primary: true, generated: true },
    name: { type: String },
    text: { type: 'text' },
    clientId: { type: String },
    status: { type: String, default: 'queued' }, // queued|sending|done|failed
    createdAt: { type: Date, createDate: true },
    updatedAt: { type: Date, updateDate: true },
  },
});

export default Broadcast;

