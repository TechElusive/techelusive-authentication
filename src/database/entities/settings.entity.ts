import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Settings changed at runtime by admins. One row (id = 1). No row = use the settings in code. */
@Entity('auth_settings')
export class SettingsEntity {
  @PrimaryColumn({ type: 'int', default: 1 })
  id: number;

  @Column({ name: 'changed_values', type: 'jsonb' })
  changedValues: Record<string, any>;

  @Column({ name: 'changed_by', type: 'text' })
  changedBy: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
