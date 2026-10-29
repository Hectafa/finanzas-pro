import { resetPasswordSchema } from '@finanzas/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, Text } from 'react-native-paper';
import { Field, FormError, Screen } from '../../components/ui';
import { api } from '../../lib/client';
import { useZodForm } from '../../lib/forms';

/** Se abre desde el enlace del correo: finanzaspro://reset-password?token=... */
export default function ResetPasswordScreen() {
  const { token = '' } = useLocalSearchParams<{ token?: string }>();
  const [done, setDone] = useState(false);
  const form = useZodForm(resetPasswordSchema, { token, password: '' });

  const onSubmit = form.submit(async (data) => {
    await api.request<void>('/auth/reset-password', {
      method: 'POST',
      body: { ...data, token },
      anonymous: true,
    });
    setDone(true);
  });

  if (!token) {
    return (
      <Screen narrow>
        <Text variant="bodyMedium">
          El enlace está incompleto. Solicita uno nuevo desde “Olvidé mi contraseña”.
        </Text>
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen narrow>
        <Text variant="titleMedium">Contraseña actualizada</Text>
        <Text variant="bodyMedium" style={{ marginVertical: 8 }}>
          Por seguridad cerramos todas tus sesiones. Inicia sesión con tu nueva contraseña.
        </Text>
        <Button mode="contained" onPress={() => router.replace('/login')}>
          Ir a iniciar sesión
        </Button>
      </Screen>
    );
  }

  return (
    <Screen narrow>
      <FormError message={form.formError ?? form.errors.token ?? null} />
      <Field
        label="Nueva contraseña"
        value={form.values.password}
        onChangeText={form.set('password')}
        error={form.errors.password}
        secure
        autoComplete="new-password"
      />
      <Button
        mode="contained"
        onPress={onSubmit}
        loading={form.submitting}
        disabled={form.submitting}
      >
        Guardar contraseña
      </Button>
    </Screen>
  );
}
