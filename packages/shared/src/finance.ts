import { DateTime } from 'luxon';
import { z } from 'zod';
import { positiveMoneySchema, moneySchema, VAT_RATES } from './money';

/**
 * Finanzas esenciales (Fase 2): cuentas de dinero, categorías y movimientos.
 * Los importes viajan como texto decimal; los saldos y el IVA los calcula el servidor.
 */

/** Fecha de negocio YYYY-MM-DD (en la zona horaria de la empresa). */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato AAAA-MM-DD')
  .refine((v) => DateTime.fromISO(v).isValid, 'Fecha inválida');

const nameSchema = z.string().trim().min(1, 'Requerido').max(80);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? undefined : v))
    .optional();
const versionSchema = z.number().int().min(1);

// ---------- Cuentas de dinero ----------

export const FINANCIAL_ACCOUNT_TYPES = ['CASH', 'BANK', 'DIGITAL_WALLET', 'TERMINAL'] as const;
export type FinancialAccountType = (typeof FINANCIAL_ACCOUNT_TYPES)[number];

export const FINANCIAL_ACCOUNT_TYPE_LABELS: Record<FinancialAccountType, string> = {
  CASH: 'Efectivo / caja',
  BANK: 'Banco',
  DIGITAL_WALLET: 'Billetera digital',
  TERMINAL: 'Terminal (por depositar)',
};

/** Tipos cuyo saldo es dinero disponible. La terminal es dinero por depositar, no disponible. */
export const AVAILABLE_CASH_TYPES: readonly FinancialAccountType[] = [
  'CASH',
  'BANK',
  'DIGITAL_WALLET',
];

export const createFinancialAccountSchema = z.object({
  name: nameSchema,
  type: z.enum(FINANCIAL_ACCOUNT_TYPES),
  institution: optionalText(80),
  /** Saldo con el que empieza a usarse la cuenta. Se registra como asiento de saldo inicial. */
  openingBalance: moneySchema.default('0'),
  /** Fecha del saldo inicial; por defecto, hoy en la zona de la empresa. */
  openingDate: isoDateSchema.optional(),
});
export type CreateFinancialAccountInput = z.infer<typeof createFinancialAccountSchema>;

export const updateFinancialAccountSchema = z
  .object({
    version: versionSchema,
    name: nameSchema.optional(),
    institution: z.string().trim().max(80).nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.institution !== undefined, 'No hay cambios');
export type UpdateFinancialAccountInput = z.infer<typeof updateFinancialAccountSchema>;

// ---------- Categorías ----------

export const CATEGORY_NATURES = ['INCOME', 'EXPENSE'] as const;
export type CategoryNature = (typeof CATEGORY_NATURES)[number];

export const createCategorySchema = z.object({
  name: nameSchema,
  nature: z.enum(CATEGORY_NATURES),
  /** Subcategoría de otra categoría de la misma naturaleza (un solo nivel). */
  parentId: z.uuid().optional(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = z.object({ version: versionSchema, name: nameSchema });
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

// ---------- Movimientos ----------

export const TRANSACTION_TYPES = [
  'INCOME',
  'EXPENSE',
  'TRANSFER',
  'OWNER_CONTRIBUTION',
  'OWNER_WITHDRAWAL',
] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  INCOME: 'Ingreso',
  EXPENSE: 'Gasto',
  TRANSFER: 'Transferencia',
  OWNER_CONTRIBUTION: 'Aportación de socios',
  OWNER_WITHDRAWAL: 'Retiro de socios',
};

export const TRANSACTION_STATUSES = ['PENDING_REVIEW', 'POSTED', 'VOIDED'] as const;
export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export const TRANSACTION_STATUS_LABELS: Record<TransactionStatus, string> = {
  PENDING_REVIEW: 'Por revisar',
  POSTED: 'Confirmado',
  VOIDED: 'Anulado',
};

const transactionBase = {
  /** UUID generado por el dispositivo. Reenviar el mismo id no duplica el movimiento. */
  id: z.uuid('Identificador inválido'),
  date: isoDateSchema,
  amount: positiveMoneySchema,
  description: optionalText(200),
  reference: optionalText(60),
  counterparty: optionalText(120),
  notes: optionalText(1000),
};

const withCategory = {
  accountId: z.uuid(),
  categoryId: z.uuid(),
  /** IVA incluido en el importe. null/ausente = sin desglose. */
  vatRate: z.enum(VAT_RATES).nullable().default(null),
};

export const createTransactionSchema = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('INCOME'), ...transactionBase, ...withCategory }),
    z.object({ type: z.literal('EXPENSE'), ...transactionBase, ...withCategory }),
    z.object({
      type: z.literal('TRANSFER'),
      ...transactionBase,
      accountId: z.uuid(),
      toAccountId: z.uuid(),
    }),
    z.object({ type: z.literal('OWNER_CONTRIBUTION'), ...transactionBase, accountId: z.uuid() }),
    z.object({ type: z.literal('OWNER_WITHDRAWAL'), ...transactionBase, accountId: z.uuid() }),
  ])
  .refine((v) => v.type !== 'TRANSFER' || v.accountId !== v.toAccountId, {
    message: 'La cuenta de origen y la de destino deben ser distintas',
    path: ['toAccountId'],
  });
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

