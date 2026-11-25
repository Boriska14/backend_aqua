import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import {
  AUDITED_KEY,
  AuditedOptions,
} from '../../common/decorators/audited.decorator';
import { AuthUser } from '../../common/types/auth-user.type';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from './audit.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.getAllAndOverride<AuditedOptions>(
      AUDITED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!metadata) {
      return next.handle();
    }

    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const entityId =
      (metadata.entityIdParam &&
        req.params &&
        req.params[metadata.entityIdParam]) ||
      'system';
    const ip = req.ip || null;

    return next.handle().pipe(
      tap(() => {
        void this.auditService.log(this.prisma, {
          actorId: req.user?.id ?? null,
          actorRole: req.user?.role ?? null,
          action: metadata.action,
          entityType: metadata.entityType,
          entityId: String(entityId),
          ip,
        });
      }),
    );
  }
}
