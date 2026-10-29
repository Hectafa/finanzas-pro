import { forgotPasswordSchema } from '@finanzas/shared';
import { useState } from 'react';
import { Button, Text } from 'react-native-paper';
import { Field, FormError, Screen } from '../../components/ui';
import { api } from '../../lib/client';
import { useZodForm } from '../../lib/forms';

export default function ForgotPasswordScreen() {
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const form = useZodForm(forgotPasswordSchema, { email: '' });

  const onSubmit = form.submit(async (data) => {
    const res = await api.request<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: data,
      anonymous: true,
    });
    setSentMessage(res.message);
  });

  if (sentMessage) {
    return (
      <Screen>
        <Text variant="titleMedium">Revisa tu correo</Text>
        <Text variant="bodyMedium" style={{ marginTop: 8 }}>
          {sentMessage}. Abre el enlace desde este teléfono; vence en 30 minutos.
        </Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <Text variant="bodyMedium" style={{ marginBottom: 12 }}>
        Te enviaremos un enlace para crear una nueva contraseña.
      </Text>
      <FormError message={form.formError} />
      <Field
        label="Correo"
        value={form.values.email}
        onChangeText={form.set('email')}
        error={form.errors.email}
        keyboardType="email-address"
        autoComplete="email"
      />
      <Button
        mode="contained"
        onPress={onSubmit}
        loading={form.submitting}
        disabled={form.submitting}
      >
        Enviar enlace
      </Button>
    </Screen>
  );
}
