import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { loginSchema, type LoginInput, type LoginResponse, type MeResponse } from '@digecom/shared';
import type { CookieOptions, Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { AuthService, type ClientInfo, type IssuedSession } from './auth.service';
import type { AuthUser } from './auth.types';
import { AnyAuthenticated, CurrentUser, Public } from './decorators';

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

  private respond(res: Response, session: IssuedSession): LoginResponse {
    res.cookie(REFRESH_COOKIE, session.refreshToken, this.cookieOptions(session.refreshExpiresAt));
    return { accessToken: session.accessToken, expiresIn: session.expiresIn, user: session.user };
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
    return this.respond(res, await this.auth.login(body, clientInfo(req)));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Renouvelle le jeton d’accès (cookie refresh httpOnly, rotatif)' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const raw = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
    try {
      return this.respond(res, await this.auth.refresh(raw, clientInfo(req)));
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Déconnexion : révoque le refresh token et efface le cookie' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const raw = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
    await this.auth.logout(raw, clientInfo(req));
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }

  @AnyAuthenticated()
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Profil, rôle, île et modules autorisés' })
  me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.auth.me(user.id);
  }
}
