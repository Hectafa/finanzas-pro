import {
  createTransactionSchema,
  moneySchema,
  todayIn,
  TRANSACTION_STATUS_LABELS,
  TRANSACTION_TYPE_LABELS,
  TRANSACTION_TYPES,
  vatIncluded,
  type TransactionDto,
  type TransactionType,
  type VatRate,
} from '@finanzas/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Image, View } from 'react-native';
import { Banner, Button, Chip, SegmentedButtons, Text, useTheme } from 'react-native-paper';
import {
  DateField,
  ErrorState,
  Field,
  FormError,
  Loading,
  Screen,
  SelectField,
  styles,
} from '../../../components/ui';
import { ReceiptPickButtons, useReceiptUploader } from '../../../components/receipts';
import { ApiError, NETWORK_ERROR } from '../../../lib/api';
import { categoryOptions, transactionDirection } from '../../../lib/finance';
import { formatMoney, normalizeAmountInput } from '../../../lib/format';
import { newId } from '../../../lib/id';
import type { ReceiptFile } from '../../../lib/receipts';
import {
  useAccounts,
  useCategories,
  useCreateTransaction,
  useCurrentCompany,
} from '../../../lib/queries';

const TYPE_ICONS: Record<TransactionType, string> = {
  INCOME: 'arrow-down-bold-circle-outline',
  EXPENSE: 'arrow-up-bold-circle-outline',
  TRANSFER: 'bank-transfer',
  OWNER_CONTRIBUTION: 'account-arrow-left-outline',
  OWNER_WITHDRAWAL: 'account-arrow-right-outline',
};

const HINTS: Record<TransactionType, string> = {
  INCOME: 'Dinero que entra por la operación del negocio: ventas, servicios, otros ingresos.',
  EXPENSE: 'Dinero que sale para operar: insumos, renta, servicios, sueldos.',
  TRANSFER:
    'Mover dinero entre tus cuentas (p. ej. depositar la caja al banco). No es ingreso ni gasto.',
  OWNER_CONTRIBUTION: 'Dinero que un socio pone en el negocio. Es capital, no un ingreso.',
  OWNER_WITHDRAWAL: 'Dinero que un socio saca para sí. Es retiro de capital, no un gasto.',
};

/** '' = sin desglose de IVA. */
type VatChoice = VatRate | '';

interface FormState {
  id: string;
  amount: string;
  accountId: string | null;
  toAccountId: string | null;
  categoryId: string | null;
  vatRate: VatChoice;
  date: string;
  description: string;
  counterparty: string;
  reference: string;
  notes: string;
}

const emptyForm = (date: string, accountId: string | null): FormState => ({
  id: newId(),
  amount: '',
  accountId,
  toAccountId: null,
  categoryId: null,
  vatRate: '',
  date,
  description: '',
  counterparty: '',
  reference: '',
  notes: '',
});

/** Vista previa del IVA incluido; solo si el importe ya es válido (vatIncluded no acepta otra cosa). */
function vatPreview(amount: string, rate: VatChoice, currency: string): string | null {
  if (rate === '' || rate === '0' || !moneySchema.safeParse(amount).success) return null;
  return formatMoney(vatIncluded(amount, rate).toFixed(2), currency);
}