/** Solo campos descriptivos: los que afectan saldos no se editan (se anula y se registra de nuevo). */
export const updateTransactionSchema = z
  .object({
    version: versionSchema,
    description: z.string().trim().max(200).nullable().optional(),
    reference: z.string().trim().max(60).nullable().optional(),
    counterparty: z.string().trim().max(120).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .refine(
    (v) => [v.description, v.reference, v.counterparty, v.notes].some((f) => f !== undefined),
    'No hay cambios',
  );
export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

export const voidTransactionSchema = z.object({
  reason: z.string().trim().min(3, 'Explica brevemente el motivo').max(300),
});
export type VoidTransactionInput = z.infer<typeof voidTransactionSchema>;

export const listTransactionsQuerySchema = z.object({
  type: z.enum(TRANSACTION_TYPES).optional(),
  status: z.enum(TRANSACTION_STATUSES).optional(),
  accountId: z.uuid().optional(),
  categoryId: z.uuid().optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;

// ---------- Respuestas ----------

export interface FinancialAccountDto {
  id: string;
  name: string;
  type: FinancialAccountType;
  institution: string | null;
  currency: string;
  /** Saldo derivado del libro contable. null si el usuario no tiene accounts:view. */
  balance: string | null;
  archived: boolean;
  version: number;
  createdAt: string;
}

export interface CategoryDto {
  id: string;
  name: string;
  nature: CategoryNature;
  parentId: string | null;
  archived: boolean;
  version: number;
}

export interface RefDto {
  id: string;
  name: string;
}

export interface TransactionDto {
  id: string;
  type: TransactionType;
  status: TransactionStatus;
  date: string;
  amount: string;
  vatRate: string | null;
  vatAmount: string;
  currency: string;
  account: RefDto & { type: FinancialAccountType };
  toAccount: (RefDto & { type: FinancialAccountType }) | null;
  category: RefDto | null;
  description: string | null;
  reference: string | null;
  counterparty: string | null;
  notes: string | null;
  createdBy: { id: string; fullName: string };
  createdAt: string;
  postedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  version: number;
}

export interface TransactionPageDto {
  items: TransactionDto[];
  nextCursor: string | null;
}

export interface LedgerVerificationDto {
  /** Todos los asientos cuadran (Σ cargos = Σ abonos). */
  balanced: boolean;
  entries: number;
  unbalancedEntryIds: string[];
  /** Cada movimiento confirmado tiene su asiento y cada anulado, su reversa. */
  consistent: boolean;
  inconsistentTransactionIds: string[];
}
