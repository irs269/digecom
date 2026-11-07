import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

const SENSITIVE_KEYS = /password|token|secret|hash/i;

/** Retire les champs sensibles avant écriture dans le journal. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEYS.test(k) ? '[masqué]' : redact(v)]),
    );
  }
  return value;
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(redact(value))) as Prisma.InputJsonValue;
}

/** Journal d'audit append-only (UPDATE/DELETE bloqués en base par trigger). */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId ?? null,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          before: toJson(entry.before),
          after: toJson(entry.after),
          ip: entry.ip ?? null,
          userAgent: entry.userAgent?.slice(0, 500) ?? null,
          requestId: entry.requestId ?? null,
        },
      });
    } catch (err) {
      // L'audit ne doit jamais être perdu en silence.
      this.logger.error(
        { err, entry: { ...entry, before: undefined, after: undefined } },
        'Échec écriture audit',
      );
      throw err;
    }
  }
}
