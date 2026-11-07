import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { ApiError } from '@digecom/shared';
import type { Response } from 'express';
import { AppException } from './app-exception';

const DEFAULT_CODES: Record<number, { code: string; message: string }> = {
  400: { code: 'BAD_REQUEST', message: 'Requête invalide' },
  401: { code: 'UNAUTHORIZED', message: 'Authentification requise' },
  403: { code: 'FORBIDDEN', message: "Ce module n'est pas accessible à ton profil" },
  404: { code: 'NOT_FOUND', message: 'Ressource introuvable' },
  409: { code: 'CONFLICT', message: 'Conflit avec l’état actuel de la ressource' },
  422: { code: 'VALIDATION_ERROR', message: 'Données invalides' },
  429: { code: 'TOO_MANY_REQUESTS', message: 'Trop de tentatives, réessaie plus tard' },
  500: { code: 'INTERNAL_ERROR', message: 'Erreur interne' },
};

/** Filtre global : toutes les erreurs sortent au format `{ code, message, details }`. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ApiError;

    if (exception instanceof AppException) {
      status = exception.getStatus();
      body = { code: exception.code, message: exception.message, details: exception.details };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const fallback = DEFAULT_CODES[status] ?? { code: 'HTTP_ERROR', message: exception.message };
      body = { code: fallback.code, message: fallback.message };
    } else {
      this.logger.error(exception);
      body = DEFAULT_CODES[500]!;
    }

    res.status(status).json(body);
  }
}
