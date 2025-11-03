import { EntitySchema } from "typeorm";

const WhatsAppAccount = new EntitySchema({
  name: 'WhatsAppAccount',
  tableName: 'wa_accounts',
  columns: {
    id: { type: Number, primary: true, generated: true },
    clientId: { type: String, unique: true },
    status: { type: String, default: 'INITIALIZING' },
    lastConnectedAt: { type: Date, nullable: true },
    lastDisconnectedAt: { type: Date, nullable: true },
    lastMessageAt: { type: Date, nullable: true },
    lastQr: { type: 'text', nullable: true },
    createdAt: { type: Date, createDate: true },
    updatedAt: { type: Date, updateDate: true },
  },
});

export default WhatsAppAccount;
