import { router } from 'expo-router';
import { useState } from 'react';
import { Button, Dialog, Divider, List, Portal, Text } from 'react-native-paper';
import { Screen } from '../../../components/ui';
import { api } from '../../../lib/client';
import { useCurrentCompany } from '../../../lib/queries';
import { useSession } from '../../../lib/session';

const LATER = [
  { title: 'Presupuestos', icon: 'chart-donut', phase: 4 },
  { title: 'Personal y nómina', icon: 'account-group-outline', phase: 4 },
  { title: 'Reportes', icon: 'file-chart-outline', phase: 4 },
  { title: 'Asistente de IA', icon: 'robot-outline', phase: 5 },
] as const;

export default function MasScreen() {
  const company = useCurrentCompany();
  const user = useSession((s) => s.user);
  const signOut = useSession((s) => s.signOut);
  const [confirm, setConfirm] = useState(false);
  const can = (p: string) => company.data?.permissions.includes(p) ?? false;

  const logout = async () => {
    setConfirm(false);
    // Aunque el servidor no responda (sin red), la sesión local se cierra.
    await api.request<void>('/auth/logout', { method: 'POST' }).catch(() => undefined);
    await signOut();
  };

  return (
    <Screen>
      <List.Item
        title={user?.fullName ?? ''}
        description={user?.email}
        left={(p) => <List.Icon {...p} icon="account-circle-outline" />}
      />
      {company.data ? (
        <List.Item
          title={company.data.name}
          description={`Tu rol: ${company.data.role.name}`}
          left={(p) => <List.Icon {...p} icon="store-outline" />}
          onPress={() => router.push('/select-company')}
        />
      ) : null}
      <Divider />
      {can('users:view') ? (
        <List.Item
          title="Usuarios y accesos"
          left={(p) => <List.Icon {...p} icon="account-key-outline" />}
          onPress={() => router.push('/usuarios')}
        />
      ) : null}
      <List.Item
        title="Sesiones activas"
        left={(p) => <List.Icon {...p} icon="cellphone-lock" />}
        onPress={() => router.push('/sesiones')}
      />
      <Divider />
      {LATER.map((m) => (
        <List.Item
          key={m.title}
          title={m.title}
          description={`Disponible en la Fase ${m.phase}`}
          left={(p) => <List.Icon {...p} icon={m.icon} />}
          disabled
        />
      ))}
      <Divider />
      <List.Item
        title="Cerrar sesión"
        left={(p) => <List.Icon {...p} icon="logout" />}
        onPress={() => setConfirm(true)}
      />

      <Portal>
        <Dialog visible={confirm} onDismiss={() => setConfirm(false)}>
          <Dialog.Title>¿Cerrar sesión?</Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">Tendrás que volver a iniciar sesión en este teléfono.</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setConfirm(false)}>Cancelar</Button>
            <Button onPress={() => void logout()}>Cerrar sesión</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Screen>
  );
}
