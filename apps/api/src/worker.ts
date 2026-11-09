import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

/**
 * Processus `worker` (production) : même image que l'API, sans serveur HTTP. Traite les jobs
 * BullMQ (abonnements, relevés, alertes livreurs, invendus, campagnes, exports volumineux).
 */
async function bootstrap(): Promise<void> {
  process.env.PROCESS_ROLE = 'worker';
  const app = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.get(Logger).log('Worker Dig’eCom prêt (jobs BullMQ)');
}

void bootstrap();
