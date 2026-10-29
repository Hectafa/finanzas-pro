import { createRoleSchema, permissionGroups, type RoleDto } from '@finanzas/shared';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Checkbox, Chip, HelperText, List, Text, useTheme } from 'react-native-paper';
import { ErrorState, Field, FormError, Loading, Screen, styles } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { confirmAction, notify } from '../../lib/confirm';
import {
  useArchiveRole,
  useCreateRole,
  useCurrentCompany,
  useRoles,
  useUpdateRole,
} from '../../lib/queries';

const GROUPS = permissionGroups();

interface Draft {
  /** null: rol nuevo. */
  role: RoleDto | null;
  name: string;
  description: string;
  permissions: Set<string>;
}

const draftFrom = (role: RoleDto | null): Draft => ({
  role,
  name: role?.name ?? '',
  description: role?.description ?? '',
  permissions: new Set(role?.permissions ?? []),
});

export default function RolesScreen() {
  const theme = useTheme();
  const company = useCurrentCompany();
  const perms = new Set(company.data?.permissions ?? []);
  const canManage = perms.has('users:manage');
  const roles = useRoles(perms.has('users:view'));
  const createRole = useCreateRole();
  const updateRole = useUpdateRole();
  const archiveRole = useArchiveRole();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const saving = createRole.isPending || updateRole.isPending;

  // Mismas reglas que el servidor (que las vuelve a validar): rol personalizado, no el propio,
  // y sin permisos que el usuario no tenga.
  const editable = (r: RoleDto) =>
    canManage &&
    !r.isSystem &&
    r.id !== company.data?.role.id &&
    r.permissions.every((p) => perms.has(p));

  const open = (role: RoleDto | null) => {
    setErrors({});
    setFormError(null);
    setDraft(draftFrom(role));
  };

  const toggle = (key: string) =>
    setDraft((d) => {
      if (!d) return d;
      const next = new Set(d.permissions);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...d, permissions: next };
    });

  const onError = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
      setFormError(e.message);
      void roles.refetch();
    } else if (e instanceof ApiError) {
      const fields = e.fieldErrors;
      if (Object.keys(fields).length) setErrors(fields);
      else setFormError(e.status === 409 ? 'Ya existe un rol con ese nombre' : e.message);
    } else {
      setFormError('Ocurrió un error inesperado');
    }
  };

  const save = async () => {
    if (!draft) return;
    setFormError(null);
    const input = {
      name: draft.name,
      description: draft.description.trim() || undefined,
      permissions: [...draft.permissions],
    };
    const parsed = createRoleSchema.safeParse(input);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[issue.path.join('.')] ??= issue.message;
      setErrors(next);
      return;
    }
    setErrors({});
    try {
      if (draft.role) {
        await updateRole.mutateAsync({
          id: draft.role.id,
          version: draft.role.version,
          ...parsed.data,
          description: parsed.data.description ?? null,
        });
      } else {
        await createRole.mutateAsync(parsed.data);
      }
      setDraft(null);
    } catch (e) {
      onError(e);
    }
  };

  const archive = async (role: RoleDto) => {
    const ok = await confirmAction({
      title: 'Archivar rol',
      message: `“${role.name}” dejará de estar disponible para asignar. Las invitaciones pendientes con este rol se cancelarán.`,
      confirmText: 'Archivar',
      destructive: true,
    });
    if (!ok) return;
    try {
      await archiveRole.mutateAsync(role.id);
      setDraft(null);
    } catch (e) {
      notify('No fue posible archivar', e instanceof ApiError ? e.message : 'Intenta de nuevo');
    }
  };

  if (company.isPending || roles.isPending) return <Loading />;
  if (roles.isError)
    return <ErrorState message={roles.error.message} onRetry={() => void roles.refetch()} />;

  if (draft) {
    return (
      <Screen>
        <Text variant="titleMedium">
          {draft.role ? `Editar “${draft.role.name}”` : 'Nuevo rol'}
        </Text>
        <FormError message={formError} />
        <Field
          label="Nombre"
          value={draft.name}
          onChangeText={(name) => setDraft({ ...draft, name })}
          error={errors.name}
        />
        <Field
          label="Descripción (opcional)"
          value={draft.description}
          onChangeText={(description) => setDraft({ ...draft, description })}
          error={errors.description}
        />
        {draft.role && draft.role.memberCount > 0 ? (
          <HelperText type="info">
            {draft.role.memberCount === 1
              ? '1 persona tiene'
              : `${draft.role.memberCount} personas tienen`}{' '}
            este rol: los cambios aplican de inmediato.
          </HelperText>
        ) : null}

        <Text variant="titleSmall" style={styles.mt}>
          Permisos
        </Text>
        {errors.permissions ? <HelperText type="error">{errors.permissions}</HelperText> : null}
        <View style={[styles.grid, { alignItems: 'flex-start' }]}>
          {GROUPS.map((g) => (
            <Card key={g.module} mode="outlined" style={styles.permissionGroup}>
              <Card.Title title={g.label} titleVariant="titleSmall" />
              {g.permissions.map((p) => {
                const allowed = perms.has(p.key);
                return (
                  <Checkbox.Item
                    key={p.key}
                    label={allowed ? p.label : `${p.label} (no lo tienes)`}
                    status={draft.permissions.has(p.key) ? 'checked' : 'unchecked'}
                    onPress={() => toggle(p.key)}
                    disabled={!allowed}
                    mode="android"
                    position="leading"
                    labelVariant="bodyMedium"
                    labelStyle={{ textAlign: 'left' }}
                    accessibilityLabel={`${g.label}: ${p.label}`}
                  />
                );
              })}
            </Card>
          ))}
        </View>

        <View style={[styles.row, styles.mtLarge, { gap: 8, flexWrap: 'wrap' }]}>
          <Button mode="contained" onPress={() => void save()} loading={saving} disabled={saving}>
            Guardar
          </Button>
          <Button onPress={() => setDraft(null)} disabled={saving}>
            Cancelar
          </Button>
          {draft.role ? (
            <Button
              textColor={theme.colors.error}
              onPress={() => void archive(draft.role!)}
              disabled={saving || archiveRole.isPending}
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
        Los roles del sistema no se modifican. Crea roles propios para ajustar exactamente qué puede
        hacer cada persona.
      </Text>
      {canManage ? (
        <Button mode="contained" icon="plus" style={styles.mt} onPress={() => open(null)}>
          Nuevo rol
        </Button>
      ) : null}
      {roles.data.map((r) => (
        <List.Item
          key={r.id}
          title={r.name}
          description={[
            r.description,
            `${r.permissions.length} permisos · ${r.memberCount === 1 ? '1 persona' : `${r.memberCount} personas`}`,
          ]
            .filter(Boolean)
            .join('\n')}
          descriptionNumberOfLines={3}
          left={(p) => (
            <List.Icon {...p} icon={r.isSystem ? 'shield-lock-outline' : 'shield-edit-outline'} />
          )}
          right={() =>
            r.isSystem ? (
              <Chip compact style={{ alignSelf: 'center' }}>
                Sistema
              </Chip>
            ) : editable(r) ? (
              <List.Icon icon="chevron-right" />
            ) : null
          }
          onPress={editable(r) ? () => open(r) : undefined}
        />
      ))}
    </Screen>
  );
}