export default function RegistrarScreen() {
  const theme = useTheme();
  const company = useCurrentCompany();
  const perms = new Set(company.data?.permissions ?? []);
  const canCreate = perms.has('transactions:create');
  const needsReview = !perms.has('transactions:approve');
  const accounts = useAccounts();
  const categories = useCategories();
  const create = useCreateTransaction();
  const timeZone = company.data?.timeZone ?? 'America/Mexico_City';
  const currency = company.data?.currency ?? 'MXN';
  const today = todayIn(timeZone);

  const [type, setType] = useState<TransactionType>('EXPENSE');
  const [form, setForm] = useState<FormState>(() => emptyForm(today, null));
  const [showMore, setShowMore] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<TransactionDto | null>(null);
  const [receipt, setReceipt] = useState<ReceiptFile | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const uploader = useReceiptUploader(currency);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors(({ [key]: _removed, ...rest }) => rest);
  };

  const changeType = (next: TransactionType) => {
    setType(next);
    // La categoría depende de la naturaleza (ingreso o gasto); el resto se conserva.
    setForm((f) => ({ ...f, categoryId: null, toAccountId: null, vatRate: '' }));
    setErrors({});
  };

  const withCategory = type === 'INCOME' || type === 'EXPENSE';
  const accountList = accounts.data ?? [];
  const accountOptions = accountList.map((a) => ({
    value: a.id,
    label: a.name,
    description: a.balance !== null ? `Saldo: ${formatMoney(a.balance, a.currency)}` : undefined,
  }));
  const catOptions = withCategory
    ? categoryOptions(categories.data ?? [], type === 'INCOME' ? 'INCOME' : 'EXPENSE').map((o) => ({
        value: o.id,
        label: o.label,
        indent: o.child,
      }))
    : [];
  // Si solo hay una cuenta, se usa sin preguntar.
  const accountId = form.accountId ?? (accountList.length === 1 ? accountList[0]!.id : null);

  const submit = async () => {
    setFormError(null);
    setSaved(null);
    const base = {
      id: form.id,
      date: form.date,
      amount: normalizeAmountInput(form.amount),
      description: form.description,
      reference: form.reference,
      counterparty: form.counterparty,
      notes: form.notes,
      accountId: accountId ?? '',
    };
    const input =
      type === 'INCOME' || type === 'EXPENSE'
        ? { ...base, type, categoryId: form.categoryId ?? '', vatRate: form.vatRate || null }
        : type === 'TRANSFER'
          ? { ...base, type, toAccountId: form.toAccountId ?? '' }
          : { ...base, type };
    const parsed = createTransactionSchema.safeParse(input);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? '_');
        // Un id vacío de cuenta/categoría significa "no elegido", no "formato inválido".
        next[key] ??=
          /Id$/.test(key) && !(input as Record<string, unknown>)[key]
            ? 'Elige una opción'
            : issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    try {
      const tx = await create.mutateAsync(parsed.data);
      setSaved(tx);
      // Nuevo id para la siguiente captura; se conservan tipo, cuenta y fecha para capturar en serie.
      setForm({ ...emptyForm(form.date, accountId), vatRate: form.vatRate });
      setShowMore(false);
      setReceiptError(null);
      if (receipt) {
        // El movimiento ya quedó guardado: si la foto falla, se avisa y se agrega desde el detalle.
        // Si está repetida, el diálogo de duplicado decide.
        try {
          await uploader.send(tx.id, receipt);
        } catch (e) {
          setReceiptError(
            `El movimiento se guardó, pero el comprobante no: ${(e as Error).message}. Agrégalo desde “Ver”.`,
          );
        }
        setReceipt(null);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'IDEMPOTENCY_CONFLICT') {
        // Un intento anterior sí llegó al servidor con otros datos: no se pisa, se captura aparte.
        setForm((f) => ({ ...f, id: newId() }));
        setFormError(
          'Un intento anterior ya se había registrado con otros datos. Revisa Movimientos antes de volver a guardar.',
        );
      } else if (e instanceof ApiError && e.code === NETWORK_ERROR) {
        // Se conserva el id: reintentar no duplica el movimiento.
        setFormError(`${e.message}. Puedes reintentar sin riesgo de duplicarlo.`);
      } else if (e instanceof ApiError) {
        const fields = e.fieldErrors;
        if (Object.keys(fields).length) setErrors(fields);
        else setFormError(e.message);
      } else {
        setFormError('Ocurrió un error inesperado');
      }
    }
  };

  if (company.isPending || accounts.isPending || categories.isPending) return <Loading />;
  if (!canCreate) {
    return (
      <Screen>
        <Text variant="bodyMedium">Tu rol no incluye registrar movimientos.</Text>
      </Screen>
    );
  }
  if (accounts.isError || categories.isError) {
    const retry = () => void Promise.all([accounts.refetch(), categories.refetch()]);
    return (
      <Screen>
        <ErrorState message={(accounts.error ?? categories.error)!.message} onRetry={retry} />
      </Screen>
    );
  }

  const preview = withCategory
    ? vatPreview(normalizeAmountInput(form.amount), form.vatRate, currency)
    : null;
  const dir = transactionDirection(type);

  return (
    <Screen>
      <Banner
        visible={!!saved}
        icon={saved?.status === 'PENDING_REVIEW' ? 'progress-clock' : 'check-circle-outline'}
        actions={[
          { label: 'Ver', onPress: () => saved && router.push(`/movimiento/${saved.id}`) },
          { label: 'Cerrar', onPress: () => setSaved(null) },
        ]}
      >
        {saved
          ? `${TRANSACTION_TYPE_LABELS[saved.type]} de ${formatMoney(saved.amount, saved.currency)} guardado · ${TRANSACTION_STATUS_LABELS[saved.status]}`
          : ''}
      </Banner>
      {receiptError ? (
        <Text variant="bodyMedium" style={{ color: theme.colors.error, marginBottom: 8 }}>
          {receiptError}
        </Text>
      ) : null}
      {uploader.dialog}

      <View style={[styles.row, { gap: 8, flexWrap: 'wrap' }]}>
        {TRANSACTION_TYPES.map((t) => (
          <Chip
            key={t}
            icon={TYPE_ICONS[t]}
            selected={t === type}
            showSelectedOverlay
            onPress={() => changeType(t)}
            accessibilityState={{ selected: t === type }}
          >
            {TRANSACTION_TYPE_LABELS[t]}
          </Chip>
        ))}
      </View>
      <Text variant="bodySmall" style={[styles.mt, { color: theme.colors.onSurfaceVariant }]}>
        {HINTS[type]}
      </Text>
      {needsReview ? (
        <Text
          variant="bodySmall"
          style={[styles.mtSmall, { color: theme.colors.onSurfaceVariant }]}
        >
          Lo que registres quedará “Por revisar” hasta que alguien con permiso lo apruebe.
        </Text>
      ) : null}

      <View style={styles.mt}>
        <FormError message={formError} />
        <Field
          label="Importe"
          value={form.amount}
          prefix="$"
          placeholder="0.00"
          keyboardType="decimal-pad"
          onChangeText={(v) => set('amount', v)}
          error={errors.amount}
        />
        <SelectField
          label={
            type === 'TRANSFER'
              ? 'Desde la cuenta'
              : dir === 'in'
                ? 'Entra a la cuenta'
                : 'Sale de la cuenta'
          }
          value={accountId}
          options={accountOptions}
          onChange={(v) => set('accountId', v)}
          error={errors.accountId}
          emptyText="Aún no hay cuentas. Créalas en Más › Cuentas de dinero."
        />
        {type === 'TRANSFER' ? (
          <SelectField
            label="Hacia la cuenta"
            value={form.toAccountId}
            options={accountOptions.filter((o) => o.value !== accountId)}
            onChange={(v) => set('toAccountId', v)}
            error={errors.toAccountId}
            emptyText="Necesitas al menos dos cuentas para transferir."
          />
        ) : null}
        {withCategory ? (
          <>
            <SelectField
              label="Categoría"
              value={form.categoryId}
              options={catOptions}
              onChange={(v) => set('categoryId', v)}
              error={errors.categoryId}
            />
            <Text variant="labelLarge">IVA incluido en el importe</Text>
            <SegmentedButtons
              style={styles.mtSmall}
              density="small"
              value={form.vatRate}
              onValueChange={(v) => set('vatRate', v as VatChoice)}
              buttons={[
                { value: '', label: 'Sin desglose' },
                { value: '16', label: '16 %' },
                { value: '8', label: '8 %' },
                { value: '0', label: '0 %' },
              ]}
            />
            <Text
              variant="bodySmall"
              style={[styles.mtSmall, { color: theme.colors.onSurfaceVariant, marginBottom: 12 }]}
            >
              {preview ? `IVA incluido: ${preview}` : ' '}
            </Text>
          </>
        ) : null}
        <DateField
          label="Fecha"
          value={form.date}
          today={today}
          onChange={(v) => set('date', v)}
          error={errors.date}
        />
        <Field
          label="Descripción (opcional)"
          value={form.description}
          onChangeText={(v) => set('description', v)}
          error={errors.description}
        />
        {showMore ? (
          <>
            <Field
              label={
                dir === 'in'
                  ? 'Cliente o quién paga (opcional)'
                  : 'Proveedor o a quién se paga (opcional)'
              }
              value={form.counterparty}
              onChangeText={(v) => set('counterparty', v)}
              error={errors.counterparty}
            />
            <Field
              label="Referencia o folio (opcional)"
              value={form.reference}
              onChangeText={(v) => set('reference', v)}
              error={errors.reference}
            />
            <Field
              label="Notas (opcional)"
              value={form.notes}
              multiline
              onChangeText={(v) => set('notes', v)}
              error={errors.notes}
            />
          </>
        ) : (
          <Button
            compact
            icon="plus"
            style={{ alignSelf: 'flex-start' }}
            onPress={() => setShowMore(true)}
          >
            Más datos (proveedor, folio, notas)
          </Button>
        )}

        <Text variant="labelLarge" style={styles.mt}>
          Comprobante (opcional)
        </Text>
        {receipt ? (
          <View style={[styles.row, styles.mtSmall, { gap: 12 }]}>
            <Image
              source={{ uri: receipt.uri }}
              style={{ width: 64, height: 64, borderRadius: 8 }}
              accessibilityLabel="Foto del comprobante"
            />
            <Text variant="bodyMedium" style={{ flex: 1 }} numberOfLines={1}>
              {receipt.name}
            </Text>
            <Button onPress={() => setReceipt(null)} disabled={create.isPending}>
              Quitar
            </Button>
          </View>
        ) : (
          <View style={styles.mtSmall}>
            <ReceiptPickButtons onPicked={setReceipt} disabled={create.isPending} />
          </View>
        )}

        <Button
          mode="contained"
          icon="content-save-outline"
          style={styles.mtLarge}
          onPress={() => void submit()}
          loading={create.isPending || uploader.uploading}
          disabled={create.isPending || uploader.uploading}
        >
          Guardar {TRANSACTION_TYPE_LABELS[type].toLowerCase()}
        </Button>
      </View>
    </Screen>
  );
}
