import { Injectable } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../../config/env';
import { EmailSender, type EmailMessage } from './email-sender';

/** SMTP sender: Zoho SMTP (smtp.zoho.com, 465/TLS) in deployed environments, Mailpit locally. */
@Injectable()
export class SmtpEmailSender extends EmailSender {
  private readonly transporter: Transporter;

  constructor(private readonly env: Env) {
    super();
    this.transporter = nodemailer.createTransport({
      host: env.MAIL_SMTP_HOST,
      port: env.MAIL_SMTP_PORT,
      secure: env.MAIL_SMTP_SECURE,
      ...(env.MAIL_SMTP_USER && env.MAIL_SMTP_PASSWORD
        ? { auth: { user: env.MAIL_SMTP_USER, pass: env.MAIL_SMTP_PASSWORD } }
        : {}),
      connectionTimeout: 10_000,
      socketTimeout: 15_000,
    });
  }

  async send(message: EmailMessage): Promise<{ providerRef: string | null }> {
    const info = await this.transporter.sendMail({
      from: this.env.MAIL_SMTP_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });
    return { providerRef: typeof info.messageId === 'string' ? info.messageId : null };
  }
}
