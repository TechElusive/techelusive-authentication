import { ApiKeyEntity } from './api-key.entity';
import { AuditLogEntity } from './audit-log.entity';
import { BackupCodeEntity } from './backup-code.entity';
import { LinkTokenEntity } from './link-token.entity';
import { OneTimeCodeEntity } from './one-time-code.entity';
import { OrganizationInvitationEntity } from './organization-invitation.entity';
import { OrganizationMemberEntity } from './organization-member.entity';
import { OrganizationEntity } from './organization.entity';
import { PasskeyEntity } from './passkey.entity';
import { PasswordEntity } from './password.entity';
import { RefreshTokenEntity } from './refresh-token.entity';
import { SessionEntity } from './session.entity';
import { SettingsEntity } from './settings.entity';
import { SignInChallengeEntity } from './sign-in-challenge.entity';
import { SigningKeyEntity } from './signing-key.entity';
import { SocialAccountEntity } from './social-account.entity';
import { TwoFactorSecretEntity } from './two-factor-secret.entity';
import { UserEntity } from './user.entity';
import { WebhookDeliveryEntity } from './webhook-delivery.entity';
import { WebhookEntity } from './webhook.entity';

export * from './api-key.entity';
export * from './json-object';
export * from './audit-log.entity';
export * from './backup-code.entity';
export * from './link-token.entity';
export * from './one-time-code.entity';
export * from './organization-invitation.entity';
export * from './organization-member.entity';
export * from './organization.entity';
export * from './passkey.entity';
export * from './password.entity';
export * from './refresh-token.entity';
export * from './session.entity';
export * from './settings.entity';
export * from './sign-in-challenge.entity';
export * from './signing-key.entity';
export * from './social-account.entity';
export * from './two-factor-secret.entity';
export * from './user.entity';
export * from './webhook-delivery.entity';
export * from './webhook.entity';

/** Add these to your TypeORM DataSource `entities` list. */
export const AUTH_ENTITIES = [
  UserEntity,
  PasswordEntity,
  SocialAccountEntity,
  PasskeyEntity,
  TwoFactorSecretEntity,
  BackupCodeEntity,
  SessionEntity,
  RefreshTokenEntity,
  LinkTokenEntity,
  OneTimeCodeEntity,
  SignInChallengeEntity,
  SigningKeyEntity,
  SettingsEntity,
  AuditLogEntity,
  OrganizationEntity,
  OrganizationMemberEntity,
  OrganizationInvitationEntity,
  ApiKeyEntity,
  WebhookEntity,
  WebhookDeliveryEntity,
];
