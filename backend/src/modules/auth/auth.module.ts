import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConsoleSmsProvider } from './sms/console-sms.provider';
import { SMS_PROVIDER } from './sms/sms-provider.interface';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    {
      provide: SMS_PROVIDER,
      useClass: ConsoleSmsProvider,
    },
  ],
  exports: [AuthService, JwtModule, SMS_PROVIDER],
})
export class AuthModule {}
