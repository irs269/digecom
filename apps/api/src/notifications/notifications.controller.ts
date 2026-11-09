import {
  Controller,
  Get,
  Global,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { LiveEvent, NotificationView } from '@digecom/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { REFRESH_COOKIE } from '../auth/auth.controller';
import { sha256 } from '../auth/auth.service';
import type { AuthenticatedRequest, AuthUser } from '../auth/auth.types';
import { AnyAuthenticated, CurrentUser, Public } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { LiveService } from './live.service';
import { ExpoPushProvider } from './expo-push.provider';
import { NotificationService, PushProvider, toNotificationView } from './notification.service';

const listSchema = z.object({ unread: z.enum(['true', 'false']).optional() });

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveService,
  ) {}

  @Get()
  @AnyAuthenticated()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Mes notifications (50 dernières) et nombre de non lues' })
  async list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listSchema)) q: z.infer<typeof listSchema>,
  ): Promise<{ items: NotificationView[]; unread: number }> {
    const [items, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: { userId: user.id, ...(q.unread === 'true' ? { readAt: null } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return { items: items.map(toNotificationView), unread };
  }

  @Post(':id/read')
  @HttpCode(204)
  @AnyAuthenticated()
  @ApiBearerAuth()
  async read(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: AuthenticatedRequest,
  ) {
    req.audit = { skip: true };
    await this.prisma.notification.updateMany({
      where: { id, userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
  }

  @Post('read-all')
  @HttpCode(204)
  @AnyAuthenticated()
  @ApiBearerAuth()
  async readAll(@CurrentUser() user: AuthUser, @Req() req: AuthenticatedRequest) {
    req.audit = { skip: true };
    await this.prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
  }

  /**
   * Flux temps réel (Server-Sent Events). EventSource n'envoie pas d'en-tête Authorization :
   * l'utilisateur est identifié par le cookie httpOnly de session (refresh token valide).
   */
  @Public()
  @Get('stream')
  @ApiOperation({ summary: 'Flux SSE des notifications et des mises à jour de commandes' })
  async stream(@Req() req: Request, @Res() res: Response): Promise<void> {
    const raw = (req.cookies as Record<string, string | undefined>)[REFRESH_COOKIE];
    const token = raw
      ? await this.prisma.refreshToken.findUnique({
          where: { tokenHash: sha256(raw) },
          include: { user: { select: { id: true, isActive: true } } },
        })
      : null;
    if (!token || token.revokedAt || token.expiresAt <= new Date() || !token.user.isActive) {
      res
        .status(HttpStatus.UNAUTHORIZED)
        .json({ code: 'UNAUTHORIZED', message: 'Session expirée' });
      return;
    }
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const write = (type: string, data: unknown) =>
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    write('ready', { at: new Date().toISOString() });

    const unsubscribe = this.live.subscribe(token.user.id, (event: LiveEvent) =>
      write(event.kind, event),
    );
    // Battement toutes les 25 s pour garder la connexion ouverte derrière les proxys.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }
}

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    LiveService,
    NotificationService,
    { provide: PushProvider, useClass: ExpoPushProvider },
  ],
  exports: [LiveService, NotificationService, PushProvider],
})
export class NotificationsModule {}
