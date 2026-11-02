import { Redirect, Stack, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { ErrorState, Loading, Screen } from '../../components/ui';
import { useCompanies, useMe } from '../../lib/queries';
import { useSession } from '../../lib/session';

/**
 * Área autenticada. Exige sesión y una empresa activa a la que el usuario pertenezca;
 * si la empresa guardada ya no está entre sus empresas (p. ej. le revocaron el acceso), la descarta.
 */
export default function AppLayout() {
  const status = useSession((s) => s.status);
  const companyId = useSession((s) => s.companyId);
  const setCompany = useSession((s) => s.setCompany);
  const setUser = useSession((s) => s.setUser);
  const segments = useSegments();
  const me = useMe();
  const companies = useCompanies();

  useEffect(() => {
    if (me.data) setUser(me.data);
  }, [me.data, setUser]);

  const list = companies.data;
  const valid = !!companyId && !!list?.some((c) => c.id === companyId);

  useEffect(() => {
    if (!list || valid) return;
    // Una sola empresa: se selecciona sola. Varias o ninguna: el usuario elige o crea.
    void setCompany(list.length === 1 ? list[0]!.id : null);
  }, [list, valid, setCompany]);

  if (status !== 'signedIn') return <Redirect href="/login" />;
  if (companies.isPending) return <Loading />;
  if (companies.isError) {
    return (
      <Screen>
        <ErrorState message={companies.error.message} onRetry={() => void companies.refetch()} />
      </Screen>
    );
  }

  const onSelectCompany = segments[segments.length - 1] === 'select-company';
  if (!valid && !onSelectCompany) return <Redirect href="/select-company" />;

  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen
        name="select-company"
        options={{ title: 'Tus empresas', headerBackVisible: valid }}
      />
      <Stack.Screen name="usuarios" options={{ title: 'Usuarios y accesos' }} />
      <Stack.Screen name="roles" options={{ title: 'Roles y permisos' }} />
      <Stack.Screen name="sesiones" options={{ title: 'Sesiones activas' }} />
      <Stack.Screen name="cuentas" options={{ title: 'Cuentas de dinero' }} />
      <Stack.Screen name="categorias" options={{ title: 'Categorías' }} />
      <Stack.Screen name="movimiento/[id]" options={{ title: 'Movimiento' }} />
    </Stack>
  );
}
