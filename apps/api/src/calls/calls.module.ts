import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  callSignalSchema,
  endCallSchema,
  startCallSchema,
  type CallContact,
  type CallSignalInput,
  type CallView,
  type EndCallInput,
  type LiveEvent,
  type StartCallInput,
  type StartCallResponse,
} from '@digecom/shared';
import type { Response } from 'express';
import { z } from 'zod';
import type { AuthenticatedRequest, AuthUser } from '../auth/auth.types';
import { AnyAuthenticated, CurrentUser } from '../auth/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LiveService } from '../notifications/live.service';
import { CallsService } from './calls.service';

const orderQuery = z.object({ orderId: z.string().min(1) });

@ApiTags('calls')
@ApiBearerAuth()
@Controller('calls')
export class CallsController {
  constructor(
    private readonly calls: CallsService,
    private readonly live: LiveService,
  ) {}

  @Post()
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Appeler : depuis une commande (e-commerçant ↔ livreur) ou un contact' })
  start(
    @Body(new ZodValidationPipe(startCallSchema)) body: StartCallInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<StartCallResponse> {
    req.audit = { skip: true };
    return this.calls.start(body, actor);
  }

  @Get()
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Journal des appels d’une commande' })
  list(
    @Query(new ZodValidationPipe(orderQuery)) q: z.infer<typeof orderQuery>,
    @CurrentUser() actor: AuthUser,
  ): Promise<CallView[]> {
    return this.calls.forOrder(q.orderId, actor);
  }

  @Get('contacts')
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Annuaire : personnes que je peux appeler directement' })
  contacts(@CurrentUser() actor: AuthUser): Promise<CallContact[]> {
    return this.calls.contacts(actor);
  }

  @Get('mine')
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Mes derniers appels (passés et reçus)' })
  mine(@CurrentUser() actor: AuthUser): Promise<CallView[]> {
    return this.calls.mine(actor);
  }

  @Get('ringing')
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Appel qui sonne encore pour moi (ouverture depuis la notification)' })
  ringing(@CurrentUser() actor: AuthUser): Promise<StartCallResponse | null> {
    return this.calls.ringing(actor);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Décrocher' })
  accept(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<StartCallResponse> {
    req.audit = { skip: true };
    return this.calls.accept(id, actor);
  }

  @Post(':id/end')
  @HttpCode(200)
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Raccrocher, refuser ou annuler' })
  end(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(endCallSchema)) body: EndCallInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<CallView> {
    req.audit = { skip: true };
    return this.calls.end(id, actor, body.reason);
  }

  @Post(':id/signal')
  @HttpCode(204)
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Relayer un message WebRTC (offre, réponse, candidat ICE)' })
  async signal(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(callSignalSchema)) body: CallSignalInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    req.audit = { skip: true };
    await this.calls.signal(id, actor, body);
  }

  /**
   * Flux temps réel de l'application mobile (Server-Sent Events, jeton Bearer). Transporte les
   * appels et les mises à jour de commandes ; l'application le rouvre avec un jeton neuf.
   */
  @Get('stream')
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Flux SSE mobile (appels, commandes)' })
  stream(
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): void {
    req.audit = { skip: true };
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const write = (type: string, data: unknown) =>
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    write('ready', { at: new Date().toISOString() });
    const unsubscribe = this.live.subscribe(actor.id, (event: LiveEvent) =>
      write(event.kind, event),
    );
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }
}

@Module({
  controllers: [CallsController],
  providers: [CallsService],
})
export class CallsModule {}
