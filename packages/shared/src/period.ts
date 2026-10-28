import { DateTime } from 'luxon';
import { z } from 'zod';

export const PERIOD_PRESETS = ['day', 'week', 'month', 'quarter', 'year', 'custom'] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_CUSTOM_PERIOD_DAYS = 366 * 5;

export const periodQuerySchema = z
  .object({
    period: z.enum(PERIOD_PRESETS).default('month'),
    /** Fecha de referencia (YYYY-MM-DD) para los presets; por defecto, hoy en la zona de la empresa. */
    date: z.string().regex(ISO_DATE).optional(),
    /** Solo para `custom`: fechas inclusivas YYYY-MM-DD. */
    from: z.string().regex(ISO_DATE).optional(),
    to: z.string().regex(ISO_DATE).optional(),
  })
  .refine((q) => q.period !== 'custom' || (q.from && q.to), {
    message: 'El periodo personalizado requiere "from" y "to"',
  });
export type PeriodQuery = z.infer<typeof periodQuerySchema>;

export interface ResolvedPeriod {
  preset: PeriodPreset;
  timeZone: string;
  /** Inicio inclusivo, ISO con desfase de la zona horaria. */
  start: string;
  /** Fin exclusivo, ISO con desfase de la zona horaria. */
  end: string;
  /** Fechas calendario inclusivas, para mostrar. */
  fromDate: string;
  toDate: string;
}

/**
 * Convierte un periodo a un intervalo [start, end) en la zona horaria de la empresa.
 * Semanas ISO (lunes a domingo). Los límites respetan cambios de horario.
 */
export function resolvePeriod(query: PeriodQuery, timeZone: string, now: Date = new Date()): ResolvedPeriod {
  let start: DateTime;
  let end: DateTime;

  if (query.period === 'custom') {
    start = DateTime.fromISO(query.from!, { zone: timeZone }).startOf('day');
    const lastDay = DateTime.fromISO(query.to!, { zone: timeZone }).startOf('day');
    if (!start.isValid || !lastDay.isValid) throw new RangeError('Fecha inválida');
    if (lastDay < start) throw new RangeError('"from" debe ser anterior o igual a "to"');
    if (lastDay.diff(start, 'days').days + 1 > MAX_CUSTOM_PERIOD_DAYS) {
      throw new RangeError('El periodo personalizado no puede exceder 5 años');
    }
    end = lastDay.plus({ days: 1 });
  } else {
    const reference = query.date
      ? DateTime.fromISO(query.date, { zone: timeZone })
      : DateTime.fromJSDate(now, { zone: timeZone });
    if (!reference.isValid) throw new RangeError('Fecha inválida');
    const unit = query.period === 'week' ? 'week' : query.period;
    start = reference.startOf(unit);
    end = start.plus({ [`${unit}s`]: 1 });
  }

  return {
    preset: query.period,
    timeZone,
    start: start.toISO()!,
    end: end.toISO()!,
    fromDate: start.toISODate()!,
    toDate: end.minus({ days: 1 }).toISODate()!,
  };
}

export function isValidTimeZone(zone: string): boolean {
  return DateTime.local().setZone(zone).isValid;
}
