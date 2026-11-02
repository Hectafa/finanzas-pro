import type { PeriodPreset } from '@finanzas/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { Chip, SegmentedButtons, Text, useTheme } from 'react-native-paper';
import { ErrorState, Loading, MetricCard, styles } from '../../../components/ui';
import { formatDateRange } from '../../../lib/format';
import { useCurrentCompany, useDashboard } from '../../../lib/queries';

const PERIODS: { value: PeriodPreset; label: string }[] = [
  { value: 'day', label: 'Día' },
  { value: 'week', label: 'Semana' },
  { value: 'month', label: 'Mes' },
  { value: 'quarter', label: 'Trim.' },
  { value: 'year', label: 'Año' },
];

export default function InicioScreen() {
  const theme = useTheme();
  const [period, setPeriod] = useState<PeriodPreset>('month');
  const company = useCurrentCompany();
  const canView = company.data?.permissions.includes('dashboard:view') ?? false;
  const dashboard = useDashboard(period);

  return (
    <ScrollView
      style={{ backgroundColor: theme.colors.background }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={dashboard.isRefetching}
          onRefresh={() => void dashboard.refetch()}
        />
      }
    >
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Text variant="titleLarge" style={{ flexShrink: 1 }}>
          {company.data?.name ?? ''}
        </Text>
        <Chip
          icon="swap-horizontal"
          onPress={() => router.push('/select-company')}
          accessibilityLabel="Cambiar de empresa"
        >
          Cambiar
        </Chip>
      </View>
      {company.data?.isDemo ? (
        <Chip icon="flask-outline" style={[styles.mtSmall, { alignSelf: 'flex-start' }]}>
          Empresa de demostración
        </Chip>
      ) : null}

      {company.isPending ? <Loading /> : null}
      {company.data && !canView ? (
        <Text variant="bodyMedium" style={styles.mt}>
          Tu rol ({company.data.role.name}) no incluye el resumen financiero. Usa la pestaña
          Registrar para capturar operaciones.
        </Text>
      ) : null}

      {canView ? (
        <>
          <SegmentedButtons
            style={styles.mt}
            value={period}
            onValueChange={(v) => setPeriod(v as PeriodPreset)}
            buttons={PERIODS.map((p) => ({ ...p, accessibilityLabel: `Periodo: ${p.label}` }))}
            density="small"
          />
          {dashboard.isPending ? <Loading label="Calculando…" /> : null}
          {dashboard.isError ? (
            <ErrorState
              message={dashboard.error.message}
              onRetry={() => void dashboard.refetch()}
            />
          ) : null}
          {dashboard.data ? (
            <>
              <Text
                variant="bodySmall"
                style={[styles.mt, { color: theme.colors.onSurfaceVariant }]}
              >
                {formatDateRange(dashboard.data.period.fromDate, dashboard.data.period.toDate)} ·{' '}
                {dashboard.data.currency}
              </Text>
              <View style={[styles.grid, styles.mt]}>
                <MetricCard
                  title="Dinero disponible"
                  metric={dashboard.data.metrics.availableCash}
                  currency={dashboard.data.currency}
                />
                <MetricCard
                  title="Flujo neto"
                  metric={dashboard.data.metrics.netCashFlow}
                  currency={dashboard.data.currency}
                />
                <MetricCard
                  title="Ingresos"
                  metric={dashboard.data.metrics.income}
                  currency={dashboard.data.currency}
                />
                <MetricCard
                  title="Egresos"
                  metric={dashboard.data.metrics.expenses}
                  currency={dashboard.data.currency}
                />
                <MetricCard
                  title="Por cobrar"
                  metric={dashboard.data.metrics.receivables}
                  currency={dashboard.data.currency}
                />
                <MetricCard
                  title="Por pagar"
                  metric={dashboard.data.metrics.payables}
                  currency={dashboard.data.currency}
                />
              </View>
              <Text
                variant="bodySmall"
                style={[styles.mt, { color: theme.colors.onSurfaceVariant }]}
              >
                Equipo: {dashboard.data.team.activeMembers} miembro(s) activo(s) ·{' '}
                {dashboard.data.team.pendingInvitations} invitación(es) pendiente(s)
              </Text>
            </>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
