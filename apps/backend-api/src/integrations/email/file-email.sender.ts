import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { EmailSender, type EmailMessage } from './email-sender';

const KEEP_LATEST = 200;

/**
 * Development-only email transport (MAIL_TRANSPORT=file): each message becomes a text file in a local
 * folder instead of going to Mailpit, so the backend runs without Docker. Fake SMS (OTP codes) is
 * forwarded here too. Bodies are never logged; loadEnv() refuses this transport in staging/production.
 */
export class FileEmailSender extends EmailSender {
  private readonly logger = new Logger('FileEmail');
  private readonly dir: string;
  private sequence = 0;

  constructor(dir: string) {
    super();
    this.dir = resolve(dir);
  }

  async send(message: EmailMessage): Promise<{ providerRef: string | null }> {
    await mkdir(this.dir, { recursive: true });
    this.sequence += 1;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `${stamp}-${String(this.sequence).padStart(4, '0')}.txt`;
    const lines = [
      `To: ${message.to}`,
      `Subject: ${message.subject}`,
      `Date: ${new Date().toISOString()}`,
      ...(message.replyTo ? [`Reply-To: ${message.replyTo}`] : []),
      '',
      message.text,
      '',
    ];
    await writeFile(join(this.dir, name), lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
    await this.prune();
    this.logger.log(`wrote message to ${this.dir}`);
    return { providerRef: `file-${name}` };
  }

  /** Keeps the folder small: only the newest messages are kept. */
  private async prune(): Promise<void> {
    const files = (await readdir(this.dir)).filter((file) => file.endsWith('.txt')).sort();
    const excess = files.length - KEEP_LATEST;
    if (excess <= 0) return;
    await Promise.all(files.slice(0, excess).map((file) => unlink(join(this.dir, file))));
  }
}
