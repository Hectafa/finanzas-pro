import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  createCategorySchema,
  createFinancialAccountSchema,
  createTransactionSchema,
  listTransactionsQuerySchema,
  updateCategorySchema,
  updateFinancialAccountSchema,
  updateTransactionSchema,
  voidTransactionSchema,
  type CreateCategoryInput,
  type CreateFinancialAccountInput,
  type CreateTransactionInput,
  type ListTransactionsQuery,
  type UpdateCategoryInput,
  type UpdateFinancialAccountInput,
  type UpdateTransactionInput,
  type VoidTransactionInput,
} from '@finanzas/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { Authorize, CurrentTenant, type TenantContext } from '../common/request-context';
import { ApiZodBody, uuidParam, ZodPipe } from '../common/zod';
import { DbService } from '../db/db.service';
import { AccountsService } from './accounts.service';
import { CategoriesService } from './categories.service';
import { LedgerService } from './ledger.service';
import { TransactionsService } from './transactions.service';

const archivedQuery = new ZodPipe(
  z.object({
    includeArchived: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  }),
);

@ApiTags('Cuentas de dinero')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  /** Requiere accounts:view (con saldos) o permisos de movimientos (sin saldos). */
  @Get()
  @Authorize()
  @ApiQuery({ name: 'includeArchived', required: false, enum: ['true', 'false'] })
  list(@CurrentTenant() t: TenantContext, @Query(archivedQuery) q: { includeArchived: boolean }) {
    return this.accounts.list(t, q.includeArchived);
  }

  @Post()
  @Authorize('accounts:manage')
  @ApiZodBody(createFinancialAccountSchema)
  create(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodPipe(createFinancialAccountSchema)) body: CreateFinancialAccountInput,
  ) {
    return this.accounts.create(t, body);
  }

  @Patch(':id')
  @Authorize('accounts:manage')
  @ApiZodBody(updateFinancialAccountSchema)
  update(
    @CurrentTenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(updateFinancialAccountSchema)) body: UpdateFinancialAccountInput,
  ) {
    return this.accounts.update(t, id, body);
  }

  @Post(':id/archive')
  @Authorize('accounts:manage')
  @HttpCode(204)
  async archive(@CurrentTenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.accounts.archive(t, id);
  }
}

@ApiTags('Categorías')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @Authorize()
  @ApiQuery({ name: 'includeArchived', required: false, enum: ['true', 'false'] })
  list(@CurrentTenant() t: TenantContext, @Query(archivedQuery) q: { includeArchived: boolean }) {
    return this.categories.list(t, q.includeArchived);
  }

  @Post()
  @Authorize('categories:manage')
  @ApiZodBody(createCategorySchema)
  create(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodPipe(createCategorySchema)) body: CreateCategoryInput,
  ) {
    return this.categories.create(t, body);
  }

  @Patch(':id')
  @Authorize('categories:manage')
  @ApiZodBody(updateCategorySchema)
  update(
    @CurrentTenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(updateCategorySchema)) body: UpdateCategoryInput,
  ) {
    return this.categories.update(t, id, body);
  }

  @Post(':id/archive')
  @Authorize('categories:manage')
  @HttpCode(204)
  async archive(@CurrentTenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    await this.categories.archive(t, id);
  }
}

@ApiTags('Movimientos')
@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactions: TransactionsService) {}

  /** Requiere transactions:view (todos) o transactions:view_own (solo los propios). */
  @Get()
  @Authorize()
  list(
    @CurrentTenant() t: TenantContext,
    @Query(new ZodPipe(listTransactionsQuerySchema)) q: ListTransactionsQuery,
  ) {
    return this.transactions.list(t, q);
  }

  @Get(':id')
  @Authorize()
  get(@CurrentTenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.transactions.get(t, id);
  }

  /** 201 si se creó; 200 si es un reenvío idéntico de un movimiento ya registrado. */
  @Post()
  @Authorize('transactions:create')
  @ApiZodBody(createTransactionSchema)
  async create(
    @CurrentTenant() t: TenantContext,
    @Body(new ZodPipe(createTransactionSchema)) body: CreateTransactionInput,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { created, transaction } = await this.transactions.create(t, body);
    res.status(created ? 201 : 200);
    return transaction;
  }

  /** Campos descriptivos. Requiere transactions:update, salvo el autor de un movimiento por revisar. */
  @Patch(':id')
  @Authorize()
  @ApiZodBody(updateTransactionSchema)
  update(
    @CurrentTenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(updateTransactionSchema)) body: UpdateTransactionInput,
  ) {
    return this.transactions.update(t, id, body);
  }

  @Post(':id/approve')
  @Authorize('transactions:approve')
  @HttpCode(200)
  approve(@CurrentTenant() t: TenantContext, @Param('id', uuidParam) id: string) {
    return this.transactions.approve(t, id);
  }

  @Post(':id/void')
  @Authorize('transactions:void')
  @HttpCode(200)
  @ApiZodBody(voidTransactionSchema)
  void(
    @CurrentTenant() t: TenantContext,
    @Param('id', uuidParam) id: string,
    @Body(new ZodPipe(voidTransactionSchema)) body: VoidTransactionInput,
  ) {
    return this.transactions.void(t, id, body.reason);
  }
}

@ApiTags('Libro contable')
@Controller('ledger')
export class LedgerController {
  constructor(
    private readonly db: DbService,
    private readonly ledger: LedgerService,
  ) {}

  /** Verifica que todos los asientos cuadren y que cada movimiento tenga los asientos que su estado exige. */
  @Get('verify')
  @Authorize('audit:view')
  verify(@CurrentTenant() t: TenantContext) {
    return this.db.tenant(t, (tx) => this.ledger.verify(tx, t.companyId));
  }
}
