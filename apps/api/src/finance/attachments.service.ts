import { Injectable } from '@nestjs/common';
import {
  ATTACHMENT_MAX_BYTES,
  Dec,
  type AttachmentDto,
  type AttachmentMimeType,
  type DuplicateAttachmentDetails,
  type UploadAttachmentInput,
} from '@finanzas/shared';
import { createHash } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import type { TenantContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';
import type { Prisma } from '../generated/prisma/client';
import { detectFileType } from '../storage/file-type';
import { attachmentKey, Storage } from '../storage/storage';
import { fromDbDate } from './ledger.service';
import { findVisibleTransaction } from './transactions.service';

const withCreator = {
  creator: { select: { id: true, fullName: true } },
} satisfies Prisma.TransactionAttachmentInclude;

type AttachmentRow = Prisma.TransactionAttachmentGetPayload<{ include: typeof withCreator }>;

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/**
 * Nombre para mostrar: sin rutas ni caracteres de control, y con un largo razonable.
 * Multer entrega el nombre decodificado como Latin-1 ("café" llega como "cafÃ©"); se reinterpreta
 * como UTF-8 cuando eso da un texto válido.
 */
export function cleanFileName(name: string): string {
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  // eslint-disable-next-line no-control-regex
  const decoded = /[^\u0000-ÿ]/.test(name) || utf8.includes('�') ? name : utf8;
  const base = decoded.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (clean || 'comprobante').slice(0, 160);
}

/**
 * Comprobantes de movimientos (fotos o PDF).
 *
 * - El tipo se verifica por el contenido; el tamaño, contra ATTACHMENT_MAX_BYTES.
 * - Duplicados: el mismo archivo (sha256) ya presente en la empresa se rechaza con 409, salvo que
 *   el usuario lo confirme con un motivo, que queda auditado.
 * - Idempotencia: el id lo genera el dispositivo; reenviar el mismo archivo devuelve el existente.
 * - No se borran: se retiran (removed_at). El archivo se conserva en el almacenamiento.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly db: DbService,
    private readonly storage: Storage,
    private readonly audit: AuditService,
  ) {}

  async upload(
    t: TenantContext,
    transactionId: string,
    input: UploadAttachmentInput,
    file: UploadedFile | undefined,
  ): Promise<{ created: boolean; attachment: AttachmentDto }> {
    if (!file || file.size === 0) {
      throw Errors.validation([{ path: 'file', message: 'Adjunta un archivo' }]);
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      throw Errors.validation([{ path: 'file', message: 'El archivo supera 10 MB' }]);
    }
    const detected = detectFileType(file.buffer);
    if (detected === 'image/heic') {
      throw Errors.validation([
        { path: 'file', message: 'Las fotos HEIC no se admiten: conviértelas a JPG' },
      ]);
    }
    if (!detected) {
      throw Errors.validation([
        { path: 'file', message: 'Solo se admiten fotos (JPG, PNG, WebP) o PDF' },
      ]);
    }
    const mime: AttachmentMimeType = detected;
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');

    return this.db.tenant(t, async (tx) => {
      const transaction = await this.attachable(tx, t, transactionId);

      const existing = await tx.transactionAttachment.findFirst({
        where: { id: input.id, companyId: t.companyId },
        include: withCreator,
      });
      if (existing) {
        if (existing.transactionId !== transactionId || existing.sha256 !== sha256) {
          throw Errors.conflict(
            'IDEMPOTENCY_CONFLICT',
            'Ya existe un comprobante con ese identificador y otro contenido',
          );
        }
        return { created: false, attachment: this.toDto(existing) };
      }

      if (!input.duplicateReason) {
        const duplicates = await this.duplicates(tx, t, sha256);
        if (duplicates.duplicates.length > 0) {
          throw Errors.conflict(
            'DUPLICATE_ATTACHMENT',
            'Este comprobante ya está registrado. Confirma si quieres adjuntarlo de nuevo',
            duplicates,
          );
        }
      }

      const key = attachmentKey(t.companyId, input.id, mime);
      // Primero el archivo y luego la fila: si falla el guardado, no queda un registro sin archivo.
      await this.storage.put(key, file.buffer);
      const row = await tx.transactionAttachment.create({
        data: {
          id: input.id,
          companyId: t.companyId,
          transactionId: transaction.id,
          storageKey: key,
          fileName: cleanFileName(file.originalname),
          mimeType: mime,
          sizeBytes: file.size,
          sha256,
          duplicateReason: input.duplicateReason ?? null,
          createdBy: t.userId,
        },
        include: withCreator,
      });
      await this.audit.record(tx, {
        companyId: t.companyId,
        actorUserId: t.userId,
        action: input.duplicateReason ? 'attachment.duplicate_confirmed' : 'attachment.added',
        entityType: 'TransactionAttachment',
        entityId: row.id,
        data: {
          transactionId,
          sha256,
          mimeType: mime,
          sizeBytes: file.size,
          ...(input.duplicateReason ? { reason: input.duplicateReason } : {}),
        },
        requestId: t.requestId,
      });
      return { created: true, attachment: this.toDto(row) };
    });
  }

  async list(t: TenantContext, transactionId: string): Promise<AttachmentDto[]> {
    return this.db.tenant(t, async (tx) => {
      await findVisibleTransaction(tx, t, transactionId);
      const rows = await tx.transactionAttachment.findMany({
        where: { transactionId, companyId: t.companyId, removedAt: null },
        include: withCreator,
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((r) => this.toDto(r));
    });
  }

  /** Retira el comprobante del movimiento. El archivo y su registro se conservan para auditoría. */
  async remove(t: TenantContext, transactionId: string, attachmentId: string): Promise<void> {
    await this.db.tenant(t, async (tx) => {
      await this.attachable(tx, t, transactionId);
      const row = await tx.transactionAttachment.findFirst({
        where: { id: attachmentId, transactionId, companyId: t.companyId },
      });
      if (!row) throw Errors.notFound('Comprobante no encontrado');
      if (row.removedAt) return;
      await tx.transactionAttachment.update({
        where: { id: attachmentId },
        data: { removedAt: new Date(), removedBy: t.userId },
      });
      await this.audit.record(tx, {
        companyId: t.companyId,
        actorUserId: t.userId,
        action: 'attachment.removed',
        entityType: 'TransactionAttachment',
        entityId: attachmentId,
        data: { transactionId },
        requestId: t.requestId,
      });
    });
  }

  /**
   * Puede adjuntar o retirar quien tiene transactions:update o quien capturó el movimiento.
   * Un movimiento anulado ya no admite cambios.
   */
  private async attachable(tx: Tx, t: TenantContext, transactionId: string) {
    const transaction = await findVisibleTransaction(tx, t, transactionId);
    if (!t.permissions.has('transactions:update') && transaction.createdBy !== t.userId) {
      throw Errors.forbidden();
    }
    if (transaction.status === 'VOIDED') {
      throw Errors.conflict('TRANSACTION_VOIDED', 'El movimiento está anulado');
    }
    return transaction;
  }

  /**
   * Otros comprobantes vigentes con el mismo contenido. Del movimiento donde ya está se muestran
   * fecha, importe y descripción solo si el usuario puede verlo.
   */
  private async duplicates(
    tx: Tx,
    t: TenantContext,
    sha256: string,
  ): Promise<DuplicateAttachmentDetails> {
    const rows = await tx.transactionAttachment.findMany({
      where: { companyId: t.companyId, sha256, removedAt: null },
      include: { transaction: true },
      orderBy: { createdAt: 'asc' },
      take: 3,
    });
    const viewAll = t.permissions.has('transactions:view');
    return {
      duplicates: rows.map((r) =>
        viewAll || r.transaction.createdBy === t.userId
          ? {
              visible: true as const,
              transactionId: r.transactionId,
              date: fromDbDate(r.transaction.transactionDate),
              amount: new Dec(r.transaction.amount.toString()).toFixed(2),
              description: r.transaction.description,
            }
          : { visible: false as const },
      ),
    };
  }

  private toDto(r: AttachmentRow): AttachmentDto {
    const signed = this.storage.signedUrl(r.storageKey);
    return {
      id: r.id,
      transactionId: r.transactionId,
      fileName: r.fileName,
      mimeType: r.mimeType as AttachmentMimeType,
      sizeBytes: r.sizeBytes,
      sha256: r.sha256,
      duplicateReason: r.duplicateReason,
      createdBy: r.creator,
      createdAt: r.createdAt.toISOString(),
      url: signed.url,
      urlExpiresAt: signed.expiresAt.toISOString(),
    };
  }
}
