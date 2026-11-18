// Local development only: clears the sign-in code rate limits (5 codes per phone per hour, 10 per IP)
// in the local Redis, after a lot of manual testing.   pnpm dev:otp:reset
import Redis from 'ioredis';

try {
  process.loadEnvFile('.env');
} catch {
  // Use the process environment.
}
if (['staging', 'production'].includes(process.env.NODE_ENV ?? '')) {
  console.error('dev:otp:reset is for local development only.');
  process.exit(1);
}

const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379', { lazyConnect: true });
await redis.connect();
let cleared = 0;
for await (const keys of redis.scanStream({ match: 'rl:otp:*', count: 100 })) {
  if (keys.length > 0) cleared += await redis.del(...keys);
}
await redis.quit();
console.warn(`Cleared ${cleared} sign-in rate limit counter(s).`);
