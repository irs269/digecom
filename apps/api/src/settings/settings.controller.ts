import { Body, Controller, Get, Global, Module, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  isSettingKey,
  settingUpdateSchema,
  startOfBusinessDay,
  type SettingUpdateInput,
  type SettingVersion,
  type SettingView,
} from '@digecom/shared';
import { z } from 'zod';
import type { AuthenticatedRequest, AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { AppException } from '../common/app-exception';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { SettingsService } from './settings.service';

const atQuerySchema = z.object({
  at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date au format AAAA-MM-JJ')
    .optional(),
});

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermission('settings:read')
  @ApiOperation({ summary: 'Paramètres : valeurs en vigueur, versions prévues et historique' })
  list(): Promise<SettingView[]> {
    return this.settings.views();
  }

  @Get(':key')
  @RequirePermission('settings:read')
  @ApiOperation({ summary: 'Valeur d’un paramètre à une date (fin de journée, heure des Comores)' })
  async get(
    @Param('key') key: string,
    @Query(new ZodValidationPipe(atQuerySchema)) q: z.infer<typeof atQuerySchema>,
  ) {
    if (!isSettingKey(key)) throw new AppException('NOT_FOUND', 'Paramètre inconnu', 404);
    // `at` = un jour : on lit la valeur en vigueur ce jour-là (version datée de ce jour incluse).
    const at = q.at ? new Date(startOfBusinessDay(q.at).getTime() + 86_400_000 - 1) : new Date();
    return { key, at: at.toISOString(), value: await this.settings.get(key, at) };
  }

  @Post(':key')
  @RequirePermission('settings:edit')
  @ApiOperation({ summary: 'Nouvelle version d’un paramètre (date d’effet ≥ aujourd’hui)' })
  async create(
    @Param('key') key: string,
    @Body(new ZodValidationPipe(settingUpdateSchema)) body: SettingUpdateInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<SettingVersion> {
    const { before, after } = await this.settings.createVersion(
      key,
      body.value,
      body.effectiveFrom,
      actor.id,
    );
    req.audit = {
      action: 'SETTING_VERSION',
      entity: 'Setting',
      entityId: key,
      before: { value: before },
      after: { value: after.value, effectiveFrom: after.effectiveFrom },
    };
    return after;
  }
}

@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
