import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import { AuthOptions } from '@/auth-options';
import {
  AUTH_OPTIONS_TOKEN,
  DATA_RETENTION_BATCH_CONDITION,
  DATA_RETENTION_BATCH_SIZE,
  DATA_RETENTION_FIRST_RUN_DELAY_MS,
  DATA_RETENTION_INTERVAL_MS,
  DATA_RETENTION_MAX_BATCHES_PER_TABLE,
  DATA_RETENTION_OLD_ROW_CONDITION,
  DATA_RETENTION_STEP,
  DataRetentionStep,
  DAY_IN_SECONDS,
  LOG_CONTEXT,
  SECOND_IN_MILLISECONDS,
} from '@/constants';
import {
  AuditLogEntity,
  LinkTokenEntity,
  OneTimeCodeEntity,
  OrganizationInvitationEntity,
  RefreshTokenEntity,
  SessionEntity,
  SignInChallengeEntity,
  WebhookDeliveryEntity,
} from '@/database/entities';
import { SettingsService } from '@/features/settings/settings.service';
import { AuthSettings } from '@/features/settings/settings.types';

/** How many rows each cleanup step removed. */
export type DataRetentionReport = Record<DataRetentionStep, number>;

/** One kind of old row: which table, and how long to keep it (the SQL is in DATA_RETENTION_OLD_ROW_CONDITION). */
interface CleanupStep {
  step: DataRetentionStep;
  entity: EntityTarget<ObjectLiteral>;
  /** Days to keep, from settings. 0 = this step is switched off. */
  keepDays: (settings: AuthSettings) => number;
}

/**
 * Deletes rows nobody needs any more, so tables don't grow forever:
 *
 * | What                                             | Kept for (settings.retention) |
 * |--------------------------------------------------|-------------------------------|
 * | ended sessions (+ their refresh tokens)          | expiredRecordDays (7)         |
 * | expired refresh tokens of active sessions        | expiredRecordDays             |
 * | used/expired email links, codes, 2FA challenges  | expiredRecordDays             |
 * | accepted/cancelled/expired invitations           | expiredRecordDays             |
 * | delivered or failed webhook deliveries           | webhookDeliveryDays (30)      |
 * | audit log entries                                | auditLogDays (365, 0=forever) |
 *
 * Runs every hour on every server. Several servers running it at once is harmless: each deletes
 * in small batches, and a row already deleted by one is simply not found by the other.
 * Users, organizations, passkeys and other live data are never touched.
 */
@Injectable()
export class DataRetentionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LOG_CONTEXT.dataRetention);
  private readonly database: DataSource;
  private firstRunTimer?: NodeJS.Timeout;
  private intervalTimer?: NodeJS.Timeout;
  private isRunning = false;

  private readonly steps: CleanupStep[] = [
    {
      step: DATA_RETENTION_STEP.endedSessions,
      entity: SessionEntity,
      keepDays: (settings) => settings.retention.expiredRecordDays,
    },
    {
      step: DATA_RETENTION_STEP.expiredRefreshTokens,
      entity: RefreshTokenEntity,
      keepDays: (settings) => settings.retention.expiredRecordDays,
    },
    {
      step: DATA_RETENTION_STEP.linkTokens,
      entity: LinkTokenEntity,
      keepDays: (settings) => settings.retention.expiredRecordDays,
    },
    {
      step: DATA_RETENTION_STEP.oneTimeCodes,
      entity: OneTimeCodeEntity,
      keepDays: (settings) => settings.retention.expiredRecordDays,
    },
    {
      step: DATA_RETENTION_STEP.signInChallenges,
      entity: SignInChallengeEntity,
      keepDays: (settings) => settings.retention.expiredRecordDays,
    },
    {
      step: DATA_RETENTION_STEP.organizationInvitations,
      entity: OrganizationInvitationEntity,
      keepDays: (settings) => settings.retention.expiredRecordDays,
    },
    {
      step: DATA_RETENTION_STEP.webhookDeliveries,
      entity: WebhookDeliveryEntity,
      keepDays: (settings) => settings.retention.webhookDeliveryDays,
    },
    {
      step: DATA_RETENTION_STEP.auditLog,
      entity: AuditLogEntity,
      keepDays: (settings) => settings.retention.auditLogDays,
    },
  ];

  constructor(
    @Inject(AUTH_OPTIONS_TOKEN) options: AuthOptions,
    private readonly settingsService: SettingsService,
  ) {
    this.database = options.dataSource;
  }

  /**
   * Schedules the first cleanup shortly after start-up, then one every hour.
   */
  onApplicationBootstrap() {
    this.firstRunTimer = setTimeout(() => void this.runScheduledCleanup(), DATA_RETENTION_FIRST_RUN_DELAY_MS);
    this.intervalTimer = setInterval(() => void this.runScheduledCleanup(), DATA_RETENTION_INTERVAL_MS);
    // Timers never keep the process alive on shutdown.
    this.firstRunTimer.unref();
    this.intervalTimer.unref();
  }

  /**
   * Stops the timers when the app shuts down.
   */
  onModuleDestroy() {
    if (this.firstRunTimer) clearTimeout(this.firstRunTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
  }

  /**
   * Runs every cleanup step now. Works even when the automatic cleanup is turned off,
   * so you can call it from your own scheduled job.
   *
   * @returns How many rows each step removed.
   */
  async runCleanup(): Promise<DataRetentionReport> {
    const settings = await this.settingsService.getSettings();
    const report = Object.fromEntries(this.steps.map(({ step }) => [step, 0])) as DataRetentionReport;
    for (const step of this.steps) {
      const keepDays = step.keepDays(settings);
      if (keepDays <= 0) continue;
      report[step.step] = await this.deleteOldRows(step, new Date(Date.now() - keepDays * DAY_IN_SECONDS * SECOND_IN_MILLISECONDS));
    }
    return report;
  }

  /**
   * The hourly run: skipped when retention is turned off or a run is still going.
   * Errors are logged, never thrown.
   */
  private async runScheduledCleanup(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      if (!(await this.settingsService.getSettings()).retention.enabled) return;
      const report = await this.runCleanup();
      const removedRows = Object.values(report).reduce((total, count) => total + count, 0);
      if (removedRows > 0) this.logger.log(`Removed ${removedRows} old rows: ${JSON.stringify(report)}`);
    } catch (error) {
      this.logger.error(`Cleanup failed: ${(error as Error).message}`);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Deletes matching rows in batches (short statements, short locks).
   *
   * @param step - Which table and which rows count as old.
   * @param cutoff - Rows older than this are deleted.
   * @returns How many rows were deleted.
   */
  private async deleteOldRows(step: CleanupStep, cutoff: Date): Promise<number> {
    const tableName = this.database.getMetadata(step.entity).tableName;
    let removedRows = 0;
    for (let batch = 0; batch < DATA_RETENTION_MAX_BATCHES_PER_TABLE; batch++) {
      const result = await this.database
        .createQueryBuilder()
        .delete()
        .from(step.entity)
        .where(DATA_RETENTION_BATCH_CONDITION(tableName, DATA_RETENTION_OLD_ROW_CONDITION[step.step]), {
          cutoff,
          batchSize: DATA_RETENTION_BATCH_SIZE,
        })
        .execute();
      const deletedInBatch = result.affected ?? 0;
      removedRows += deletedInBatch;
      if (deletedInBatch < DATA_RETENTION_BATCH_SIZE) break;
    }
    return removedRows;
  }
}
