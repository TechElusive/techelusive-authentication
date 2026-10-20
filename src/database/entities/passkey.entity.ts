import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** A passkey (Face ID, Touch ID, Windows Hello, security key) registered by a user. */
@Entity('auth_passkeys')
export class PasskeyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** The id the device gave this passkey (base64url). */
  @Index({ unique: true })
  @Column({ name: 'credential_id', type: 'text' })
  credentialId: string;

  /** The passkey's public key (base64url). The private key never leaves the user's device. */
  @Column({ name: 'public_key', type: 'text' })
  publicKey: string;

  /** Signature counter; if it goes backwards the passkey may have been cloned. */
  @Column({ name: 'sign_count', type: 'bigint', default: 0, transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  signCount: number;

  /** How the device talks to the browser, e.g. ["internal", "hybrid"]. */
  @Column({ type: 'text', array: true, default: '{}' })
  transports: string[];

  /** Name the user gave it, e.g. "My iPhone". */
  @Column({ type: 'text' })
  name: string;

  /** True when the passkey is synced (iCloud Keychain, Google Password Manager). */
  @Column({ name: 'is_backed_up', type: 'boolean', default: false })
  isBackedUp: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;
}
