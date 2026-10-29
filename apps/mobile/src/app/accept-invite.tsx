import type { CompanySummaryDto } from '@finanzas/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { Button, Text } from 'react-native-paper';
import { FormError, Loading, Screen } from '../components/ui';
import { ApiError } from '../lib/api';
import { api } from '../lib/client';
import { useSession } from '../lib/session';

const PENDING_INVITE_KEY = 'fp.pendingInvite';

/**
 * Se abre desde el correo: finanzaspro://accept-invite?token=...
 * Si no hay sesión, guarda el token, pide iniciar sesión o registrarse con el correo invitado
 * y vuelve aquí para completar la aceptación.
 */
export default function AcceptInviteScreen() {
  const params = useLocalSearchParams<{ token?: string }>();
  const status = useSession((s) => s.status);
  const setCompany = useSession((s) => s.setCompany);
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(params.token ?? null);
  const [accepted, setAccepted] = useState<CompanySummaryDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (params.token) void SecureStore.setItemAsync(PENDING_INVITE_KEY, params.token);
    else void SecureStore.getItemAsync(PENDING_INVITE_KEY).then(setToken);
  }, [params.token]);

  if (status === 'signedOut')
    return <Redirect href={{ pathname: '/login', params: { returnTo: 'accept-invite' } }} />;
  if (!token) return <Loading label="Buscando invitación…" />;

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      const company = await api.request<CompanySummaryDto>('/invitations/accept', {
        method: 'POST',
        body: { token },
      });
      await SecureStore.deleteItemAsync(PENDING_INVITE_KEY);
      await setCompany(company.id);
      await qc.invalidateQueries({ queryKey: ['companies'] });
      setAccepted(company);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'No fue posible aceptar la invitación');
    } finally {
      setBusy(false);
    }
  };

  if (accepted) {
    return (
      <Screen>
        <Text variant="titleMedium">Ya formas parte de {accepted.name}</Text>
        <Text variant="bodyMedium" style={{ marginVertical: 8 }}>
          Tu rol: {accepted.role.name}
        </Text>
        <Button mode="contained" onPress={() => router.replace('/inicio')}>
          Continuar
        </Button>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text variant="bodyLarge">Te invitaron a colaborar en una empresa en Finanzas Pro.</Text>
      <Text variant="bodySmall" style={{ marginVertical: 8 }}>
        La invitación solo funciona con la cuenta del correo al que fue enviada.
      </Text>
      <FormError message={error} />
      <Button mode="contained" onPress={accept} loading={busy} disabled={busy}>
        Aceptar invitación
      </Button>
    </Screen>
  );
}
