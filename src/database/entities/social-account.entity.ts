import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { SocialProvider } from '@/constants';
export type { SocialProvider };

/** A Google, Apple or Facebook account linked to a user. One user can link several. */
@Entity('auth_social_accounts')
@Index(['provider', 'providerUserId'], { unique: true })
export class SocialAccountEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'text' })
  provider: SocialProvider;

  /** The provider's id for this person (Google "sub", Apple "sub", Facebook user id). Never changes. */
  @Column({ name: 'provider_user_id', type: 'text' })
  providerUserId: string;

  /** Email the provider reported when linked (for display only). */
  @Column({ type: 'text', nullable: true })
  email: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
