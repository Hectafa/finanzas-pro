import {
  TRANSACTION_STATUS_LABELS,
  TRANSACTION_TYPE_LABELS,
  updateTransactionSchema,
  voidTransactionSchema,
  type TransactionDto,
} from '@finanzas/shared';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, Dialog, Divider, List, Portal, Text, useTheme } from 'react-native-paper';
import { ReceiptsSection } from '../../../components/receipts';
import { ErrorState, Field, FormError, Loading, Screen, styles } from '../../../components/ui';
import { ApiError } from '../../../lib/api';
import { notify } from '../../../lib/confirm';
import { signedAmount, transactionAccounts } from '../../../lib/finance';
import { formatDate, formatMoney } from '../../../lib/format';
import {
  useApproveTransaction,
  useCurrentCompany,
  useTransaction,
  useUpdateTransaction,
  useVoidTransaction,
} from '../../../lib/queries';
import { useSession } from '../../../lib/session';

const FIELDS = ['description', 'counterparty', 'reference', 'notes'] as const;
type Descriptive = Record<(typeof FIELDS)[number], string>;

const FIELD_LABELS: Record<(typeof FIELDS)[number], string> = {
  description: 'Descripción',
  counterparty: 'Cliente o proveedor',
  reference: 'Referencia o folio',
  notes: 'Notas',
};

const descriptiveFrom = (tx: TransactionDto): Descriptive => ({
  description: tx.description ?? '',
  counterparty: tx.counterparty ?? '',
  reference: tx.reference ?? '',
  notes: tx.notes ?? '',
});

const STATUS_ICONS = {
  PENDING_REVIEW: 'progress-clock',
  POSTED: 'check-circle-outline',
  VOIDED: 'cancel',
} as const;

const formatTimestamp = (iso: string) =>
  new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });

