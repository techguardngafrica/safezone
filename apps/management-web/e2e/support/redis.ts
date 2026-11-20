import net from 'node:net';

/**
 * Minimal Redis client for the harness (two housekeeping commands, so no client library is added).
 * Sends commands in one pipeline on the URL's database index and resolves once every reply arrived.
 * Only single-line replies (+OK, :1, -ERR) are expected.
 */
export async function redisCommands(url: string, commands: string[][]): Promise<string[]> {
  const target = new URL(url);
  const index = target.pathname.replace('/', '') || '0';
  const all = [
    ...(target.password ? [['AUTH', decodeURIComponent(target.password)]] : []),
    ['SELECT', index],
    ...commands,
  ];
  const payload = all
    .map(
      (parts) =>
        `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join('')}`,
    )
    .join('');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: target.hostname,
      port: Number(target.port || 6379),
    });
    let buffer = '';
    socket.setTimeout(10_000, () => socket.destroy(new Error('redis timeout')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write(payload));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const replies = buffer.split('\r\n').filter(Boolean);
      if (replies.length < all.length) return;
      socket.end();
      const failed = replies.find((reply) => reply.startsWith('-'));
      if (failed) reject(new Error(`redis: ${failed.slice(1)}`));
      else resolve(replies.slice(all.length - commands.length));
    });
  });
}

/** Refuses database index 0, where `pnpm dev` keeps its data. */
export function assertTestRedis(url: string): void {
  const index = Number(new URL(url).pathname.replace('/', '') || '0');
  if (!Number.isInteger(index) || index === 0)
    throw new Error('E2E_REDIS_URL must name a Redis database index other than 0');
}

/** Clears rate-limit counters (keys `rl:*`) so repeated sign-ins from 127.0.0.1 are not throttled. */
export async function clearRateLimits(url: string): Promise<void> {
  assertTestRedis(url);
  await redisCommands(url, [
    [
      'EVAL',
      "local n = 0 for _, k in ipairs(redis.call('KEYS', 'rl:*')) do redis.call('DEL', k) n = n + 1 end return n",
      '0',
    ],
  ]);
}
