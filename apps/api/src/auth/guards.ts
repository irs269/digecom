import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { hasPermission, type Permission } from '@digecom/shared';
import { AppException } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload, MaybeAuthenticatedRequest } from './auth.types';
import {
  ALLOW_PENDING_PASSWORD,
  ANY_AUTHENTICATED,
  IS_PUBLIC,
  REQUIRED_PERMISSIONS,
} from './decorators';

function meta<T>(reflector: Reflector, key: string, ctx: ExecutionContext): T | undefined {
  return reflector.getAllAndOverride<T>(key, [ctx.getHandler(), ctx.getClass()]);
}

/** Garde globale : exige un JWT d'accès valide, sauf `@Public()`. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (meta<boolean>(this.reflector, IS_PUBLIC, ctx)) return true;

    const req = ctx.switchToHttp().getRequest<MaybeAuthenticatedRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new AppException('UNAUTHORIZED', 'Authentification requise', HttpStatus.UNAUTHORIZED);
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new AppException('TOKEN_EXPIRED', 'Session expirée', HttpStatus.UNAUTHORIZED);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        role: true,
        islandId: true,
        siteId: true,
        leaderId: true,
        isActive: true,
        mustChangePassword: true,
      },
    });
    if (!user || !user.isActive) {
      throw new AppException('UNAUTHORIZED', 'Compte inactif', HttpStatus.UNAUTHORIZED);
    }
    req.user = {
      id: user.id,
      role: user.role,
      islandId: user.islandId,
      siteId: user.siteId,
      leaderId: user.leaderId,
      mustChangePassword: user.mustChangePassword,
    };
    return true;
  }
}

/**
 * Garde globale : vérifie la permission déclarée avec `@RequirePermission()` dans la matrice
 * partagée. Refus par défaut si l'endpoint ne déclare rien.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (meta<boolean>(this.reflector, IS_PUBLIC, ctx)) return true;

    const req = ctx.switchToHttp().getRequest<MaybeAuthenticatedRequest>();
    if (!req.user) {
      throw new AppException('UNAUTHORIZED', 'Authentification requise', HttpStatus.UNAUTHORIZED);
    }
    if (
      req.user.mustChangePassword &&
      !meta<boolean>(this.reflector, ALLOW_PENDING_PASSWORD, ctx)
    ) {
      throw new AppException(
        'PASSWORD_CHANGE_REQUIRED',
        'Change ton mot de passe temporaire avant de continuer',
        HttpStatus.FORBIDDEN,
      );
    }
    if (meta<boolean>(this.reflector, ANY_AUTHENTICATED, ctx)) return true;

    const required = meta<Permission[]>(this.reflector, REQUIRED_PERMISSIONS, ctx);
    if (!required?.length) {
      throw new AppException(
        'FORBIDDEN',
        'Endpoint sans permission déclarée : accès refusé par défaut',
        HttpStatus.FORBIDDEN,
      );
    }
    const role = req.user.role;
    if (!required.every((p) => hasPermission(role, p))) {
      throw new AppException(
        'FORBIDDEN',
        "Ce module n'est pas accessible à ton profil",
        HttpStatus.FORBIDDEN,
        { required },
      );
    }
    return true;
  }
}
