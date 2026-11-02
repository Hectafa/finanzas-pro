import {
  TRANSACTION_STATUS_LABELS,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPE_LABELS,
  TRANSACTION_TYPES,
  type TransactionDto,
  type TransactionStatus,
  type TransactionType,
} from '@finanzas/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, View } from 'react-native';
import { ActivityIndicator, Chip, List, Searchbar, Text, useTheme } from 'react-native-paper';
import { ErrorState, Loading, Screen, SelectField, styles } from '../../../components/ui';
import {
  signedAmount,
  transactionAccounts,
  transactionDirection,
  transactionTitle,
} from '../../../lib/finance';
import { formatDate } from '../../../lib/format';
import { useAccounts, useCurrentCompany, useTransactions } from '../../../lib/queries';

const ALL = '';

/** Espera a que el usuario deje de escribir para no consultar en cada tecla. */
function useDebounced<T>(value: T, ms = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function MovimientosScreen() {
  const theme = useTheme();
  const params = useLocalSearchParams<{ status?: string }>();
  const company = useCurrentCompany();
  const perms = new Set(company.data?.permissions ?? []);
  const canView = perms.has('transactions:view') || perms.has('transactions:view_own');
  const [status, setStatus] = useState<TransactionStatus | typeof ALL>(ALL);
  const [type, setType] = useState<TransactionType | typeof ALL>(ALL);
  const [accountId, setAccountId] = useState<string>(ALL);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());

  // Inicio abre esta pestaña con ?status=PENDING_REVIEW desde el aviso de "por revisar".
  // Se aplica al cambiar el parámetro (ajuste de estado durante el render, sin efecto).
  const [appliedParam, setAppliedParam] = useState<string | undefined>(undefined);
  if (params.status !== appliedParam) {
    setAppliedParam(params.status);
    if (params.status && (TRANSACTION_STATUSES as readonly string[]).includes(params.status)) {
      setStatus(params.status as TransactionStatus);
    }
  }

  const accounts = useAccounts(true);
  const list = useTransactions(
    {
      status: status || undefined,
      type: type || undefined,
      accountId: accountId || undefined,
      q: q || undefined,
    },
    canView,
  );
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  if (company.isPending) return <Loading />;
  if (!canView) {
    return (
      <Screen>
        <Text variant="bodyMedium">Tu rol no incluye consultar movimientos.</Text>
      </Screen>
    );
  }

  const accountOptions = [
    { value: ALL, label: 'Todas las cuentas' },
    ...(accounts.data ?? []).map((a) => ({
      value: a.id,
      label: a.archived ? `${a.name} (archivada)` : a.name,
    })),
  ];

  const header = (
    <View style={{ gap: 8, paddingBottom: 8 }}>
      <Searchbar
        placeholder="Buscar por descripción, proveedor o folio"
        value={search}
        onChangeText={setSearch}
        accessibilityLabel="Buscar movimientos"
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        <Chip selected={status === ALL} onPress={() => setStatus(ALL)}>
          Todos
        </Chip>
        {TRANSACTION_STATUSES.map((s) => (
          <Chip
            key={s}
            selected={status === s}
            showSelectedCheck
            onPress={() => setStatus(status === s ? ALL : s)}
          >
            {TRANSACTION_STATUS_LABELS[s]}
          </Chip>
        ))}
      </ScrollView>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        {TRANSACTION_TYPES.map((t) => (
          <Chip
            key={t}
            compact
            selected={type === t}
            showSelectedCheck
            onPress={() => setType(type === t ? ALL : t)}
          >
            {TRANSACTION_TYPE_LABELS[t]}
          </Chip>
        ))}
      </ScrollView>
      <SelectField
        label="Cuenta"
        value={accountId}
        options={accountOptions}
        onChange={setAccountId}
      />
      {list.isError ? (
        <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
      ) : null}
    </View>
  );

  const renderItem = ({ item }: { item: TransactionDto }) => {
    const voided = item.status === 'VOIDED';
    const dir = transactionDirection(item.type);
    const details = [formatDate(item.date), transactionAccounts(item)];
    if (item.status !== 'POSTED') details.push(TRANSACTION_STATUS_LABELS[item.status]);
    return (
      <List.Item
        title={transactionTitle(item)}
        description={details.join(' · ')}
        titleStyle={voided ? { textDecorationLine: 'line-through' } : undefined}
        left={(p) => (
          <List.Icon
            {...p}
            icon={
              item.status === 'PENDING_REVIEW'
                ? 'progress-clock'
                : voided
                  ? 'cancel'
                  : dir === 'in'
                    ? 'arrow-down-bold-circle-outline'
                    : dir === 'out'
                      ? 'arrow-up-bold-circle-outline'
                      : 'bank-transfer'
            }
          />
        )}
        right={() => (
          <Text
            variant="titleSmall"
            style={{
              alignSelf: 'center',
              color: voided
                ? theme.colors.onSurfaceVariant
                : dir === 'in'
                  ? theme.colors.primary
                  : theme.colors.onSurface,
              textDecorationLine: voided ? 'line-through' : 'none',
            }}
          >
            {signedAmount(item)}
          </Text>
        )}
        onPress={() => router.push(`/movimiento/${item.id}`)}
        accessibilityLabel={`${transactionTitle(item)}, ${signedAmount(item)}, ${details.join(', ')}`}
      />
    );
  };

  return (
    <Screen scroll={false}>
      <FlatList
        style={styles.flex}
        data={items}
        keyExtractor={(t) => t.id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={list.isRefetching && !list.isFetchingNextPage}
            onRefresh={() => void list.refetch()}
          />
        }
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          list.isPending ? (
            <Loading />
          ) : !list.isError ? (
            <Text variant="bodyMedium" style={styles.mt}>
              {status || type || accountId || q
                ? 'No hay movimientos con estos filtros.'
                : 'Aún no hay movimientos. Registra el primero en la pestaña Registrar.'}
            </Text>
          ) : undefined
        }
        ListFooterComponent={
          list.isFetchingNextPage ? <ActivityIndicator style={styles.mt} /> : undefined
        }
      />
    </Screen>
  );
}
