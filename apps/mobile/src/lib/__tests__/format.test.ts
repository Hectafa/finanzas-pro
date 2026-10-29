import { formatDateRange, formatMoney, metricStatusLabel } from '../format';

describe('formatMoney', () => {
  it('formatea texto decimal sin pasar por punto flotante', () => {
    expect(formatMoney('1234567.5')).toBe('$1,234,567.50');
    expect(formatMoney('0.1')).toBe('$0.10');
    expect(formatMoney('-950.25')).toBe('-$950.25');
    expect(formatMoney('999999999999999.99')).toBe('$999,999,999,999,999.99');
  });

  it('muestra un guion cuando no hay dato, nunca un cero inventado', () => {
    expect(formatMoney(null)).toBe('—');
  });
});

describe('metricStatusLabel', () => {
  it('describe el estado con texto', () => {
    expect(metricStatusLabel('CONFIRMED')).toBe('Confirmado');
    expect(metricStatusLabel('ESTIMATED')).toBe('Estimado');
    expect(metricStatusLabel('NOT_AVAILABLE')).toBe('Aún sin datos');
  });
});

describe('formatDateRange', () => {
  it('usa formato dd/mm/aaaa', () => {
    expect(formatDateRange('2026-10-01', '2026-10-31')).toBe('01/10/2026 – 31/10/2026');
    expect(formatDateRange('2026-10-28', '2026-10-28')).toBe('28/10/2026');
  });
});
