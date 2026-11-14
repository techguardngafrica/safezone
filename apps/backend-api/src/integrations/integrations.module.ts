import { Global, Module } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { EmailSender } from './email/email-sender';
import { SmtpEmailSender } from './email/smtp-email.sender';
import { ExpoPushSender } from './push/expo-push.sender';
import { MalwareScanner, StubMalwareScanner } from './scan/malware-scanner';
import { ObjectStorage } from './storage/object-storage';
import { S3ObjectStorage } from './storage/s3-object-storage';
import { PushSender } from './push/push-sender';
import { FakeSmsSender } from './sms/fake-sms.sender';
import { SmsSender } from './sms/sms-sender';
import { TermiiSmsSender } from './sms/termii-sms.sender';

/**
 * Provider adapters selected by configuration (AGENTS.md §5.7). Domain code depends on the abstract
 * classes only; tests override them with fakes.
 */
@Global()
@Module({
  providers: [
    { provide: EmailSender, inject: [ENV], useFactory: (env: Env) => new SmtpEmailSender(env) },
    {
      provide: SmsSender,
      inject: [ENV, EmailSender],
      useFactory: (env: Env, email: EmailSender): SmsSender => {
        if (env.SMS_PROVIDER === 'termii') {
          if (!env.SMS_API_KEY) throw new Error('SMS_API_KEY is required for termii');
          return new TermiiSmsSender({ apiKey: env.SMS_API_KEY, senderId: env.SMS_SENDER_ID });
        }
        return new FakeSmsSender(env.NODE_ENV === 'development' ? email : undefined);
      },
    },
    {
      provide: PushSender,
      inject: [ENV],
      useFactory: (env: Env): PushSender => new ExpoPushSender(env.EXPO_ACCESS_TOKEN),
    },
    {
      provide: ObjectStorage,
      inject: [ENV],
      useFactory: (env: Env): ObjectStorage =>
        new S3ObjectStorage({
          bucket: env.STORAGE_BUCKET,
          region: env.STORAGE_REGION,
          forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
          ...(env.STORAGE_ENDPOINT ? { endpoint: env.STORAGE_ENDPOINT } : {}),
          ...(env.STORAGE_ACCESS_KEY_ID ? { accessKeyId: env.STORAGE_ACCESS_KEY_ID } : {}),
          ...(env.STORAGE_SECRET_ACCESS_KEY
            ? { secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY }
            : {}),
        }),
    },
    { provide: MalwareScanner, useClass: StubMalwareScanner },
  ],
  exports: [EmailSender, SmsSender, PushSender, ObjectStorage, MalwareScanner],
})
export class IntegrationsModule {}
