import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.module';

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the window resets (for Retry-After). */
  retryAfterSeconds: number;
  count: number;
}

export abstract class RateLimiter {
  /** Counts one hit against `key` in a fixed window; allowed while count <= limit. */
  abstract hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}

/** Fixed-window counters in Redis (INCR + EXPIRE NX in one MULTI). Keys never contain raw PII. */
@Injectable()
export class RedisRateLimiter extends RateLimiter {
  constructor(private readonly redis: RedisService) {
    super();
  }

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const redisKey = `rl:${key}`;
    const results = await this.redis.client
      .multi()
      .incr(redisKey)
      .expire(redisKey, windowSeconds, 'NX')
      .ttl(redisKey)
      .exec();
    if (!results) throw new Error('Rate limiter transaction failed');
    const count = Number(results[0]?.[1] ?? 0);
    const ttl = Number(results[2]?.[1] ?? windowSeconds);
    return { allowed: count <= limit, retryAfterSeconds: ttl > 0 ? ttl : windowSeconds, count };
  }
}

/** In-memory limiter for unit tests. */
export class MemoryRateLimiter extends RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {
    super();
  }

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = this.now();
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + windowSeconds * 1000 };
      this.windows.set(key, window);
    }
    window.count += 1;
    return {
      allowed: window.count <= limit,
      retryAfterSeconds: Math.ceil((window.resetAt - now) / 1000),
      count: window.count,
    };
  }
}
