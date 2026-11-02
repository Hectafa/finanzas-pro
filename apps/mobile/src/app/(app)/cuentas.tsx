import {
  createFinancialAccountSchema,
  FINANCIAL_ACCOUNT_TYPE_LABELS,
  FINANCIAL_ACCOUNT_TYPES,
  todayIn,
  updateFinancialAccountSchema,
  type FinancialAccountDto,
  type FinancialAccountType,
} from '@finanzas/shared';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, List, Switch, Text, useTheme } from 'react-native-paper';
import {
  DateField,
  ErrorState,
  Field,
  FormError,
  Loading,
  Screen,
  SelectField,
  styles,
} from '../../components/ui';
import { ApiError } from '../../lib/api';
import { confirmAction, notify } from '../../lib/confirm';
import { formatMoney, normalizeAmountInput } from '../../lib/format';
import {
  useAccounts,
  useArchiveAccount,
  useCreateAccount,
  useCurrentCompany,
  useUpdateAccount,
} from '../../lib/queries';

const TYPE_ICONS: Record<FinancialAccountType, string> = {
  CASH: 'cash',
  BANK: 'bank-outline',
  DIGITAL_WALLET: 'wallet-outline',
  TERMINAL: 'credit-card-clock-outline',
};

const TYPE_OPTIONS = FINANCIAL_ACCOUNT_TYPES.map((t) => ({
  value: t,
  label: FINANCIAL_ACCOUNT_TYPE_LABELS[t],
}));

interface Draft {
  /** null: cuenta nueva. */
  account: FinancialAccountDto | null;
  name: string;
  type: FinancialAccountType;
  institution: string;
  openingBalance: string;
  openingDate: string;
}

