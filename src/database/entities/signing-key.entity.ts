import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Keys that sign tokens. The private half is stored encrypted (AWS KMS in production). */
@Entity('auth_signing_keys')
export class SigningKeyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Key id, put in every token header so verifiers know which public key to use. */
  @Index({ unique: true })
  @Column({ name: 'key_id', type: 'text' })
  keyId: string;

  @Column({ name: 'public_key', type: 'jsonb' })
  publicKey: Record<string, string>;

  @Column({ name: 'encrypted_private_key', type: 'text' })
  encryptedPrivateKey: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  /** Null for the key in use. Retired keys stay published for a while so older tokens still verify. */
  @Column({ name: 'retired_at', type: 'timestamptz', nullable: true })
  retiredAt: Date | null;
}
