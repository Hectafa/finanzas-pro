import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Prisma } from '../generated/prisma/client';
import { AppError } from './errors';

const GENERIC_CODES: Record<number, [string, string]> = {
  400: ['BAD_REQUEST', 'Solicitud inválida'],
  401: ['UNAUTHORIZED', 'Inicia sesión para continuar'],
  403: ['FORBIDDEN', 'No tienes permiso para realizar esta acción'],
  404: ['NOT_FOUND', 'Recurso no encontrado'],
  405: ['METHOD_NOT_ALLOWED', 'Método no permitido'],
  409: ['CONFLICT', 'El registro entra en conflicto con otro existente'],
  413: ['PAYLOAD_TOO_LARGE', 'La solicitud es demasiado grande'],
  429: ['TOO_MANY_REQUESTS', 'Demasiadas solicitudes. Intenta más tarde'],
};

/** Todas las respuestas de error tienen la forma { error: { code, message, details?, requestId } }. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();
    const requestId = req.id ? String(req.id) : undefined;

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: { code: string; message: string; details?: unknown };

    if (exception instanceof AppError) {
      status = exception.getStatus();
      body = {
        code: exception.code,
        message: (exception.getResponse() as { error: { message: string } }).error.message,
        details: exception.details,
      };
    } else if (exception instanceof ThrottlerException) {
      status = HttpStatus.TOO_MANY_REQUESTS;
      body = { code: 'TOO_MANY_REQUESTS', message: GENERIC_CODES[429]![1] };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const [code, message] = GENERIC_CODES[status] ?? ['HTTP_ERROR', 'Error en la solicitud'];
      body = { code, message };
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2002'
    ) {
      status = HttpStatus.CONFLICT;
      body = { code: 'CONFLICT', message: GENERIC_CODES[409]![1] };
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2025'
    ) {
      status = HttpStatus.NOT_FOUND;
      body = { code: 'NOT_FOUND', message: GENERIC_CODES[404]![1] };
    } else {
      body = { code: 'INTERNAL_ERROR', message: 'Ocurrió un error inesperado' };
    }

    if (status >= 500) {
      // Solo nombre y stack: nunca el cuerpo de la solicitud (puede contener contraseñas o tokens).
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(
        { requestId, err: { name: err.name, message: err.message, stack: err.stack } },
        'Error no controlado',
      );
    }

    res.status(status).json({ error: { ...body, requestId } });
  }
}
