import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { AuthOptions } from '@/auth-options';
import {
  AUTH_ERRORS,
  AUTH_OPTIONS_TOKEN,
  HEALTH_CHECK_TIMEOUT_MS,
  HEALTH_STATUS,
  HealthStatus,
  IN_MEMORY_RATE_LIMIT_MAX_ENTRIES,
  LOG_CONTEXT,
  PRODUCTION_ENVIRONMENT,
  RateLimitRule,
  RATE_LIMIT_REDIS_KEY_PREFIX,
  SECOND_IN_MILLISECONDS,
} from '@/constants';
import { AuthError } from './auth-error';
import { withTimeout } from './time';

/**
 * Counts attempts per key (an IP address, an email, a user id) inside a time window and blocks
 * once there are too many. Counters live in Redis when `redisUrl` is set (shared by every server),
 * otherwise in this server's memory.
 */
@Injectable()
export class RateLimiterService implements OnModuleDestroy {
  private readonly logger = new Logger(LOG_CONTEXT.rateLimiter);
  private readonly redisClient?: any;
  private readonly countersInMemory = new Map<string, { attempts: number; windowEndsAt: number }>();

  constructor(@Inject(AUTH_OPTIONS_TOKEN) options: AuthOptions) {
    if (options.redisUrl) {
      // Loaded only when Redis is used, so apps without Redis don't need the package installed.
      const Redis = require('ioredis');
      this.redisClient = new Redis(options.redisUrl, { maxRetriesPerRequest: 1 });
    } else if (process.env.NODE_ENV === PRODUCTION_ENVIRONMENT) {
      // Only reachable with singleServer: true (startup validation requires redisUrl otherwise).
      this.logger.log('Rate limits are counted in memory (singleServer: true).');
    }
  }

  /**
   * For the health check: is Redis answering?
   *
   * @returns "ok", "error", or "not_used" when rate limits live in memory.
   */
  async checkRedis(): Promise<HealthStatus> {
    if (!this.redisClient) return HEALTH_STATUS.notUsed;
    try {
      await withTimeout(this.redisClient.ping(), HEALTH_CHECK_TIMEOUT_MS);
      return HEALTH_STATUS.ok;
    } catch {
      return HEALTH_STATUS.error;
    }
  }

  /**
   * Closes the Redis connection when the app shuts down, so the process can exit cleanly.
   */
  async onModuleDestroy() {
    await this.redisClient?.quit();
  }

  /**
   * Records one attempt for `key` and blocks when there have been too many inside the rule's window.
   *
   * @param key - What is being limited, e.g. an IP address, an email or a user id.
   * @param rule - How many attempts are allowed and in how long a window.
   * @throws AuthError TOO_MANY_REQUESTS (with `retryAfterSeconds`) when the limit is exceeded.
   * @example
   * await rateLimiter.consume(`sign-in:ip:${ipAddress}`, RATE_LIMITS.signInPerIp);
   */
  async consume(key: string, rule: RateLimitRule): Promise<void> {
    const secondsToWait = this.redisClient ? await this.countInRedis(key, rule) : this.countInMemory(key, rule);
    if (secondsToWait > 0) throw new AuthError(AUTH_ERRORS.tooManyRequests, { retryAfterSeconds: secondsToWait });
  }

  /**
   * Forgets the attempts for `key`, e.g. the per-account sign-in counter after a successful sign-in.
   *
   * @param key - The same key that was passed to `consume`.
   */
  async reset(key: string): Promise<void> {
    if (this.redisClient) await this.redisClient.del(RATE_LIMIT_REDIS_KEY_PREFIX + key);
    else this.countersInMemory.delete(key);
  }

  /**
   * Counts an attempt in Redis (shared by every server).
   * If Redis is down the request is blocked, rather than allowing unlimited password or code guessing.
   *
   * @param key - What is being limited.
   * @param rule - The limit to apply.
   * @returns 0 when allowed, otherwise the seconds until the window resets.
   */
  private async countInRedis(key: string, rule: RateLimitRule): Promise<number> {
    const redisKey = RATE_LIMIT_REDIS_KEY_PREFIX + key;
    try {
      const attempts: number = await this.redisClient.incr(redisKey);
      if (attempts === 1) await this.redisClient.expire(redisKey, rule.windowSeconds);
      if (attempts <= rule.maximumAttempts) return 0;

      const secondsLeft: number = await this.redisClient.ttl(redisKey);
      if (secondsLeft < 0) {
        // The expiry was lost (e.g. a crash between INCR and EXPIRE); set it so the key can't block forever.
        await this.redisClient.expire(redisKey, rule.windowSeconds);
        return rule.windowSeconds;
      }
      return Math.max(secondsLeft, 1);
    } catch (error) {
      // If Redis is down we block, rather than allow unlimited password or code guessing.
      this.logger.error(`Redis unavailable, blocking request: ${(error as Error).message}`);
      return rule.windowSeconds;
    }
  }

  /**
   * Counts an attempt in this server's memory (used when there is no Redis).
   *
   * @param key - What is being limited.
   * @param rule - The limit to apply.
   * @returns 0 when allowed, otherwise the seconds until the window resets.
   */
  private countInMemory(key: string, rule: RateLimitRule): number {
    const now = Date.now();
    let counter = this.countersInMemory.get(key);
    if (!counter || counter.windowEndsAt <= now) {
      counter = { attempts: 0, windowEndsAt: now + rule.windowSeconds * SECOND_IN_MILLISECONDS };
      this.countersInMemory.set(key, counter);
    }
    counter.attempts += 1;
    this.pruneExpiredCounters(now);
    return counter.attempts > rule.maximumAttempts ? Math.ceil((counter.windowEndsAt - now) / SECOND_IN_MILLISECONDS) : 0;
  }

  /**
   * Removes finished windows once the map gets large, so memory stays bounded on long-running servers.
   *
   * @param now - The current time in milliseconds.
   */
  private pruneExpiredCounters(now: number) {
    const cleanUpThreshold = IN_MEMORY_RATE_LIMIT_MAX_ENTRIES;
    if (this.countersInMemory.size < cleanUpThreshold) return;
    for (const [key, counter] of this.countersInMemory) {
      if (counter.windowEndsAt <= now) this.countersInMemory.delete(key);
    }
  }
}
