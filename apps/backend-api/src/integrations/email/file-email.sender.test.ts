import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileEmailSender } from './file-email.sender';

describe('FileEmailSender', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sz-outbox-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes each message as a readable text file', async () => {
    const sender = new FileEmailSender(join(dir, 'outbox'));
    await sender.send({
      to: 'sms-outbox@safezone.local',
      subject: 'SMS to +2348000000010',
      text: 'Code 123456',
    });
    const files = await readdir(join(dir, 'outbox'));
    expect(files).toHaveLength(1);
    const content = await readFile(join(dir, 'outbox', files[0] ?? ''), 'utf8');
    expect(content).toContain('Subject: SMS to +2348000000010');
    expect(content).toContain('Code 123456');
  });

  it('orders file names by time so the newest sorts last', async () => {
    const sender = new FileEmailSender(dir);
    await sender.send({ to: 'a@x.test', subject: 'first', text: '1' });
    await sender.send({ to: 'a@x.test', subject: 'second', text: '2' });
    const files = (await readdir(dir)).sort();
    expect(await readFile(join(dir, files[1] ?? ''), 'utf8')).toContain('second');
  });
});
