import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Version 0.2:
 * - emailed links can also confirm an email change ("change_email"),
 * - indexes so the data-retention cleanup finds old rows without scanning whole tables.
 *
 * TypeORM runs migrations inside a transaction, so the indexes are not built CONCURRENTLY. On very
 * large existing tables, build them CONCURRENTLY yourself first (same names); IF NOT EXISTS then
 * skips them here.
 */
export class EmailChangeAndRetention1792700000000 implements MigrationInterface {
  name = 'EmailChangeAndRetention1792700000000';

  /**
   * Allows "change_email" links and adds the indexes the data-retention cleanup uses.
   *
   * @param database - TypeORM's query runner.
   */
  async up(database: QueryRunner): Promise<void> {
    await database.query(`ALTER TABLE auth_link_tokens DROP CONSTRAINT IF EXISTS auth_link_tokens_purpose_check`);
    await database.query(`
      ALTER TABLE auth_link_tokens ADD CONSTRAINT auth_link_tokens_purpose_check
        CHECK (purpose IN ('verify_email', 'reset_password', 'magic_sign_in', 'change_email'))`);
    await database.query(`CREATE INDEX IF NOT EXISTS auth_link_tokens_user ON auth_link_tokens (user_id, purpose) WHERE used_at IS NULL`);

    await database.query(`CREATE INDEX IF NOT EXISTS auth_sessions_expires ON auth_sessions (expires_at)`);
    await database.query(`CREATE INDEX IF NOT EXISTS auth_sessions_revoked ON auth_sessions (revoked_at) WHERE revoked_at IS NOT NULL`);
    await database.query(`CREATE INDEX IF NOT EXISTS auth_refresh_tokens_expires ON auth_refresh_tokens (expires_at)`);
    await database.query(`CREATE INDEX IF NOT EXISTS auth_link_tokens_expires ON auth_link_tokens (expires_at)`);
    await database.query(`CREATE INDEX IF NOT EXISTS auth_one_time_codes_expires ON auth_one_time_codes (expires_at)`);
    await database.query(`CREATE INDEX IF NOT EXISTS auth_sign_in_challenges_expires ON auth_sign_in_challenges (expires_at)`);
    await database.query(`CREATE INDEX IF NOT EXISTS auth_organization_invitations_expires ON auth_organization_invitations (expires_at)`);
    await database.query(
      `CREATE INDEX IF NOT EXISTS auth_webhook_deliveries_finished ON auth_webhook_deliveries (created_at) WHERE status <> 'pending'`,
    );
  }

  /**
   * Removes those indexes and deletes any "change_email" links.
   *
   * @param database - TypeORM's query runner.
   */
  async down(database: QueryRunner): Promise<void> {
    await database.query(`
      DROP INDEX IF EXISTS
        auth_webhook_deliveries_finished, auth_organization_invitations_expires, auth_sign_in_challenges_expires,
        auth_one_time_codes_expires, auth_link_tokens_expires, auth_refresh_tokens_expires,
        auth_sessions_revoked, auth_sessions_expires, auth_link_tokens_user`);
    await database.query(`DELETE FROM auth_link_tokens WHERE purpose = 'change_email'`);
    await database.query(`ALTER TABLE auth_link_tokens DROP CONSTRAINT IF EXISTS auth_link_tokens_purpose_check`);
    await database.query(`
      ALTER TABLE auth_link_tokens ADD CONSTRAINT auth_link_tokens_purpose_check
        CHECK (purpose IN ('verify_email', 'reset_password', 'magic_sign_in'))`);
  }
}
