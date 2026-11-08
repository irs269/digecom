import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ENV } from './config/config.module';
import type { Env } from './config/env';

/** Configuration commune à main.ts et aux tests e2e. */
export function configureApp(app: NestExpressApplication): INestApplication {
  const env = app.get<Env>(ENV);
  // L'API est derrière le proxy Next.js / un reverse proxy : req.ip = IP réelle du client.
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cookieParser());
  // Import de contacts (CSV / XLSX en base64, 5 Mo max) : corps JSON jusqu'à 8 Mo.
  app.useBodyParser('json', { limit: '8mb' });
  app.enableCors({ origin: [env.WEB_ORIGIN], credentials: true });
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
