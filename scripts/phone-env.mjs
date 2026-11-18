// Local development only: points the Expo apps (running in Expo Go on a phone) and the API's
// local-storage links at this Mac's LAN IP instead of localhost, so a phone on the same Wi-Fi can reach
// the backend. Runs automatically before `pnpm --filter @safezone/<app> dev`.
//   pnpm phone:env            # IP from `ipconfig getifaddr en0` (macOS), else the first private IPv4
//   pnpm phone:env 10.0.0.12  # or pass it
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const isIPv4 = (ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip ?? '');

/** The Mac's Wi-Fi address, as `ipconfig getifaddr en0` reports it. */
function wifiAddress() {
  try {
    const ip = execFileSync('ipconfig', ['getifaddr', 'en0'], { encoding: 'utf8' }).trim();
    return isIPv4(ip) ? ip : undefined;
  } catch {
    return undefined;
  }
}

/** Fallback for other interfaces or systems: the first private IPv4 address. */
function privateAddress() {
  const isPrivate = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  return Object.values(networkInterfaces())
    .flat()
    .find((net) => net && net.family === 'IPv4' && !net.internal && isPrivate(net.address))
    ?.address;
}

const ip = process.argv[2] ?? wifiAddress() ?? privateAddress();
if (!isIPv4(ip)) {
  console.error('Could not detect the LAN IP. Pass it: pnpm phone:env 192.168.0.10');
  process.exit(1);
}

/** Sets KEY=value lines in an env file, creating the file or keys as needed. Returns true on change. */
function setVars(path, vars) {
  const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
  let text = before;
  for (const [key, value] of Object.entries(vars)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, 'm');
    text = pattern.test(text)
      ? text.replace(pattern, line)
      : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`;
  }
  if (text !== before) writeFileSync(path, text);
  return text !== before;
}

for (const app of ['resident-mobile', 'management-mobile', 'security-mobile']) {
  setVars(join(root, 'apps', app, '.env'), {
    EXPO_PUBLIC_API_URL: `http://${ip}:4000`,
    EXPO_PUBLIC_REALTIME_URL: `ws://${ip}:4001`,
  });
}
const apiEnv = join(root, 'apps', 'backend-api', '.env');
const apiChanged = existsSync(apiEnv) && setVars(apiEnv, { API_PUBLIC_URL: `http://${ip}:4000` });

console.warn(`Phone apps will call the API at http://${ip}:4000`);
if (apiChanged)
  console.warn('API_PUBLIC_URL changed: restart the API (pnpm dev:api) for file links.');
