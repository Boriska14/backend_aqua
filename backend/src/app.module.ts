import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'crypto';
import { LoggerModule } from 'nestjs-pino';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { ScopeModule } from './common/guards/scope.module';
import { StrongAuthGuard } from './common/guards/strong-auth.guard';
import { I18nModule } from './common/i18n/i18n.module';
import { buildAppConfiguration } from './config/configuration';
import { EnvConfig, validateEnv } from './config/env.validation';
import { AnalysesModule } from './modules/analyses/analyses.module';
import { AnnuaireModule } from './modules/annuaire/annuaire.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { CertificatsModule } from './modules/certificats/certificats.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DemandesModule } from './modules/demandes/demandes.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ExportsModule } from './modules/exports/exports.module';
import { GeoModule } from './modules/geo/geo.module';
import { HealthModule } from './modules/health/health.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { NormesModule } from './modules/normes/normes.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OuvragesModule } from './modules/ouvrages/ouvrages.module';
import { PaiementsModule } from './modules/paiements/paiements.module';
import { PrelevementsModule } from './modules/prelevements/prelevements.module';
import { PublicModule } from './modules/public/public.module';
import { SignalementsModule } from './modules/signalements/signalements.module';
import { SubventionsModule } from './modules/subventions/subventions.module';
import { TarifsModule } from './modules/tarifs/tarifs.module';
import { UsersModule } from './modules/users/users.module';
import { ValidationsMineeModule } from './modules/validations-minee/validations-minee.module';
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
    ScheduleModule.forRoot(),
    PrismaModule,
    I18nModule,
    ScopeModule,
    AuditModule,
    DocumentsModule,
    AuthModule,
    NotificationsModule,
    HealthModule,
    UsersModule,
    GeoModule,
    OuvragesModule,
    TarifsModule,
    DemandesModule,
    PaiementsModule,
    PrelevementsModule,
    NormesModule,
    AnalysesModule,
    CertificatsModule,
    ValidationsMineeModule,
    PublicModule,
    SignalementsModule,
    JobsModule,
    DashboardModule,
    AnnuaireModule,
    SubventionsModule,
    ExportsModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: StrongAuthGuard,
    },
  ],
})
export class AppModule {}
