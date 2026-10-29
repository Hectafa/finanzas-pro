import { loginSchema, type AuthResponse } from '@finanzas/shared';
import { Link } from 'expo-router';
import { View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import { Field, FormError, Screen, styles } from '../../components/ui';
import { api } from '../../lib/client';
import { deviceName } from '../../lib/device';
import { useZodForm } from '../../lib/forms';
import { useSession } from '../../lib/session';

export default function LoginScreen() {
  const signIn = useSession((s) => s.signIn);
  const form = useZodForm(loginSchema, { email: '', password: '' });

  const onSubmit = form.submit(async (data) => {
    const res = await api.request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: { ...data, deviceName: deviceName() },
      anonymous: true,
    });
    await signIn(res);
  });

  return (
    <Screen>
      <View style={[styles.mtLarge, { marginBottom: 24 }]}>
        <Text variant="headlineMedium">Finanzas Pro</Text>
        <Text variant="bodyLarge">Controla las finanzas de tu negocio desde tu teléfono.</Text>
      </View>
      <FormError message={form.formError} />
      <Field label="Correo" value={form.values.email} onChangeText={form.set('email')} error={form.errors.email} keyboardType="email-address" autoComplete="email" />
      <Field label="Contraseña" value={form.values.password} onChangeText={form.set('password')} error={form.errors.password} secure autoComplete="password" />
      <Button mode="contained" onPress={onSubmit} loading={form.submitting} disabled={form.submitting}>
        Iniciar sesión
      </Button>
      <Link href="/forgot-password" asChild>
        <Button style={styles.mt}>Olvidé mi contraseña</Button>
      </Link>
      <Link href="/register" asChild>
        <Button mode="outlined" style={styles.mt}>
          Crear una cuenta
        </Button>
      </Link>
    </Screen>
  );
}
