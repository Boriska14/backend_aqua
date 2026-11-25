import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import {
  getPaginationParams,
  paginate,
} from '../../common/pagination/paginate.helper';
import { AuthUser } from '../../common/types/auth-user.type';
import { normalizeCameroonPhone } from '../../common/utils/crypto.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateUserDto,
  ListUsersQueryDto,
  UpdateUserDto,
} from './dto/user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(query: ListUsersQueryDto) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          role: true,
          status: true,
          fullName: true,
          phone: true,
          email: true,
          locale: true,
          communeId: true,
          laboratoireId: true,
          organisationId: true,
          habilitationUntil: true,
          mfaEnabled: true,
          mustChangePassword: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return paginate(rows, total, page, limit);
  }

  async create(actor: AuthUser, dto: CreateUserDto, ip?: string | null) {
    const phone = normalizeCameroonPhone(dto.phone);
    if (!phone) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid phone number format (E.164 expected)',
      });
    }

    const email = dto.email?.trim().toLowerCase() ?? null;
    const existing = await this.prisma.user.findFirst({
      where: {
        OR: [{ phone }, ...(email ? [{ email }] : [])],
      },
    });
    if (existing) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: 'Phone or email already exists',
      });
    }

    const tempPassword =
      dto.initialPassword || randomBytes(12).toString('base64url');
    const passwordHash = await argon2.hash(tempPassword);

    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          role: dto.role,
          fullName: dto.fullName.trim(),
          phone,
          email,
          passwordHash,
          mustChangePassword: true,
          communeId: dto.communeId ?? null,
          laboratoireId: dto.laboratoireId ?? null,
          organisationId: dto.organisationId ?? null,
          habilitationUntil: dto.habilitationUntil
            ? new Date(dto.habilitationUntil)
            : null,
        },
      });

      const scopeIds = new Set<number>(dto.communeScopeIds ?? []);
      if (dto.communeId) {
        scopeIds.add(dto.communeId);
      }
      if (scopeIds.size > 0) {
        await tx.userCommuneScope.createMany({
          data: Array.from(scopeIds).map((communeId) => ({
            userId: user.id,
            communeId,
          })),
        });
      }

      await this.auditService.log(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'USER_CREATED',
        entityType: 'User',
        entityId: user.id,
        after: { role: user.role, communeId: user.communeId },
        ip,
      });

      return user;
    });

    return {
      id: created.id,
      role: created.role,
      fullName: created.fullName,
      phone: created.phone,
      email: created.email,
      communeId: created.communeId,
      laboratoireId: created.laboratoireId,
      mfaEnabled: created.mfaEnabled,
      mustChangePassword: created.mustChangePassword,
      ...(dto.initialPassword
        ? {}
        : { generatedInitialPassword: tempPassword }),
    };
  }

  async update(
    actor: AuthUser,
    id: string,
    dto: UpdateUserDto,
    ip?: string | null,
  ) {
    const existing = await this.prisma.user.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'User not found',
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.reset2fa) {
        await tx.totpSecret.deleteMany({ where: { userId: id } });
        await tx.backupCode.deleteMany({ where: { userId: id } });
      }

      if (dto.communeScopeIds) {
        await tx.userCommuneScope.deleteMany({ where: { userId: id } });
        if (dto.communeScopeIds.length > 0) {
          await tx.userCommuneScope.createMany({
            data: dto.communeScopeIds.map((communeId) => ({
              userId: id,
              communeId,
            })),
          });
        }
      }

      const user = await tx.user.update({
        where: { id },
        data: {
          ...(dto.status !== undefined ? { status: dto.status } : {}),
          ...(dto.role !== undefined ? { role: dto.role } : {}),
          ...(dto.communeId !== undefined ? { communeId: dto.communeId } : {}),
          ...(dto.laboratoireId !== undefined
            ? { laboratoireId: dto.laboratoireId }
            : {}),
          ...(dto.habilitationUntil !== undefined
            ? { habilitationUntil: new Date(dto.habilitationUntil) }
            : {}),
          ...(dto.reset2fa ? { mfaEnabled: false } : {}),
        },
        select: {
          id: true,
          role: true,
          status: true,
          fullName: true,
          phone: true,
          email: true,
          communeId: true,
          laboratoireId: true,
          mfaEnabled: true,
          habilitationUntil: true,
        },
      });

      await this.auditService.log(tx, {
        actorId: actor.id,
        actorRole: actor.role,
        action: dto.reset2fa ? 'USER_2FA_RESET' : 'USER_UPDATED',
        entityType: 'User',
        entityId: id,
        before: {
          role: existing.role,
          status: existing.status,
          mfaEnabled: existing.mfaEnabled,
        },
        after: {
          role: user.role,
          status: user.status,
          mfaEnabled: user.mfaEnabled,
        },
        ip,
      });

      return user;
    });

    return updated;
  }
}
