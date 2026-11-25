import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma, Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import {
  getPaginationParams,
  paginate,
} from '../../common/pagination/paginate.helper';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto/audit-query.dto';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @Roles(Role.MINEE, Role.ADMIN)
  @ApiOperation({ summary: "Journal d'audit (lecture seule)" })
  async list(@Query() query: AuditQueryDto) {
    const { skip, take, page, limit } = getPaginationParams(query);
    const where: Prisma.AuditLogWhereInput = {
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.from || query.to
        ? {
            ts: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { seq: 'desc' },
        skip,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return paginate(
      rows.map((row) => ({
        ...row,
        seq: Number(row.seq),
      })),
      total,
      page,
      limit,
    );
  }

  @Get('verify-chain')
  @Roles(Role.MINEE, Role.ADMIN)
  @ApiOperation({ summary: "Vérifie l'intégrité de la chaîne SHA-256" })
  async verifyChain() {
    return this.auditService.verifyChain();
  }
}
