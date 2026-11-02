import type {
  CategoryDto,
  DuplicateAttachmentDetails,
  TransactionDto,
  TransactionType,
} from '@finanzas/shared';
import { TRANSACTION_TYPE_LABELS } from '@finanzas/shared';
import { formatDate, formatMoney } from './format';

/** Efecto del movimiento en el dinero del negocio: entra, sale o solo cambia de cuenta. */
export function transactionDirection(type: TransactionType): 'in' | 'out' | 'move' {
  switch (type) {
    case 'INCOME':
    case 'OWNER_CONTRIBUTION':
      return 'in';
    case 'EXPENSE':
    case 'OWNER_WITHDRAWAL':
      return 'out';
    default:
      return 'move';
  }
}

/** Importe con signo según su dirección. El signo va en el texto, no solo en el color. */
export function signedAmount(tx: Pick<TransactionDto, 'type' | 'amount' | 'currency'>): string {
  const dir = transactionDirection(tx.type);
  const text = formatMoney(tx.amount, tx.currency);
  return dir === 'in' ? `+${text}` : dir === 'out' ? `−${text}` : text;
}

/** Título de un movimiento en listas: lo que escribió el usuario o, si no, qué fue. */
export function transactionTitle(tx: TransactionDto): string {
  return tx.description ?? tx.category?.name ?? TRANSACTION_TYPE_LABELS[tx.type];
}

/** Cuentas involucradas: "Caja" o "Caja → BBVA" en transferencias. */
export function transactionAccounts(tx: TransactionDto): string {
  return tx.toAccount ? `${tx.account.name} → ${tx.toAccount.name}` : tx.account.name;
}

export interface CategoryOption {
  id: string;
  label: string;
  /** Subcategoría: se muestra con sangría bajo su categoría principal. */
  child: boolean;
}

/**
 * Categorías activas de una naturaleza en orden de árbol (cada principal seguida de sus
 * subcategorías), con la ruta completa como etiqueta: "Insumos › Lácteos".
 */
export function categoryOptions(
  categories: CategoryDto[],
  nature: CategoryDto['nature'],
): CategoryOption[] {
  const active = categories.filter((c) => c.nature === nature && !c.archived);
  const byName = (a: CategoryDto, b: CategoryDto) => a.name.localeCompare(b.name, 'es');
  const out: CategoryOption[] = [];
  for (const parent of active.filter((c) => !c.parentId).sort(byName)) {
    out.push({ id: parent.id, label: parent.name, child: false });
    for (const child of active.filter((c) => c.parentId === parent.id).sort(byName)) {
      out.push({ id: child.id, label: `${parent.name} › ${child.name}`, child: true });
    }
  }
  return out;
}

/** Nombre del comprobante con extensión .jpg (la app convierte toda foto a JPG antes de subirla). */
export function receiptFileName(original: string | null | undefined, now = Date.now()): string {
  const base = (original ?? '').replace(/\.[^.]*$/, '').trim();
  return `${base || `comprobante-${now}`}.jpg`;
}

/** Las URLs firmadas del almacenamiento local son relativas a la API; las de R2/S3, absolutas. */
export function resolveFileUrl(url: string, apiBase: string): string {
  return url.startsWith('/') ? `${apiBase}${url}` : url;
}

/** Dónde está ya un comprobante repetido, en frases para el diálogo de confirmación. */
export function describeDuplicates(
  details: DuplicateAttachmentDetails,
  currency: string,
): string[] {
  return details.duplicates.map((d) =>
    d.visible
      ? `${d.description ?? 'Movimiento'} · ${formatDate(d.date)} · ${formatMoney(d.amount, currency)}`
      : 'Un movimiento que no tienes permiso de ver',
  );
}
