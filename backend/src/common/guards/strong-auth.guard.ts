import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { STRONG_AUTH_KEY } from '../decorators/strong-auth.decorator';
import { AuthUser } from '../types/auth-user.type';

const STRONG_AUTH_MAX_AGE_MS = 10 * 60 * 1000;

@Injectable()
export class StrongAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiresStrongAuth = this.reflector.getAllAndOverride<boolean>(
      STRONG_AUTH_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiresStrongAuth) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (!user || !user.mfaEnabled || !user.mfaVerifiedAt) {
      throw new ForbiddenException({
        code: 'STRONG_AUTH_REQUIRED',
        message: 'Recent TOTP verification is required',
      });
    }

    const ageMs = Date.now() - user.mfaVerifiedAt;
    if (ageMs < 0 || ageMs > STRONG_AUTH_MAX_AGE_MS) {
      throw new ForbiddenException({
        code: 'STRONG_AUTH_REQUIRED',
        message: 'TOTP verification expired (> 10 minutes)',
      });
    }

    return true;
  }
}
