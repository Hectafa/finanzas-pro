import type {
  AttachmentDto,
  CategoryDto,
  DuplicateAttachmentDetails,
  TransactionDto,
} from '@finanzas/shared';
import { todayIn } from '@finanzas/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/db/ids';
import { detectFileType } from '../src/storage/file-type';
import { UrlSigner } from '../src/storage/storage';
import {
  addMember,
  createCompany,
  createTestContext,
  inCompany,
  registerUser,
  resetDatabase,
  type TestContext,
  type TestUser,
} from './helpers';

// Archivos mínimos con la firma correcta de cada tipo.
const jpeg = (seed: string) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(`foto-${seed}`)]);
const pdf = Buffer.from('%PDF-1.7\n%prueba\n');
const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic0000')]);
const exe = Buffer.from('MZ\x90\x00 esto no es una imagen');

let ctx: TestContext;
let owner: TestUser;
let employee: TestUser;
let companyId: string;
let accountId: string;
let expenseCategory: CategoryDto;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.close();
});
beforeEach(async () => {
  await resetDatabase(ctx);
  owner = await registerUser(ctx, 'duena@cafe.mx', 'Dueña');
  companyId = (await createCompany(ctx, owner, 'Café Central')).id;
  employee = await addMember(ctx, owner, companyId, 'emp@cafe.mx', 'EMPLOYEE');
  const categories: CategoryDto[] = (await ctx.http().get('/v1/categories').set(as(owner))).body;
  expenseCategory = categories.find((c) => c.nature === 'EXPENSE' && !c.parentId)!;
  accountId = (
    await ctx
      .http()
      .post('/v1/accounts')
      .set(as(owner))
      .send({ name: 'Caja', type: 'CASH', openingBalance: '1000' })
  ).body.id;
});

const as = (user: TestUser) => inCompany(user, companyId);

