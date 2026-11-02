import type { MetricDto } from '@finanzas/shared';

/** Formatea un importe recibido como texto decimal. No convierte a number para sumar: solo para mostrar. */
export function formatMoney(value: string | null, currency = 'MXN'): string {
  if (value === null) return '—';
  const [intPart = '0', decPart = '00'] = value.replace('-', '').split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = value.startsWith('-') ? '-' : '';
  const symbol = currency === 'MXN' ? '$' : `${currency} `;
  return `${sign}${symbol}${grouped}.${decPart.padEnd(2, '0').slice(0, 2)}`;
}

/** Etiqueta textual del estado de una cifra: el estado nunca se comunica solo con color. */
export function metricStatusLabel(status: MetricDto['status']): string {
  switch (status) {
    case 'CONFIRMED':
      return 'Confirmado';
    case 'ESTIMATED':
      return 'Estimado';
    default:
      return 'Aún sin datos';
  }
}

/** Fecha de negocio YYYY-MM-DD como DD/MM/AAAA. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** DD/MM/AAAA (o D/M/AAAA) → YYYY-MM-DD. null si no es una fecha de calendario válida. */
export function parseDisplayDate(text: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [, d, mo, y] = m as unknown as [string, string, string, string];
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  // Comprobación de calendario sin zona horaria: 31/02 no existe.
  const check = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(check.getTime()) && check.toISOString().startsWith(iso) ? iso : null;
}

export function formatDateRange(from: string, to: string): string {
  return from === to ? formatDate(from) : `${formatDate(from)} – ${formatDate(to)}`;
}

/**
 * Limpia lo que el usuario escribe en un campo de importe para enviarlo como texto decimal:
 * quita "$", espacios y separadores de miles. Una coma seguida de 1 o 2 dígitos al final se toma
 * como punto decimal (teclados que muestran coma). El resultado lo valida el esquema compartido.
 */
export function normalizeAmountInput(text: string): string {
  const clean = text.replace(/[$\s]/g, '');
  if (!clean.includes('.') && /^\d+,\d{1,2}$/.test(clean)) return clean.replace(',', '.');
  return clean.replace(/,/g, '');
}
