import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  allowedModules,
  ROLE_LABELS,
  ROLE_SCOPE,
  type ChangePasswordInput,
  type LoginInput,
  type LoginResponse,
  type MeResponse,
} from '@digecom/shared';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import type { AccessTokenPayload } from './auth.types';
import { LoginRateLimiter } from './login-rate-limiter';

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export interface IssuedSession extends LoginResponse {
  refreshToken: string;
  refreshExpiresAt: Date;
}

/** Paramètres argon2id (OWASP : m=19 MiB, t=2, p=1). */
export const ARGON2_OPTIONS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export const hashPassword = (password: string) => argon2.hash(password, ARGON2_OPTIONS);

/** Mot de passe temporaire lisible (sans caractères ambigus), avec lettres et chiffres. */
export function generateTemporaryPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
  const digits = '23456789';
  const pick = (set: string, n: number) =>
    Array.from(randomBytes(n), (b) => set[b % set.length]).join('');
  return `${pick(letters, 4)}-${pick(digits, 4)}-${pick(letters, 4)}`;
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

const invalidCredentials = () =>
  new AppException(
    'INVALID_CREDENTIALS',
    'Téléphone ou mot de passe incorrect',
    HttpStatus.UNAUTHORIZED,
  );

@Injectable()
export class AuthService {
  /** Hash factice pour garder un temps de réponse constant quand le téléphone est inconnu. */
  private dummyHash: Promise<string> = hashPassword(randomBytes(16).toString('hex'));

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly rateLimiter: LoginRateLimiter,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async login(input: LoginInput, client: ClientInfo): Promise<IssuedSession> {
    await this.rateLimiter.hit(client.ip ?? 'unknown', input.phone);

    const user = await this.prisma.user.findUnique({ where: { phone: input.phone } });
    const fail = async (reason: string, userId: string | null) => {
      await this.audit.record({
        actorId: userId,
        action: 'LOGIN_FAILED',
        entity: 'User',
        entityId: userId,
        after: { phone: input.phone, reason },
        ...client,
      });
    };

    if (!user) {
      await argon2.verify(await this.dummyHash, input.password);
      await fail('UNKNOWN_PHONE', null);
      throw invalidCredentials();
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      await fail('LOCKED', user.id);
      throw this.lockedError(user.lockedUntil);
    }
    if (!user.isActive) {
      await fail('INACTIVE', user.id);
      throw new AppException(
        'ACCOUNT_DISABLED',
        'Ce compte est désactivé',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const ok = await argon2.verify(user.passwordHash, input.password);
    if (!ok) {
      const failedLogins = user.failedLogins + 1;
      const lock = failedLogins >= this.env.LOGIN_MAX_ATTEMPTS;
      const lockedUntil = lock ? new Date(now.getTime() + this.env.LOCKOUT_MINUTES * 60_000) : null;
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: lock ? 0 : failedLogins, lockedUntil },
      });
      await fail(lock ? 'BAD_PASSWORD_LOCKED' : 'BAD_PASSWORD', user.id);
      if (lockedUntil) throw this.lockedError(lockedUntil);
      throw invalidCredentials();
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: now },
    });
    const session = await this.issueSession(user.id, client);
    await this.audit.record({
      actorId: user.id,
      action: 'LOGIN_SUCCESS',
      entity: 'User',
      entityId: user.id,
      ...client,
    });
    return session;
  }

  /** Rotation du refresh token : l'ancien est révoqué, un nouveau est émis. */
  async refresh(rawToken: string | undefined, client: ClientInfo): Promise<IssuedSession> {
    const expired = () =>
      new AppException(
        'SESSION_EXPIRED',
        'Session expirée, reconnecte-toi',
        HttpStatus.UNAUTHORIZED,
      );
    if (!rawToken) throw expired();

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { user: { select: { isActive: true } } },
    });
    if (!stored) throw expired();

    if (stored.revokedAt) {
      // Réutilisation d'un jeton déjà tourné : vol probable → on révoque toutes les sessions.
      await this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        actorId: stored.userId,
        action: 'REFRESH_TOKEN_REUSE',
        entity: 'RefreshToken',
        entityId: stored.id,
        ...client,
      });
      throw expired();
    }
    if (stored.expiresAt <= new Date() || !stored.user.isActive) throw expired();

    // Révocation conditionnelle : si deux requêtes tournent le même jeton, une seule gagne.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw expired();

    const session = await this.issueSession(stored.userId, client);
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { replacedById: session.refreshTokenId },
    });
    return session;
  }

  async logout(rawToken: string | undefined, client: ClientInfo): Promise<void> {
    if (!rawToken) return;
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
    });
    if (!stored) return;
    await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      actorId: stored.userId,
      action: 'LOGOUT',
      entity: 'User',
      entityId: stored.userId,
      ...client,
    });
  }

  /** Changement de mot de passe par l'utilisateur : les autres sessions sont révoquées. */
  async changePassword(
    userId: string,
    input: ChangePasswordInput,
    currentRefreshToken: string | undefined,
    client: ClientInfo,
  ): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await argon2.verify(user.passwordHash, input.currentPassword))) {
      throw new AppException(
        'VALIDATION_ERROR',
        'Mot de passe actuel incorrect',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'currentPassword', message: 'Mot de passe actuel incorrect' }],
      );
    }
    const keep = currentRefreshToken ? sha256(currentRefreshToken) : undefined;
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash: await hashPassword(input.newPassword), mustChangePassword: false },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null, ...(keep ? { tokenHash: { not: keep } } : {}) },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      actorId: userId,
      action: 'PASSWORD_CHANGE',
      entity: 'User',
      entityId: userId,
      after: { forced: user.mustChangePassword },
      ...client,
    });
    return this.me(userId);
  }

  async me(userId: string): Promise<MeResponse> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        island: { select: { id: true, code: true, name: true } },
        site: { select: { id: true, name: true } },
      },
    });
    return {
      id: user.id,
      fullName: user.fullName,
      phone: user.phone,
      role: user.role,
      roleLabel: ROLE_LABELS[user.role],
      scope: ROLE_SCOPE[user.role],
      island: user.island,
      site: user.site,
      mustChangePassword: user.mustChangePassword,
      modules: allowedModules(user.role),
      ...(user.role === 'COURIER' ? { isAvailable: user.isAvailable } : {}),
    };
  }

  private lockedError(until: Date): AppException {
    return new AppException(
      'ACCOUNT_LOCKED',
      `Compte verrouillé après ${this.env.LOGIN_MAX_ATTEMPTS} échecs. Réessaie après ${until.toLocaleTimeString('fr-FR', { timeZone: 'Indian/Comoro', hour: '2-digit', minute: '2-digit' })}.`,
      HttpStatus.UNAUTHORIZED,
      { lockedUntil: until.toISOString() },
    );
  }

  private async issueSession(
    userId: string,
    client: ClientInfo,
  ): Promise<IssuedSession & { refreshTokenId: string }> {
    const user = await this.me(userId);
    const payload: AccessTokenPayload = { sub: user.id, role: user.role };
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: this.env.JWT_ACCESS_TTL_SECONDS,
    });

    const refreshToken = randomBytes(48).toString('base64url');
    const refreshExpiresAt = new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    const stored = await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        expiresAt: refreshExpiresAt,
        ip: client.ip,
        userAgent: client.userAgent?.slice(0, 500) ?? null,
      },
    });

    return {
      accessToken,
      expiresIn: this.env.JWT_ACCESS_TTL_SECONDS,
      user,
      refreshToken,
      refreshExpiresAt,
      refreshTokenId: stored.id,
    };
  }
}
