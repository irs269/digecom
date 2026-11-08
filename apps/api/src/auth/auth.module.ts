import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuditModule } from '../audit/audit.module';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard, PermissionsGuard } from './guards';
import { LoginRateLimiter } from './login-rate-limiter';

@Module({
  imports: [
    AuditModule,
    JwtModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        secret: env.JWT_ACCESS_SECRET,
        signOptions: { algorithm: 'HS256', issuer: 'digecom-api', audience: 'digecom' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'digecom-api', audience: 'digecom' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    LoginRateLimiter,
    // Ordre important : authentification puis permissions.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
