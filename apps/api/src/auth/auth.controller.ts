import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  changePasswordSchema,
  loginSchema,
  MOBILE_CLIENT_HEADER,
  MOBILE_CLIENT_VALUE,
  type ChangePasswordInput,
  type LoginInput,
  type LoginResponse,
  type MeResponse,
} from '@digecom/shared';
import type { CookieOptions, Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { AuthService, type ClientInfo, type IssuedSession } from './auth.service';
import type { AuthenticatedRequest, AuthUser } from './auth.types';
import { AllowPendingPasswordChange, AnyAuthenticated, CurrentUser, Public } from './decorators';

export const REFRESH_COOKIE = 'dc_rt';

function clientInfo(req: Request): ClientInfo {
  return {
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent'] ?? null,
    requestId: (req as Request & { id?: unknown }).id
      ? String((req as Request & { id?: unknown }).id)
      : null,
  };
}

function isMobile(req: Request): boolean {
  return req.headers[MOBILE_CLIENT_HEADER] === MOBILE_CLIENT_VALUE;
}

/** Refresh token : corps de la requête pour le mobile, cookie httpOnly pour le web. */
function readRefreshToken(req: Request): string | undefined {
  if (isMobile(req)) {
    const body = req.body as { refreshToken?: unknown } | undefined;
    return typeof body?.refreshToken === 'string' ? body.refreshToken : undefined;
  }
  return (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private cookieOptions(expires?: Date): CookieOptions {
    return {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      expires,
    };
  }

  private respond(req: Request, res: Response, session: IssuedSession): LoginResponse {
    const base = {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      user: session.user,
    };
    // Application mobile : pas de cookie, le refresh token est rendu dans le corps (stocké en SecureStore).
    if (isMobile(req)) return { ...base, refreshToken: session.refreshToken };
    res.cookie(REFRESH_COOKIE, session.refreshToken, this.cookieOptions(session.refreshExpiresAt));
    return base;
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Connexion par téléphone et mot de passe' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['phone', 'password'],
      properties: {
        phone: { type: 'string', example: '+2693300001' },
        password: { type: 'string', example: 'Digecom2026!' },
      },
    },
  })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    return this.respond(req, res, await this.auth.login(body, clientInfo(req)));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Renouvelle le jeton d’accès (cookie refresh httpOnly, rotatif)' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const raw = readRefreshToken(req);
    try {
      return this.respond(req, res, await this.auth.refresh(raw, clientInfo(req)));
    } catch (err) {
      if (!isMobile(req)) res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Déconnexion : révoque le refresh token et efface le cookie' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const raw = readRefreshToken(req);
    await this.auth.logout(raw, clientInfo(req));
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  @AnyAuthenticated()
  @AllowPendingPasswordChange()
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Profil, rôle, île et modules autorisés' })
  me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.auth.me(user.id);
  }

  @AnyAuthenticated()
  @AllowPendingPasswordChange()
  @Post('change-password')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Changer mon mot de passe (révoque mes autres sessions)' })
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
    @Req() req: AuthenticatedRequest,
  ): Promise<MeResponse> {
    // Journalisé par AuthService (sans le corps de la requête).
    req.audit = { skip: true };
    const raw = readRefreshToken(req);
    return this.auth.changePassword(user.id, body, raw, clientInfo(req));
  }
}
