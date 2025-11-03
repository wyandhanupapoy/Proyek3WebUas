import { EntitySchema } from "typeorm";

const InboundMessage = new EntitySchema({
  name: 'InboundMessage',
  tableName: 'inbound_messages',
  columns: {
    id: { type: Number, primary: true, generated: true },
    clientId: { type: String },
    from: { type: String },
    to: { type: String, nullable: true },
    body: { type: 'text' },
    fromMe: { type: Boolean, default: false },
    ts: { type: Number, nullable: true },
    createdAt: { type: Date, createDate: true },
    updatedAt: { type: Date, updateDate: true },
  },
});

export default InboundMessage;

