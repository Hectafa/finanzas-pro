import type { Permission } from '@finanzas/shared';
import { DateTime } from 'luxon';
import { Errors } from '../common/errors';
import type { TenantContext } from '../common/request-context';
import type { Tx } from '../db/db.service';

/** Exige al menos uno de los permisos (@Authorize exige todos). */
export function requireAny(t: TenantContext, ...permissions: Permission[]): void {
  if (!permissions.some((p) => t.permissions.has(p))) throw Errors.forbidden();
}

/** Hoy (YYYY-MM-DD) en la zona horaria de la empresa. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return DateTime.fromJSDate(now).setZone(timeZone).toISODate()!;
}

export async function companySettings(tx: Tx, companyId: string) {
  return tx.company.findUniqueOrThrow({
    where: { id: companyId },
    select: { currency: true, timeZone: true },
  });
}

/** Rechaza fechas futuras: un hecho económico no puede registrarse antes de ocurrir. */
export function assertNotFuture(date: string, timeZone: string, field = 'date'): void {
  if (date > todayIn(timeZone)) {
    throw Errors.validation([{ path: field, message: 'La fecha no puede ser futura' }]);
  }
}

export const versionConflict = (what: string) =>
  Errors.conflict(
    'VERSION_CONFLICT',
    `Otra persona modificó ${what}. Recarga para ver los cambios`,
  );
