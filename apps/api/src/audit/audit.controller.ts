import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { paginationSchema, type PaginationInput } from '@digecom/shared';
import { z } from 'zod';
import { RequirePermission } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';

const auditQuerySchema = paginationSchema.extend({
  entity: z.string().optional(),
  actorId: z.string().optional(),
  action: z.string().optional(),
});
type AuditQuery = PaginationInput & z.infer<typeof auditQuerySchema>;

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('users:read')
  @ApiOperation({ summary: "Journal d'audit paginé (administrateur)" })
  async list(@Query(new ZodValidationPipe(auditQuerySchema)) q: AuditQuery) {
    const where = {
      entity: q.entity,
      actorId: q.actorId,
      action: q.action ? { contains: q.action } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { at: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { actor: { select: { id: true, fullName: true, role: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
}
