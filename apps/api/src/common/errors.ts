import { HttpException, HttpStatus } from '@nestjs/common';

/** Error de negocio con código estable para la app. Los mensajes se muestran al usuario. */
export class AppError extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super({ error: { code, message, details } }, status);
  }
}

export const Errors = {
  validation: (details: unknown) =>
    new AppError(HttpStatus.BAD_REQUEST, 'VALIDATION_ERROR', 'Los datos enviados no son válidos', details),
  unauthorized: (message = 'Inicia sesión para continuar') =>
    new AppError(HttpStatus.UNAUTHORIZED, 'UNAUTHORIZED', message),
  invalidCredentials: () =>
    new AppError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos'),
  sessionExpired: () =>
    new AppError(HttpStatus.UNAUTHORIZED, 'SESSION_EXPIRED', 'Tu sesión expiró. Inicia sesión de nuevo'),
  accountLocked: (until: Date) =>
    new AppError(
      HttpStatus.TOO_MANY_REQUESTS,
      'ACCOUNT_LOCKED',
      'Demasiados intentos fallidos. Intenta más tarde',
      { retryAfter: until.toISOString() },
    ),
  forbidden: (message = 'No tienes permiso para realizar esta acción') =>
    new AppError(HttpStatus.FORBIDDEN, 'FORBIDDEN', message),
  /** Se usa también cuando el recurso existe pero pertenece a otra empresa: no revela su existencia. */
  notFound: (message = 'Recurso no encontrado') => new AppError(HttpStatus.NOT_FOUND, 'NOT_FOUND', message),
  conflict: (code: string, message: string) => new AppError(HttpStatus.CONFLICT, code, message),
  badRequest: (code: string, message: string) => new AppError(HttpStatus.BAD_REQUEST, code, message),
};
