import { MigrationInterface, QueryRunner } from 'typeorm';
import { EmailChangeAndRetention1792700000000 } from './email-change-and-retention.migration';

/**
 * Creates every auth_* table. Add AUTH_MIGRATIONS to your DataSource `migrations` and run them
 * with your usual command. Requires PostgreSQL 13 or newer (for gen_random_uuid()).
 *
 * Deleting a user deletes everything that belongs to them (ON DELETE CASCADE),
 * except audit logs, which are kept as history.
 */
export class CreateAuthTables1792600000000 implements MigrationInterface {
  name = 'CreateAuthTables1792600000000';

  /**
   * Creates every auth_* table, index and constraint.
   *
   * @param database - TypeORM's query runner.
   */
  async up(database: QueryRunner): Promise<void> {
    // ---- People and how they sign in ----

    await database.query(`
      CREATE TABLE auth_users (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email               text CHECK (email = lower(email)),
        email_verified      boolean NOT NULL DEFAULT false,
        phone_number        text CHECK (phone_number ~ '^\\+[1-9][0-9]{7,14}$'),
        phone_verified      boolean NOT NULL DEFAULT false,
        first_name                  text,
        last_name                   text,
        roles                       text[] NOT NULL DEFAULT '{}',
        status                      text NOT NULL DEFAULT 'PENDING_VERIFICATION'
                                      CHECK (status IN ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'DELETED')),
        suspension_reason           text,
        status_changed_at           timestamptz,
        terms_accepted_at           timestamptz,
        privacy_policy_accepted_at  timestamptz,
        onboarding_completed_at     timestamptz,
        two_factor_enabled          boolean NOT NULL DEFAULT false,
        metadata                    jsonb NOT NULL DEFAULT '{}',
        last_signed_in_at           timestamptz,
        created_at                  timestamptz NOT NULL DEFAULT now(),
        updated_at                  timestamptz NOT NULL DEFAULT now(),
        -- Every live account can be reached by email or phone; deleted accounts keep no contact details.
        CONSTRAINT auth_users_has_email_or_phone CHECK (status = 'DELETED' OR email IS NOT NULL OR phone_number IS NOT NULL)
      )`);
    await database.query(`CREATE UNIQUE INDEX auth_users_email_unique ON auth_users (email) WHERE email IS NOT NULL`);
    await database.query(`CREATE UNIQUE INDEX auth_users_phone_unique ON auth_users (phone_number) WHERE phone_number IS NOT NULL`);

    await database.query(`
      CREATE TABLE auth_passwords (
        user_id        uuid PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
        password_hash  text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
        updated_at     timestamptz NOT NULL DEFAULT now()
      )`);

    await database.query(`
      CREATE TABLE auth_social_accounts (
        id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id           uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        provider          text NOT NULL CHECK (provider IN ('google', 'apple', 'facebook')),
        provider_user_id  text NOT NULL,
        email             text,
        created_at        timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT auth_social_accounts_unique UNIQUE (provider, provider_user_id)
      )`);
    await database.query(`CREATE INDEX auth_social_accounts_user ON auth_social_accounts (user_id)`);

    await database.query(`
      CREATE TABLE auth_passkeys (
        id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id        uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        credential_id  text NOT NULL UNIQUE,
        public_key     text NOT NULL,
        sign_count     bigint NOT NULL DEFAULT 0,
        transports     text[] NOT NULL DEFAULT '{}',
        name           text NOT NULL,
        is_backed_up   boolean NOT NULL DEFAULT false,
        created_at     timestamptz NOT NULL DEFAULT now(),
        last_used_at   timestamptz
      )`);
    await database.query(`CREATE INDEX auth_passkeys_user ON auth_passkeys (user_id)`);

    await database.query(`
      CREATE TABLE auth_two_factor_secrets (
        user_id              uuid PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
        encrypted_secret     text NOT NULL,
        confirmed_at         timestamptz,
        last_used_time_step  bigint,
        created_at           timestamptz NOT NULL DEFAULT now()
      )`);

    await database.query(`
      CREATE TABLE auth_backup_codes (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        code_hash   text NOT NULL,
        salt        text NOT NULL,
        used_at     timestamptz,
        created_at  timestamptz NOT NULL DEFAULT now()
      )`);
    await database.query(`CREATE INDEX auth_backup_codes_user ON auth_backup_codes (user_id)`);

    // ---- Sessions and tokens ----

    await database.query(`
      CREATE TABLE auth_organizations (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name                text NOT NULL,
        slug                text NOT NULL UNIQUE,
        metadata            jsonb NOT NULL DEFAULT '{}',
        created_by_user_id  uuid REFERENCES auth_users(id) ON DELETE SET NULL,
        created_at          timestamptz NOT NULL DEFAULT now(),
        updated_at          timestamptz NOT NULL DEFAULT now()
      )`);

    await database.query(`
      CREATE TABLE auth_sessions (
        id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id                 uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        sign_in_method          text NOT NULL,
        used_two_factor         boolean NOT NULL DEFAULT false,
        active_organization_id  uuid REFERENCES auth_organizations(id) ON DELETE SET NULL,
        ip_address              text,
        user_agent              text,
        created_at              timestamptz NOT NULL DEFAULT now(),
        last_used_at            timestamptz NOT NULL DEFAULT now(),
        expires_at              timestamptz NOT NULL,
        revoked_at              timestamptz,
        revoked_reason          text
      )`);
    await database.query(`CREATE INDEX auth_sessions_user_active ON auth_sessions (user_id) WHERE revoked_at IS NULL`);

    await database.query(`
      CREATE TABLE auth_refresh_tokens (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id  uuid NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
        token_hash  text NOT NULL UNIQUE,
        expires_at  timestamptz NOT NULL,
        used_at     timestamptz,
        created_at  timestamptz NOT NULL DEFAULT now()
      )`);
    await database.query(`CREATE INDEX auth_refresh_tokens_session ON auth_refresh_tokens (session_id)`);

    await database.query(`
      CREATE TABLE auth_link_tokens (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        purpose     text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password', 'magic_sign_in')),
        user_id     uuid REFERENCES auth_users(id) ON DELETE CASCADE,
        email       text NOT NULL,
        token_hash  text NOT NULL UNIQUE,
        expires_at  timestamptz NOT NULL,
        used_at     timestamptz,
        created_at  timestamptz NOT NULL DEFAULT now()
      )`);
    await database.query(`CREATE INDEX auth_link_tokens_email ON auth_link_tokens (email, purpose)`);

    await database.query(`
      CREATE TABLE auth_one_time_codes (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        channel          text NOT NULL CHECK (channel IN ('email', 'sms')),
        destination      text NOT NULL,
        code_hash        text NOT NULL,
        salt             text NOT NULL,
        failed_attempts  integer NOT NULL DEFAULT 0,
        expires_at       timestamptz NOT NULL,
        used_at          timestamptz,
        created_at       timestamptz NOT NULL DEFAULT now()
      )`);
    await database.query(`CREATE INDEX auth_one_time_codes_destination ON auth_one_time_codes (channel, destination, created_at DESC)`);

    await database.query(`
      CREATE TABLE auth_sign_in_challenges (
        id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        purpose               text NOT NULL CHECK (purpose IN ('two_factor', 'passkey_registration', 'passkey_sign_in', 'reactivate_account')),
        user_id               uuid REFERENCES auth_users(id) ON DELETE CASCADE,
        challenge_token_hash  text,
        webauthn_challenge    text,
        sign_in_method        text,
        failed_attempts       integer NOT NULL DEFAULT 0,
        expires_at            timestamptz NOT NULL,
        used_at               timestamptz,
        created_at            timestamptz NOT NULL DEFAULT now()
      )`);
    await database.query(
      `CREATE UNIQUE INDEX auth_sign_in_challenges_token ON auth_sign_in_challenges (challenge_token_hash) WHERE challenge_token_hash IS NOT NULL`,
    );

    await database.query(`
      CREATE TABLE auth_signing_keys (
        id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key_id                 text NOT NULL UNIQUE,
        public_key             jsonb NOT NULL,
        encrypted_private_key  text NOT NULL,
        created_at             timestamptz NOT NULL DEFAULT now(),
        retired_at             timestamptz
      )`);
    // Only one key may be in use at a time.
    await database.query(`CREATE UNIQUE INDEX auth_signing_keys_one_current ON auth_signing_keys ((true)) WHERE retired_at IS NULL`);

    // ---- Settings and history ----

    await database.query(`
      CREATE TABLE auth_settings (
        id              integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        changed_values  jsonb NOT NULL,
        changed_by      text NOT NULL,
        updated_at      timestamptz NOT NULL DEFAULT now()
      )`);

    await database.query(`
      CREATE TABLE auth_audit_logs (
        id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id       uuid,
        performed_by  text,
        event_name    text NOT NULL,
        ip_address    text,
        user_agent    text,
        details       jsonb NOT NULL DEFAULT '{}',
        created_at    timestamptz NOT NULL DEFAULT now()
      )`);
    await database.query(`CREATE INDEX auth_audit_logs_created ON auth_audit_logs (created_at DESC)`);
    await database.query(`CREATE INDEX auth_audit_logs_user ON auth_audit_logs (user_id, created_at DESC)`);

    // ---- Organizations ----

    await database.query(`
      CREATE TABLE auth_organization_members (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id  uuid NOT NULL REFERENCES auth_organizations(id) ON DELETE CASCADE,
        user_id          uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        role             text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
        created_at       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT auth_organization_members_unique UNIQUE (organization_id, user_id)
      )`);
    await database.query(`CREATE INDEX auth_organization_members_user ON auth_organization_members (user_id)`);

    await database.query(`
      CREATE TABLE auth_organization_invitations (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id     uuid NOT NULL REFERENCES auth_organizations(id) ON DELETE CASCADE,
        email               text NOT NULL,
        role                text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
        token_hash          text NOT NULL UNIQUE,
        invited_by_user_id  uuid NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
        expires_at          timestamptz NOT NULL,
        accepted_at         timestamptz,
        revoked_at          timestamptz,
        created_at          timestamptz NOT NULL DEFAULT now()
      )`);
    await database.query(`CREATE INDEX auth_organization_invitations_org ON auth_organization_invitations (organization_id)`);

    // ---- Machine access and webhooks ----

    await database.query(`
      CREATE TABLE auth_api_keys (
        id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name                text NOT NULL,
        key_hash            text NOT NULL UNIQUE,
        key_preview         text NOT NULL,
        scopes              text[] NOT NULL DEFAULT '{}',
        organization_id     uuid REFERENCES auth_organizations(id) ON DELETE CASCADE,
        created_by_user_id  uuid REFERENCES auth_users(id) ON DELETE SET NULL,
        created_at          timestamptz NOT NULL DEFAULT now(),
        last_used_at        timestamptz,
        expires_at          timestamptz,
        revoked_at          timestamptz
      )`);

    await database.query(`
      CREATE TABLE auth_webhooks (
        id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        url                       text NOT NULL,
        event_names               text[] NOT NULL DEFAULT '{}',
        encrypted_signing_secret  text NOT NULL,
        is_enabled                boolean NOT NULL DEFAULT true,
        description               text,
        created_at                timestamptz NOT NULL DEFAULT now()
      )`);

    await database.query(`
      CREATE TABLE auth_webhook_deliveries (
        id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        webhook_id            uuid NOT NULL REFERENCES auth_webhooks(id) ON DELETE CASCADE,
        event_name            text NOT NULL,
        payload               jsonb NOT NULL,
        status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'failed')),
        attempt_count         integer NOT NULL DEFAULT 0,
        next_attempt_at       timestamptz NOT NULL DEFAULT now(),
        last_response_status  integer,
        last_error            text,
        created_at            timestamptz NOT NULL DEFAULT now(),
        delivered_at          timestamptz
      )`);
    await database.query(`CREATE INDEX auth_webhook_deliveries_due ON auth_webhook_deliveries (next_attempt_at) WHERE status = 'pending'`);
    await database.query(`CREATE INDEX auth_webhook_deliveries_webhook ON auth_webhook_deliveries (webhook_id, created_at DESC)`);
  }

  /**
   * Drops every auth_* table. All authentication data is lost.
   *
   * @param database - TypeORM's query runner.
   */
  async down(database: QueryRunner): Promise<void> {
    await database.query(`
      DROP TABLE IF EXISTS
        auth_webhook_deliveries, auth_webhooks, auth_api_keys,
        auth_organization_invitations, auth_organization_members,
        auth_audit_logs, auth_settings, auth_signing_keys, auth_sign_in_challenges,
        auth_one_time_codes, auth_link_tokens, auth_refresh_tokens, auth_sessions,
        auth_organizations, auth_backup_codes, auth_two_factor_secrets, auth_passkeys,
        auth_social_accounts, auth_passwords, auth_users`);
  }
}

/** Add these to your TypeORM DataSource `migrations` list (in this order). */
export const AUTH_MIGRATIONS = [CreateAuthTables1792600000000, EmailChangeAndRetention1792700000000];
