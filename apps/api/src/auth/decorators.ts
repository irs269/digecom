import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@digecom/shared';
import type { AuthenticatedRequest, AuthUser } from './auth.types';

export const IS_PUBLIC = 'isPublic';
export const ANY_AUTHENTICATED = 'anyAuthenticated';
export const REQUIRED_PERMISSIONS = 'requiredPermissions';

/** Endpoint ouvert sans authentification. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Endpoint réservé aux utilisateurs connectés, quel que soit leur rôle (ex. `GET /auth/me`). */
export const AnyAuthenticated = () => SetMetadata(ANY_AUTHENTICATED, true);

/**
 * Permission requise (`module:read`, `module:write` ou action fine).
 * Sans ce décorateur, `@Public()` ou `@AnyAuthenticated()`, l'endpoint est refusé (403).
 */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<AuthenticatedRequest>().user,
);