export default function CuentasScreen() {
  const theme = useTheme();
  const company = useCurrentCompany();
  const perms = new Set(company.data?.permissions ?? []);
  const canManage = perms.has('accounts:manage');
  const [showArchived, setShowArchived] = useState(false);
  const accounts = useAccounts(showArchived);
  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();
  const archiveAccount = useArchiveAccount();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const saving = createAccount.isPending || updateAccount.isPending;
  const timeZone = company.data?.timeZone ?? 'America/Mexico_City';
  const currency = company.data?.currency ?? 'MXN';

  const open = (account: FinancialAccountDto | null) => {
    setErrors({});
    setFormError(null);
    setDraft({
      account,
      name: account?.name ?? '',
      type: account?.type ?? 'CASH',
      institution: account?.institution ?? '',
      openingBalance: '',
      openingDate: todayIn(timeZone),
    });
  };

  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
      setFormError(e.message);
      void accounts.refetch();
    } else if (e instanceof ApiError) {
      const fields = e.fieldErrors;
      if (Object.keys(fields).length) setErrors(fields);
      else setFormError(e.code === 'CONFLICT' ? 'Ya existe una cuenta con ese nombre' : e.message);
    } else {
      setFormError('Ocurrió un error inesperado');
    }
  };

  const save = async () => {
    if (!draft) return;
    setFormError(null);
    const invalid = (issues: { path: PropertyKey[]; message: string }[]) => {
      const next: Record<string, string> = {};
      for (const issue of issues) next[issue.path.join('.')] ??= issue.message;
      setErrors(next);
    };
    try {
      if (draft.account) {
        const parsed = updateFinancialAccountSchema.safeParse({
          version: draft.account.version,
          name: draft.name,
          institution: draft.institution.trim() || null,
        });
        if (!parsed.success) return invalid(parsed.error.issues);
        setErrors({});
        await updateAccount.mutateAsync({ id: draft.account.id, ...parsed.data });
      } else {
        const parsed = createFinancialAccountSchema.safeParse({
          name: draft.name,
          type: draft.type,
          institution: draft.institution,
          openingBalance: normalizeAmountInput(draft.openingBalance) || '0',
          openingDate: draft.openingDate,
        });
        if (!parsed.success) return invalid(parsed.error.issues);
        setErrors({});
        await createAccount.mutateAsync(parsed.data);
      }
      setDraft(null);
    } catch (e) {
      onError(e);
    }
  };

  const archive = async (account: FinancialAccountDto) => {
    const ok = await confirmAction({
      title: 'Archivar cuenta',
      message: `“${account.name}” ya no aparecerá para registrar movimientos. Su historial se conserva. Solo se puede archivar con saldo en cero.`,
      confirmText: 'Archivar',
      destructive: true,
    });
    if (!ok) return;
    try {
      await archiveAccount.mutateAsync(account.id);
      setDraft(null);
    } catch (e) {
      notify('No fue posible archivar', e instanceof ApiError ? e.message : 'Intenta de nuevo');
    }
  };

  if (company.isPending || accounts.isPending) return <Loading />;
  if (accounts.isError)
    return (
      <Screen>
        <ErrorState message={accounts.error.message} onRetry={() => void accounts.refetch()} />
      </Screen>
    );

  if (draft) {
    const editing = draft.account;
    return (
      <Screen>
        <Text variant="titleMedium">{editing ? `Editar “${editing.name}”` : 'Nueva cuenta'}</Text>
        <FormError message={formError} />
        <Field
          label="Nombre"
          value={draft.name}
          onChangeText={(name) => setDraft({ ...draft, name })}
          error={errors.name}
        />
        {editing ? (
          <Text variant="bodyMedium" style={{ marginBottom: 12 }}>
            Tipo: {FINANCIAL_ACCOUNT_TYPE_LABELS[editing.type]}
          </Text>
        ) : (
          <SelectField
            label="Tipo"
            value={draft.type}
            options={TYPE_OPTIONS}
            onChange={(type) => setDraft({ ...draft, type: type as FinancialAccountType })}
            error={errors.type}
          />
        )}
        <Field
          label="Banco o institución (opcional)"
          value={draft.institution}
          onChangeText={(institution) => setDraft({ ...draft, institution })}
          error={errors.institution}
        />
        {!editing ? (
          <>
            <Field
              label="Saldo inicial"
              value={draft.openingBalance}
              prefix="$"
              placeholder="0.00"
              keyboardType="decimal-pad"
              onChangeText={(openingBalance) => setDraft({ ...draft, openingBalance })}
              error={errors.openingBalance}
            />
            <DateField
              label="Fecha del saldo inicial"
              value={draft.openingDate}
              today={todayIn(timeZone)}
              onChange={(openingDate) => setDraft({ ...draft, openingDate })}
              error={errors.openingDate}
            />
            <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant }}>
              El saldo inicial no cuenta como ingreso: es el dinero que ya tenías al empezar a usar
              la cuenta.
            </Text>
          </>
        ) : null}

        <View style={[styles.row, styles.mtLarge, { gap: 8, flexWrap: 'wrap' }]}>
          <Button mode="contained" onPress={() => void save()} loading={saving} disabled={saving}>
            Guardar
          </Button>
          <Button onPress={() => setDraft(null)} disabled={saving}>
            Cancelar
          </Button>
          {editing && !editing.archived ? (
            <Button
              textColor={theme.colors.error}
              onPress={() => void archive(editing)}
              disabled={saving || archiveAccount.isPending}
            >
              Archivar
            </Button>
          ) : null}
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text variant="bodyMedium">
        Dónde está el dinero del negocio. Los saldos se calculan a partir de los movimientos
        confirmados.
      </Text>
      {canManage ? (
        <Button mode="contained" icon="plus" style={styles.mt} onPress={() => open(null)}>
          Nueva cuenta
        </Button>
      ) : null}
      <View style={[styles.row, styles.mt, { justifyContent: 'space-between' }]}>
        <Text variant="bodyMedium">Mostrar archivadas</Text>
        <Switch
          value={showArchived}
          onValueChange={setShowArchived}
          accessibilityLabel="Mostrar cuentas archivadas"
        />
      </View>
      {accounts.data.length === 0 ? (
        <Text variant="bodyMedium" style={styles.mt}>
          Aún no hay cuentas. {canManage ? 'Crea la primera: por ejemplo, “Caja”.' : ''}
        </Text>
      ) : null}
      {accounts.data.map((a) => (
        <List.Item
          key={a.id}
          title={a.name}
          description={[FINANCIAL_ACCOUNT_TYPE_LABELS[a.type], a.institution]
            .filter(Boolean)
            .join(' · ')}
          left={(p) => <List.Icon {...p} icon={TYPE_ICONS[a.type]} />}
          right={() => (
            <View style={[styles.row, { gap: 8 }]}>
              {a.archived ? <Chip compact>Archivada</Chip> : null}
              {a.balance !== null ? (
                <Text
                  variant="titleSmall"
                  accessibilityLabel={`Saldo: ${formatMoney(a.balance, a.currency || currency)}`}
                >
                  {formatMoney(a.balance, a.currency || currency)}
                </Text>
              ) : null}
            </View>
          )}
          onPress={canManage && !a.archived ? () => open(a) : undefined}
        />
      ))}
    </Screen>
  );
}
