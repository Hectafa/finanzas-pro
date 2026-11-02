import { createCompanySchema } from '@finanzas/shared';
import { router } from 'expo-router';
import { Button, Card, Divider, List, Text } from 'react-native-paper';
import { Field, FormError, Screen, styles } from '../../components/ui';
import { useZodForm } from '../../lib/forms';
import { useCompanies, useCreateCompany } from '../../lib/queries';
import { useSession } from '../../lib/session';

export default function SelectCompanyScreen() {
  const companies = useCompanies();
  const companyId = useSession((s) => s.companyId);
  const setCompany = useSession((s) => s.setCompany);
  const create = useCreateCompany();
  const form = useZodForm(createCompanySchema, { name: '' });

  const choose = async (id: string) => {
    await setCompany(id);
    router.replace('/inicio');
  };

  const onCreate = form.submit(async (data) => {
    const company = await create.mutateAsync(data);
    await choose(company.id);
  });

  const list = companies.data ?? [];

  return (
    <Screen>
      {list.length > 0 ? (
        <>
          <Text variant="titleMedium">Elige una empresa</Text>
          {list.map((c) => (
            <List.Item
              key={c.id}
              title={c.name + (c.isDemo ? ' · DEMO' : '')}
              description={`${c.role.name} · ${c.currency}`}
              left={(p) => (
                <List.Icon {...p} icon={c.id === companyId ? 'check-circle' : 'store-outline'} />
              )}
              onPress={() => void choose(c.id)}
              accessibilityLabel={`${c.name}, rol ${c.role.name}${c.id === companyId ? ', seleccionada' : ''}`}
            />
          ))}
          <Divider style={styles.mt} />
        </>
      ) : (
        <Text variant="bodyLarge" style={{ marginBottom: 8 }}>
          Aún no perteneces a ninguna empresa. Crea la tuya o pide a su propietario que te invite.
        </Text>
      )}
      <Card mode="outlined" style={styles.mt}>
        <Card.Title title="Crear una empresa" subtitle="Serás su Propietario" />
        <Card.Content>
          <FormError message={form.formError} />
          <Field
            label="Nombre del negocio"
            value={form.values.name}
            onChangeText={form.set('name')}
            error={form.errors.name}
          />
          <Button
            mode="contained"
            onPress={onCreate}
            loading={form.submitting}
            disabled={form.submitting}
          >
            Crear empresa
          </Button>
        </Card.Content>
      </Card>
    </Screen>
  );
}
