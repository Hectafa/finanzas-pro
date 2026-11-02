import type { CategoryDto, TransactionDto } from '@finanzas/shared';
import {
  categoryOptions,
  describeDuplicates,
  receiptFileName,
  resolveFileUrl,
  signedAmount,
  transactionAccounts,
  transactionTitle,
} from '../finance';

const tx = (over: Partial<TransactionDto>): TransactionDto => ({
  id: 't1',
  type: 'EXPENSE',
  status: 'POSTED',
  date: '2026-10-30',
  amount: '116.00',
  vatRate: '16',
  vatAmount: '16.00',
  currency: 'MXN',
  account: { id: 'a1', name: 'Caja', type: 'CASH' },
  toAccount: null,
  category: { id: 'c1', name: 'Insumos' },
  description: null,
  reference: null,
  counterparty: null,
  notes: null,
  createdBy: { id: 'u1', fullName: 'Ana' },
  createdAt: '2026-10-30T12:00:00Z',
  postedAt: null,
  voidedAt: null,
  voidReason: null,
  attachmentCount: 0,
  version: 1,
  ...over,
});

describe('signedAmount', () => {
  it('el signo indica si el dinero entra o sale', () => {
    expect(signedAmount(tx({ type: 'INCOME', amount: '50.00' }))).toBe('+$50.00');
    expect(signedAmount(tx({ type: 'EXPENSE' }))).toBe('−$116.00');
    expect(signedAmount(tx({ type: 'OWNER_WITHDRAWAL', amount: '10.00' }))).toBe('−$10.00');
    expect(signedAmount(tx({ type: 'TRANSFER', amount: '10.00' }))).toBe('$10.00');
  });
});

describe('transactionTitle / transactionAccounts', () => {
  it('prefiere la descripción, luego la categoría y al final el tipo', () => {
    expect(transactionTitle(tx({ description: 'Leche' }))).toBe('Leche');
    expect(transactionTitle(tx({}))).toBe('Insumos');
    expect(transactionTitle(tx({ type: 'TRANSFER', category: null }))).toBe('Transferencia');
  });

  it('muestra origen y destino en transferencias', () => {
    const t = tx({ type: 'TRANSFER', toAccount: { id: 'a2', name: 'BBVA', type: 'BANK' } });
    expect(transactionAccounts(t)).toBe('Caja → BBVA');
  });
});

describe('categoryOptions', () => {
  const cat = (id: string, name: string, over: Partial<CategoryDto> = {}): CategoryDto => ({
    id,
    name,
    nature: 'EXPENSE',
    parentId: null,
    archived: false,
    version: 1,
    ...over,
  });

  it('ordena en árbol, filtra por naturaleza y omite archivadas', () => {
    const list = [
      cat('2', 'Renta'),
      cat('1', 'Insumos'),
      cat('1b', 'Lácteos', { parentId: '1' }),
      cat('1a', 'Café', { parentId: '1' }),
      cat('x', 'Vieja', { archived: true }),
      cat('v', 'Ventas', { nature: 'INCOME' }),
    ];
    expect(categoryOptions(list, 'EXPENSE').map((o) => o.label)).toEqual([
      'Insumos',
      'Insumos › Café',
      'Insumos › Lácteos',
      'Renta',
    ]);
  });
});

describe('comprobantes', () => {
  it('nombra el archivo como .jpg, conservando el nombre original si existe', () => {
    expect(receiptFileName('IMG_0042.HEIC')).toBe('IMG_0042.jpg');
    expect(receiptFileName('ticket.café.png')).toBe('ticket.café.jpg');
    expect(receiptFileName(null, 123)).toBe('comprobante-123.jpg');
  });

  it('resuelve URLs relativas contra la API y deja intactas las absolutas', () => {
    expect(resolveFileUrl('/v1/files/c/a.jpg?exp=1&sig=x', 'http://192.168.1.5:3000')).toBe(
      'http://192.168.1.5:3000/v1/files/c/a.jpg?exp=1&sig=x',
    );
    expect(resolveFileUrl('https://r2.example/a.jpg', 'http://api')).toBe(
      'https://r2.example/a.jpg',
    );
  });

  it('describe dónde está el duplicado sin revelar lo que el usuario no puede ver', () => {
    expect(
      describeDuplicates(
        {
          duplicates: [
            {
              visible: true,
              transactionId: 't',
              date: '2026-10-28',
              amount: '116.00',
              description: 'Costco',
            },
            { visible: false },
          ],
        },
        'MXN',
      ),
    ).toEqual(['Costco · 28/10/2026 · $116.00', 'Un movimiento que no tienes permiso de ver']);
  });
});
