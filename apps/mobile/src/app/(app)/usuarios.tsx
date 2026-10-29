import { createInvitationSchema } from '@finanzas/shared';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Button, Card, Chip, HelperText, List, Text } from 'react-native-paper';
import { ErrorState, Field, FormError, Loading, Screen, styles } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useZodForm } from '../../lib/forms';
import { useCurrentCompany, useInvitations, useInvite, useMembers, useRevokeInvitation, useRoles, useSetMemberStatus } from '../../lib/queries';
import { useSession } from '../../lib/session';

const STATUS_LABEL = { PENDING: 'Pendiente', ACCEPTED: 'Aceptada', REVOKED: 'Cancelada', EXPIRED: 'Vencida' } as const;

export default function UsuariosScreen() {
  const company = useCurrentCompany();
  const me = useSession((s) => s.user);
  const perms = new Set(company.data?.permissions ?? []);
  const members = useMembers(perms.has('users:view'));
  const invitations = useInvitations(perms.has('users:view'));
  const roles = useRoles(perms.has('users:view'));
  const invite = useInvite();
  const revokeInvitation = useRevokeInvitation();
  const setStatus = useSetMemberStatus();
  const [roleId, setRoleId] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const form = useZodForm(createInvitationSchema, { email: '', roleId: '' });

  // Solo se ofrecen los roles que el usuario puede otorgar (el servidor lo vuelve a validar).
  const grantable = (roles.data ?? []).filter((r) => r.permissions.every((p) => perms.has(p)));

  const onInvite = form.submit(async (data) => {
    await invite.mutateAsync(data);
    setSent(data.email);
    form.set('email')('');
  });

  const toggleMember = (id: string, name: string, active: boolean) => {
    Alert.alert(active ? 'Reactivar acceso' : 'Revocar acceso', `${active ? 'Reactivar' : 'Revocar'} el acceso de ${name}?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: active ? 'Reactivar' : 'Revocar',
        style: active ? 'default' : 'destructive',
        onPress: () =>
          setStatus.mutate(
            { id, active },
            { onError: (e) => Alert.alert('No fue posible', e instanceof ApiError ? e.message : 'Intenta de nuevo') },
          ),
      },
    ]);
  };

  if (company.isPending || members.isPending) return <Loading />;
  if (members.isError) return <ErrorState message={members.error.message} onRetry={() => void members.refetch()} />;

  return (
    <Screen>
      <Text variant="titleMedium">Miembros</Text>
      {members.data.map((m) => (
        <List.Item
          key={m.id}
          title={`${m.fullName}${m.userId === me?.id ? ' (tú)' : ''}`}
          description={`${m.email} · ${m.role.name}${m.status === 'REVOKED' ? ' · Acceso revocado' : ''}`}
          left={(p) => <List.Icon {...p} icon={m.status === 'ACTIVE' ? 'account-check-outline' : 'account-cancel-outline'} />}
          right={() =>
            perms.has('users:manage') && m.userId !== me?.id ? (
              <Button compact onPress={() => toggleMember(m.id, m.fullName, m.status !== 'ACTIVE')}>
                {m.status === 'ACTIVE' ? 'Revocar' : 'Reactivar'}
              </Button>
            ) : null
          }
        />
      ))}

      {perms.has('users:invite') ? (
        <Card mode="outlined" style={styles.mt}>
          <Card.Title title="Invitar a una persona" subtitle="Recibirá un enlace por correo, válido 7 días" />
          <Card.Content>
            <FormError message={form.formError ?? (sent ? `Invitación enviada a ${sent}` : null)} />
            <Field label="Correo" value={form.values.email} onChangeText={form.set('email')} error={form.errors.email} keyboardType="email-address" autoComplete="email" />
            <Text variant="labelLarge">Rol</Text>
            <View style={[styles.grid, { marginVertical: 8, gap: 8 }]}>
              {grantable.map((r) => (
                <Chip
                  key={r.id}
                  selected={roleId === r.id}
                  showSelectedCheck
                  onPress={() => {
                    setRoleId(r.id);
                    form.set('roleId')(r.id);
                  }}
                  accessibilityState={{ selected: roleId === r.id }}
                >
                  {r.name}
                </Chip>
              ))}
            </View>
            {form.errors.roleId ? <HelperText type="error">Elige un rol</HelperText> : null}
            <Button mode="contained" onPress={onInvite} loading={form.submitting} disabled={form.submitting}>
              Enviar invitación
            </Button>
          </Card.Content>
        </Card>
      ) : null}

      <Text variant="titleMedium" style={styles.mtLarge}>
        Invitaciones
      </Text>
      {(invitations.data ?? []).length === 0 ? <Text variant="bodySmall">Sin invitaciones.</Text> : null}
      {(invitations.data ?? []).map((i) => (
        <List.Item
          key={i.id}
          title={i.email}
          description={`${i.role.name} · ${STATUS_LABEL[i.status]}`}
          right={() =>
            i.status === 'PENDING' && perms.has('users:invite') ? (
              <Button compact onPress={() => revokeInvitation.mutate(i.id)}>
                Cancelar
              </Button>
            ) : null
          }
        />
      ))}
    </Screen>
  );
}
