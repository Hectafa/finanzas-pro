import { Inject, Injectable } from '@nestjs/common';
import type { CompanySummaryDto, CreateInvitationInput, InvitationDto } from '@finanzas/shared';
import { AuditService } from '../audit/audit.service';
import { Errors } from '../common/errors';
import type { AuthContext, TenantContext } from '../common/request-context';
import { APP_ENV, type AppEnv } from '../config/env';
import { DbService } from '../db/db.service';
import { newOpaqueToken, sha256Hex, uuidv7 } from '../db/ids';
import type { Invitation, Role } from '../generated/prisma/client';
import { Mailer } from '../mail/mailer';
import { linksText } from '../mail/links';
import { roleRef, toCompanySummary } from './mappers';
import { MembersService } from './members.service';

const INVITATION_DAYS = 7;

@Injectable()
export class InvitationsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly members: MembersService,
    private readonly mailer: Mailer,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async create(t: TenantContext, input: CreateInvitationInput): Promise<InvitationDto> {
    const { token, hash } = newOpaqueToken();
    const { invitation, companyName, inviterName } = await this.db.tenant(t, async (tx) => {
      const role = await this.members.loadAssignableRole(tx, t, input.roleId);

      const existingUser = await tx.user.findUnique({
        where: { email: input.email },
        select: { id: true },
      });
      if (existingUser) {
        const membership = await tx.companyMembership.findUnique({
          where: { companyId_userId: { companyId: t.companyId, userId: existingUser.id } },
        });
        if (membership?.status === 'ACTIVE')
          throw Errors.conflict('ALREADY_MEMBER', 'Esa persona ya pertenece a la empresa');
      }

      // Una sola invitación pendiente por correo: la nueva reemplaza a la anterior.
      await tx.invitation.updateMany({
        where: { companyId: t.companyId, email: input.email, status: 'PENDING' },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      const invitation = await tx.invitation.create({
        data: {
          id: uuidv7(),
          companyId: t.companyId,
          email: input.email,
          roleId: role.id,
          tokenHash: hash,
          expiresAt: new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000),
          invitedBy: t.userId,
        },
        include: { role: true },
      });
      await this.audit.record(tx, {
        companyId: t.companyId,
        actorUserId: t.userId,
        action: 'invitation.created',
        entityType: 'Invitation',
        entityId: invitation.id,
        data: { email: input.email, roleId: role.id },
        requestId: t.requestId,
      });
      const company = await tx.company.findUniqueOrThrow({
        where: { id: t.companyId },
        select: { name: true },
      });
      const inviter = await tx.user.findUniqueOrThrow({
        where: { id: t.userId },
        select: { fullName: true },
      });
      return { invitation, companyName: company.name, inviterName: inviter.fullName };
    });

    await this.mailer.send({
      to: input.email,
      subject: `${inviterName} te invitó a ${companyName} en Finanzas Pro`,
      text:
        `${inviterName} te invitó a colaborar en ${companyName} con el rol ${invitation.role.name}.\n\n` +
        `Inicia sesión o crea tu cuenta con este correo y abre el enlace ` +
        `(válido ${INVITATION_DAYS} días):\n\n${linksText(this.env, `accept-invite?token=${token}`)}`,
    });
    return toInvitationDto(invitation);
  }

  async list(t: TenantContext): Promise<InvitationDto[]> {
    const rows = await this.db.tenant(t, (tx) =>
      tx.invitation.findMany({
        where: { companyId: t.companyId },
        include: { role: true },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
    return rows.map(toInvitationDto);
  }

  async revoke(t: TenantContext, invitationId: string): Promise<void> {
    await this.db.tenant(t, async (tx) => {
      const { count } = await tx.invitation.updateMany({
        where: { id: invitationId, companyId: t.companyId, status: 'PENDING' },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      if (count === 0) throw Errors.notFound('Invitación no encontrada');
      await this.audit.record(tx, {
        companyId: t.companyId,
        actorUserId: t.userId,
        action: 'invitation.revoked',
        entityType: 'Invitation',
        entityId: invitationId,
        requestId: t.requestId,
      });
    });
  }

  /**
   * Acepta con el token del correo. El token solo sirve para la cuenta con el mismo correo:
   * reenviar el enlace a otra persona no le da acceso.
   * Usa db.system() porque el usuario todavía no pertenece a la empresa.
   */
  async accept(auth: AuthContext, token: string): Promise<CompanySummaryDto> {
    return this.db.system(async (tx) => {
      const now = new Date();
      const invitation = await tx.invitation.findUnique({
        where: { tokenHash: sha256Hex(token) },
        include: { company: true, role: true },
      });
      if (
        !invitation ||
        invitation.status !== 'PENDING' ||
        invitation.expiresAt <= now ||
        invitation.role.archivedAt
      ) {
        throw Errors.badRequest('INVITATION_INVALID', 'La invitación no es válida o ya expiró');
      }
      const user = await tx.user.findUniqueOrThrow({ where: { id: auth.userId } });
      if (user.email !== invitation.email) {
        throw Errors.forbidden('Esta invitación fue enviada a otro correo');
      }
      const claimed = await tx.invitation.updateMany({
        where: { id: invitation.id, status: 'PENDING' },
        data: { status: 'ACCEPTED', acceptedBy: user.id, acceptedAt: now },
      });
      if (claimed.count === 0)
        throw Errors.badRequest('INVITATION_INVALID', 'La invitación no es válida o ya expiró');

      const existing = await tx.companyMembership.findUnique({
        where: { companyId_userId: { companyId: invitation.companyId, userId: user.id } },
      });
      if (existing?.status === 'ACTIVE')
        throw Errors.conflict('ALREADY_MEMBER', 'Ya perteneces a esta empresa');
      if (existing) {
        await tx.companyMembership.update({
          where: { id: existing.id },
          data: {
            status: 'ACTIVE',
            roleId: invitation.roleId,
            revokedAt: null,
            updatedBy: user.id,
            version: { increment: 1 },
          },
        });
      } else {
        await tx.companyMembership.create({
          data: {
            id: uuidv7(),
            companyId: invitation.companyId,
            userId: user.id,
            roleId: invitation.roleId,
            createdBy: invitation.invitedBy,
          },
        });
      }
      await this.audit.record(tx, {
        companyId: invitation.companyId,
        actorUserId: user.id,
        action: 'invitation.accepted',
        entityType: 'Invitation',
        entityId: invitation.id,
        data: { roleId: invitation.roleId },
        requestId: auth.requestId,
      });
      return toCompanySummary(invitation.company, invitation.role);
    });
  }
}

function toInvitationDto(inv: Invitation & { role: Role }): InvitationDto {
  const expired = inv.status === 'PENDING' && inv.expiresAt <= new Date();
  return {
    id: inv.id,
    email: inv.email,
    role: roleRef(inv.role),
    status: expired ? 'EXPIRED' : inv.status,
    expiresAt: inv.expiresAt.toISOString(),
    createdAt: inv.createdAt.toISOString(),
  };
}
