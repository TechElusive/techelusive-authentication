import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** A user's password, stored only as an Argon2id hash. */
@Entity('auth_passwords')
export class PasswordEntity {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'password_hash', type: 'text' })
  passwordHash: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
