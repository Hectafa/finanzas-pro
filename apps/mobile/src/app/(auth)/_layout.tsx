import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { useSession } from '../../lib/session';

export default function AuthLayout() {
  const status = useSession((s) => s.status);
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  // Si la sesión ya está iniciada, vuelve a donde iba (p. ej. aceptar una invitación).
  if (status === 'signedIn') return <Redirect href={returnTo === 'accept-invite' ? '/accept-invite' : '/inicio'} />;
  return (
    <Stack>
      <Stack.Screen name="login" options={{ title: 'Iniciar sesión', headerShown: false }} />
      <Stack.Screen name="register" options={{ title: 'Crear cuenta' }} />
      <Stack.Screen name="forgot-password" options={{ title: 'Recuperar contraseña' }} />
      <Stack.Screen name="reset-password" options={{ title: 'Nueva contraseña' }} />
    </Stack>
  );
}
