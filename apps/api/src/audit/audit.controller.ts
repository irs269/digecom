import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  auditQuerySchema,
  endOfBusinessDay,
  startOfBusinessDay,
  type AuditEntryView,
  type AuditQuery,
  type Paginated,
} from '@digecom/shared';
import type { Prisma } from '@prisma/client';
import { RequirePermission } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('audit')
@ApiBearerAuth()
@Controller()
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('audit')
  @RequirePermission('users:read')
  @ApiOperation({ summary: "Journal d'activité (lecture seule, administrateur)" })
  async list(
    @Query(new ZodValidationPipe(auditQuerySchema)) q: AuditQuery,
  ): Promise<Paginated<AuditEntryView>> {
    const where: Prisma.AuditLogWhereInput = {
      actorId: q.actorId,
      entity: q.entity,
      entityId: q.entityId,
      action: q.action ? { contains: q.action, mode: 'insensitive' } : undefined,
      at:
        q.from || q.to
          ? {
              gte: q.from ? startOfBusinessDay(q.from) : undefined,
              lte: q.to ? endOfBusinessDay(q.to) : undefined,
            }
          : undefined,
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ at: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { actor: { select: { id: true, fullName: true, role: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        at: r.at.toISOString(),
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        before: r.before,
        after: r.after,
        ip: r.ip,
        actor: r.actor,
      })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
}
