import { Injectable, Logger } from '@nestjs/common';

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface EmailProvider {
  send(email: string, subject: string, body: string): Promise<void>;
}

@Injectable()
export class ConsoleEmailProvider implements EmailProvider {
  private readonly logger = new Logger(ConsoleEmailProvider.name);

  async send(email: string, subject: string, _body: string): Promise<void> {
    const [, domain] = email.split('@');
    const masked = domain ? `***@${domain}` : '[REDACTED]';
    this.logger.log(`[EMAIL -> ${masked}] ${subject}`);
  }
}
