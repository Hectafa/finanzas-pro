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

export function formatDateRange(from: string, to: string): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };
  return from === to ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
}
