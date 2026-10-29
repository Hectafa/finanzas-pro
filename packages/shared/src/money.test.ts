import { describe, expect, it } from 'vitest';
import { Dec, formatMoney, moneySchema, positiveMoneySchema, roundCost, roundMoney, toDec } from './money';

describe('money', () => {
  it('suma decimales sin error de punto flotante', () => {
    expect(toDec('0.1').plus('0.2').eq('0.3')).toBe(true);
  });

  it('redondea half-up a 2 decimales', () => {
    expect(formatMoney('2.345')).toBe('2.35');
    expect(formatMoney('2.344')).toBe('2.34');
    expect(formatMoney('-2.345')).toBe('-2.35');
    expect(formatMoney('10')).toBe('10.00');
  });

  it('redondea costos a 6 decimales', () => {
    expect(roundCost('1.23456789').toFixed()).toBe('1.234568');
  });

  it('rechaza number para evitar flotantes', () => {
    expect(() => toDec(0.1)).toThrow(TypeError);
  });

  it('rechaza texto no decimal', () => {
    expect(() => toDec('1e5')).toThrow(RangeError);
    expect(() => toDec('abc')).toThrow(RangeError);
    expect(() => toDec('1,000.00')).toThrow(RangeError);
  });

  it('maneja importes extremos con precisión', () => {
    const big = toDec('999999999999999.99');
    expect(big.plus('0.01').toFixed(2)).toBe('1000000000000000.00');
    expect(roundMoney('0.005').toFixed(2)).toBe('0.01');
  });

  it('valida importes de entrada', () => {
    expect(moneySchema.safeParse('1500.50').success).toBe(true);
    expect(moneySchema.safeParse('0').success).toBe(true);
    expect(moneySchema.safeParse('-1').success).toBe(false);
    expect(moneySchema.safeParse('1.005').success).toBe(false);
    expect(moneySchema.safeParse('9999999999999999').success).toBe(false);
    expect(positiveMoneySchema.safeParse('0.00').success).toBe(false);
    expect(positiveMoneySchema.safeParse('0.01').success).toBe(true);
  });

  it('Dec usa redondeo half-up por defecto', () => {
    expect(new Dec('1').div('3').toDecimalPlaces(2).toFixed(2)).toBe('0.33');
  });
});
