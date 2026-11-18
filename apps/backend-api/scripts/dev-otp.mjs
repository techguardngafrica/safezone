// Local development only: prints the newest sign-in code sent to a phone number by the fake SMS sender.
// Reads the file outbox (MAIL_TRANSPORT=file) or the Mailpit API (MAIL_TRANSPORT=smtp, Docker).
//   pnpm dev:otp 08000000001
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

try {
  process.loadEnvFile('.env');
} catch {
  // Use the process environment.
}

if (['staging', 'production'].includes(process.env.NODE_ENV ?? '')) {
  console.error('dev:otp is for local development only.');
  process.exit(1);
}

const input = process.argv[2] ?? '';
const digits = input.replace(/\D/g, '').slice(-10);
if (digits.length !== 10) {
  console.error('Usage: pnpm dev:otp <phone>, for example pnpm dev:otp 08000000001');
  process.exit(1);
}
const matches = (subject) => subject.replace(/\D/g, '').endsWith(digits);
const codeIn = (text) => /\b(\d{6})\b/.exec(text)?.[1];

async function fromOutbox() {
  const dir = resolve(process.env.DEV_OUTBOX_DIR ?? '.dev-outbox');
  const files = (await readdir(dir).catch(() => []))
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .reverse();
  for (const file of files) {
    const text = await readFile(join(dir, file), 'utf8');
    const subject = /^Subject: (.*)$/m.exec(text)?.[1] ?? '';
    if (matches(subject))
      return { code: codeIn(text.split('\n\n').slice(1).join('\n')), at: file.slice(0, 19) };
  }
  return null;
}

async function fromMailpit() {
  const base = process.env.MAILPIT_URL ?? 'http://localhost:8025';
  const list = await fetch(`${base}/api/v1/messages?limit=50`).then((r) => r.json());
  for (const message of list.messages ?? []) {
    if (!matches(message.Subject ?? '')) continue;
    const full = await fetch(`${base}/api/v1/message/${message.ID}`).then((r) => r.json());
    return { code: codeIn(full.Text ?? ''), at: message.Created };
  }
  return null;
}

const found =
  process.env.MAIL_TRANSPORT === 'file'
    ? await fromOutbox()
    : await fromMailpit().catch(() => {
        console.error(
          'Mailpit is not reachable. Start it (pnpm infra:up) or set MAIL_TRANSPORT=file.',
        );
        process.exit(1);
      });
if (!found?.code) {
  console.error(`No code found for ${input}. Request one in the app first.`);
  process.exit(1);
}
process.stdout.write(`${found.code}\n`);
