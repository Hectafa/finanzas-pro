import {
  createCategorySchema,
  updateCategorySchema,
  type CategoryDto,
  type CategoryNature,
} from '@finanzas/shared';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, List, SegmentedButtons, Switch, Text, useTheme } from 'react-native-paper';
import {
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
import {
  useArchiveCategory,
  useCategories,
  useCreateCategory,
  useCurrentCompany,
  useUpdateCategory,
} from '../../lib/queries';

const NO_PARENT = '';

interface Draft {
  /** null: categoría nueva. */
  category: CategoryDto | null;
  name: string;
  parentId: string;
}

export default function CategoriasScreen() {
  const theme = useTheme();
  const company = useCurrentCompany();
  const canManage = company.data?.permissions.includes('categories:manage') ?? false;
  const [nature, setNature] = useState<CategoryNature>('EXPENSE');
  const [showArchived, setShowArchived] = useState(false);
  const categories = useCategories(showArchived);
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const archiveCategory = useArchiveCategory();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const saving = createCategory.isPending || updateCategory.isPending;

  const all = (categories.data ?? []).filter((c) => c.nature === nature);
  const byName = (a: CategoryDto, b: CategoryDto) => a.name.localeCompare(b.name, 'es');
  const parents = all.filter((c) => !c.parentId).sort(byName);
  const childrenOf = (id: string) => all.filter((c) => c.parentId === id).sort(byName);

  const open = (category: CategoryDto | null, parentId = NO_PARENT) => {
    setErrors({});
    setFormError(null);
    setDraft({ category, name: category?.name ?? '', parentId });
  };

  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
      setFormError(e.message);
      void categories.refetch();
    } else if (e instanceof ApiError) {
      const fields = e.fieldErrors;
      if (Object.keys(fields).length) setErrors(fields);
      else
        setFormError(e.code === 'CONFLICT' ? 'Ya existe una categoría con ese nombre' : e.message);
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
      if (draft.category) {
        const parsed = updateCategorySchema.safeParse({
          version: draft.category.version,
          name: draft.name,
        });
        if (!parsed.success) return invalid(parsed.error.issues);
        setErrors({});
        await updateCategory.mutateAsync({ id: draft.category.id, ...parsed.data });
      } else {
        const parsed = createCategorySchema.safeParse({
          name: draft.name,
          nature,
          parentId: draft.parentId || undefined,
        });
        if (!parsed.success) return invalid(parsed.error.issues);
        setErrors({});
        await createCategory.mutateAsync(parsed.data);
      }
      setDraft(null);
    } catch (e) {
      onError(e);
    }
  };

  const archive = async (category: CategoryDto) => {
    const ok = await confirmAction({
      title: 'Archivar categoría',
      message: `“${category.name}” ya no aparecerá al registrar. Los movimientos que la usan conservan su categoría.`,
      confirmText: 'Archivar',
      destructive: true,
    });
    if (!ok) return;
    try {
      await archiveCategory.mutateAsync(category.id);
      setDraft(null);
    } catch (e) {
      notify('No fue posible archivar', e instanceof ApiError ? e.message : 'Intenta de nuevo');
    }
  };

  if (company.isPending || categories.isPending) return <Loading />;
  if (categories.isError)
    return (
      <Screen>
        <ErrorState message={categories.error.message} onRetry={() => void categories.refetch()} />
      </Screen>
    );

  const natureLabel = nature === 'INCOME' ? 'ingreso' : 'gasto';

  if (draft) {
    const editing = draft.category;
    const parentOptions = [
      { value: NO_PARENT, label: 'Ninguna (categoría principal)' },
      ...parents.filter((p) => !p.archived).map((p) => ({ value: p.id, label: p.name })),
    ];
    return (
      <Screen>
        <Text variant="titleMedium">
          {editing ? `Renombrar “${editing.name}”` : `Nueva categoría de ${natureLabel}`}
        </Text>
        <FormError message={formError} />
        <Field
          label="Nombre"
          value={draft.name}
          onChangeText={(name) => setDraft({ ...draft, name })}
          error={errors.name}
        />
        {!editing ? (
          <SelectField
            label="Dentro de"
            value={draft.parentId}
            options={parentOptions}
            onChange={(parentId) => setDraft({ ...draft, parentId })}
            error={errors.parentId}
          />
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
              disabled={saving || archiveCategory.isPending}
            >
              Archivar
            </Button>
          ) : null}
        </View>
      </Screen>
    );
  }

  const item = (c: CategoryDto, child: boolean) => (
    <List.Item
      key={c.id}
      title={c.name}
      style={child ? { paddingLeft: 32 } : undefined}
      left={(p) => <List.Icon {...p} icon={child ? 'subdirectory-arrow-right' : 'tag-outline'} />}
      right={() =>
        c.archived ? (
          <Chip compact style={{ alignSelf: 'center' }}>
            Archivada
          </Chip>
        ) : null
      }
      onPress={canManage && !c.archived ? () => open(c) : undefined}
    />
  );

  return (
    <Screen>
      <SegmentedButtons
        value={nature}
        onValueChange={(v) => setNature(v as CategoryNature)}
        buttons={[
          { value: 'EXPENSE', label: 'Gastos', icon: 'arrow-up-bold-circle-outline' },
          { value: 'INCOME', label: 'Ingresos', icon: 'arrow-down-bold-circle-outline' },
        ]}
      />
      {canManage ? (
        <Button mode="contained" icon="plus" style={styles.mt} onPress={() => open(null)}>
          Nueva categoría de {natureLabel}
        </Button>
      ) : null}
      <View style={[styles.row, styles.mt, { justifyContent: 'space-between' }]}>
        <Text variant="bodyMedium">Mostrar archivadas</Text>
        <Switch
          value={showArchived}
          onValueChange={setShowArchived}
          accessibilityLabel="Mostrar categorías archivadas"
        />
      </View>
      {parents.map((p) => (
        <View key={p.id}>
          {item(p, false)}
          {childrenOf(p.id).map((c) => item(c, true))}
          {canManage && !p.archived ? (
            <Button
              compact
              icon="plus"
              style={{ alignSelf: 'flex-start', marginLeft: 32 }}
              onPress={() => open(null, p.id)}
              accessibilityLabel={`Agregar subcategoría a ${p.name}`}
            >
              Subcategoría
            </Button>
          ) : null}
        </View>
      ))}
    </Screen>
  );
}
