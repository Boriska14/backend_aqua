import { Injectable } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditLogInput {
  actorId: string | null;
  actorRole: Role | null;
  action: string;
  entityType: string;
  entityId: string;
  reason?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  ip?: string | null;
}

type PrismaTx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(tx: PrismaTx, input: AuditLogInput): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorRole: input.actorRole,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        reason: input.reason ?? null,
        before: input.before === null ? Prisma.DbNull : input.before,
        after: input.after === null ? Prisma.DbNull : input.after,
        ip: input.ip ?? null,
        // Overwritten by SQL trigger trg_audit_chain
        prevHash: '',
        hash: '',
      },
    });
  }

  async verifyChain(): Promise<{
    ok: boolean;
    checked: number;
    brokenSeq: number[];
  }> {
    const [countRes, brokenRows] = await Promise.all([
      this.prisma.auditLog.count(),
      this.prisma.$queryRaw<Array<{ broken_seq: bigint }>>`
        SELECT broken_seq FROM audit_verify_chain()
      `,
    ]);
    const brokenSeq = brokenRows.map((row) => Number(row.broken_seq));
    return {
      ok: brokenSeq.length === 0,
      checked: countRes,
      brokenSeq,
    };
  }
}
