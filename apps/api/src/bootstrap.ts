import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ENV } from './config/config.module';
import { corsOrigins, type Env } from './config/env';
import { rateLimiter, requestMetrics } from './common/http-guards';
import { RedisService } from './redis/redis.module';
import { json } from 'express';

/** Configuration commune à main.ts et aux tests e2e. */
export function configureApp(app: NestExpressApplication): INestApplication {
  const env = app.get<Env>(ENV);
  // Nombre de proxys de confiance devant l'API (req.ip = IP réelle du visiteur, utilisée par la
  // limite de connexion) : 1 en dev (Next.js), 2 en production (Nginx de l'hôte → Next.js).
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  const redis = app.get(RedisService);
  app.use(requestMetrics(redis));
  if (env.NODE_ENV !== 'test')
    app.use(
      rateLimiter(redis, {
        global: env.RATE_LIMIT_PER_MINUTE,
        sensitive: env.RATE_LIMIT_SENSITIVE_PER_MINUTE,
      }),
    );
  // Corps JSON limité à 1 Mo, sauf l'import de contacts (CSV / XLSX en base64, 5 Mo max) : 8 Mo.
  app.use(/^\/campaigns\/[^/]+\/prospects\/import$/, json({ limit: '8mb' }));
  app.useBodyParser('json', { limit: '1mb' });
  app.enableCors({ origin: corsOrigins(env), credentials: true });
  app.enableShutdownHooks();

  const swagger = env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production';
  if (swagger) {
    const config = new DocumentBuilder()
      .setTitle("API Dig'eCom")
      .setDescription('Plateforme de gestion commerciale, logistique et financière')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
  }
  return app;
}
