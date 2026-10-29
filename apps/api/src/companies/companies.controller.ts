import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  acceptInvitationSchema,
  changeMemberRoleSchema,
  createCompanySchema,
  createInvitationSchema,
  createRoleSchema,
  updateCompanySchema,
  type AcceptInvitationInput,
  type ChangeMemberRoleInput,
  type CreateCompanyInput,
  type CreateInvitationInput,
  type CreateRoleInput,
  type UpdateCompanyInput,
} from '@finanzas/shared';
import {
  Authorize,
  CurrentAuth,
  CurrentTenant,
  type AuthContext,
  type TenantContext,
} from '../common/request-context';
import { ApiZodBody, ZodPipe, uuidParam } from '../common/zod';
import { CompaniesService } from './companies.service';
import { InvitationsService } from './invitations.service';
import { MembersService } from './members.service';

@ApiTags('Empresas')
@ApiBearerAuth()
@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Post()
  @ApiZodBody(createCompanySchema)
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(createCompanySchema)) body: CreateCompanyInput,
  ) {
    return this.companies.create(auth, body);
  }

  @Get()
  listMine(@CurrentAuth() auth: AuthContext) {
    return this.companies.listMine(auth);
  }

  @Get('current')
  @Authorize()
  current(@CurrentTenant() t: TenantContext) {
    return this.companies.current(t);
  }

  @Patch('current')
  @Authorize('settings:manage')
  @ApiZodBody(updateCompanySchema)
  update(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodPipe(updateCompanySchema)) body: UpdateCompanyInput,
  ) {
    return this.companies.update(t, body);
  }
}

@ApiTags('Usuarios y roles')
@Controller()
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get('members')
  @Authorize('users:view')
  list(@CurrentTenant() t: TenantContext) {
    return this.members.list(t);
  }

  @Patch('members/:id/role')
  @Authorize('users:manage')
  @HttpCode(204)
  @ApiZodBody(changeMemberRoleSchema)
  async changeRole(
    @CurrentTenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(changeMemberRoleSchema)) body: ChangeMemberRoleInput,
  ) {
    await this.members.changeRole(t, id, body.roleId);
  }

  @Post('members/:id/revoke')
  @Authorize('users:manage')
  @HttpCode(204)
  async revoke(@CurrentTenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.members.setStatus(t, id, 'REVOKED');
  }

  @Post('members/:id/reactivate')
  @Authorize('users:manage')
  @HttpCode(204)
  async reactivate(@CurrentTenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.members.setStatus(t, id, 'ACTIVE');
  }

  @Get('roles')
  @Authorize('users:view')
  roles(@CurrentTenant() t: TenantContext) {
    return this.members.listRoles(t);
  }

  @Post('roles')
  @Authorize('users:manage')
  @ApiZodBody(createRoleSchema)
  createRole(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodPipe(createRoleSchema)) body: CreateRoleInput,
  ) {
    return this.members.createRole(t, body);
  }
}

@ApiTags('Invitaciones')
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @Authorize('users:invite')
  @ApiZodBody(createInvitationSchema)
  create(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodPipe(createInvitationSchema)) body: CreateInvitationInput,
  ) {
    return this.invitations.create(t, body);
  }

  @Get()
  @Authorize('users:view')
  list(@CurrentTenant() t: TenantContext) {
    return this.invitations.list(t);
  }

  @Post(':id/revoke')
  @Authorize('users:invite')
  @HttpCode(204)
  async revoke(@CurrentTenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.invitations.revoke(t, id);
  }

  /** No requiere empresa activa: el usuario aún no pertenece a ella. */
  @Post('accept')
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiZodBody(acceptInvitationSchema)
  accept(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(acceptInvitationSchema)) body: AcceptInvitationInput,
  ) {
    return this.invitations.accept(auth, body.token);
  }
}
