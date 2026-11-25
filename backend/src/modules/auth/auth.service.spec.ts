import { HttpException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthCodePurpose, Role, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { sha256Hex } from '../../common/utils/crypto.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from './auth.service';
import { SmsProvider } from './sms/sms-provider.interface';

describe('AuthService (EF-02, EF-03)', () => {
  const configValues: Record<string, unknown> = {
    JWT_ACCESS_SECRET: 'test-jwt-access-secret-minimum-32-characters-long',
    JWT_REFRESH_SECRET: 'test-jwt-refresh-secret-minimum-32-characters-long',
    JWT_ACCESS_TTL_SECONDS: 900,
    JWT_REFRESH_TTL_DAYS: 30,
    TOTP_ENCRYPTION_KEY:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    APP_NAME: 'AquaSafe',
  };

  const configService = {
    get: jest.fn((k: string, d?: unknown) => configValues[k] ?? d),
    getOrThrow: jest.fn((k: string) => configValues[k]),
  } as unknown as ConfigService;

  const jwtService = new JwtService({});
  const smsProvider: SmsProvider = {
    send: jest.fn().mockResolvedValue(undefined),
  };
  const auditService = {
    log: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  it('blocks OTP requests after 3 per hour per phone (EF-02)', async () => {
    const prisma = {
      userAuthCode: {
        count: jest.fn().mockResolvedValue(3),
      },
    } as unknown as PrismaService;

    const service = new AuthService(
      prisma,
      jwtService,
      configService,
      auditService,
      smsProvider,
    );

    await expect(
      service.requestOtp({
        phone: '+237670000001',
        purpose: AuthCodePurpose.LOGIN,
      }),
    ).rejects.toThrow(HttpException);
  });

  it('requires MFA challenge when staff user has TOTP enabled (EF-03)', async () => {
    const passwordHash = await argon2.hash('StrongPass123!', {
      type: argon2.argon2id,
    });
    const prisma = {
      user: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'minee-1',
          role: Role.MINEE,
          status: UserStatus.ACTIVE,
          fullName: 'Inspecteur MINEE',
          phone: '+237670000010',
          email: 'minee@aquasafe.cm',
          passwordHash,
          mfaEnabled: true,
          failedLogins: 0,
          lockedUntil: null,
          communeScopes: [],
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaService;

    const service = new AuthService(
      prisma,
      jwtService,
      configService,
      auditService,
      smsProvider,
    );

    const res = await service.staffLogin({
      identifier: 'minee@aquasafe.cm',
      password: 'StrongPass123!',
    });

    expect(res).toMatchObject({
      mfaRequired: true,
      mfaEnrolled: true,
    });
    expect(typeof (res as { mfaToken: string }).mfaToken).toBe('string');
  });

  it('revokes entire refresh token family on reuse detection', async () => {
    const rawRefresh = 'reused-refresh-token-value';
    const tokenHash = sha256Hex(rawRefresh);
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });

    const prisma = {
      refreshToken: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'rt-1',
          userId: 'user-1',
          familyId: 'fam-1',
          tokenHash,
          revokedAt: new Date(Date.now() - 1000),
          expiresAt: new Date(Date.now() + 86400000),
          user: { id: 'user-1', role: Role.PROPRIETAIRE },
        }),
        updateMany,
      },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          refreshToken: { updateMany },
        }),
      ),
    } as unknown as PrismaService;

    const service = new AuthService(
      prisma,
      jwtService,
      configService,
      auditService,
      smsProvider,
    );

    await expect(service.refresh(rawRefresh)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { familyId: 'fam-1', revokedAt: null },
      }),
    );
  });
});
