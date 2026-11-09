import { Logger } from '@nestjs/common';
import { Worker, type Job, type Processor } from 'bullmq';
import type { Env } from '../config/env';

/** Connexion BullMQ dérivée de REDIS_URL (mot de passe compris). */
export function redisConnection(env: Env) {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    db: Number(url.pathname.slice(1) || 0),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    maxRetriesPerRequest: null,
  };
}

/** Files BullMQ disponibles (pas en test : jobs déclenchés à la main). */
export const usesQueues = (env: Env) => env.NODE_ENV !== 'test';

/**
 * Le processus traite-t-il les jobs ? `PROCESS_ROLE=api` : non (le service `worker` s'en charge) ;
 * `worker` ou `all` (développement) : oui.
 */
export const runsWorkers = (env: Env) => usesQueues(env) && env.PROCESS_ROLE !== 'api';

type FailureHandler = (queue: string, job: Job | undefined, err: Error) => void | Promise<void>;
let failureHandler: FailureHandler | null = null;

/** Branché par JobAlerts : alerte des administrateurs quand un job échoue. */
export function setJobFailureHandler(handler: FailureHandler | null): void {
  failureHandler = handler;
}

const logger = new Logger('Jobs');

/** Worker BullMQ, seulement si ce processus traite les jobs ; échecs journalisés et alertés. */
export function createWorker<T = unknown, R = unknown>(
  env: Env,
  queue: string,
  processor: Processor<T, R>,
): Worker<T, R> | undefined {
  if (!runsWorkers(env)) return undefined;
  const worker = new Worker<T, R>(queue, processor, { connection: redisConnection(env) });
  worker.on('failed', (job, err) => {
    logger.error({ err, queue, job: job?.name, id: job?.id }, `Job ${queue}/${job?.name} en échec`);
    void Promise.resolve(failureHandler?.(queue, job, err)).catch(() => undefined);
  });
  return worker;
}
