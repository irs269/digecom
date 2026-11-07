import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, Observable, switchMap } from 'rxjs';
import type { MaybeAuthenticatedRequest } from '../auth/auth.types';
import { AuditService } from './audit.service';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Toute requête mutante authentifiée réussie écrit une entrée d'audit.
 * Les handlers peuvent préciser entité / avant / après via `req.audit`.
 * Les connexions (réussies ou échouées) sont journalisées par AuthService.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<MaybeAuthenticatedRequest>();
    if (!MUTATING.has(req.method)) return next.handle();

    return next.handle().pipe(
      switchMap((result: unknown) => {
        const user = req.user;
        const auditCtx = req.audit;
        if (!user || auditCtx?.skip) return from(Promise.resolve(result));

        const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
        const resultId =
          result && typeof result === 'object' && 'id' in result
            ? String((result as { id: unknown }).id)
            : undefined;
        const entity = auditCtx?.entity ?? ctx.getClass().name.replace(/Controller$/, '');
        return from(
          this.audit
            .record({
              actorId: user.id,
              action: `${req.method} ${route}`,
              entity,
              entityId: auditCtx?.entityId ?? (req.params.id as string | undefined) ?? resultId,
              before: auditCtx?.before,
              after: auditCtx?.after ?? (req.method === 'DELETE' ? undefined : result),
              ip: req.ip,
              userAgent: req.headers['user-agent'],
              requestId: String(req.id),
            })
            .then(() => result),
        );
      }),
    );
  }
}
