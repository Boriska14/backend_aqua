import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ProblemDetailsFilter } from '../src/common/filters/problem-details.filter';
import { I18nService } from '../src/common/i18n/i18n.service';
import { HealthService } from '../src/modules/health/health.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Health (e2e)', () => {
  let app: INestApplication;

  const mockPrismaService = {
    ping: jest.fn().mockResolvedValue(true),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3000';
    process.env.APP_NAME = 'AquaSafe';
    process.env.CORS_ORIGINS = 'http://localhost:4200';
    process.env.PUBLIC_VERIFY_URL = 'http://localhost:4200/verify';
    process.env.LOG_LEVEL = 'silent';
    process.env.DEFAULT_LOCALE = 'fr';
    process.env.DATABASE_URL =
      'postgresql://aquasafe:aquasafe@localhost:5432/aquasafe_test';
    process.env.S3_ENDPOINT = 'http://localhost:9000';
    process.env.S3_REGION = 'us-east-1';
    process.env.S3_BUCKET = 'aquasafe-documents';
    process.env.S3_ACCESS_KEY = 'minioadmin';
    process.env.S3_SECRET_KEY = 'minioadmin';
    process.env.S3_FORCE_PATH_STYLE = 'true';
    process.env.MAX_UPLOAD_MB = '10';
    process.env.SIGNED_URL_TTL_SECONDS = '300';
    process.env.JWT_ACCESS_SECRET =
      'test-jwt-access-secret-minimum-32-characters-long';
    process.env.JWT_REFRESH_SECRET =
      'test-jwt-refresh-secret-minimum-32-characters-long';
    process.env.TOTP_ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.IP_HASH_SALT = 'test-ip-hash-salt-min-16';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(mockPrismaService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new ProblemDetailsFilter(app.get(I18nService)));

    const healthService = app.get(HealthService);
    jest
      .spyOn(
        healthService as unknown as { checkStorage: () => Promise<boolean> },
        'checkStorage',
      )
      .mockResolvedValue(true);

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns 200 when database and storage are up', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(res.body).toMatchObject({
      status: 'ok',
      pilot: 'Pilote en cours de validation',
      checks: {
        database: 'up',
        storage: 'up',
      },
    });
  });

  it('GET /api/v1/health returns 503 RFC 7807 ProblemDetails when database is down', async () => {
    mockPrismaService.ping.mockRejectedValueOnce(new Error('DB unreachable'));

    const res = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(503);

    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({
      status: 503,
      code: 'HEALTH_DEGRADED',
    });
    expect(typeof res.body.traceId).toBe('string');
  });
});
