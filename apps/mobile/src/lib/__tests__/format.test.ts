import {
  formatDateRange,
  formatMoney,
  metricStatusLabel,
  normalizeAmountInput,
  parseDisplayDate,
} from '../format';

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

describe('normalizeAmountInput', () => {
  it('quita símbolo, espacios y separadores de miles', () => {
    expect(normalizeAmountInput('$ 1,250.50')).toBe('1250.50');
    expect(normalizeAmountInput('1,000,000')).toBe('1000000');
  });

  it('acepta coma decimal de teclados que la muestran', () => {
    expect(normalizeAmountInput('12,5')).toBe('12.5');
    expect(normalizeAmountInput('99,90')).toBe('99.90');
  });

  it('no inventa decimales: deja que el esquema rechace lo inválido', () => {
    expect(normalizeAmountInput('1.234,5')).toBe('1.2345');
    expect(normalizeAmountInput('abc')).toBe('abc');
  });
});

describe('parseDisplayDate', () => {
  it('convierte DD/MM/AAAA a fecha ISO', () => {
    expect(parseDisplayDate('31/10/2026')).toBe('2026-10-31');
    expect(parseDisplayDate('1/2/2026')).toBe('2026-02-01');
  });

  it('rechaza fechas que no existen o con otro formato', () => {
    expect(parseDisplayDate('31/02/2026')).toBeNull();
    expect(parseDisplayDate('29/02/2027')).toBeNull();
    expect(parseDisplayDate('2026-10-31')).toBeNull();
    expect(parseDisplayDate('31/10')).toBeNull();
  });
});