export default function MovimientoScreen() {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const company = useCurrentCompany();
  const userId = useSession((s) => s.user?.id);
  const perms = new Set(company.data?.permissions ?? []);
  const query = useTransaction(id);
  const approve = useApproveTransaction();
  const voidTx = useVoidTransaction();
  const update = useUpdateTransaction();
  const [editing, setEditing] = useState<Descriptive | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | undefined>();

  if (query.isPending) return <Loading />;
  if (query.isError)
    return (
      <Screen>
        <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />
      </Screen>
    );

  const tx = query.data;
  const pending = tx.status === 'PENDING_REVIEW';
  const active = tx.status !== 'VOIDED';
  const canApprove = pending && perms.has('transactions:approve');
  const canVoid = active && perms.has('transactions:void');
  // Mismas reglas que el servidor: permiso de edición, o quien lo capturó mientras está por revisar.
  const canEdit =
    active && (perms.has('transactions:update') || (pending && tx.createdBy.id === userId));
  // Comprobantes: además, quien lo capturó puede adjuntar aunque ya esté confirmado.
  const canAttach = active && (perms.has('transactions:update') || tx.createdBy.id === userId);

  const doApprove = async () => {
    try {
      await approve.mutateAsync(tx.id);
    } catch (e) {
      notify('No fue posible aprobar', e instanceof ApiError ? e.message : 'Intenta de nuevo');
    }
  };

  const doVoid = async () => {
    const parsed = voidTransactionSchema.safeParse({ reason });
    if (!parsed.success) {
      setReasonError(parsed.error.issues[0]?.message);
      return;
    }
    try {
      await voidTx.mutateAsync({ id: tx.id, reason: parsed.data.reason });
      setVoiding(false);
      setReason('');
    } catch (e) {
      setReasonError(e instanceof ApiError ? e.message : 'Intenta de nuevo');
    }
  };

  const save = async () => {
    if (!editing) return;
    setFormError(null);
    // Solo se envía lo que cambió; un campo vaciado se envía como null para borrarlo.
    const original = descriptiveFrom(tx);
    const changes: Record<string, string | null> = {};
    for (const f of FIELDS) {
      if (editing[f].trim() !== original[f]) changes[f] = editing[f].trim() || null;
    }
    if (Object.keys(changes).length === 0) {
      setEditing(null);
      return;
    }
    const parsed = updateTransactionSchema.safeParse({ version: tx.version, ...changes });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[issue.path.join('.')] ??= issue.message;
      setErrors(next);
      return;
    }
    try {
      await update.mutateAsync({ id: tx.id, ...parsed.data });
      setEditing(null);
      setErrors({});
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
        setFormError(e.message);
        void query.refetch();
      } else if (e instanceof ApiError) {
        const fields = e.fieldErrors;
        if (Object.keys(fields).length) setErrors(fields);
        else setFormError(e.message);
      } else {
        setFormError('Ocurrió un error inesperado');
      }
    }
  };

  if (editing) {
    return (
      <Screen>
        <Text variant="titleMedium">Editar datos del movimiento</Text>
        <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}>
          El importe, la cuenta, la categoría y la fecha no se editan: si son incorrectos, anula el
          movimiento y regístralo de nuevo.
        </Text>
        <FormError message={formError} />
        {FIELDS.map((f) => (
          <Field
            key={f}
            label={`${FIELD_LABELS[f]} (opcional)`}
            value={editing[f]}
            multiline={f === 'notes'}
            onChangeText={(v) => setEditing({ ...editing, [f]: v })}
            error={errors[f]}
          />
        ))}
        <View style={[styles.row, styles.mt, { gap: 8 }]}>
          <Button
            mode="contained"
            onPress={() => void save()}
            loading={update.isPending}
            disabled={update.isPending}
          >
            Guardar
          </Button>
          <Button onPress={() => setEditing(null)} disabled={update.isPending}>
            Cancelar
          </Button>
        </View>
      </Screen>
    );
  }

  const row = (title: string, value: string | null | undefined, icon: string) =>
    value ? (
      <List.Item
        key={title}
        title={value}
        description={title}
        titleNumberOfLines={6}
        left={(p) => <List.Icon {...p} icon={icon} />}
      />
    ) : null;

  return (
    <Screen>
      <Text variant="labelLarge" style={{ color: theme.colors.secondary }}>
        {TRANSACTION_TYPE_LABELS[tx.type]}
      </Text>
      <Text
        variant="headlineMedium"
        style={tx.status === 'VOIDED' ? { textDecorationLine: 'line-through' } : undefined}
      >
        {signedAmount(tx)}
      </Text>
      <Chip icon={STATUS_ICONS[tx.status]} style={[styles.mtSmall, { alignSelf: 'flex-start' }]}>
        {TRANSACTION_STATUS_LABELS[tx.status]}
      </Chip>
      {pending ? (
        <Text
          variant="bodySmall"
          style={[styles.mtSmall, { color: theme.colors.onSurfaceVariant }]}
        >
          Aún no afecta saldos ni cifras: cuenta hasta que se apruebe.
        </Text>
      ) : null}
      {tx.status === 'VOIDED' && tx.voidReason ? (
        <Text variant="bodyMedium" style={styles.mt}>
          Motivo de anulación: {tx.voidReason}
        </Text>
      ) : null}

      <View style={[styles.row, styles.mt, { gap: 8, flexWrap: 'wrap' }]}>
        {canApprove ? (
          <Button
            mode="contained"
            icon="check"
            onPress={() => void doApprove()}
            loading={approve.isPending}
            disabled={approve.isPending}
          >
            Aprobar
          </Button>
        ) : null}
        {canEdit ? (
          <Button
            mode="outlined"
            icon="pencil-outline"
            onPress={() => {
              setErrors({});
              setFormError(null);
              setEditing(descriptiveFrom(tx));
            }}
          >
            Editar datos
          </Button>
        ) : null}
        {canVoid ? (
          <Button icon="cancel" textColor={theme.colors.error} onPress={() => setVoiding(true)}>
            {pending ? 'Rechazar' : 'Anular'}
          </Button>
        ) : null}
      </View>

      <Divider style={styles.mt} />
      {row('Fecha', formatDate(tx.date), 'calendar')}
      {row(tx.toAccount ? 'Cuentas' : 'Cuenta', transactionAccounts(tx), 'bank-outline')}
      {row('Categoría', tx.category?.name, 'tag-outline')}
      {tx.vatRate !== null
        ? row(
            'IVA incluido',
            `${formatMoney(tx.vatAmount, tx.currency)} (${tx.vatRate} %)`,
            'percent-outline',
          )
        : null}
      {FIELDS.map((f) => row(FIELD_LABELS[f], tx[f], f === 'notes' ? 'note-text-outline' : 'text'))}
      {row(
        'Registrado por',
        `${tx.createdBy.fullName} · ${formatTimestamp(tx.createdAt)}`,
        'account-outline',
      )}
      {tx.voidedAt ? row('Anulado', formatTimestamp(tx.voidedAt), 'cancel') : null}

      <Divider style={styles.mt} />
      <ReceiptsSection transactionId={tx.id} currency={tx.currency} canEdit={canAttach} />

      <Portal>
        <Dialog visible={voiding} onDismiss={() => setVoiding(false)} style={styles.dialog}>
          <Dialog.Title>{pending ? 'Rechazar movimiento' : 'Anular movimiento'}</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" style={{ marginBottom: 8 }}>
              {pending
                ? 'No llegará a afectar los saldos. Queda en el historial como anulado.'
                : 'Se registra un asiento de reversa en la fecha original y los saldos se corrigen. El movimiento queda en el historial como anulado.'}
            </Text>
            <Field
              label="Motivo"
              value={reason}
              onChangeText={(v) => {
                setReason(v);
                setReasonError(undefined);
              }}
              error={reasonError}
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setVoiding(false)} disabled={voidTx.isPending}>
              Cancelar
            </Button>
            <Button
              textColor={theme.colors.error}
              onPress={() => void doVoid()}
              loading={voidTx.isPending}
              disabled={voidTx.isPending}
            >
              {pending ? 'Rechazar' : 'Anular'}
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Screen>
  );
}
