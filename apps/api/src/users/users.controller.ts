import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createUserSchema,
  hasPermission,
  LEADER_ROLES,
  reassignSchema,
  updateUserSchema,
  userListQuerySchema,
  type CreateUserInput,
  type CreatedUserResponse,
  type LeaderTeamView,
  type MeResponse,
  type Paginated,
  type ReassignInput,
  type Role,
  type TeamAssignmentView,
  type UpdateUserInput,
  type UserListQuery,
  type UserView,
} from '@digecom/shared';
import { z } from 'zod';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import type { AuthenticatedRequest, AuthUser } from '../auth/auth.types';
import {
  AllowPendingPasswordChange,
  AnyAuthenticated,
  CurrentUser,
  RequirePermission,
} from '../auth/decorators';
import { AppException } from '../common/app-exception';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { UsersService } from './users.service';

/** Gestion des comptes (module `users`, administrateur). */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  @AnyAuthenticated()
  @AllowPendingPasswordChange()
  @Get('me')
  @ApiOperation({ summary: 'Mon profil' })
  me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.auth.me(user.id);
  }

  @Get()
  @RequirePermission('users:read')
  @ApiOperation({ summary: 'Comptes : liste paginée et filtrée' })
  list(
    @Query(new ZodValidationPipe(userListQuerySchema)) q: UserListQuery,
    @CurrentUser() actor: AuthUser,
  ): Promise<Paginated<UserView>> {
    return this.users.list(q, actor);
  }

  @Get(':id')
  @RequirePermission('users:read')
  @ApiOperation({ summary: 'Détail d’un compte' })
  get(@Param('id') id: string, @CurrentUser() actor: AuthUser): Promise<UserView> {
    return this.users.get(id, actor);
  }

  @Get(':id/team-history')
  @RequirePermission('users:read')
  @ApiOperation({ summary: 'Historique des rattachements d’un vendeur' })
  teamHistory(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<TeamAssignmentView[]> {
    return this.users.teamHistory(id, actor);
  }

  @Post()
  @RequirePermission('users:write')
  @ApiOperation({ summary: 'Créer un compte (mot de passe temporaire à changer)' })
  async create(
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<CreatedUserResponse> {
    const result = await this.users.create(body, actor);
    req.audit = {
      action: 'USER_CREATE',
      entity: 'User',
      entityId: result.user.id,
      after: result.user,
    };
    return result;
  }

  @Patch(':id')
  @RequirePermission('users:write')
  @ApiOperation({ summary: 'Modifier un compte (nom, téléphone, rôle, île, site)' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<UserView> {
    const { before, after } = await this.users.update(id, body, actor);
    req.audit = { action: 'USER_UPDATE', entity: 'User', entityId: id, before, after };
    return after;
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermission('users:write')
  @ApiOperation({ summary: 'Désactiver un compte (révoque ses sessions)' })
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<UserView> {
    const { before, after } = await this.users.setActive(id, false, actor);
    req.audit = { action: 'USER_DEACTIVATE', entity: 'User', entityId: id, before, after };
    return after;
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermission('users:write')
  @ApiOperation({ summary: 'Réactiver un compte' })
  async reactivate(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<UserView> {
    const { before, after } = await this.users.setActive(id, true, actor);
    req.audit = { action: 'USER_REACTIVATE', entity: 'User', entityId: id, before, after };
    return after;
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @RequirePermission('users:write')
  @ApiOperation({ summary: 'Réinitialiser le mot de passe (temporaire, déverrouille le compte)' })
  async resetPassword(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<CreatedUserResponse> {
    const result = await this.users.resetPassword(id);
    req.audit = { action: 'USER_RESET_PASSWORD', entity: 'User', entityId: id, after: result.user };
    return result;
  }

  @Post(':id/reassign')
  @HttpCode(200)
  @RequirePermission('network:reassign')
  @ApiOperation({ summary: 'Réaffecter un vendeur à un autre leader (historisé)' })
  async reassign(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reassignSchema)) body: ReassignInput,
    @CurrentUser() actor: AuthUser,
    @Req() req: AuthenticatedRequest,
  ): Promise<UserView> {
    const { before, after } = await this.users.reassign(id, body, actor);
    req.audit = {
      action: 'USER_REASSIGN',
      entity: 'User',
      entityId: id,
      before: { leader: before?.leader, island: before?.island },
      after: { leader: after.leader, island: after.island, reason: body.reason },
    };
    return after;
  }
}

const leaderQuerySchema = z.object({
  role: z.enum(['LEADER_SENIOR', 'LEADER_JUNIOR']).optional(),
  islandId: z.string().optional(),
});

/** Équipes des leaders. */
@ApiTags('leaders')
@ApiBearerAuth()
@Controller()
export class LeadersController {
  constructor(private readonly users: UsersService) {}

  @Get('leaders')
  @RequirePermission('users:read')
  @ApiOperation({ summary: 'Leaders et leurs équipes (administrateur)' })
  leaders(
    @Query(new ZodValidationPipe(leaderQuerySchema)) q: z.infer<typeof leaderQuerySchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<LeaderTeamView[]> {
    return this.users.leaders(q, actor);
  }

  /**
   * Équipe d'un leader : administrateur et lecteurs du réseau commercial pour tous les leaders ;
   * un leader pour sa propre équipe uniquement (autre leader → 404).
   */
  @Get('leaders/:id/team')
  @AnyAuthenticated()
  @ApiOperation({ summary: 'Équipe d’un leader' })
  team(@Param('id') id: string, @CurrentUser() actor: AuthUser): Promise<LeaderTeamView> {
    const canSeeAll =
      hasPermission(actor.role, 'users:read') || hasPermission(actor.role, 'network:read');
    if (!canSeeAll && !LEADER_ROLES.includes(actor.role as Role)) {
      throw new AppException('FORBIDDEN', "Ce module n'est pas accessible à ton profil", 403);
    }
    return this.users.team(id, actor);
  }

  @Get('team-assignments')
  @RequirePermission('users:read')
  @ApiOperation({ summary: 'Historique de toutes les réaffectations' })
  assignments(): Promise<TeamAssignmentView[]> {
    return this.users.history({});
  }
}

@Module({
  imports: [AuthModule],
  controllers: [UsersController, LeadersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
