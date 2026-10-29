import Decimal from 'decimal.js';
import { z } from 'zod';

/**
 * Reglas de dinero (ver docs/reglas-de-redondeo.md):
 * - Los importes viajan como texto decimal ("1234.50"), nunca como number.
 * - Importes de documentos: 2 decimales, redondeo half-up.
 * - Costos unitarios y cantidades de inventario: hasta 6 decimales.
 * - En base de datos: NUMERIC(19,4) para dinero y NUMERIC(19,6) para cantidades.
 */
export const Dec = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = Decimal;

export const MONEY_SCALE = 2;
export const COST_SCALE = 6;
export const QUANTITY_SCALE = 6;

/** Máximo absoluto admitido para un importe: 999,999,999,999,999.9999 cabe en NUMERIC(19,4). */
export const MAX_ABS_AMOUNT = new Dec('999999999999999.9999');

// Entrada textual: hasta 12 decimales; el redondeo a la escala de almacenamiento ocurre después.
const DECIMAL_TEXT = /^-?\d{1,15}(\.\d{1,12})?$/;

export function toDec(value: Decimal.Value): Dec {
  if (typeof value === 'number') {
    throw new TypeError('Los importes deben recibirse como texto o Decimal, no como number');
  }
  if (typeof value === 'string' && !DECIMAL_TEXT.test(value)) {
    throw new RangeError(`Importe inválido: "${value}"`);
  }
  return new Dec(value);
}

export function roundMoney(value: Decimal.Value): Dec {
  return toDec(value).toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP);
}

export function roundCost(value: Decimal.Value): Dec {
  return toDec(value).toDecimalPlaces(COST_SCALE, Decimal.ROUND_HALF_UP);
}

/** Representación canónica para la API: siempre 2 decimales. */
export function formatMoney(value: Decimal.Value): string {
  return roundMoney(value).toFixed(MONEY_SCALE);
}

/**
 * Tasas de IVA que se pueden desglosar en un movimiento (porcentaje, como texto). Son datos
 * gerenciales configurables, no una regla fiscal. null = sin IVA desglosado (exento o no aplica).
 */
export const VAT_RATES = ['16', '8', '0'] as const;
export type VatRate = (typeof VAT_RATES)[number];

/**
 * IVA contenido en un importe que ya lo incluye: total − total / (1 + tasa), a 2 decimales.
 * Ej.: 116.00 al 16 % → 16.00; 100.00 al 16 % → 13.79.
 */
export function vatIncluded(total: Decimal.Value, rate: VatRate | null): Dec {
  if (rate === null || rate === '0') return new Dec(0);
  const amount = toDec(total);
  const base = amount.div(new Dec(1).plus(new Dec(rate).div(100)));
  return roundMoney(amount.minus(base));
}

const MONEY_INPUT = /^\d{1,15}(\.\d{1,2})?$/;

/**
 * Importe no negativo con hasta 2 decimales, como texto. Las comprobaciones numéricas se
 * omiten si el formato ya falló: Zod ejecuta los refine aunque falle la regex, y Dec lanzaría.
 */
export const moneySchema = z
  .string()
  .trim()
  .regex(MONEY_INPUT, 'Importe inválido: usa hasta 2 decimales')
  .refine(
    (v) => !MONEY_INPUT.test(v) || new Dec(v).lte(MAX_ABS_AMOUNT),
    'Importe demasiado grande',
  );

/** Importe estrictamente positivo. */
export const positiveMoneySchema = moneySchema.refine(
  (v) => !MONEY_INPUT.test(v) || new Dec(v).gt(0),
  'Debe ser mayor a cero',
);
