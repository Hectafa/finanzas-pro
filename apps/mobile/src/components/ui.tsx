import type { MetricDto } from '@finanzas/shared';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type KeyboardTypeOptions } from 'react-native';
import { ActivityIndicator, Banner, Card, HelperText, Icon, Text, TextInput, useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatMoney, metricStatusLabel } from '../lib/format';

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const theme = useTheme();
  const content = <View style={styles.content}>{children}</View>;
  return (
    <SafeAreaView style={[styles.flex, { backgroundColor: theme.colors.background }]} edges={['bottom', 'left', 'right']}>
      {scroll ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}>
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

export function Field(props: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
  secure?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoComplete?: 'email' | 'password' | 'new-password' | 'name' | 'off';
}) {
  return (
    <View>
      <TextInput
        mode="outlined"
        label={props.label}
        value={props.value}
        onChangeText={props.onChangeText}
        error={!!props.error}
        secureTextEntry={props.secure}
        keyboardType={props.keyboardType}
        autoComplete={props.autoComplete}
        autoCapitalize={props.keyboardType === 'email-address' || props.secure ? 'none' : 'sentences'}
        accessibilityLabel={props.label}
      />
      <HelperText type="error" visible={!!props.error}>
        {props.error ?? ' '}
      </HelperText>
    </View>
  );
}

export function FormError({ message }: { message: string | null }) {
  return (
    <Banner visible={!!message} icon="alert-circle-outline">
      {message ?? ''}
    </Banner>
  );
}

export function Loading({ label = 'Cargando…' }: { label?: string }) {
  return (
    <View style={styles.center} accessibilityLabel={label}>
      <ActivityIndicator />
      <Text variant="bodyMedium" style={styles.mt}>
        {label}
      </Text>
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Banner visible icon="cloud-alert" actions={onRetry ? [{ label: 'Reintentar', onPress: onRetry }] : []}>
      {message}
    </Banner>
  );
}

/** Cifra del dashboard. El estado se muestra con texto e ícono además del color. */
export function MetricCard({ title, metric, currency }: { title: string; metric: MetricDto; currency: string }) {
  const theme = useTheme();
  const icon = metric.status === 'CONFIRMED' ? 'check-circle-outline' : metric.status === 'ESTIMATED' ? 'progress-clock' : 'minus-circle-outline';
  const statusText = metricStatusLabel(metric.status);
  return (
    <Card mode="outlined" style={styles.metric} accessibilityLabel={`${title}: ${metric.value === null ? statusText : formatMoney(metric.value, currency)}`}>
      <Card.Content>
        <Text variant="labelLarge" style={{ color: theme.colors.secondary }}>
          {title}
        </Text>
        <Text variant="headlineSmall" style={styles.mtSmall}>
          {formatMoney(metric.value, currency)}
        </Text>
        <View style={[styles.row, styles.mtSmall]}>
          <Icon source={icon} size={16} color={theme.colors.onSurfaceVariant} />
          <Text variant="bodySmall" style={{ color: theme.colors.onSurfaceVariant, marginLeft: 4 }}>
            {statusText}
          </Text>
        </View>
        {metric.note ? (
          <Text variant="bodySmall" style={[styles.mtSmall, { color: theme.colors.onSurfaceVariant }]}>
            {metric.note}
          </Text>
        ) : null}
      </Card.Content>
    </Card>
  );
}

/** Aviso honesto para módulos que aún no existen. */
export function PhaseNotice({ phase, description }: { phase: number; description: string }) {
  return (
    <Card mode="contained" style={styles.mtLarge}>
      <Card.Title title={`Disponible en la Fase ${phase}`} left={(p) => <Icon {...p} source="hammer-wrench" />} />
      <Card.Content>
        <Text variant="bodyMedium">{description}</Text>
      </Card.Content>
    </Card>
  );
}

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
  content: { padding: 16, gap: 4, flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  row: { flexDirection: 'row', alignItems: 'center' },
  metric: { flexBasis: '47%', flexGrow: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  mt: { marginTop: 12 },
  mtSmall: { marginTop: 4 },
  mtLarge: { marginTop: 24 },
});