async function expense(user: TestUser, description = 'Leche'): Promise<TransactionDto> {
  const res = await ctx
    .http()
    .post('/v1/transactions')
    .set(as(user))
    .send({
      id: uuidv7(),
      type: 'EXPENSE',
      date: todayIn('America/Mexico_City'),
      amount: '116.00',
      accountId,
      categoryId: expenseCategory.id,
      description,
    });
  if (res.status !== 201) throw new Error(`Gasto falló: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

function upload(
  user: TestUser,
  transactionId: string,
  file: Buffer,
  fields: { id?: string; duplicateReason?: string; name?: string } = {},
) {
  const req = ctx
    .http()
    .post(`/v1/transactions/${transactionId}/attachments`)
    .set(as(user))
    .field('id', fields.id ?? uuidv7());
  if (fields.duplicateReason) req.field('duplicateReason', fields.duplicateReason);
  return req.attach('file', file, fields.name ?? 'ticket.jpg');
}

describe('subir comprobantes', () => {
  it('guarda el archivo, calcula su huella y lo cuenta en el movimiento', async () => {
    const tx = await expense(owner);
    const res = await upload(owner, tx.id, jpeg('a'), { name: '../../ticket café ñ.jpg' });
    expect(res.status).toBe(201);
    const a = res.body as AttachmentDto;
    expect(a.mimeType).toBe('image/jpeg');
    // Sin rutas y con tildes intactas (multer decodifica el nombre como Latin-1).
    expect(a.fileName).toBe('ticket café ñ.jpg');
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.url).toMatch(/^\/v1\/files\//);

    const file = await ctx.http().get(a.url);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(file.body as Buffer, jpeg('a'))).toBe(0);

    const again = await ctx.http().get(`/v1/transactions/${tx.id}`).set(as(owner));
    expect(again.body.attachmentCount).toBe(1);
  });

  it('valida el tipo por el contenido, no por el nombre', async () => {
    const tx = await expense(owner);
    const bad = await upload(owner, tx.id, exe, { name: 'foto.jpg' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].message).toMatch(/Solo se admiten/);

    const iphone = await upload(owner, tx.id, heic, { name: 'IMG_0001.HEIC' });
    expect(iphone.status).toBe(400);
    expect(iphone.body.error.details[0].message).toMatch(/HEIC/);

    const ok = await upload(owner, tx.id, pdf, { name: 'factura.pdf' });
    expect(ok.status).toBe(201);
    expect(ok.body.mimeType).toBe('application/pdf');
  });

  it('rechaza archivos de más de 10 MB y solicitudes sin archivo', async () => {
    const tx = await expense(owner);
    const big = Buffer.concat([jpeg('big'), Buffer.alloc(10 * 1024 * 1024)]);
    expect((await upload(owner, tx.id, big)).status).toBe(413);

    const none = await ctx
      .http()
      .post(`/v1/transactions/${tx.id}/attachments`)
      .set(as(owner))
      .field('id', uuidv7());
    expect(none.status).toBe(400);
  });

  it('es idempotente por id: reenviar no duplica; mismo id con otro archivo se rechaza', async () => {
    const tx = await expense(owner);
    const id = uuidv7();
    expect((await upload(owner, tx.id, jpeg('a'), { id })).status).toBe(201);
    expect((await upload(owner, tx.id, jpeg('a'), { id })).status).toBe(200);
    const other = await upload(owner, tx.id, jpeg('b'), { id });
    expect(other.status).toBe(409);
    expect(other.body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    const list = await ctx.http().get(`/v1/transactions/${tx.id}/attachments`).set(as(owner));
    expect(list.body).toHaveLength(1);
  });
});

describe('duplicados', () => {
  it('detecta el mismo archivo en otro movimiento y exige confirmación con motivo', async () => {
    const first = await expense(owner, 'Compra Costco');
    const second = await expense(owner, 'Otra compra');
    await upload(owner, first.id, jpeg('mismo'));

    const dup = await upload(owner, second.id, jpeg('mismo'));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_ATTACHMENT');
    const details = dup.body.error.details as DuplicateAttachmentDetails;
    expect(details.duplicates).toEqual([
      expect.objectContaining({
        visible: true,
        transactionId: first.id,
        amount: '116.00',
        description: 'Compra Costco',
      }),
    ]);

    const short = await upload(owner, second.id, jpeg('mismo'), { duplicateReason: 'x' });
    expect(short.status).toBe(400);

    const forced = await upload(owner, second.id, jpeg('mismo'), {
      duplicateReason: 'El ticket cubre dos compras',
    });
    expect(forced.status).toBe(201);
    expect(forced.body.duplicateReason).toBe('El ticket cubre dos compras');

    const audit = await ctx.owner.auditLog.findFirst({
      where: { action: 'attachment.duplicate_confirmed' },
    });
    expect(audit?.entityId).toBe(forced.body.id);
  });

  it('a quien solo ve lo propio no le revela datos de movimientos ajenos', async () => {
    const ownerTx = await expense(owner, 'Secreto');
    await upload(owner, ownerTx.id, jpeg('compartido'));
    const mine = await expense(employee, 'Mío');
    const dup = await upload(employee, mine.id, jpeg('compartido'));
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.duplicates).toEqual([{ visible: false }]);
  });

  it('un comprobante retirado ya no cuenta como duplicado', async () => {
    const first = await expense(owner);
    const a = (await upload(owner, first.id, jpeg('r'))).body as AttachmentDto;
    const removed = await ctx
      .http()
      .post(`/v1/transactions/${first.id}/attachments/${a.id}/remove`)
      .set(as(owner));
    expect(removed.status).toBe(204);
    const second = await expense(owner);
    expect((await upload(owner, second.id, jpeg('r'))).status).toBe(201);
    const list = await ctx.http().get(`/v1/transactions/${first.id}/attachments`).set(as(owner));
    expect(list.body).toHaveLength(0);
  });
});

describe('permisos y aislamiento', () => {
  it('el empleado adjunta a lo que capturó, pero no a movimientos ajenos', async () => {
    const own = await expense(employee);
    expect((await upload(employee, own.id, jpeg('e'))).status).toBe(201);
    const others = await expense(owner);
    // Con view_own, el movimiento ajeno ni siquiera existe para él.
    expect((await upload(employee, others.id, jpeg('f'))).status).toBe(404);
  });

  it('no se adjunta a un movimiento anulado', async () => {
    const tx = await expense(owner);
    await ctx
      .http()
      .post(`/v1/transactions/${tx.id}/void`)
      .set(as(owner))
      .send({ reason: 'Capturado por error' });
    const res = await upload(owner, tx.id, jpeg('v'));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TRANSACTION_VOIDED');
  });

  it('otra empresa no ve los comprobantes ni detecta sus duplicados', async () => {
    const tx = await expense(owner);
    await upload(owner, tx.id, jpeg('x'));
    const stranger = await registerUser(ctx, 'otra@empresa.mx', 'Otra');
    const otherCompany = (await createCompany(ctx, stranger, 'Otra Empresa')).id;
    const list = await ctx
      .http()
      .get(`/v1/transactions/${tx.id}/attachments`)
      .set(inCompany(stranger, otherCompany));
    expect(list.status).toBe(404);

    // RLS: aunque la consulta no filtrara por empresa, la base no devuelve filas ajenas.
    const visible = await ctx.db.tenant({ companyId: otherCompany, userId: stranger.id }, (t) =>
      t.transactionAttachment.count(),
    );
    expect(visible).toBe(0);
  });

  it('el rol de la API no puede alterar los metadatos ni borrar filas', async () => {
    const tx = await expense(owner);
    const a = (await upload(owner, tx.id, jpeg('m'))).body as AttachmentDto;
    const t = { companyId, userId: owner.id };
    await expect(
      ctx.db.tenant(t, (db) =>
        db.$executeRawUnsafe(
          `UPDATE transaction_attachments SET sha256 = repeat('0', 64) WHERE id = '${a.id}'`,
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      ctx.db.tenant(t, (db) =>
        db.$executeRawUnsafe(`DELETE FROM transaction_attachments WHERE id = '${a.id}'`),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe('URLs firmadas', () => {
  it('rechazan firma alterada, vencida o ruta inventada', async () => {
    const tx = await expense(owner);
    const a = (await upload(owner, tx.id, jpeg('u'))).body as AttachmentDto;
    const tampered = a.url.replace(/sig=.{4}/, 'sig=AAAA');
    expect((await ctx.http().get(tampered)).status).toBe(404);
    expect((await ctx.http().get(a.url.replace(/\.jpg/, '.pdf'))).status).toBe(404);
    expect(
      (await ctx.http().get('/v1/files/..%2F..%2Fetc/passwd?exp=9999999999&sig=x')).status,
    ).toBe(404);

    const signer = new UrlSigner(
      'secreto-de-pruebas-que-no-se-usa-fuera-de-pruebas-0123456789',
      300,
    );
    const key = `companies/${companyId}/attachments/${a.id}.jpg`;
    const past = signer.sign(key, new Date(Date.now() - 10 * 60_000));
    expect((await ctx.http().get(past.url)).status).toBe(404);
    expect((await ctx.http().get(signer.sign(key).url)).status).toBe(200);
  });
});

describe('detectFileType', () => {
  it('reconoce cada tipo por su firma', () => {
    expect(detectFileType(jpeg('z'))).toBe('image/jpeg');
    expect(detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      'image/png',
    );
    expect(detectFileType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(detectFileType(pdf)).toBe('application/pdf');
    expect(detectFileType(heic)).toBe('image/heic');
    expect(detectFileType(exe)).toBeNull();
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
  });
});
