import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import {
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

/** Las métricas financieras se calculan a partir del libro contable, que llega en la Fase 2. */
const notYet: MetricDto = {
  value: null,
  status: 'NOT_AVAILABLE',
  note: 'Disponible cuando se registren cuentas y movimientos',
};

@Injectable()
export class DashboardService {
  constructor(private readonly db: DbService) {}

  async summary(t: TenantContext, query: PeriodQuery): Promise<DashboardSummaryDto> {
    return this.db.tenant(t, async (tx) => {
      const company = await tx.company.findUniqueOrThrow({ where: { id: t.companyId } });
      let period;
      try {
        period = resolvePeriod(query, company.timeZone);
      } catch (e) {
        throw Errors.badRequest('INVALID_PERIOD', e instanceof Error ? e.message : 'Periodo inválido');
      }
      const [activeMembers, pendingInvitations] = await Promise.all([
        tx.companyMembership.count({ where: { companyId: t.companyId, status: 'ACTIVE' } }),
        tx.invitation.count({ where: { companyId: t.companyId, status: 'PENDING', expiresAt: { gt: new Date() } } }),
      ]);
      return {
        company: { id: company.id, name: company.name },
        currency: company.currency,
        period,
        generatedAt: new Date().toISOString(),
        metrics: {
          availableCash: notYet,
          income: notYet,
          expenses: notYet,
          netCashFlow: notYet,
          receivables: notYet,
          payables: notYet,
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
  summary(@CurrentTenant() t: TenantContext, @Query(new ZodPipe(periodQuerySchema)) query: PeriodQuery) {
    return this.dashboard.summary(t, query);
  }
}

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
