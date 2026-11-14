export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

/** Email adapter (backend-api.md §13). Zoho SMTP in staging/production; Mailpit locally. */
export abstract class EmailSender {
  abstract send(message: EmailMessage): Promise<{ providerRef: string | null }>;
}

/** Captures messages in memory (tests). */
export class FakeEmailSender extends EmailSender {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<{ providerRef: string | null }> {
    this.sent.push(message);
    if (this.sent.length > 100) this.sent.shift();
    return { providerRef: `fake-${this.sent.length}` };
  }
}
