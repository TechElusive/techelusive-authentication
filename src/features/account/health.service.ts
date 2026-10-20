import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthOptions } from '@/auth-options';
import { RateLimiterService } from '@/common/rate-limiter.service';
import { withTimeout } from '@/common/time';
import { AUTH_OPTIONS_TOKEN, HEALTH_CHECK_QUERY, HEALTH_CHECK_TIMEOUT_MS, HEALTH_STATUS, HealthStatus } from '@/constants';

export interface HealthReport {
  /** True when everything the library needs is reachable. */
  isHealthy: boolean;
  checks: { database: HealthStatus; redis: HealthStatus };
}

/**
 * Answers "can this server sign people in right now?" for load balancers and uptime monitors.
 * Checks only what the library itself needs (PostgreSQL, and Redis when configured).
 */
@Injectable()
export class HealthService {
  private readonly database: DataSource;

  constructor(
    @Inject(AUTH_OPTIONS_TOKEN) options: AuthOptions,
    private readonly rateLimiter: RateLimiterService,
  ) {
    this.database = options.dataSource;
  }

  /**
   * Checks PostgreSQL and (when configured) Redis, each with a short timeout.
   *
   * @returns `isHealthy` plus the result of each check.
   */
  async check(): Promise<HealthReport> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.rateLimiter.checkRedis()]);
    return { isHealthy: database === HEALTH_STATUS.ok && redis !== HEALTH_STATUS.error, checks: { database, redis } };
  }

  /**
   * @returns "ok" when PostgreSQL answers a trivial query in time, otherwise "error".
   */
  private async checkDatabase(): Promise<HealthStatus> {
    try {
      await withTimeout(this.database.query(HEALTH_CHECK_QUERY), HEALTH_CHECK_TIMEOUT_MS);
      return HEALTH_STATUS.ok;
    } catch {
      return HEALTH_STATUS.error;
    }
  }
}
