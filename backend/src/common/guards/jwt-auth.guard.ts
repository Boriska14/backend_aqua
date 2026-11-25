import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@prisma/client';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthUser, JwtPayload } from '../types/auth-user.type';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Missing bearer token',
      });
    }

    const token = authHeader.slice(7).trim();
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid or expired access token',
      });
    }

    if (payload.type !== 'access' || !payload.sub) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'Invalid token type',
      });
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { communeScopes: { select: { communeId: true } } },
    });

    if (
      !user ||
      user.status === UserStatus.DISABLED ||
      user.status === UserStatus.LOCKED ||
      (user.lockedUntil && user.lockedUntil > new Date())
    ) {
      throw new UnauthorizedException({
        code: 'UNAUTHORIZED',
        message: 'User account inactive or locked',
      });
    }

    const communeScopeIds = new Set<number>(
      user.communeScopes.map((s) => s.communeId),
    );
    if (user.communeId) {
      communeScopeIds.add(user.communeId);
    }

    request.user = {
      id: user.id,
      role: user.role,
      fullName: user.fullName,
      phone: user.phone,
      email: user.email,
      locale: user.locale,
      communeId: user.communeId,
      communeScopeIds: Array.from(communeScopeIds),
      laboratoireId: user.laboratoireId,
      organisationId: user.organisationId,
      habilitationUntil: user.habilitationUntil
        ? user.habilitationUntil.toISOString()
        : null,
      mfaEnabled: user.mfaEnabled,
      mfaVerifiedAt: payload.mfaVerifiedAt ?? null,
    };

    return true;
  }
}
