import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms-provider.interface';

@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  async send(phone: string, message: string): Promise<void> {
    const maskedPhone =
      phone.length > 4 ? `***${phone.slice(-4)}` : '[REDACTED]';
    // Dev/pilot fallback when no SMS gateway is contracted (D1). Never log OTP in production.
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log(`[DEV SMS -> ${maskedPhone}] ${message}`);
    } else {
      this.logger.warn(
        `SMS provider in console fallback mode; message queued for ${maskedPhone}`,
      );
    }
  }
}
