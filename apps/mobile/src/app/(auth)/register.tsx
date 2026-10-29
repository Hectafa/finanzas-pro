import { registerSchema, type AuthResponse } from '@finanzas/shared';
import { Button, Text } from 'react-native-paper';
import { Field, FormError, Screen, styles } from '../../components/ui';
import { api } from '../../lib/client';
import { deviceName } from '../../lib/device';
import { useZodForm } from '../../lib/forms';
import { useSession } from '../../lib/session';

export default function RegisterScreen() {
  const signIn = useSession((s) => s.signIn);
  const form = useZodForm(registerSchema, { fullName: '', email: '', password: '' });

  const onSubmit = form.submit(async (data) => {
    const res = await api.request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: { ...data, deviceName: deviceName() },
      anonymous: true,
    });
    await signIn(res);
  });

  return (
    <Screen narrow>
      <FormError message={form.formError} />
      <Field
        label="Nombre completo"
        value={form.values.fullName}
        onChangeText={form.set('fullName')}
        error={form.errors.fullName}
        autoComplete="name"
      />
      <Field
        label="Correo"
        value={form.values.email}
        onChangeText={form.set('email')}
        error={form.errors.email}
        keyboardType="email-address"
        autoComplete="email"
      />
      <Field
        label="Contraseña"
        value={form.values.password}
        onChangeText={form.set('password')}
        error={form.errors.password}
        secure
        autoComplete="new-password"
      />
      <Text variant="bodySmall" style={{ marginBottom: 12 }}>
        Mínimo 10 caracteres. Usa una frase que puedas recordar.
      </Text>
      <Button
        mode="contained"
        onPress={onSubmit}
        loading={form.submitting}
        disabled={form.submitting}
        style={styles.mt}
      >
        Crear cuenta
      </Button>
    </Screen>
  );
}
