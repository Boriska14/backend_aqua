import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConsoleEmailProvider, EMAIL_PROVIDER } from './email.provider';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    {
      provide: EMAIL_PROVIDER,
      useClass: ConsoleEmailProvider,
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
