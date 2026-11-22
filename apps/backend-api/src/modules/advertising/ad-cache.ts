import { Injectable } from '@nestjs/common';

/**
 * Candidate sets per (placement, estate) for 60 s (advertising.md §6 step 7). Purged on every change that
 * can stop an ad from serving (suspension, pause, creative change), so suspensions take effect at once in
 * this process. Other API processes expire within the TTL.
 */
@Injectable()
export class AdCache {
  private readonly entries = new Map<string, { at: number; value: unknown }>();
  static readonly TTL_MS = 60_000;

  get<T>(key: string, now = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (!entry || now - entry.at > AdCache.TTL_MS) return undefined;
    return entry.value as T;
  }

  set(key: string, value: unknown, now = Date.now()): void {
    this.entries.set(key, { at: now, value });
  }

  purge(): void {
    this.entries.clear();
  }
}
