import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  AVAILABLE_CASH_TYPES,
  Dec,
  PERIOD_PRESETS,
  periodQuerySchema,
  resolvePeriod,
  type DashboardSummaryDto,
  type MetricDto,
  type PeriodQuery,
} from '@finanzas/shared';
import { Errors } from '../common/errors';
import { Authorize, CurrentTenant, type TenantContext } from '../common/request-context';
import { ZodPipe } from '../common/zod';
import { DbService } from '../db/db.service';
import { FinanceModule } from '../finance/finance.module';
import { LedgerService, toDbDate } from '../finance/ledger.service';

/** Cuentas por cobrar y por pagar llegan con ventas y compras (Fase 3). */
const notYet: MetricDto = {
  value: null,
  status: 'NOT_AVAILABLE',
  note: 'Disponible con ventas y compras a crédito (Fase 3)',
};

const confirmed = (value: Dec, note?: string): MetricDto => ({
  value: value.toFixed(2),
  status: 'CONFIRMED',
  ...(note ? { note } : {}),
});

/**
 * Cifras del dashboard, todas derivadas del libro contable (docs/fase-0 §5.6). Los movimientos
 * por revisar no se mezclan con las cifras confirmadas: se informan aparte.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly db: DbService,
    private readonly ledger: LedgerService,
  ) {}

  async summary(t: TenantContext, query: PeriodQuery): Promise<DashboardSummaryDto> {
    return this.db.tenant(t, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: t.companyId } });
      let period;
      try {
        period = resolvePeriod(query, company.timeZone);
      } catch (e) {
        throw Errors.badRequest(
          'INVALID_PERIOD',
          e instanceof Error ? e.message : 'Periodo inválido',
        );
      }
      const range = { from: period.fromDate, to: period.toDate };

      const [activeMembers, pendingInvitations, accounts] = await Promise.all([
        tx.companyMembership.count({ where: { companyId: t.companyId, status: 'ACTIVE' } }),
        tx.invitation.count({
          where: { companyId: t.companyId, status: 'PENDING', expiresAt: { gt: new Date() } },
        }),
        tx.financialAccount.findMany({
          where: { companyId: t.companyId },
          select: { ledgerAccountId: true, type: true, archivedAt: true },
        }),
      ]);
      const cashLedgerIds = accounts
        .filter((a) => AVAILABLE_CASH_TYPES.includes(a.type))
        .map((a) => a.ledgerAccountId);
      const terminalLedgerIds = accounts
        .filter((a) => a.type === 'TERMINAL')
        .map((a) => a.ledgerAccountId);
      const sum = (m: Map<string, Dec>) => [...m.values()].reduce((s, v) => s.plus(v), new Dec(0));

      const [cashNow, terminalNow, cashInPeriod, incomeRaw, expensesRaw, pending] =
        await Promise.all([
          this.ledger.balances(tx, t.companyId, cashLedgerIds),
          this.ledger.balances(tx, t.companyId, terminalLedgerIds),
          this.ledger.balances(tx, t.companyId, cashLedgerIds, { ...range, excludeOpening: true }),
          this.ledger.totalByType(tx, t.companyId, 'INCOME', range),
          this.ledger.totalByType(tx, t.companyId, 'EXPENSE', range),
          tx.financialTransaction.groupBy({
            by: ['type'],
            where: {
              companyId: t.companyId,
              status: 'PENDING_REVIEW',
              transactionDate: { gte: toDbDate(range.from), lte: toDbDate(range.to) },
            },
            _count: { _all: true },
            _sum: { amount: true },
          }),
        ]);

      const pendingCount = pending.reduce((n, g) => n + g._count._all, 0);
      const pendingSum = (type: string) =>
        new Dec(pending.find((g) => g.type === type)?._sum.amount?.toString() ?? 0);
      const pendingNote =
        pendingCount > 0 ? `No incluye ${pendingCount} movimiento(s) por revisar` : undefined;
      const noAccounts = accounts.length === 0;
      const noAccountsMetric: MetricDto = {
        value: null,
        status: 'NOT_AVAILABLE',
        note: 'Agrega una cuenta de dinero para empezar',
      };

      return {
        company: { id: company.id, name: company.name },
        currency: company.currency,
        period,
        generatedAt: new Date().toISOString(),
        metrics: {
          availableCash: noAccounts
            ? noAccountsMetric
            : confirmed(sum(cashNow), 'Efectivo, bancos y billeteras al día de hoy'),
          undeposited:
            terminalLedgerIds.length === 0
              ? { value: null, status: 'NOT_AVAILABLE', note: 'Sin terminales registradas' }
              : confirmed(sum(terminalNow), 'Cobrado con terminal, aún no depositado'),
          // Ingresos: abonos netos a cuentas de ingreso. Gastos: cargos netos a cuentas de gasto. Sin IVA.
          // Sin cuentas de dinero no puede haber movimientos: no se muestra un 0 "confirmado".
          income: noAccounts ? noAccountsMetric : confirmed(incomeRaw.neg(), pendingNote),
          expenses: noAccounts ? noAccountsMetric : confirmed(expensesRaw, pendingNote),
          netCashFlow: noAccounts ? noAccountsMetric : confirmed(sum(cashInPeriod), pendingNote),
          receivables: notYet,
          payables: notYet,
        },
        pendingReview: {
          count: pendingCount,
          income: pendingSum('INCOME').toFixed(2),
          expenses: pendingSum('EXPENSE').toFixed(2),
        },
        team: { activeMembers, pendingInvitations },
      };
    });
  }
}

@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @Authorize('dashboard:view')
  @ApiQuery({ name: 'period', enum: PERIOD_PRESETS, required: false })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD (personalizado)' })
  @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD (personalizado)' })
  summary(
    @CurrentTenant() t: TenantContext,
    @Query(new ZodPipe(periodQuerySchema)) query: PeriodQuery,
  ) {
    return this.dashboard.summary(t, query);
  }
}

@Module({
  imports: [FinanceModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
