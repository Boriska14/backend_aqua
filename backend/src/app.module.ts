import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import { LoggerModule } from 'nestjs-pino';
import { I18nModule } from './common/i18n/i18n.module';
import { buildAppConfiguration } from './config/configuration';
import { EnvConfig, validateEnv } from './config/env.validation';
import { HealthModule } from './modules/health/health.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (config) => {
        const validated: EnvConfig = validateEnv(config);
        return {
          ...validated,
          appConfig: buildAppConfiguration(validated),
        };
      },
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        pinoHttp: {
          level: configService.get<string>('LOG_LEVEL', 'info'),
          genReqId: (req) =>
            (req.headers['x-request-id'] as string | undefined) || randomUUID(),
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.phone',
              'req.body.ownerPhone',
              'req.body.contactPhone',
              'req.body.code',
              'req.body.refreshToken',
              'req.body.mfaToken',
              'res.headers["set-cookie"]',
            ],
            censor: '[REDACTED]',
          },
          customProps: () => ({
            service: 'aquasafe-api',
          }),
        },
      }),
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
    PrismaModule,
    I18nModule,
    HealthModule,
  ],
})
export class AppModule {}
