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

/** Importe no negativo con hasta 2 decimales, como texto. */
export const moneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,15}(\.\d{1,2})?$/, 'Importe inválido: usa hasta 2 decimales')
  .refine((v) => new Dec(v).lte(MAX_ABS_AMOUNT), 'Importe demasiado grande');

/** Importe estrictamente positivo. */
export const positiveMoneySchema = moneySchema.refine((v) => new Dec(v).gt(0), 'Debe ser mayor a cero');
