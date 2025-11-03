import { EntitySchema } from "typeorm";

const Config = new EntitySchema({
  name: 'Config',
  tableName: 'configs',
  columns: {
    id: { type: Number, primary: true, generated: true },
    key: { type: String, unique: true },
    value: { type: 'text', nullable: true },
    createdAt: { type: Date, createDate: true },
    updatedAt: { type: Date, updateDate: true },
  },
});

export default Config;

