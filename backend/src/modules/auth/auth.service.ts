import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthCodePurpose, Role, User, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'crypto';
import { authenticator } from 'otplib';
import { AuthUser, JwtPayload } from '../../common/types/auth-user.type';
import {
  decryptAes256Gcm,
  encryptAes256Gcm,
  generateNumericOtp,
  normalizeCameroonPhone,
  sha256Hex,
} from '../../common/utils/crypto.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  Confirm2faDto,
  OtpRequestDto,
  OtpVerifyDto,
  StaffLoginDto,
  UpdateMeDto,
  Verify2faDto,
} from './dto/auth.dto';
import { SMS_PROVIDER, SmsProvider } from './sms/sms-provider.interface';

const MANDATORY_2FA_ROLES: Role[] = [Role.MINEE, Role.LABORATOIRE, Role.ADMIN];

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
  ) {}

  async requestOtp(dto: OtpRequestDto, ip?: string | null) {
    const phone = normalizeCameroonPhone(dto.phone);
    if (!phone) {
      return { accepted: true };
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await this.prisma.userAuthCode.count({
      where: {
        phone,
        createdAt: { gte: oneHourAgo },
      },
    });

    if (recentCount >= 3) {
      throw new HttpException(
        {
          code: 'OTP_RATE_LIMITED',
          message: 'Too many OTP requests for this phone number',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    let user = await this.prisma.user.findUnique({ where: { phone } });

    if (!user && dto.purpose === AuthCodePurpose.REGISTER) {
      user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            role: Role.PROPRIETAIRE,
            status: UserStatus.PENDING,
            fullName: dto.fullName?.trim() || 'Propriétaire',
            phone,
          },
        });
        await this.auditService.log(tx, {
          actorId: created.id,
          actorRole: created.role,
          action: 'USER_REGISTER_PENDING',
          entityType: 'User',
          entityId: created.id,
          ip,
        });
        return created;
      });
    }

    if (
      user &&
      user.status !== UserStatus.DISABLED &&
      user.status !== UserStatus.LOCKED
    ) {
      const code = generateNumericOtp(6);
      const codeHash = sha256Hex(`${phone}:${code}`);
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      await this.prisma.userAuthCode.create({
        data: {
          userId: user.id,
          phone,
          codeHash,
          purpose: dto.purpose,
          expiresAt,
        },
      });

      await this.smsProvider.send(
        phone,
        `AquaSafe: votre code d'accès est ${code}. Valable 5 minutes.`,
      );
    }

    return { accepted: true };
  }

  async verifyOtp(dto: OtpVerifyDto, ip?: string | null) {
    const phone = normalizeCameroonPhone(dto.phone);
    if (!phone) {
      throw new UnauthorizedException({
        code: 'OTP_INVALID',
        message: 'Invalid OTP code',
      });
    }

    const latestCode = await this.prisma.userAuthCode.findFirst({
      where: {
        phone,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!latestCode) {
      throw new UnauthorizedException({
        code: 'OTP_INVALID',
        message: 'Invalid or expired OTP code',
      });
    }

    if (latestCode.attempts >= 5) {
      throw new UnauthorizedException({
        code: 'OTP_MAX_ATTEMPTS',
        message: 'Maximum OTP verification attempts exceeded',
      });
    }

    const candidateHash = sha256Hex(`${phone}:${dto.code}`);
    if (candidateHash !== latestCode.codeHash) {
      await this.prisma.userAuthCode.update({
        where: { id: latestCode.id },
        data: { attempts: { increment: 1 } },
      });
      throw new UnauthorizedException({
        code: 'OTP_INVALID',
        message: 'Invalid OTP code',
      });
    }

    const user = await this.prisma.$transaction(async (tx) => {
      await tx.userAuthCode.update({
        where: { id: latestCode.id },
        data: { consumedAt: new Date() },
      });

      const found = await tx.user.findUnique({
        where: { phone },
        include: { communeScopes: { select: { communeId: true } } },
      });
      if (!found || found.status === UserStatus.DISABLED) {
        throw new UnauthorizedException({
          code: 'OTP_INVALID',
          message: 'Account unavailable',
        });
      }

      const updated = await tx.user.update({
        where: { id: found.id },
        data: {
          status:
            found.status === UserStatus.PENDING
              ? UserStatus.ACTIVE
              : found.status,
          lastLoginAt: new Date(),
        },
        include: { communeScopes: { select: { communeId: true } } },
      });

      await this.auditService.log(tx, {
        actorId: updated.id,
        actorRole: updated.role,
        action: 'AUTH_OTP_LOGIN',
        entityType: 'User',
        entityId: updated.id,
        ip,
      });

      return updated;
    });

    return this.issueSession(user, null);
  }

  async staffLogin(dto: StaffLoginDto, ip?: string | null) {
    const normalizedPhone = normalizeCameroonPhone(dto.identifier);
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: dto.identifier.trim().toLowerCase() },
          ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
        ],
      },
      include: { communeScopes: { select: { communeId: true } } },
    });

    if (!user || !user.passwordHash) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }

    if (
      user.status === UserStatus.DISABLED ||
      user.status === UserStatus.LOCKED
    ) {
      throw new HttpException(
        { code: 'ACCOUNT_LOCKED', message: 'Account locked or disabled' },
        HttpStatus.LOCKED,
      );
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new HttpException(
        { code: 'ACCOUNT_LOCKED', message: 'Account temporarily locked' },
        HttpStatus.LOCKED,
      );
    }

    const validPassword = await argon2.verify(user.passwordHash, dto.password);
    if (!validPassword) {
      const nextFails = user.failedLogins + 1;
      const lockMinutes =
        nextFails >= 5 ? Math.min(60, 2 ** (nextFails - 5)) : 0;
      const lockedUntil =
        lockMinutes > 0 ? new Date(Date.now() + lockMinutes * 60 * 1000) : null;

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLogins: nextFails,
          ...(lockedUntil ? { lockedUntil } : {}),
        },
      });

      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid credentials',
      });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null },
    });

    const requiresMfa =
      user.mfaEnabled || MANDATORY_2FA_ROLES.includes(user.role);

    if (requiresMfa) {
      const mfaToken = await this.jwtService.signAsync(
        { sub: user.id, role: user.role, type: 'mfa' } satisfies JwtPayload,
        {
          secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
          expiresIn: 600,
        },
      );
      return {
        mfaRequired: true,
        mfaToken,
        mfaEnrolled: user.mfaEnabled,
      };
    }

    await this.auditService.log(this.prisma, {
      actorId: user.id,
      actorRole: user.role,
      action: 'AUTH_STAFF_LOGIN',
      entityType: 'User',
      entityId: user.id,
      ip,
    });

    return this.issueSession(user, null);
  }

  async verify2fa(dto: Verify2faDto, ip?: string | null) {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(dto.mfaToken, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException({
        code: 'MFA_INVALID',
        message: 'Invalid or expired MFA token',
      });
    }

    if (payload.type !== 'mfa' || !payload.sub) {
      throw new UnauthorizedException({
        code: 'MFA_INVALID',
        message: 'Invalid MFA token type',
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        totpSecret: true,
        communeScopes: { select: { communeId: true } },
      },
    });

    if (!user || !user.mfaEnabled || !user.totpSecret?.confirmedAt) {
      throw new UnauthorizedException({
        code: 'MFA_INVALID',
        message: '2FA is not enrolled for this account',
      });
    }

    if (dto.isBackupCode) {
      const normalized = dto.code.trim().toUpperCase();
      const backupCodes = await this.prisma.backupCode.findMany({
        where: { userId: user.id, usedAt: null },
      });

      let matchedId: string | null = null;
      for (const bc of backupCodes) {
        if (await argon2.verify(bc.codeHash, normalized)) {
          matchedId = bc.id;
          break;
        }
      }
      if (!matchedId) {
        throw new UnauthorizedException({
          code: 'MFA_INVALID',
          message: 'Invalid backup code',
        });
      }

      await this.prisma.$transaction(async (tx) => {
        const res = await tx.backupCode.updateMany({
          where: { id: matchedId, usedAt: null },
          data: { usedAt: new Date() },
        });
        if (res.count === 0) {
          throw new UnauthorizedException({
            code: 'MFA_INVALID',
            message: 'Backup code already used',
          });
        }
        await tx.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });
        await this.auditService.log(tx, {
          actorId: user.id,
          actorRole: user.role,
          action: 'AUTH_2FA_BACKUP_LOGIN',
          entityType: 'User',
          entityId: user.id,
          ip,
        });
      });
    } else {
      const secret = decryptAes256Gcm(
        user.totpSecret.encryptedSecret,
        user.totpSecret.iv,
        user.totpSecret.authTag,
        this.configService.getOrThrow<string>('TOTP_ENCRYPTION_KEY'),
      );
      const isValid = authenticator.verify({ token: dto.code.trim(), secret });
      if (!isValid) {
        throw new UnauthorizedException({
          code: 'MFA_INVALID',
          message: 'Invalid TOTP code',
        });
      }

      await this.prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });
        await this.auditService.log(tx, {
          actorId: user.id,
          actorRole: user.role,
          action: 'AUTH_2FA_LOGIN',
          entityType: 'User',
          entityId: user.id,
          ip,
        });
      });
    }

    return this.issueSession(user, Date.now());
  }

  async resolveEnrollUserFromHeader(authHeader?: string): Promise<string> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Bearer access or MFA token required',
      });
    }
    const token = authHeader.slice(7).trim();
    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      if (
        (payload.type === 'access' || payload.type === 'mfa') &&
        payload.sub
      ) {
        return payload.sub;
      }
    } catch {
      // handled below
    }
    throw new UnauthorizedException({
      code: 'UNAUTHORIZED',
      message: 'Invalid token',
    });
  }

  async enroll2fa(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED' });
    }
    if (user.mfaEnabled) {
      throw new ConflictException({
        code: 'MFA_ALREADY_ENABLED',
        message: '2FA is already enabled',
      });
    }

    const secret = authenticator.generateSecret();
    const label = user.email || user.phone;
    const otpauthUri = authenticator.keyuri(label, 'AquaSafe', secret);
    const encKey = this.configService.getOrThrow<string>('TOTP_ENCRYPTION_KEY');
    const encrypted = encryptAes256Gcm(secret, encKey);

    await this.prisma.totpSecret.upsert({
      where: { userId },
      update: {
        encryptedSecret: encrypted.encryptedSecret,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        confirmedAt: null,
      },
      create: {
        userId,
        encryptedSecret: encrypted.encryptedSecret,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
      },
    });

    return { otpauthUri, secret };
  }

  async confirm2fa(userId: string, dto: Confirm2faDto, ip?: string | null) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { totpSecret: true },
    });
    if (!user || !user.totpSecret) {
      throw new ConflictException({
        code: 'MFA_NOT_ENROLLED',
        message: 'Initialize 2FA enrollment first',
      });
    }
    if (user.mfaEnabled) {
      throw new ConflictException({
        code: 'MFA_ALREADY_ENABLED',
        message: '2FA is already enabled',
      });
    }

    const secret = decryptAes256Gcm(
      user.totpSecret.encryptedSecret,
      user.totpSecret.iv,
      user.totpSecret.authTag,
      this.configService.getOrThrow<string>('TOTP_ENCRYPTION_KEY'),
    );

    if (!authenticator.verify({ token: dto.code.trim(), secret })) {
      throw new UnauthorizedException({
        code: 'MFA_INVALID',
        message: 'Invalid TOTP verification code',
      });
    }

    const plainBackupCodes: string[] = [];
    for (let i = 0; i < 10; i++) {
      plainBackupCodes.push(randomBytes(5).toString('hex').toUpperCase());
    }
    const hashedCodes = await Promise.all(
      plainBackupCodes.map(async (code) => ({
        userId,
        codeHash: await argon2.hash(code),
      })),
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.totpSecret.update({
        where: { userId },
        data: { confirmedAt: new Date() },
      });
      await tx.backupCode.deleteMany({ where: { userId } });
      await tx.backupCode.createMany({ data: hashedCodes });
      await tx.user.update({
        where: { id: userId },
        data: { mfaEnabled: true },
      });
      await this.auditService.log(tx, {
        actorId: userId,
        actorRole: user.role,
        action: 'AUTH_2FA_CONFIRMED',
        entityType: 'User',
        entityId: userId,
        ip,
      });
    });

    return { backupCodes: plainBackupCodes };
  }

  async refresh(rawToken: string, ip?: string | null) {
    if (!rawToken) {
      throw new UnauthorizedException({
        code: 'REFRESH_INVALID',
        message: 'Refresh token required',
      });
    }

    const tokenHash = sha256Hex(rawToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: { communeScopes: { select: { communeId: true } } },
        },
      },
    });

    if (!stored || stored.expiresAt < new Date()) {
      throw new UnauthorizedException({
        code: 'REFRESH_INVALID',
        message: 'Invalid or expired refresh token',
      });
    }

    if (stored.revokedAt !== null) {
      // Reuse detection: revoke entire token family
      await this.prisma.$transaction(async (tx) => {
        await tx.refreshToken.updateMany({
          where: { familyId: stored.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await this.auditService.log(tx, {
          actorId: stored.userId,
          actorRole: stored.user.role,
          action: 'REFRESH_REUSE_DETECTED',
          entityType: 'RefreshToken',
          entityId: stored.familyId,
          ip,
        });
      });

      throw new UnauthorizedException({
        code: 'REFRESH_REUSE_DETECTED',
        message: 'Refresh token reuse detected; session family revoked',
      });
    }

    if (
      stored.user.status === UserStatus.DISABLED ||
      stored.user.status === UserStatus.LOCKED
    ) {
      throw new ForbiddenException({
        code: 'ACCOUNT_LOCKED',
        message: 'Account unavailable',
      });
    }

    const nextRawToken = randomBytes(40).toString('hex');
    const nextTokenHash = sha256Hex(nextRawToken);
    const refreshDays = this.configService.get<number>(
      'JWT_REFRESH_TTL_DAYS',
      30,
    );
    const expiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);

    await this.prisma.$transaction(async (tx) => {
      const nextRecord = await tx.refreshToken.create({
        data: {
          userId: stored.userId,
          familyId: stored.familyId,
          tokenHash: nextTokenHash,
          expiresAt,
        },
      });
      await tx.refreshToken.update({
        where: { id: stored.id },
        data: {
          revokedAt: new Date(),
          replacedById: nextRecord.id,
        },
      });
    });

    const accessToken = await this.signAccessToken(
      stored.user.id,
      stored.user.role,
      null,
    );
    const expiresIn = this.configService.get<number>(
      'JWT_ACCESS_TTL_SECONDS',
      900,
    );

    return {
      accessToken,
      refreshToken: nextRawToken,
      expiresIn,
      user: this.serializeUser(stored.user),
    };
  }

  async logout(userId: string, refreshToken?: string, ip?: string | null) {
    if (refreshToken) {
      const tokenHash = sha256Hex(refreshToken);
      const found = await this.prisma.refreshToken.findUnique({
        where: { tokenHash },
      });
      if (found && found.userId === userId) {
        await this.prisma.refreshToken.updateMany({
          where: { familyId: found.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    } else {
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    await this.auditService.log(this.prisma, {
      actorId: userId,
      actorRole: null,
      action: 'AUTH_LOGOUT',
      entityType: 'User',
      entityId: userId,
      ip,
    });
  }

  async getMe(currentUser: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: currentUser.id },
      include: { communeScopes: { select: { communeId: true } } },
    });
    return {
      ...this.serializeUser(user),
      communeScopeIds: currentUser.communeScopeIds,
    };
  }

  async updateMe(currentUser: AuthUser, dto: UpdateMeDto) {
    const updated = await this.prisma.user.update({
      where: { id: currentUser.id },
      data: {
        ...(dto.fullName !== undefined ? { fullName: dto.fullName } : {}),
        ...(dto.email !== undefined ? { email: dto.email.toLowerCase() } : {}),
        ...(dto.locale !== undefined ? { locale: dto.locale } : {}),
      },
      include: { communeScopes: { select: { communeId: true } } },
    });
    return this.serializeUser(updated);
  }

  private async issueSession(
    user: User & { communeScopes?: Array<{ communeId: number }> },
    mfaVerifiedAt: number | null,
  ) {
    const accessToken = await this.signAccessToken(
      user.id,
      user.role,
      mfaVerifiedAt,
    );
    const rawRefreshToken = randomBytes(40).toString('hex');
    const refreshDays = this.configService.get<number>(
      'JWT_REFRESH_TTL_DAYS',
      30,
    );
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId: randomUUID(),
        tokenHash: sha256Hex(rawRefreshToken),
        expiresAt: new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000),
      },
    });

    const expiresIn = this.configService.get<number>(
      'JWT_ACCESS_TTL_SECONDS',
      900,
    );

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn,
      user: this.serializeUser(user),
    };
  }

  private async signAccessToken(
    userId: string,
    role: Role,
    mfaVerifiedAt: number | null,
  ): Promise<string> {
    const expiresIn = this.configService.get<number>(
      'JWT_ACCESS_TTL_SECONDS',
      900,
    );
    const payload: JwtPayload = {
      sub: userId,
      role,
      type: 'access',
      ...(mfaVerifiedAt ? { mfaVerifiedAt } : {}),
    };
    return this.jwtService.signAsync(payload, {
      secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn,
    });
  }

  private serializeUser(
    user: User & { communeScopes?: Array<{ communeId: number }> },
  ) {
    return {
      id: user.id,
      role: user.role,
      fullName: user.fullName,
      phone: user.phone,
      email: user.email,
      locale: user.locale,
      communeId: user.communeId,
      laboratoireId: user.laboratoireId,
      mfaEnabled: user.mfaEnabled,
    };
  }
}
