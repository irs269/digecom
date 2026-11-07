import { Controller, Get, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { MeResponse } from '@digecom/shared';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { AnyAuthenticated, CurrentUser } from '../auth/decorators';

/** Phase 0 : lecture de soi uniquement. La gestion des utilisateurs arrive en phase 1. */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly auth: AuthService) {}

  @AnyAuthenticated()
  @Get('me')
  @ApiOperation({ summary: 'Mon profil' })
  me(@CurrentUser() user: AuthUser): Promise<MeResponse> {
    return this.auth.me(user.id);
  }
}

@Module({ imports: [AuthModule], controllers: [UsersController] })
export class UsersModule {}
