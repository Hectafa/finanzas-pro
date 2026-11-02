import { describe, expect, it } from 'vitest';
import { addDays, periodQuerySchema, resolvePeriod, todayIn } from './period';

const MX = 'America/Mexico_City';

describe('resolvePeriod', () => {
  it('mes: del primer día al primer día del mes siguiente', () => {
    const p = resolvePeriod({ period: 'month', date: '2026-02-15' }, MX);
    expect(p.fromDate).toBe('2026-02-01');
    expect(p.toDate).toBe('2026-02-28');
    expect(p.start).toBe('2026-02-01T00:00:00.000-06:00');
    expect(p.end).toBe('2026-03-01T00:00:00.000-06:00');
  });

  it('año bisiesto', () => {
    const p = resolvePeriod({ period: 'month', date: '2028-02-10' }, MX);
    expect(p.toDate).toBe('2028-02-29');
  });

  it('semana ISO: lunes a domingo', () => {
    const p = resolvePeriod({ period: 'week', date: '2026-10-28' }, MX);
    expect(p.fromDate).toBe('2026-10-26');
    expect(p.toDate).toBe('2026-11-01');
  });

  it('trimestre y año', () => {
    expect(resolvePeriod({ period: 'quarter', date: '2026-05-20' }, MX).fromDate).toBe(
      '2026-04-01',
    );
    const y = resolvePeriod({ period: 'year', date: '2026-12-31' }, MX);
    expect(y.fromDate).toBe('2026-01-01');
    expect(y.toDate).toBe('2026-12-31');
  });

  it('día usando "now" en la zona de la empresa, no en UTC', () => {
    // 2026-10-28 03:00 UTC es todavía 27 de octubre en Ciudad de México.
    const p = resolvePeriod({ period: 'day' }, MX, new Date('2026-10-28T03:00:00Z'));
    expect(p.fromDate).toBe('2026-10-27');
  });

  it('respeta cambios de horario (zona con horario de verano)', () => {
    const p = resolvePeriod({ period: 'day', date: '2026-03-08' }, 'America/Tijuana');
    expect(p.start).toBe('2026-03-08T00:00:00.000-08:00');
    expect(p.end).toBe('2026-03-09T00:00:00.000-07:00');
  });

  it('personalizado inclusivo', () => {
    const p = resolvePeriod({ period: 'custom', from: '2026-01-15', to: '2026-01-20' }, MX);
    expect(p.fromDate).toBe('2026-01-15');
    expect(p.toDate).toBe('2026-01-20');
    expect(p.end).toBe('2026-01-21T00:00:00.000-06:00');
  });

  it('rechaza rangos invertidos y excesivos', () => {
    expect(() =>
      resolvePeriod({ period: 'custom', from: '2026-02-01', to: '2026-01-01' }, MX),
    ).toThrow();
    expect(() =>
      resolvePeriod({ period: 'custom', from: '2015-01-01', to: '2026-01-01' }, MX),
    ).toThrow();
  });

  it('el esquema exige from/to en personalizado y aplica month por defecto', () => {
    expect(periodQuerySchema.safeParse({ period: 'custom', from: '2026-01-01' }).success).toBe(
      false,
    );
    expect(periodQuerySchema.parse({}).period).toBe('month');
  });
});

describe('todayIn / addDays', () => {
  it('"hoy" es el de la zona de la empresa, no el UTC', () => {
    // 03:30 UTC del 1 de noviembre todavía es 31 de octubre en la Ciudad de México.
    const now = new Date('2026-11-01T03:30:00Z');
    expect(todayIn(MX, now)).toBe('2026-10-31');
    expect(todayIn('UTC', now)).toBe('2026-11-01');
  });

  it('suma y resta días cruzando meses y años', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});
