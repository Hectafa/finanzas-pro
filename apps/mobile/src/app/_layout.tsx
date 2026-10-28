import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Loading } from '../components/ui';
import { ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { theme } from '../theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // No reintenta errores de permisos o validación: solo fallas de red o del servidor.
      retry: (count, error) => count < 2 && (!(error instanceof ApiError) || error.status === 0 || error.status >= 500),
    },
  },
});

export default function RootLayout() {
  const status = useSession((s) => s.status);
  const hydrate = useSession((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Al cerrar sesión se descarta todo lo que estaba en caché.
  useEffect(() => {
    if (status === 'signedOut') queryClient.clear();
  }, [status]);

  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="dark" />
          {status === 'loading' ? (
            <Loading />
          ) : (
            <Stack screenOptions={{ headerTintColor: theme.colors.primary }}>
              <Stack.Screen name="(auth)" options={{ headerShown: false }} />
              <Stack.Screen name="(app)" options={{ headerShown: false }} />
              <Stack.Screen name="accept-invite" options={{ title: 'Invitación' }} />
            </Stack>
          )}
        </QueryClientProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
