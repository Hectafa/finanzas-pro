import { Button, List, Text } from 'react-native-paper';
import { ErrorState, Loading, Screen, styles } from '../../components/ui';
import { api } from '../../lib/client';
import { confirmAction } from '../../lib/confirm';
import { useRevokeSession, useSessions } from '../../lib/queries';
import { useSession } from '../../lib/session';

const fmt = (iso: string) =>
  new Date(iso).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });

export default function SesionesScreen() {
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const signOut = useSession((s) => s.signOut);

  const logoutAll = async () => {
    const ok = await confirmAction({
      title: 'Cerrar todas las sesiones',
      message: 'Se cerrará la sesión en todos tus dispositivos, incluido este.',
      confirmText: 'Cerrar todas',
      destructive: true,
    });
    if (!ok) return;
    await api.request<void>('/auth/logout-all', { method: 'POST' }).catch(() => undefined);
    await signOut();
  };

  if (sessions.isPending) return <Loading />;
  if (sessions.isError)
    return <ErrorState message={sessions.error.message} onRetry={() => void sessions.refetch()} />;

  return (
    <Screen>
      <Text variant="bodyMedium">
        Si no reconoces un dispositivo, cierra su sesión y cambia tu contraseña.
      </Text>
      {sessions.data.map((s) => (
        <List.Item
          key={s.id}
          title={`${s.deviceName ?? 'Dispositivo sin nombre'}${s.current ? ' (este dispositivo)' : ''}`}
          description={`Último uso: ${fmt(s.lastUsedAt)}`}
          left={(p) => <List.Icon {...p} icon={s.current ? 'cellphone-check' : 'cellphone'} />}
          right={() =>
            s.current ? null : (
              <Button compact onPress={() => revoke.mutate(s.id)}>
                Cerrar
              </Button>
            )
          }
        />
      ))}
      <Button mode="outlined" style={styles.mtLarge} onPress={() => void logoutAll()}>
        Cerrar sesión en todos los dispositivos
      </Button>
    </Screen>
  );
}
